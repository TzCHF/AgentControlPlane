# DEVELOPMENT HANDOFF — Harness → Codex (2026-08-20)

This handoff lets a new executor (Codex) resume AgentControlPlane
development from the repository alone. Allowed sources: the repository,
AGENTS.md, docs/DEVELOPMENT.md, this handoff, and the current working
tree. No chat history is available or required.

## Task

Implement P1 — native cross-executor continuation — per
`docs/P1-CROSS-EXECUTOR-CONTINUATION-DESIGN.md` (design only, committed at
`b4f3b42`). The design is approved; runtime implementation is the
remaining work. Follow the five slices in the design document and keep
each slice independently shippable with reroute disabled by default
(`executor.reroute.enabled=false`).

## Status

design complete, implementation pending

## Changed files (recent work, committed)

- docs/P1-CROSS-EXECUTOR-CONTINUATION-DESIGN.md (design, 12 sections)
- scripts/check-relay.js + tests/check-relay.test.js (relay connectivity
  checker; effective-relay preset fix at 684ff12)
- scripts/check-docs-links.js + tests (round 1)
- docs/DEVELOPMENT.md, AGENTS.md (executor-neutral workflow, handoff
  contract, working-tree safety), docs/DOGFOODING-ROUND-01.md,
  docs/DOGFOODING-ROUND-02.md (round evidence)

## What was implemented

- Executor-neutral development infrastructure: `npm run verify`
  (`npm test && npm run check`), DEVELOPMENT HANDOFF contract, AGENTS.md
  hard rules (working-tree safety, logical task continuity, durable
  decisions).
- Round 01 (startup failover, Codex/OpenCode unavailable, Harness
  completed) and Round 02 (true development handoff PASS: Harness ~60% →
  OpenCode resumed from handoff + diff, 190/190 tests, verify PASS).
- AsterRoute relay restored with a new key: registry
  `ASTERROUTE_API_KEY` (fingerprint `258461f2f1452dfa`), 13 canonical
  models, ACP server healthy on 127.0.0.1:4318, OpenCode configured in
  `~/.config/opencode/opencode.json` (env-only key reference).

## What remains

- P1 slices 1–5 per the design doc (schema/store, failure classification,
  capability gate, reroute execution, exposure + docs).
- Round 03 (regression backlog): Codex/OpenCode → Harness handoff
  direction, only after P1.
- Relay-side backlog (operator): legal subpages, per-customer
  provisioning, key-violation monitoring.

## Tests run

- node --test: 190/190 pass
- npm run verify: PASS
- copy_lint.py (docs/scripts): PASS

## Build

PASS

## Known issues

- Codex CLI's local provider path (opencodex at 127.0.0.1:10100) rejected
  the responses websocket (426) and both opencodex upstream keys returned
  401 during round 1; the user is restoring Codex's quota/credentials
  separately.
- The `newapi` relay entry in config/local.json points at an internal
  domain and has no configured key env; it reports expected FAIL in
  `npm run check:relay`.
- config/default.json has a user-owned uncommitted change; scratch .mjs
  files are untracked and user-owned.

## Decisions made

- Reroute reasons limited to: quota_exhausted, rate_limited,
  executor_unavailable, authentication_unavailable, provider_unavailable.
  Test/build/implementation/validation failures never auto-switch.
- New task fields are optional; read-time defaults backfill old records;
  no DB migration; wire contracts untouched.
- Default-off reroute policy until an explicit release opts in.

## Do not change

- config/default.json (user-owned uncommitted change)
- config/local.json (user-owned; relay + newapi entries)
- Untracked .mjs scratch files
- README.md, AGENTS.md, CHANGELOG.md, docs/ROADMAP.md (unless the task
  explicitly requires a docs update, then update per DEVELOPMENT.md)
- Key material: never print or write API keys; refer to
  ASTERROUTE_API_KEY by name only

## Recommended next action

- Slice 1 (schema + store) with tests; then slices 2–5 in order; run
  `npm run verify` after each slice; do not enable reroute by default.

## Git

branch: main
commit: b4f3b42 (HEAD)
working tree: M config/default.json (user-owned, untouched);
?? 5 scratch .mjs (untouched)

## Blockers

- Codex availability (quota/credentials being restored by the user).
- P1 implementation must wait for the user's go-ahead to start runtime
  work; the design is approved but implementation was not yet ordered.
