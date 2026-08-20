import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/server.js";
import { TaskStore } from "../src/core/store.js";

const ID_A = "aaaa1111-0000-4000-8000-000000000001";
const ID_B = "aaaa2222-0000-4000-8000-000000000002";

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

  getDefaultExecutorId() {
    return "codex";
  }

  getExecutors() {
    return [];
  }
}

function testConfig() {
  return {
    server: {
      host: "127.0.0.1",
      port: 0,
      authToken: null,
      allowedOrigins: [],
      maxMcpSessions: 32,
      mcpSessionIdleMinutes: 30,
    },
    stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "acp-search-state-")),
    limits: { maxStoredEventsPerTask: 20 },
    profiles: {},
    codex: { networkAccess: false },
  };
}

function seedState(stateDir) {
  const createdAt = new Date().toISOString();
  const record = (id, objective, status, summary) => ({
    id,
    parentTaskId: null,
    workspace: "C:\\work",
    brief: { objective },
    policy: { name: "economy" },
    executor: "opencode",
    estimatedMinutes: null,
    status,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    completedAt: null,
    threadId: null,
    turnId: null,
    executorSessionId: null,
    result: summary ? { summary } : null,
    error: null,
    usage: null,
    subagents: [],
    events: [],
  });
  fs.writeFileSync(
    path.join(stateDir, "state.json"),
    JSON.stringify(
      {
        version: 1,
        projects: {},
        tasks: {
          [ID_A]: record(ID_A, "Refactor authentication module", "completed", "Auth module split into services"),
          [ID_B]: record(ID_B, "Create relay smoke file", "failed", null),
        },
      },
      null,
      2,
    ),
  );
}

test("store resolves task ids by prefix and searches by content", () => {
  const config = testConfig();
  seedState(config.stateDir);
  const store = new TaskStore(config.stateDir, 20);

  assert.equal(store.resolveTaskId(ID_A), ID_A);
  assert.equal(store.resolveTaskId("aaaa1111"), ID_A);
  assert.equal(store.resolveTaskId("aaaa"), null);
  assert.equal(store.resolveTaskId("zzzz"), null);

  const byObjective = store.findTasks({ query: "auth module" });
  assert.deepEqual(byObjective.map((task) => task.id), [ID_A]);

  const bySummary = store.findTasks({ query: "services" });
  assert.deepEqual(bySummary.map((task) => task.id), [ID_A]);

  const byStatus = store.findTasks({ status: "failed" });
  assert.deepEqual(byStatus.map((task) => task.id), [ID_B]);

  const byPrefix = store.findTasks({ query: "aaaa1111" });
  assert.deepEqual(byPrefix.map((task) => task.id), [ID_A]);

  const empty = store.findTasks({ query: "nothing matches" });
  assert.deepEqual(empty, []);
});

test("HTTP task list filters by query and resolves id prefixes", async () => {
  const config = testConfig();
  seedState(config.stateDir);
  const store = new TaskStore(config.stateDir, 20);
  const app = await createApplication({
    config,
    store,
    codex: new StubCodex(),
    orchestrator: new StubOrchestrator(),
    startCodex: false,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const filtered = await fetch(`${baseUrl}/v1/tasks?query=auth`);
    assert.equal(filtered.status, 200);
    assert.deepEqual(
      (await filtered.json()).tasks.map((task) => task.id),
      [ID_A],
    );

    const byStatus = await fetch(`${baseUrl}/v1/tasks?status=failed`);
    assert.deepEqual(
      (await byStatus.json()).tasks.map((task) => task.id),
      [ID_B],
    );

    const byPrefix = await fetch(`${baseUrl}/v1/tasks/aaaa1111`);
    assert.equal(byPrefix.status, 200);
    assert.equal((await byPrefix.json()).task.id, ID_A);

    const ambiguous = await fetch(`${baseUrl}/v1/tasks/aaaa`);
    assert.equal(ambiguous.status, 404);
  } finally {
    await app.close();
  }
});

test("MCP search_tasks finds content and task_status accepts prefixes", async () => {
  const config = testConfig();
  seedState(config.stateDir);
  const store = new TaskStore(config.stateDir, 20);
  const app = await createApplication({
    config,
    store,
    codex: new StubCodex(),
    orchestrator: new StubOrchestrator(),
    startCodex: false,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}/mcp`;
  try {
    const init = await fetch(base, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "search-test", version: "0" },
        },
        id: 1,
      }),
    });
    const sessionId = init.headers.get("mcp-session-id");
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    };
    let callId = 2;
    const call = async (name, args) => {
      const response = await fetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name, arguments: args ?? {} },
          id: callId++,
        }),
      });
      const raw = await response.text();
      const parsed = raw
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => {
          try {
            return JSON.parse(line.slice(6));
          } catch {
            return null;
          }
        });
      return parsed.filter(Boolean).at(-1);
    };

    const search = await call("search_tasks", { query: "authentication" });
    assert.ok(search.result.structuredContent);
    assert.deepEqual(
      search.result.structuredContent.tasks.map((task) => task.id),
      [ID_A],
    );

    const status = await call("task_status", { task_id: "aaaa1111" });
    assert.equal(status.result.structuredContent.task.id, ID_A);
    assert.equal(status.result.structuredContent.task.status, "completed");
    assert.equal(
      status.result.structuredContent.task.logical_task_id,
      ID_A,
    );
    assert.ok(
      Array.isArray(status.result.structuredContent.task.executor_history),
    );
    assert.equal(status.result.structuredContent.task.continuation, null);

    const bad = await call("task_status", { task_id: "aaaa" });
    assert.equal(bad.result.isError, true);
  } finally {
    await app.close();
  }
});
