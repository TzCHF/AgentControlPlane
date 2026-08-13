import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RateLimiter } from "../src/core/rate-limit.js";
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
    return {};
  }

  getModels() {
    return [];
  }
}

test("rate limiter enforces a fixed window", () => {
  let clock = 0;
  const limiter = new RateLimiter({ windowMs: 1000, max: 2, now: () => clock });
  assert.equal(limiter.consume("a").allowed, true);
  assert.equal(limiter.consume("a").allowed, true);
  const blocked = limiter.consume("a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.limit, 2);
  clock = 1001;
  assert.equal(limiter.consume("a").allowed, true);
});

test("requests above the limit receive 429 with a retry header", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-rate-"));
  const config = {
    server: {
      host: "127.0.0.1",
      port: 0,
      authToken: null,
      allowedOrigins: [],
      maxMcpSessions: 32,
      mcpSessionIdleMinutes: 30,
    },
    stateDir,
    limits: {
      maxStoredEventsPerTask: 20,
      rateLimit: { enabled: true, windowMs: 60_000, max: 1 },
    },
    audit: {},
    profiles: {},
  };
  const app = await createApplication({
    config,
    store: new TaskStore(stateDir, 20),
    codex: new StubCodex(),
    orchestrator: new StubOrchestrator(),
    startCodex: false,
  });
  await new Promise((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = app.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const first = await fetch(`${baseUrl}/v1/profiles`);
    assert.equal(first.status, 200);
    const second = await fetch(`${baseUrl}/v1/profiles`);
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get("retry-after")) >= 1);
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
  } finally {
    await app.close();
  }
});
