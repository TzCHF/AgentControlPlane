import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { asErrorPayload } from "../core/errors.js";
import { publicModels } from "../core/profiles.js";

const SERVER_INFO = { name: "agent-control-plane", version: "0.4.0" };

// OpenAI negotiates this protocol version through its connector flow.
// Prefer it over the SDK's latest so the discovery handshake matches what
// ChatGPT's control plane already speaks.
const DISCOVERY_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS.includes(
  "2025-06-18",
)
  ? "2025-06-18"
  : SUPPORTED_PROTOCOL_VERSIONS[0];

const SERVER_INSTRUCTIONS =
  "This is a control plane between an AI conversation and private engineering " +
  "executors. Call list_executors and list_profiles when execution settings " +
  "matter, then send a compact objective through dispatch_project. Leave " +
  "executor as auto unless the user requests a specific backend. Treat " +
  "dispatch tools as asynchronous: " +
  "it queues a background agent task and returns a task id; " +
  "poll task_status until it completes. If the structured result is blocked, " +
  "partial, failed, or shows a misunderstanding, correct the compact brief " +
  "with continue_project when it is safe to do so; ask the user only when a " +
  "real decision or permission is required. Never run engineering work directly " +
  "in the conversation; route all of it through these tools.";

const briefFields = {
  workspace: z.string().describe("Absolute project workspace path"),
  objective: z.string().min(1).describe("Compact engineering objective"),
  executor: z
    .string()
    .default("auto")
    .describe("Engineering executor id, or auto for capability-based routing"),
  constraints: z.array(z.string()).optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  context: z.array(z.string()).optional(),
  evidence_required: z.array(z.string()).optional(),
  profile: z.enum(["economy", "balanced", "deep"]).default("balanced"),
  model: z.string().nullable().optional(),
  reasoning_effort: z.string().nullable().optional(),
  max_subagents: z.number().int().min(0).max(8).nullable().optional(),
  token_budget: z.number().int().min(1000).max(250000).nullable().optional(),
};

function result(payload, message) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: message }],
  };
}

function failure(error) {
  const payload = { error: asErrorPayload(error) };
  return {
    isError: true,
    structuredContent: payload,
    content: [{ type: "text", text: payload.error.message }],
  };
}

function toJsonSchema(shape) {
  return zodToJsonSchema(z.object(shape), {
    target: "jsonSchema7",
    $refStrategy: "none",
  });
}

function buildToolSpecs({ orchestrator, store, config }) {
  const networkAccess = Boolean(config.codex?.networkAccess);
  return [
    {
      name: "dispatch_project",
      title: "Dispatch engineering project",
      description:
        "Queue a compact engineering brief. By default the control plane automatically selects an available local executor.",
      inputSchema: briefFields,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: networkAccess,
        idempotentHint: false,
      },
      async handler(args) {
        try {
          const task = orchestrator.dispatch(args);
          return result(
            { task },
            `Engineering task ${task.id} was queued with profile ${task.policy.name}.`,
          );
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "dispatch_opencode",
      title: "Dispatch engineering project to OpenCode",
      description:
        "Queue a compact engineering brief on the local OpenCode execution backend. Do not pass opencode as a model.",
      inputSchema: briefFields,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: networkAccess,
        idempotentHint: false,
      },
      async handler(args) {
        try {
          const task = orchestrator.dispatch({ ...args, executor: "opencode" });
          return result(
            { task },
            `OpenCode task ${task.id} was queued with profile ${task.policy.name}.`,
          );
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "task_status",
      title: "Read engineering task status",
      description:
        "Use this when checking whether a dispatched engineering task finished or needs attention.",
      inputSchema: {
        task_id: z.string().uuid(),
        include_events: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ task_id, include_events }) {
        const task = store.getTask(task_id, include_events);
        if (!task) return failure(new Error(`Unknown task: ${task_id}`));
        return result({ task }, `Task ${task.id} is ${task.status}.`);
      },
    },
    {
      name: "continue_project",
      title: "Continue engineering project",
      description:
        "Use this when acceptance or review found a concrete follow-up for the same persistent Codex project thread.",
      inputSchema: {
        task_id: z.string().uuid(),
        objective: z.string().min(1),
        constraints: z.array(z.string()).optional(),
        acceptance_criteria: z.array(z.string()).optional(),
        context: z.array(z.string()).optional(),
        evidence_required: z.array(z.string()).optional(),
        profile: z.enum(["economy", "balanced", "deep"]).optional(),
        model: z.string().nullable().optional(),
        reasoning_effort: z.string().nullable().optional(),
        max_subagents: z.number().int().min(0).max(8).nullable().optional(),
        token_budget: z.number().int().min(1000).max(250000).nullable().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: networkAccess,
        idempotentHint: false,
      },
      async handler({ task_id, ...args }) {
        try {
          const task = orchestrator.continueTask(task_id, args);
          return result(
            { task },
            `Follow-up task ${task.id} was queued on the existing project thread.`,
          );
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "cancel_task",
      title: "Cancel engineering task",
      description:
        "Use this when the user explicitly asks to stop an active engineering task.",
      inputSchema: { task_id: z.string().uuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ task_id }) {
        try {
          const task = await orchestrator.cancel(task_id);
          return result({ task }, `Task ${task.id} is cancelled.`);
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "list_tasks",
      title: "List engineering tasks",
      description:
        "Use this when the user asks what engineering work is queued, running, or recently completed.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ limit }) {
        return result({ tasks: store.listTasks(limit) }, "Returned recent tasks.");
      },
    },
    {
      name: "list_executors",
      title: "List engineering executors",
      description:
        "List discovered engineering backends, readiness, capabilities, and the automatically selected default.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler() {
        return result(
          {
            default_executor: orchestrator.getDefaultExecutorId(),
            executors: orchestrator.getExecutors(),
          },
          "Returned discovered engineering executors.",
        );
      },
    },
    {
      name: "list_profiles",
      title: "List engineering execution profiles",
      description:
        "Use this when choosing the model effort, subagent concurrency, and token budget for a project.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler() {
        return result(
          { profiles: config.publicProfiles() },
          "Returned execution profiles.",
        );
      },
    },
    {
      name: "list_models",
      title: "List available engineering models",
      description:
        "List the cached model catalog for the selected or specified executor.",
      inputSchema: { executor: z.string().default("auto") },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler({ executor }) {
        return result(
          {
            executor:
              executor === "auto"
                ? orchestrator.getDefaultExecutorId()
                : executor,
            models: publicModels(orchestrator.getModels(executor)),
          },
          "Returned the cached models advertised by the executor.",
        );
      },
    },
    {
      name: "usage_report",
      title: "Read measured engineering token usage",
      description:
        "Use this when the user asks how many Codex tokens the control plane has measured across tasks.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async handler() {
        return result(
          { usage: store.usageReport() },
          "Returned measured usage totals.",
        );
      },
    },
  ];
}

export function createMcpHandler({ orchestrator, store, config }) {
  const transports = new Map();
  const idleTimeoutMs = config.server.mcpSessionIdleMinutes * 60 * 1000;
  const toolSpecs = buildToolSpecs({ orchestrator, store, config });

  function buildServer() {
    const server = new McpServer(SERVER_INFO);
    for (const spec of toolSpecs) {
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: spec.inputSchema,
          annotations: spec.annotations,
        },
        spec.handler,
      );
    }
    return server;
  }

  // OpenAI sends `server/discover` as a stateless JSON-RPC request (no MCP
  // session) while connecting a remote connector. It expects a single result
  // describing the server and its tools, so the connector flow can preview and
  // register them before any standard `initialize`/`tools/list` handshake.
  function discoverResult() {
    return {
      protocolVersion: DISCOVERY_PROTOCOL_VERSION,
      serverInfo: SERVER_INFO,
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
      },
      instructions: SERVER_INSTRUCTIONS,
      tools: toolSpecs.map((spec) => ({
        name: spec.name,
        title: spec.title,
        description: spec.description,
        inputSchema: toJsonSchema(spec.inputSchema),
        annotations: spec.annotations,
      })),
      resources: [],
      prompts: [],
    };
  }

  function closeSession(id) {
    const entry = transports.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    transports.delete(id);
    entry.transport.close().catch(() => {});
  }

  function touchSession(id, transport) {
    const existing = transports.get(id);
    if (existing?.timer) clearTimeout(existing.timer);
    const timer = setTimeout(() => closeSession(id), idleTimeoutMs);
    timer.unref?.();
    transports.set(id, { transport, timer });
  }

  return async function handleMcp(request, response, parsedBody) {
    // OpenAI connector discovery: stateless, before any session exists.
    if (parsedBody?.method === "server/discover") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsedBody.id ?? null,
          result: discoverResult(),
        }),
      );
      return;
    }

    const sessionId = request.headers["mcp-session-id"];
    let transport = sessionId ? transports.get(sessionId)?.transport : null;
    if (sessionId && transport) touchSession(sessionId, transport);

    if (!transport && request.method === "POST" && isInitializeRequest(parsedBody)) {
      if (transports.size >= config.server.maxMcpSessions) {
        response.writeHead(503, {
          "content-type": "application/json",
          "retry-after": "30",
        });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: "MCP session limit reached" },
            id: parsedBody?.id ?? null,
          }),
        );
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => touchSession(id, transport),
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          const entry = transports.get(transport.sessionId);
          if (entry?.timer) clearTimeout(entry.timer);
          transports.delete(transport.sessionId);
        }
      };
      const server = buildServer();
      await server.connect(transport);
    } else if (!transport) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Invalid or missing MCP session" },
          id: null,
        }),
      );
      return;
    }
    await transport.handleRequest(request, response, parsedBody);
  };
}
