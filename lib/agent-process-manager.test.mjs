import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const {
  getRpcSession,
  startRpcSession,
  subscribeRunningSessions,
} = await jiti.import("./agent-process-manager.ts");

const FAKE_WORKER_SOURCE = `
import { appendFile } from "node:fs/promises";

let sessionId = "";
let cwd = "";

function reply(message) {
  if (process.connected) process.send(message);
}

process.on("message", async (message) => {
  if (message.type === "init") {
    sessionId = message.sessionId;
    cwd = message.cwd;
    reply({
      type: "ready",
      requestId: message.requestId,
      realSessionId: sessionId,
      sessionFile: message.sessionFile,
      cwd,
      running: false,
    });
    return;
  }

  if (message.type === "destroy") {
    if (process.env.PI_WEB_TEST_SHUTDOWN_LOG) {
      try {
        await appendFile(process.env.PI_WEB_TEST_SHUTDOWN_LOG, sessionId + "\\n");
      } catch {
        // The parent test may already have removed its temporary fixture.
      }
    }
    reply({ type: "response", requestId: message.requestId, success: true });
    reply({ type: "destroyed" });
    setTimeout(() => process.exit(0), 10);
    return;
  }

  if (message.command.type === "crash") {
    process.exit(17);
  }

  if (message.command.type === "set_running") {
    reply({ type: "status", running: message.command.running });
  }

  reply({
    type: "response",
    requestId: message.requestId,
    success: true,
    result: { pid: process.pid, sessionId },
  });
});
`;

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

async function createWorkerFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-agent-process-"));
  const workerPath = join(root, "fake-worker.mjs");
  const shutdownLog = join(root, "shutdown.log");
  const previousWorkerPath = process.env.PI_WEB_AGENT_WORKER_PATH;
  const previousShutdownLog = process.env.PI_WEB_TEST_SHUTDOWN_LOG;

  await writeFile(workerPath, FAKE_WORKER_SOURCE);
  process.env.PI_WEB_AGENT_WORKER_PATH = workerPath;
  process.env.PI_WEB_TEST_SHUTDOWN_LOG = shutdownLog;

  t.after(async () => {
    if (previousWorkerPath === undefined) delete process.env.PI_WEB_AGENT_WORKER_PATH;
    else process.env.PI_WEB_AGENT_WORKER_PATH = previousWorkerPath;
    if (previousShutdownLog === undefined) delete process.env.PI_WEB_TEST_SHUTDOWN_LOG;
    else process.env.PI_WEB_TEST_SHUTDOWN_LOG = previousShutdownLog;
    await rm(root, { recursive: true, force: true });
  });

  return { root, shutdownLog };
}

test("different agent sessions run in isolated child processes", async (t) => {
  const { root, shutdownLog } = await createWorkerFixture(t);
  const firstId = `process-a-${process.pid}-${Date.now()}`;
  const secondId = `process-b-${process.pid}-${Date.now()}`;
  const first = await startRpcSession(firstId, join(root, "first.jsonl"), root);
  const second = await startRpcSession(secondId, join(root, "second.jsonl"), root);

  t.after(() => {
    first.session.destroy();
    second.session.destroy();
  });

  const firstResult = await first.session.send({ type: "identity" });
  const secondResult = await second.session.send({ type: "identity" });

  assert.equal(first.realSessionId, firstId);
  assert.equal(second.realSessionId, secondId);
  assert.notEqual(firstResult.pid, secondResult.pid);
  assert.notEqual(firstResult.pid, process.pid);
  assert.notEqual(secondResult.pid, process.pid);

  first.session.destroy();
  second.session.destroy();
  await waitFor(async () => {
    try {
      const lines = (await readFile(shutdownLog, "utf8")).trim().split("\n");
      return lines.includes(firstId) && lines.includes(secondId);
    } catch {
      return false;
    }
  });
});

test("a crashed worker is removed and the same session can restart", async (t) => {
  const { root } = await createWorkerFixture(t);
  const sessionId = `process-restart-${process.pid}-${Date.now()}`;
  const sessionFile = join(root, "restart.jsonl");
  const first = await startRpcSession(sessionId, sessionFile, root);
  const firstIdentity = await first.session.send({ type: "identity" });

  await assert.rejects(
    first.session.send({ type: "crash" }),
    /Agent worker exited with code 17/,
  );
  await waitFor(() => getRpcSession(sessionId) === undefined);

  const restarted = await startRpcSession(sessionId, sessionFile, root);
  const restartedIdentity = await restarted.session.send({ type: "identity" });

  assert.notEqual(restartedIdentity.pid, firstIdentity.pid);
  assert.equal(restarted.realSessionId, sessionId);
  assert.equal(getRpcSession(sessionId), restarted.session);

  restarted.session.destroy();
  await waitFor(async () => {
    try {
      return (await readFile(join(root, "shutdown.log"), "utf8")).includes(sessionId);
    } catch {
      return false;
    }
  });
});

test("worker running status is broadcast by the parent process", async (t) => {
  const { root, shutdownLog } = await createWorkerFixture(t);
  const sessionId = `process-running-${process.pid}-${Date.now()}`;
  const started = await startRpcSession(sessionId, join(root, "running.jsonl"), root);
  const snapshots = [];
  const unsubscribe = subscribeRunningSessions((ids) => snapshots.push(ids));

  await started.session.send({ type: "set_running", running: true });
  assert.equal(started.session.isRunning(), true);
  await started.session.send({ type: "set_running", running: false });
  assert.equal(started.session.isRunning(), false);

  unsubscribe();
  assert.ok(snapshots.some((ids) => ids.includes(sessionId)));
  assert.ok(snapshots.some((ids) => !ids.includes(sessionId)));

  started.session.destroy();
  await waitFor(async () => {
    try {
      return (await readFile(shutdownLog, "utf8")).includes(sessionId);
    } catch {
      return false;
    }
  });
});
