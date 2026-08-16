// Request-level usage events for cross-system reconciliation (schema v2).
//
// The event schema is a closed whitelist: prompts, file contents, full
// workspace paths, Authorization headers, and API keys have no field here
// and are dropped by construction. Token dimensions obey fixed invariants:
// cached_input is a subset of input, reasoning_output is a subset of
// output, and total equals input plus output (never double-counted).
//
// Contract v2 separates the two request identifiers (asterroute_request_id
// for ACP-to-gateway reconciliation, upstream_request_id for upstream
// billing/diagnostics), uses 1-based attempts with is_retry derived as
// attempt > 1, and splits reconciliation into presence, token, and
// settlement states. Money is stored as integer micro-USD.

export const USAGE_SCHEMA_VERSION = 2;

export const USAGE_EVENT_FIELDS = [
  "schema_version",
  "client_event_id",
  "at",
  "asterroute_request_id",
  "upstream_request_id",
  "task_id",
  "turn_id",
  "task_kind",
  "request_kind",
  "attempt",
  "executor",
  "requested_model",
  "resolved_model",
  "protocol",
  "duration_ms",
  "outcome",
  "usage",
  "estimated_cost_microusd",
  "presence_state",
  "token_state",
  "settlement_state",
  "settled_cost_microusd",
  "credit_microusd",
  "net_cost_microusd",
  "currency",
  "pricing_version",
  "billing_revision",
];

export const TASK_KINDS = new Set(["production", "certification", "benchmark", "maintenance"]);
export const REQUEST_KINDS = new Set(["protocol_probe", "task_execution"]);

export function normalizeTaskKind(kind) {
  const value = String(kind ?? "");
  if (TASK_KINDS.has(value)) return value;
  if (value === "smoke") return "benchmark";
  return "production";
}

export function normalizeRequestKind(kind) {
  return REQUEST_KINDS.has(kind) ? kind : "task_execution";
}

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = Math.max(0, Number(usage.input_tokens ?? usage.prompt_tokens ?? 0));
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

function microUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 1_000_000);
}

function integerOrNull(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value));
}

function optionalString(value, limit) {
  return typeof value === "string" && value ? value.slice(0, limit) : null;
}

export function createUsageEvent(fields) {
  const event = {
    schema_version: USAGE_SCHEMA_VERSION,
    client_event_id: optionalString(fields.client_event_id, 64) ?? crypto.randomUUID(),
    at: fields.at ?? new Date().toISOString(),
    asterroute_request_id: optionalString(fields.asterroute_request_id, 128),
    upstream_request_id: optionalString(fields.upstream_request_id, 128),
    task_id: optionalString(fields.task_id, 64),
    turn_id: optionalString(fields.turn_id, 64),
    task_kind: normalizeTaskKind(fields.task_kind),
    request_kind: normalizeRequestKind(fields.request_kind),
    attempt: Math.max(1, Math.floor(Number(fields.attempt ?? 1))),
    executor: optionalString(fields.executor, 80),
    requested_model: optionalString(fields.requested_model, 120),
    resolved_model: optionalString(fields.resolved_model, 120),
    protocol: optionalString(fields.protocol, 20),
    duration_ms: Math.max(0, Number(fields.duration_ms ?? 0)),
    outcome: fields.outcome === "error" ? "error" : "ok",
    usage: normalizeUsage(fields.usage),
    estimated_cost_microusd:
      fields.estimated_cost != null
        ? microUsd(fields.estimated_cost)
        : integerOrNull(fields.estimated_cost_microusd),
    presence_state: fields.presence_state ?? (fields.asterroute_request_id ? "matched" : "client_only"),
    token_state: fields.token_state ?? "pending",
    settlement_state: fields.settlement_state ?? "pending",
    settled_cost_microusd:
      fields.settled_cost != null
        ? microUsd(fields.settled_cost)
        : integerOrNull(fields.settled_cost_microusd),
    credit_microusd: integerOrNull(fields.credit_microusd),
    net_cost_microusd: integerOrNull(fields.net_cost_microusd),
    currency: optionalString(fields.currency, 8) ?? "USD",
    pricing_version: optionalString(fields.pricing_version, 40),
    billing_revision: optionalString(fields.billing_revision, 40),
  };
  return event;
}

// v1 read adapter: v1 rows carried a single provider_request_id captured
// from the completion payload id, which is the gateway's own request id.
// The mapping rule is therefore knowable: provider_request_id maps to
// asterroute_request_id. Where the id source cannot be determined, the
// value stays unknown and presence_state stays unknown.
export function adaptV1Event(row) {
  return {
    schema_version: 1,
    client_event_id: optionalString(row.id, 64),
    at: row.at ?? null,
    asterroute_request_id: optionalString(row.provider_request_id, 128),
    upstream_request_id: null,
    task_id: optionalString(row.task_id, 64),
    turn_id: optionalString(row.turn_id, 64),
    task_kind: normalizeTaskKind(row.task_kind ?? "production"),
    request_kind: normalizeRequestKind(
      row.request_kind === "probe" ? "protocol_probe" : "task_execution",
    ),
    attempt: Math.max(1, Math.floor(Number(row.attempt ?? 0)) + 1),
    executor: optionalString(row.executor, 80),
    requested_model: optionalString(row.requested_model, 120),
    resolved_model: optionalString(row.resolved_model, 120),
    protocol: optionalString(row.protocol, 20),
    duration_ms: Math.max(0, Number(row.duration_ms ?? 0)),
    outcome: row.outcome === "error" ? "error" : "ok",
    usage: normalizeUsage(row.usage),
    estimated_cost_microusd: microUsd(row.estimated_cost),
    presence_state:
      row.provider_request_id != null
        ? row.provider_request_id
          ? "matched"
          : "unknown"
        : "client_only",
    token_state: row.reconciliation === "token_mismatch" ? "mismatch" : "pending",
    settlement_state:
      row.reconciliation === "settled" ? "settled" : "pending",
    settled_cost_microusd: microUsd(row.actual_cost),
    credit_microusd: null,
    net_cost_microusd: null,
    currency: optionalString(row.currency, 8) ?? "USD",
    pricing_version: null,
    billing_revision: null,
  };
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
