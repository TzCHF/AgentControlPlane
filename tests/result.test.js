import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";

class FinalMessageCodex extends EventEmitter {
  async start() {}

  async request(method) {
    if (method === "model/list") {
      return {
        data: [
          {
            id: "fake-model",
            model: "fake-model",
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          },
        ],
      };
    }
    if (method === "windowsSandbox/readiness") return { status: "ready" };
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") {
      setImmediate(() => {
        this.emit("notification", {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            item: {
              type: "agentMessage",
              phase: "final_answer",
              text: "Status: Blocked\n\nThe sandbox helper is unavailable.",
            },
          },
        });
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: { id: "turn-1", status: "completed", items: [] },
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

class FailedTurnCodex extends EventEmitter {
  async start() {}

  async request(method) {
    if (method === "model/list") {
      return {
        data: [
          {
            id: "fake-model",
            model: "fake-model",
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          },
        ],
      };
    }
    if (method === "windowsSandbox/readiness") return { status: "ready" };
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") {
      setImmediate(() => {
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: {
              id: "turn-1",
              status: "failed",
              items: [],
              error: {
                message:
                  "OpenAI-compatible endpoint returned 503: model route inactive",
              },
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

function resultTestConfig(workspace) {
  return {
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
        effort: "low",
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
}

test("failed turns surface the executor error in the result summary", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-result-work-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-result-state-")),
  );
  const orchestrator = new Orchestrator({
    config: resultTestConfig(workspace),
    store,
    codex: new FailedTurnCodex(),
  });
  await orchestrator.start();
  const task = orchestrator.dispatch({
    workspace,
    objective: "Inspect a file",
    profile: "economy",
  });
  const deadline = Date.now() + 1000;
  while (["queued", "running"].includes(store.getTask(task.id).status)) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const finished = store.getTask(task.id);
  assert.equal(finished.status, "failed");
  assert.match(finished.result.summary, /503: model route inactive/);
  assert.match(finished.error.message, /503/);
});

test("uses cached final messages and preserves blocked status", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-result-work-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-result-state-")),
  );
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
        effort: "low",
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
  const orchestrator = new Orchestrator({
    config,
    store,
    codex: new FinalMessageCodex(),
  });
  await orchestrator.start();
  const task = orchestrator.dispatch({
    workspace,
    objective: "Inspect a file",
    profile: "economy",
  });

  const deadline = Date.now() + 1000;
  while (["queued", "running"].includes(store.getTask(task.id).status)) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const completed = store.getTask(task.id);
  assert.equal(completed.status, "blocked");
  assert.match(completed.result.summary, /sandbox helper/i);
});

test("downgrades inconsistent completed reports that contain blockers", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-result-work-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-result-state-")),
  );
  class InconsistentCodex extends FinalMessageCodex {
    async request(method) {
      if (method !== "turn/start") return super.request(method);
      setImmediate(() => {
        this.emit("notification", {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            item: {
              type: "agentMessage",
              phase: "final_answer",
              text: JSON.stringify({
                status: "completed",
                summary: "Unable to read the file.",
                changed_files: [],
                tests: [],
                blockers: ["Sandbox unavailable"],
                next_action: "Repair sandbox",
              }),
            },
          },
        });
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: { id: "turn-1", status: "completed", items: [] },
          },
        });
      });
      return { turn: { id: "turn-1" } };
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
        effort: "low",
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
  const orchestrator = new Orchestrator({
    config,
    store,
    codex: new InconsistentCodex(),
  });
  await orchestrator.start();
  const task = orchestrator.dispatch({
    workspace,
    objective: "Inspect a file",
    profile: "economy",
  });
  const deadline = Date.now() + 1000;
  while (["queued", "running"].includes(store.getTask(task.id).status)) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(store.getTask(task.id).status, "blocked");
});
