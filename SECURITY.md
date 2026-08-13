# Security policy

## Supported scope

The current version is a local, single-user development service. It is not yet
approved for direct public-Internet exposure or untrusted multi-tenant use.

## Security invariants

- The server binds to loopback by default.
- Every project workspace is resolved and checked against an allowlisted root.
- Codex receives only the selected workspace as its writable runtime root.
- The default sandbox is `workspace-write`.
- Network access is disabled unless the local owner changes configuration.
- The control plane never stores or asks for an OpenAI API key.
- Approval requests that cannot be safely handled are denied.
- Task mutations and execution events are written to an append-only audit log.

## Before commercial deployment

Add authenticated MCP access, per-user workspace roots, encrypted secret storage,
rate limiting, tenant-isolated state, signed audit export, CSRF/SSRF protections,
and an independent security review.

## Reporting

For now, report vulnerabilities privately to the repository owner. Do not open a
public issue containing exploit details or credentials.

