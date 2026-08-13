import assert from "node:assert/strict";
import test from "node:test";
import { CodexExecutor } from "../src/executors/codex-executor.js";
import {
  AGENT_LIFECYCLE_METHODS,
  assertLifecycle,
} from "../src/executors/lifecycle.js";

test("CodexExecutor satisfies the agent lifecycle contract", () => {
  const executor = new CodexExecutor({ command: "codex" });
  assert.equal(assertLifecycle(executor), executor);
  for (const method of AGENT_LIFECYCLE_METHODS) {
    assert.equal(typeof executor[method], "function", `missing ${method}()`);
  }
});

test("lifecycle contract rejects an incomplete executor", () => {
  const partial = {
    listModels() {},
    getSandboxReadiness() {},
    startThread() {},
    resumeThread() {},
    setGoal() {},
    getGoal() {},
    startTurn() {},
  };
  assert.throws(() => assertLifecycle(partial), /interruptTurn/);
});
