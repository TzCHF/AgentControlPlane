# Security review

> [中文文档](SECURITY-REVIEW.zh-CN.md)

Review date: 2026-08-13

Scope: current first-party source, configuration, tests, scripts, and project
documentation. Dependencies were inspected at the integration boundary, but
this was not an online vulnerability-advisory scan.

## Supported security boundary

This release is approved only for a local, single-user deployment:

- the HTTP server is loopback-only;
- remote ChatGPT access uses Secure MCP Tunnel or a separate TLS gateway;
- every engineering workspace must be under an allowlisted root;
- control-plane state and the Codex executable must remain outside workspace
  roots;
- Codex runs with workspace-write, network disabled by default, a scrubbed
  environment, and denied escalation requests;
- one project workspace has at most one active Codex turn;
- cancellation, runtime, queue, token-budget, task-retention, audit-size, MCP
  session, body-size, and event-retention limits are enforced.

## Fixed findings

The review found and the implementation fixed:

- queued tasks starting after cancellation;
- late completion overwriting cancelled state;
- timed-out tasks continuing without an interrupt request;
- concurrent tasks sharing one project thread and receiving each other's events;
- unlimited queue, token budget, stored tasks, audit log, and MCP sessions;
- state and audit files being reachable from an allowed engineering workspace;
- workspace path replacement between admission and execution;
- PATH-based Codex executable fallback;
- plaintext non-loopback bearer-token deployment;
- detailed local runtime information in the public health response;
- inaccurate destructive/open-world MCP tool annotations;
- missing cancellation and runtime-interruption audit records.

## Accepted limitations

The following are not treated as vulnerabilities inside the supported
single-user boundary, but block untrusted or multi-tenant commercialization:

- `workspace-write` restricts writes but is not a general confidential-read
  sandbox. A user authorized to dispatch Codex must already be trusted with the
  local account's readable data.
- The local bearer token is one shared operator secret and carries no per-user
  identity or authorization. Public deployment requires MCP-compatible OAuth 2.1
  and per-user policy.
- State persistence is a bounded local JSON store. Commercial scale should use
  transactional storage, tenant isolation, per-principal quotas, distributed
  rate limiting, encrypted secret management, and signed audit export.
- The review was internal. A public or paid release needs an independent
  external assessment and dependency advisory scan.

## Verification

The release was verified with:

```text
npm.cmd test
npm.cmd run check
npm.cmd run doctor
npm.cmd run smoke
```

The smoke test starts the real Codex app-server, initializes all MCP tools,
executes a read-only project task, continues the same project, and verifies that
the Codex thread is reused.
