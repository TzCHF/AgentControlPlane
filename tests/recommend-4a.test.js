import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTaskRequirements,
  normalizeCandidate,
  normalizePricing,
  computeCostRange,
  recommendModels,
} from "../src/core/recommend.js";
import { extractTokenEstimate } from "../src/core/token-estimate.js";

const config = {
  recommendation: {
    contextTokens: { economy: 16000, balanced: 64000, deep: 128000 },
    latencyTargetMs: { economy: 2000, balanced: 4000, deep: 8000 },
    costCap: { economy: 0.2, balanced: 2, deep: 10 },
    overBudget: "warn",
    weights: {
      economy: { capability_fit: 30, confidence: 10, health: 10, latency: 10, pricing: 30, tier: 0, freshness: 10 },
      balanced: { capability_fit: 30, confidence: 15, health: 10, latency: 10, pricing: 15, tier: 5, freshness: 15 },
      deep: { capability_fit: 40, confidence: 15, health: 10, latency: 5, pricing: 10, tier: 5, freshness: 15 },
    },
  },
};

function candidate(model) {
  return normalizeCandidate("relay", model);
}

function baseModel(overrides = {}) {
  return {
    id: "m",
    capabilities: { chat: true, responses: false, tools: true, reasoning: true, vision: false },
    status: "live",
    route_health: "healthy",
    context: 128000,
    latency: { avgMs: 1200, sampleCount: 10 },
    pricing: { input: 0.6, output: 1.2, cached_input: 0.2, reasoning: 0.4, pricing_version: "pv-9" },
    tier: "pro",
    metadata_freshness_seconds: 30,
    ...overrides,
  };
}

test("token estimates are versioned with ordered low/expected/high scenarios", () => {
  for (const profile of ["economy", "balanced", "deep"]) {
    const estimate = extractTokenEstimate({ profile }, config);
    assert.equal(estimate.version, 1);
    const { low, expected, high } = estimate.scenarios;
    for (const key of ["input_tokens", "output_tokens", "cached_input_tokens", "reasoning_output_tokens"]) {
      assert.ok(low[key] <= expected[key], `${profile}.${key} low<=expected`);
      assert.ok(expected[key] <= high[key], `${profile}.${key} expected<=high`);
    }
  }
});

test("cached input is billed at the cached rate and never twice", () => {
  const pricing = normalizePricing({ input: 1, cached_input: 0.5, output: 2 });
  const estimate = extractTokenEstimate({ profile: "economy" }, config);
  const scenario = { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 100, reasoning_output_tokens: 0 };
  const cached = 400 * 0.5;
  const uncached = 600 * 1;
  const output = 100 * 2;
  assert.equal(
    computeCostRange({ scenarios: { low: scenario, expected: scenario, high: scenario } }, pricing)
      .expected_microusd,
    Math.round(cached + uncached + output),
  );
});

test("reasoning tokens are billed at the reasoning rate and never twice", () => {
  const pricing = normalizePricing({ input: 1, output: 2, reasoning: 0.8 });
  const estimate = extractTokenEstimate({ profile: "balanced" }, config);
  const scenario = { input_tokens: 100, cached_input_tokens: 0, output_tokens: 1000, reasoning_output_tokens: 400 };
  const expected = 100 * 1 + 600 * 2 + 400 * 0.8;
  assert.equal(
    computeCostRange({ scenarios: { low: scenario, expected: scenario, high: scenario } }, pricing)
      .expected_microusd,
    Math.round(expected),
  );
});

test("missing prices stay unknown and are never zero", () => {
  const estimate = extractTokenEstimate({ profile: "economy" }, config);
  assert.equal(computeCostRange(estimate, null), null);
  assert.equal(normalizePricing({ input: null, output: null }), null);
  const entry = recommendModels({
    candidates: [candidate(baseModel({ id: "no-price", pricing: null }))],
    requirements: extractTaskRequirements({ objective: "x", profile: "economy" }, config),
    config,
  }).ranked[0];
  assert.equal(entry.estimated_cost_range, null);
  assert.ok(entry.warnings.includes("pricing_unknown"));
});

test("missing context stays unknown and is never zero", () => {
  const entry = candidate(baseModel({ id: "no-ctx", context: null }));
  assert.equal(entry.context, null);
  const result = recommendModels({
    candidates: [entry],
    requirements: extractTaskRequirements({ objective: "x", profile: "economy" }, config),
    config,
  });
  assert.ok(result.ranked[0].warnings.includes("context_unknown"));
});

test("pricing version enters the cost range and the snapshot", () => {
  const result = recommendModels({
    candidates: [candidate(baseModel({ id: "v", pricing: { input: 0.6, output: 1.2, pricing_version: "pv-9" } }))],
    requirements: extractTaskRequirements({ objective: "x", profile: "economy" }, config),
    config,
  });
  assert.equal(result.ranked[0].estimated_cost_range.pricing_version, "pv-9");
});

test("catalog order changes do not change the result", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "balanced" }, config);
  const candidates = [candidate(baseModel({ id: "a" })), candidate(baseModel({ id: "b" }))];
  const first = recommendModels({ candidates, requirements, config });
  const second = recommendModels({ candidates: [...candidates].reverse(), requirements, config });
  delete first.generated_at;
  delete second.generated_at;
  assert.deepEqual(second, first);
});

test("explicit models are never overridden and selected_model stays null", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy", model: "user-pick" }, config);
  const result = recommendModels({
    candidates: [candidate(baseModel({ id: "user-pick" })), candidate(baseModel({ id: "other" }))],
    requirements,
    config,
  });
  assert.equal(result.selected_model, null);
  assert.equal(result.requirements.requested_model, "user-pick");
});

test("unhealthy routes exclude with a route reason, separate from capability", () => {
  const result = recommendModels({
    candidates: [candidate(baseModel({ id: "bad", route_health: "unhealthy" }))],
    requirements: extractTaskRequirements({ objective: "x", profile: "economy" }, config),
    config,
  });
  assert.equal(result.ranked.length, 0);
  assert.deepEqual(result.excluded[0].reasons, ["route_unhealthy"]);
});

test("over-budget behavior follows the configured mode", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const expensive = candidate(
    baseModel({ id: "costly", pricing: { input: 60, output: 120, cached_input: 60 } }),
  );
  const warned = recommendModels({
    candidates: [expensive],
    requirements,
    config: { ...config, recommendation: { ...config.recommendation, overBudget: "warn" } },
  });
  assert.equal(warned.ranked.length, 1);
  assert.ok(warned.ranked[0].warnings.includes("over_budget"));

  const excluded = recommendModels({
    candidates: [expensive],
    requirements,
    config: { ...config, recommendation: { ...config.recommendation, overBudget: "exclude" } },
  });
  assert.equal(excluded.ranked.length, 0);
  assert.deepEqual(excluded.excluded[0].reasons, ["over_budget"]);
});

test("strategies pick cheapest by cost, balanced by score, best by deep weights", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const cheap = baseModel({
    id: "cheap",
    capabilities: { chat: true, tools: true, reasoning: false, vision: false },
    pricing: { input: 0.1, output: 0.2, cached_input: 0.05 },
  });
  const strong = baseModel({
    id: "strong",
    capabilities: { chat: true, tools: true, reasoning: true, vision: false },
    pricing: { input: 5, output: 10, cached_input: 2 },
  });
  const result = recommendModels({
    candidates: [candidate(cheap), candidate(strong)],
    requirements,
    config,
  });
  assert.equal(result.strategies.cheapest.model, "cheap");
  assert.ok(result.strategies.balanced);
  assert.ok(result.strategies.best);
  assert.equal(result.strategies.best.model, "strong");
});

test("costs are integer micro-USD with low <= expected <= high", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "deep" }, config);
  const result = recommendModels({
    candidates: [candidate(baseModel({ id: "int" }))],
    requirements,
    config,
  });
  const range = result.ranked[0].estimated_cost_range;
  for (const key of ["low_microusd", "expected_microusd", "high_microusd"]) {
    assert.ok(Number.isInteger(range[key]), key);
  }
  assert.ok(range.low_microusd <= range.expected_microusd);
  assert.ok(range.expected_microusd <= range.high_microusd);
});

test("recommendation never reads usage history or production statistics", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "balanced" }, config);
  const candidates = [candidate(baseModel({ id: "a" }))];
  const result = recommendModels({ candidates, requirements, config });
  for (const field of Object.keys(result)) {
    assert.ok(
      !["usage", "history", "statistics", "events"].includes(field),
      "snapshot carries no usage history field",
    );
  }
  const strategies = Object.values(result.strategies ?? {});
  for (const entry of strategies.filter(Boolean)) {
    assert.ok(!("history" in entry));
  }
});
