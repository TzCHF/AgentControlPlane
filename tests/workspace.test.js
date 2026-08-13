import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveWorkspace } from "../src/core/workspace.js";

test("resolveWorkspace allows directories inside configured roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-root-"));
  const child = path.join(root, "project");
  fs.mkdirSync(child);
  assert.equal(resolveWorkspace(child, [root]), fs.realpathSync.native(child));
});

test("resolveWorkspace rejects directories outside configured roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "acp-outside-"));
  assert.throws(
    () => resolveWorkspace(outside, [root]),
    (error) => error.code === "workspace_denied",
  );
});

