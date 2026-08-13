# AgentControlPlane

AgentControlPlane lets a ChatGPT conversation act as the control-plane agent while
Codex acts as the engineering execution plane.

The main conversation performs requirement clarification, planning, task
decomposition, model-policy selection, and acceptance. It sends only a compact
engineering brief to a persistent Codex project thread. Codex may delegate
independent work to subagents according to the selected profile.

## Why

The project does **not** convert ChatGPT messages into Codex quota and does not
bypass product limits. It reduces waste inside engineering runs by:

- sending a compact brief instead of the full planning conversation;
- reusing a project thread instead of recreating repository context;
- selecting model, reasoning effort, budget, and subagent concurrency per task;
- returning summaries, diffs, test evidence, blockers, and measured token usage;
- keeping long command logs out of the main conversation unless requested.

## Architecture

```text
ChatGPT conversation
  -> MCP dispatch/status/follow-up tools
  -> local AgentControlPlane
  -> Codex app-server
  -> persistent project main agent
  -> optional Codex subagents
  -> compact result + token usage
  -> ChatGPT acceptance/next decision
```

## Local development

```powershell
npm.cmd install
npm.cmd test
npm.cmd run sandbox:setup
npm.cmd run doctor
npm.cmd run smoke
npm.cmd start
```

The service binds to `127.0.0.1:4318` by default.

Endpoints:

- `GET /health`
- `GET /v1/diagnostics` (authenticated when a token is configured)
- `GET /v1/profiles`
- `GET /v1/models`
- `GET /v1/tasks`
- `POST /v1/tasks`
- `GET /v1/tasks/{taskId}`
- `POST /v1/tasks/{taskId}/follow-up`
- `POST /v1/tasks/{taskId}/cancel`
- `POST /mcp`

State and audit records are stored outside configured workspace roots (under the
user's local application-state directory by default) so engineering tasks cannot
modify control-plane persistence.

## Safety defaults

- Workspace paths must stay under configured roots.
- Codex runs in `workspace-write`.
- Network access is disabled by default.
- On Windows, task dispatch is refused until the Codex sandbox reports `ready`.
- On Windows, the launcher automatically prefers the newest standalone Codex
  binary that has its matching sandbox resources, avoiding PATH shims that lose
  resource-directory resolution.
- Approval prompts are denied rather than silently elevated.
- The HTTP server listens on loopback only.
- Optional bearer authentication is enabled with `AGENT_CONTROL_TOKEN`.
- Direct non-loopback binding is refused; remote access must use a secure tunnel
  or a TLS authentication gateway.
- MCP sessions have configurable count and idle-time limits.
- Do not expose this development server directly to the public Internet. Use an
  authenticated gateway or a secure private MCP tunnel.

See [docs/CHATGPT-CONNECTION.md](docs/CHATGPT-CONNECTION.md),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/PROTOCOL.md](docs/PROTOCOL.md),
[docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md), and
[SECURITY.md](SECURITY.md).

The default workspace allowlist is the parent directory of this repository.
Override it with a local configuration file referenced by
`AGENT_CONTROL_CONFIG`; do not commit machine-specific paths.
