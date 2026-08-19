# AgentControlPlane repository instructions

- Keep this repository independent from CWapi and do not copy CWapi source code.
- Default to local-only networking and workspace-scoped writes.
- Do not add API-key-based model calls. Codex authentication is owned by the installed Codex client.
- Preserve compact structured task results and token-usage accounting.
- Treat MCP as the control-plane boundary; Codex app-server is the execution-plane boundary.
- Tests must not consume model quota unless explicitly marked as live tests.
- Relay stations (for example AsterRoute) are separate projects. ACP interacts
  with them only as an API client using the keys in `config/local.json`; never
  modify relay-side code, deployment, routes, or admin settings.
- API keys are never written to logs, reports, or commits. Key material is
  referenced by SHA-256 fingerprint prefix only; `scripts/key-fingerprint.js`
  prints that identity without the key. Key rotation happens on the provider
  side; ACP consumes the new key from the environment or local config.
- ACP is provider-agnostic: it must not become a client of one provider, and
  no provider may become a hard dependency. Core orchestration, executors, and
  the capability layer speak standard OpenAI-compatible wire shapes only.
  Provider-specific presets are data entries in a registry; they carry no
  code branches. Provider-specific endpoints or fields are optional metadata.
  Removing any single provider's config must leave ACP fully functional.

## Development workflow (executor-neutral)

- Development is executor-neutral: any supported executor (Codex, Claude
  Code, OpenCode, an OpenAI-compatible model endpoint, or a future
  executor) can develop this repository. Do not make one executor the
  implicit permanent development dependency.
- At the end of every development round, output the DEVELOPMENT HANDOFF
  block defined in `docs/DEVELOPMENT.md`.
- Preserve logical task continuity. Until native cross-executor
  continuation exists: preserve original task references, parentTaskId and
  continuation relationships where applicable, evidence/attempts/decisions
  and working-tree state; record the executor handoff; do not treat an
  executor switch as an unrelated fresh development task.
- Working-tree safety: run `git reset --hard`, `git checkout .`, or
  `git clean -fd` only with explicit user authorization. Before taking
  over existing work, run `git status` and `git diff`. Do not modify or
  remove uncommitted changes that belong to the user or to another
  executor (for example an uncommitted `config/default.json` change).
- The single pre-handoff verification gate is `npm run verify`
  (`npm test && npm run check`), which mirrors CI. The grounded-copy lint
  (`copy_lint.py`) is an operator/docs gate, separate from `verify`.
- Decisions that affect later development (protocol contract, security
  invariant, storage schema, executor interface, backward compatibility,
  provider-neutral requirement, API contract, safety rule) must live in
  code, tests, docs, or architecture/roadmap documents — a chat log is
  not a durable location.

