# Architecture

## Product boundary

AgentControlPlane separates reasoning into two layers:

1. **Control plane** — the ChatGPT conversation clarifies intent, compares
   approaches, selects a policy, dispatches work, and accepts results.
2. **Execution plane** — a Codex project agent edits code, runs tools, verifies
   results, and optionally delegates independent work to subagents.

This separation is a usage-efficiency strategy. Codex work still consumes the
applicable engineering/agent usage allowance.

## Data flow

```text
User
  -> ChatGPT: broad request and discussion
  -> dispatch_project: compact EngineeringBrief
  -> TaskStore: queued task
  -> Orchestrator: workspace and policy validation
  -> Codex app-server: thread/start or thread/resume
  -> Codex app-server: thread/goal/set with token budget
  -> Codex app-server: turn/start
  -> Codex main agent and optional subagents
  -> app-server notifications: messages, subagents, diff, token usage
  -> TaskStore + append-only audit log
  -> task_status: compact result and evidence
  -> ChatGPT: acceptance or follow-up
```

## Token-efficiency mechanisms

- `EngineeringBrief` excludes conversational filler and includes only the
  objective, constraints, acceptance criteria, known context, and requested
  evidence.
- One persistent Codex thread is associated with each project workspace.
- Profiles choose reasoning effort and subagent concurrency.
- App-server token notifications are stored as measured usage.
- Final output is constrained to a compact JSON-shaped engineering report.
- Raw events remain local and are returned only when explicitly requested.

## Profiles

| Profile | Use | Effort | Subagents | Default budget |
|---|---|---:|---:|---:|
| economy | Small, well-defined edits | low | 0 | 30k |
| balanced | Normal feature/fix work | high | up to 2 | 90k |
| deep | Architecture, broad refactor, difficult debugging | ultra | up to 4 | 220k |

The main conversation may override model, effort, subagent count, or token budget
within local policy. A main engineering agent may choose how to divide work, but
must remain within the supplied concurrency and budget instructions.

## Persistence

`.agent-control/state.json` stores tasks and project-to-thread associations.
`.agent-control/audit.jsonl` stores append-only events. State writes use a
temporary file followed by an atomic rename.
