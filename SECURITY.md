# Security policy

## Supported scope

The current version is a local, single-user development service. Direct
public-Internet exposure and untrusted multi-tenant use require the controls
listed under "Before commercial deployment."

## Security invariants

- The server binds to loopback by default.
- Every project workspace is resolved and checked against an allowlisted root.
- Codex receives only the selected workspace as its writable runtime root.
- The default sandbox is `workspace-write`.
- Network access is disabled unless the local owner changes configuration.
- The control plane never stores or asks for an OpenAI API key.
- Non-loopback binding is always rejected; remote access requires a secure
  tunnel or TLS authentication gateway.
- Public health checks omit local executable paths and runtime details.
- MCP sessions are bounded and idle sessions are reclaimed.
- State and audit files must remain outside every allowed workspace root.
- The Codex executable is resolved to an absolute path outside workspace roots.
- Approval requests that cannot be safely handled are denied.
- Task mutations and execution events are written to an append-only audit log.
- Rate limiting applies to every authenticated endpoint with a configurable
  per-window ceiling; requests past the ceiling receive `429` with a
  `Retry-After` header.
- Audit entries carry a sequence number and a chained hash. Setting
  `AGENT_CONTROL_AUDIT_KEY` switches the chain from SHA-256 to HMAC-SHA256.
  Verify the chain with `npm run verify:audit`.
- JSON responses set `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  no-referrer`, and `X-Frame-Options: DENY`.

## Before commercial deployment

Add standards-based OAuth for MCP, per-user workspace roots, encrypted secret
storage, distributed rate limiting, tenant-isolated state, signed audit export,
CSRF/SSRF protections, and an independent external security review.

## Reporting

For now, report vulnerabilities privately to the repository owner. Do not open a
public issue containing exploit details or credentials.
