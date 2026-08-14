import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  ExecutorAdapter,
  assertExecutor,
  formatCliExitError,
} from "../src/executors/executor.js";
import { normalizeControllerIdentity } from "../src/controllers/controller.js";

test("executor contract accepts compatible implementations", () => {
  class Compatible extends EventEmitter {
    start() {}
    stop() {}
    request() {}
    respond() {}
  }
  const executor = new Compatible();
  assert.equal(assertExecutor(executor), executor);
});

test("executor contract rejects missing methods", () => {
  assert.throws(() => assertExecutor({ start() {} }), /stop/);
  const partial = new EventEmitter();
  partial.stop = () => {};
  assert.throws(
    () => assertExecutor(partial, { execution: true }),
    /start/,
  );
});

test("executor adapter exposes capabilities", () => {
  const executor = new ExecutorAdapter({
    id: "test",
    displayName: "Test",
    capabilities: { tokenUsage: true },
  });
  const description = executor.describe();
  assert.equal(description.id, "test");
  assert.equal(description.capabilities.tokenUsage, true);
  assert.equal(description.capabilities.subagents, false);
});

test("CLI failures include bounded normalized stderr", () => {
  assert.equal(
    formatCliExitError("claude", 1, "\u001b[31mNot logged in\u001b[0m\nRun auth"),
    "claude exited with code 1: Not logged in Run auth",
  );
  assert.ok(formatCliExitError("tool", 2, "x".repeat(1500)).length < 1050);
});

test("controller identity normalizes supported transports", () => {
  assert.deepEqual(
    normalizeControllerIdentity({ id: "chatgpt", kind: "mcp" }),
    { id: "chatgpt", kind: "mcp", model: null },
  );
  assert.throws(
    () => normalizeControllerIdentity({ id: "x", kind: "unknown" }),
    /Unknown controller kind/,
  );
});
