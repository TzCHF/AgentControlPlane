import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";

class FakeCodex extends EventEmitter {
  constructor() {
    super();
    this.ready = false;
    this.requests = [];
  }

  async start() {
    this.ready = true;
  }

  async request(method, params) {
    this.requests.push({ method, params });
    if (method === "thread/start") {
      return { thread: { id: "thread-1" } };
    }
    if (method === "model/list") {
      return {
        data: [
          {
            id: "fake-model",
            model: "fake-model",
            isDefault: true,
            supportedReasoningEfforts: [
              { reasoningEffort: "medium" },
            ],
          },
        ],
      };
    }
    if (method === "windowsSandbox/readiness") {
      return { status: "ready" };
    }
    if (method === "turn/start") {
      queueMicrotask(() => {
        this.emit("notification", {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            tokenUsage: {
              last: {
                inputTokens: 20,
                cachedInputTokens: 10,
                outputTokens: 5,
                reasoningOutputTokens: 3,
                totalTokens: 25,
              },
              total: {
                inputTokens: 20,
                cachedInputTokens: 10,
                outputTokens: 5,
                reasoningOutputTokens: 3,
                totalTokens: 25,
              },
            },
          },
        });
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: {
              id: "turn-1",
              status: "completed",
              items: [
                {
                  type: "agentMessage",
                  phase: "final_answer",
                  text: JSON.stringify({
                    status: "completed",
                    summary: "Done",
                    changed_files: ["a.js"],
                    tests: [],
                    blockers: [],
                    next_action: null,
                  }),
                },
              ],
            },
          },
        });
      });
      return { turn: { id: "turn-1" } };
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

function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error("Timed out"));
      }
      setTimeout(check, 5);
    };
    check();
  });
}

test("dispatches a compact task and records measured usage", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-workspace-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-state-"));
  const config = {
    workspaceRoots: [path.dirname(workspace)],
    codex: {
      approvalPolicy: "never",
      sandbox: "workspace-write",
      networkAccess: false,
      defaultModel: null,
    },
    profiles: {
      economy: {
        model: "fake-model",
        effort: "medium",
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
  const store = new TaskStore(stateDir, 20);
  const codex = new FakeCodex();
  const orchestrator = new Orchestrator({ config, store, codex });
  await orchestrator.start();

  const task = orchestrator.dispatch({
    workspace,
    objective: "Create a file",
    profile: "economy",
  });
  await waitFor(() => store.getTask(task.id)?.status === "completed");

  const completed = store.getTask(task.id);
  assert.equal(completed.result.summary, "Done");
  assert.equal(completed.usage.total_tokens, 25);
  assert.equal(
    codex.requests.find((entry) => entry.method === "thread/goal/set").params
      .tokenBudget,
    30000,
  );
});

test("cancelling a queued task prevents it from starting", async () => {
  const workspaceA = fs.mkdtempSync(path.join(os.tmpdir(), "acp-workspace-a-"));
  const workspaceB = fs.mkdtempSync(path.join(os.tmpdir(), "acp-workspace-b-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-state-"));
  class SlowCodex extends FakeCodex {
    async request(method, params) {
      this.requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: `thread-${this.requests.length}` } };
      if (method === "model/list") {
        return {
          data: [{
            id: "fake-model",
            model: "fake-model",
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
          }],
        };
      }
      if (method === "windowsSandbox/readiness") return { status: "ready" };
      if (method === "turn/start") return { turn: { id: `turn-${this.requests.length}` } };
      return {};
    }
  }
  const config = {
    workspaceRoots: [path.dirname(workspaceA)],
    codex: {
      approvalPolicy: "never",
      sandbox: "workspace-write",
      networkAccess: false,
      defaultModel: null,
    },
    profiles: {
      economy: {
        model: "fake-model",
        effort: "medium",
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
  const store = new TaskStore(stateDir, 20);
  const codex = new SlowCodex();
  const orchestrator = new Orchestrator({ config, store, codex });
  await orchestrator.start();
  const first = orchestrator.dispatch({
    workspace: workspaceA,
    objective: "Hold the slot",
    profile: "economy",
  });
  await waitFor(() => store.getTask(first.id)?.status === "running");
  const second = orchestrator.dispatch({
    workspace: workspaceB,
    objective: "Must never start",
    profile: "economy",
  });
  await orchestrator.cancel(second.id);
  assert.equal(store.getTask(second.id).status, "cancelled");
  assert.equal(
    codex.requests.filter((entry) => entry.method === "turn/start").length,
    1,
  );
  await orchestrator.cancel(first.id);
});

test("records usage from thread goal when token notifications are unavailable", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-workspace-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-state-"));
  class GoalUsageCodex extends FakeCodex {
    async request(method, params) {
      this.requests.push({ method, params });
      if (method === "model/list") {
        return {
          data: [{
            id: "fake-model",
            model: "fake-model",
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
          }],
        };
      }
      if (method === "windowsSandbox/readiness") return { status: "ready" };
      if (method === "thread/start") return { thread: { id: "thread-goal" } };
      if (method === "thread/goal/get") {
        return {
          goal: {
            threadId: "thread-goal",
            status: "complete",
            tokenBudget: 30000,
            tokensUsed: 4321,
          },
        };
      }
      if (method === "turn/start") {
        queueMicrotask(() => {
          this.emit("notification", {
            method: "turn/completed",
            params: {
              threadId: "thread-goal",
              turn: {
                id: "turn-goal",
                status: "completed",
                items: [{
                  type: "agentMessage",
                  phase: "final_answer",
                  text: JSON.stringify({
                    status: "completed",
                    summary: "Done from goal usage",
                    changed_files: [],
                    tests: [],
                    blockers: [],
                    next_action: null,
                  }),
                }],
              },
            },
          });
        });
        return { turn: { id: "turn-goal" } };
      }
      return {};
    }
  }
  const config = {
    workspaceRoots: [path.dirname(workspace)],
    codex: {
      approvalPolicy: "never",
      sandbox: "workspace-write",
      networkAccess: false,
      defaultModel: null,
    },
    profiles: {
      economy: {
        model: "fake-model",
        effort: "medium",
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
      tokenUsagePollIntervalMs: 10,
    },
  };
  const store = new TaskStore(stateDir, 20);
  const codex = new GoalUsageCodex();
  const orchestrator = new Orchestrator({ config, store, codex });
  await orchestrator.start();

  const task = orchestrator.dispatch({
    workspace,
    objective: "Measure usage",
    profile: "economy",
  });
  await waitFor(() => store.getTask(task.id)?.status === "completed");

  const completed = store.getTask(task.id);
  assert.equal(completed.usage.total_tokens, 4321);
  assert.equal(store.usageReport().total_tokens, 4321);
  assert.ok(
    codex.requests.some((entry) => entry.method === "thread/goal/get"),
  );
});

test("interrupts a task when goal usage reaches the hard token budget", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-workspace-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-state-"));
  class BudgetCodex extends FakeCodex {
    async request(method, params) {
      this.requests.push({ method, params });
      if (method === "model/list") {
        return {
          data: [{
            id: "fake-model",
            model: "fake-model",
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
          }],
        };
      }
      if (method === "windowsSandbox/readiness") return { status: "ready" };
      if (method === "thread/start") return { thread: { id: "thread-budget" } };
      if (method === "thread/goal/get") {
        return {
          goal: {
            threadId: "thread-budget",
            status: "budgetLimited",
            tokenBudget: 5000,
            tokensUsed: 5100,
          },
        };
      }
      if (method === "turn/start") {
        return { turn: { id: "turn-budget" } };
      }
      if (method === "turn/interrupt") {
        queueMicrotask(() => {
          this.emit("notification", {
            method: "turn/completed",
            params: {
              threadId: "thread-budget",
              turn: {
                id: "turn-budget",
                status: "interrupted",
                items: [],
              },
            },
          });
        });
        return {};
      }
      return {};
    }
  }
  const config = {
    workspaceRoots: [path.dirname(workspace)],
    codex: {
      approvalPolicy: "never",
      sandbox: "workspace-write",
      networkAccess: false,
      defaultModel: null,
    },
    profiles: {
      economy: {
        model: "fake-model",
        effort: "medium",
        maxSubagents: 0,
        tokenBudget: 5000,
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
      tokenUsagePollIntervalMs: 10,
    },
  };
  const store = new TaskStore(stateDir, 20);
  const codex = new BudgetCodex();
  const orchestrator = new Orchestrator({ config, store, codex });
  await orchestrator.start();

  const task = orchestrator.dispatch({
    workspace,
    objective: "Stop at budget",
    profile: "economy",
  });
  await waitFor(() => store.getTask(task.id)?.status === "interrupted");

  const completed = store.getTask(task.id, true);
  assert.equal(completed.usage.total_tokens, 5100);
  assert.equal(completed.error.code, "token_budget_exceeded");
  assert.equal(
    codex.requests.filter((entry) => entry.method === "turn/interrupt").length,
    1,
  );
  assert.ok(
    completed.events.some(
      (event) => event.type === "task.token_budget_exceeded",
    ),
  );
});
