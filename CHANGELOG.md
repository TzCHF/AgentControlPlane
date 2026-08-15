# Changelog

## v0.4.2 — 2026-08-15

Companion i18n, one-click dispatch confirmation, and executor correctness fixes.

### Added

- Separate Chinese and English companion UI with a language switcher in the
  panel and popup, backed by a dedicated i18n module.
- A one-click Confirm dispatch button in the panel that appears when an
  envelope is staged; chat confirm words remain available as a fallback.
- An auto profile option that resolves economy/balanced/deep from the
  objective's difficulty.
- Executor display names (OpenCodex, DeepSeek Harness) grouped in the UI into
  third-party agents and model endpoints.
- The controller prompt lists the executor catalog, per-executor model names,
  and forbids fabricated `<ACP_RESULT>` envelopes.
- Model allowlists for model-endpoint executors, validated at dispatch time.
- Executor discovery refresh every 60 seconds so endpoints started after the
  server become available without a restart.
- Executor display names and aliases resolve to registered ids before dispatch.
- Submitted composer text captured at page load as a confirm-word source.
- E2E validation records for DeepSeek Harness, OpenCodex, and the Codex quota
  limit in `docs/WEB-AI-E2E-VALIDATION-TEMPLATE.md`.

### Fixed

- The panel rendered nothing on initialization.
- The i18n module was missing from `web_accessible_resources`.
- Send capture registered lazily and missed the first confirm word.
- Stale executor discovery cache after starting the OpenCodex proxy.
- Web AI envelopes that carried display names for the executor field.
- Invalid model names for endpoint executors reaching the executor layer.
- Fabricated `<ACP_RESULT>` envelopes produced by the web AI.
- DeepSeek user-message selectors broadened for confirm-word detection.

### Verified

- 74 tests pass locally and on GitHub Actions CI.
- Real end-to-end runs through opencode, DeepSeek Harness, and OpenCodex
  executors, including a public ChatGPT share link in the validation table.

## v0.4.1 — 2026-08-15

Browser companion pairing, dispatch confirmation, and traceability fixes.

### Fixed

- Companion requests without an Origin header (Chrome sends none on GETs from
  extension service workers) are accepted when authenticated by a pairing
  secret or bearer token; pairing creation keeps its strict origin check.
- CORS headers are omitted for companion requests without an Origin header.
- String `context` and `constraints` fields from web AI envelopes are wrapped
  into string arrays before dispatch.
- Pairing approval now authenticates by the one-time URL secret alone, so
  approval works regardless of the Origin header spelling the browser sends.
- OpenCode session ids are captured across stderr chunk boundaries and stored
  on tasks as `executor_session_id`.

### Added

- Chinese translations for the README and all documentation, with cross-links.
- Bilingual Chinese-English labels for the companion panel, popup, pairing
  approval pages, and server error messages.
- A single confirm-word dispatch flow: envelopes are staged and dispatched only
  after the user replies with a confirmation word (执行 / 开始 / yes / 是否派发
  and others) or clicks the panel Dispatch button; new envelopes replace the
  staged one.
- Trailing modal particles are normalized in confirmation words (开始吧 matches
  开始), unrecognized replies produce a visible panel hint, and custom confirm
  words can be collected in the panel settings.
- The web AI is taught to append a staged-task line after every envelope and to
  wait quietly for `<ACP_RESULT>`.
- The controller prompt documents optional `model`, `reasoning_effort`,
  `token_budget`, and `max_subagents` fields with profile details.
- `executor_session_id` surfaces in panel status and `<ACP_RESULT>` envelopes.
- After pairing, the controller prompt is inserted into the composer
  automatically, and a missing workspace falls back to the first available
  workspace root.
- The web AI asks once for model and reasoning effort before emitting an
  envelope, supports an auto choice based on task difficulty, and reports
  rejected model names from `<ACP_RESULT>` errors back to the user.

### Verified

- 73 tests pass locally and on GitHub Actions CI.
- Real browser-driven E2E on chatgpt.com: ChatGPT emits `<ACP_TASK>`, the
  companion dispatches after the confirm word, OpenCode executes, and
  `acp-e2e-ok.txt` with exact content `ACP_WEB_AI_OK` is produced with passed
  test evidence.

## v0.4.0 — 2026-08-14

Browser companion and provider-neutral web AI control loop.

### Added

- A Manifest V3 browser companion for ChatGPT, DeepSeek, Claude, and optional
  generic HTTPS chat sites.
- One-time local pairing with extension-bound, hashed client credentials; no
  control-plane API key needs to be copied into the browser.
- Scoped companion APIs for executor/profile/workspace discovery, dispatch,
  status, follow-up, cancellation, and compact result delivery.
- `<ACP_TASK>` and `<ACP_RESULT>` envelopes for reliable bidirectional handoff
  between a web planning conversation and local engineering executors.
- Per-site automatic dispatch and result submission controls, with automatic
  result submission disabled until the user opts in.
- Browser companion protocol, pairing, origin, ownership, and manifest tests.
- `benchmark:real` script and real end-to-end comparison artifacts
  (`benchmark/real-results.json`, `benchmark/real-report.json`,
  `benchmark/real-summary.json`, and
  `docs/REAL-TOKEN-COMPARISON-RESULTS.md`) for direct versus controlled
  execution experiments.

### Security

- Pairing approval is loopback-only, short-lived, and bound to the exact browser
  extension origin.
- Paired clients can read and mutate only tasks that they created.
- Raw companion tokens are returned once and never persisted by the control
  plane; only SHA-256 token hashes are stored.

## v0.3.2 — 2026-08-14

Claude Code readiness hotfix.

### Fixed

- Distinguish an installed Claude Code CLI from an authenticated, usable
  executor.
- Mark Claude Code as `not_authenticated` and skip it during automatic routing
  when neither a Pro/Max login nor an Anthropic API key is available.
- Restore Claude Code automatically after account or API-key authentication and
  a control-plane restart.

## v0.3.1 — 2026-08-14

Windows CLI routing and failure-diagnostics hotfix.

### Fixed

- Resolve npm-generated `opencode.cmd` and `claude.cmd` shims to their trusted
  underlying executables before dispatch.
- Apply discovered executable paths to the active adapters and drop unresolved
  command names.
- Include bounded, ANSI-stripped CLI stderr in failed task errors and prevent
  duplicate terminal notifications.
- Use executor-neutral wording when a failed backend returns no final message.

## v0.3.0 — 2026-08-14

Automatic multi-executor routing and a provider-neutral MCP surface.

### Added

- Startup discovery for OpenCode, Codex, Claude Code, OpenAI-compatible local
  endpoints, and DeepSeek configuration.
- Capability/readiness metadata through `list_executors`, `/v1/executors`, and
  diagnostics.
- Per-task `executor` selection with `auto` as the zero-configuration default.
- Executor discovery and automatic fallback tests.
- Apache-2.0 licensing and project attribution through `NOTICE`.

### Changed

- OpenCode is the first automatic route when its CLI is installed; Codex,
  Claude, OpenAI-compatible, and DeepSeek routes remain available.
- MCP instructions and project documentation are provider-neutral.
- Non-Codex executors use their own configured default model unless a task
  explicitly supplies one.

## v0.2.0 — 2026-08-13

Security hardening and the multi-executor foundation.

### Added

- A generic `ExecutorAdapter` contract (`src/executors/`) with a `CodexExecutor`
  implementation, so the control plane can target other coding agents without
  changing the MCP surface.
- Benchmark reporting that compares `direct` versus `controlled` execution and
  reports token, elapsed-time, and success metrics (`src/benchmark/`,
  `docs/BENCHMARKING.md`).
- Per-request rate limiting with `Retry-After` signalling.
- An append-only audit hash chain for tamper-evident logs.
- Security response headers on the HTTP surface.
- A GitHub Actions CI workflow that runs the test suite on every push and pull
  request.

### Changed

- `main` is protected: required status checks, linear history, and no force
  pushes.

## v0.1.0 — 2026-08-13

Initial public release.

### Included

- An MCP server with eight tools: `dispatch_project`, `task_status`,
  `continue_project`, `cancel_task`, `list_tasks`, `list_profiles`,
  `list_models`, `usage_report`.
- Three execution profiles: `economy`, `balanced`, `deep`.
- A persistent Codex project thread per workspace.
- Append-only audit logging and atomic state persistence.
- Loopback-only HTTP binding with optional bearer authentication.
- Workspace allowlist enforcement and `workspace-write` sandbox defaults.
- Stateless `server/discover` support for OpenAI Secure MCP Tunnel connections.
- Measured token usage from Codex thread goals, with a hard budget interrupt.

### Changes since the first commit

- `224c1a6` — support `server/discover` for ChatGPT connectors.
- `2aa4d5d` — measure token usage and enforce the hard budget interrupt.

### Known limitations

- Single-user local scope; not approved for multi-tenant or public-Internet
  exposure.
- Token enforcement polls once per second, so a provider can consume tokens
  during one polling interval after the budget is reached.
- Platform tunnel creation, permission grants, and runtime-key provisioning are
  account-level steps that this repository does not automate.
