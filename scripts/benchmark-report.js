import fs from "node:fs";
import path from "node:path";
import { buildBenchmarkReport } from "../src/benchmark/report.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run benchmark:report -- <benchmark-results.json>");
  process.exit(2);
}
const absolute = path.resolve(inputPath);
const input = JSON.parse(fs.readFileSync(absolute, "utf8"));
const cases = Array.isArray(input) ? input : input.cases;
if (!Array.isArray(cases)) {
  console.error("Benchmark input must be an array or an object with a cases array.");
  process.exit(2);
}
console.log(JSON.stringify(buildBenchmarkReport(cases), null, 2));
