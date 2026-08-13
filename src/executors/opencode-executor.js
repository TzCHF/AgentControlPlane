import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { ControlPlaneError } from "../core/errors.js";
import { ExecutorAdapter } from "./executor.js";

function extractText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          return part.text ?? part.content ?? part.value ?? "";
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  return "";
}

// NOTE: The exact event schema of `opencode run --format json` is version
// specific. This normalizer is intentionally tolerant and reads the common
// shapes; adjust it against a real sample if the field names differ.
export function normalizeOpenCodeEvents(events) {
  let finalText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const data = event.data ?? event;
    const role = event.role ?? data.role ?? null;
    const type = event.type ?? data.type ?? null;

    if (role === "assistant" || type === "message" || type === "assistant") {
      const text =
        extractText(data.content) ||
        extractText(data.parts) ||
        extractText(data.text) ||
        extractText(event.message);
      if (text) finalText = text;
    }

    const usage = data.usage ?? event.usage ?? null;
    if (usage && typeof usage === "object") {
      inputTokens += Number(usage.input_tokens ?? usage.inputTokens ?? 0);
      outputTokens += Number(usage.output_tokens ?? usage.outputTokens ?? 0);
    }
  }

  return {
    finalText,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

export class OpenCodeExecutor extends ExecutorAdapter {
  constructor({
    command = "opencode",
    model = null,
    agent = null,
    autoApprove = true,
    workspaceRoots = [],
  } = {}) {
    super({
      id: "opencode",
      displayName: "OpenCode",
      capabilities: {
        persistentThreads: false,
        tokenUsage: true,
        hardInterrupt: true,
        subagents: false,
      },
    });
    this.command = command;
    this.model = model;
    this.agent = agent;
    this.autoApprove = Boolean(autoApprove);
    this.workspaceRoots = workspaceRoots;
    this.goals = new Map();
    this.turns = new Map();
  }

  async start() {
    this.ready = true;
  }

  async stop() {
    this.ready = false;
    for (const turn of this.turns.values()) {
      try {
        turn.child?.kill();
      } catch {
        // Ignore.
      }
    }
    this.turns.clear();
  }

  request() {
    return Promise.reject(
      new ControlPlaneError(
        "unsupported",
        "OpenCodeExecutor exposes the lifecycle methods directly",
      ),
    );
  }

  respond() {}

  async listModels() {
    return { data: [] };
  }

  async getSandboxReadiness() {
    return { status: "ready" };
  }

  async startThread({ cwd } = {}) {
    const threadId = randomUUID();
    this.goals.set(threadId, {
      objective: "",
      tokenBudget: 0,
      tokensUsed: 0,
      status: "active",
    });
    return { thread: { id: threadId, cwd: cwd ?? null } };
  }

  async resumeThread({ threadId } = {}) {
    if (!this.goals.has(threadId)) {
      throw new ControlPlaneError(
        "thread_not_found",
        `Unknown thread: ${threadId}`,
      );
    }
    return { thread: { id: threadId, turns: [] } };
  }

  async setGoal({ threadId, objective, tokenBudget } = {}) {
    const goal = this.goals.get(threadId);
    if (!goal) {
      throw new ControlPlaneError(
        "thread_not_found",
        `Unknown thread: ${threadId}`,
      );
    }
    goal.objective = objective ?? goal.objective;
    goal.tokenBudget = Number(tokenBudget ?? goal.tokenBudget ?? 0);
    goal.status = "active";
    return {};
  }

  async getGoal({ threadId } = {}) {
    const goal = this.goals.get(threadId);
    if (!goal) return { goal: null };
    const status =
      goal.tokenBudget > 0 && goal.tokensUsed >= goal.tokenBudget
        ? "budgetLimited"
        : goal.status;
    return {
      goal: {
        threadId,
        status,
        tokenBudget: goal.tokenBudget,
        tokensUsed: goal.tokensUsed,
      },
    };
  }

  async startTurn(params) {
    const { threadId, input, model, cwd, outputSchema } = params ?? {};
    const turnId = randomUUID();
    const child = this.#spawnOpenCode(
      this.#buildPrompt(input, outputSchema),
      model ?? this.model,
      cwd,
    );
    this.turns.set(turnId, { child, threadId });
    queueMicrotask(() => this.#runOpenCode(turnId, { threadId, child }));
    return { turn: { id: turnId } };
  }

  async interruptTurn({ turnId } = {}) {
    const turn = this.turns.get(turnId);
    try {
      turn?.child?.kill();
    } catch {
      // Ignore.
    }
    this.turns.delete(turnId);
    return {};
  }

  #spawnOpenCode(prompt, model, cwd) {
    const args = ["run", prompt, "--format", "json"];
    if (cwd) args.push("--dir", cwd);
    if (model) args.push("--model", model);
    if (this.agent) args.push("--agent", this.agent);
    if (this.autoApprove) args.push("--auto");
    args.push("--print-logs");
    const child = spawn(this.command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    child.stdin.end();
    return child;
  }

  #runOpenCode(turnId, { threadId, child }) {
    const events = [];
    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    lines.on("line", (line) => {
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip non-JSON lines.
      }
    });
    child.stderr.on("data", (chunk) => {
      this.emit("stderr", chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      this.#finishOpenCode(turnId, threadId, {
        status: "failed",
        error: error.message,
        resultText: "",
        usage: this.#zeroUsage(),
      });
    });
    child.on("close", (code) => {
      const normalized = normalizeOpenCodeEvents(events);
      const failed = code !== 0;
      this.#finishOpenCode(turnId, threadId, {
        status: failed ? "failed" : "completed",
        error: failed ? `opencode exited with code ${code}` : null,
        resultText: normalized.finalText,
        usage: normalized.usage,
      });
    });
  }

  #finishOpenCode(turnId, threadId, { status, error, resultText, usage }) {
    const goal = this.goals.get(threadId);
    if (goal) {
      goal.tokensUsed = Math.max(goal.tokensUsed, usage?.total_tokens ?? 0);
    }
    const notified = this.#notifiedUsage(usage ?? this.#zeroUsage());
    this.emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId,
        turnId,
        tokenUsage: { last: notified, total: notified },
      },
    });
    const items =
      status === "completed"
        ? [
            {
              type: "agentMessage",
              phase: "final_answer",
              text: this.#normalizeReport(resultText),
            },
          ]
        : [];
    this.emit("notification", {
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          id: turnId,
          status,
          error: error ? { message: error } : null,
          items,
        },
      },
    });
    this.turns.delete(turnId);
  }

  #buildPrompt(input, outputSchema) {
    const brief = Array.isArray(input)
      ? input
          .map((item) => (typeof item?.text === "string" ? item.text : ""))
          .filter(Boolean)
          .join("\n")
      : typeof input === "string"
        ? input
        : "";
    let schemaLine = "";
    if (outputSchema && typeof outputSchema === "object") {
      try {
        schemaLine = `\nReturn a JSON object matching this schema:\n${JSON.stringify(outputSchema)}`;
      } catch {
        schemaLine = "";
      }
    }
    return [
      "You are a secure software engineering execution agent.",
      "Work only inside the provided workspace.",
      "Verify your changes and return a compact final report.",
      "The report must be a JSON object with keys: status, summary, changed_files, tests, blockers, next_action.",
      schemaLine,
      "",
      "TASK:",
      brief,
    ]
      .filter((line) => line !== "")
      .join("\n");
  }

  #normalizeReport(text) {
    const cleaned = this.#stripFence(String(text ?? "")).trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return cleaned || "{}";
    }
    if (!parsed || typeof parsed !== "object") return cleaned;
    const status = ["completed", "partial", "blocked", "failed"].includes(
      parsed.status,
    )
      ? parsed.status
      : parsed.status === "success"
        ? "completed"
        : "completed";
    const tests = Array.isArray(parsed.tests)
      ? parsed.tests.map((entry) => ({
          command: String(entry?.command ?? ""),
          status: ["passed", "failed", "not_run"].includes(entry?.status)
            ? entry.status
            : "not_run",
          detail: entry?.detail == null ? null : String(entry.detail),
        }))
      : [];
    return JSON.stringify({
      status,
      summary: String(parsed.summary ?? ""),
      changed_files: Array.isArray(parsed.changed_files)
        ? parsed.changed_files.map((item) => String(item))
        : [],
      tests,
      blockers: Array.isArray(parsed.blockers)
        ? parsed.blockers.map((item) => String(item))
        : [],
      next_action: parsed.next_action == null ? null : String(parsed.next_action),
    });
  }

  #stripFence(text) {
    const match = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
    return match ? match[1] : text;
  }

  #notifiedUsage(usage) {
    return {
      inputTokens: usage.input_tokens,
      cachedInputTokens: 0,
      outputTokens: usage.output_tokens,
      reasoningOutputTokens: 0,
      totalTokens: usage.total_tokens,
    };
  }

  #zeroUsage() {
    return {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };
  }
}
