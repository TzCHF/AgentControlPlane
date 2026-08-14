const TASK_OPEN = "<ACP_TASK>";
const TASK_CLOSE = "</ACP_TASK>";

function boundedString(value, limit = 24000) {
  return String(value ?? "").trim().slice(0, limit);
}

export function extractTaskEnvelope(text) {
  const source = String(text ?? "");
  const start = source.lastIndexOf(TASK_OPEN);
  if (start < 0) return null;
  const end = source.indexOf(TASK_CLOSE, start + TASK_OPEN.length);
  if (end < 0) return null;
  const payload = source.slice(start + TASK_OPEN.length, end).trim();
  if (!payload || payload.length > 64000) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function normalizeDispatch(envelope, settings = {}) {
  const objective = boundedString(envelope?.objective);
  const workspace = boundedString(settings.workspace, 4096);
  if (!objective) throw new Error("The ACP task has no objective");
  if (!workspace) throw new Error("Select a local workspace before dispatch");
  const request = {
    workspace,
    objective,
    profile: boundedString(
      envelope?.profile ?? settings.profile ?? "balanced",
      40,
    ),
    executor: boundedString(
      envelope?.executor ?? settings.executor ?? "auto",
      80,
    ),
  };
  for (const [source, target, limit] of [
    ["context", "context", 16000],
    ["constraints", "constraints", 12000],
    ["acceptance_criteria", "acceptance_criteria", 12000],
    ["preferred_files", "preferred_files", 8000],
    ["forbidden_actions", "forbidden_actions", 8000],
    ["model", "model", 120],
    ["reasoning_effort", "reasoning_effort", 40],
  ]) {
    const value = envelope?.[source];
    if (value == null) continue;
    request[target] = Array.isArray(value)
      ? value.map((entry) => boundedString(entry, 1000)).slice(0, 100)
      : boundedString(value, limit);
  }
  for (const [source, target] of [
    ["max_subagents", "max_subagents"],
    ["token_budget", "token_budget"],
  ]) {
    if (Number.isInteger(envelope?.[source])) {
      request[target] = envelope[source];
    }
  }
  return request;
}

export function formatTaskResult(task) {
  const payload = {
    task_id: task.id,
    status: task.status,
    executor: task.executor,
    result: task.result ?? null,
    error: task.error ?? null,
    usage: task.usage ?? null,
  };
  return `<ACP_RESULT>\n${JSON.stringify(payload, null, 2)}\n</ACP_RESULT>`;
}

export function controllerPrompt(settings = {}) {
  const profile = boundedString(settings.profile, 40) || "balanced";
  const executor = boundedString(settings.executor, 80) || "auto";
  return [
    "You are the planning controller for a local engineering control plane.",
    "Clarify the user's goal in this conversation before dispatching engineering work.",
    "When the request is implementation-ready, output exactly one JSON envelope in this form:",
    TASK_OPEN,
    JSON.stringify(
      {
        workspace: "DEFAULT",
        objective: "A concrete engineering objective",
        context: "Only the context the executor needs",
        constraints: ["Important constraints"],
        acceptance_criteria: ["Observable completion criteria"],
        profile,
        executor,
      },
      null,
      2,
    ),
    TASK_CLOSE,
    "DEFAULT is resolved locally by the companion; do not ask for or expose a local filesystem path.",
    "Do not claim the task ran until an <ACP_RESULT> envelope is returned.",
    "After receiving ACP_RESULT, explain the verified outcome and continue with a follow-up envelope only when needed.",
  ].join("\n");
}

export function stableEnvelopeId(envelope) {
  const source = JSON.stringify(envelope);
  let value = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}
