import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";

class RecordingExecutor extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.ready = false;
    this.discovery = { available: null, status: "unknown" };
    this.startedThreads = [];
    this.resumedThreads = [];
    this.turnStarts = [];
    this.threadCounter = 0;
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
  request() { return Promise.resolve({}); }
  respond() {}
  async listModels() { return { data: [] }; }
  async getSandboxReadiness() { return { status: "ready" }; }

  async startThread() {
    this.threadCounter += 1;
    const id = `${this.id}-thread-${this.threadCounter}`;
    this.startedThreads.push(id);
    return { thread: { id } };
  }

  async resumeThread({ threadId }) {
    this.resumedThreads.push(threadId);
    if (!threadId.startsWith(`${this.id}-thread-`)) {
      throw new Error(`${this.id} cannot resume foreign thread ${threadId}`);
    }
    return { thread: { id: threadId, turns: [] } };
  }

  async setGoal() { return {}; }
  async getGoal() { return { goal: null }; }

  async startTurn(params) {
    this.turnStarts.push(params);
    const turnId = `${this.id}-turn-${this.turnStarts.length}`;
    queueMicrotask(() => {
      this.emit("notification", {
        method: "turn/completed",
        params: {
          threadId: params.threadId,
          turn: {
            id: turnId,
            status: "completed",
            items: [{
              type: "agentMessage",
              phase: "final_answer",
              text: JSON.stringify({
                status: "completed",
                summary: `${this.id} completed ${this.turnStarts.length}`,
                changed_files: [`${this.id}.txt`],
                tests: [{ command: `${this.id} test`, status: "passed", detail: null }],
                blockers: [],
                next_action: null,
              }),
            }],
          },
        },
      });
    });
    return { turn: { id: turnId } };
  }

  async interruptTurn() { return {}; }
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

function configFor(workspace) {
  return {
    workspaceRoots: [path.dirname(workspace)],
    executor: { provider: "codex", routing: { order: ["codex", "opencode"] } },
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
      maxStoredEventsPerTask: 50,
      maxTaskRuntimeMinutes: 1,
    },
  };
}

function setup() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-handoff-workspace-"));
  const store = new TaskStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "acp-handoff-state-")),
    50,
  );
  const codex = new RecordingExecutor("codex");
  const opencode = new RecordingExecutor("opencode");
  const orchestrator = new Orchestrator({
    config: configFor(workspace),
    store,
    executors: new Map([
      ["codex", codex],
      ["opencode", opencode],
    ]),
    defaultProvider: "codex",
  });
  return { workspace, store, codex, opencode, orchestrator };
}

test("keeps persistent project threads isolated per executor", async () => {
  const { workspace, store, codex, opencode, orchestrator } = setup();
  await orchestrator.start();

  const firstCodex = orchestrator.dispatch({
    workspace,
    objective: "first codex pass",
    profile: "economy",
    executor: "codex",
  });
  await waitFor(() => store.getTask(firstCodex.id)?.status === "completed");

  const openCode = orchestrator.dispatch({
    workspace,
    objective: "opencode pass",
    profile: "economy",
    executor: "opencode",
  });
  await waitFor(() => store.getTask(openCode.id)?.status === "completed");

  const secondCodex = orchestrator.dispatch({
    workspace,
    objective: "second codex pass",
    profile: "economy",
    executor: "codex",
  });
  await waitFor(() => store.getTask(secondCodex.id)?.status === "completed");

  assert.equal(codex.startedThreads.length, 1);
  assert.deepEqual(codex.resumedThreads, ["codex-thread-1"]);
  assert.equal(opencode.startedThreads.length, 1);
  assert.deepEqual(opencode.resumedThreads, []);
  const canonicalWorkspace = store.getTask(firstCodex.id).workspace;
  assert.equal(store.getProject(canonicalWorkspace, "codex").threadId, "codex-thread-1");
  assert.equal(store.getProject(canonicalWorkspace, "opencode").threadId, "opencode-thread-1");
});

test("hands completed evidence to a different executor without reusing its thread", async () => {
  const { workspace, store, codex, opencode, orchestrator } = setup();
  await orchestrator.start();

  const source = orchestrator.dispatch({
    workspace,
    objective: "implement the feature",
    profile: "economy",
    executor: "codex",
  });
  await waitFor(() => store.getTask(source.id)?.status === "completed");

  const handoff = orchestrator.handoffTask(source.id, {
    executor: "opencode",
    objective: "review and verify the implementation",
    profile: "economy",
    evidence_required: ["report regressions"],
  });
  await waitFor(() => store.getTask(handoff.id)?.status === "completed");

  const completed = store.getTask(handoff.id);
  assert.equal(completed.kind, "handoff");
  assert.equal(completed.parentTaskId, source.id);
  assert.equal(completed.executor, "opencode");
  assert.equal(opencode.startedThreads.length, 1);
  assert.equal(opencode.resumedThreads.length, 0);

  const prompt = opencode.turnStarts[0].input[0].text;
  assert.match(prompt, /Source executor: codex/);
  assert.match(prompt, /Source summary: codex completed/);
  assert.match(prompt, /Changed files: codex\.txt/);
  assert.match(prompt, /Verification: codex test => passed/);
});

test("rejects handoff while the source task is still running", async () => {
  const { workspace, store, codex, orchestrator } = setup();
  codex.startTurn = async function startTurn(params) {
    this.turnStarts.push(params);
    return { turn: { id: "codex-running-turn" } };
  };
  await orchestrator.start();

  const source = orchestrator.dispatch({
    workspace,
    objective: "long running task",
    profile: "economy",
    executor: "codex",
  });
  await waitFor(() => store.getTask(source.id)?.status === "running");

  assert.throws(
    () => orchestrator.handoffTask(source.id, {
      executor: "opencode",
      objective: "review too early",
      profile: "economy",
    }),
    /terminal state/,
  );
  await orchestrator.cancel(source.id);
});
