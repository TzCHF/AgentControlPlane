import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyExecutorFailure,
  resolveRerouteConfig,
} from "../src/core/reroute.js";

test("classifies only allowed infrastructure failures for reroute", () => {
  assert.equal(classifyExecutorFailure({ status: 429 }), "rate_limited");
  assert.equal(
    classifyExecutorFailure({ code: "insufficient_balance", status: 402 }),
    "quota_exhausted",
  );
  assert.equal(
    classifyExecutorFailure({ status: 401, code: "invalid_api_key" }),
    "authentication_unavailable",
  );
  assert.equal(
    classifyExecutorFailure({ status: 503, message: "upstream error" }),
    "provider_unavailable",
  );
  assert.equal(
    classifyExecutorFailure({ code: "ENOENT", message: "spawn failed" }),
    "executor_unavailable",
  );
});

test("test, build, implementation, and validation evidence never reroute", () => {
  for (const label of ["test", "build", "implementation", "validation"]) {
    assert.equal(
      classifyExecutorFailure(
        { status: 503 },
        { result: { status: "failed", tests: [`${label} failed`] } },
      ),
      "task_failure",
    );
  }
  assert.equal(
    classifyExecutorFailure({ message: "ordinary coding failure" }),
    "task_failure",
  );
});

test("reroute config is disabled by default and validates its guardrails", () => {
  const defaults = resolveRerouteConfig();
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.max_reroutes, 2);
  assert.deepEqual(defaults.allowed_reasons, [
    "quota_exhausted",
    "rate_limited",
    "executor_unavailable",
    "authentication_unavailable",
    "provider_unavailable",
  ]);
  assert.throws(
    () => resolveRerouteConfig({ enabled: true, max_reroutes: 11 }),
    /max_reroutes/,
  );
  assert.throws(
    () => resolveRerouteConfig({ allowed_reasons: ["test_failure"] }),
    /unsupported reason/,
  );
});
