# Changelog

## v0.2.0 — 2026-08-13

Security hardening and the multi-executor foundation.

### Added

- A generic `ExecutorAdapter` contract (`src/executors/`) with a `CodexExecutor`
  implementation, so the control plane can target other coding agents without
  changing the MCP surface.
- Benchmark reporting that compares `direct` versus `controlled` execution and
  reports token, elapsed-time, and success metrics (`src/benchmark/`,
  `docs/BENCHMARKING.md`).
- Per-request rate limiting with `Retry-After` signalling.
- An append-only audit hash chain for tamper-evident logs.
- Security response headers on the HTTP surface.
- A GitHub Actions CI workflow that runs the test suite on every push and pull
  request.

### Changed

- `main` is protected: required status checks, linear history, and no force
  pushes.

## v0.1.0 — 2026-08-13

Initial public release.

### Included

- An MCP server with eight tools: `dispatch_project`, `task_status`,
  `continue_project`, `cancel_task`, `list_tasks`, `list_profiles`,
  `list_models`, `usage_report`.
- Three execution profiles: `economy`, `balanced`, `deep`.
- A persistent Codex project thread per workspace.
- Append-only audit logging and atomic state persistence.
- Loopback-only HTTP binding with optional bearer authentication.
- Workspace allowlist enforcement and `workspace-write` sandbox defaults.
- Stateless `server/discover` support for OpenAI Secure MCP Tunnel connections.
- Measured token usage from Codex thread goals, with a hard budget interrupt.

### Changes since the first commit

- `224c1a6` — support `server/discover` for ChatGPT connectors.
- `2aa4d5d` — measure token usage and enforce the hard budget interrupt.

### Known limitations

- Single-user local scope; not approved for multi-tenant or public-Internet
  exposure.
- Token enforcement polls once per second, so a provider can consume tokens
  during one polling interval after the budget is reached.
- Platform tunnel creation, permission grants, and runtime-key provisioning are
  account-level steps that this repository does not automate.
