import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/core/config.js";

test("rejects non-loopback binding without an auth token", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "acp-config-"));
  const configPath = path.join(directory, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      server: {
        host: "0.0.0.0",
        port: 4318,
        allowedOrigins: [],
        maxMcpSessions: 32,
        mcpSessionIdleMinutes: 30,
      },
    }),
  );
  assert.throws(
    () => loadConfig(configPath),
    (error) => error.code === "loopback_required",
  );
});
