import assert from "node:assert/strict";
import test from "node:test";
import { resolveProfile, resolveEndpointModel } from "../src/core/profiles.js";

const config = {
  codex: { defaultModel: null },
  limits: { maxTokenBudget: 250000 },
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

test("rejects token budgets above the server maximum", () => {
  assert.throws(
    () =>
      resolveProfile(
        config,
        { profile: "economy", token_budget: 250001 },
        catalog,
      ),
    (error) => error.code === "invalid_token_budget",
  );
});

test("validates models for model-endpoint executors", () => {
  assert.equal(
    resolveEndpointModel("deepseek", "deepseek-chat", ["deepseek-chat", "deepseek-reasoner"]),
    "deepseek-chat",
  );
  assert.throws(
    () =>
      resolveEndpointModel("deepseek", "deepseek-v4-pro", ["deepseek-chat", "deepseek-reasoner"]),
    (error) => error.code === "unknown_model",
  );
  assert.equal(resolveEndpointModel("deepseek", null, ["deepseek-chat"]), null);
});
