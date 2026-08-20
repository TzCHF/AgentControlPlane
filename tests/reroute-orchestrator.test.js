import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";

class RerouteExecutor extends EventEmitter {
  constructor(id, behavior = "success") {
    super();
    this.id = id;
    this.behavior = behavior;
    this.kind = "cli";
    this.ready = false;
    this.capabilities = { persistentThreads: true, tokenUsage: true };
    this.discovery = { available: null, status: "unknown" };
    this.turnStarts = [];
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
  async resumeThread({ threadId }) { return { thread: { id: threadId } }; }
  async setGoal() { return {}; }
  async getGoal() { return { goal: null }; }
  async interruptTurn() { return {}; }

  async startThread() {
    return { thread: { id: `${this.id}-thread-${this.turnStarts.length + 1}` } };
  }

  async startTurn(params) {
    this.turnStarts.push(params);
    if (this.behavior === "quota") {
      const error = new Error("insufficient balance");
      error.status = 402;
      error.code = "insufficient_balance";
      throw error;
    }
    const turnId = `${this.id}-turn-${this.turnStarts.length}`;
    queueMicrotask(() => {
      const taskFailure = this.behavior === "task-failure";
      this.emit("notification", {
        method: "turn/completed",
        params: {
          threadId: params.threadId,
          turn: {
            id: turnId,
            status: taskFailure ? "failed" : "completed",
            error: taskFailure
              ? { code: "implementation_failed", message: "build failed" }
              : null,
            items: [
              {
                type: "agentMessage",
                phase: "final_answer",
                text: JSON.stringify({
                  status: taskFailure ? "failed" : "completed",
                  summary: taskFailure ? "Implementation failed" : `${this.id} done`,
                  changed_files: [],
                  tests: taskFailure ? ["npm test failed"] : ["npm test passed"],
                  blockers: taskFailure ? ["build failed"] : [],
                  next_action: null,
                }),
              },
            ],
          },
        },
      });
    });
    return { turn: { id: turnId } };
  }
}

function configFor(workspace, order, reroute = {}) {
  return {
    workspaceRoots: [path.dirname(workspace)],
    executor: {
      provider: "auto",
      routing: { order },
      reroute: {
        enabled: true,
        max_reroutes: 2,
        allowed_reasons: [
          "quota_exhausted",
          "rate_limited",
          "executor_unavailable",
          "authentication_unavailable",
          "provider_unavailable",
        ],
        ...reroute,
      },
    },
    codex: {
      approvalPolicy: "never",
      sandbox: "workspace-write",
      networkAccess: false,
      defaultModel: null,
    },
    profiles: {
      economy: {
        model: "fake-model",
        effort: "low",
        maxSubagents: 0,
        tokenBudget: 30000,
        summary: "concise",
      },
    },
    limits: {
      maxBriefCharacters: 24000,
      maxConcurrentTasks: 1,
      maxQueuedTasks: 10,
      maxTokenBudget: 250000,
      maxStoredEventsPerTask: 20,
      maxTaskRuntimeMinutes: 1,
    },
  };
}

function waitFor(predicate, timeoutMs = 1500) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("Timed out"));
      setTimeout(check, 5);
    };
    check();
  });
}

async function setup(behaviors, reroute = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-reroute-ws-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-reroute-state-")),
    50,
  );
  const executors = new Map(
    Object.entries(behaviors).map(([id, behavior]) => [
      id,
      new RerouteExecutor(id, behavior),
    ]),
  );
  const orchestrator = new Orchestrator({
    config: configFor(workspace, [...executors.keys()], reroute),
    store,
    executors,
    defaultProvider: "auto",
  });
  await orchestrator.start();
  return { workspace, store, executors, orchestrator };
}

test("quota failure reroutes to a compatible executor on the same logical task", async () => {
  const { workspace, store, orchestrator } = await setup({ a: "quota", b: "success" });
  const task = orchestrator.dispatch({
    workspace,
    executor: "a",
    objective: "Create a file",
    profile: "economy",
  });
  await waitFor(() => store.getTask(task.id)?.status === "completed");
  const completed = store.getTask(task.id, true);
  assert.equal(completed.id, task.id);
  assert.equal(completed.logical_task_id, task.id);
  assert.equal(completed.executor, "b");
  assert.equal(completed.reroute_reason, "quota_exhausted");
  assert.equal(completed.continuation.previous_executor, "a");
  assert.deepEqual(completed.executor_history.map((entry) => entry.executor), ["a", "b"]);
  assert.ok(completed.events.some((entry) => entry.type === "task.rerouted"));
});

test("reroutable failure blocks when no compatible candidate exists", async () => {
  const { workspace, store, orchestrator } = await setup({ a: "quota" });
  const task = orchestrator.dispatch({ workspace, executor: "a", objective: "x", profile: "economy" });
  await waitFor(() => store.getTask(task.id)?.status === "blocked");
  assert.equal(store.getTask(task.id).error.code, "no_compatible_executor");
});

test("reroute cap blocks without acquiring another executor", async () => {
  const { workspace, store, orchestrator } = await setup(
    { a: "quota", b: "success" },
    { max_reroutes: 0 },
  );
  const task = orchestrator.dispatch({ workspace, executor: "a", objective: "x", profile: "economy" });
  await waitFor(() => store.getTask(task.id)?.status === "blocked");
  const blocked = store.getTask(task.id);
  assert.equal(blocked.error.code, "reroute_limit_reached");
  assert.equal(blocked.executor_history.length, 1);
});

test("implementation failures never switch executors", async () => {
  const { workspace, store, orchestrator } = await setup({ a: "task-failure", b: "success" });
  const task = orchestrator.dispatch({ workspace, executor: "a", objective: "x", profile: "economy" });
  await waitFor(() => store.getTask(task.id)?.status === "failed");
  const failed = store.getTask(task.id);
  assert.equal(failed.executor, "a");
  assert.equal(failed.executor_history.length, 1);
});

test("continue_project can start a compatible executor on the same lineage", async () => {
  const { workspace, store, orchestrator } = await setup({ a: "success", b: "success" });
  const root = orchestrator.dispatch({ workspace, executor: "a", objective: "root", profile: "economy" });
  await waitFor(() => store.getTask(root.id)?.status === "completed");
  const child = orchestrator.continueTask(root.id, {
    objective: "continue",
    executor: "b",
    profile: "economy",
  });
  await waitFor(() => store.getTask(child.id)?.status === "completed");
  const completed = store.getTask(child.id);
  assert.equal(completed.logical_task_id, root.id);
  assert.equal(completed.parentTaskId, root.id);
  assert.equal(completed.executor, "b");
  assert.deepEqual(completed.executor_history.map((entry) => entry.executor), ["a", "b"]);
  assert.match(completed.threadId, /^b-thread-/);
});
