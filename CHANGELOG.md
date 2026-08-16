# Changelog

## v0.5.3 — 2026-08-16

Probe checklist on the web panel.

### Added

- Executor cards for auto-protocol endpoints show the detection checklist:
  the selected protocol and per-protocol tool-loop results (✓/✗), so the
  probing outcome is visible directly on the card.

### Verified

- 108 tests pass locally; copy passes the grounded-copy gate with 0
  findings.

## v0.5.2 — 2026-08-16

Smarter protocol probe model selection.

### Fixed

- Auto-detection probes up to three candidate models in order: the
  configured model, the static allowlist, models that declare chat, tool,
  or responses capabilities in `/v1/models`, and the rest of the catalog.
  This keeps probes away from catalog entries that lack an active tool
  route.

### Verified

- 108 tests pass locally.
- Live check on the AsterRoute preset resolves the protocol from a
  capability-declaring model.

## v0.5.1 — 2026-08-16

Protocol probe budget for reasoning models.

### Fixed

- Auto-detection probes cap output at 1024 tokens, which leaves reasoning
  models room to emit a tool call; the earlier 16-token cap exhausted on
  reasoning output and recorded false tool-loop failures.

### Verified

- 108 tests pass locally.
- Live check on the AsterRoute preset: catalog capabilities pass through,
  and the probe resolves the protocol.

## v0.5.0 — 2026-08-16

Phase 1: provider-agnostic capability layer and official relay preset.

### Added

- Provider preset registry (`src/executors/provider-presets.js`): data
  entries that pre-fill relay fields. A relay entry can now be
  `{ "id": "asterroute", "preset": "asterroute", "apiKey": "…" }`;
  explicit fields override the preset. Unknown presets fail with the
  available names. Presets carry no code branches; `official` is a UI
  flag only.
- `protocol: "auto"` detection: probes the Responses API availability,
  the Responses tool loop, then the Chat Completions tool loop with a
  tiny `ping` tool, and selects the protocol that completes the loop.
  Detection runs once per process, is cached, uses a 16-token output cap,
  and explicit `chat`/`responses` never probe. The result shows in
  executor discovery (`protocols.selected`, per-protocol checks, probe
  model).
- Model capability layer: `/v1/models` entries pass through provider-
  declared `capabilities`, `featured`, and `route_tier`; undeclared
  capabilities stay unknown (`null`) and the protocol probe records
  verified capabilities for the probed model.
- Companion model dropdown: per-executor model catalogs from
  `/v1/companion/options` (`models` map), an auto default, official
  provider labels, and a catalog-driven controller prompt that lists
  advertised model names. The dashboard shows official badges and
  capability/featured tags per model.
- Integration guide documents presets, auto-detection, and capabilities
  in both languages.

### Compatibility

- Explicit relay JSON configurations keep working unchanged; `chat` and
  `responses` protocols behave as before. `list_models` and companion
  options now include extra fields (additive). `dispatch` behavior is
  unchanged.

### Verified

- 108 tests pass locally, including preset resolution and overrides,
  detection ordering and caching, a full auto-detected chat tool loop,
  capability passthrough, and companion model-dispatch flow.
- Copy passes the grounded-copy gate with 0 findings.

## v0.4.10 — 2026-08-16

Task search and id-prefix lookup.

### Added

- `search_tasks` MCP tool and `GET /v1/tasks?query=&status=` filter tasks by
  id prefix, objective text, result summary, and status.
- `task_status`, `continue_project`, `cancel_task`, and `GET /v1/tasks/:id`
  accept an unambiguous id prefix (8 or more characters) in addition to the
  full task id.
- The web panel and the companion task history gain a search box; the
  companion search runs against the paired client's own tasks.
- Repository instructions record the provider-independence boundary, and
  `docs/ROADMAP.md` (Chinese version included) fixes the interface shapes
  for the model-routing, usage-intelligence, and cost-aware picker phases.

### Verified

- 96 tests pass locally, including deterministic prefix-ambiguity, content
  search, HTTP filtering, and MCP tool tests.
- Copy passes the grounded-copy gate with 0 findings.

## v0.4.9 — 2026-08-16

Relay request pacing and 429 retries.

### Added

- Per-relay `requestsPerMinute` setting paces completion requests with a
  60-second sliding window; the executor waits when the next request would
  exceed the relay's limit. The `openaiCompat` and `deepseek` endpoints
  accept the same setting.
- Completion requests to model endpoints retry 429 responses twice,
  honoring the `retry-after` header; `/v1/models` discovery stays outside
  the pacing window and is unaffected.
- Integration guide documents the setting in both languages.

### Verified

- 93 tests pass locally, including sliding-window pacing math, a 429-then-
  success chat turn, and relay config wiring.
- Docs pass the grounded-copy gate with 0 findings.

## v0.4.8 — 2026-08-16

Service version markers in the companion UI.

### Added

- The companion panel header and the extension popup show the local
  service version reported by `/v1/companion/options` (for example
  `v0.4.8`). The popup previously carried a hard-coded version label.
- The popup executor list groups relay endpoints under model endpoints
  using the executor kind, matching the in-page panel.

### Verified

- 91 tests pass locally, including version-marker source checks.
- Companion copy passes the grounded-copy gate with 0 findings.

## v0.4.7 — 2026-08-16

Failed executor turns surface their real error.

### Fixed

- A failed executor turn records its error message in the task result
  summary and the task error field; panels and companions then display
  the endpoint's message (for example a relay 503).

### Verified

- 90 tests pass locally, including a failed-turn error-surfacing test.

## v0.4.6 — 2026-08-16

Multiple AI relay endpoints.

### Added

- Each entry under `executor.relays` registers a named OpenAI-compatible
  relay as its own executor, with a display name, live model catalog
  refreshed every 60 seconds, and a static model allowlist. Relay ids must
  differ from built-in executor ids.
- Relay API keys can come from a named environment variable
  (`apiKeyEnv`) so keys stay out of configuration files.
- Relay executors appear in the companion executor list under model
  endpoints, in the web panel, and in `list_models` / `list_executors`.
- Dispatch validates explicit models against the selected relay's live
  catalog with the static allowlist as fallback.
- Integration guide documents the multi-relay shape
  (`docs/AI-RELAY-INTEGRATION.md`, Chinese version included).

### Verified

- 89 tests pass locally, including relay registration, id validation, and
  static-allowlist model checks.
- Docs and config examples pass the grounded-copy gate with 0 findings.

## v0.4.5 — 2026-08-16

Companion task history and project continuation.

### Added

- The companion panel lists recent tasks dispatched by this paired client,
  with status, start time, actual minutes, executor, model, profile, token
  usage, and the result summary (`GET /v1/companion/tasks`, scoped to the
  paired client's own tasks).
- Completed tasks carry a Continue project button that accepts a follow-up
  instruction and dispatches a child task in the same workspace through
  `continue_project`; the panel then tracks the child task with the live
  timer and progress bar.
- Task history refreshes automatically after pairing and after every task
  reaches a terminal status.

### Verified

- 86 tests pass locally, including companion task-list scoping, client
  isolation, and i18n key parity.
- Companion copy passes the grounded-copy gate with 0 findings.

## v0.4.4 — 2026-08-16

Local read-only web panel.

### Added

- A self-contained web panel at `http://127.0.0.1:4318/` (also `/dashboard`)
  showing executor readiness, live model catalogs per executor, recent tasks
  with status, time used, token counts, and budget bars, plus the aggregate
  token usage report.
- The panel is read-only: it performs same-origin GET requests only. It is
  served without a bearer token and shows a token input when the server
  requires one; a strict content security policy and frame denial headers
  apply.
- Chinese and English panel strings in one dictionary (`src/dashboard.js`)
  with a language switcher; Chinese is the default.
- The panel refreshes every 5 seconds.

### Verified

- 85 tests pass locally, including 5 panel tests (route serving, security
  headers, i18n key parity, token exemption).
- Panel copy passes the grounded-copy gate with 0 findings.

## v0.4.3 — 2026-08-15

Token accounting correctness, task time controls, and license policy.

### Added

- Per-task `time_limit_minutes` field (1 to 240) with runtime enforcement and
  validation.
- Estimated completion minutes at dispatch, actual duration at terminal, a
  per-second live timer, and a percentage progress bar in the companion panel.
- Machine-specific configuration through `config/local.json` with automatic
  merging; `default.json` carries neutral values.
- Live model catalogs read from OpenAI-compatible relay endpoints every 60
  seconds, used for `list_models` and dispatch-time validation with a static
  fallback.
- License policy: current source under AGPL-3.0 with a commercial cooperation
  requirement; released versions v0.1.0 through v0.4.2 remain Apache-2.0
  (`docs/LEGACY-LICENSE-APACHE-2.0.md`), trademark statement in `NOTICE`.
- AI relay integration guide (`docs/AI-RELAY-INTEGRATION.md`, Chinese version
  included).

### Fixed

- Budget monitoring for opencode tasks counts marginal tokens; KV-cache reads
  are recorded as `cached_input_tokens` and excluded from budget comparisons.
- Tasks keep their completed status when the executor delivered its final
  report before a late budget interrupt; the exceedance is recorded as an
  event.
- `uncached_input_tokens` computed correctly when cached reads exceed the
  input figure.
- Cached input tokens thread through opencode usage notifications.
- Workspace lists show only directories inside configured roots.
- Service version derives from `package.json` across health, companion
  options, and the MCP handshake.
- Real username paths replaced with `YOUR_USER` placeholders in docs and
  evidence.

### Verified

- 80 tests pass locally and on GitHub Actions CI.
- Four consecutive real end-to-end runs through the opencode executor complete
  with no budget interrupts; files verified on disk.

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
