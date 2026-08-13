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
      type: "message",
      data: { role: "user", content: [{ type: "text", text: "hi" }] },
    },
    {
      type: "message",
      data: {
        role: "assistant",
        content: [
          {
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
        ],
      },
      usage: { input_tokens: 120, output_tokens: 80 },
    },
  ];
  const normalized = normalizeOpenCodeEvents(events);
  assert.equal(normalized.usage.total_tokens, 200);
  assert.match(normalized.finalText, /"summary":"Done"/);
});

test("normalizeOpenCodeEvents tolerates unknown shapes", () => {
  assert.equal(normalizeOpenCodeEvents([{ foo: "bar" }]).finalText, "");
  assert.equal(normalizeOpenCodeEvents([]).usage.total_tokens, 0);
});
