# Dogfooding Round 04 — live OpenCode reroute

Date: 2026-08-21

## Goal

Verify native reroute against a real installed executor while a controlled
source executor returns `quota_exhausted`.

## Command

```text
npm run accept:reroute -- --to opencode \
  --model opencode/mimo-v2.5-free \
  --reason quota_exhausted \
  --timeout-minutes 5
```

The command created an isolated workspace under the system temporary directory
and removed it after verification.

## Result

```text
passed: true
task_id: 3f5eef14-0e83-4265-af27-4397ca724146
logical_task_id: 3f5eef14-0e83-4265-af27-4397ca724146
status: completed
executor_path: acceptance-fault -> opencode
reroute_reason: quota_exhausted
marker_exact: true
```

The target created `acp-reroute-acceptance.txt` with the exact content
`ACP_REROUTE_ACCEPTANCE_OK`. All seven acceptance checks passed.

## Route diagnostics

- OpenCode's configured AsterRoute default reached the provider and received
  `Invalid API key`; the acceptance command then selected an advertised free
  OpenCode model explicitly.
- The direct DeepSeek route reached the capability gate and was blocked with
  `tools_unverified`. This is the expected safe outcome for an engineering
  task that requires filesystem tools.
- `npm run doctor` reported OpenCode and Codex installed, DeepSeek configured,
  and OpenCode as the automatic default during this round.

This evidence record contains route statuses, task identifiers, and verification
results. The command removed its temporary workspace after verification.
