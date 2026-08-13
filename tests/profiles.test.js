import assert from "node:assert/strict";
import test from "node:test";
import { resolveProfile } from "../src/core/profiles.js";

const config = {
  codex: { defaultModel: null },
  profiles: {
    economy: {
      model: "fast-model",
      effort: "low",
      maxSubagents: 0,
      tokenBudget: 30000,
      summary: "concise",
    },
  },
};

const catalog = [
  {
    id: "fast-model",
    model: "fast-model",
    isDefault: true,
    supportedReasoningEfforts: [
      { reasoningEffort: "low" },
      { reasoningEffort: "medium" },
    ],
  },
];

test("accepts an advertised model and effort", () => {
  const profile = resolveProfile(config, { profile: "economy" }, catalog);
  assert.equal(profile.model, "fast-model");
  assert.equal(profile.effort, "low");
});

test("rejects a model not advertised by Codex", () => {
  assert.throws(
    () =>
      resolveProfile(
        config,
        { profile: "economy", model: "broken-alias" },
        catalog,
      ),
    (error) => error.code === "unknown_model",
  );
});

