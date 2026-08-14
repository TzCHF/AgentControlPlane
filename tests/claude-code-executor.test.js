import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyClaudeAuthentication,
  ClaudeCodeExecutor,
  normalizeClaudeResult,
} from "../src/executors/claude-code-executor.js";
import { assertLifecycle } from "../src/executors/lifecycle.js";

test("ClaudeCodeExecutor satisfies the agent lifecycle contract", () => {
  const executor = new ClaudeCodeExecutor();
  assert.equal(assertLifecycle(executor), executor);
});

test("classifies Claude Code account and API-key authentication", () => {
  assert.deepEqual(
    classifyClaudeAuthentication(
      '{"loggedIn":true,"authMethod":"claude.ai"}',
    ),
    { authenticated: true, authMethod: "claude.ai" },
  );
  assert.deepEqual(
    classifyClaudeAuthentication(
      '{"loggedIn":false,"authMethod":"none"}',
    ),
    { authenticated: false, authMethod: "none" },
  );
  assert.deepEqual(
    classifyClaudeAuthentication("", { apiKeyConfigured: true }),
    { authenticated: true, authMethod: "api_key" },
  );
  assert.equal(classifyClaudeAuthentication("unsupported output"), null);
});

test("normalizes a successful claude stream-json result", () => {
  const events = [
    { type: "system", subtype: "init", session_id: "s1" },
    { type: "assistant", message: { content: [{ type: "text", text: "working" }] } },
    { type: "user", message: { content: [{ type: "tool_use", name: "Bash" }] } },
    {
      type: "result",
      subtype: "success",
      result: JSON.stringify({
        status: "completed",
        summary: "Done",
        changed_files: ["a.js"],
        tests: [],
        blockers: [],
        next_action: null,
      }),
      usage: { input_tokens: 120, output_tokens: 80 },
    },
  ];
  const normalized = normalizeClaudeResult(events);
  assert.equal(normalized.status, "completed");
  assert.equal(normalized.usage.total_tokens, 200);
  assert.match(normalized.resultText, /"summary":"Done"/);
});

test("normalizes an errored claude result", () => {
  const events = [
    {
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      result: "",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  ];
  const normalized = normalizeClaudeResult(events);
  assert.equal(normalized.status, "failed");
  assert.equal(normalized.usage.total_tokens, 15);
});
