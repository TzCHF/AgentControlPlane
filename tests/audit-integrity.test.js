import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../src/core/store.js";

function digest(value, key) {
  if (key) {
    return crypto.createHmac("sha256", key).update(value).digest("hex");
  }
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readAuditLines(stateDir) {
  const files = ["audit.jsonl.1", "audit.jsonl"].map((name) =>
    path.join(stateDir, name),
  );
  return files
    .filter((file) => fs.existsSync(file))
    .flatMap((file) =>
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0),
    );
}

test("audit entries form a hash chain", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-audit-"));
  const store = new TaskStore(stateDir, 20, 2000, 10 * 1024 * 1024, null);
  store.audit("task.created", { taskId: "1", workspace: "w" });
  store.audit("task.completed", { taskId: "1" });
  const lines = readAuditLines(stateDir);
  assert.equal(lines.length, 2);
  const [a, b] = lines.map(JSON.parse);
  assert.equal(a.seq, 1);
  assert.equal(a.prev, null);
  assert.equal(b.seq, 2);
  assert.equal(b.prev, a.h);
  for (const line of lines) {
    const { h, ...rest } = JSON.parse(line);
    assert.equal(digest(JSON.stringify(rest), null), h);
  }
});

test("audit chain restores across restarts", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-audit2-"));
  const first = new TaskStore(stateDir, 20, 2000, 10 * 1024 * 1024, null);
  first.audit("task.created", { taskId: "a" });
  const second = new TaskStore(stateDir, 20, 2000, 10 * 1024 * 1024, null);
  second.audit("task.completed", { taskId: "a" });
  const lines = readAuditLines(stateDir);
  assert.equal(lines.length, 2);
  const [a, b] = lines.map(JSON.parse);
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.equal(b.prev, a.h);
});

test("audit integrity uses HMAC when a key is provided", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-audit3-"));
  const store = new TaskStore(stateDir, 20, 2000, 10 * 1024 * 1024, "secret-key");
  store.audit("task.created", { taskId: "x" });
  const [line] = readAuditLines(stateDir);
  const { h, ...rest } = JSON.parse(line);
  assert.equal(digest(JSON.stringify(rest), "secret-key"), h);
  assert.notEqual(digest(JSON.stringify(rest), null), h);
});
