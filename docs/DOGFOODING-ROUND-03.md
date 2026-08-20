# Dogfooding Round 03 — mocked native reroute

Date: 2026-08-21

## Goal

Verify the P1 native cross-executor continuation state machine with local
mocks, zero model quota, and zero external provider calls.

## Scenarios

The mock integration suite in `tests/reroute-orchestrator.test.js` covers:

1. Executor A returns `quota_exhausted`; the same task and logical id continue
   on compatible executor B with a two-entry executor history.
2. No compatible candidate produces `blocked` with
   `no_compatible_executor`.
3. `max_reroutes=0` produces `blocked` with `reroute_limit_reached`.
4. Implementation/test evidence remains on executor A and never switches.
5. `continue_project` with an explicit compatible executor creates a child in
   the same logical lineage and starts a new executor session.

## Evidence

```text
node --test tests/reroute-orchestrator.test.js
tests 5
pass 5
fail 0
```

The repository gate is `npm run verify`. Every scenario uses local mock
executors. Automatic reroute remains disabled by default.
