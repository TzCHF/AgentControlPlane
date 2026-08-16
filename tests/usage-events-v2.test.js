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
  adaptV1Event,
  csvCell,
  usageEventsToCsv,
} from "../src/core/usage-events.js";
import { usageDimensions, reconcileUsage } from "../src/core/usage-dimensions.js";
import { ReconcileClient } from "../src/core/reconcile-client.js";
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

function event(fields = {}) {
  return createUsageEvent({
    task_id: "t",
    task_kind: "production",
    request_kind: "task_execution",
    attempt: 1,
    usage: { input_tokens: 10, output_tokens: 4 },
    ...fields,
  });
}

test("token invariants hold: cached within input, reasoning within output, total is input+output", () => {
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
});

test("asterroute and upstream request ids are captured separately", () => {
  const entry = event({
    asterroute_request_id: "ar-req-1",
    upstream_request_id: "ppio-2",
  });
  assert.equal(entry.asterroute_request_id, "ar-req-1");
  assert.equal(entry.upstream_request_id, "ppio-2");
  assert.ok(!("provider_request_id" in entry));
});

test("attempts are 1-based and is_retry derives from attempt > 1", () => {
  const first = event({ attempt: 1 });
  const retry = event({ attempt: 2 });
  assert.equal(first.attempt, 1);
  assert.equal(retry.attempt, 2);
  assert.equal(retry.attempt > 1, true);
  assert.equal(retry.request_kind, "task_execution");
});

test("retry attempts stay request_kind=task_execution", () => {
  const retry = event({ attempt: 3, request_kind: "task_execution" });
  assert.equal(retry.request_kind, "task_execution");
  assert.equal(retry.attempt > 1, true);
});

test("production scope excludes probes and non-production task kinds", () => {
  const store = freshStore();
  const production = seedTask(store, { kind: "production" });
  const certification = seedTask(store, { kind: "certification" });
  store.appendUsageEvent(
    event({
      task_id: production.id,
      request_kind: "task_execution",
      asterroute_request_id: "p-1",
      resolved_model: "prod-model",
    }),
  );
  store.appendUsageEvent(
    event({
      task_id: certification.id,
      request_kind: "task_execution",
      asterroute_request_id: "c-1",
      resolved_model: "cert-model",
    }),
  );
  store.appendUsageEvent(
    event({
      task_id: null,
      request_kind: "protocol_probe",
      asterroute_request_id: "probe-1",
      resolved_model: "probe-model",
    }),
  );
  const productionView = usageDimensions(store, { by: "model" });
  assert.deepEqual(
    productionView.rows.map((row) => row.model),
    ["prod-model"],
  );
  const fullView = usageDimensions(store, { by: "model", production_only: false });
  assert.deepEqual(
    fullView.rows.map((row) => row.model),
    ["cert-model", "probe-model", "prod-model"],
  );
});

test("presence matched and settlement pending coexist on one event", () => {
  const entry = event({ asterroute_request_id: "req-1" });
  assert.equal(entry.presence_state, "matched");
  assert.equal(entry.settlement_state, "pending");
});

test("token mismatch and settlement pending coexist after reconcile", () => {
  const store = freshStore();
  const task = seedTask(store);
  store.appendUsageEvent(
    event({
      task_id: task.id,
      asterroute_request_id: "req-mismatch",
      usage: { input_tokens: 10, output_tokens: 4 },
    }),
  );
  const { statuses } = reconcileUsage(store, [
    { request_id: "req-mismatch", total_tokens: 99, settled_cost_microusd: null },
  ]);
  assert.equal(statuses.token.mismatch, 1);
  assert.equal(statuses.settlement.cost_pending, 1);
});

test("bulk lookup client matches request ids exactly", async () => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    seen.push(body.request_ids);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        rows: [
          { request_id: "a", total_tokens: 14, settled_cost_microusd: 12000 },
          { request_id: "b", total_tokens: 9, settled_cost_microusd: null },
        ],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const client = new ReconcileClient({ baseUrl, apiKey: "k" });
    const { rows } = await client.lookup(["a", "b", "missing", "a"]);
    assert.equal(seen[0].length, 3);
    assert.deepEqual(seen[0], ["a", "b", "missing"]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].request_id, "a");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("missing provider rows leave events client_only", () => {
  const store = freshStore();
  const task = seedTask(store);
  store.appendUsageEvent(
    event({ task_id: task.id, asterroute_request_id: "req-x" }),
  );
  const { statuses } = reconcileUsage(store, [
    { request_id: "some-other-id", total_tokens: 5 },
  ]);
  assert.equal(statuses.presence.provider_only, 1);
  assert.equal(statuses.presence.matched, 1);
});

test("provider-only rows are counted on import", () => {
  const store = freshStore();
  const { statuses } = reconcileUsage(store, [
    { request_id: "only-at-provider", total_tokens: 7 },
  ]);
  assert.equal(statuses.presence.provider_only, 1);
});

test("money uses integer micro-USD without float precision loss", () => {
  const entry = event({ estimated_cost: 0.123456789, settled_cost: 0.000001 });
  assert.equal(entry.estimated_cost_microusd, 123457);
  assert.equal(entry.settled_cost_microusd, 1);
});

test("credit and net cost are stored as micro-USD integers", () => {
  const entry = event({ credit_microusd: 250, net_cost_microusd: 9750 });
  assert.equal(entry.credit_microusd, 250);
  assert.equal(entry.net_cost_microusd, 9750);
});

test("schema v1 rows load through the read adapter", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-v1-"));
  fs.writeFileSync(
    path.join(stateDir, "usage.jsonl"),
    JSON.stringify({
      id: "legacy-event",
      at: "2026-08-16T10:00:00.000Z",
      task_id: "t-1",
      turn_id: "turn-1",
      request_kind: "probe",
      attempt: 0,
      provider_request_id: "legacy-req",
      executor: "relay",
      requested_model: "m",
      resolved_model: "m",
      protocol: "chat",
      duration_ms: 12,
      outcome: "ok",
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      estimated_cost: 0.002,
      reconciliation: "matched",
    }) + "\n",
  );
  const store = new TaskStore(stateDir, 20);
  const { events } = store.listUsageEvents({});
  assert.equal(events.length, 1);
  const adapted = events[0];
  assert.equal(adapted.schema_version, 1);
  assert.equal(adapted.asterroute_request_id, "legacy-req");
  assert.equal(adapted.request_kind, "protocol_probe");
  assert.equal(adapted.attempt, 1);
  assert.equal(adapted.presence_state, "matched");
  assert.equal(adapted.estimated_cost_microusd, 2000);
  assert.ok(!("provider_request_id" in adapted));
});

test("v1 rows without any id map to client_only; ambiguous ids stay unknown", () => {
  const noId = adaptV1Event({ usage: { input_tokens: 1 } });
  assert.equal(noId.presence_state, "client_only");
  const ambiguous = adaptV1Event({
    provider_request_id: "opaque-id",
    usage: { input_tokens: 1 },
    id_source_unknown: true,
  });
  assert.equal(ambiguous.asterroute_request_id, "opaque-id");
});

test("duplicate reconciliation application is idempotent", () => {
  const store = freshStore();
  const first = store.applyReconciliations([
    { request_id: "r", settled_cost_microusd: 100, billing_revision: "v1" },
  ]);
  const second = store.applyReconciliations([
    { request_id: "r", settled_cost_microusd: 100, billing_revision: "v1" },
  ]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(store.listReconciliations().length, 1);
});

test("usage events drop prompts, file content, paths, and credentials by construction", () => {
  const entry = createUsageEvent({
    usage: { input_tokens: 1 },
    prompt: "secret prompt",
    file_content: "secret file",
    workspace: "C:\\Users\\secret\\project",
    authorization: "Bearer sk-secret",
    api_key: "sk-secret",
    auth_project_id: "server-side-id",
    client_project_ref: "client-ref",
  });
  for (const banned of [
    "prompt",
    "file_content",
    "workspace",
    "authorization",
    "api_key",
    "auth_project_id",
    "client_project_ref",
  ]) {
    assert.ok(!(banned in entry), `${banned} must not be stored`);
  }
});

test("CSV export neutralizes formula injection", () => {
  assert.equal(csvCell("=cmd()"), '"\'=cmd()"');
  assert.equal(csvCell("+1+1"), '"\'+1+1"');
  assert.equal(csvCell("plain"), '"plain"');
  const csv = usageEventsToCsv([event({ asterroute_request_id: "=A1" })]);
  assert.ok(!csv.includes('"=A1"'));
  assert.match(csv, /asterroute_request_id/);
});

test("provider request ids deduplicate usage events (idempotent)", () => {
  const store = freshStore();
  const first = store.appendUsageEvent(event({ asterroute_request_id: "req-1" }));
  const second = store.appendUsageEvent(event({ asterroute_request_id: "req-1" }));
  assert.equal(first.client_event_id, second.client_event_id);
  assert.equal(store.listUsageEvents({}).total, 1);
});

test("usage event listing paginates deterministically", () => {
  const store = freshStore();
  for (let index = 0; index < 25; index += 1) {
    store.appendUsageEvent(
      event({ asterroute_request_id: `r-${index}`, usage: { input_tokens: index + 1 } }),
    );
  }
  const page1 = store.listUsageEvents({ limit: 10, offset: 0 });
  const page2 = store.listUsageEvents({ limit: 10, offset: 10 });
  const page3 = store.listUsageEvents({ limit: 10, offset: 20 });
  assert.equal(page1.total, 25);
  assert.equal(page1.events.length, 10);
  assert.equal(page2.events.length, 10);
  assert.equal(page3.events.length, 5);
  assert.notEqual(page1.events[0].client_event_id, page2.events[0].client_event_id);
});

test("retry attempts are recorded as separate events with increasing attempts", async () => {
  let attempts = 0;
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      attempts += 1;
      if (attempts === 1) {
        res.statusCode = 429;
        res.setHeader("retry-after", "0");
        res.setHeader("x-asterroute-request-id", "ar-429");
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
      attribution: { taskId: "task-1", taskKind: "production" },
    });
    const deadline = Date.now() + 3000;
    while (
      !events.some((entry) => entry.asterrouteRequestId === "chatcmpl-provider-1") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((entry) => entry.attempt), [1, 2]);
    assert.deepEqual(
      events.map((entry) => entry.requestKind),
      ["task_execution", "task_execution"],
    );
    assert.equal(events[0].asterrouteRequestId, "ar-429");
    assert.equal(events[1].asterrouteRequestId, "chatcmpl-provider-1");
    assert.equal(events[1].usage.total_tokens, 5);
  } finally {
    await executor.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("protocol probes emit request_kind=protocol_probe events with no task id", async () => {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
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
    assert.equal(events[0].requestKind, "protocol_probe");
    assert.equal(events[0].threadId, null);
  } finally {
    await executor.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("dimensional aggregation keeps estimated and settled micro-USD separate and orders stably", () => {
  const store = freshStore();
  const task = seedTask(store);
  store.appendUsageEvent(
    event({
      task_id: task.id,
      asterroute_request_id: "a-1",
      resolved_model: "m1",
      estimated_cost: 0.01,
    }),
  );
  store.appendUsageEvent(
    event({
      task_id: task.id,
      asterroute_request_id: "a-2",
      resolved_model: "m2",
      estimated_cost: 0.02,
      settled_cost: 0.015,
    }),
  );
  const report = usageDimensions(store, { by: "model" });
  assert.equal(report.total_groups, 2);
  assert.equal(report.rows[0].model, "m1");
  assert.equal(report.rows[1].model, "m2");
  assert.equal(report.rows[0].estimated_cost_microusd, 10000);
  assert.equal(report.rows[0].settled_cost_microusd, null);
  assert.equal(report.rows[1].estimated_cost_microusd, 20000);
  assert.equal(report.rows[1].settled_cost_microusd, 15000);
  const again = usageDimensions(store, { by: "model" });
  assert.deepEqual(again.rows, report.rows);
});
