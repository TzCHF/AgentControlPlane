# Control-plane protocol

> [中文文档](PROTOCOL.zh-CN.md)

## Engineering brief

```json
{
  "workspace": "D:\\Projects\\example",
  "idempotency_key": "web:conversation-123:task-4",
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

`idempotency_key` is optional and accepts 8–200 letters, digits, dots,
underscores, colons, or hyphens. A replay carrying the same key and normalized
dispatch content returns the original task. Reusing the key with different
content returns `idempotency_conflict`. The browser companion generates this
key from the page URL and normalized request.

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
`blocked`, `partial`, or `failed`, it should use the structured blocker and
evidence to correct the brief or explain why user input is required. This is the
automatic feedback loop that replaces copying output between two conversations.

## MCP tools

- `dispatch_project` — create an asynchronous task with auto or explicit route.
- `dispatch_opencode` — backwards-compatible OpenCode shortcut.
- `task_status` — read compact state, result, usage, executor history, latest
  continuation package, reroute reason, and optional recent events.
- `continue_project` — send a correction or follow-up to the same project.
  Optional `executor` starts a capability-gated continuation on that executor;
  omitting it preserves the existing executor and persistent session.
- `cancel_task` — interrupt queued or active work.
- `list_tasks` — list recent tasks.
- `list_executors` — inspect discovery, capabilities, and current default.
- `list_profiles` — inspect model/budget policies.
- `list_models` — inspect the cached catalog for one executor.
- `usage_report` — aggregate measured engineering usage.

## Cross-executor continuation

Every task exposes a stable `logical_task_id`. Child continuations preserve that
id and keep `parentTaskId` as the direct edge. `executor_history` is append-only
and records each acquired executor session. When an allowed infrastructure
failure occurs, ACP stores a compact `continuation` package and may select the
next compatible executor.

Automatic reroute is disabled by default. It is enabled only through
`executor.reroute.enabled=true`, bounded by `max_reroutes`, and limited to
`quota_exhausted`, `rate_limited`, `executor_unavailable`,
`authentication_unavailable`, and `provider_unavailable`. Test, build,
implementation, and validation failures stay on the current executor. If no
compatible executor exists, the task becomes `blocked`; it never silently runs
on an incompatible backend.

At startup, ACP examines persisted `queued` and `running` tasks. Queued
continuations retain their follow-up prompt. A recovered terminal turn updates
its executor history; an approved infrastructure failure can enter the same
capability-gated reroute path.

## Token budgets

Usage measurement and interruption precision depend on executor telemetry.
Codex exposes a live thread goal and can be polled while running. CLI adapters
may report cumulative usage only in their final event, so their budget is also
sent as policy guidance but cannot always be enforced at the same granularity.
Providers can consume additional tokens between measurements.
