import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { ExecutorAdapter, assertExecutor } from "../src/executors/executor.js";
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
