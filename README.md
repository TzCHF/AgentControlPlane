# AgentControlPlane

> Experimental, local-first software for single-user evaluation.

AgentControlPlane connects an MCP-capable web AI to interchangeable engineering
agents on the user's computer. The web conversation clarifies intent once; the
control plane sends a compact structured brief, preserves task state, returns
evidence, and supports follow-up without manual copy-and-paste loops.

The local AgentControlPlane core is open source under the
[Apache License 2.0](LICENSE). A separately operated hosted relay, managed
service, branding, and enterprise operations may be distributed independently.

## Why it exists

Manual hand-off between a web AI and a coding agent repeats context and creates
translation errors. AgentControlPlane keeps that feedback loop machine-readable:

```text
web AI -> compact brief -> AgentControlPlane -> local executor
web AI <- result/evidence/status <- task store <- local executor
```

It does not convert chat allowance into engineering quota or bypass provider
limits. Each selected executor still uses its own account, subscription, or API
configuration.

## Supported surfaces

The northbound interface is standard MCP and is not tied to one model. ChatGPT
custom apps are the currently documented connection; other MCP-capable web AI
clients can use the same tools.

The local executor layer currently includes:

- OpenCode CLI
- Codex App Server
- Claude Code CLI
- OpenAI-compatible local endpoints, including OpenCodex
- DeepSeek through the OpenAI-compatible adapter

At startup, `executor.provider: "auto"` discovers installed/configured backends
and selects the first available entry from `executor.routing.order`. A task may
override that decision with `executor: "opencode"`, `"codex"`, `"claude"`,
`"openai-compatible"`, or `"deepseek"`.

## Quickstart

Prerequisites: Node.js 22 or newer and at least one supported local executor.

```powershell
git clone https://github.com/Ya-KARAS/AgentControlPlane.git
cd AgentControlPlane
npm.cmd install
npm.cmd test
npm.cmd run doctor
npm.cmd start
```

The service binds to `http://127.0.0.1:4318`. `npm.cmd run doctor` lists every
discovered executor and the automatic default. No executor selection is needed
when an installed CLI or configured local endpoint is detected.

To connect ChatGPT, follow
[docs/CHATGPT-CONNECTION.md](docs/CHATGPT-CONNECTION.md). A web provider may
still require a one-time connector, permission, or tunnel setup; that account
level setup cannot be performed by the local service.

## Dispatch example

Ask the connected web AI:

```text
Use the balanced profile and automatic executor selection. Inspect the project,
implement a tested GET /hello endpoint, verify it, and return changed files plus
test evidence. If execution reports a blocker or misunderstanding, correct the
brief and continue the same project.
```

The conversation calls `dispatch_project`, polls `task_status`, and uses
`continue_project` when the structured result requires correction.

## Profiles and usage

| Profile | Use | Effort | Subagents | Budget |
|---|---|---|---:|---:|
| economy | Small, well-defined edits | low | 0 | 30k |
| balanced | Normal feature and fix work | high | up to 2 | 90k |
| deep | Architecture and broad refactors | ultra | up to 4 | 220k |

Profiles are policy defaults. Explicit model, effort, subagent, and budget
overrides remain available. Model fields are passed only when meaningful for
the selected executor; OpenCode and Claude otherwise use their own configured
default model. Usage precision depends on the executor's telemetry.

For controlled-versus-direct token experiments, see
[docs/BENCHMARKING.md](docs/BENCHMARKING.md).

## MCP tools

- `dispatch_project` — queue a brief with automatic or explicit executor routing
- `dispatch_opencode` — compatibility shortcut for OpenCode
- `task_status` — read state, result, evidence, usage, and optional events
- `continue_project` — send a correction or follow-up to the same project
- `cancel_task` — stop queued or active work
- `list_tasks` — list recent tasks
- `list_executors` — list discovery, readiness, capabilities, and default route
- `list_profiles` — list execution policies
- `list_models` — list the cached catalog for an executor
- `usage_report` — aggregate measured engineering usage

## Safety defaults

- Workspaces must be inside configured allowlisted roots.
- The HTTP service refuses non-loopback binding.
- Codex uses workspace-write with network disabled and verifies Windows sandbox
  readiness before execution.
- Other CLI and OpenAI-compatible adapters run with the local user's privileges;
  use them only on trusted workspaces.
- Optional bearer authentication is available through `AGENT_CONTROL_TOKEN`.
- State and append-only audit logs remain outside project workspaces.

Do not expose the local server directly to the public Internet. Use an
authenticated private tunnel or a separately hardened relay.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/PROTOCOL.md](docs/PROTOCOL.md)
- [docs/CHATGPT-CONNECTION.md](docs/CHATGPT-CONNECTION.md)
- [docs/BENCHMARKING.md](docs/BENCHMARKING.md)
- [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md)
- [docs/COMMERCIALIZATION.md](docs/COMMERCIALIZATION.md)
- [SECURITY.md](SECURITY.md)
- [CHANGELOG.md](CHANGELOG.md)

The default workspace allowlist is the parent directory of this repository.
Use `AGENT_CONTROL_CONFIG` for machine-specific overrides and never commit local
paths or credentials.
