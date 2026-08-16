# AgentControlPlane repository instructions

- Keep this repository independent from CWapi and do not copy CWapi source code.
- Default to local-only networking and workspace-scoped writes.
- Do not add API-key-based model calls. Codex authentication is owned by the installed Codex client.
- Preserve compact structured task results and token-usage accounting.
- Treat MCP as the control-plane boundary; Codex app-server is the execution-plane boundary.
- Tests must not consume model quota unless explicitly marked as live tests.
- Relay stations (for example AsterRoute) are separate projects. ACP interacts
  with them only as an API client using the keys in `config/local.json`; never
  modify relay-side code, deployment, routes, or admin settings.
- API keys are never written to logs, reports, or commits. Key material is
  referenced by SHA-256 fingerprint prefix only; `scripts/key-fingerprint.js`
  prints that identity without the key. Key rotation happens on the provider
  side; ACP consumes the new key from the environment or local config.
- ACP is provider-agnostic: it must not become a client of one provider, and
  no provider may become a hard dependency. Core orchestration, executors, and
  the capability layer speak standard OpenAI-compatible wire shapes only.
  Provider-specific presets are data entries in a registry; they carry no
  code branches. Provider-specific endpoints or fields are optional metadata.
  Removing any single provider's config must leave ACP fully functional.

