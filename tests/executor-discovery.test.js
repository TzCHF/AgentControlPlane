import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  discoverExecutor,
  probeCommandExecutor,
  resolveExecutable,
} from "../src/executors/discovery.js";
import { ExecutorAdapter } from "../src/executors/executor.js";

test("resolves the current Node executable from an explicit path", () => {
  assert.equal(resolveExecutable(process.execPath), path.resolve(process.execPath));
});

test("reports a missing command without launching engineering work", async () => {
  const result = await probeCommandExecutor({
    command: "agent-control-plane-command-that-does-not-exist",
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, "command_not_found");
});

test("discovers a CLI without invoking its version command", async () => {
  const result = await probeCommandExecutor({ command: process.execPath });
  assert.equal(result.available, true);
  assert.equal(result.status, "installed");
  assert.equal(result.version, null);
});

test("stores normalized discovery metadata on an executor", async () => {
  class AvailableExecutor extends ExecutorAdapter {
    constructor() {
      super({ id: "available", displayName: "Available" });
    }

    async probe() {
      return { available: true, status: "available", version: "1.0.0" };
    }
  }
  const executor = new AvailableExecutor();
  const result = await discoverExecutor(executor);
  assert.equal(result.available, true);
  assert.equal(executor.describe().discovery.version, "1.0.0");
  assert.match(result.checked_at, /^\d{4}-\d{2}-\d{2}T/);
});
