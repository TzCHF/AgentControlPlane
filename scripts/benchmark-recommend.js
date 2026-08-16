// Read-only recommendation benchmark: queries the local server's
// /v1/recommendations endpoint for fixed objectives and prints ranked
// candidates plus exclusion summaries. Consumes no model quota.
const baseUrl = process.env.ACP_BASE_URL ?? "http://127.0.0.1:4318";

const cases = [
  { objective: "Create a hello.txt file with one line of text", profile: "economy" },
  { objective: "Refactor the authentication module and add tests", profile: "balanced" },
  { objective: "审计整个代码库的架构并给出迁移方案", profile: "deep" },
  { objective: "识别截图中的文字并写入 notes.txt", profile: "balanced" },
];

for (const item of cases) {
  const url = new URL(`${baseUrl}/v1/recommendations`);
  url.searchParams.set("objective", item.objective);
  url.searchParams.set("profile", item.profile);
  const response = await fetch(url.toString());
  if (!response.ok) {
    console.log(`[${item.profile}] "${item.objective.slice(0, 40)}" → HTTP ${response.status}`);
    continue;
  }
  const { recommendation } = await response.json();
  console.log(`\n[${item.profile}] ${item.objective}`);
  console.log(`catalog_hash=${recommendation.catalog_hash} version=${recommendation.version}`);
  const usd = (microusd) => (microusd == null ? null : (microusd / 1e6).toFixed(6));
  for (const [strategy, label] of [
    ["cheapest", "cheapest"],
    ["balanced", "balanced"],
    ["best", "best"],
  ]) {
    const entry = recommendation.strategies?.[strategy];
    if (!entry) {
      console.log(`  ${label}: none`);
      continue;
    }
    const range = entry.estimated_cost_range;
    const cost = range
      ? `$${usd(range.low_microusd)}–$${usd(range.high_microusd)} (expected $${usd(range.expected_microusd)} ${range.currency})`
      : "unknown";
    console.log(`  ${label}: ${entry.executor}/${entry.model} cost=${cost}`);
  }
  for (const entry of recommendation.ranked ?? []) {
    const range = entry.estimated_cost_range;
    const cost = range
      ? `$${usd(range.low_microusd)}–$${usd(range.high_microusd)} ${range.currency}`
      : "unknown";
    console.log(
      `  ${entry.score}  ${entry.executor}/${entry.model}  cost=${cost} reasons=[${entry.reasons.join(", ")}] warnings=[${entry.warnings.join(", ")}]`,
    );
  }
  if ((recommendation.excluded ?? []).length > 0) {
    console.log(
      `  excluded: ${recommendation.excluded.map((entry) => `${entry.model} (${entry.reasons.join(",")})`).join("; ")}`,
    );
  }
}
