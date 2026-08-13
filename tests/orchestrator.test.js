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
