// Usage / Reconciliation wire contract v2 conformance tests.
//
// SHARED FILE: byte-identical between the AsterRoute gateway repository and
// the AgentControlPlane repository (tests/contract-schema.test.mjs in both,
// schema at contracts/usage-reconciliation-v2.schema.json in both). Change it
// in both repositories or neither.
//
// The schema describes the CANONICAL frozen wire contract. Endpoints may
// still ACCEPT the documented compatibility READ aliases (presence matched ->
// both, token match -> matched, settlement cost_pending -> pending) and
// normalize them; new writers must never produce the legacy values, which is
// why alias values fail validation here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SCHEMA_URL = new URL("../contracts/usage-reconciliation-v2.schema.json", import.meta.url);
const PINNED_SHA256 = "64900f5746ebe239dfaf7ecb4efae80c76c1bc79cf4536a934abbb3777166dc8";

const SUPPORTED_KEYWORDS = new Set([
  "$schema", "$id", "$ref", "$defs", "title", "description", "contractVersion",
  "type", "enum", "const", "required", "properties", "additionalProperties", "items",
  "pattern", "minimum", "minItems", "maxItems", "minLength", "maxLength", "oneOf",
]);

function schemaHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSupportedKeywords(node, path) {
  if (Array.isArray(node)) {
    for (const entry of node) assertSupportedKeywords(entry, path);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      assert.fail(`schema keyword not supported by the conformance checker at ${path}: ${key}`);
    }
    if (key === "$defs" || key === "properties") {
      // These maps hold user-chosen names; only their VALUES are schemas.
      for (const subschema of Object.values(value)) {
        assertSupportedKeywords(subschema, `${path}.${key}.*`);
      }
    } else if (typeof value === "object") {
      assertSupportedKeywords(value, `${path}.${key}`);
    }
  }
}

function resolveRef(ref, root) {
  assert.match(ref, /^#\/\$defs\//, `unsupported ref: ${ref}`);
  const name = ref.slice("#/$defs/".length);
  const resolved = root.$defs?.[name];
  assert.ok(resolved, `unknown ref: ${ref}`);
  return resolved;
}

function matchesType(value, type) {
  switch (type) {
    case "string": return typeof value === "string";
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    default: assert.fail(`unsupported type: ${type}`);
  }
}

function validate(instance, schema, root) {
  if (schema.$ref) return validate(instance, resolveRef(schema.$ref, root), root);
  if (schema.oneOf) return schema.oneOf.some((branch) => validate(instance, branch, root));
  if (schema.enum) return schema.enum.includes(instance);
  if (schema.const !== undefined) return instance === schema.const;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type !== undefined && !types.some((type) => matchesType(instance, type))) {
    return false;
  }
  if (schema.type === undefined && typeof instance === "object" && instance !== null
    && (schema.required || schema.properties)) {
    return false;
  }
  if (typeof instance === "string") {
    if (schema.minLength !== undefined && instance.length < schema.minLength) return false;
    if (schema.maxLength !== undefined && instance.length > schema.maxLength) return false;
    if (schema.pattern !== undefined && !new RegExp(`^(?:${schema.pattern})$`).test(instance)) {
      return false;
    }
  }
  if (Number.isInteger(instance)) {
    if (schema.minimum !== undefined && instance < schema.minimum) return false;
  }
  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) return false;
    if (schema.items !== undefined && !instance.every((entry) => validate(entry, schema.items, root))) {
      return false;
    }
  }
  if (instance !== null && typeof instance === "object" && !Array.isArray(instance)) {
    for (const required of schema.required ?? []) {
      if (!(required in instance)) return false;
    }
    if (schema.properties !== undefined) {
      for (const [key, subschema] of Object.entries(schema.properties)) {
        if (key in instance && !validate(instance[key], subschema, root)) return false;
      }
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      if (Object.keys(instance).some((key) => !known.has(key))) return false;
    }
  }
  return true;
}

function conforms(instance) {
  return (root) => {
    assertSupportedKeywords(root, "$");
    assert.ok(
      root.oneOf.some((branch) => validate(instance, branch, root)),
      `payload did not match any message variant: ${JSON.stringify(instance)}`,
    );
  };
}

function rejects(instance) {
  return (root) => {
    assertSupportedKeywords(root, "$");
    assert.ok(
      !root.oneOf.some((branch) => validate(instance, branch, root)),
      `payload unexpectedly matched a message variant: ${JSON.stringify(instance)}`,
    );
  };
}

const root = JSON.parse(await readFile(SCHEMA_URL, "utf8"));

test("both repositories pin the same schema bytes (sha256)", async () => {
  const bytes = await readFile(SCHEMA_URL);
  assert.equal(schemaHash(bytes), PINNED_SHA256);
  assert.equal(root.contractVersion, "2.0");
});

test("schema stays within the supported keyword subset", () => {
  assertSupportedKeywords(root, "$");
});

test("lookup request: 1-500 safe ids pass; unsafe or oversized ids fail", () => {
  conforms({ ids: ["ffbfcff2-e857-4689-a8f9-13d9427fed9b", "req-2"] })(root);
  rejects({ ids: ["not a uuid", "x"] })(root);
  rejects({ ids: Array.from({ length: 501 }, (_, i) => `id-${i}`) })(root);
  rejects({ ids: [] })(root);
  rejects({ request_ids: ["a"] })(root);
});

test("lookup response rows: canonical states pass, legacy aliases and floats fail", () => {
  const row = {
    asterroute_request_id: "ffbfcff2-e857-4689-a8f9-13d9427fed9b",
    upstream_request_id: "chatcmpl-upstream-1",
    requested_model: "gpt-5.6-sol",
    resolved_model: "gpt-5.6-sol",
    protocol: "chat",
    status_code: 200,
    outcome: "success",
    token_dimensions: { input: 18, output: 5, cached_input: 0, reasoning_output: 0 },
    presence_state: "both",
    token_state: "matched",
    settlement_state: "settled",
    estimated_cost_microusd: 100000,
    settled_cost_microusd: 32,
    credit_microusd: 0,
    net_cost_microusd: 32,
    currency: "USD",
    pricing_version: "legacy",
    billing_revision: "pre-3.1",
    settled_at: "2026-08-16T12:07:50Z",
  };
  conforms({ rows: [row] })(root);
  conforms({ rows: [{ ...row, upstream_request_id: null, presence_state: "unknown", settlement_state: "pending" }] })(root);
  rejects({ rows: [{ ...row, presence_state: "matched" }] })(root);
  rejects({ rows: [{ ...row, token_state: "match" }] })(root);
  rejects({ rows: [{ ...row, settlement_state: "cost_pending" }] })(root);
  rejects({ rows: [{ ...row, settled_cost_microusd: 0.5 }] })(root);
  rejects({ rows: [{ ...row, net_cost_microusd: -1 }] })(root);
  rejects({ rows: [{ asterroute_request_id: 42 }] })(root);
});

test("record request: canonical observations pass; aliases and junk fail", () => {
  conforms({
    source: "acp-reconcile",
    observed_at: "2026-08-16T14:00:00Z",
    items: [{ asterroute_request_id: "req-1", presence_state: "both", token_state: "matched" }],
  })(root);
  conforms({
    source: "acp-reconcile",
    observed_at: "2026-08-16T14:00:00Z",
    items: [{ asterroute_request_id: "req-1", presence_state: null, token_state: "unknown" }],
  })(root);
  rejects({
    source: "acp-reconcile",
    observed_at: "2026-08-16T14:00:00Z",
    items: [{ asterroute_request_id: "req-1", presence_state: "matched" }],
  })(root);
  rejects({
    source: "acp-reconcile",
    observed_at: "2026-08-16T14:00:00Z",
    items: [{ asterroute_request_id: "req-1", presence_state: "both", settled_cost_microusd: 5 }],
  })(root);
  rejects({
    source: "acp-reconcile",
    observed_at: "2026-08-16T14:00:00Z",
    items: [{ asterroute_request_id: "req-1", presence_state: "bogus" }],
  })(root);
});

test("record response shape passes", () => {
  conforms({ run_id: "run-1", items: 1 })(root);
});

test("usage report response: scope is a frozen enum and money fields are integers", () => {
  const base = {
    group_by: "model",
    hours: 24,
    scope: "production",
    offset: 0,
    limit: 5,
    rows: [{
      groupKey: "gpt-5.6-sol",
      requests: 42,
      successCount: 42,
      rateLimitedCount: 0,
      errorCount: 0,
      inputTokens: 37504,
      outputTokens: 4818,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
      estimatedMicrousd: 4200000,
      actualMicrousd: 27097,
      netMicrousd: 27097,
      creditMicrousd: 0,
      upstreamMicrousd: 19913,
      avgLatencyMs: 5140,
    }],
  };
  conforms(base)(root);
  conforms({ ...base, scope: "diagnostic" })(root);
  conforms({ ...base, scope: "all" })(root);
  rejects({ ...base, scope: "bogus" })(root);
  rejects({ ...base, rows: [{ ...base.rows[0], netMicrousd: 27097.5 }] })(root);
});

test("usage events conform: canonical states, 1-based attempt, integer micro-USD", () => {
  const event = {
    schema_version: 2,
    client_event_id: "evt-1",
    asterroute_request_id: "req-1",
    upstream_request_id: "chatcmpl-up-1",
    task_id: "task-1",
    turn_id: "turn-1",
    task_kind: "production",
    request_kind: "task_execution",
    attempt: 1,
    presence_state: "both",
    token_state: "matched",
    settlement_state: "pending",
    estimated_cost_microusd: 100000,
    settled_cost_microusd: null,
    credit_microusd: 0,
    net_cost_microusd: null,
    currency: "USD",
    pricing_version: "markup-3500",
    billing_revision: "phase3.1",
  };
  conforms(event)(root);
  conforms({
    ...event,
    asterroute_request_id: null,
    upstream_request_id: null,
    task_id: null,
    presence_state: "unknown",
    token_state: "unknown",
  })(root);
  rejects({ ...event, attempt: 0 })(root);
  rejects({ ...event, presence_state: "matched" })(root);
  rejects({ ...event, token_state: "match" })(root);
  rejects({ ...event, settlement_state: "cost_pending" })(root);
  rejects({ ...event, estimated_cost_microusd: 1.5 })(root);
  rejects({ ...event, prompt: "secret" })(root);
});
