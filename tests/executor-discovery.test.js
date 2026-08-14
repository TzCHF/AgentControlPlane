import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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

test(
  "resolves a Windows npm cmd shim to its underlying executable",
  { skip: process.platform !== "win32" },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-shim-"));
    const target = path.join(root, "node_modules", "tool", "bin", "tool.exe");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "placeholder");
    fs.writeFileSync(
      path.join(root, "tool.cmd"),
      '@ECHO off\r\n"%dp0%\\node_modules\\tool\\bin\\tool.exe" %*\r\n',
    );
    assert.equal(resolveExecutable("tool", root), fs.realpathSync.native(target));
  },
);

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
