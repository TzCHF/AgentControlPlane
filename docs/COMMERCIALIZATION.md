# Commercialization roadmap

> [中文文档](COMMERCIALIZATION.zh-CN.md)

## Recommended product split

Use an open local agent plus a hosted relay:

```text
MCP-capable web AI
        |
        v
hosted relay (identity, device routing, policy, billing)
        |
        v  outbound authenticated connection
local AgentControlPlane (workspace, executors, state, audit)
```

The local component should retain source code, filesystem access, executor
credentials, command output, and detailed events by default. The hosted relay
should carry only compact encrypted task envelopes and status.

This removes public-IP, port-forwarding, and per-provider tunnel setup for end
users. A user installs the desktop/local service, signs in, pairs one device,
and receives one stable MCP endpoint for supported web AI products.

## Hosted relay responsibilities

- account and organization identity;
- device registration, short-lived credentials, rotation, and revocation;
- outbound WebSocket or HTTP/2 connection from the local agent;
- tenant-isolated task routing and replay protection;
- MCP-facing OAuth and provider-specific connector metadata;
- plan entitlements, rate limits, health, and update channels;
- privacy-preserving operational telemetry and audit exports.

The relay must not expose the current loopback server directly. Local execution
must require a device-bound signed request, workspace policy validation, and a
fresh nonce/expiry before a task enters the queue.

## Required before a paid hosted beta

1. Threat model for relay, desktop agent, pairing, updates, and executor secrets.
2. MCP-compatible OAuth plus device authorization and revocation.
3. Per-tenant encrypted persistence and strict authorization tests.
4. Signed desktop installer, reproducible builds, and verified automatic update.
5. End-to-end request authentication, replay protection, and bounded queues.
6. Privacy controls for task metadata, retention, export, and deletion.
7. Compatibility matrix for each web controller and engineering executor.
8. Usage dashboards, billing entitlements, support, terms, and privacy policy.
9. Dependency-license review and an independent application security assessment.

## Licensing model

The local AgentControlPlane repository is open source under Apache-2.0, with
attribution in `NOTICE`. This favors adoption, integrations, and external
contributions and includes Apache's express patent grant.

The hosted relay should live in a separate repository and legal distribution
boundary. Relay operations, managed identity, billing, enterprise policy,
branding, support, and hosted infrastructure are not automatically licensed by
this repository merely because they interoperate with its public protocol.

Apache-2.0 permits third parties to run competing hosted services. Commercial
differentiation therefore comes from the managed network, trusted distribution,
support, compatibility certification, enterprise controls, and operational
reliability.

## Claims and economics

Do not market the product as bypassing quotas. Its measurable value is lower
handoff time, fewer duplicated prompts, fewer executor misunderstandings,
persistent evidence, and the ability to route each job to the most suitable
already-authorized executor. Publish token-savings claims only from repeated,
revision-pinned direct-versus-controlled benchmark runs.
