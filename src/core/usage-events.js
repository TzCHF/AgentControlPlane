// Request-level usage events for cross-system reconciliation.
//
// The event schema is a closed whitelist: prompts, file contents, full
// workspace paths, Authorization headers, and API keys have no field here
// and are dropped by construction. Token dimensions obey fixed invariants:
// cached_input is a subset of input, reasoning_output is a subset of
// output, and total equals input plus output (never double-counted).

export const USAGE_EVENT_FIELDS = [
  "id",
  "at",
  "task_id",
  "turn_id",
  "request_kind",
  "attempt",
  "provider_request_id",
  "executor",
  "provider",
  "requested_model",
  "resolved_model",
  "protocol",
  "duration_ms",
  "outcome",
  "retry_of",
  "usage",
  "estimated_cost",
  "actual_cost",
  "reconciliation",
];

const KINDS = new Set(["execution", "probe", "retry", "certification", "smoke"]);

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;  const input = Math.max(0, Number(usage.input_tokens ?? usage.prompt_tokens ?? 0));
  const cached = Math.max(0, Number(usage.cached_input_tokens ?? 0));
  const output = Math.max(0, Number(usage.output_tokens ?? usage.completion_tokens ?? 0));
  const reasoning = Math.max(0, Number(usage.reasoning_output_tokens ?? 0));
  return {
    input_tokens: input,
    cached_input_tokens: Math.min(cached, input),
    uncached_input_tokens: Math.max(0, input - Math.min(cached, input)),
    output_tokens: output,
    reasoning_output_tokens: Math.min(reasoning, output),
    total_tokens: input + output,
  };
}

export function createUsageEvent(fields) {
  const usage = normalizeUsage(fields.usage);
  const event = {
    id: fields.id ?? crypto.randomUUID(),
    at: fields.at ?? new Date().toISOString(),
    task_id: fields.task_id ?? null,
    turn_id: fields.turn_id ?? null,
    request_kind: KINDS.has(fields.request_kind) ? fields.request_kind : "execution",
    attempt: Math.max(0, Number(fields.attempt ?? 0)),
    provider_request_id:
      typeof fields.provider_request_id === "string" &&
      fields.provider_request_id
        ? fields.provider_request_id.slice(0, 128)
        : null,
    executor: typeof fields.executor === "string" ? fields.executor.slice(0, 80) : null,
    provider: typeof fields.provider === "string" ? fields.provider.slice(0, 80) : null,
    requested_model:
      typeof fields.requested_model === "string" && fields.requested_model
        ? fields.requested_model.slice(0, 120)
        : null,
    resolved_model:
      typeof fields.resolved_model === "string" && fields.resolved_model
        ? fields.resolved_model.slice(0, 120)
        : null,
    protocol:
      typeof fields.protocol === "string" ? fields.protocol.slice(0, 20) : null,
    duration_ms: Math.max(0, Number(fields.duration_ms ?? 0)),
    outcome: fields.outcome === "error" ? "error" : "ok",
    retry_of:
      typeof fields.retry_of === "string" && fields.retry_of
        ? fields.retry_of.slice(0, 128)
        : null,
    usage,
    estimated_cost:
      fields.estimated_cost != null && Number.isFinite(Number(fields.estimated_cost))
        ? Number(fields.estimated_cost)
        : null,
    actual_cost:
      fields.actual_cost != null && Number.isFinite(Number(fields.actual_cost))
        ? Number(fields.actual_cost)
        : null,
    reconciliation: fields.reconciliation ?? "client_only",
  };
  return event;
}

export function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    return `"'${text}"`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function usageEventsToCsv(events) {
  const header = USAGE_EVENT_FIELDS.join(",");
  const rows = events.map((event) =>
    USAGE_EVENT_FIELDS.map((field) => csvCell(event[field])).join(","),
  );
  return [header, ...rows].join("\r\n");
}

export function reconcileStatus(event, providerRow = null) {
  if (!providerRow) return event.provider_request_id ? "matched" : "client_only";
  if (event.provider_request_id !== providerRow.request_id) return "client_only";
  const providerTokens = Number(providerRow.total_tokens ?? NaN);
  if (!Number.isFinite(providerTokens)) return "matched";
  if (providerTokens !== event.usage.total_tokens) return "token_mismatch";
  if (providerRow.actual_cost != null) return "settled";
  return "cost_pending";
}
