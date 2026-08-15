import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenCodeExecutor,
  normalizeOpenCodeEvents,
} from "../src/executors/opencode-executor.js";
import { assertLifecycle } from "../src/executors/lifecycle.js";

test("OpenCodeExecutor satisfies the agent lifecycle contract", () => {
  const executor = new OpenCodeExecutor();
  assert.equal(assertLifecycle(executor), executor);
});

test("normalizes opencode json events into text and usage", () => {
  const events = [
    {
      type: "step_start",
      sessionID: "ses_1",
      part: { id: "p1", type: "step-start" },
    },
    {
      type: "text",
      sessionID: "ses_1",
      part: {
        id: "p2",
        type: "text",
        text: JSON.stringify({
          status: "completed",
          summary: "Done",
          changed_files: ["a.js"],
          tests: [],
          blockers: [],
          next_action: null,
        }),
      },
    },
    {
      type: "step_finish",
      sessionID: "ses_1",
      part: {
        id: "p3",
        type: "step-finish",
        tokens: {
          total: 200,
          input: 120,
          output: 80,
          reasoning: 0,
          cache: { write: 0, read: 0 },
        },
        cost: 0.001,
      },
    },
  ];
  const normalized = normalizeOpenCodeEvents(events);
  assert.equal(normalized.usage.total_tokens, 200);
  assert.equal(normalized.usage.input_tokens, 120);
  assert.equal(normalized.usage.output_tokens, 80);
  assert.match(normalized.finalText, /"summary":"Done"/);
});

test("normalizeOpenCodeEvents tolerates unknown shapes", () => {
  assert.equal(normalizeOpenCodeEvents([{ foo: "bar" }]).finalText, "");
  assert.equal(normalizeOpenCodeEvents([]).usage.total_tokens, 0);
});

test("accumulates marginal tokens and separates cache reads", () => {
  const events = [
    {
      type: "step_finish",
      part: {
        type: "step-finish",
        tokens: {
          total: 1000,
          input: 100,
          output: 50,
          reasoning: 20,
          cache: { write: 0, read: 830 },
        },
      },
    },
    {
      type: "step_finish",
      part: {
        type: "step-finish",
        tokens: {
          total: 1500,
          input: 40,
          output: 60,
          reasoning: 10,
          cache: { write: 0, read: 1390 },
        },
      },
    },
  ];
  const usage = normalizeOpenCodeEvents(events).usage;
  assert.equal(usage.input_tokens, 140);
  assert.equal(usage.output_tokens, 110);
  assert.equal(usage.reasoning_output_tokens, 30);
  assert.equal(usage.cached_input_tokens, 1390);
  assert.equal(usage.uncached_input_tokens, 140);
  assert.equal(usage.total_tokens, 1500);
});
