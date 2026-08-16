// Deterministic, provider-agnostic model recommendation.
//
// This module holds pure functions only: requirement extraction, candidate
// normalization, hard filtering, scoring, and the result schema. It never
// calls a model, never switches the user's selection, and treats provider
// metadata as three-state (true / false / unknown); unknown stays a warning
// candidate and is never written down as false. Weights and context defaults
// live in config; they do not live here.

import crypto from "node:crypto";

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
    context: Number.isFinite(Number(model?.context)) ? Number(model.context) : null,
    latency_avg_ms: Number.isFinite(Number(latency?.avgMs)) ? Number(latency.avgMs) : null,
    latency_samples: Number.isFinite(Number(latency?.sampleCount)) ? Number(latency.sampleCount) : 0,
    pricing: pricing
      ? {
          input: Number.isFinite(Number(pricing.input)) ? Number(pricing.input) : null,
          output: Number.isFinite(Number(pricing.output)) ? Number(pricing.output) : null,
          cached_input: Number.isFinite(Number(pricing.cached_input))
            ? Number(pricing.cached_input)
            : null,
          currency: pricing.currency ?? "USD",
        }
      : null,
    tier: model?.tier ?? model?.route_tier ?? null,
    preferred_protocol: model?.preferred_protocol ?? null,
    featured: model?.featured === true,
    metadata_freshness_seconds: Number.isFinite(Number(model?.metadata_freshness_seconds))
      ? Number(model.metadata_freshness_seconds)
      : null,
    capability_source: capabilities ? "declared" : "unknown",
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

export function scoreCandidate(candidate, requirements, config = {}) {
  const weights = config.recommendation?.weights?.[requirements.profile] ?? {
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

  const estimates = estimateCost(candidate, requirements);
  const costCaps = config.recommendation?.costCap ?? { economy: 0.2, balanced: 2, deep: 10 };
  const costCap = Number(costCaps[requirements.profile] ?? 2);
  let pricing = 0.5;
  if (estimates.known) {
    pricing = Math.max(0, Math.min(1, 1 - estimates.max / costCap));
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
  if (estimates.known && pricing >= 0.9) reasons.push("price_low");
  if (candidate.latency_avg_ms != null && candidate.latency_samples >= 3 && latency >= 0.75) {
    reasons.push("latency_low");
  }
  if (candidate.metadata_freshness_seconds != null && candidate.metadata_freshness_seconds < 120) {
    reasons.push("metadata_fresh");
  }

  const warnings = [...(candidate.filter_warnings ?? [])];
  if (!estimates.known) warnings.push("pricing_unknown");
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
    estimated_cost_range: estimates.range,
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
    capability_source: candidate.capability_source,
    route_health: candidate.route_health,
    latency_avg_ms: candidate.latency_avg_ms,
    latency_samples: candidate.latency_samples,
    pricing: candidate.pricing,
    metadata_freshness_seconds: candidate.metadata_freshness_seconds,
  };
}

export function estimateCost(candidate, requirements) {
  const pricing = candidate.pricing;
  if (!pricing || (pricing.input == null && pricing.output == null)) {
    return { known: false, range: null };
  }
  const profileTokens = { economy: [8000, 1500], balanced: [30000, 6000], deep: [90000, 18000] };
  const [inputTokens, outputTokens] = profileTokens[requirements.profile] ?? profileTokens.balanced;
  const inputPrice = pricing.input ?? 0;
  const outputPrice = pricing.output ?? 0;
  const cachedPrice = pricing.cached_input ?? inputPrice;
  const max = (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
  const min = (inputTokens * cachedPrice + outputTokens * outputPrice) / 1_000_000;
  return {
    known: true,
    range: {
      min: Math.round(min * 1e6) / 1e6,
      max: Math.round(max * 1e6) / 1e6,
      currency: pricing.currency ?? "USD",
      source: "provider_pricing",
    },
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
  const { ranked, excluded } = filterCandidates(candidates, requirements, config);
  const scored = ranked
    .map((candidate) => scoreCandidate(candidate, requirements, config))
    .sort((a, b) => b.score - a.score || String(a.model).localeCompare(String(b.model)));
  return {
    version: RECOMMENDATION_VERSION,
    generated_at: new Date().toISOString(),
    requirements,
    catalog_hash: catalogHash(candidates),
    ranked: scored.slice(0, 3),
    selected_model: null,
    excluded: excluded.map((entry) => ({
      model: entry.model,
      executor: entry.executor,
      reasons: [...new Set(entry.reasons)],
    })),
  };
}
