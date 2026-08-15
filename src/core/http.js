import { URL } from "node:url";
import { asErrorPayload, ControlPlaneError } from "./errors.js";

export async function readJson(request, maxBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new ControlPlaneError("request_too_large", "Request body is too large");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ControlPlaneError("invalid_json", "Request body is not valid JSON");
  }
}

export function sendJson(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    ...headers,
  });
  response.end(body);
}

export function sendHtml(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "content-security-policy":
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
      "connect-src 'self'; img-src data:; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

export function sendError(response, error) {
  const payload = asErrorPayload(error);
  const status =
    error instanceof ControlPlaneError
      ? error.code.endsWith("_not_found")
        ? 404
        : 400
      : 500;
  sendJson(response, status, { error: payload });
}

export function routeParts(request) {
  const url = new URL(request.url, "http://localhost");
  return {
    url,
    parts: url.pathname.split("/").filter(Boolean),
  };
}
