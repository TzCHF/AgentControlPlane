import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/server.js";
import { TaskStore } from "../src/core/store.js";
import {
  DASHBOARD_STRINGS,
  dashboardHtml,
} from "../src/dashboard.js";

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
      ...overrides.server,
    },
    stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "acp-dash-state-")),
    limits: { maxStoredEventsPerTask: 20 },
    profiles: {},
    version: "9.9.9-test",
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

test("dashboard strings have matching zh and en keys", () => {
  const zhKeys = Object.keys(DASHBOARD_STRINGS.zh).sort();
  const enKeys = Object.keys(DASHBOARD_STRINGS.en).sort();
  assert.deepEqual(enKeys, zhKeys);
  for (const key of zhKeys) {
    assert.ok(DASHBOARD_STRINGS.zh[key], `zh.${key} is non-empty`);
    assert.ok(DASHBOARD_STRINGS.en[key], `en.${key} is non-empty`);
  }
});

test("dashboardHtml embeds version and defaults to Chinese", () => {
  const html = dashboardHtml({
    version: "9.9.9-test",
    server: { host: "127.0.0.1", port: 4318 },
    stateDir: "C:\\state",
  });
  assert.match(html, /<html lang="zh">/);
  assert.match(html, /本地面板/);
  assert.match(html, /9\.9\.9-test/);
  assert.match(html, /local panel/);
  assert.match(html, /谱系 \{id\}/);
  assert.match(html, /Executor path \{path\}/);
  assert.match(html, /task\.executor_history/);
  assert.match(html, /task\.logical_task_id/);
  assert.match(html, /task\.reroute_reason/);
  assert.ok(!html.includes("https://"), "page carries no external URLs");
  assert.ok(!html.includes("http://"), "page carries no external URLs");
});

test("GET / serves the panel without a bearer token", async () => {
  await withServer(testConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/html/);
    assert.ok(response.headers.get("content-security-policy").length > 0);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    const body = await response.text();
    assert.match(body, /<html lang="zh">/);
    assert.match(body, /本地面板/);
    assert.match(body, /9\.9\.9-test/);
  });
});

test("GET /dashboard serves the same panel", async () => {
  await withServer(testConfig(), async (baseUrl) => {
    const root = await (await fetch(`${baseUrl}/`)).text();
    const alias = await (await fetch(`${baseUrl}/dashboard`)).text();
    assert.equal(alias, root);
  });
});

test("panel stays public while data endpoints require the token", async () => {
  await withServer(testConfig(), async (baseUrl) => {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    const data = await fetch(`${baseUrl}/v1/tasks`);
    assert.equal(data.status, 401);
  });
});
