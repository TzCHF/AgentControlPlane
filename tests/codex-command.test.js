import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCodexCommand } from "../src/core/config.js";

test("preserves explicit Codex command paths", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "acp-codex-"));
  const explicit = path.join(directory, "codex.exe");
  fs.writeFileSync(explicit, "");
  assert.equal(resolveCodexCommand(explicit), fs.realpathSync.native(explicit));
});
