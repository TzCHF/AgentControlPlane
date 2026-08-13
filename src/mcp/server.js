import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asErrorPayload } from "../core/errors.js";
import { publicModels } from "../core/profiles.js";

const briefFields = {
  workspace: z.string().describe("Absolute project workspace path"),
  objective: z.string().min(1).describe("Compact engineering objective"),
  constraints: z.array(z.string()).optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  context: z.array(z.string()).optional(),
  evidence_required: z.array(z.string()).optional(),
  profile: z.enum(["economy", "balanced", "deep"]).default("balanced"),
  model: z.string().nullable().optional(),
  reasoning_effort: z.string().nullable().optional(),
  max_subagents: z.number().int().min(0).max(8).nullable().optional(),
  token_budget: z.number().int().min(1000).nullable().optional(),
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

export function createMcpHandler({ orchestrator, store, config }) {
  const transports = new Map();

  function buildServer() {
    const server = new McpServer({
      name: "agent-control-plane",
      version: "0.1.0",
    });

    server.registerTool(
      "dispatch_project",
      {
        title: "Dispatch engineering project",
        description:
          "Use this when the planning conversation is ready to send a compact, asynchronous engineering brief to a Codex project agent.",
        inputSchema: briefFields,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
          idempotentHint: false,
        },
      },
      async (args) => {
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
    );

    server.registerTool(
      "task_status",
      {
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
      },
      async ({ task_id, include_events }) => {
        const task = store.getTask(task_id, include_events);
        if (!task) return failure(new Error(`Unknown task: ${task_id}`));
        return result({ task }, `Task ${task.id} is ${task.status}.`);
      },
    );

    server.registerTool(
      "continue_project",
      {
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
          token_budget: z.number().int().min(1000).nullable().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
          idempotentHint: false,
        },
      },
      async ({ task_id, ...args }) => {
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
    );

    server.registerTool(
      "cancel_task",
      {
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
      },
      async ({ task_id }) => {
        try {
          const task = await orchestrator.cancel(task_id);
          return result({ task }, `Task ${task.id} is cancelled.`);
        } catch (error) {
          return failure(error);
        }
      },
    );

    server.registerTool(
      "list_tasks",
      {
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
      },
      async ({ limit }) =>
        result({ tasks: store.listTasks(limit) }, "Returned recent tasks."),
    );

    server.registerTool(
      "list_profiles",
      {
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
      },
      async () =>
        result({ profiles: config.publicProfiles() }, "Returned execution profiles."),
    );

    server.registerTool(
      "list_models",
      {
        title: "List available Codex engineering models",
        description:
          "Use this when the user wants to choose the engineering main-agent model or reasoning effort before dispatch.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
          idempotentHint: true,
        },
      },
      async () =>
        result(
          { models: publicModels(orchestrator.getModels()) },
          "Returned the models currently advertised by Codex.",
        ),
    );

    server.registerTool(
      "usage_report",
      {
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
      },
      async () =>
        result({ usage: store.usageReport() }, "Returned measured usage totals."),
    );
    return server;
  }

  return async function handleMcp(request, response, parsedBody) {
    const sessionId = request.headers["mcp-session-id"];
    let transport = sessionId ? transports.get(sessionId) : null;

    if (!transport && isInitializeRequest(parsedBody)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => transports.set(id, transport),
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
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
