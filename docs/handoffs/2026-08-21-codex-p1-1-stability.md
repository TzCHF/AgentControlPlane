# DEVELOPMENT HANDOFF — Codex P1.1 stability (2026-08-21)

Task:
Implement the first production-hardening round for native cross-executor
continuation: restart recovery, isolated real-executor acceptance, dispatch
idempotency, and task-lineage observability.

Status:
completed

Changed files:
- `src/core/orchestrator.js`
- `src/core/store.js`
- `src/core/reroute-acceptance.js`
- `src/dashboard.js`
- `src/companion/router.js`
- `src/mcp/server.js`
- `browser-companion/src/content.js`
- `browser-companion/src/protocol.js`
- `scripts/accept-reroute.js`
- `package.json`
- Related tests, protocol documents, roadmap, changelog, and dogfooding record

What was implemented:
- Startup recovery preserves queued continuation semantics and sends recovered
  infrastructure failures through the bounded capability-gated reroute path.
- Recovered terminal turns close the current executor-history entry with turn,
  attempt, usage, reason, and completion evidence.
- `npm run accept:reroute` creates isolated temporary state, injects one approved
  infrastructure failure, routes to a selected real executor, and verifies seven
  task, lineage, route, and marker assertions.
- The acceptance command supports `--model` for executor-specific model
  selection and removes its temporary directory after verification.
- Dispatch accepts a persistent `idempotency_key`. Identical normalized replays
  return the original task; content conflicts return `idempotency_conflict`.
- The browser companion derives its idempotency key from the page URL and
  normalized request, and returns task lineage and reroute data to the web AI.
- The local dashboard displays the logical task id, executor path, and reroute
  reason.

What remains:
- Replace or renew the operator-owned credential used by OpenCode's configured
  AsterRoute default route.
- Certify a direct model-endpoint executor after its catalog or protocol probe
  advertises verified filesystem tool support.
- Run the same acceptance command against Codex when its engineering quota is
  available.

Tests run:
- `npm run verify`: PASS, 205/205 tests
- `node --test tests/recovery.test.js tests/reroute-orchestrator.test.js`: PASS,
  7/7 tests
- `node --test tests/reroute-acceptance.test.js`: PASS, 2/2 tests
- Live `acceptance-fault -> opencode` acceptance: PASS, 7/7 checks
- `copy_lint.py` across changed copy: PASS, 0 findings
- `git diff --check`: PASS

Build:
PASS

Known issues:
- The configured OpenCode AsterRoute default currently returns `Invalid API
  key`; `opencode/mimo-v2.5-free` completed the certified route.
- The direct DeepSeek executor currently reports `tools_unverified`, so the
  capability gate blocks filesystem engineering work on that route.
- Claude Code is installed and currently reports `not_authenticated`.
- Automatic production reroute remains disabled by default. The acceptance
  command enables it only in its isolated in-memory configuration.
- `config/default.json` and five scratch `.mjs` files remain user-owned working
  tree changes.

Decisions made:
- Restart recovery uses the same failure classifier, capability gate, reroute
  cap, and logical task id as live execution.
- Dispatch idempotency compares a SHA-256 fingerprint of the normalized request.
- Idempotency conflicts fail closed and include the existing task id.
- Real acceptance uses a synthetic source failure and a real target executor,
  giving deterministic failure coverage while consuming one minimal target run.
- Capability uncertainty blocks engineering routes that require verified tools.

Do not change:
- User-owned `config/default.json` and `config/local.json`
- User-owned untracked `.mjs` scratch files
- API keys, relay keys, credentials, and other key material

Recommended next action:
- Repair the OpenCode default credential, then run
  `npm run accept:reroute -- --to opencode --reason rate_limited` with the
  configured production model.

Git:
branch: main
commit: 26bfa04 (P1.1 implementation and live evidence; this handoff follows)
working tree: user-owned `config/default.json` modification and five untracked
`.mjs` scratch files

Blockers:
- none for P1.1 completion
