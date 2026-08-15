import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildExecutors } from "../src/server.js";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";
import { ControlPlaneError } from "../src/core/errors.js";
import { OpenAICompatibleExecutor } from "../src/executors/openai-compatible-executor.js";

function relayConfig(relays) {
  return {
    workspaceRoots: [],
    codex: { command: "codex" },
    executor: {
      provider: "auto",
      routing: { order: ["codex"] },
      openaiCompat: {},
      deepseek: {},
      relays,
    },
  };
}

test("buildExecutors registers each relay as a model-endpoint executor", () => {
  const executors = buildExecutors(
    relayConfig([
      {
        id: "asterroute",
        displayName: "AsterRoute",
        baseUrl: "https://relay.example/v1",
        apiKey: "k",
        protocol: "chat",
        models: ["relay-model-a"],
        requestsPerMinute: 10,
      },
      {
        id: "secondary",
        baseUrl: "https://second.example/v1",
        protocol: "chat",
      },
    ]),
  );
  const asterroute = executors.get("asterroute");
  assert.ok(asterroute);
  assert.equal(asterroute.describe().display_name, "AsterRoute");
  assert.equal(asterroute.describe().kind, "model-endpoint");
  assert.deepEqual(asterroute.staticModels, ["relay-model-a"]);
  assert.equal(asterroute.requestsPerMinute, 10);

  const secondary = executors.get("secondary");
  assert.ok(secondary);
  assert.equal(secondary.describe().display_name, "secondary");
  assert.deepEqual(secondary.staticModels, []);
  assert.equal(secondary.requestsPerMinute, null);
});

test("relay ids must be non-empty and must not collide with built-ins", () => {
  assert.throws(
    () => buildExecutors(relayConfig([{ baseUrl: "https://x.example/v1" }])),
    (error) =>
      error instanceof ControlPlaneError && error.code === "invalid_relay_id",
  );
  assert.throws(
    () =>
      buildExecutors(
        relayConfig([
          { id: "codex", baseUrl: "https://x.example/v1" },
        ]),
      ),
    (error) =>
      error instanceof ControlPlaneError &&
      error.code === "duplicate_executor_id",
  );
});

test("dispatch validates relay models against the static allowlist", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-relay-ws-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-relay-state-"));
  const config = {
    workspaceRoots: [workspace],
    codex: { command: "codex" },
    executor: {
      provider: "auto",
      routing: { order: ["asterroute"] },
      openaiCompat: {},
      relays: [],
    },
    profiles: {
      economy: {
        model: null,
        effort: "low",
        maxSubagents: 0,
        tokenBudget: 30000,
        summary: "concise",
      },
      balanced: {
        model: null,
        effort: "medium",
        maxSubagents: 0,
        tokenBudget: 30000,
        summary: "concise",
      },
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
  const relay = new OpenAICompatibleExecutor({
    id: "asterroute",
    displayName: "AsterRoute",
    baseUrl: "https://relay.example/v1",
    apiKey: "k",
    protocol: "chat",
    models: ["relay-model-a"],
    workspaceRoots: [workspace],
  });
  const orchestrator = new Orchestrator({
    config,
    store,
    executors: new Map([["asterroute", relay]]),
    defaultProvider: "auto",
  });

  const accepted = orchestrator.dispatch({
    workspace,
    objective: "Create hello.txt",
    executor: "asterroute",
    model: "relay-model-a",
    profile: "economy",
  });
  assert.equal(accepted.policy.model, "relay-model-a");
  orchestrator.cancel(accepted.id);

  assert.throws(
    () =>
      orchestrator.dispatch({
        workspace,
        objective: "Create hello.txt",
        executor: "asterroute",
        model: "relay-model-b",
        profile: "economy",
      }),
    (error) => error instanceof ControlPlaneError && error.code === "unknown_model",
  );
});
