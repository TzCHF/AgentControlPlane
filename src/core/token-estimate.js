// Token estimates for cost projection (schema v1).
//
// A token estimate is a versioned, profile-driven set of three scenarios
// (low / expected / high). Each scenario carries token counts for the whole
// turn, and the schema enforces low <= expected <= high component-wise.

export const TOKEN_ESTIMATE_VERSION = 1;

const PROFILE_SCENARIOS = {
  economy: {
    low: { input_tokens: 3000, cached_input_tokens: 0, output_tokens: 600, reasoning_output_tokens: 0 },
    expected: { input_tokens: 8000, cached_input_tokens: 1200, output_tokens: 1500, reasoning_output_tokens: 0 },
    high: { input_tokens: 16000, cached_input_tokens: 3000, output_tokens: 3200, reasoning_output_tokens: 0 },
  },
  balanced: {
    low: { input_tokens: 12000, cached_input_tokens: 1800, output_tokens: 2400, reasoning_output_tokens: 400 },
    expected: { input_tokens: 30000, cached_input_tokens: 5000, output_tokens: 6000, reasoning_output_tokens: 1200 },
    high: { input_tokens: 60000, cached_input_tokens: 12000, output_tokens: 13000, reasoning_output_tokens: 3000 },
  },
  deep: {
    low: { input_tokens: 40000, cached_input_tokens: 6000, output_tokens: 8000, reasoning_output_tokens: 2000 },
    expected: { input_tokens: 90000, cached_input_tokens: 15000, output_tokens: 18000, reasoning_output_tokens: 5000 },
    high: { input_tokens: 160000, cached_input_tokens: 30000, output_tokens: 36000, reasoning_output_tokens: 12000 },
  },
};

function scenario(input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens) {
  return {
    input_tokens,
    cached_input_tokens: Math.min(cached_input_tokens, input_tokens),
    output_tokens,
    reasoning_output_tokens: Math.min(reasoning_output_tokens, output_tokens),
  };
}

export function extractTokenEstimate({ profile = "balanced" } = {}, config = {}) {
  const name = ["economy", "balanced", "deep"].includes(profile) ? profile : "balanced";
  const configured = config.recommendation?.tokenScenarios?.[name];
  const source = configured ?? PROFILE_SCENARIOS[name];
  const low = scenario(
    source.low.input_tokens,
    source.low.cached_input_tokens,
    source.low.output_tokens,
    source.low.reasoning_output_tokens,
  );
  const expected = scenario(
    source.expected.input_tokens,
    source.expected.cached_input_tokens,
    source.expected.output_tokens,
    source.expected.reasoning_output_tokens,
  );
  const high = scenario(
    source.high.input_tokens,
    source.high.cached_input_tokens,
    source.high.output_tokens,
    source.high.reasoning_output_tokens,
  );
  return {
    version: TOKEN_ESTIMATE_VERSION,
    profile: name,
    scenarios: {
      low: enforceOrder(low, expected, "low"),
      expected: enforceOrder(expected, expected, "expected"),
      high: enforceOrder(high, expected, "high"),
    },
  };
}

function enforceOrder(scenario, baseline, name) {
  if (name === "high") {
    return {
      input_tokens: Math.max(baseline.input_tokens, scenario.input_tokens),
      cached_input_tokens: Math.min(
        Math.max(baseline.cached_input_tokens, scenario.cached_input_tokens),
        Math.max(baseline.input_tokens, scenario.input_tokens),
      ),
      output_tokens: Math.max(baseline.output_tokens, scenario.output_tokens),
      reasoning_output_tokens: Math.min(
        Math.max(baseline.reasoning_output_tokens, scenario.reasoning_output_tokens),
        Math.max(baseline.output_tokens, scenario.output_tokens),
      ),
    };
  }
  return {
    input_tokens: Math.min(baseline.input_tokens, scenario.input_tokens),
    cached_input_tokens: Math.min(scenario.cached_input_tokens, Math.min(baseline.input_tokens, scenario.input_tokens)),
    output_tokens: Math.min(baseline.output_tokens, scenario.output_tokens),
    reasoning_output_tokens: Math.min(scenario.reasoning_output_tokens, Math.min(baseline.output_tokens, scenario.output_tokens)),
  };
}
