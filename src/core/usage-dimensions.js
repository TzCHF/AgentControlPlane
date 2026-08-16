// Dimensional aggregation over request-level usage events (contract v2).
//
// The production scope is task_kind=production AND request_kind=task_execution
// and includes every attempt (retries are attempts greater than one, never a
// separate request kind). Reconciliation splits into presence, token, and
// settlement states; money columns are integer micro-USD.

const DIMENSIONS = new Set([
  "task",
  "project",
  "model",
  "executor",
  "protocol",
  "request_kind",
  "task_kind",
]);

function projectOf(store, taskId) {
  if (!taskId) return "unattached";
  const task = store.getTask(taskId);
  if (!task) return "unattached";
  const parts = String(task.workspace ?? "").split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? "unattached";
}

function eventTaskKind(store, event) {
  if (!event.task_id) return "unattached";
  const task = store.getTask(event.task_id);
  return task?.kind ?? event.task_kind ?? "production";
}

function inProductionScope(store, event) {
  return (
    eventTaskKind(store, event) === "production" &&
    event.request_kind === "task_execution"
  );
}

export function usageDimensions(
  store,
  { by = "model", since = null, kind = null, limit = 100, offset = 0, production_only = true } = {},
) {
  const dimension = DIMENSIONS.has(by) ? by : "model";
  const { events } = store.listUsageEvents({ since, kind, limit: 100000, offset: 0 });
  const groups = new Map();
  for (const event of events) {
    const task = event.task_id ? store.getTask(event.task_id) : null;
    if (production_only && !inProductionScope(store, event)) continue;
    let key;
    switch (dimension) {
      case "task":
        key = event.task_id ?? "unattached";
        break;
      case "project":
        key = projectOf(store, event.task_id);
        break;
      case "model":
        key = event.resolved_model ?? "unknown";
        break;
      case "executor":
        key = event.executor ?? "unknown";
        break;
      case "protocol":
        key = event.protocol ?? "unknown";
        break;
      case "request_kind":
        key = event.request_kind ?? "task_execution";
        break;
      case "task_kind":
        key = event.task_kind ?? "production";
        break;
      default:
        key = "unknown";
    }
    const row = groups.get(key) ?? {
      [dimension]: key,
      events: 0,
      attempts: 0,
      retries: 0,
      succeeded: 0,
      failed: 0,
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 0,
      duration_ms: 0,
      estimated_cost_microusd: null,
      settled_cost_microusd: null,
      credit_microusd: null,
      net_cost_microusd: null,
      presence: {},
      token: {},
      settlement: {},
      task_kinds: {},
    };
    row.events += 1;
    row.attempts += event.attempt ?? 1;
    if ((event.attempt ?? 1) > 1) row.retries += 1;
    if (event.outcome === "ok") row.succeeded += 1;
    else row.failed += 1;
    const usage = event.usage ?? {};
    row.input_tokens += usage.input_tokens ?? 0;
    row.cached_input_tokens += usage.cached_input_tokens ?? 0;
    row.output_tokens += usage.output_tokens ?? 0;
    row.reasoning_output_tokens += usage.reasoning_output_tokens ?? 0;
    row.total_tokens += usage.total_tokens ?? 0;
    row.duration_ms += event.duration_ms ?? 0;
    if (event.estimated_cost_microusd != null) {
      row.estimated_cost_microusd =
        (row.estimated_cost_microusd ?? 0) + event.estimated_cost_microusd;
    }
    if (event.settled_cost_microusd != null) {
      row.settled_cost_microusd =
        (row.settled_cost_microusd ?? 0) + event.settled_cost_microusd;
    }
    if (event.credit_microusd != null) {
      row.credit_microusd = (row.credit_microusd ?? 0) + event.credit_microusd;
    }
    if (event.net_cost_microusd != null) {
      row.net_cost_microusd =
        (row.net_cost_microusd ?? 0) + event.net_cost_microusd;
    }
    const presence = event.presence_state ?? "client_only";
    const token = event.token_state ?? "pending";
    const settlement = event.settlement_state ?? "pending";
    row.presence[presence] = (row.presence[presence] ?? 0) + 1;
    row.token[token] = (row.token[token] ?? 0) + 1;
    row.settlement[settlement] = (row.settlement[settlement] ?? 0) + 1;
    const taskKind = task?.kind ?? event.task_kind ?? "unattached";
    row.task_kinds[taskKind] = (row.task_kinds[taskKind] ?? 0) + 1;
    groups.set(key, row);
  }
  const rows = [...groups.values()].sort((a, b) =>
    String(a[dimension]).localeCompare(String(b[dimension])),
  );
  const bounded = Math.min(500, Math.max(1, Number(limit) || 100));
  const start = Math.max(0, Number(offset) || 0);
  return {
    by: dimension,
    since: since ?? null,
    kind: kind ?? null,
    production_only,
    total_groups: rows.length,
    offset: start,
    rows: rows.slice(start, start + bounded),
  };
}

export function reconcileUsage(store, providerRows = []) {
  const { events } = store.listUsageEvents({ limit: 100000, offset: 0 });
  const byRequestId = new Map();
  for (const event of events) {
    if (event.asterroute_request_id) {
      byRequestId.set(event.asterroute_request_id, event);
    }
  }
  const seenEvents = new Set();
  const statuses = {
    presence: { matched: 0, client_only: 0, provider_only: 0, unknown: 0 },
    token: { match: 0, mismatch: 0, pending: 0 },
    settlement: { settled: 0, cost_pending: 0, pending: 0 },
  };
  for (const event of events) {
    if (!event.asterroute_request_id) {
      statuses.presence.client_only += 1;
      statuses.settlement.pending += 1;
      continue;
    }
    if (!seenEvents.has(event.asterroute_request_id)) {
      seenEvents.add(event.asterroute_request_id);
      statuses.presence.matched += 1;
    }
  }
  const processed = new Set();
  const updates = [];
  for (const row of providerRows.slice(0, 200)) {
    const requestId = String(row?.request_id ?? "");
    if (!requestId || processed.has(requestId)) continue;
    processed.add(requestId);
    const event = byRequestId.get(requestId);
    if (!event) {
      statuses.presence.provider_only += 1;
      continue;
    }
    statuses.presence.matched -= 1;
    const providerTokens = Number(row.total_tokens);
    const tokenState =
      Number.isFinite(providerTokens) &&
      providerTokens !== (event.usage?.total_tokens ?? 0)
        ? "mismatch"
        : "match";
    statuses.token[tokenState] += 1;
    const settlement =
      row.settled_cost_microusd != null ? "settled" : "cost_pending";
    statuses.settlement[settlement] += 1;
    updates.push({
      request_id: requestId,
      presence_state: "matched",
      token_state: tokenState,
      settlement_state: settlement,
      settled_cost_microusd: row.settled_cost_microusd ?? null,
      credit_microusd: row.credit_microusd ?? null,
      net_cost_microusd: row.net_cost_microusd ?? null,
      currency: row.currency ?? "USD",
      pricing_version: row.pricing_version ?? null,
      billing_revision: row.billing_revision ?? null,
    });
  }
  store.applyReconciliations(updates);
  return { statuses, applied: updates.length };
}
