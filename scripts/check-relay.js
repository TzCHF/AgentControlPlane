#!/usr/bin/env node
// Relay configuration and connectivity check.
//
// For every relay in config.executor.relays, resolves the API key source
// (the environment variable named by apiKeyEnv or the preset default, then
// the apiKey field) and reports key presence with key material kept
// internal, then verifies the OpenAI-compatible base URL answers
// GET /v1/models with HTTP 200. Exits with code 1 when any configured
// relay is missing a key or fails the connectivity check.
//
// Usage:
//   node scripts/check-relay.js              # resolve config via loadConfig
//   node scripts/check-relay.js <config.json>  # explicit config file
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePreset } from "../src/executors/provider-presets.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Resolves the effective API key source for one relay config entry.
// Returns presence booleans and the key value; the key is used only inside
// this module and is never printed.
export function resolveRelayKey(relay, env = process.env) {
  const preset = relay?.preset ? resolvePreset(relay.preset) : null;
  const merged = { ...(preset ?? {}), ...(relay ?? {}) };
  const envName = merged.apiKeyEnv ?? null;
  const fromEnv = envName ? env[envName] : undefined;
  const fromConfig = merged.apiKey ?? null;
  return {
    envName,
    fromEnv: Boolean(fromEnv),
    fromConfig: Boolean(fromConfig),
    key: fromEnv ?? fromConfig ?? null,
  };
}

// Checks one relay entry: key presence first, then a live /v1/models probe.
// fetchImpl is injectable for tests.
export async function checkRelay(relay, env = process.env, fetchImpl = fetch) {
  const resolved = resolveRelayKey(relay, env);
  const baseUrl = String(relay?.baseUrl ?? "").replace(/\/+$/, "");
  const result = {
    id: relay?.id ?? "?",
    baseUrl,
    apiKeyConfigured: Boolean(resolved.key),
    envName: resolved.envName ?? null,
    keySource: resolved.fromEnv ? "env" : resolved.fromConfig ? "config" : null,
  };
  if (!resolved.key) {
    result.available = false;
    result.reason = "missing_api_key";
    return result;
  }
  if (!baseUrl) {
    result.available = false;
    result.reason = "invalid_base_url";
    return result;
  }
  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${resolved.key}` },
      signal: AbortSignal.timeout(15000),
    });
    result.httpStatus = response.status;
    result.available = response.status === 200;
    result.reason = response.status === 200 ? null : `http_${response.status}`;
  } catch (error) {
    result.available = false;
    result.reason = "request_failed";
    result.error = error?.message ?? String(error);
  }
  return result;
}

async function main(argv) {
  let config;
  if (argv[0]) {
    const abs = path.resolve(root, argv[0]);
    config = JSON.parse(fs.readFileSync(abs, "utf8"));
  } else {
    const { loadConfig } = await import("../src/core/config.js");
    config = loadConfig();
  }
  const relays = config.executor?.relays ?? [];
  if (relays.length === 0) {
    console.log("no relays configured");
    return 0;
  }
  let failed = false;
  for (const relay of relays) {
    const result = await checkRelay(relay);
    const status = result.available ? "OK" : "FAIL";
    const detail = result.reason ?? "";
    console.log(
      `[${status}] ${result.id} base_url=${result.baseUrl} key_source=${result.keySource ?? "none"}${detail ? ` reason=${detail}` : ""}${result.httpStatus ? ` http=${result.httpStatus}` : ""}`,
    );
    if (!result.available) failed = true;
  }
  return failed ? 1 : 0;
}

const invokedAsCli =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsCli) {
  main(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
