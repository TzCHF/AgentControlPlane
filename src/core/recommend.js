// Deterministic, provider-agnostic model recommendation.
//
// This module holds pure functions only: requirement extraction, candidate
// normalization, hard filtering, scoring, cost projection, and the result
// schema. It never calls a model, never switches the user's selection, never
// learns from history, and treats provider metadata as three-state
// (true / false / unknown); unknown stays a warning candidate and is never
// written down as false. Costs are integer micro-USD; missing prices stay
// unknown and are never treated as zero. Weights and context defaults live
// in config; they do not live here.

import crypto from "node:crypto";
import { extractTokenEstimate } from "./token-estimate.js";

export const RECOMMENDATION_VERSION = 1;

const PROFILE_REASONING = {
  economy: "low",
  balanced: "high",
  deep: "ultra",
};

const PROFILE_LATENCY_PREFERENCE = {
  economy: "low_latency",
  balanced: "balanced",
  deep: "none",
};

const PROFILE_COST_PREFERENCE = {
  economy: "cheapest",
  balanced: "balanced",
  deep: "best",
};

const VISION_KEYWORDS =
  /(截图|图片|图像|视觉|识别图|screenshot|image|vision|ocr|像素|pixel)/i;

export function extractTaskRequirements(
  { objective = "", profile = "balanced", reasoning_effort = null, allowed_models = null, model = null } = {},
  config = {},
) {
  const text = String(objective ?? "");
  const profileName = ["economy", "balanced", "deep"].includes(profile)
    ? profile
    : "balanced";
  const contextDefaults = config.recommendation?.contextTokens ?? {
    economy: 16000,
    balanced: 64000,
    deep: 128000,
  };
  const profileContext = Number(contextDefaults[profileName] ?? 64000);
  const briefTokens = Math.ceil(text.length / 3);
  return {
    version: RECOMMENDATION_VERSION,
    tools_required: true,
    vision_required: VISION_KEYWORDS.test(text),
    reasoning_level:
      ["low", "medium", "high", "ultra"].includes(reasoning_effort)
        ? reasoning_effort
        : PROFILE_REASONING[profileName],
    minimum_context_tokens: Math.max(profileContext, briefTokens),
    latency_preference: PROFILE_LATENCY_PREFERENCE[profileName],
    cost_preference: PROFILE_COST_PREFERENCE[profileName],
    required_protocols: [],
    allowed_models: Array.isArray(allowed_models)
      ? allowed_models.map((entry) => String(entry)).filter(Boolean)
      : [],
    profile: profileName,
    requested_model: typeof model === "string" && model ? model : null,
  };
}

export function normalizeCandidate(executorId, model) {
  const capabilities = model?.capabilities ?? null;
  const latency = model?.latency && typeof model.latency === "object"
    ? model.latency
    : null;
  const pricing = model?.pricing && typeof model.pricing === "object"
    ? model.pricing
    : null;
  const rawContext = model?.context;
  const rawLatencyAvg = latency?.avgMs;
  const rawLatencySamples = latency?.sampleCount;
  const rawFreshness = model?.metadata_freshness_seconds;
  return {
    model: model?.id ?? model?.model ?? null,
    executor: executorId,
    capabilities: capabilities
      ? {
          chat: capabilities.chat ?? null,
          responses: capabilities.responses ?? null,
          tools: capabilities.tools ?? null,
          reasoning: capabilities.reasoning ?? null,
          vision: capabilities.vision ?? null,
        }
      : { chat: null, responses: null, tools: null, reasoning: null, vision: null },
    status: model?.status ?? null,
    route_health: model?.route_health ?? null,
    context:
      rawContext != null && Number.isFinite(Number(rawContext))
        ? Number(rawContext)
        : null,
    latency_avg_ms:
      rawLatencyAvg != null && Number.isFinite(Number(rawLatencyAvg))
        ? Number(rawLatencyAvg)
        : null,
    latency_samples:
      rawLatencySamples != null && Number.isFinite(Number(rawLatencySamples))
        ? Number(rawLatencySamples)
        : 0,
    pricing: pricing
      ? {
          input: pricing.input != null && Number.isFinite(Number(pricing.input)) ? Number(pricing.input) : null,
          output: pricing.output != null && Number.isFinite(Number(pricing.output)) ? Number(pricing.output) : null,
          cached_input: pricing.cached_input != null && Number.isFinite(Number(pricing.cached_input))
            ? Number(pricing.cached_input)
            : null,
          reasoning: pricing.reasoning != null && Number.isFinite(Number(pricing.reasoning))
            ? Number(pricing.reasoning)
            : null,
          currency: pricing.currency ?? "USD",
          pricing_version: pricing.pricing_version ?? pricing.version ?? null,
        }
      : null,
    tier: model?.tier ?? model?.route_tier ?? null,
    preferred_protocol: model?.preferred_protocol ?? null,
    featured: model?.featured === true,
    metadata_freshness_seconds:
      rawFreshness != null && Number.isFinite(Number(rawFreshness))
        ? Number(rawFreshness)
        : null,
    capability_source: capabilities ? "declared" : "unknown",
  };
}

// Price normalization: provider prices are USD per million tokens, which
// equals micro-USD per token. Rates stay numeric; projected costs are
// rounded to integer micro-USD. Missing prices normalize to null and costs
// stay unknown.
export function normalizePricing(pricing) {
  if (!pricing || typeof pricing !== "object") return null;
  const input = pricing.input != null && Number.isFinite(Number(pricing.input))
    ? Number(pricing.input)
    : null;
  const output = pricing.output != null && Number.isFinite(Number(pricing.output))
    ? Number(pricing.output)
    : null;
  if (input == null && output == null) return null;
  const cached = pricing.cached_input != null && Number.isFinite(Number(pricing.cached_input))
    ? Number(pricing.cached_input)
    : input;
  const reasoning = pricing.reasoning != null && Number.isFinite(Number(pricing.reasoning))
    ? Number(pricing.reasoning)
    : output;
  return {
    input_microusd_per_token: input,
    cached_input_microusd_per_token: cached,
    output_microusd_per_token: output,
    reasoning_output_microusd_per_token: reasoning,
    currency: pricing.currency ?? "USD",
    pricing_version: pricing.pricing_version ?? pricing.version ?? null,
  };
}

// Cost projection over the three token scenarios. Cached input is billed at
// the cached rate only; reasoning tokens are billed at the reasoning rate
// only; each token is billed exactly once. The low/expected/high ordering
// is enforced, so low <= expected <= high.
export function computeCostRange(tokenEstimate, normalizedPricing) {
  if (!normalizedPricing || !tokenEstimate?.scenarios) return null;
  const compute = (scenario) => {
    const cached = scenario.cached_input_tokens;
    const uncached = Math.max(0, scenario.input_tokens - cached);
    const reasoning = scenario.reasoning_output_tokens;
    const plainOutput = Math.max(0, scenario.output_tokens - reasoning);
    const cachedCost = cached * (normalizedPricing.cached_input_microusd_per_token ?? 0);
    const inputCost = uncached * (normalizedPricing.input_microusd_per_token ?? 0);
    const outputCost = plainOutput * (normalizedPricing.output_microusd_per_token ?? 0);
    const reasoningCost = reasoning * (normalizedPricing.reasoning_output_microusd_per_token ?? 0);
    return Math.round(cachedCost + inputCost + outputCost + reasoningCost);
  };
  const low = compute(tokenEstimate.scenarios.low);
  const expected = compute(tokenEstimate.scenarios.expected);
  const high = compute(tokenEstimate.scenarios.high);
  const orderedLow = Math.min(low, expected);
  const orderedHigh = Math.max(high, expected);
  return {
    low_microusd: orderedLow,
    expected_microusd: expected,
    high_microusd: orderedHigh,
    currency: normalizedPricing.currency,
    pricing_version: normalizedPricing.pricing_version,
  };
}

export function filterCandidates(candidates, requirements, _config = {}) {
  const ranked = [];
  const excluded = [];
  for (const candidate of candidates) {
    const reasons = [];
    const warnings = [];

    if (!candidate.model || !candidate.executor) {
      excluded.push({ model: candidate.model, executor: candidate.executor, reasons: ["invalid_entry"] });
      continue;
    }

    if (requirements.allowed_models.length > 0 && !requirements.allowed_models.includes(candidate.model)) {
      excluded.push({ model: candidate.model, executor: candidate.executor, reasons: ["not_in_allowlist"] });
      continue;
    }

    if (candidate.status != null && !["live", "available", "active"].includes(String(candidate.status))) {
      excluded.push({ model: candidate.model, executor: candidate.executor, reasons: ["status_unavailable"] });
      continue;
    }
    if (candidate.status == null) warnings.push("status_unknown");

    if (candidate.context != null && candidate.context < requirements.minimum_context_tokens) {
      excluded.push({ model: candidate.model, executor: candidate.executor, reasons: ["context_insufficient"] });
      continue;
    }
    if (candidate.context == null) warnings.push("context_unknown");

    const caps = candidate.capabilities;
    if (requirements.tools_required) {
      if (caps.tools === false) {
        excluded.push({ model: candidate.model, executor: candidate.executor, reasons: ["tools_unsupported"] });
        continue;
      }
      if (caps.tools == null) warnings.push("tools_unknown");
    }
    if (requirements.vision_required) {
      if (caps.vision === false) {
        excluded.push({ model: candidate.model, executor: candidate.executor, reasons: ["vision_unsupported"] });
        continue;
      }
      if (caps.vision == null) warnings.push("vision_unknown");
    }
    const reasoningRequired = ["high", "ultra"].includes(requirements.reasoning_level);
    if (reasoningRequired) {
      if (caps.reasoning === false) {
        excluded.push({ model: candidate.model, executor: candidate.executor, reasons: ["reasoning_unsupported"] });
        continue;
      }
      if (caps.reasoning == null) warnings.push("reasoning_unknown");
    }
    for (const protocol of requirements.required_protocols) {
      const value = caps[protocol];
      if (value === false) {
        excluded.push({ model: candidate.model, executor: candidate.executor, reasons: [`protocol_unsupported:${protocol}`] });
        break;
      }
      if (value == null) warnings.push(`protocol_unknown:${protocol}`);
    }
    if (excluded.some((entry) => entry.model === candidate.model && entry.executor === candidate.executor)) {
      continue;
    }

    const unhealthy = ["unhealthy", "down", "degraded", "failing"].includes(
      String(candidate.route_health ?? "").toLowerCase(),
    );
    if (unhealthy) {
      excluded.push({ model: candidate.model, executor: candidate.executor, reasons: ["route_unhealthy"] });
      continue;
    }
    if (candidate.route_health == null) warnings.push("route_health_unknown");
    else if (String(candidate.route_health).toLowerCase() !== "healthy") {
      warnings.push("route_health_not_confirmed");
    }

    ranked.push({ ...candidate, filter_warnings: warnings });
  }
  return { ranked, excluded };
}

export function scoreCandidate(candidate, requirements, config = {}, weightsOverride = null) {
  const weights =
    weightsOverride ??
    config.recommendation?.weights?.[requirements.profile] ?? {
      capability_fit: 30,
      confidence: 15,
      health: 10,
      latency: 10,
      pricing: 15,
      tier: 5,
      freshness: 15,
    };
  const caps = candidate.capabilities;

  const fitParts = [];
  if (requirements.tools_required) {
    fitParts.push(caps.tools === true ? 1 : caps.tools == null ? 0.5 : 0);
  }
  if (requirements.vision_required) {
    fitParts.push(caps.vision === true ? 1 : caps.vision == null ? 0.5 : 0);
  }
  if (["high", "ultra"].includes(requirements.reasoning_level)) {
    fitParts.push(caps.reasoning === true ? 1 : caps.reasoning == null ? 0.5 : 0);
  }
  const capabilityFit = fitParts.length ? fitParts.reduce((a, b) => a + b, 0) / fitParts.length : 1;

  const confidence =
    candidate.capability_source === "declared" ? 1 : candidate.capability_source === "probed" ? 0.9 : 0.4;

  const health =
    candidate.route_health == null
      ? 0.6
      : String(candidate.route_health).toLowerCase() === "healthy"
        ? 1
        : 0.5;

  const latencyTargets = config.recommendation?.latencyTargetMs ?? {
    economy: 2000,
    balanced: 4000,
    deep: 8000,
  };
  const target = Number(latencyTargets[requirements.profile] ?? 4000);
  let latency = 0.5;
  if (candidate.latency_avg_ms != null && candidate.latency_samples >= 3) {
    latency = Math.max(0, Math.min(1, 1 - candidate.latency_avg_ms / (target * 2)));
  }

  const tokenEstimate = extractTokenEstimate(requirements, config);
  const normalizedPricing = normalizePricing(candidate.pricing);
  const costRange = computeCostRange(tokenEstimate, normalizedPricing);
  const costCaps = config.recommendation?.costCap ?? { economy: 0.2, balanced: 2, deep: 10 };
  const costCap = Number(costCaps[requirements.profile] ?? 2);
  let pricing = 0.5;
  let overBudget = false;
  if (costRange) {
    pricing = Math.max(
      0,
      Math.min(1, 1 - costRange.expected_microusd / 1e6 / costCap),
    );
    overBudget = costRange.expected_microusd / 1e6 > costCap;
  }

  const tierScore =
    candidate.tier == null ? 0.6 : /pro|high|premium/i.test(String(candidate.tier)) ? 1 : 0.4;

  const freshness =
    candidate.metadata_freshness_seconds == null
      ? 0.6
      : Math.max(0.2, 1 - candidate.metadata_freshness_seconds / 3600);

  const weighted =
    capabilityFit * (weights.capability_fit ?? 0) +
    confidence * (weights.confidence ?? 0) +
    health * (weights.health ?? 0) +
    latency * (weights.latency ?? 0) +
    pricing * (weights.pricing ?? 0) +
    tierScore * (weights.tier ?? 0) +
    freshness * (weights.freshness ?? 0);
  const weightTotal = Object.values(weights).reduce((a, b) => a + Number(b), 0) || 100;
  const score = Math.round((weighted / weightTotal) * 1000) / 10;

  const reasons = [];
  if (capabilityFit === 1) reasons.push("capability_fit");
  if (candidate.route_health != null && String(candidate.route_health).toLowerCase() === "healthy") {
    reasons.push("route_healthy");
  }
  if (costRange && pricing >= 0.9) reasons.push("price_low");
  if (candidate.latency_avg_ms != null && candidate.latency_samples >= 3 && latency >= 0.75) {
    reasons.push("latency_low");
  }
  if (candidate.metadata_freshness_seconds != null && candidate.metadata_freshness_seconds < 120) {
    reasons.push("metadata_fresh");
  }

  const warnings = [...(candidate.filter_warnings ?? [])];
  if (!costRange) warnings.push("pricing_unknown");
  if (overBudget) warnings.push("over_budget");
  if (candidate.latency_avg_ms != null && candidate.latency_samples < 3) {
    warnings.push("latency_samples_insufficient");
  }
  if (candidate.metadata_freshness_seconds != null && candidate.metadata_freshness_seconds > 3600) {
    warnings.push("metadata_stale");
  }

  return {
    model: candidate.model,
    executor: candidate.executor,
    score,
    capability_fit: capabilityFit,
    reasoning: caps.reasoning === true,
    estimated_cost_range: costRange,
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
    capability_source: candidate.capability_source,
    route_health: candidate.route_health,
    latency_avg_ms: candidate.latency_avg_ms,
    latency_samples: candidate.latency_samples,
    pricing: normalizedPricing,
    metadata_freshness_seconds: candidate.metadata_freshness_seconds,
  };
}

export function catalogHash(candidates) {
  const normalized = candidates
    .map((candidate) => ({
      model: candidate.model,
      executor: candidate.executor,
      capabilities: candidate.capabilities,
      status: candidate.status,
      route_health: candidate.route_health,
      context: candidate.context,
      latency_avg_ms: candidate.latency_avg_ms,
      latency_samples: candidate.latency_samples,
      pricing: candidate.pricing,
      tier: candidate.tier,
      preferred_protocol: candidate.preferred_protocol,
    }))
    .sort((a, b) => `${a.executor}/${a.model}`.localeCompare(`${b.executor}/${b.model}`));
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

export function recommendModels({ candidates, requirements, config = {} }) {
  const { ranked, excluded: filteredOut } = filterCandidates(candidates, requirements, config);
  const tokenEstimate = extractTokenEstimate(requirements, config);
  const scored = ranked
    .map((candidate) => scoreCandidate(candidate, requirements, config))
    .sort((a, b) => b.score - a.score || String(a.model).localeCompare(String(b.model)));

  const overBudgetMode = config.recommendation?.overBudget ?? "warn";
  const kept = [];
  const excluded = [...filteredOut];
  for (const entry of scored) {
    if (overBudgetMode === "exclude" && entry.warnings.includes("over_budget")) {
      excluded.push({ model: entry.model, executor: entry.executor, reasons: ["over_budget"] });
      continue;
    }
    kept.push(entry);
  }

  const withKnownCost = kept.filter(
    (entry) => entry.estimated_cost_range != null,
  );
  const cheapest = withKnownCost.length
    ? [...withKnownCost].sort(
        (a, b) =>
          a.estimated_cost_range.expected_microusd -
            b.estimated_cost_range.expected_microusd ||
          String(a.model).localeCompare(String(b.model)),
      )[0]
    : null;
  const balanced = kept[0] ?? null;
  const bestWeights = config.recommendation?.weights?.deep;
  const best =
    kept.length && bestWeights
      ? [...ranked]
          .map((candidate) =>
            scoreCandidate(candidate, requirements, config, bestWeights),
          )
          .sort(
            (a, b) =>
              Number(b.reasoning) - Number(a.reasoning) ||
              b.capability_fit - a.capability_fit ||
              b.score - a.score ||
              String(a.model).localeCompare(String(b.model)),
          )[0]
      : balanced;

  const hash = catalogHash(candidates);
  const recommendationId = crypto
    .createHash("sha256")
    .update(JSON.stringify({ requirements, catalog_hash: hash }))
    .digest("hex")
    .slice(0, 12);

  return {
    version: RECOMMENDATION_VERSION,
    recommendation_id: recommendationId,
    generated_at: new Date().toISOString(),
    requirements,
    token_estimate: tokenEstimate,
    catalog_hash: hash,
    ranked: kept.slice(0, 3),
    strategies: {
      cheapest,
      balanced,
      best,
    },
    selected_model: null,
    excluded: excluded.map((entry) => ({
      model: entry.model,
      executor: entry.executor,
      reasons: [...new Set(entry.reasons)],
    })),
  };
}
