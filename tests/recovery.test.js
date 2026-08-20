import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";

class RecoveryCodex extends EventEmitter {
  async start() {}

  async request(method) {
    if (method === "model/list") {
      return { data: [] };
    }
    if (method === "windowsSandbox/readiness") {
      return { status: "ready" };
    }
    if (method === "thread/resume") {
      return {
        thread: {
          turns: [
            {
              id: "recovered-turn",
              status: "failed",
              error: { message: "network unavailable" },
              items: [],
            },
          ],
        },
      };
    }
    return {};
  }

  respond() {}

  listModels(params) {
    return this.request("model/list", params);
  }

  getSandboxReadiness(params) {
    return this.request("windowsSandbox/readiness", params);
  }

  startThread(params) {
    return this.request("thread/start", params);
  }

  resumeThread(params) {
    return this.request("thread/resume", params);
  }

  setGoal(params) {
    return this.request("thread/goal/set", params);
  }

  getGoal(params, timeoutMs) {
    return this.request("thread/goal/get", params, timeoutMs);
  }

  startTurn(params) {
    return this.request("turn/start", params);
  }

  interruptTurn(params, timeoutMs) {
    return this.request("turn/interrupt", params, timeoutMs);
  }
}

class RecoveryRerouteExecutor extends EventEmitter {
  constructor(id, { recoveredTurn = null, complete = false } = {}) {
    super();
    this.id = id;
    this.kind = "cli";
    this.ready = false;
    this.recoveredTurn = recoveredTurn;
    this.complete = complete;
    this.discovery = { available: null, status: "unknown" };
    this.capabilities = { persistentThreads: true, tokenUsage: true };
  }

  async probe() {
    return { available: true, status: "available", reason: null };
  }

  setDiscovery(result) {
    this.discovery = result;
    return result;
  }

  async start() {
    this.ready = true;
  }

  async stop() {}
  respond() {}
  async listModels() { return { data: [] }; }
  async getSandboxReadiness() { return { status: "ready" }; }
  async setGoal() { return {}; }
  async getGoal() { return { goal: null }; }
  async interruptTurn() { return {}; }

  async resumeThread({ threadId }) {
    return {
      thread: {
        id: threadId,
        turns: this.recoveredTurn ? [this.recoveredTurn] : [],
      },
    };
  }

  async startThread() {
    return { thread: { id: `${this.id}-thread` } };
  }

  async startTurn(params) {
    const turn = { id: `${this.id}-turn`, status: "completed" };
    if (this.complete) {
      queueMicrotask(() => {
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: params.threadId,
            turn: {
              ...turn,
              items: [
                {
                  type: "agentMessage",
                  phase: "final_answer",
                  text: JSON.stringify({
                    status: "completed",
                    summary: `${this.id} recovered the task`,
                    changed_files: [],
                    tests: ["recovery passed"],
                    blockers: [],
                    next_action: null,
                  }),
                },
              ],
            },
          },
        });
      });
    }
    return { turn };
  }
}

function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error("Timed out waiting for recovery"));
      }
      setTimeout(check, 5);
    };
    check();
  });
}

test("reconciles a stale running task from persisted Codex history", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-recovery-"));
  const store = new TaskStore(stateDir);
  const task = store.createTask({
    workspace: "C:\\workspace",
    brief: { objective: "test" },
    policy: { name: "economy" },
    executor: "codex",
  });
  store.updateTask(task.id, {
    status: "running",
    threadId: "thread-1",
    turnId: "old-turn",
  });

  const config = {
    limits: { maxConcurrentTasks: 1 },
  };
  const orchestrator = new Orchestrator({
    config,
    store,
    codex: new RecoveryCodex(),
  });
  await orchestrator.start();

  const recovered = store.getTask(task.id, true);
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.turnId, "recovered-turn");
  assert.equal(recovered.error.message, "network unavailable");
  assert.equal(recovered.events.at(-1).type, "task.recovered");
  assert.equal(recovered.executor_history[0].turn_id, "recovered-turn");
  assert.ok(recovered.executor_history[0].ended_at);
});

test("recovery reroutes an infrastructure failure and preserves the task lineage", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-recovery-ws-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-recovery-route-"));
  const store = new TaskStore(stateDir);
  const task = store.createTask({
    workspace,
    brief: {
      objective: "recover after quota",
      constraints: [],
      acceptanceCriteria: [],
      context: [],
      evidenceRequired: [],
    },
    policy: {
      name: "economy",
      model: null,
      effort: "low",
      maxSubagents: 0,
      tokenBudget: 30000,
      summary: "concise",
      timeLimitMinutes: 1,
    },
    executor: "a",
    capabilityRequirements: { tools: true },
  });
  store.updateTask(task.id, {
    status: "running",
    threadId: "a-thread",
    turnId: "a-old-turn",
  });

  const executors = new Map([
    [
      "a",
      new RecoveryRerouteExecutor("a", {
        recoveredTurn: {
          id: "a-recovered-turn",
          status: "failed",
          error: {
            code: "usage_limit_exceeded",
            message: "You've hit your usage limit",
          },
          items: [],
        },
      }),
    ],
    ["b", new RecoveryRerouteExecutor("b", { complete: true })],
  ]);
  const config = {
    workspaceRoots: [path.dirname(workspace)],
    executor: {
      provider: "auto",
      routing: { order: ["a", "b"] },
      reroute: {
        enabled: true,
        max_reroutes: 2,
        allowed_reasons: ["quota_exhausted"],
      },
    },
    codex: {
      approvalPolicy: "never",
      sandbox: "workspace-write",
      networkAccess: false,
    },
    profiles: {
      economy: {
        model: null,
        effort: "low",
        maxSubagents: 0,
        tokenBudget: 30000,
        summary: "concise",
      },
    },
    limits: {
      maxConcurrentTasks: 1,
      maxTaskRuntimeMinutes: 1,
      tokenUsagePollIntervalMs: 250,
    },
  };
  const orchestrator = new Orchestrator({
    config,
    store,
    executors,
    defaultProvider: "auto",
  });
  await orchestrator.start();
  await waitFor(() => store.getTask(task.id)?.status === "completed");

  const completed = store.getTask(task.id, true);
  assert.equal(completed.id, task.id);
  assert.equal(completed.logical_task_id, task.id);
  assert.equal(completed.executor, "b");
  assert.equal(completed.reroute_reason, "quota_exhausted");
  assert.deepEqual(
    completed.executor_history.map((entry) => entry.executor),
    ["a", "b"],
  );
  assert.ok(completed.events.some((event) => event.type === "task.recovered"));
  assert.ok(completed.events.some((event) => event.type === "task.rerouted"));
});
