import { EventEmitter } from "node:events";
import {
  buildEngineeringPrompt,
  finalReportSchema,
  normalizeBrief,
} from "./brief.js";
import { ControlPlaneError, asErrorPayload } from "./errors.js";
import { resolveProfile } from "./profiles.js";
import { resolveWorkspace } from "./workspace.js";

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
      summary: "Codex completed without a final agent message.",
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
  constructor({ config, store, codex }) {
    super();
    this.config = config;
    this.store = store;
    this.codex = codex;
    this.running = new Map();
    this.queue = [];
    this.modelCatalog = [];
    this.runtimeHealth = {
      windowsSandbox: process.platform === "win32" ? "unknown" : "not_applicable",
    };
    this.codex.on("notification", (message) => this.#onNotification(message));
    this.codex.on("serverRequest", (message) => this.#onServerRequest(message));
    this.codex.on("stderr", (text) =>
      this.emit("diagnostic", { source: "codex", text }),
    );
  }

  async start() {
    await this.codex.start();
    const models = await this.codex.request("model/list", {
      limit: 100,
      includeHidden: false,
    });
    this.modelCatalog = models.data ?? [];
    if (process.platform === "win32") {
      try {
        const readiness = await this.codex.request("windowsSandbox/readiness", {});
        this.runtimeHealth.windowsSandbox = readiness.status;
      } catch (error) {
        this.runtimeHealth.windowsSandbox = "unknown";
        this.emit("diagnostic", {
          source: "windows-sandbox",
          text: error.message,
        });
      }
    }
    await this.#recoverInterruptedTasks();
  }

  getModels() {
    return structuredClone(this.modelCatalog);
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
    if (
      process.platform === "win32" &&
      this.runtimeHealth.windowsSandbox !== "ready"
    ) {
      throw new ControlPlaneError(
        "windows_sandbox_not_ready",
        "Codex Windows sandbox is not configured. Run npm run sandbox:setup before dispatching engineering work.",
        { status: this.runtimeHealth.windowsSandbox },
      );
    }
    const brief = normalizeBrief(
      request,
      this.config.limits.maxBriefCharacters,
    );
    const policy = resolveProfile(this.config, request, this.modelCatalog);
    const task = this.store.createTask({ workspace, brief, policy });
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
    }, this.modelCatalog);
    const task = this.store.createTask({
      workspace: parent.workspace,
      brief,
      policy,
      parentTaskId: parent.id,
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
        await this.codex.request("turn/interrupt", {
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
    this.store.updateTask(taskId, {
      status: "running",
      startedAt: new Date().toISOString(),
    });

    try {
      const project = this.store.getProject(task.workspace);
      let threadId = task.threadId ?? project?.threadId ?? null;

      if (threadId) {
        try {
          await this.codex.request("thread/resume", {
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
        const started = await this.codex.request("thread/start", {
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
      await this.codex.request("thread/goal/set", {
        threadId,
        objective: task.brief.objective,
        status: "active",
        tokenBudget: task.policy.tokenBudget,
      });

      const response = await this.codex.request("turn/start", {
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
        await this.codex.request("turn/interrupt", {
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
            await this.codex.request(
              "turn/interrupt",
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
    active.resolve?.();
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
          const resumed = await this.codex.request("thread/resume", {
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

  #onNotification(message) {
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
        this.store.addEvent(taskId, {
          type: "task.token_budget_exceeded",
          budget: task.policy.tokenBudget,
          measured: usage.total_tokens,
        });
        this.codex
          .request("turn/interrupt", {
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
      const current = this.store.getTask(taskId);
      if (!current || current.status !== "running") {
        this.#finishActiveTask(taskId);
        return;
      }
      const report = extractReport(
        params.turn,
        this.running.get(taskId)?.finalMessage ?? null,
      );
      const finalStatus =
        this.running.get(taskId)?.budgetInterruptRequested
          ? "interrupted"
          : params.turn.status === "completed"
          ? report.status
          : params.turn.status;
      this.store.updateTask(taskId, {
        status: finalStatus,
        result: report,
        error: params.turn.error ?? null,
        completedAt: new Date().toISOString(),
      });
      this.store.audit("task.completed", {
        taskId,
        status: finalStatus,
      });
      this.#finishActiveTask(taskId);
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

  #onServerRequest(message) {
    const params = message.params ?? {};
    const taskId = this.#taskForNotification(params);
    if (taskId) {
      this.store.addEvent(taskId, {
        method: message.method,
        action: "denied_by_control_plane",
      });
    }

    if (message.method === "item/commandExecution/requestApproval") {
      this.codex.respond(message.id, {
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
      this.codex.respond(message.id, { decision: "decline" });
      return;
    }
    if (message.method === "item/tool/requestUserInput") {
      this.codex.respond(message.id, { answers: {} });
      return;
    }
    if (message.method === "item/permissions/requestApproval") {
      this.codex.respond(message.id, {
        permissions: {},
        scope: "turn",
        strictAutoReview: true,
      });
      return;
    }
    this.codex.respond(message.id, {});
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
