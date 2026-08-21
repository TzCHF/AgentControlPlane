import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { Orchestrator } from "./orchestrator.js";
import { TaskStore } from "./store.js";

export const ACCEPTANCE_REASONS = Object.freeze([
  "quota_exhausted",
  "rate_limited",
  "executor_unavailable",
  "authentication_unavailable",
  "provider_unavailable",
]);

const FAILURE_SHAPES = Object.freeze({
  quota_exhausted: {
    status: 402,
    code: "usage_limit_exceeded",
    message: "Injected acceptance failure: usage limit exceeded",
  },
  rate_limited: {
    status: 429,
    code: "rate_limit_exceeded",
    message: "Injected acceptance failure: rate limit exceeded",
  },
  executor_unavailable: {
    code: "executor_unavailable",
    message: "Injected acceptance failure: executor unavailable",
  },
  authentication_unavailable: {
    status: 401,
    code: "authentication_unavailable",
    message: "Injected acceptance failure: authentication unavailable",
  },
  provider_unavailable: {
    status: 503,
    code: "provider_unavailable",
    message: "Injected acceptance failure: provider unavailable",
  },
});

export class InjectedFailureExecutor extends EventEmitter {
  constructor(reason) {
    super();
    if (!ACCEPTANCE_REASONS.includes(reason)) {
      throw new TypeError(`Unsupported acceptance reason: ${reason}`);
    }
    this.id = "acceptance-fault";
    this.displayName = "Acceptance fault injector";
    this.kind = "cli";
    this.ready = false;
    this.requiresWindowsSandbox = false;
    this.reason = reason;
    this.capabilities = {
      persistentThreads: true,
      tokenUsage: false,
      hardInterrupt: true,
      subagents: false,
    };
    this.discovery = { available: null, status: "unknown", reason: null };
  }

  async probe() {
    return { available: true, status: "available", reason: null };
  }

  setDiscovery(result) {
    this.discovery = { ...this.discovery, ...result };
    return structuredClone(this.discovery);
  }

  async start() {
    this.ready = true;
  }

  async stop() {
    this.ready = false;
  }

  request() {}
  respond() {}
  async listModels() { return { data: [] }; }
  async getSandboxReadiness() { return { status: "ready" }; }
  async resumeThread({ threadId }) { return { thread: { id: threadId } }; }
  async setGoal() { return {}; }
  async getGoal() { return { goal: null }; }
  async interruptTurn() { return {}; }
  async startThread() { return { thread: { id: "acceptance-fault-thread" } }; }

  async startTurn() {
    const shape = FAILURE_SHAPES[this.reason];
    const error = new Error(shape.message);
    error.code = shape.code;
    if (shape.status) error.status = shape.status;
    throw error;
  }
}

function acceptanceConfig(baseConfig, { targetId, workspace, stateDir, reason }) {
  const config = structuredClone(baseConfig);
  config.stateDir = stateDir;
  config.workspaceRoots = [path.dirname(workspace)];
  config.executor = {
    ...(config.executor ?? {}),
    provider: "acceptance-fault",
    routing: {
      ...(config.executor?.routing ?? {}),
      order: ["acceptance-fault", targetId],
    },
    reroute: {
      enabled: true,
      max_reroutes: 1,
      allowed_reasons: [reason],
    },
  };
  config.limits = {
    ...(config.limits ?? {}),
    maxConcurrentTasks: 1,
    maxQueuedTasks: Math.max(1, Number(config.limits?.maxQueuedTasks ?? 10)),
    maxStoredEventsPerTask: Math.max(
      20,
      Number(config.limits?.maxStoredEventsPerTask ?? 20),
    ),
    maxStoredTasks: Math.max(10, Number(config.limits?.maxStoredTasks ?? 100)),
    maxAuditBytes: Math.max(
      1024 * 1024,
      Number(config.limits?.maxAuditBytes ?? 1024 * 1024),
    ),
    maxTaskRuntimeMinutes: Math.max(
      1,
      Number(config.limits?.maxTaskRuntimeMinutes ?? 10),
    ),
  };
  return config;
}

function waitForTerminal(store, taskId, timeoutMs) {
  const terminal = new Set([
    "completed",
    "partial",
    "blocked",
    "failed",
    "cancelled",
    "interrupted",
  ]);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const task = store.getTask(taskId, true);
      if (task && terminal.has(task.status)) return resolve(task);
      if (Date.now() - started >= timeoutMs) {
        return reject(
          new Error(`Reroute acceptance timed out after ${timeoutMs}ms`),
        );
      }
      setTimeout(check, 250);
    };
    check();
  });
}

export async function runRerouteAcceptance({
  baseConfig,
  targetId,
  targetExecutor,
  reason = "quota_exhausted",
  workspace,
  stateDir,
  timeoutMs = 10 * 60 * 1000,
  markerName = "acp-reroute-acceptance.txt",
  markerContent = "ACP_REROUTE_ACCEPTANCE_OK",
}) {
  if (!targetId || !targetExecutor) {
    throw new TypeError("A target executor id and instance are required");
  }
  if (!ACCEPTANCE_REASONS.includes(reason)) {
    throw new TypeError(`Unsupported acceptance reason: ${reason}`);
  }
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const config = acceptanceConfig(baseConfig, {
    targetId,
    workspace,
    stateDir,
    reason,
  });
  const store = new TaskStore(
    stateDir,
    config.limits.maxStoredEventsPerTask,
    config.limits.maxStoredTasks,
    config.limits.maxAuditBytes,
    config.audit?.integrityKey,
  );
  const fault = new InjectedFailureExecutor(reason);
  const executors = new Map([
    [fault.id, fault],
    [targetId, targetExecutor],
  ]);
  const orchestrator = new Orchestrator({
    config,
    store,
    executors,
    defaultProvider: fault.id,
  });
  const markerPath = path.join(workspace, markerName);

  try {
    await orchestrator.start();
    const task = orchestrator.dispatch({
      workspace,
      executor: fault.id,
      profile: "economy",
      kind: "smoke",
      objective:
        `Create ${markerName} in the workspace with the exact content ` +
        `${JSON.stringify(markerContent)}. Verify the file content before finishing.`,
      constraints: [`Modify only ${markerName}.`],
      acceptance_criteria: [
        `${markerName} exists.`,
        `Its complete content is exactly ${JSON.stringify(markerContent)}.`,
      ],
    });
    const completed = await waitForTerminal(store, task.id, timeoutMs);
    const history = completed.executor_history ?? [];
    const marker = fs.existsSync(markerPath)
      ? fs.readFileSync(markerPath, "utf8")
      : null;
    const checks = {
      completed: completed.status === "completed",
      same_task: completed.id === task.id,
      same_logical_task: completed.logical_task_id === task.id,
      target_selected: completed.executor === targetId,
      reroute_reason: completed.reroute_reason === reason,
      executor_path:
        history.length === 2 &&
        history[0]?.executor === fault.id &&
        history[1]?.executor === targetId,
      marker_exact: marker === markerContent,
    };
    const passed = Object.values(checks).every(Boolean);
    return {
      passed,
      task_id: task.id,
      logical_task_id: completed.logical_task_id,
      status: completed.status,
      target_executor: targetId,
      reason,
      executor_path: history.map((entry) => entry.executor),
      checks,
      marker_path: markerPath,
      error: completed.error ?? null,
      summary: completed.result?.summary ?? null,
    };
  } finally {
    await Promise.allSettled([fault.stop(), targetExecutor.stop()]);
  }
}
