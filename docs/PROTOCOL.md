# Control-plane protocol

## Engineering brief

```json
{
  "workspace": "D:\\Projects\\example",
  "objective": "Add a tested GET /hello endpoint.",
  "constraints": [
    "Do not add a framework dependency."
  ],
  "acceptance_criteria": [
    "GET /hello returns HTTP 200",
    "Response JSON equals {\"message\":\"hello\"}",
    "Automated tests pass"
  ],
  "context": [
    "The project already uses node:test."
  ],
  "evidence_required": [
    "test command and result",
    "changed file list"
  ],
  "profile": "balanced",
  "model": null,
  "reasoning_effort": null,
  "max_subagents": null,
  "token_budget": null
}
```

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

## MCP tools

- `dispatch_project` — create an asynchronous engineering task.
- `task_status` — get compact state, result, usage, and optionally recent events.
- `continue_project` — send a follow-up into the same project thread.
- `cancel_task` — interrupt an active turn.
- `list_tasks` — list recent tasks.
- `list_profiles` — inspect available model/budget policies.
- `list_models` — inspect the current Codex model catalog and reasoning options.
- `usage_report` — aggregate measured Codex usage.

## Token budgets

AgentControlPlane reads `tokensUsed` from the Codex thread goal while a task is
running and stores it as the task's measured `total_tokens`. When measured usage
reaches `token_budget`, AgentControlPlane sends `turn/interrupt` and records the
task as `interrupted` with error code `token_budget_exceeded`.

The default polling interval is 1000 milliseconds. Providers can consume
additional tokens between two polls.
