import assert from "node:assert/strict";
import test from "node:test";
import {
  addUsage,
  calculateBenchmarkComparison,
} from "../src/benchmark/metrics.js";
import { buildBenchmarkReport } from "../src/benchmark/report.js";

test("usage addition keeps each token field", () => {
  const total = addUsage(
    { input_tokens: 10, total_tokens: 12 },
    { output_tokens: 3, total_tokens: 3 },
  );
  assert.equal(total.input_tokens, 10);
  assert.equal(total.output_tokens, 3);
  assert.equal(total.total_tokens, 15);
});

test("benchmark comparison separates execution and total savings", () => {
  const comparison = calculateBenchmarkComparison({
    direct: {
      success: true,
      duration_ms: 100,
      executor_usage: { total_tokens: 1000 },
    },
    controlled: {
      success: true,
      duration_ms: 120,
      controller_usage: { total_tokens: 100 },
      executor_usage: { total_tokens: 700 },
    },
  });
  assert.equal(comparison.execution_savings_rate, 0.3);
  assert.equal(comparison.total_savings_rate, 0.2);
});

test("benchmark report aggregates success rates", () => {
  const report = buildBenchmarkReport([
    {
      id: "1",
      category: "small",
      direct: { success: true, executor_usage: { total_tokens: 100 } },
      controlled: {
        success: false,
        controller_usage: { total_tokens: 10 },
        executor_usage: { total_tokens: 90 },
      },
    },
  ]);
  assert.equal(report.case_count, 1);
  assert.equal(report.direct_success_rate, 1);
  assert.equal(report.controlled_success_rate, 0);
  assert.equal(report.average_total_savings_rate, 0);
});
