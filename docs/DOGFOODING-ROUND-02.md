# Dogfooding round 2 — true development handoff (2026-08-20)

Task: add a relay configuration and connectivity checker
(`scripts/check-relay.js` with tests, an npm script, and a docs row).
Executor A = Harness implemented ~60% and stopped with a real uncommitted
diff plus a DEVELOPMENT HANDOFF. Executor B = OpenCode (via the AsterRoute
provider, model gpt-5.6-sol) resumed from the handoff, the repository, and
the working tree only — no chat history.

## Executor sequence

| # | Executor | Result |
|---|---|---|
| A | Harness | partial (~60%): script + 7 mock-based tests, all green, left uncommitted |
| B | OpenCode (AsterRoute/gpt-5.6-sol) | completed: npm script, docs row, live run verified, full suite + verify green |

## Metrics

- context_lost: 0 real loss. B's only stated ambiguity was whether
  `ASTERROUTE_API_KEY` existed in its process environment; the launch
  wrapper injected it from the registry and B confirmed it via the live
  run (HTTP 200). Everything else came from the handoff.
- duplicate_work: none. B reported "the inherited files match the
  handoff", preserved them, and made one targeted defect fix (CLI exit via
  `process.exitCode` so pending fetch resources close normally).
- diff_preservation: PASS. `git status` before B (user-owned
  `config/default.json` + two new files + five scratch files) and after B
  (same user-owned change and scratch files untouched; only
  package.json, docs/DEVELOPMENT.md, and the two task files changed).
- handoff_completeness: PASS. B completed all four remaining steps with
  no questions and emitted the HANDOFF UNDERSTOOD block with all fields
  filled, including "Existing diff preserved: YES" and
  "Previous chat required: NO".
- test_reproducibility: PASS. B's own run and the orchestrator re-run both
  produced 188/188 tests passing and `npm run verify` passing.
- resume_time: one OpenCode session; wall time was not separately
  clocked. The session included a full-suite run and two live checker
  runs.
- executor_specific_assumptions: (a) OpenCode needs the relay key injected
  into its process environment at launch (registry to env; it does not
  read the registry itself); (b) OpenCode's non-interactive `run`
  executed file tools directly in the working directory; (c) the
  live checker requires network access; (d) the `newapi` relay reports
  expected FAIL because its dedicated key environment is not configured.

## Round 02 classification

| Category | Verdict |
|---|---|
| Startup failover | PASS — OpenCode started and completed the continuation |
| Working-tree preservation | PASS — user-owned changes and scratch files untouched |
| Task-contract portability | PASS — the standalone handoff carried the task |
| True development handoff | PASS — B resumed a partial diff from a DEVELOPMENT HANDOFF and completed the task |
| Cross-executor continuation | PASS (manual) — Harness → OpenCode continued the same logical task with no chat history |

## Decisions

- The live relay check stays outside the `check` and `verify` chains
  because it performs network requests.
- CLI failures use `process.exitCode` so pending fetch resources close
  normally.
- Key output identifies the source only; key material is never printed.

## Next

- Round 03 (planned): Codex/OpenCode → Harness direction once Codex or
  another executor becomes available, to cover the remaining direction.
- P1 runtime work (native continuation package, re-route semantics) stays
  unimplemented by design.
