# Changelog

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
