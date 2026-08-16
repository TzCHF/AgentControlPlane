import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../src/core/store.js";
import {
  normalizeUsage,
  createUsageEvent,
  csvCell,
  usageEventsToCsv,
} from "../src/core/usage-events.js";
import { usageDimensions, reconcileUsage } from "../src/core/usage-dimensions.js";
import { OpenAICompatibleExecutor } from "../src/executors/openai-compatible-executor.js";

function freshStore() {
  return new TaskStore(fs.mkdtempSync(path.join(os.tmpdir(), "acp-usage-")), 20);
}

function seedTask(store, { kind = "production" } = {}) {
  const task = store.createTask({
    workspace: "C:\\work\\project",
    brief: { objective: "x" },
    policy: { name: "economy" },
    executor: "relay",
    kind,
  });
  store.updateTask(task.id, { threadId: `thread-${task.id}` });
  return task;
}

test("token invariants: cached is a subset of input, reasoning of output, total is input+output", () => {
  const usage = normalizeUsage({
    input_tokens: 100,
    cached_input_tokens: 150,
    output_tokens: 80,
    reasoning_output_tokens: 90,
  });
  assert.equal(usage.cached_input_tokens, 100);
  assert.equal(usage.uncached_input_tokens, 0);
  assert.equal(usage.reasoning_output_tokens, 80);
  assert.equal(usage.total_tokens, 180);
  assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage({}).total_tokens, 0);
  assert.equal(normalizeUsage({}).input_tokens, 0);
});

test("usage events drop prompts, file content, paths, and credentials by construction", () => {
  const event = createUsageEvent({
    task_id: "t",
    usage: { input_tokens: 1 },
    prompt: "secret prompt",
    file_content: "secret file",
    workspace: "C:\\Users\\secret\\project",
    authorization: "Bearer sk-secret",
    api_key: "sk-secret",
    auth_project_id: "server-side-id",
    client_project_ref: "client-ref",
  });
  for (const banned of ["prompt", "file_content", "workspace", "authorization", "api_key", "auth_project_id", "client_project_ref"]) {
    assert.ok(!(banned in event), `${banned} must not be stored`);
  }
});

test("CSV export neutralizes formula injection", () => {
  assert.equal(csvCell("=cmd()"), '"\'=cmd()"');
  assert.equal(csvCell("+1+1"), '"\'+1+1"');
  assert.equal(csvCell("plain"), '"plain"');
  const csv = usageEventsToCsv([
    createUsageEvent({ task_id: "=A1", usage: { input_tokens: 1 } }),
  ]);
  assert.ok(!csv.includes('"=A1"'));
  assert.match(csv, /task_id/);
});

test("provider request ids deduplicate usage events (idempotent)", () => {
  const store = freshStore();
  const task = seedTask(store);
  const base = { task_id: task.id, usage: { input_tokens: 5, output_tokens: 2 }, provider_request_id: "req-1" };
  const first = store.appendUsageEvent(createUsageEvent(base));
  const second = store.appendUsageEvent(createUsageEvent(base));
  assert.equal(first.id, second.id);
  assert.equal(store.listUsageEvents({}).total, 1);
});

test("usage event listing paginates deterministically", () => {
  const store = freshStore();
  for (let index = 0; index < 25; index += 1) {
    store.appendUsageEvent(
      createUsageEvent({ usage: { input_tokens: index + 1 }, provider_request_id: `r-${index}` }),
    );
  }
  const page1 = store.listUsageEvents({ limit: 10, offset: 0 });
  const page2 = store.listUsageEvents({ limit: 10, offset: 10 });
  const page3 = store.listUsageEvents({ limit: 10, offset: 20 });
  assert.equal(page1.total, 25);
  assert.equal(page1.events.length, 10);
  assert.equal(page2.events.length, 10);
  assert.equal(page3.events.length, 5);
  assert.notEqual(page1.events[0].id, page2.events[0].id);
});

test("retry attempts are recorded as separate usage events", async () => {
  let attempts = 0;
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      attempts += 1;
      if (attempts === 1) {
        res.statusCode = 429;
        res.setHeader("retry-after", "0");
        res.end(JSON.stringify({ error: { message: "rate_limit_exceeded" } }));
        return;
      }
      res.end(
        JSON.stringify({
          id: "chatcmpl-provider-1",
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  status: "completed",
                  summary: "Done",
                  changed_files: [],
                  tests: [],
                  blockers: [],
                  next_action: null,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const executor = new OpenAICompatibleExecutor({ baseUrl, protocol: "chat" });
  const events = [];
  executor.on("notification", (message) => {
    if (message.method === "usage/request") events.push(message.params);
  });
  try {
    await executor.start();
    const { thread } = await executor.startThread({ cwd: os.tmpdir() });
    await executor.setGoal({ threadId: thread.id, objective: "x", tokenBudget: 5000 });
    await executor.startTurn({
      threadId: thread.id,
      input: [{ type: "text", text: "x" }],
      model: "m",
      cwd: os.tmpdir(),
      outputSchema: {},
      attribution: { taskId: "task-1" },
    });
    const deadline = Date.now() + 3000;
    while (
      !events.some((entry) => entry.providerRequestId === "chatcmpl-provider-1") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((entry) => entry.requestKind), ["execution", "retry"]);
    assert.deepEqual(events.map((entry) => entry.attempt), [0, 1]);
    assert.equal(events[0].outcome, "error");
    assert.equal(events[1].outcome, "ok");
    assert.equal(events[1].providerRequestId, "chatcmpl-provider-1");
    assert.equal(events[1].usage.total_tokens, 5);
  } finally {
    await executor.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("probe usage events are recorded separately with no task id", async () => {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "probe-model", preferred_protocol: "chat" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      res.end(
        JSON.stringify({
          id: "chatcmpl-probe-1",
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "ping", arguments: "{}" } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const executor = new OpenAICompatibleExecutor({ baseUrl, protocol: "auto" });
  const events = [];
  executor.on("notification", (message) => {
    if (message.method === "usage/request") events.push(message.params);
  });
  try {
    await executor.probe();
    assert.ok(events.length > 0);
    assert.equal(events[0].requestKind, "probe");
    assert.equal(events[0].threadId, null);
  } finally {
    await executor.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("dimensional aggregation separates estimated and actual cost and orders stably", () => {
  const store = freshStore();
  const task = seedTask(store);
  store.appendUsageEvent(
    createUsageEvent({
      task_id: task.id,
      usage: { input_tokens: 10, output_tokens: 4 },
      provider_request_id: "a-1",
      resolved_model: "m1",
      estimated_cost: 0.01,
      actual_cost: null,
    }),
  );
  store.appendUsageEvent(
    createUsageEvent({
      task_id: task.id,
      usage: { input_tokens: 20, output_tokens: 6 },
      provider_request_id: "a-2",
      resolved_model: "m2",
      estimated_cost: 0.02,
      actual_cost: 0.015,
    }),
  );
  const report = usageDimensions(store, { by: "model" });
  assert.equal(report.total_groups, 2);
  assert.equal(report.rows[0].model, "m1");
  assert.equal(report.rows[1].model, "m2");
  assert.equal(report.rows[0].estimated_cost, 0.01);
  assert.equal(report.rows[0].actual_cost, null);
  assert.equal(report.rows[1].estimated_cost, 0.02);
  assert.equal(report.rows[1].actual_cost, 0.015);
  const again = usageDimensions(store, { by: "model" });
  assert.deepEqual(again.rows, report.rows);
});

test("certification tasks are excluded from production aggregation", () => {
  const store = freshStore();
  const production = seedTask(store, { kind: "production" });
  const certification = seedTask(store, { kind: "certification" });
  store.appendUsageEvent(
    createUsageEvent({
      task_id: production.id,
      usage: { input_tokens: 10, output_tokens: 4 },
      resolved_model: "prod-model",
    }),
  );
  store.appendUsageEvent(
    createUsageEvent({
      task_id: certification.id,
      usage: { input_tokens: 10, output_tokens: 4 },
      resolved_model: "cert-model",
    }),
  );
  store.appendUsageEvent(
    createUsageEvent({
      usage: { input_tokens: 3, output_tokens: 1 },
      resolved_model: "probe-model",
    }),
  );
  const productionReport = usageDimensions(store, { by: "model" });
  assert.deepEqual(
    productionReport.rows.map((row) => row.model),
    ["probe-model", "prod-model"],
  );
  const fullReport = usageDimensions(store, { by: "model", production_only: false });
  assert.deepEqual(
    fullReport.rows.map((row) => row.model),
    ["cert-model", "probe-model", "prod-model"],
  );
  const probeRow = fullReport.rows.find((row) => row.model === "probe-model");
  assert.equal(probeRow.task_kinds.unattached, 1);
  store.markTaskKind(certification.id, "certification");
  assert.equal(store.getTask(certification.id).kind, "certification");
});

test("reconciliation classifies matched, client_only, provider_only, mismatch, and settled", () => {
  const store = freshStore();
  const task = seedTask(store);
  store.appendUsageEvent(
    createUsageEvent({
      task_id: task.id,
      usage: { input_tokens: 10, output_tokens: 4 },
      provider_request_id: "req-match",
    }),
  );
  store.appendUsageEvent(
    createUsageEvent({
      task_id: task.id,
      usage: { input_tokens: 5, output_tokens: 2 },
    }),
  );
  const result = reconcileUsage(store, [
    { request_id: "req-match", total_tokens: 14, actual_cost: 0.1 },
    { request_id: "req-mismatch-client-missing" },
    { request_id: "req-match" },
    { request_id: "provider-only-row" },
  ]);
  assert.equal(result.statuses.matched, 0);
  assert.equal(result.statuses.client_only, 1);
  assert.equal(result.statuses.provider_only, 2);
  assert.equal(result.statuses.settled, 1);
  assert.equal(result.statuses.token_mismatch, 0);

  const mismatch = reconcileUsage(store, [
    { request_id: "req-match", total_tokens: 99 },
  ]);
  assert.equal(mismatch.statuses.token_mismatch, 1);
});
