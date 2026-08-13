import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./core/config.js";
import { sendError, sendJson, readJson, routeParts } from "./core/http.js";
import { Orchestrator } from "./core/orchestrator.js";
import { publicModels, publicProfiles } from "./core/profiles.js";
import { RateLimiter } from "./core/rate-limit.js";
import { TaskStore } from "./core/store.js";
import { CodexExecutor } from "./executors/codex-executor.js";
import { ClaudeCodeExecutor } from "./executors/claude-code-executor.js";
import { OpenCodeExecutor } from "./executors/opencode-executor.js";
import { OpenAICompatibleExecutor } from "./executors/openai-compatible-executor.js";
import { assertExecutor } from "./executors/executor.js";
import { assertLifecycle } from "./executors/lifecycle.js";
import { createMcpHandler } from "./mcp/server.js";

function buildExecutor(config, provider) {
  if (provider === "openai-compatible") {
    const options = config.executor.openaiCompat ?? {};
    return new OpenAICompatibleExecutor({
      baseUrl: options.baseUrl,
      apiKey:
        process.env.AGENT_CONTROL_OPENAI_KEY ??
        options.apiKey ??
        null,
      model: options.model,
      protocol: options.protocol,
      workspaceRoots: config.workspaceRoots,
    });
  }
  if (provider === "deepseek") {
    const options = config.executor.deepseek ?? {};
    return new OpenAICompatibleExecutor({
      baseUrl: options.baseUrl,
      apiKey: process.env[options.apiKeyEnv] ?? options.apiKey ?? null,
      model: options.model,
      protocol: options.protocol,
      workspaceRoots: config.workspaceRoots,
    });
  }
  if (provider === "claude") {
    const options = config.executor.claude ?? {};
    return new ClaudeCodeExecutor({
      command: options.command,
      model: options.model ?? null,
      allowedTools: options.allowedTools,
      permissionMode: options.permissionMode,
      maxTurns: options.maxTurns,
      workspaceRoots: config.workspaceRoots,
    });
  }
  if (provider === "opencode") {
    const options = config.executor.opencode ?? {};
    return new OpenCodeExecutor({
      command: options.command,
      model: options.model ?? null,
      agent: options.agent ?? null,
      autoApprove: options.autoApprove,
      workspaceRoots: config.workspaceRoots,
    });
  }
  return new CodexExecutor({
    command: config.codex.command,
    disabledFeatures: config.codex.disabledFeatures,
  });
}

function buildExecutors(config) {
  const providers = [
    "codex",
    "openai-compatible",
    "deepseek",
    "claude",
    "opencode",
  ];
  const executors = new Map();
  for (const provider of providers) {
    executors.set(provider, buildExecutor(config, provider));
  }
  return executors;
}

export async function createApplication(overrides = {}) {
  const config = overrides.config ?? loadConfig();
  config.publicProfiles = () => publicProfiles(config);
  const store =
    overrides.store ??
    new TaskStore(
      config.stateDir,
      config.limits.maxStoredEventsPerTask,
      config.limits.maxStoredTasks,
      config.limits.maxAuditBytes,
      config.audit?.integrityKey,
    );
  const rateLimiter = config.limits?.rateLimit?.enabled
    ? new RateLimiter({
        windowMs: config.limits.rateLimit.windowMs,
        max: config.limits.rateLimit.max,
      })
    : null;
  let executors;
  let defaultProvider;
  if (overrides.executor || overrides.codex) {
    const codex = assertExecutor(
      overrides.executor ?? overrides.codex,
      { execution: overrides.startCodex !== false },
    );
    executors = new Map([["codex", codex]]);
    defaultProvider = "codex";
  } else {
    executors = buildExecutors(config);
    defaultProvider = config.executor?.provider ?? "codex";
    for (const executor of executors.values()) {
      assertLifecycle(executor);
    }
    assertExecutor(executors.get(defaultProvider), {
      execution: overrides.startCodex !== false,
    });
  }
  const codex = executors.get(defaultProvider);
  let orchestrator = overrides.orchestrator;
  if (!orchestrator) {
    orchestrator = new Orchestrator({
      config,
      store,
      executors,
      defaultProvider,
    });
  }
  if (overrides.startCodex !== false) {
    await orchestrator.start();
  }
  const handleMcp = createMcpHandler({ orchestrator, store, config });

  function tokenMatches(request) {
    if (!config.server.authToken) return true;
    const authorization = request.headers.authorization ?? "";
    const supplied = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const expected = Buffer.from(config.server.authToken);
    const actual = Buffer.from(supplied);
    return (
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual)
    );
  }

  function originAllowed(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    return config.server.allowedOrigins.includes(origin);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const { url, parts } = routeParts(request);

      if (!originAllowed(request)) {
        sendJson(response, 403, {
          error: { code: "origin_denied", message: "Origin is not allowed" },
        });
        return;
      }

      const isHealth = request.method === "GET" && url.pathname === "/health";
      if (!isHealth && rateLimiter) {
        const key = request.socket.remoteAddress ?? "unknown";
        const decision = rateLimiter.consume(key);
        if (!decision.allowed) {
          sendJson(
            response,
            429,
            {
              error: {
                code: "rate_limited",
                message: "Too many requests",
              },
            },
            { "retry-after": String(decision.retryAfterSeconds) },
          );
          return;
        }
      }
      if (!isHealth && !tokenMatches(request)) {
        sendJson(
          response,
          401,
          {
            error: {
              code: "unauthorized",
              message: "A valid bearer token is required",
            },
          },
          { "www-authenticate": 'Bearer realm="AgentControlPlane"' },
        );
        return;
      }

      if (isHealth) {
        sendJson(response, 200, {
          status: "ok",
          service: "agent-control-plane",
          version: "0.2.0",
          codex_ready: Boolean(codex.ready),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/diagnostics") {
        sendJson(response, 200, {
          codex_ready: Boolean(codex.ready),
          codex_command: config.codex?.command ?? null,
          runtime: orchestrator.getRuntimeHealth(),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/profiles") {
        sendJson(response, 200, { profiles: publicProfiles(config) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/models") {
        sendJson(response, 200, {
          models: publicModels(orchestrator.getModels()),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/tasks") {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
        sendJson(response, 200, { tasks: store.listTasks(limit) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/tasks") {
        const body = await readJson(request);
        const task = orchestrator.dispatch(body);
        sendJson(response, 202, { task });
        return;
      }

      if (
        request.method === "GET" &&
        parts.length === 3 &&
        parts[0] === "v1" &&
        parts[1] === "tasks"
      ) {
        const task = store.getTask(
          parts[2],
          url.searchParams.get("events") === "1",
        );
        if (!task) {
          sendJson(response, 404, {
            error: { code: "task_not_found", message: "Task not found" },
          });
          return;
        }
        sendJson(response, 200, { task });
        return;
      }

      if (
        request.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "v1" &&
        parts[1] === "tasks" &&
        parts[3] === "follow-up"
      ) {
        const body = await readJson(request);
        const task = orchestrator.continueTask(parts[2], body);
        sendJson(response, 202, { task });
        return;
      }

      if (
        request.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "v1" &&
        parts[1] === "tasks" &&
        parts[3] === "cancel"
      ) {
        const task = await orchestrator.cancel(parts[2]);
        sendJson(response, 200, { task });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/usage") {
        sendJson(response, 200, { usage: store.usageReport() });
        return;
      }

      if (
        url.pathname === "/mcp" &&
        ["POST", "GET", "DELETE"].includes(request.method)
      ) {
        const body =
          request.method === "POST"
            ? await readJson(request, 1024 * 1024)
            : undefined;
        await handleMcp(request, response, body);
        return;
      }

      sendJson(response, 404, {
        error: { code: "not_found", message: "Route not found" },
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  return {
    config,
    store,
    codex,
    orchestrator,
    server,
    async close() {
      for (const executor of executors.values()) {
        await Promise.resolve(executor.stop()).catch(() => {});
      }
      if (server.listening) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  };
}

export async function main() {
  const app = await createApplication();
  app.server.listen(app.config.server.port, app.config.server.host, () => {
    console.log(
      `AgentControlPlane listening on http://${app.config.server.host}:${app.config.server.port}`,
    );
  });

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
