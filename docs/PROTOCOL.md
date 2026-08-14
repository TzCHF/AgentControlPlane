# Control-plane protocol

> [中文文档](PROTOCOL.zh-CN.md)

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
- `task_status` — read compact state, result, usage, and optional recent events.
- `continue_project` — send a correction or follow-up to the same project.
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
