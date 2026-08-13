import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEngineeringPrompt,
  normalizeBrief,
} from "../src/core/brief.js";

test("normalizes a compact engineering brief", () => {
  const brief = normalizeBrief({
    objective: "  Add GET /hello  ",
    acceptance_criteria: [" returns 200 "],
  });
  assert.equal(brief.objective, "Add GET /hello");
  assert.deepEqual(brief.acceptanceCriteria, ["returns 200"]);
});

test("prompt contains delegation limit and omits empty sections", () => {
  const brief = normalizeBrief({ objective: "Fix tests" });
  const prompt = buildEngineeringPrompt(brief, {
    maxSubagents: 2,
  });
  assert.match(prompt, /at most 2 subagents/);
  assert.doesNotMatch(prompt, /KNOWN CONTEXT/);
});

