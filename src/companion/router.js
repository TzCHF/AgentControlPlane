import { publicProfiles } from "../core/profiles.js";
import { asErrorPayload, ControlPlaneError } from "../core/errors.js";
import { readJson, sendJson } from "../core/http.js";
import { isCompanionOrigin } from "./pairing-manager.js";

const TERMINAL_STATUSES = new Set([
  "completed",
  "partial",
  "blocked",
  "failed",
  "cancelled",
  "interrupted",
]);

function companionCors(origin) {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers":
      "authorization, content-type, x-acp-pairing-secret",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sendHtml(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  });
  response.end(body);
}

function approvalPage(pairing) {
  const action = `/companion/approve?id=${encodeURIComponent(pairing.pairing_id)}&secret=${encodeURIComponent(pairing.secret)}`;
  return `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>配对 AgentControlPlane</title>
<style>body{font:16px system-ui;margin:0;background:#0d1117;color:#e6edf3;display:grid;min-height:100vh;place-items:center}.card{width:min(520px,calc(100% - 40px));padding:28px;border:1px solid #30363d;border-radius:14px;background:#161b22}.code{font:700 30px ui-monospace;letter-spacing:.18em;margin:20px 0}.muted{color:#8b949e;overflow-wrap:anywhere}button{font:600 16px system-ui;padding:11px 18px;border:0;border-radius:8px;background:#238636;color:white;cursor:pointer}.ok{color:#3fb950}</style>
<main class="card"><h1>配对浏览器伴侣<br><span style="font-size:16px;color:#8b949e">Pair browser companion</span></h1><p>此页面由你刚才点击的「配对」操作打开，属于一次性本地批准。确认下方来源后点击「批准」即可完成配对。</p><div class="code">${escapeHtml(pairing.code.slice(0, 3))}-${escapeHtml(pairing.code.slice(3))}</div><p><strong>${escapeHtml(pairing.label)}</strong></p><p class="muted">${escapeHtml(pairing.origin)}</p><form method="post" action="${escapeHtml(action)}"><button type="submit">批准 Approve companion</button></form></main></html>`;
}

function approvedPage(pairing) {
  return `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentControlPlane 已配对</title>
<style>body{font:16px system-ui;margin:0;background:#0d1117;color:#e6edf3;display:grid;min-height:100vh;place-items:center}.card{width:min(520px,calc(100% - 40px));padding:28px;border:1px solid #30363d;border-radius:14px;background:#161b22}.ok{color:#3fb950}</style>
<main class="card"><h1 class="ok">配对成功 Paired</h1><p>${escapeHtml(pairing.label)} 现在可以派发受作用域限制的工程任务。你可以关闭此标签页，回到网页 AI 页面继续。</p></main></html>`;
}

function publicTask(task) {
  return {
    id: task.id,
    parent_task_id: task.parentTaskId ?? null,
    status: task.status,
    terminal: TERMINAL_STATUSES.has(task.status),
    workspace: task.workspace,
    executor: task.executor,
    profile: task.policy?.name ?? null,
    created_at: task.createdAt,
    started_at: task.startedAt,
    completed_at: task.completedAt,
    result: task.result,
    error: task.error,
    usage: task.usage,
  };
}

function bearerToken(request) {
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;
}

function isLoopback(address) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

export class CompanionRouter {
  constructor({ pairingManager, orchestrator, store, config }) {
    this.pairingManager = pairingManager;
    this.orchestrator = orchestrator;
    this.store = store;
    this.config = config;
  }

  matches(url) {
    if (this.config.companion?.enabled === false) return false;
    return (
      url.pathname === "/companion/approve" ||
      url.pathname.startsWith("/v1/companion/")
    );
  }

  originAllowed(request, url) {
    if (!this.matches(url)) return false;
    if (url.pathname === "/companion/approve") return true;
    const origin = request.headers.origin;
    if (origin) return isCompanionOrigin(origin);
    return request.method === "GET" || request.method === "HEAD";
  }

  sendError(request, response, error) {
    const origin = request.headers.origin;
    if (!isCompanionOrigin(origin)) return false;
    const status =
      error instanceof ControlPlaneError
        ? error.code.endsWith("_not_found")
          ? 404
          : 400
        : 500;
    sendJson(
      response,
      status,
      { error: asErrorPayload(error) },
      companionCors(origin),
    );
    return true;
  }

  async handle(request, response, url, parts) {
    const origin = request.headers.origin;
    if (request.method === "OPTIONS") {
      if (!isCompanionOrigin(origin)) {
        sendJson(response, 403, {
          error: {
            code: "companion_origin_denied",
            message: "Browser companion origin is not allowed 浏览器伴侣来源不被允许",
          },
        });
        return true;
      }
      response.writeHead(204, companionCors(origin));
      response.end();
      return true;
    }

    if (url.pathname === "/companion/approve") {
      return this.#approval(request, response, url);
    }

    const hasOrigin = Boolean(origin);
    if (
      (hasOrigin && !isCompanionOrigin(origin)) ||
      (!hasOrigin && request.method !== "GET" && request.method !== "HEAD")
    ) {
      sendJson(response, 403, {
        error: {
          code: "companion_origin_denied",
          message: "Browser companion origin is not allowed 浏览器伴侣来源不被允许",
        },
      });
      return true;
    }
    const cors = companionCors(origin);

    if (
      request.method === "POST" &&
      url.pathname === "/v1/companion/pairings"
    ) {
      if (!isLoopback(request.socket.remoteAddress)) {
        sendJson(
          response,
          403,
          {
            error: {
              code: "pairing_requires_loopback",
              message: "Browser companion pairing is local-only 伴侣配对仅限本地",
            },
          },
          cors,
        );
        return true;
      }
      const body = await readJson(request, 8 * 1024);
      const pairing = this.pairingManager.start({
        origin,
        label: body.label,
      });
      const requestedHost = request.headers.host ?? "";
      const host = /^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(
        requestedHost,
      )
        ? requestedHost
        : `127.0.0.1:${this.config.server.port}`;
      const approvalUrl = new URL(`http://${host}/companion/approve`);
      approvalUrl.searchParams.set("id", pairing.pairing_id);
      approvalUrl.searchParams.set("secret", pairing.pairing_secret);
      sendJson(
        response,
        201,
        {
          pairing_id: pairing.pairing_id,
          pairing_secret: pairing.pairing_secret,
          code: pairing.code,
          expires_at: pairing.expires_at,
          approval_url: approvalUrl.toString(),
        },
        cors,
      );
      return true;
    }

    if (
      request.method === "GET" &&
      parts.length === 4 &&
      parts[0] === "v1" &&
      parts[1] === "companion" &&
      parts[2] === "pairings"
    ) {
      const secret = request.headers["x-acp-pairing-secret"];
      const claim = this.pairingManager.claim(parts[3], secret, origin);
      sendJson(response, 200, claim, cors);
      return true;
    }

    const client = this.pairingManager.authenticate(
      bearerToken(request),
      origin,
    );
    if (!client) {
      sendJson(
        response,
        401,
        {
          error: {
            code: "companion_unauthorized",
            message: "A valid paired companion token is required 需要有效的伴侣令牌",
          },
        },
        { ...cors, "www-authenticate": 'Bearer realm="ACP Companion"' },
      );
      return true;
    }

    if (request.method === "GET" && url.pathname === "/v1/companion/options") {
      const recent = this.store
        .listTasks(100)
        .map((task) => task.workspace)
        .filter(Boolean);
      sendJson(
        response,
        200,
        {
          service: "agent-control-plane",
          version: "0.4.0",
          default_executor: this.orchestrator.getDefaultExecutorId?.() ?? "auto",
          executors: this.orchestrator.getExecutors?.() ?? [],
          profiles: publicProfiles(this.config),
          workspaces: [
            ...new Set([...(this.config.workspaceRoots ?? []), ...recent]),
          ],
        },
        cors,
      );
      return true;
    }

    if (
      request.method === "DELETE" &&
      url.pathname === "/v1/companion/session"
    ) {
      this.pairingManager.revoke(client.id);
      sendJson(response, 200, { revoked: true }, cors);
      return true;
    }

    if (request.method === "POST" && url.pathname === "/v1/companion/tasks") {
      const body = await readJson(request, 64 * 1024);
      const task = this.orchestrator.dispatch(body);
      this.pairingManager.rememberTask(client.id, task.id);
      sendJson(response, 202, { task: publicTask(task) }, cors);
      return true;
    }

    if (
      parts.length >= 4 &&
      parts[0] === "v1" &&
      parts[1] === "companion" &&
      parts[2] === "tasks"
    ) {
      const taskId = parts[3];
      if (!this.pairingManager.ownsTask(client.id, taskId)) {
        sendJson(
          response,
          404,
          { error: { code: "task_not_found", message: "Task not found 任务不存在" } },
          cors,
        );
        return true;
      }
      if (request.method === "GET" && parts.length === 4) {
        const task = this.store.getTask(taskId);
        if (!task) {
          sendJson(
            response,
            404,
            { error: { code: "task_not_found", message: "Task not found 任务不存在" } },
            cors,
          );
          return true;
        }
        sendJson(response, 200, { task: publicTask(task) }, cors);
        return true;
      }
      if (
        request.method === "POST" &&
        parts.length === 5 &&
        parts[4] === "follow-up"
      ) {
        const body = await readJson(request, 32 * 1024);
        const task = this.orchestrator.continueTask(taskId, body);
        this.pairingManager.rememberTask(client.id, task.id);
        sendJson(response, 202, { task: publicTask(task) }, cors);
        return true;
      }
      if (
        request.method === "POST" &&
        parts.length === 5 &&
        parts[4] === "cancel"
      ) {
        const task = await this.orchestrator.cancel(taskId);
        sendJson(response, 200, { task: publicTask(task) }, cors);
        return true;
      }
    }

    sendJson(
      response,
      404,
      { error: { code: "not_found", message: "Companion route not found 伴侣路由不存在" } },
      cors,
    );
    return true;
  }

  #approval(request, response, url) {
    if (!isLoopback(request.socket.remoteAddress)) {
      sendHtml(response, 403, "<h1>Local pairing only</h1>");
      return true;
    }
    const id = url.searchParams.get("id");
    const secret = url.searchParams.get("secret");
    if (request.method === "GET") {
      const pairing = this.pairingManager.inspect(id, secret);
      sendHtml(response, 200, approvalPage({ ...pairing, secret }));
      return true;
    }
    if (request.method === "POST") {
      const pairing = this.pairingManager.approve(id, secret);
      sendHtml(response, 200, approvedPage(pairing));
      return true;
    }
    sendHtml(response, 405, "<h1>Method not allowed</h1>");
    return true;
  }
}
