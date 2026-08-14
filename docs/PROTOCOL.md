# Control-plane protocol

## Engineering brief

```json
{
  "workspace": "D:\\Projects\\example",
  "executor": "auto",
  "objective": "Add a tested GET /hello endpoint.",
  "constraints": ["Do not add a framework dependency."],
  "acceptance_criteria": [
    "GET /hello returns HTTP 200",
    "Response JSON equals {\"message\":\"hello\"}",
    "Automated tests pass"
  ],
  "context": ["The project already uses node:test."],
  "evidence_required": ["test command and result", "changed file list"],
  "profile": "balanced",
  "model": null,
  "reasoning_effort": null,
  "max_subagents": null,
  "token_budget": null
}
```

`executor` may be `auto`, `opencode`, `codex`, `claude`,
`openai-compatible`, or `deepseek`. `auto` resolves to an actual executor before
the task is persisted, so status and audit records always show where work ran.

Persistent project identity is scoped by both workspace and executor. The same
repository can therefore keep an independent Codex thread, OpenCode session,
and Claude Code session without attempting to resume one executor's thread id in
another executor.

## Compact result

```json
{
  "status": "completed",
  "summary": "Implemented and tested the endpoint.",
  "changed_files": ["server.js", "server.test.js"],
  "tests": [{"command": "npm test", "status": "passed"}],
  "blockers": [],
  "next_action": null,
  "usage": {
    "input_tokens": 0,
    "cached_input_tokens": 0,
    "output_tokens": 0,
    "reasoning_output_tokens": 0,
    "total_tokens": 0
  },
  "subagents": []
}
```

The web controller should poll until terminal status. When the result is
`blocked`, `partial`, or `failed`, it should choose one of two explicit follow-up
semantics:

- `continue_project` keeps the same executor and persistent executor thread. Use
  it when the same engineering agent should correct or extend its own work.
- `handoff_project` creates a new task for another selected executor. It carries
  only compact source evidence (source executor/status, summary, changed files,
  verification results, blockers, and error summary) plus the new objective. It
  does not replay the web conversation or copy the source executor's thread.

This distinction lets a web AI run flows such as Codex implementation → OpenCode
verification → Claude Code review while keeping each engineering runtime's
project identity isolated.

## MCP tools

- `dispatch_project` — create an asynchronous task with auto or explicit route.
- `dispatch_opencode` — backwards-compatible OpenCode shortcut.
- `task_status` — read compact state, result, usage, and optional recent events.
- `continue_project` — send a correction or follow-up to the same executor thread.
- `handoff_project` — send compact source evidence to a selected different executor.
- `cancel_task` — interrupt queued or active work.
- `list_tasks` — list recent tasks.
- `list_executors` — inspect discovery, capabilities, and current default.
- `list_profiles` — inspect model/budget policies.
- `list_models` — inspect the cached catalog for one executor.
- `usage_report` — aggregate measured engineering usage.

## Token budgets

Usage measurement and interruption precision depend on executor telemetry.
Codex exposes a live thread goal and can be polled while running. CLI adapters
may report cumulative usage only in their final event, so their budget is also
sent as policy guidance but cannot always be enforced at the same granularity.
Providers can consume additional tokens between measurements.
