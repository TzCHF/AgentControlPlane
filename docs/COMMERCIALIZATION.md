# Commercialization roadmap

The repository is proprietary and independent from CWapi. No CWapi source code is
required by the runtime.

## Current target

Local, single-user proof of architecture:

- ChatGPT-compatible MCP control surface;
- persistent Codex engineering threads;
- model and reasoning policy;
- subagent policy;
- measured usage accounting;
- workspace sandboxing and audit logs.

## Required before selling

1. OAuth 2.1 for remote MCP access.
2. Per-tenant encrypted database and workspace isolation.
3. Signed desktop installer and automatic updates.
4. Policy administration, usage dashboards, and billing entitlements.
5. Recovery for interrupted app-server sessions.
6. Compatibility testing across supported Codex versions.
7. Privacy policy, terms, support process, and dependency-license review.
8. Independent application security assessment.

## Provider strategy

Keep the control plane provider-neutral. The current adapter uses Codex
app-server because it supplies persistent threads, sandboxing, tools, subagents,
and token telemetry. Future adapters can target local models or other coding
agents without changing the MCP contract.

