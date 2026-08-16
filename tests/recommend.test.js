import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  extractTaskRequirements,
  normalizeCandidate,
  filterCandidates,
  recommendModels,
} from "../src/core/recommend.js";
import { OpenAICompatibleExecutor } from "../src/executors/openai-compatible-executor.js";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";

const config = {
  recommendation: {
    contextTokens: { economy: 16000, balanced: 64000, deep: 128000 },
    latencyTargetMs: { economy: 2000, balanced: 4000, deep: 8000 },
    costCap: { economy: 0.2, balanced: 2, deep: 10 },
    weights: {
      economy: { capability_fit: 30, confidence: 10, health: 10, latency: 10, pricing: 30, tier: 0, freshness: 10 },
      balanced: { capability_fit: 30, confidence: 15, health: 10, latency: 10, pricing: 15, tier: 5, freshness: 15 },
      deep: { capability_fit: 40, confidence: 15, health: 10, latency: 5, pricing: 10, tier: 5, freshness: 15 },
    },
  },
};

function candidate(model) {
  return normalizeCandidate("relay", model);
}

function baseModel(overrides = {}) {
  return {
    id: "m",
    capabilities: { chat: true, responses: false, tools: true, reasoning: true, vision: false },
    status: "live",
    route_health: "healthy",
    context: 128000,
    latency: { avgMs: 1200, sampleCount: 10 },
    pricing: { input: 0.6, output: 1.2, cached_input: 0.2 },
    tier: "pro",
    metadata_freshness_seconds: 30,
    ...overrides,
  };
}

test("explicit model is never overridden by the recommendation", () => {
  const requirements = extractTaskRequirements(
    { objective: "Create hello.txt", profile: "economy", model: "user-model" },
    config,
  );
  const ranked = recommendModels({
    candidates: [candidate(baseModel({ id: "user-model" })), candidate(baseModel({ id: "other" }))],
    requirements,
    config,
  });
  assert.equal(ranked.selected_model, null);
  assert.equal(requirements.requested_model, "user-model");
  assert.equal(ranked.requirements.requested_model, "user-model");
});

test("tools=false candidates are excluded", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const result = recommendModels({
    candidates: [candidate(baseModel({ id: "no-tools", capabilities: { tools: false } }))],
    requirements,
    config,
  });
  assert.equal(result.ranked.length, 0);
  assert.deepEqual(result.excluded[0].reasons, ["tools_unsupported"]);
});

test("tools=unknown is a warning candidate, never treated as false", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const result = recommendModels({
    candidates: [candidate(baseModel({ id: "unknown-tools", capabilities: { tools: null } }))],
    requirements,
    config,
  });
  assert.equal(result.ranked.length, 1);
  assert.ok(result.ranked[0].warnings.includes("tools_unknown"));
});

test("route unhealthy excludes with a route reason, separate from capability", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const result = recommendModels({
    candidates: [
      candidate(baseModel({ id: "bad-route", route_health: "unhealthy" })),
    ],
    requirements,
    config,
  });
  assert.equal(result.ranked.length, 0);
  assert.deepEqual(result.excluded[0].reasons, ["route_unhealthy"]);
});

test("status unavailable excludes the candidate", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const result = recommendModels({
    candidates: [candidate(baseModel({ id: "offline", status: "offline" }))],
    requirements,
    config,
  });
  assert.equal(result.ranked.length, 0);
  assert.deepEqual(result.excluded[0].reasons, ["status_unavailable"]);
});

test("insufficient context excludes the candidate", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const result = recommendModels({
    candidates: [candidate(baseModel({ id: "small", context: 4000 }))],
    requirements,
    config,
  });
  assert.equal(result.ranked.length, 0);
  assert.deepEqual(result.excluded[0].reasons, ["context_insufficient"]);
});

test("missing pricing still ranks with an unknown-cost warning", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const result = recommendModels({
    candidates: [candidate(baseModel({ id: "no-price", pricing: null }))],
    requirements,
    config,
  });
  assert.equal(result.ranked.length, 1);
  assert.ok(result.ranked[0].warnings.includes("pricing_unknown"));
  assert.equal(result.ranked[0].estimated_cost_range, null);
});

test("latency sampleCount below 3 carries a warning and neutral latency", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const result = recommendModels({
    candidates: [
      candidate(
        baseModel({ id: "few-samples", latency: { avgMs: 900, sampleCount: 2 } }),
      ),
    ],
    requirements,
    config,
  });
  assert.equal(result.ranked.length, 1);
  assert.ok(result.ranked[0].warnings.includes("latency_samples_insufficient"));
});

test("stale metadata carries a warning", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const result = recommendModels({
    candidates: [
      candidate(baseModel({ id: "stale", metadata_freshness_seconds: 7200 })),
    ],
    requirements,
    config,
  });
  assert.ok(result.ranked[0].warnings.includes("metadata_stale"));
});

test("providers without extended metadata stay compatible", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const result = recommendModels({
    candidates: [candidate({ id: "bare-model" })],
    requirements,
    config,
  });
  assert.equal(result.ranked.length, 1);
  for (const warning of ["status_unknown", "tools_unknown", "pricing_unknown"]) {
    assert.ok(result.ranked[0].warnings.includes(warning), warning);
  }
});

test("explicit null metadata fields are unknown, never zero or excluded", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "economy" }, config);
  const result = recommendModels({
    candidates: [
      candidate(
        baseModel({
          id: "null-fields",
          context: null,
          latency: { avgMs: null, sampleCount: null },
          metadata_freshness_seconds: null,
        }),
      ),
    ],
    requirements,
    config,
  });
  assert.equal(result.ranked.length, 1);
  const entry = result.ranked[0];
  assert.ok(entry.warnings.includes("context_unknown"));
  assert.equal(entry.latency_avg_ms, null);
  assert.equal(entry.metadata_freshness_seconds, null);
});

test("the recommender core carries no provider-specific branches", () => {
  const source = fs.readFileSync(
    new URL("../src/core/recommend.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /asterroute/i);
});

test("recommendation snapshots replay deterministically", () => {
  const requirements = extractTaskRequirements({ objective: "x", profile: "balanced" }, config);
  const candidates = [
    candidate(baseModel({ id: "a" })),
    candidate(baseModel({ id: "b" })),
  ];
  const first = recommendModels({ candidates, requirements, config });
  const second = recommendModels({ candidates, requirements, config });
  delete first.generated_at;
  delete second.generated_at;
  assert.deepEqual(second, first);
});

test("protocol probe usage stays separate from task usage", async () => {
  let chatRounds = 0;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : {};
    requests.push({ url: req.url, body });
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "probe-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const userText = String(body?.messages?.[0]?.content ?? "");
      if (userText === "Call the ping tool exactly once.") {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "c1",
                      type: "function",
                      function: { name: "ping", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 4,
              total_tokens: 999,
              prompt_tokens_details: { cached_tokens: 0 },
              completion_tokens_details: { reasoning_tokens: 0 },
            },
          }),
        );
        return;
      }
      chatRounds += 1;
      res.end(
        JSON.stringify({
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
          usage: {
            prompt_tokens: 30,
            completion_tokens: 15,
            total_tokens: 45,
            prompt_tokens_details: { cached_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 0 },
          },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const executor = new OpenAICompatibleExecutor({
    baseUrl,
    protocol: "auto",
  });
  try {
    const discovery = await executor.probe();
    assert.equal(discovery.protocols.probe_usage.total_tokens, 999);

    await executor.start();
    const notifications = [];
    executor.on("notification", (message) => notifications.push(message));
    const { thread } = await executor.startThread({ cwd: os.tmpdir() });
    await executor.setGoal({ threadId: thread.id, objective: "x", tokenBudget: 5000 });
    await executor.startTurn({
      threadId: thread.id,
      input: [{ type: "text", text: "x" }],
      model: "probe-model",
      cwd: os.tmpdir(),
      outputSchema: {},
    });
    const deadline = Date.now() + 2000;
    while (
      !notifications.some((entry) => entry.method === "turn/completed") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const usageEvent = notifications
      .filter((entry) => entry.method === "thread/tokenUsage/updated")
      .at(-1);
    assert.equal(usageEvent.params.tokenUsage.last.totalTokens, 45);
  } finally {
    await executor.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("dispatch records the recommendation snapshot and the resolved model", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-rec-ws-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-rec-state-"));
  const relay = new OpenAICompatibleExecutor({
    id: "relay-x",
    displayName: "Relay X",
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: null,
    protocol: "chat",
    models: ["user-model", "cheap-model"],
    workspaceRoots: [workspace],
  });
  const runtimeConfig = {
    ...config,
    workspaceRoots: [workspace],
    executor: { provider: "auto", routing: { order: ["relay-x"] }, openaiCompat: {} },
    codex: { command: "codex" },
    profiles: {
      economy: { model: null, effort: "low", maxSubagents: 0, tokenBudget: 30000, summary: "concise" },
      balanced: { model: null, effort: "medium", maxSubagents: 0, tokenBudget: 30000, summary: "concise" },
    },
    limits: {
      maxBriefCharacters: 24000,
      maxConcurrentTasks: 1,
      maxQueuedTasks: 10,
      maxTokenBudget: 250000,
      maxStoredEventsPerTask: 20,
      maxTaskRuntimeMinutes: 1,
    },
  };
  const store = new TaskStore(stateDir, 20);
  const orchestrator = new Orchestrator({
    config: runtimeConfig,
    store,
    executors: new Map([["relay-x", relay]]),
    defaultProvider: "auto",
  });
  const task = orchestrator.dispatch({
    workspace,
    objective: "Create hello.txt",
    executor: "relay-x",
    model: "user-model",
    profile: "economy",
  });
  orchestrator.cancel(task.id);
  const stored = store.getTask(task.id);
  assert.equal(stored.policy.model, "user-model");
  assert.ok(stored.recommendation, "recommendation snapshot stored");
  assert.equal(stored.recommendation.selected_model, "user-model");
  assert.equal(stored.recommendation.requirements.requested_model, "user-model");
  assert.ok(stored.recommendation.catalog_hash.length > 0);
  assert.ok(Array.isArray(stored.recommendation.ranked));
  assert.ok(Array.isArray(stored.recommendation.excluded));
});
