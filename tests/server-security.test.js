import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/server.js";
import { TaskStore } from "../src/core/store.js";

class StubCodex extends EventEmitter {
  constructor() {
    super();
    this.ready = true;
  }

  stop() {}
}

class StubOrchestrator {
  getRuntimeHealth() {
    return { windowsSandbox: "ready" };
  }

  getModels() {
    return [];
  }
}

function testConfig(overrides = {}) {
  return {
    server: {
      host: "127.0.0.1",
      port: 0,
      authToken: "test-secret",
      allowedOrigins: ["https://chatgpt.com"],
      maxMcpSessions: 32,
      mcpSessionIdleMinutes: 30,
      ...overrides.server,
    },
    stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "acp-http-state-")),
    limits: { maxStoredEventsPerTask: 20 },
    profiles: {},
    ...overrides,
  };
}

async function withServer(config, callback) {
  const store = new TaskStore(config.stateDir, 20);
  const app = await createApplication({
    config,
    store,
    codex: new StubCodex(),
    orchestrator: new StubOrchestrator(),
    startCodex: false,
  });
  await new Promise((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = app.server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await app.close();
  }
}

test("health stays available without a bearer token", async () => {
  await withServer(testConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.codex_ready, true);
    assert.equal(body.codex_command, undefined);
    assert.equal(body.runtime, undefined);
  });
});

test("OAuth protected resource metadata is public and names the MCP resource", async () => {
  await withServer(testConfig(), async (baseUrl) => {
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.resource, `${baseUrl}/mcp`);
      assert.deepEqual(body.bearer_methods_supported, ["header"]);
    }
  });
});

test("protected routes require a valid bearer token", async () => {
  await withServer(testConfig(), async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/v1/tasks`);
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate"), /^Bearer/);

    const allowed = await fetch(`${baseUrl}/v1/tasks`, {
      headers: { authorization: "Bearer test-secret" },
    });
    assert.equal(allowed.status, 200);
  });
});

test("requests with an unapproved Origin are rejected", async () => {
  await withServer(testConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/tasks`, {
      headers: {
        authorization: "Bearer test-secret",
        origin: "https://attacker.example",
      },
    });
    assert.equal(response.status, 403);
  });
});

test("diagnostics require authentication and include local runtime details", async () => {
  await withServer(
    testConfig({ codex: { command: "C:\\private\\codex.exe" } }),
    async (baseUrl) => {
      const denied = await fetch(`${baseUrl}/v1/diagnostics`);
      assert.equal(denied.status, 401);

      const allowed = await fetch(`${baseUrl}/v1/diagnostics`, {
        headers: { authorization: "Bearer test-secret" },
      });
      assert.equal(allowed.status, 200);
      const body = await allowed.json();
      assert.equal(body.codex_command, "C:\\private\\codex.exe");
      assert.equal(body.runtime.windowsSandbox, "ready");
    },
  );
});
