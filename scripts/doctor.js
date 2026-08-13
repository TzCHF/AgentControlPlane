import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/core/config.js";
import { CodexAppServerClient } from "../src/core/codex-client.js";

function pass(message) {
  console.log(`[ok] ${message}`);
}

function fail(message) {
  console.error(`[fail] ${message}`);
  process.exitCode = 1;
}

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
}

const major = Number(process.versions.node.split(".")[0]);
if (major >= 22) pass(`Node.js ${process.versions.node}`);
else fail(`Node.js 22 or newer is required; found ${process.versions.node}`);

let config;
try {
  config = loadConfig();
  pass(`Configuration loaded for ${config.server.host}:${config.server.port}`);
} catch (error) {
  fail(`Configuration error: ${error.message}`);
}

if (config) {
  const isExplicitPath = /[\\/]/.test(config.codex.command);
  if (!isExplicitPath || fs.existsSync(config.codex.command)) {
    const version = run(config.codex.command, ["--version"]);
    if (version.status === 0) {
      pass((version.stdout || version.stderr).trim());
    } else {
      fail("Codex executable could not be started");
    }

    const login = run(config.codex.command, ["login", "status"]);
    const loginText = `${login.stdout ?? ""}\n${login.stderr ?? ""}`;
    if (login.status === 0 && /logged in/i.test(loginText)) {
      pass("Codex login is active");
    } else {
      fail("Codex is not logged in; run `codex login`");
    }
  } else {
    fail("Configured Codex executable does not exist");
  }
}

if (config && process.exitCode !== 1) {
  const client = new CodexAppServerClient({
    command: config.codex.command,
    disabledFeatures: config.codex.disabledFeatures,
  });
  try {
    await client.start();
    const models = await client.request("model/list", {
      limit: 100,
      includeHidden: false,
    });
    pass(`Codex app-server advertised ${models.data?.length ?? 0} models`);

    if (process.platform === "win32") {
      const readiness = await client.request("windowsSandbox/readiness", {});
      if (readiness.status === "ready") {
        pass("Codex Windows sandbox is ready");
      } else {
        fail(`Codex Windows sandbox status: ${readiness.status ?? "unknown"}`);
      }
    }
  } catch (error) {
    fail(`Codex app-server check failed: ${error.message}`);
  } finally {
    await client.stop();
  }
}

if (!process.exitCode) {
  console.log("AgentControlPlane is ready for local use.");
}
