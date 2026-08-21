import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRerouteAcceptance } from "../src/core/reroute-acceptance.js";
import { parseArgs } from "../scripts/accept-reroute.js";

class AcceptanceTarget extends EventEmitter {
  constructor() {
    super();
    this.id = "target";
    this.kind = "cli";
    this.ready = false;
    this.discovery = { available: null, status: "unknown" };
    this.capabilities = { persistentThreads: true, tokenUsage: true };
  }

  async probe() { return { available: true, status: "available" }; }
  setDiscovery(result) { this.discovery = result; return result; }
  async start() { this.ready = true; }
  async stop() { this.ready = false; }
  respond() {}
  async listModels() { return { data: [] }; }
  async getSandboxReadiness() { return { status: "ready" }; }
  async resumeThread({ threadId }) { return { thread: { id: threadId } }; }
  async startThread() { return { thread: { id: "target-thread" } }; }
  async setGoal() { return {}; }
  async getGoal() { return { goal: null }; }
  async interruptTurn() { return {}; }

  async startTurn(params) {
    const match = params.input[0].text.match(/Create ([^ ]+) in the workspace/);
    const markerName = match[1];
    fs.writeFileSync(
      path.join(params.cwd, markerName),
      "ACP_REROUTE_ACCEPTANCE_OK",
      "utf8",
    );
    queueMicrotask(() => {
      this.emit("notification", {
        method: "turn/completed",
        params: {
          threadId: params.threadId,
          turn: {
            id: "target-turn",
            status: "completed",
            items: [
              {
                type: "agentMessage",
                phase: "final_answer",
                text: JSON.stringify({
                  status: "completed",
                  summary: "acceptance marker created",
                  changed_files: [markerName],
                  tests: ["marker content verified"],
                  blockers: [],
                  next_action: null,
                }),
              },
            ],
          },
        },
      });
    });
    return { turn: { id: "target-turn" } };
  }
}

function baseConfig(workspace) {
  return {
    workspaceRoots: [path.dirname(workspace)],
    audit: { integrityKey: null },
    executor: { routing: { order: [] } },
    codex: {
      approvalPolicy: "never",
      sandbox: "workspace-write",
      networkAccess: false,
    },
    profiles: {
      economy: {
        model: "acceptance-model",
        effort: "low",
        maxSubagents: 0,
        tokenBudget: 30000,
        summary: "concise",
      },
    },
    limits: {
      maxBriefCharacters: 24000,
      maxQueuedTasks: 10,
      maxStoredEventsPerTask: 50,
      maxStoredTasks: 100,
      maxAuditBytes: 1024 * 1024,
      maxTaskRuntimeMinutes: 1,
      maxTokenBudget: 250000,
      tokenUsagePollIntervalMs: 250,
    },
  };
}

test("reroute acceptance injects a failure and verifies a real target contract", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-acceptance-test-"));
  const workspace = path.join(root, "workspace");
  const stateDir = path.join(root, "state");
  const report = await runRerouteAcceptance({
    baseConfig: baseConfig(workspace),
    targetId: "target",
    targetExecutor: new AcceptanceTarget(),
    reason: "rate_limited",
    workspace,
    stateDir,
    timeoutMs: 2000,
  });
  assert.equal(report.passed, true);
  assert.equal(report.status, "completed");
  assert.equal(report.reason, "rate_limited");
  assert.deepEqual(report.executor_path, ["acceptance-fault", "target"]);
  assert.ok(Object.values(report.checks).every(Boolean));
});

test("acceptance CLI validates executor, reason, and timeout", () => {
  assert.deepEqual(parseArgs(["--to", "opencode"]), {
    targetId: "opencode",
    reason: "quota_exhausted",
    timeoutMinutes: 10,
    configPath: null,
    model: null,
    keep: false,
    help: false,
  });
  assert.throws(
    () => parseArgs(["--to", "opencode", "--reason", "task_failure"]),
    /Unsupported acceptance reason/,
  );
  assert.equal(
    parseArgs(["--to", "opencode", "--model", "opencode/mimo-v2.5-free"])
      .model,
    "opencode/mimo-v2.5-free",
  );
  assert.throws(() => parseArgs([]), /--to is required/);
  assert.throws(
    () => parseArgs(["--to", "opencode", "--timeout-minutes", "0"]),
    /greater than zero/,
  );
});
