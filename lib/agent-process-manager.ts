import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { invalidateModelsCache } from "./models-cache";
import {
  cacheSessionPath,
  invalidateSessionListCache,
} from "./session-reader";
import type {
  AgentWorkerMessage,
  AgentWorkerRequest,
} from "./agent-worker-protocol";

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;
type DestroyListener = () => void;

type PendingRequest = {
  commandType: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type WorkerStartOptions = {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  toolNames?: string[];
};

const WORKER_START_TIMEOUT_MS = 60_000;
const WORKER_STOP_TIMEOUT_MS = 5_000;

const SESSION_CACHE_COMMANDS = new Set([
  "bash",
  "compact",
  "fork",
  "generate_session_title",
  "prompt",
  "reload",
  "set_model",
  "set_session_name",
  "set_thinking_level",
]);

function getWorkerEntryPath(): string {
  const configured = process.env.PI_WEB_AGENT_WORKER_PATH;
  const entryPath = configured
    ? resolve(configured)
    : resolve(process.cwd(), "scripts", "agent-worker.mjs");
  if (!existsSync(entryPath)) {
    throw new Error(`Agent worker entry not found: ${entryPath}`);
  }
  return entryPath;
}

function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function workerExitError(code: number | null, signal: NodeJS.Signals | null): Error {
  const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
  return new Error(`Agent worker exited with ${detail}`);
}

export class AgentProcessSession {
  private readonly child: ChildProcess;
  private readonly listeners = new Set<EventListener>();
  private readonly destroyListeners = new Set<DestroyListener>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pendingUiRequests = new Map<string, AgentEvent>();
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readySettled = false;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private _sessionId: string;
  private _sessionFile: string;
  private _cwd: string;
  private _alive = true;
  private _running = false;
  private destroyRequested = false;

  private constructor(options: WorkerStartOptions) {
    this._sessionId = options.sessionId;
    this._sessionFile = options.sessionFile;
    this._cwd = options.cwd;
    this.readyPromise = new Promise<void>((resolveReady, rejectReady) => {
      this.resolveReady = resolveReady;
      this.rejectReady = rejectReady;
    });

    this.child = fork(getWorkerEntryPath(), [], {
      cwd: options.cwd,
      env: {
        ...process.env,
        PI_WEB_AGENT_WORKER: "1",
      },
      execArgv: [],
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });

    this.child.on("message", (message: AgentWorkerMessage) => {
      this.handleWorkerMessage(message);
    });
    this.child.once("error", (error) => {
      this.handleWorkerFailure(error);
    });
    this.child.once("exit", (code, signal) => {
      this.handleWorkerExit(code, signal);
    });

    const initRequestId = randomUUID();
    const startTimer = setTimeout(() => {
      if (this.readySettled) return;
      const error = new Error(`Agent worker did not start within ${WORKER_START_TIMEOUT_MS / 1000} seconds`);
      this.rejectStartup(error);
      this.destroy();
    }, WORKER_START_TIMEOUT_MS);
    startTimer.unref();
    this.readyPromise.finally(() => clearTimeout(startTimer)).catch(() => {});

    this.sendRaw({
      type: "init",
      requestId: initRequestId,
      sessionId: options.sessionId,
      sessionFile: options.sessionFile,
      cwd: options.cwd,
      toolNames: options.toolNames,
    }, (error) => {
      if (error) this.rejectStartup(toError(error));
    });
  }

  static async start(options: WorkerStartOptions): Promise<AgentProcessSession> {
    const session = new AgentProcessSession(options);
    try {
      await session.waitUntilReady();
      return session;
    } catch (error) {
      session.destroy();
      throw error;
    }
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get sessionFile(): string {
    return this._sessionFile;
  }

  get cwd(): string {
    return this._cwd;
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._alive && this._running;
  }

  waitUntilReady(): Promise<void> {
    return this.readyPromise;
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onDestroy(listener: DestroyListener): void {
    this.destroyListeners.add(listener);
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    await this.waitUntilReady();
    if (!this._alive) throw new Error("Agent worker session is not available");

    const commandType = typeof command.type === "string" ? command.type : "unknown";
    if (commandType === "extension_ui_response") {
      const id = typeof command.id === "string" ? command.id : undefined;
      if (id) this.pendingUiRequests.delete(id);
    }

    const requestId = randomUUID();
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(requestId, {
        commandType,
        resolve: resolveRequest,
        reject: rejectRequest,
      });
      this.sendRaw({ type: "command", requestId, command }, (error) => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.reject(toError(error));
      });
    });
  }

  destroy(): void {
    if (!this._alive) return;
    this.destroyRequested = true;
    this.markDestroyed(new Error("Agent worker session was closed"));

    const request: AgentWorkerRequest = {
      type: "destroy",
      requestId: randomUUID(),
    };
    this.sendRaw(request, (error) => {
      if (error && this.child.exitCode === null) this.child.kill("SIGTERM");
    });

    this.stopTimer = setTimeout(() => {
      if (this.child.exitCode === null) this.child.kill("SIGKILL");
    }, WORKER_STOP_TIMEOUT_MS);
    this.stopTimer.unref();
  }

  private sendRaw(
    message: AgentWorkerRequest,
    callback?: (error: Error | null) => void,
  ): void {
    if (!this.child.connected) {
      callback?.(new Error("Agent worker IPC channel is closed"));
      return;
    }
    try {
      this.child.send(message, callback);
    } catch (error) {
      callback?.(toError(error));
    }
  }

  private handleWorkerMessage(message: AgentWorkerMessage): void {
    switch (message.type) {
      case "ready":
        this._sessionId = message.realSessionId;
        this._sessionFile = message.sessionFile;
        this._cwd = message.cwd;
        this.updateRunning(message.running);
        if (message.sessionFile) cacheSessionPath(message.realSessionId, message.sessionFile);
        invalidateSessionListCache();
        this.resolveStartup();
        return;

      case "response": {
        const pending = this.pending.get(message.requestId);
        if (!pending) {
          if (!message.success && !this.readySettled) {
            this.rejectStartup(new Error(message.error ?? "Agent worker failed to start"));
          }
          return;
        }
        this.pending.delete(message.requestId);
        if (!message.success) {
          pending.reject(new Error(message.error ?? `${pending.commandType} failed`));
          return;
        }
        this.applyCommandSideEffects(pending.commandType);
        pending.resolve(message.result);
        return;
      }

      case "event":
        this.trackPendingUiRequest(message.event);
        if (message.event.type === "agent_end") invalidateSessionListCache();
        this.emit(message.event);
        return;

      case "status":
        this.updateRunning(message.running);
        return;

      case "destroyed":
        if (!this.destroyRequested) {
          this.markDestroyed(new Error("Agent worker session ended"));
        }
        return;

      case "fatal":
        this.handleWorkerFailure(new Error(message.error));
        return;
    }
  }

  private handleWorkerFailure(error: Error): void {
    if (!this.readySettled) this.rejectStartup(error);
    if (this._running && !this.destroyRequested) {
      this.emit({ type: "prompt_error", errorMessage: error.message });
      this.emit({ type: "prompt_done" });
    }
    this.markDestroyed(error);
  }

  private handleWorkerExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    const error = workerExitError(code, signal);
    if (!this.readySettled) this.rejectStartup(error);
    if (this._running && !this.destroyRequested) {
      this.emit({ type: "prompt_error", errorMessage: error.message });
      this.emit({ type: "prompt_done" });
    }
    this.markDestroyed(error);
  }

  private resolveStartup(): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.resolveReady();
  }

  private rejectStartup(error: Error): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.rejectReady(error);
  }

  private markDestroyed(error: Error): void {
    if (!this._alive) return;
    this._alive = false;
    this.updateRunning(false);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.pendingUiRequests.clear();
    for (const listener of this.destroyListeners) {
      try { listener(); } catch { /* ignore cleanup listener errors */ }
    }
    this.destroyListeners.clear();
  }

  private updateRunning(running: boolean): void {
    if (this._running === running) return;
    this._running = running;
    notifyRunningChange();
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore listener errors */ }
    }
  }

  private trackPendingUiRequest(event: AgentEvent): void {
    if (event.type !== "extension_ui_request" || typeof event.id !== "string") return;
    const method = event.method;
    if (
      event.closed === true
      || method === "notify"
      || method === "setStatus"
      || method === "setWidget"
      || method === "setTitle"
      || method === "set_editor_text"
    ) {
      this.pendingUiRequests.delete(event.id);
      return;
    }
    this.pendingUiRequests.set(event.id, event);
  }

  private applyCommandSideEffects(commandType: string): void {
    if (SESSION_CACHE_COMMANDS.has(commandType)) invalidateSessionListCache();
    if (commandType === "reload" || commandType === "set_model") invalidateModelsCache();
  }
}

declare global {
  var __piAgentProcesses: Map<string, AgentProcessSession> | undefined;
  var __piAgentProcessStartLocks:
    | Map<string, Promise<{ session: AgentProcessSession; realSessionId: string }>>
    | undefined;
  var __piAgentProcessStartingCwds: Map<string, number> | undefined;
  var __piAgentProcessRunningListeners: Set<(ids: string[]) => void> | undefined;
  var __piAgentProcessCleanupInstalled: boolean | undefined;
  var __piAgentProcessLastRunningSnapshot: string | undefined;
}

function getRegistry(): Map<string, AgentProcessSession> {
  if (!globalThis.__piAgentProcesses) globalThis.__piAgentProcesses = new Map();
  if (!globalThis.__piAgentProcessCleanupInstalled) {
    globalThis.__piAgentProcessCleanupInstalled = true;
    process.once("exit", () => {
      globalThis.__piAgentProcesses?.forEach((session) => session.destroy());
    });
  }
  return globalThis.__piAgentProcesses;
}

function getLocks(): Map<string, Promise<{ session: AgentProcessSession; realSessionId: string }>> {
  if (!globalThis.__piAgentProcessStartLocks) globalThis.__piAgentProcessStartLocks = new Map();
  return globalThis.__piAgentProcessStartLocks;
}

function getStartingSessionCwds(): Map<string, number> {
  if (!globalThis.__piAgentProcessStartingCwds) globalThis.__piAgentProcessStartingCwds = new Map();
  return globalThis.__piAgentProcessStartingCwds;
}

function trackStartingSession(cwd: string): () => void {
  const startingCwds = getStartingSessionCwds();
  const key = normalizeRpcCwd(cwd);
  startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
  return () => {
    const remaining = (startingCwds.get(key) ?? 1) - 1;
    if (remaining > 0) startingCwds.set(key, remaining);
    else startingCwds.delete(key);
  };
}

export function getRpcSession(sessionId: string): AgentProcessSession | undefined {
  return getRegistry().get(sessionId);
}

export function hasBusyRpcSessionForCwd(cwd: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  if (getStartingSessionCwds().has(targetCwd)) return true;
  return Array.from(getRegistry().values()).some(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
  );
}

export function destroyRpcSessionsForCwd(cwd: string): number {
  const targetCwd = normalizeRpcCwd(cwd);
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd,
  );
  for (const session of sessions) session.destroy();
  return sessions.length;
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

function getRunningListeners(): Set<(ids: string[]) => void> {
  if (!globalThis.__piAgentProcessRunningListeners) {
    globalThis.__piAgentProcessRunningListeners = new Set();
  }
  return globalThis.__piAgentProcessRunningListeners;
}

export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyRunningChange(): void {
  const ids = getRunningRpcSessionIds();
  const snapshot = JSON.stringify([...ids].sort());
  if (snapshot === globalThis.__piAgentProcessLastRunningSnapshot) return;
  globalThis.__piAgentProcessLastRunningSnapshot = snapshot;
  for (const listener of getRunningListeners()) {
    try { listener(ids); } catch { /* ignore listener errors */ }
  }
}

export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
): Promise<{ session: AgentProcessSession; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: existing.sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const finishStartingSession = trackStartingSession(cwd);
  const starting = AgentProcessSession.start({
    sessionId,
    sessionFile,
    cwd,
    toolNames,
  }).then((session) => {
    const realSessionId = session.sessionId;
    const previous = registry.get(realSessionId);
    if (previous && previous !== session) previous.destroy();
    registry.set(realSessionId, session);
    session.onDestroy(() => {
      if (registry.get(realSessionId) === session) registry.delete(realSessionId);
      notifyRunningChange();
    });
    notifyRunningChange();
    return { session, realSessionId };
  }).finally(() => {
    locks.delete(sessionId);
    finishStartingSession();
  });

  locks.set(sessionId, starting);
  return starting;
}
