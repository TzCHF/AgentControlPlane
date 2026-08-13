import { calculateBenchmarkComparison } from "./metrics.js";

export function buildBenchmarkReport(cases) {
  const comparisons = cases.map((entry) => ({
    id: entry.id,
    category: entry.category,
    ...calculateBenchmarkComparison(entry),
  }));
  const valid = comparisons.filter(
    (entry) => entry.total_savings_rate !== null,
  );
  const average = (field) =>
    valid.length
      ? valid.reduce((sum, entry) => sum + entry[field], 0) / valid.length
      : null;
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    case_count: comparisons.length,
    comparable_case_count: valid.length,
    average_execution_savings_rate: average("execution_savings_rate"),
    average_total_savings_rate: average("total_savings_rate"),
    direct_success_rate: comparisons.length
      ? comparisons.filter((entry) => entry.direct_success).length /
        comparisons.length
      : null,
    controlled_success_rate: comparisons.length
      ? comparisons.filter((entry) => entry.controlled_success).length /
        comparisons.length
      : null,
    cases: comparisons,
  };
}
