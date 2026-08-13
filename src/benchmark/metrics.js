const usageFields = [
  "input_tokens",
  "cached_input_tokens",
  "uncached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
];

export function normalizeUsage(input = {}) {
  return Object.fromEntries(
    usageFields.map((field) => [field, Math.max(0, Number(input[field] ?? 0))]),
  );
}

export function addUsage(...entries) {
  const total = normalizeUsage();
  for (const entry of entries) {
    const normalized = normalizeUsage(entry);
    for (const field of usageFields) total[field] += normalized[field];
  }
  return total;
}

export function calculateBenchmarkComparison({ direct, controlled }) {
  const directUsage = addUsage(direct.executor_usage);
  const controlledUsage = addUsage(
    controlled.controller_usage,
    controlled.executor_usage,
  );
  const directTokens = directUsage.total_tokens;
  const controlledTokens = controlledUsage.total_tokens;
  const executionTokens = normalizeUsage(controlled.executor_usage).total_tokens;
  const executionSavingsRate = directTokens > 0
    ? (directTokens - executionTokens) / directTokens
    : null;
  const totalSavingsRate = directTokens > 0
    ? (directTokens - controlledTokens) / directTokens
    : null;
  return {
    direct_usage: directUsage,
    controlled_usage: controlledUsage,
    execution_savings_rate: executionSavingsRate,
    total_savings_rate: totalSavingsRate,
    direct_success: Boolean(direct.success),
    controlled_success: Boolean(controlled.success),
    direct_duration_ms: Math.max(0, Number(direct.duration_ms ?? 0)),
    controlled_duration_ms: Math.max(0, Number(controlled.duration_ms ?? 0)),
  };
}
