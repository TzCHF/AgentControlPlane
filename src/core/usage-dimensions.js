// Dimensional aggregation over request-level usage events.
//
// Groups are keyed by whitelisted dimension fields; tokens follow the fixed
// invariants enforced at event creation. Estimated and actual costs stay in
// separate columns and never merge. Group ordering is stable (lexicographic
// on the group key) so pagination is deterministic.

const DIMENSIONS = new Set([
  "task",
  "project",
  "model",
  "executor",
  "protocol",
  "request_kind",
]);

export function usageDimensions(
  store,
  { by = "model", since = null, kind = null, limit = 100, offset = 0, production_only = true } = {},
) {
  const dimension = DIMENSIONS.has(by) ? by : "model";
  const { events } = store.listUsageEvents({ since, kind, limit: 100000, offset: 0 });
  const groups = new Map();
  const projectOf = (taskId) => {
    if (!taskId) return "unattached";
    const task = store.getTask(taskId);
    if (!task) return "unattached";
    const parts = String(task.workspace ?? "").split(/[\\/]/).filter(Boolean);
    return parts.at(-1) ?? "unattached";
  };
  for (const event of events) {
    const task = event.task_id ? store.getTask(event.task_id) : null;
    if (production_only && task && task.kind !== "production") continue;
    let key;
    switch (dimension) {
      case "task":
        key = event.task_id ?? "unattached";
        break;
      case "project":
        key = projectOf(event.task_id);
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
        key = event.request_kind ?? "execution";
        break;
      default:
        key = "unknown";
    }
    const row = groups.get(key) ?? {
      [dimension]: key,
      events: 0,
      succeeded: 0,
      failed: 0,
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 0,
      duration_ms: 0,
      estimated_cost: null,
      actual_cost: null,
      reconciliation: {},
      task_kinds: {},
    };
    row.events += 1;
    if (event.outcome === "ok") row.succeeded += 1;
    else row.failed += 1;
    const usage = event.usage ?? {};
    row.input_tokens += usage.input_tokens ?? 0;
    row.cached_input_tokens += usage.cached_input_tokens ?? 0;
    row.output_tokens += usage.output_tokens ?? 0;
    row.reasoning_output_tokens += usage.reasoning_output_tokens ?? 0;
    row.total_tokens += usage.total_tokens ?? 0;
    row.duration_ms += event.duration_ms ?? 0;
    if (event.estimated_cost != null) {
      row.estimated_cost = (row.estimated_cost ?? 0) + event.estimated_cost;
    }
    if (event.actual_cost != null) {
      row.actual_cost = (row.actual_cost ?? 0) + event.actual_cost;
    }
    row.reconciliation[event.reconciliation] =
      (row.reconciliation[event.reconciliation] ?? 0) + 1;
    const taskKind = task?.kind ?? "unattached";
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
    total_groups: rows.length,
    offset: start,
    rows: rows.slice(start, start + bounded),
  };
}

export function reconcileUsage(store, providerRows = []) {
  const { events } = store.listUsageEvents({ limit: 100000, offset: 0 });
  const byRequestId = new Map();
  for (const event of events) {
    if (event.provider_request_id) {
      byRequestId.set(event.provider_request_id, event);
    }
  }
  const seen = new Set();
  const statuses = {
    matched: 0,
    client_only: 0,
    provider_only: 0,
    token_mismatch: 0,
    cost_pending: 0,
    settled: 0,
  };
  for (const event of events) {
    if (!event.provider_request_id) statuses.client_only += 1;
    else if (!seen.has(event.provider_request_id)) {
      seen.add(event.provider_request_id);
      statuses.matched += 1;
    }
  }
  const processed = new Set();
  for (const row of providerRows.slice(0, 200)) {
    const requestId = String(row?.request_id ?? "");
    if (!requestId || processed.has(requestId)) continue;
    processed.add(requestId);
    const event = byRequestId.get(requestId);
    if (!event) {
      statuses.provider_only += 1;
      continue;
    }
    statuses.matched -= 1;
    const providerTokens = Number(row.total_tokens);
    if (Number.isFinite(providerTokens) && providerTokens !== (event.usage?.total_tokens ?? 0)) {
      statuses.token_mismatch += 1;
    } else if (row.actual_cost != null) {
      statuses.settled += 1;
    } else {
      statuses.cost_pending += 1;
    }
  }
  return { statuses };
}
