# Dogfooding round 1 — executor handoff test (2026-08-19)

Task: add a repository docs link checker (`scripts/check-docs-links.js`
with tests and a `check` wiring). This is a manual handoff test of the
Phase 1 development infrastructure; it does not implement automatic
re-routing.

## Executor sequence

| # | Executor | Result | Failure mode |
|---|---|---|---|
| A | Codex | unavailable | local provider `ws://127.0.0.1:10100/v1/responses` returns HTTP 426 Upgrade Required |
| B | OpenCode | unavailable | insufficient balance on the configured model (gpt-5.6-luna) |
| B2 | Harness | completed | — |

Executor A produced no changes and no handoff. Executor B produced no
changes and no handoff. B2 (Harness) implemented the task from the same
task contract, ran the full suite and the `npm run verify` gate, and
committed the result. The user-owned uncommitted `config/default.json`
change and the untracked scratch `.mjs` files stayed untouched through
the round.

## Metrics

- context lost: A and B produced no context; the task contract carried the
  full requirements, so B2 needed no chat history.
- duplicate work: none; B2 ran `git status` and `git diff` first and
  confirmed no task work existed.
- diff preservation: `git status`/`git diff` before, between, and after
  the executor attempts showed the same pre-existing tree (one user-owned
  file change, five untracked scratch files).
- handoff completeness: A and B failed before producing handoffs; the
  fallback consumed the task contract directly, which was complete enough
  for B2 to finish.
- test reproducibility: `npm test` 181/181 pass; `npm run verify` pass on
  the B2 result; the checker passes against the real repository.
- resume time: B2 resumed from the task contract; no chat-history replay
  was needed. Wall time was one session and was not separately measured.
- executor-specific assumptions encountered:
  - Codex CLI is configured (via opencodex) to a local OpenAI-compatible
    endpoint whose `/v1/responses` rejects the websocket upgrade Codex
    requires (HTTP 426).
  - OpenCode's hosted provider workspace had exhausted its balance at
    round time; the CLI reported it at startup.

## Decisions

- The checker validates repository-relative links only. Absolute
  filesystem targets (for example `/C:/Users/YOUR_USER/...` placeholders
  in the v0.4.0 delivery and release records) and generated benchmark
  artifacts are ignored.
- The `check` npm script now runs the link checker between the syntax
  check and the browser-companion check.
- `config/default.json` (user-owned) stays untouched and uncommitted.

## Round 01 classification (post-review)

| Category | Verdict |
|---|---|
| Startup failover | PASS — A (Codex) and B (OpenCode) failed before producing work; B2 (Harness) completed the task |
| Working-tree preservation | PASS — the user-owned `config/default.json` change and the untracked scratch files stayed untouched through every executor attempt |
| Task-contract portability | PASS — B2 completed the task from the standalone task contract with no chat history |
| True development handoff | NOT YET TESTED — A and B produced no partial diff and no handoff; B2 started from clean task state |
| Cross-executor continuation | NOT YET TESTED — no executor resumed a partial diff produced by another executor |

Round 01 did not exercise "existing partial diff + DEVELOPMENT HANDOFF → a second
executor resumes the same task". That scenario is the target of Round 02.

## Next

Round 02 (planned): Executor A = Harness implements 40–60% of a real,
low-risk task and leaves an uncommitted diff plus a DEVELOPMENT HANDOFF;
Executor B = OpenCode resumes from the handoff, the repository, and the
working tree only, without reading the Harness chat history.
