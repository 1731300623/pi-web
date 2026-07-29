import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

test("session shutdown notifies extensions before disposing the SDK session", async () => {
  const calls = [];
  const inner = {
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
      },
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push(["destroy"]));

  await Promise.all([wrapper.shutdown(), wrapper.shutdown()]);

  assert.deepEqual(calls, [
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
    ["destroy"],
  ]);
  assert.equal(wrapper.isAlive(), false);
});

test("session shutdown still disposes the SDK session when an extension fails", async () => {
  const calls = [];
  const inner = {
    extensionRunner: {
      async emit() {
        calls.push("emit");
        throw new Error("shutdown hook failed");
      },
    },
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner);

  await assert.rejects(wrapper.shutdown(), /shutdown hook failed/);

  assert.deepEqual(calls, ["emit", "dispose"]);
  assert.equal(wrapper.isAlive(), false);
});

test("fork persists an empty child session before its worker shuts down", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-fork-persist-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const manager = SessionManager.create(root, root);
  manager.newSession();
  const entryId = manager.appendMessage({
    role: "user",
    content: "first message",
    timestamp: Date.now(),
  });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "response" }],
    api: "anthropic-messages",
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });

  const originalFile = manager.getSessionFile();
  assert.ok(originalFile);

  const inner = {
    sessionManager: manager,
    sessionFile: originalFile,
    isBashRunning: false,
    extensionRunner: { async emit() {} },
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  const result = await wrapper.send({ type: "fork", entryId });

  assert.equal(result.cancelled, false);
  assert.notEqual(result.newSessionId, manager.getSessionId());

  const files = await readdir(root);
  const childName = files.find((name) => name.includes(result.newSessionId));
  assert.ok(childName);
  const [header, ...entries] = (await readFile(join(root, childName), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(header.id, result.newSessionId);
  assert.equal(header.parentSession, originalFile);
  assert.deepEqual(entries, []);
});
