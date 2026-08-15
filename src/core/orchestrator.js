import { EventEmitter } from "node:events";
import {
  buildEngineeringPrompt,
  finalReportSchema,
  normalizeBrief,
} from "./brief.js";
import { ControlPlaneError, asErrorPayload } from "./errors.js";
import { resolveProfile, resolveEndpointModel } from "./profiles.js";
import { resolveWorkspace } from "./workspace.js";
import { discoverExecutors } from "../executors/discovery.js";

function zeroUsage() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    uncached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };
}

function mapUsage(tokenUsage) {
  const source = tokenUsage?.last ?? tokenUsage?.total;
  if (!source) return zeroUsage();
  return {
    input_tokens: Number(source.inputTokens ?? 0),
    cached_input_tokens: Number(source.cachedInputTokens ?? 0),
    uncached_input_tokens: Math.max(
      0,
      Number(source.inputTokens ?? 0) - Number(source.cachedInputTokens ?? 0),
    ),
    output_tokens: Number(source.outputTokens ?? 0),
    reasoning_output_tokens: Number(source.reasoningOutputTokens ?? 0),
    total_tokens: Number(source.totalTokens ?? 0),
  };
}

function mapGoalUsage(goal, currentUsage = null) {
  const totalTokens = Math.max(0, Number(goal?.tokensUsed ?? 0));
  return {
    ...(currentUsage ?? zeroUsage()),
    total_tokens: Math.max(
      totalTokens,
      Number(currentUsage?.total_tokens ?? 0),
    ),
  };
}

function extractReport(turn, cachedFinalMessage = null) {
  const messages = (turn?.items ?? []).filter(
    (item) => item.type === "agentMessage" && typeof item.text === "string",
  );
  const preferred =
    messages.findLast((item) => item.phase === "final_answer") ?? messages.at(-1);
  const finalText = preferred?.text ?? cachedFinalMessage;
  if (!finalText) {
    return {
      status: turn?.status === "completed" ? "completed" : "failed",
      summary: "Executor completed without a final agent message.",
      changed_files: [],
      tests: [],
      blockers: [],
      next_action: null,
    };
  }
  try {
    const parsed = JSON.parse(finalText);
    const normalizedSummary = String(parsed.summary ?? "").toLowerCase();
    if (
      parsed.status === "completed" &&
      (normalizedSummary.includes("status: blocked") ||
        normalizedSummary.includes("could not") ||
        normalizedSummary.includes("unable to") ||
        (Array.isArray(parsed.blockers) && parsed.blockers.length > 0))
    ) {
      parsed.status = "blocked";
    }
    return parsed;
  } catch {
    const normalized = finalText.toLowerCase();
    const status = normalized.includes("status: blocked")
      ? "blocked"
      : normalized.includes("status: failed")
        ? "failed"
        : normalized.includes("status: partial")
          ? "partial"
          : turn?.status === "completed"
            ? "completed"
            : "failed";
    return {
      status,
      summary: finalText,
      changed_files: [],
      tests: [],
      blockers: status === "blocked" ? [finalText] : [],
      next_action: null,
    };
  }
}

export class Orchestrator extends EventEmitter {
  constructor({
    config,
    store,
    codex = null,
    executors = null,
    defaultProvider = null,
  }) {
    super();
    this.config = config;
    this.store = store;
    this.executors =
      executors ?? new Map([[defaultProvider ?? "codex", codex]]);
    this.defaultProvider = defaultProvider ?? config?.executor?.provider ?? "auto";
    this.primaryProvider = null;
    this.executorDiscovery = {};
    this.running = new Map();
    this.queue = [];
    this.modelCatalog = [];
    this.modelCatalogs = new Map();
    this.runtimeHealth = {
      windowsSandbox: process.platform === "win32" ? "unknown" : "not_applicable",
    };
    for (const executor of this.executors.values()) {
      executor.on("notification", (message) =>
        this.#onNotification(message, executor),
      );
      executor.on("serverRequest", (message) =>
        this.#onServerRequest(message, executor),
      );
      executor.on("stderr", (text) =>
        this.emit("diagnostic", { source: executor.id ?? "executor", text }),
      );
    }
  }

  #orderedProviders(profileName = null) {
    const profileOrder = profileName
      ? this.config.executor?.routing?.profiles?.[profileName]
      : null;
    const configured = profileOrder ?? this.config.executor?.routing?.order ?? [];
    return [...new Set([...configured, ...this.executors.keys()])];
  }

  #executorEntry(task = {}) {
    const requested = task.executor ?? this.defaultProvider;
    const order = this.#orderedProviders(task.profile ?? task.policy?.name);
    const provider =
      requested === "auto"
        ? order.find(
            (id) =>
              this.executors.has(id) &&
              this.executorDiscovery[id]?.available !== false &&
              this.executorDiscovery[id]?.status !== "degraded",
          ) ??
          order.find(
            (id) =>
              this.executors.has(id) &&
              this.executorDiscovery[id]?.available !== false,
          )
        : requested;
    if (!provider) {
      throw new ControlPlaneError(
        "no_executor_available",
        "No configured engineering executor is available",
        { executors: this.getExecutors() },
      );
    }
    const executor = this.executors.get(provider);
    if (!executor) {
      throw new ControlPlaneError(
        "unknown_executor",
        `Unknown executor: ${provider}`,
        { available: [...this.executors.keys()] },
      );
    }
    const discovery = this.executorDiscovery[provider];
    if (discovery?.available === false) {
      throw new ControlPlaneError(
        "executor_unavailable",
        `Executor is not available: ${provider}`,
        { executor: provider, discovery },
      );
    }
    return { id: provider, executor };
  }

  #executorFor(task) {
    return this.#executorEntry(task).executor;
  }

  async start() {
    this.executorDiscovery = await discoverExecutors(this.executors);
    const { id, executor: primary } = this.#executorEntry({});
    this.primaryProvider = id;
    await primary.start();
    try {
      const models = await primary.listModels({
        limit: 100,
        includeHidden: false,
      });
      this.modelCatalog = models.data ?? [];
      this.modelCatalogs.set(id, this.modelCatalog);
    } catch (error) {
      this.modelCatalog = [];
      this.emit("diagnostic", { source: `${id}-models`, text: error.message });
    }
    if (process.platform === "win32" && primary.requiresWindowsSandbox) {
      try {
        const readiness = await primary.getSandboxReadiness({});
        this.runtimeHealth.windowsSandbox = readiness.status;
      } catch (error) {
        this.runtimeHealth.windowsSandbox = "unknown";
        this.emit("diagnostic", {
          source: "windows-sandbox",
          text: error.message,
        });
      }
    } else if (process.platform === "win32") {
      this.runtimeHealth.windowsSandbox = "not_required";
    }
    this.runtimeHealth.defaultExecutor = id;
    this.runtimeHealth.executors = structuredClone(this.executorDiscovery);
    await this.#recoverInterruptedTasks();
    const refreshMs = Number(
      this.config.limits?.discoveryRefreshMs ?? 60000,
    );
    if (refreshMs > 0 && !this.discoveryTimer) {
      this.discoveryTimer = setInterval(() => {
        this.#refreshDiscovery().catch((error) => {
          this.emit("diagnostic", {
            source: "discovery-refresh",
            text: error.message,
          });
        });
      }, refreshMs);
      this.discoveryTimer.unref?.();
    }
  }

  async #refreshDiscovery() {
    const next = await discoverExecutors(this.executors);
    this.executorDiscovery = next;
    this.runtimeHealth.executors = structuredClone(next);
  }

  getModels(executorId = null) {
    const selected =
      !executorId || executorId === "auto"
        ? this.primaryProvider
        : executorId;
    return structuredClone(this.modelCatalogs.get(selected) ?? []);
  }

  getExecutors() {
    return [...this.executors.entries()].map(([id, executor]) => ({
      ...(typeof executor.describe === "function"
        ? executor.describe()
        : {
            id,
            display_name: executor.displayName ?? id,
            ready: Boolean(executor.ready),
            discovery: structuredClone(this.executorDiscovery[id] ?? {}),
            capabilities: structuredClone(executor.capabilities ?? {}),
          }),
      id,
      selected: id === this.primaryProvider,
    }));
  }

  getDefaultExecutorId() {
    return this.primaryProvider;
  }

  getRuntimeHealth() {
    return structuredClone(this.runtimeHealth);
  }

  dispatch(request) {
    this.#assertQueueCapacity();
    const workspace = resolveWorkspace(
      request.workspace,
      this.config.workspaceRoots,
    );
    const { id: provider } = this.#executorEntry({
      executor: request.executor ?? this.defaultProvider,
      profile: request.profile,
    });
    const brief = normalizeBrief(
      request,
      this.config.limits.maxBriefCharacters,
    );
    const catalog = this.modelCatalogs.get(provider) ?? [];
    const policy = resolveProfile(this.config, request, catalog);
    if (provider !== "codex" && !request.model) policy.model = null;
    if (["deepseek", "openai-compatible"].includes(provider) && request.model) {
      const endpointKey = provider === "deepseek" ? "deepseek" : "openaiCompat";
      resolveEndpointModel(
        provider,
        request.model,
        this.config.executor[endpointKey]?.models ?? [],
      );
    }
    const task = this.store.createTask({
      workspace,
      brief,
      policy,
      executor: provider,
    });
    this.queue.push({ taskId: task.id, followUp: false });
    queueMicrotask(() => this.#drain());
    return task;
  }

  continueTask(taskId, request) {
    this.#assertQueueCapacity();
    const parent = this.store.getTask(taskId);
    if (!parent) {
      throw new ControlPlaneError("task_not_found", `Unknown task: ${taskId}`);
    }
    if (!parent.threadId) {
      throw new ControlPlaneError(
        "task_not_started",
        "The original task has no Codex thread yet",
      );
    }
    const brief = normalizeBrief(
      {
        objective: request.objective,
        constraints: request.constraints,
        acceptance_criteria: request.acceptance_criteria,
        context: request.context,
        evidence_required: request.evidence_required,
      },
      this.config.limits.maxBriefCharacters,
    );
    const policy = resolveProfile(this.config, {
      profile: request.profile ?? parent.policy.name,
      model: request.model,
      reasoning_effort: request.reasoning_effort,
      max_subagents: request.max_subagents,
      token_budget: request.token_budget,
    }, this.modelCatalogs.get(parent.executor) ?? []);
    if (parent.executor !== "codex" && !request.model) policy.model = null;
    const task = this.store.createTask({
      workspace: parent.workspace,
      brief,
      policy,
      parentTaskId: parent.id,
      executor: parent.executor ?? this.defaultProvider,
    });
    this.store.updateTask(task.id, { threadId: parent.threadId });
    this.queue.push({ taskId: task.id, followUp: true });
    queueMicrotask(() => this.#drain());
    return this.store.getTask(task.id);
  }

  async cancel(taskId) {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new ControlPlaneError("task_not_found", `Unknown task: ${taskId}`);
    }
    if (["completed", "partial", "blocked", "failed", "cancelled"].includes(task.status)) {
      return task;
    }
    this.queue = this.queue.filter((entry) => entry.taskId !== taskId);
    const active = this.running.get(taskId);
    if (task.threadId && task.turnId && active) {
      try {
        await this.#executorFor(task).interruptTurn({
          threadId: task.threadId,
          turnId: task.turnId,
        });
      } catch (error) {
        this.store.addEvent(taskId, {
          type: "task.cancel_interrupt_failed",
          error: asErrorPayload(error),
        });
      }
    }
    this.store.updateTask(taskId, {
      status: "cancelled",
      completedAt: new Date().toISOString(),
    });
    this.store.audit("task.cancelled", {
      taskId,
      previousStatus: task.status,
      threadId: task.threadId,
      turnId: task.turnId,
    });
    this.#finishActiveTask(taskId);
    return this.store.getTask(taskId);
  }

  async #drain() {
    const limit = this.config.limits.maxConcurrentTasks;
    while (this.running.size < limit && this.queue.length) {
      const activeWorkspaces = new Set(
        [...this.running.values()].map((entry) => entry.workspace),
      );
      const index = this.queue.findIndex((entry) => {
        const task = this.store.getTask(entry.taskId);
        return task && !activeWorkspaces.has(task.workspace);
      });
      if (index === -1) break;
      const [queued] = this.queue.splice(index, 1);
      const task = this.store.getTask(queued.taskId);
      if (!task || task.status !== "queued") continue;
      this.running.set(queued.taskId, {
        ...queued,
        workspace: task.workspace,
        turnId: null,
      });
      this.#run(queued.taskId, queued.followUp).finally(() => {
        this.#finishActiveTask(queued.taskId);
        this.running.delete(queued.taskId);
        queueMicrotask(() => this.#drain());
      });
    }
  }

  async #run(taskId, followUp) {
    const task = this.store.getTask(taskId, true);
    if (!task || task.status !== "queued") return;
    const workspace = resolveWorkspace(
      task.workspace,
      this.config.workspaceRoots,
    );
    const executor = this.#executorFor(task);
    this.store.updateTask(taskId, {
      status: "running",
      startedAt: new Date().toISOString(),
    });

    try {
      if (!executor.ready) {
        await executor.start();
      }
      if (executor.requiresWindowsSandbox && process.platform === "win32") {
        const readiness = await executor.getSandboxReadiness({});
        if (readiness.status !== "ready") {
          throw new ControlPlaneError(
            "windows_sandbox_not_ready",
            "Codex Windows sandbox is not configured. Run npm run sandbox:setup before dispatching engineering work.",
            { status: readiness.status },
          );
        }
      }
      const project = this.store.getProject(task.workspace);
      let threadId = task.threadId ?? project?.threadId ?? null;

      if (threadId) {
        try {
          await executor.resumeThread({
            threadId,
            historyMode: "paginated",
          });
        } catch (error) {
          this.store.addEvent(taskId, {
            type: "thread.resume_failed",
            error: asErrorPayload(error),
          });
          threadId = null;
        }
      }

      if (!threadId) {
        const started = await executor.startThread({
          cwd: workspace,
          model: task.policy.model,
          approvalPolicy: this.config.codex.approvalPolicy,
          approvalsReviewer: "user",
          sandbox: this.config.codex.sandbox,
          runtimeWorkspaceRoots: [workspace],
          historyMode: "paginated",
          baseInstructions:
            "You are a secure software engineering execution agent. Work only inside the provided workspace. Use tools efficiently, verify changes, and return a concise final report.",
          developerInstructions:
            "You are the engineering execution agent. Follow the compact brief, minimize duplicated context, use subagents only within the supplied policy, verify work, and return a compact final report.",
          config: {
            agents: {
              max_threads: Math.max(1, task.policy.maxSubagents + 1),
            },
            sandbox_workspace_write: {
              network_access: Boolean(this.config.codex.networkAccess),
            },
          },
        });
        threadId = started.thread.id;
        this.store.setProject(workspace, { threadId });
      }

      this.store.updateTask(taskId, { threadId });
      await executor.setGoal({
        threadId,
        objective: task.brief.objective,
        status: "active",
        tokenBudget: task.policy.tokenBudget,
      });

      const response = await executor.startTurn({
        threadId,
        input: [
          {
            type: "text",
            text: buildEngineeringPrompt(task.brief, task.policy, followUp),
          },
        ],
        model: task.policy.model,
        effort: task.policy.effort,
        summary: task.policy.summary,
        cwd: workspace,
        runtimeWorkspaceRoots: [workspace],
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [workspace],
          networkAccess: Boolean(this.config.codex.networkAccess),
        },
        approvalPolicy: this.config.codex.approvalPolicy,
        outputSchema: finalReportSchema,
        responsesapiClientMetadata: {
          control_plane: "agent-control-plane",
          task_id: taskId,
          profile: task.policy.name,
        },
      });

      const turnId = response.turn.id;
      const latestTask = this.store.getTask(taskId);
      if (latestTask?.status === "cancelled") {
        await executor.interruptTurn({
          threadId,
          turnId,
        });
        return;
      }
      const active = this.running.get(taskId);
      if (active) {
        active.turnId = turnId;
        const pendingUsage = active.pendingUsage?.get(turnId);
        if (pendingUsage) {
          this.store.updateTask(taskId, { usage: mapUsage(pendingUsage) });
        }
        active.pendingUsage = null;
      }
      this.store.updateTask(taskId, { turnId });
      this.store.addEvent(taskId, {
        method: "turn/started",
        threadId,
        turnId,
      });
      this.#startBudgetMonitor(taskId);
      await this.#waitForTerminalNotification(taskId);
    } catch (error) {
      this.store.updateTask(taskId, {
        status: "failed",
        error: asErrorPayload(error),
        completedAt: new Date().toISOString(),
      });
      this.store.audit("task.failed", {
        taskId,
        error: asErrorPayload(error),
      });
    }
  }

  #waitForTerminalNotification(taskId) {
    const active = this.running.get(taskId);
    if (!active) return Promise.resolve();
    const current = this.store.getTask(taskId);
    if (current && current.status !== "running") {
      return Promise.resolve();
    }
    const timeoutMs =
      Number(this.config.limits.maxTaskRuntimeMinutes ?? 240) * 60 * 1000;
    return new Promise((resolve) => {
      active.resolve = resolve;
      active.timer = setTimeout(async () => {
        const task = this.store.getTask(taskId);
        if (task?.status === "running") {
          let interruptionError = null;
          try {
            await this.#executorFor(task).interruptTurn(
              {
                threadId: task.threadId,
                turnId: task.turnId,
              },
              10000,
            );
          } catch (error) {
            interruptionError = asErrorPayload(error);
          }
          this.store.updateTask(taskId, {
            status: "interrupted",
            error: {
              code: "task_runtime_exceeded",
              message: `Task exceeded the configured runtime limit of ${this.config.limits.maxTaskRuntimeMinutes ?? 240} minutes.`,
              details: interruptionError,
            },
            completedAt: new Date().toISOString(),
          });
          this.store.audit("task.interrupted", {
            taskId,
            reason: "task_runtime_exceeded",
            threadId: task.threadId,
            turnId: task.turnId,
            interruptionError,
          });
        }
        resolve();
      }, timeoutMs);
    });
  }

  #finishActiveTask(taskId) {
    const active = this.running.get(taskId);
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    if (active.budgetTimer) clearInterval(active.budgetTimer);
    active.budgetTimer = null;
    active.resolve?.();
  }

  #startBudgetMonitor(taskId) {
    const active = this.running.get(taskId);
    if (!active || active.budgetTimer) return;
    const intervalMs = Number(
      this.config.limits.tokenUsagePollIntervalMs ?? 1000,
    );
    const poll = () => {
      this.#refreshGoalUsage(taskId).catch((error) => {
        const current = this.running.get(taskId);
        if (!current || current.goalUsageDiagnosticEmitted) return;
        current.goalUsageDiagnosticEmitted = true;
        this.store.addEvent(taskId, {
          type: "task.usage_poll_failed",
          error: asErrorPayload(error),
        });
      });
    };
    poll();
    active.budgetTimer = setInterval(poll, intervalMs);
    active.budgetTimer.unref?.();
  }

  async #refreshGoalUsage(taskId, { enforceBudget = true } = {}) {
    const active = this.running.get(taskId);
    const task = this.store.getTask(taskId);
    if (!active || !task?.threadId) return null;
    if (active.goalUsagePollPromise) {
      return active.goalUsagePollPromise;
    }
    const pollPromise = (async () => {
      const executor = this.#executorFor(task);
      const response = await executor.getGoal(
        { threadId: task.threadId },
        10000,
      );
      const goal = response?.goal;
      if (!goal) return null;
      const currentUsage = this.store.getTask(taskId)?.usage;
      const usage = mapGoalUsage(goal, currentUsage);
      if (
        !currentUsage ||
        usage.total_tokens >= Number(currentUsage.total_tokens ?? 0)
      ) {
        this.store.updateTask(taskId, { usage });
      }

      const latest = this.store.getTask(taskId);
      const overBudget =
        usage.total_tokens >= latest.policy.tokenBudget ||
        goal.status === "budgetLimited";
      if (
        enforceBudget &&
        !active.completing &&
        latest.status === "running" &&
        overBudget &&
        !active.budgetInterruptRequested
      ) {
        active.budgetInterruptRequested = true;
        active.budgetMeasuredTokens = usage.total_tokens;
        this.store.addEvent(taskId, {
          type: "task.token_budget_exceeded",
          budget: latest.policy.tokenBudget,
          measured: usage.total_tokens,
          source: "thread_goal",
        });
        try {
          await executor.interruptTurn(
            {
              threadId: latest.threadId,
              turnId: active.turnId,
            },
            10000,
          );
        } catch (error) {
          this.store.addEvent(taskId, {
            type: "task.budget_interrupt_failed",
            error: asErrorPayload(error),
          });
        }
      }
      return usage;
    })();
    active.goalUsagePollPromise = pollPromise;
    try {
      return await pollPromise;
    } finally {
      if (active.goalUsagePollPromise === pollPromise) {
        active.goalUsagePollPromise = null;
      }
    }
  }

  async #recoverInterruptedTasks() {
    const stale = this.store.listByStatus(["queued", "running"]);
    for (const task of stale) {
      if (task.status === "queued") {
        this.queue.push({
          taskId: task.id,
          followUp: Boolean(task.parentTaskId),
        });
        continue;
      }

      let recovered = false;
      if (task.threadId) {
        try {
          const executor = this.#executorFor(task);
          if (!executor.ready) await executor.start();
          const resumed = await executor.resumeThread({
            threadId: task.threadId,
            historyMode: "paginated",
          });
          const turns = resumed.thread?.turns ?? [];
          const lastTurn = turns.at(-1);
          if (lastTurn && lastTurn.status !== "inProgress") {
            const report = extractReport(lastTurn);
            const status =
              lastTurn.status === "completed"
                ? report.status === "blocked"
                  ? "blocked"
                  : "completed"
                : lastTurn.status;
            this.store.updateTask(task.id, {
              status,
              turnId: lastTurn.id,
              result: report,
              error: lastTurn.error ?? null,
              completedAt: new Date().toISOString(),
            });
            this.store.addEvent(task.id, {
              type: "task.recovered",
              recoveredStatus: status,
            });
            recovered = true;
          }
        } catch (error) {
          this.store.addEvent(task.id, {
            type: "task.recovery_failed",
            error: asErrorPayload(error),
          });
        }
      }

      if (!recovered) {
        this.store.updateTask(task.id, {
          status: "interrupted",
          error: {
            code: "control_plane_restarted",
            message:
              "The control-plane process stopped before this task reached a terminal state.",
            details: null,
          },
          completedAt: new Date().toISOString(),
        });
      }
    }
    if (this.queue.length) queueMicrotask(() => this.#drain());
  }

  #taskForNotification(params) {
    const turnId = params.turnId ?? params.turn?.id;
    if (turnId) {
      for (const [taskId, active] of this.running.entries()) {
        if (active.turnId === turnId) return taskId;
      }
      const threadMatches = [];
      for (const [taskId, active] of this.running.entries()) {
        const task = this.store.getTask(taskId);
        if (task && params.threadId && task.threadId === params.threadId) {
          threadMatches.push(taskId);
        }
      }
      return threadMatches.length === 1 ? threadMatches[0] : null;
    }
    const matches = [];
    for (const [taskId, active] of this.running.entries()) {
      const task = this.store.getTask(taskId);
      if (!task) continue;
      if (params.threadId && task.threadId === params.threadId) {
        matches.push(taskId);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  #onNotification(message, executor) {
    const params = message.params ?? {};
    const taskId = this.#taskForNotification(params);
    if (!taskId) return;

    if (message.method === "thread/tokenUsage/updated") {
      const active = this.running.get(taskId);
      if (!active) return;
      if (!active.turnId) {
        active.pendingUsage ??= new Map();
        active.pendingUsage.set(params.turnId, params.tokenUsage);
        return;
      }
      if (params.turnId !== active.turnId) {
        return;
      }
      const usage = mapUsage(params.tokenUsage);
      this.store.updateTask(taskId, { usage });
      const task = this.store.getTask(taskId);
      if (
        !active.budgetInterruptRequested &&
        usage.total_tokens > task.policy.tokenBudget
      ) {
        active.budgetInterruptRequested = true;
        active.budgetMeasuredTokens = usage.total_tokens;
        this.store.addEvent(taskId, {
          type: "task.token_budget_exceeded",
          budget: task.policy.tokenBudget,
          measured: usage.total_tokens,
          source: "token_usage_notification",
        });
        executor
          .interruptTurn({
            threadId: task.threadId,
            turnId: active.turnId,
          })
          .catch((error) => {
            this.store.addEvent(taskId, {
              type: "task.budget_interrupt_failed",
              error: asErrorPayload(error),
            });
          });
      }
      return;
    }

    if (message.method === "item/completed") {
      const item = params.item;
      if (item?.type === "agentMessage" && item.phase === "final_answer") {
        const active = this.running.get(taskId);
        if (active) active.finalMessage = item.text;
      }
      if (item?.type === "collabAgentToolCall") {
        const task = this.store.getTask(taskId);
        const known = new Map(
          (task.subagents ?? []).map((entry) => [entry.thread_id, entry]),
        );
        for (const threadId of item.receiverThreadIds ?? []) {
          known.set(threadId, {
            thread_id: threadId,
            model: item.model ?? null,
            reasoning_effort: item.reasoningEffort ?? null,
            status: item.agentsStates?.[threadId]?.status ?? item.status,
          });
        }
        this.store.updateTask(taskId, {
          subagents: [...known.values()],
        });
      }
      this.store.addEvent(taskId, {
        method: message.method,
        item: this.#compactItem(item),
      });
      return;
    }

    if (message.method === "turn/completed") {
      this.#completeTask(taskId, params).catch((error) => {
        this.store.updateTask(taskId, {
          status: "failed",
          error: asErrorPayload(error),
          completedAt: new Date().toISOString(),
        });
        this.#finishActiveTask(taskId);
      });
      return;
    }

    if (
      message.method === "turn/diff/updated" ||
      message.method === "thread/status/changed" ||
      message.method === "error"
    ) {
      this.store.addEvent(taskId, {
        method: message.method,
        params,
      });
    }
  }

  async #completeTask(taskId, params) {
    const current = this.store.getTask(taskId);
    if (!current || current.status !== "running") {
      this.#finishActiveTask(taskId);
      return;
    }
    const active = this.running.get(taskId);
    if (active) {
      active.completing = true;
      if (active.budgetTimer) clearInterval(active.budgetTimer);
      active.budgetTimer = null;
    }
    await this.#refreshGoalUsage(taskId, { enforceBudget: false }).catch(
      () => null,
    );
    const report = extractReport(
      params.turn,
      active?.finalMessage ?? null,
    );
    const budgetInterrupted = Boolean(active?.budgetInterruptRequested);
    const finalStatus = budgetInterrupted
      ? "interrupted"
      : params.turn.status === "completed"
        ? report.status
        : params.turn.status;
    const error = budgetInterrupted
      ? {
          code: "token_budget_exceeded",
          message: `Task exceeded its token budget of ${current.policy.tokenBudget} tokens and was interrupted.`,
          details: {
            budget: current.policy.tokenBudget,
            measured: active?.budgetMeasuredTokens ?? null,
          },
        }
      : params.turn.error ?? null;
    this.store.updateTask(taskId, {
      status: finalStatus,
      result: report,
      error,
      completedAt: new Date().toISOString(),
      ...(params.executorSessionId
        ? { executorSessionId: params.executorSessionId }
        : {}),
    });
    this.store.audit("task.completed", {
      taskId,
      status: finalStatus,
    });
    this.#finishActiveTask(taskId);
  }

  #onServerRequest(message, executor) {
    const params = message.params ?? {};
    const taskId = this.#taskForNotification(params);
    if (taskId) {
      this.store.addEvent(taskId, {
        method: message.method,
        action: "denied_by_control_plane",
      });
    }

    if (message.method === "item/commandExecution/requestApproval") {
      executor.respond(message.id, {
        decision: {
          denied: {
            rejection:
              "AgentControlPlane denied an unapproved command escalation.",
          },
        },
      });
      return;
    }
    if (message.method === "item/fileChange/requestApproval") {
      executor.respond(message.id, { decision: "decline" });
      return;
    }
    if (message.method === "item/tool/requestUserInput") {
      executor.respond(message.id, { answers: {} });
      return;
    }
    if (message.method === "item/permissions/requestApproval") {
      executor.respond(message.id, {
        permissions: {},
        scope: "turn",
        strictAutoReview: true,
      });
      return;
    }
    executor.respond(message.id, {});
  }

  #compactItem(item) {
    if (!item || typeof item !== "object") return item;
    if (item.type === "agentMessage") {
      return {
        type: item.type,
        phase: item.phase ?? null,
        text: String(item.text ?? "").slice(0, 4000),
      };
    }
    if (item.type === "collabAgentToolCall") {
      return {
        type: item.type,
        tool: item.tool,
        status: item.status,
        receiverThreadIds: item.receiverThreadIds,
        model: item.model ?? null,
        reasoningEffort: item.reasoningEffort ?? null,
      };
    }
    return {
      type: item.type ?? "unknown",
      id: item.id ?? null,
      status: item.status ?? null,
    };
  }

  #assertQueueCapacity() {
    const limit = this.config.limits.maxQueuedTasks ?? 100;
    if (this.queue.length >= limit) {
      throw new ControlPlaneError(
        "queue_full",
        `Task queue limit reached (${limit})`,
      );
    }
  }
}
