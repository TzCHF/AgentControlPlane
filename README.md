# AgentControlPlane

> Experimental local-first software for single-user evaluation.

AgentControlPlane runs a local MCP server that lets a ChatGPT conversation
dispatch compact engineering tasks to a persistent Codex project thread, then
read back a compact report with measured token usage.

## What it does

- The ChatGPT conversation acts as the control plane: it clarifies requirements,
  plans, decomposes work, and selects a model policy.
- A local Codex thread acts as the execution plane: it edits files, runs
  commands, verifies results, and delegates independent work to subagents.
- Each dispatch carries one compact engineering brief: objective, constraints,
  acceptance criteria, context, and requested evidence.
- Each completion returns one compact engineering report: summary, changed
  files, test evidence, blockers, and measured token usage.

## Quickstart

Prerequisites: Node.js 22 or newer, the Codex CLI, and an OpenAI account for the
ChatGPT connection.

### 1. Run the service

```powershell
git clone https://github.com/TzCHF/AgentControlPlane.git
cd AgentControlPlane
npm.cmd install
npm.cmd test
npm.cmd run doctor
npm.cmd start
```

The service binds to `http://127.0.0.1:4318`. `GET /health` returns service
status.

### 2. Connect ChatGPT

Connect through an OpenAI Secure MCP Tunnel so the server stays on loopback.
Follow [docs/CHATGPT-CONNECTION.md](docs/CHATGPT-CONNECTION.md).

### 3. Dispatch a task

Enable the connection in a ChatGPT conversation and send:

```text
Use the balanced profile. Ask the engineering agent to inspect the workspace,
make no changes, and return the repository title plus test command.
```

ChatGPT sends the brief through `dispatch_project`, and the local Codex thread
runs it.

### 4. Control spend

Each dispatch picks a profile. The control plane measures token usage from the
Codex thread goal and interrupts the turn when the budget is reached.

| Profile | Use | Effort | Subagents | Budget |
|---|---|---|---:|---:|
| economy | Small, well-defined edits | low | 0 | 30k |
| balanced | Normal feature and fix work | high | up to 2 | 90k |
| deep | Architecture and broad refactor | ultra | up to 4 | 220k |

Override the model, effort, subagent count, or budget per task within local
policy. Model names come from the connected executor at runtime.
`usage_report` returns measured totals across tasks.

## Executor and controller adapters

The current release includes a Codex App Server executor and a ChatGPT MCP
controller. Stable adapter contracts live under `src/executors` and
`src/controllers` so later releases can add Claude Code, Gemini CLI, OpenCode,
API controllers, and other MCP controllers while the existing task persistence
and policy enforcement remain in place.

## Benchmark reports

Benchmark input records two runs of the same task:

- direct: the original request goes to the executor;
- controlled: a controller clarifies the request and sends a compact brief to
  the executor.

Generate a report from the included example:

```powershell
npm.cmd run benchmark:report -- benchmark/example-results.json
```

The report separates executor-token savings from total-token savings and
includes completion rates and elapsed time. Published savings claims require
repeated runs of the same task, model, repository revision, and acceptance
criteria.

## MCP tools

- `dispatch_project` — queue a compact engineering brief
- `task_status` — read task state and result
- `continue_project` — queue a follow-up on the same thread
- `cancel_task` — stop an active task
- `list_tasks` — list recent tasks
- `list_profiles` — list execution profiles
- `list_models` — list models Codex advertises
- `usage_report` — read measured token usage

## Safety defaults

- Workspace paths resolve only under configured roots.
- Codex runs with the `workspace-write` sandbox and network access disabled.
- Task dispatch waits for the Codex sandbox to report ready on Windows.
- Token usage is measured from Codex thread goals and enforced with a hard
  budget interrupt, polled once per second by default.
- The HTTP server binds to loopback only; non-loopback binding is refused.
- Optional bearer authentication via `AGENT_CONTROL_TOKEN`.
- Approval prompts receive explicit denials from the control plane.

Do not expose this server directly to the public Internet. Use an authenticated
gateway or a secure private MCP tunnel.

## Project boundary

This project does not convert ChatGPT messages into Codex quota and does not
bypass product limits. Codex engineering work consumes the applicable
engineering or agent usage allowance.

## Docs

- [docs/CHATGPT-CONNECTION.md](docs/CHATGPT-CONNECTION.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/PROTOCOL.md](docs/PROTOCOL.md)
- [docs/BENCHMARKING.md](docs/BENCHMARKING.md)
- [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md)
- [SECURITY.md](SECURITY.md)
- [CHANGELOG.md](CHANGELOG.md)

The default workspace allowlist is the parent directory of this repository.
Override it with a local configuration file referenced by `AGENT_CONTROL_CONFIG`;
do not commit machine-specific paths.
