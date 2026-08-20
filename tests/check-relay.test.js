import test from "node:test";
import assert from "node:assert/strict";
import { checkRelay, resolveRelayKey } from "../scripts/check-relay.js";

function fakeFetch(status) {
  return async () => ({ status });
}

const asterrouteRelay = {
  id: "asterroute",
  preset: "asterroute",
  baseUrl: "https://asterroute.com/v1",
};

test("resolveRelayKey reads the preset apiKeyEnv when the relay omits it", () => {
  const env = { ASTERROUTE_API_KEY: "k" };
  const resolved = resolveRelayKey(asterrouteRelay, env);
  assert.equal(resolved.envName, "ASTERROUTE_API_KEY");
  assert.equal(resolved.fromEnv, true);
  assert.equal(resolved.fromConfig, false);
  assert.equal(resolved.key, "k");
});

test("resolveRelayKey honors an explicit apiKeyEnv override", () => {
  const relay = { ...asterrouteRelay, apiKeyEnv: "ACP_RELAY_X_KEY" };
  const env = { ACP_RELAY_X_KEY: "kx" };
  const resolved = resolveRelayKey(relay, env);
  assert.equal(resolved.envName, "ACP_RELAY_X_KEY");
  assert.equal(resolved.key, "kx");
});

test("resolveRelayKey falls back to the apiKey field when env is absent", () => {
  const relay = { ...asterrouteRelay, apiKey: "cfg-key" };
  const resolved = resolveRelayKey(relay, {});
  assert.equal(resolved.fromConfig, true);
  assert.equal(resolved.key, "cfg-key");
});

test("checkRelay reports missing_api_key without key material", async () => {
  const result = await checkRelay(asterrouteRelay, {}, fakeFetch(200));
  assert.equal(result.available, false);
  assert.equal(result.reason, "missing_api_key");
  assert.equal(result.keySource, null);
});

test("checkRelay passes when the models endpoint returns 200", async () => {
  const env = { ASTERROUTE_API_KEY: "k" };
  const result = await checkRelay(asterrouteRelay, env, fakeFetch(200));
  assert.equal(result.available, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.keySource, "env");
});

test("checkRelay fails on a non-200 models response", async () => {
  const env = { ASTERROUTE_API_KEY: "k" };
  const result = await checkRelay(asterrouteRelay, env, fakeFetch(401));
  assert.equal(result.available, false);
  assert.equal(result.reason, "http_401");
});

test("checkRelay fails on a request error", async () => {
  const env = { ASTERROUTE_API_KEY: "k" };
  const result = await checkRelay(
    asterrouteRelay,
    env,
    async () => {
      throw new Error("network down");
    },
  );
  assert.equal(result.available, false);
  assert.equal(result.reason, "request_failed");
});
