import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  createUsageEvent,
  PRESENCE_STATES,
  TOKEN_STATES,
  SETTLEMENT_STATES,
  normalizePresence,
  normalizeToken,
  normalizeSettlement,
} from "../src/core/usage-events.js";
import { reconcileClientFor } from "../src/core/reconcile-client.js";

const SCHEMA_PATH = new URL(
  "../contracts/usage-reconciliation-v2.schema.json",
  import.meta.url,
);
const SCHEMA_HASH = "3d0449ad4cc500f2aadc49ed848a4dfddcdb3361bcd163a9dbd65de58ae0cc14";

test("contract schema hash matches the frozen version", () => {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  const hash = crypto.createHash("sha256").update(schema).digest("hex");
  assert.equal(hash, SCHEMA_HASH);
  const parsed = JSON.parse(schema);
  assert.equal(parsed.properties.schema_version.const, 2);
});

test("new writes emit only the frozen enumeration values", () => {
  const entry = createUsageEvent({
    asterroute_request_id: "req-1",
    usage: { input_tokens: 1 },
  });
  assert.ok(PRESENCE_STATES.has(entry.presence_state));
  assert.ok(TOKEN_STATES.has(entry.token_state));
  assert.ok(SETTLEMENT_STATES.has(entry.settlement_state));
  assert.ok(!["matched", "match", "cost_pending"].includes(entry.presence_state));
  assert.ok(!["match", "pending"].includes(entry.token_state));
  assert.ok(!["cost_pending"].includes(entry.settlement_state));
});

test("legacy aliases normalize on read", () => {
  assert.equal(normalizePresence("matched"), "both");
  assert.equal(normalizeToken("match"), "matched");
  assert.equal(normalizeSettlement("cost_pending"), "pending");
  assert.equal(normalizePresence("both"), "both");
  assert.equal(normalizeToken("mismatch"), "mismatch");
  assert.equal(normalizeSettlement("adjusted"), "adjusted");
});

test("same-origin reconcile endpoints reuse the relay key", () => {
  const { client, error } = reconcileClientFor({
    relayConfig: { apiKey: "relay-key", reconcileUrl: "https://relay.example/v1/reconcile" },
    executorBaseUrl: "https://relay.example/v1",
  });
  assert.equal(error, null);
  assert.equal(client.apiKey, "relay-key");
});

test("cross-origin reconcile endpoints refuse the relay key", () => {
  const { client, error } = reconcileClientFor({
    relayConfig: { apiKey: "relay-key", reconcileUrl: "https://other.example/reconcile" },
    executorBaseUrl: "https://relay.example/v1",
  });
  assert.equal(error, "reconcile_cross_origin_without_key");
  assert.equal(client, null);
});

test("cross-origin reconcile endpoints accept a dedicated key", () => {
  const { client, error } = reconcileClientFor({
    relayConfig: {
      apiKey: "relay-key",
      reconcileUrl: "https://other.example/reconcile",
      reconcileApiKey: "dedicated-key",
    },
    executorBaseUrl: "https://relay.example/v1",
  });
  assert.equal(error, null);
  assert.equal(client.apiKey, "dedicated-key");
});

test("relay key is not sent when no reconcile endpoint is configured", () => {
  const { client, error } = reconcileClientFor({
    relayConfig: { apiKey: "relay-key" },
    executorBaseUrl: "https://relay.example/v1",
  });
  assert.equal(error, "reconcile_client_unconfigured");
  assert.equal(client, null);
});
