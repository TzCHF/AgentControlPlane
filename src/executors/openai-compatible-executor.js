import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ControlPlaneError } from "../core/errors.js";
import { ExecutorAdapter } from "./executor.js";

const TOOLS = [
  {
    type: "function",
    name: "read_file",
    description: "Read a UTF-8 file inside the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "write_file",
    description: "Write a UTF-8 file inside the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace." },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "shell",
    description: "Run a shell command with the workspace as the working directory.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
];

const TOOLS_CHAT = TOOLS.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveInsideWorkspace(workspace, inputPath) {
  const target = path.resolve(workspace, inputPath);
  if (!isInside(workspace, target)) {
    throw new ControlPlaneError(
      "tool_path_denied",
      `Path is outside the workspace: ${inputPath}`,
    );
  }
  return target;
}

function runShell(workspace, command, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: workspace,
      shell: true,
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        WINDIR: process.env.WINDIR ?? "",
        TEMP: process.env.TEMP ?? "",
        TMP: process.env.TMP ?? "",
        USERPROFILE: process.env.USERPROFILE ?? "",
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).slice(0, 4000);
      resolve({ ok: code === 0, exitCode: code, output });
    });
  });
}

export class OpenAICompatibleExecutor extends ExecutorAdapter {
  constructor({
    baseUrl,
    apiKey = null,
    model = "deepseek/deepseek-v4-pro",
    protocol = "responses",
    requestTimeoutMs = 30000,
    maxToolRounds = 20,
    workspaceRoots = [],
  } = {}) {
    super({
      id: "openai-compatible",
      displayName: "OpenAI Compatible (OpenCodex)",
      capabilities: {
        persistentThreads: false,
        tokenUsage: true,
        hardInterrupt: true,
        subagents: false,
      },
    });
    if (!baseUrl || typeof baseUrl !== "string") {
      throw new ControlPlaneError(
        "invalid_config",
        "openaiCompatible.baseUrl is required",
      );
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey ?? null;
    this.model = model;
    this.protocol = protocol === "chat" ? "chat" : "responses";
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxToolRounds = maxToolRounds;
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
      turn.controller?.abort();
    }
    this.turns.clear();
  }

  request() {
    return Promise.reject(
      new ControlPlaneError(
        "unsupported",
        "OpenAICompatibleExecutor exposes the lifecycle methods directly",
      ),
    );
  }

  respond() {}

  async listModels() {
    try {
      const body = await this.#fetchJson("GET", "/models");
      return { data: Array.isArray(body?.data) ? body.data : [] };
    } catch {
      return { data: [] };
    }
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
    const controller = new AbortController();
    this.turns.set(turnId, { controller, threadId, cwd });
    queueMicrotask(() => {
      this.#runTurn(turnId, { threadId, input, model, cwd, outputSchema }).catch(
        (error) => {
          this.emit("notification", {
            method: "turn/completed",
            params: {
              threadId,
              turn: {
                id: turnId,
                status: "failed",
                error: { message: error.message },
                items: [],
              },
            },
          });
        },
      );
    });
    return { turn: { id: turnId } };
  }

  async interruptTurn({ turnId } = {}) {
    const turn = this.turns.get(turnId);
    turn?.controller?.abort();
    this.turns.delete(turnId);
    return {};
  }

  async #runTurn(turnId, { threadId, input, model, cwd, outputSchema }) {
    if (this.protocol === "chat") {
      return this.#runChatTurn(turnId, {
        threadId,
        input,
        model,
        cwd,
        outputSchema,
      });
    }
    const controller = this.turns.get(turnId)?.controller;
    const brief = this.#extractBrief(input);
    const instructions = this.#buildInstructions(outputSchema);
    const inputItems = [
      { role: "user", content: brief },
    ];
    let usage = this.#zeroUsage();

    for (let round = 0; round < this.maxToolRounds; round += 1) {
      if (controller?.signal.aborted) break;
      const response = await this.#responses(
        inputItems,
        { model: model ?? this.model, instructions, controller },
      );
      usage = this.#addUsage(usage, response.usage);
      const goal = this.goals.get(threadId);
      if (goal) {
        goal.tokensUsed = Math.max(goal.tokensUsed, usage.total_tokens);
      }
      this.emit("notification", {
        method: "thread/tokenUsage/updated",
        params: {
          threadId,
          turnId,
          tokenUsage: {
            last: this.#toNotifiedUsage(usage),
            total: this.#toNotifiedUsage(usage),
          },
        },
      });
      const output = Array.isArray(response.output) ? response.output : [];
      const toolCalls = output.filter(
        (item) => item.type === "function_call" && typeof item.name === "string",
      );
      if (toolCalls.length === 0) {
        const text = this.#normalizeReport(this.#extractFinalText(output));
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId,
            turn: {
              id: turnId,
              status: "completed",
              items: [
                {
                  type: "agentMessage",
                  phase: "final_answer",
                  text,
                },
              ],
            },
          },
        });
        return;
      }

      for (const call of toolCalls) {
        const result = await this.#executeTool(call, cwd);
        const callId = call.call_id ?? call.id;
        inputItems.push({
          type: "function_call",
          call_id: callId,
          name: call.name,
          arguments:
            typeof call.arguments === "string"
              ? call.arguments
              : JSON.stringify(call.arguments ?? {}),
        });
        inputItems.push({
          type: "function_call_output",
          call_id: callId,
          output: result,
        });
      }
    }

    throw new ControlPlaneError(
      "tool_round_limit",
      `Exceeded ${this.maxToolRounds} tool rounds`,
    );
  }

  #extractBrief(input) {
    const text = Array.isArray(input)
      ? input
          .map((item) => (typeof item?.text === "string" ? item.text : ""))
          .filter(Boolean)
          .join("\n")
      : typeof input === "string"
        ? input
        : "";
    return text || "Complete the task.";
  }

  #buildInstructions(outputSchema) {
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
      "Work only inside the provided workspace using the read_file, write_file, and shell tools.",
      "Verify your changes and return a compact final report.",
      "The report must be a JSON object with keys: status, summary, changed_files, tests, blockers, next_action.",
      schemaLine,
    ]
      .filter(Boolean)
      .join("\n");
  }

  #extractFinalText(output) {
    const message = output.findLast(
      (item) => item.type === "message" || item.type === "output_text",
    );
    if (message?.content && Array.isArray(message.content)) {
      const text = message.content
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("");
      if (text) return text;
    }
    if (typeof message?.text === "string") return message.text;
    const raw = output.findLast((item) => typeof item.text === "string");
    return raw?.text ?? "{}";
  }

  #stripFence(text) {
    const match = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
    return match ? match[1] : text;
  }

  #normalizeStatus(status) {
    if (["completed", "partial", "blocked", "failed"].includes(status)) {
      return status;
    }
    if (status === "success") return "completed";
    if (status === "error") return "failed";
    return "completed";
  }

  #normalizeReport(text) {
    const cleaned = this.#stripFence(text).trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return cleaned || "{}";
    }
    if (!parsed || typeof parsed !== "object") return cleaned;
    const tests = Array.isArray(parsed.tests)
      ? parsed.tests.map((entry) => ({
          command: String(entry?.command ?? ""),
          status: ["passed", "failed", "not_run"].includes(entry?.status)
            ? entry.status
            : "not_run",
          detail: entry?.detail == null ? null : String(entry.detail),
        }))
      : [];
    const changedFiles = Array.isArray(parsed.changed_files)
      ? parsed.changed_files.map((item) => String(item))
      : [];
    const blockers = Array.isArray(parsed.blockers)
      ? parsed.blockers.map((item) => String(item))
      : [];
    const report = {
      status: this.#normalizeStatus(parsed.status),
      summary: String(parsed.summary ?? ""),
      changed_files: changedFiles,
      tests,
      blockers,
      next_action: parsed.next_action == null ? null : String(parsed.next_action),
    };
    return JSON.stringify(report);
  }

  async #executeTool(call, cwd) {
    let args = call.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    try {
      if (call.name === "read_file") {
        const target = resolveInsideWorkspace(cwd, args.path);
        const text = fs.readFileSync(target, "utf8").slice(0, 4000);
        return JSON.stringify({ ok: true, content: text });
      }
      if (call.name === "write_file") {
        const target = resolveInsideWorkspace(cwd, args.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, String(args.content ?? ""), "utf8");
        return JSON.stringify({ ok: true, wrote: target });
      }
      if (call.name === "shell") {
        const result = await runShell(cwd, String(args.command ?? ""));
        return JSON.stringify(result);
      }
      return JSON.stringify({ ok: false, error: `Unknown tool: ${call.name}` });
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #runChatTurn(turnId, { threadId, input, model, cwd, outputSchema }) {
    const controller = this.turns.get(turnId)?.controller;
    const brief = this.#extractBrief(input);
    const instructions = this.#buildInstructions(outputSchema);
    const messages = [
      { role: "system", content: instructions },
      { role: "user", content: brief },
    ];
    let usage = this.#zeroUsage();

    for (let round = 0; round < this.maxToolRounds; round += 1) {
      if (controller?.signal.aborted) break;
      const response = await this.#callChat(messages, {
        model: model ?? this.model,
        controller,
      });
      usage = this.#addUsage(usage, response.usage);
      const goal = this.goals.get(threadId);
      if (goal) {
        goal.tokensUsed = Math.max(goal.tokensUsed, usage.total_tokens);
      }
      this.emit("notification", {
        method: "thread/tokenUsage/updated",
        params: {
          threadId,
          turnId,
          tokenUsage: {
            last: this.#toNotifiedUsage(usage),
            total: this.#toNotifiedUsage(usage),
          },
        },
      });

      if (response.toolCalls.length === 0) {
        const text = this.#normalizeReport(response.finalText);
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId,
            turn: {
              id: turnId,
              status: "completed",
              items: [{ type: "agentMessage", phase: "final_answer", text }],
            },
          },
        });
        return;
      }

      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.rawToolCalls,
      });
      for (const call of response.toolCalls) {
        const result = await this.#executeTool(
          { name: call.name, arguments: call.arguments },
          cwd,
        );
        messages.push({
          role: "tool",
          tool_call_id: call.callId,
          content: result,
        });
      }
    }

    throw new ControlPlaneError(
      "tool_round_limit",
      `Exceeded ${this.maxToolRounds} tool rounds`,
    );
  }

  async #callChat(messages, { model, controller }) {
    const body = {
      model,
      messages,
      tools: TOOLS_CHAT,
      stream: false,
      max_tokens: 4000,
    };
    const response = await this.#fetchJson(
      "POST",
      "/chat/completions",
      body,
      controller,
    );
    const message = response?.choices?.[0]?.message ?? {};
    const rawToolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls
      : [];
    const toolCalls = rawToolCalls.map((call) => ({
      callId: call.id,
      name: call.function?.name,
      arguments:
        typeof call.function?.arguments === "string"
          ? call.function.arguments
          : JSON.stringify(call.function?.arguments ?? {}),
    }));
    return {
      content: typeof message.content === "string" ? message.content : null,
      toolCalls,
      rawToolCalls,
      finalText: typeof message.content === "string" ? message.content : "",
      usage: this.#normalizeChatUsage(response?.usage),
    };
  }

  #normalizeChatUsage(usage) {
    if (!usage) return this.#zeroUsage();
    return {
      input_tokens: Number(usage.prompt_tokens ?? 0),
      cached_input_tokens: Number(
        usage.prompt_tokens_details?.cached_tokens ?? 0,
      ),
      output_tokens: Number(usage.completion_tokens ?? 0),
      reasoning_output_tokens: Number(
        usage.completion_tokens_details?.reasoning_tokens ?? 0,
      ),
      total_tokens: Number(usage.total_tokens ?? 0),
    };
  }

  async #responses(inputItems, { model, instructions, controller }) {
    const body = {
      model,
      instructions,
      input: inputItems,
      tools: TOOLS,
      stream: false,
      max_output_tokens: 4000,
    };
    const response = await this.#fetchJson("POST", "/responses", body, controller);
    return {
      output: response?.output ?? [],
      usage: response?.usage ?? this.#zeroUsage(),
    };
  }

  async #fetchJson(method, pathname, body, controller) {
    const headers = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ControlPlaneError(
        "upstream_error",
        `OpenAI-compatible endpoint returned ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    return response.json();
  }

  #zeroUsage() {
    return {
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 0,
    };
  }

  #addUsage(current, usage) {
    if (!usage) return current;
    const inputTokens = Number(usage.input_tokens ?? 0);
    return {
      input_tokens: current.input_tokens + inputTokens,
      cached_input_tokens:
        current.cached_input_tokens + Number(usage.input_tokens_details?.cached_tokens ?? 0),
      output_tokens: current.output_tokens + Number(usage.output_tokens ?? 0),
      reasoning_output_tokens:
        current.reasoning_output_tokens +
        Number(usage.output_tokens_details?.reasoning_tokens ?? 0),
      total_tokens: current.total_tokens + Number(usage.total_tokens ?? 0),
    };
  }

  #toNotifiedUsage(usage) {
    return {
      inputTokens: usage.input_tokens,
      cachedInputTokens: usage.cached_input_tokens,
      outputTokens: usage.output_tokens,
      reasoningOutputTokens: usage.reasoning_output_tokens,
      totalTokens: usage.total_tokens,
    };
  }
}
