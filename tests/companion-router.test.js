import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/server.js";
import { TaskStore } from "../src/core/store.js";

const origin = `chrome-extension://${"a".repeat(32)}`;

class StubExecutor extends EventEmitter {
  constructor() {
    super();
    this.ready = true;
  }
  stop() {}
}

class CompanionOrchestrator {
  constructor(store) {
    this.store = store;
  }
  getDefaultExecutorId() {
    return "opencode";
  }
  getExecutors() {
    return [{ id: "opencode", ready: true, discovery: { available: true } }];
  }
  getRuntimeHealth() {
    return {};
  }
  getModels() {
    return [];
  }
  dispatch(body) {
    return this.store.createTask({
      workspace: body.workspace,
      brief: { objective: body.objective },
      policy: { name: body.profile ?? "balanced" },
      executor: body.executor ?? "opencode",
    });
  }
  continueTask(parentId, body) {
    const parent = this.store.getTask(parentId);
    return this.store.createTask({
      workspace: parent.workspace,
      brief: { objective: body.objective },
      policy: parent.policy,
      parentTaskId: parentId,
      executor: parent.executor,
    });
  }
  async cancel(id) {
    return this.store.updateTask(id, { status: "cancelled" });
  }
}

function config() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-companion-http-"));
  return {
    server: {
      host: "127.0.0.1",
      port: 0,
      authToken: "admin-secret",
      allowedOrigins: [],
      maxMcpSessions: 32,
      mcpSessionIdleMinutes: 30,
    },
    stateDir,
    workspaceRoots: ["C:\\work"],
    codex: { command: "codex" },
    limits: {
      maxStoredEventsPerTask: 20,
      maxStoredTasks: 100,
      maxAuditBytes: 1024 * 1024,
      rateLimit: { enabled: false },
    },
    profiles: {
      balanced: {
        model: "test",
        effort: "medium",
        maxSubagents: 0,
        tokenBudget: 5000,
        summary: "concise",
      },
    },
  };
}

async function withCompanionServer(callback) {
  const runtimeConfig = config();
  const store = new TaskStore(runtimeConfig.stateDir, 20);
  const app = await createApplication({
    config: runtimeConfig,
    store,
    executor: new StubExecutor(),
    orchestrator: new CompanionOrchestrator(store),
    startCodex: false,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    await callback({ baseUrl, store });
  } finally {
    await app.close();
  }
}

async function pair(baseUrl) {
  const startedResponse = await fetch(`${baseUrl}/v1/companion/pairings`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ label: "Test companion" }),
  });
  assert.equal(startedResponse.status, 201);
  assert.equal(startedResponse.headers.get("access-control-allow-origin"), origin);
  const started = await startedResponse.json();

  const approval = await fetch(started.approval_url);
  assert.equal(approval.status, 200);
  assert.match(
    await approval.text(),
    new RegExp(`${started.code.slice(0, 3)}-${started.code.slice(3)}`),
  );
  const approved = await fetch(started.approval_url, {
    method: "POST",
    headers: { origin: baseUrl },
  });
  assert.equal(approved.status, 200);

  const claimResponse = await fetch(
    `${baseUrl}/v1/companion/pairings/${started.pairing_id}`,
    {
      headers: {
        origin,
        "x-acp-pairing-secret": started.pairing_secret,
      },
    },
  );
  assert.equal(claimResponse.status, 200);
  return (await claimResponse.json()).token;
}

test("pairs, dispatches, reads, follows up, and cancels scoped tasks", async () => {
  await withCompanionServer(async ({ baseUrl }) => {
    const token = await pair(baseUrl);
    const headers = {
      origin,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const options = await fetch(`${baseUrl}/v1/companion/options`, { headers });
    assert.equal(options.status, 200);
    assert.equal((await options.json()).default_executor, "opencode");

    const dispatchedResponse = await fetch(`${baseUrl}/v1/companion/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace: "C:\\work\\project",
        objective: "Create hello.txt",
        profile: "balanced",
      }),
    });
    assert.equal(dispatchedResponse.status, 202);
    const dispatched = (await dispatchedResponse.json()).task;
    assert.equal(dispatched.status, "queued");

    const status = await fetch(
      `${baseUrl}/v1/companion/tasks/${dispatched.id}`,
      { headers },
    );
    assert.equal(status.status, 200);
    assert.equal((await status.json()).task.id, dispatched.id);

    const followUp = await fetch(
      `${baseUrl}/v1/companion/tasks/${dispatched.id}/follow-up`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ objective: "Verify hello.txt" }),
      },
    );
    assert.equal(followUp.status, 202);
    const child = (await followUp.json()).task;
    assert.equal(child.parent_task_id, dispatched.id);

    const cancelled = await fetch(
      `${baseUrl}/v1/companion/tasks/${child.id}/cancel`,
      { method: "POST", headers },
    );
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).task.status, "cancelled");

    const disconnected = await fetch(`${baseUrl}/v1/companion/session`, {
      method: "DELETE",
      headers,
    });
    assert.equal(disconnected.status, 200);
    const afterDisconnect = await fetch(`${baseUrl}/v1/companion/options`, {
      headers,
    });
    assert.equal(afterDisconnect.status, 401);
  });
});

test("rejects web origins and unpaired companion requests", async () => {
  await withCompanionServer(async ({ baseUrl }) => {
    const webOrigin = await fetch(`${baseUrl}/v1/companion/pairings`, {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(webOrigin.status, 403);

    const unpaired = await fetch(`${baseUrl}/v1/companion/options`, {
      headers: { origin },
    });
    assert.equal(unpaired.status, 401);

    const invalidJson = await fetch(`${baseUrl}/v1/companion/pairings`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{",
    });
    assert.equal(invalidJson.status, 400);
    assert.equal(
      invalidJson.headers.get("access-control-allow-origin"),
      origin,
    );
  });
});
