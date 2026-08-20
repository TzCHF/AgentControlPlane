import { ControlPlaneError } from "./errors.js";

export const REROUTE_REASONS = Object.freeze([
  "quota_exhausted",
  "rate_limited",
  "executor_unavailable",
  "authentication_unavailable",
  "provider_unavailable",
]);

export const DEFAULT_REROUTE_CONFIG = Object.freeze({
  enabled: false,
  max_reroutes: 2,
  allowed_reasons: REROUTE_REASONS,
});

function compactFailure(error, context) {
  const details = error?.details ?? error?.error ?? null;
  return [
    error?.code,
    error?.status,
    error?.statusCode,
    error?.name,
    error?.message,
    details?.code,
    details?.status,
    details?.message,
    context?.code,
    context?.status,
    context?.message,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).toLowerCase())
    .join(" ");
}

function hasTaskFailureEvidence(context = {}) {
  const result = context.result ?? context;
  const tests = Array.isArray(result?.tests) ? result.tests : [];
  const blockers = Array.isArray(result?.blockers) ? result.blockers : [];
  const text = [result?.summary, ...tests, ...blockers]
    .map((value) =>
      typeof value === "string" ? value : JSON.stringify(value ?? ""),
    )
    .join(" ")
    .toLowerCase();
  return (
    tests.length > 0 ||
    /\b(test|build|implementation|validation)\b.{0,40}\b(fail|error|block)/.test(
      text,
    )
  );
}

export function classifyExecutorFailure(error, context = {}) {
  if (hasTaskFailureEvidence(context)) return "task_failure";
  const signal = compactFailure(error, context);

  if (/\b429\b|rate[_ -]?limit|too many requests|retry-after/.test(signal)) {
    return "rate_limited";
  }
  if (
    /\b402\b|insufficient[_ -]?(balance|credits?)|quota[_ -]?exhausted|usage limit|credit balance/.test(
      signal,
    )
  ) {
    return "quota_exhausted";
  }
  if (
    /\b401\b|\b403\b|invalid[_ -]?api[_ -]?key|authentication|unauthenticated|unauthorized|forbidden/.test(
      signal,
    )
  ) {
    return "authentication_unavailable";
  }
  if (
    /\b5\d\d\b|provider[_ -]?unavailable|upstream error|do_request_failed|bad gateway|service unavailable/.test(
      signal,
    )
  ) {
    return "provider_unavailable";
  }
  if (
    /spawn|enoent|executor[_ -]?unavailable|app-server|process exited|timed? ?out|timeout|connection refused|econnrefused/.test(
      signal,
    )
  ) {
    return "executor_unavailable";
  }
  return "task_failure";
}

export function resolveRerouteConfig(value = undefined) {
  const config = value ?? {};
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new ControlPlaneError(
      "invalid_config",
      "executor.reroute must be an object",
    );
  }
  const enabled = config.enabled ?? DEFAULT_REROUTE_CONFIG.enabled;
  const maxReroutes = config.max_reroutes ?? DEFAULT_REROUTE_CONFIG.max_reroutes;
  const allowed = config.allowed_reasons ?? DEFAULT_REROUTE_CONFIG.allowed_reasons;
  if (typeof enabled !== "boolean") {
    throw new ControlPlaneError(
      "invalid_config",
      "executor.reroute.enabled must be a boolean",
    );
  }
  if (!Number.isInteger(maxReroutes) || maxReroutes < 0 || maxReroutes > 10) {
    throw new ControlPlaneError(
      "invalid_config",
      "executor.reroute.max_reroutes must be an integer from 0 to 10",
    );
  }
  if (
    !Array.isArray(allowed) ||
    allowed.some((reason) => !REROUTE_REASONS.includes(reason))
  ) {
    throw new ControlPlaneError(
      "invalid_config",
      "executor.reroute.allowed_reasons contains an unsupported reason",
    );
  }
  return {
    enabled,
    max_reroutes: maxReroutes,
    allowed_reasons: [...new Set(allowed)],
  };
}
