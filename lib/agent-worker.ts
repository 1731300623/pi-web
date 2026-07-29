import type { AgentEvent, AgentSessionWrapper } from "./rpc-manager";
import { startRpcSession, subscribeRunningSessions } from "./rpc-manager";
import type {
  AgentWorkerMessage,
  AgentWorkerRequest,
} from "./agent-worker-protocol";

let activeSession: AgentSessionWrapper | undefined;
let initialized = false;
let shutdownPromise: Promise<void> | undefined;
let lastRunningState: boolean | undefined;
let scheduledExit: ReturnType<typeof setTimeout> | undefined;
let activeRequestCount = 0;
let sessionDestroyed = false;
let requestedExitCode = 0;
let unsubscribeRunningState: (() => void) | undefined;

function sendToParent(message: AgentWorkerMessage): void {
  if (!process.connected || typeof process.send !== "function") return;
  try {
    process.send(message);
  } catch {
    // The parent is already gone; signal handlers below will tear down the session.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emitRunningState(force = false): void {
  const running = activeSession?.isRunning() ?? false;
  if (!force && running === lastRunningState) return;
  lastRunningState = running;
  sendToParent({ type: "status", running });
}

function scheduleExit(code = 0): void {
  if (scheduledExit) return;
  scheduledExit = setTimeout(() => process.exit(code), 25);
  scheduledExit.unref();
}

function finishDestroyedSession(code = requestedExitCode): void {
  if (scheduledExit) return;
  sendToParent({ type: "destroyed" });
  scheduleExit(code);
}

async function shutdown(code = 0): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  requestedExitCode = code;
  shutdownPromise = (async () => {
    try {
      await activeSession?.shutdown();
    } catch (error) {
      sendToParent({ type: "fatal", error: errorMessage(error) });
    } finally {
      sessionDestroyed = true;
      if (activeRequestCount === 0) finishDestroyedSession(code);
    }
  })();
  return shutdownPromise;
}

async function initialize(message: Extract<AgentWorkerRequest, { type: "init" }>): Promise<void> {
  if (initialized) throw new Error("Agent worker is already initialized");
  initialized = true;

  const { session, realSessionId } = await startRpcSession(
    message.sessionId,
    message.sessionFile,
    message.cwd,
    message.toolNames,
  );
  activeSession = session;

  unsubscribeRunningState = subscribeRunningSessions(() => {
    emitRunningState();
  });
  session.onEvent((event: AgentEvent) => {
    sendToParent({ type: "event", event });
    emitRunningState();
  });
  session.onDestroy(() => {
    unsubscribeRunningState?.();
    unsubscribeRunningState = undefined;
    emitRunningState(true);
    sessionDestroyed = true;
    if (activeRequestCount === 0) finishDestroyedSession();
  });

  await session.waitUntilReady();
  sendToParent({
    type: "ready",
    requestId: message.requestId,
    realSessionId,
    sessionFile: session.sessionFile,
    cwd: session.cwd,
    running: session.isRunning(),
  });
  emitRunningState(true);
}

async function handleRequest(message: AgentWorkerRequest): Promise<void> {
  if (message.type === "init") {
    try {
      await initialize(message);
    } catch (error) {
      sendToParent({
        type: "response",
        requestId: message.requestId,
        success: false,
        error: errorMessage(error),
      });
      scheduleExit(1);
    }
    return;
  }

  if (!activeSession?.isAlive()) {
    sendToParent({
      type: "response",
      requestId: message.requestId,
      success: false,
      error: "Agent worker session is not available",
    });
    return;
  }

  activeRequestCount += 1;
  try {
    if (message.type === "destroy") {
      await shutdown();
      sendToParent({ type: "response", requestId: message.requestId, success: true });
      return;
    }

    const result = await activeSession.send(message.command);
    sendToParent({
      type: "response",
      requestId: message.requestId,
      success: true,
      result,
    });
  } catch (error) {
    sendToParent({
      type: "response",
      requestId: message.requestId,
      success: false,
      error: errorMessage(error),
    });
  } finally {
    activeRequestCount -= 1;
    emitRunningState(true);
    if (sessionDestroyed && activeRequestCount === 0) finishDestroyedSession();
  }
}

process.on("message", (message: AgentWorkerRequest) => {
  void handleRequest(message);
});

process.once("disconnect", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(143);
});
process.once("uncaughtException", (error) => {
  sendToParent({ type: "fatal", error: errorMessage(error) });
  void shutdown(1);
});
process.once("unhandledRejection", (error) => {
  sendToParent({ type: "fatal", error: errorMessage(error) });
  void shutdown(1);
});
