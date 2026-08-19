# AI relay integration

> [中文文档](AI-RELAY-INTEGRATION.zh-CN.md)

AgentControlPlane pairs with an OpenAI-compatible AI API relay (中转站) so the
relay supplies models and the control plane supplies the agent loop, web AI
hand-off, task state, and per-task token accounting.

## How they complement each other

```text
web AI (ChatGPT / DeepSeek ...)
        |
        v  <ACP_TASK> envelope
AgentControlPlane
        |  openai-compatible executor (ACP agent loop)
        v  OpenAI-compatible /v1 requests
AI relay (中转站) -> upstream model catalog
```

The relay provides the model catalog and the compute; AgentControlPlane
provides the delegation workflow and usage evidence that the relay can bill
against.

## AsterRoute provider

The official AsterRoute relay base URL is `https://asterroute.com/v1`.
AsterRoute access is currently invite-only; approved accounts receive the
API credentials, model access and usage limits assigned to them. Follow the
dedicated provider guide [docs/PROVIDER-ASTERROUTE.md](PROVIDER-ASTERROUTE.md)
or read the [AsterRoute integration guide](https://asterroute.com/integrations/agentcontrolplane).

## Configuration

Create `config/local.json` (machine-specific, gitignored) or use
`AGENT_CONTROL_CONFIG`:

```json
{
  "executor": {
    "openaiCompat": {
      "baseUrl": "https://your-relay.example/v1",
      "apiKey": "sk-your-relay-key",
      "model": "deepseek/deepseek-v4-pro",
      "protocol": "responses",
      "models": ["deepseek/deepseek-v4-pro", "deepseek-v4-pro"]
    }
  }
}
```

- `baseUrl`: the relay's OpenAI-compatible endpoint.
- `apiKey`: the relay's API key (or use the `AGENT_CONTROL_OPENAI_KEY`
  environment variable).
- `model`: the default model when an envelope omits `model`.
- `models`: the static allowlist used when the live catalog is unreachable.

## Multiple relay endpoints

Each entry under `executor.relays` registers a named relay endpoint. Every
relay becomes a separate executor with its own id, display name, live model
catalog, and static allowlist:

```json
{
  "executor": {
    "relays": [
      {
        "id": "asterroute",
        "displayName": "AsterRoute",
        "baseUrl": "https://asterroute.com/v1",
        "apiKeyEnv": "ACP_RELAY_ASTERROUTE_KEY",
        "apiKey": "sk-your-relay-key",
        "model": null,
        "protocol": "chat",
        "models": [],
        "requestsPerMinute": 10
      },
      {
        "id": "secondary",
        "displayName": "Secondary Relay",
        "baseUrl": "https://second-relay.example/v1",
        "apiKeyEnv": "ACP_RELAY_SECONDARY_KEY",
        "apiKey": null,
        "protocol": "chat",
        "models": ["deepseek-v4-pro"]
      }
    ]
  }
}
```

- `id` is required and must differ from the built-in executor ids
  (`codex`, `openai-compatible`, `deepseek`, `claude`, `opencode`).
- `apiKeyEnv` names an environment variable that supplies the key when
  `apiKey` is empty, so keys can stay out of configuration files.
- `requestsPerMinute` paces completion requests against the relay; the
  executor waits when a 60-second sliding window would exceed the limit.
  The executor also retries 429 responses twice, honoring the
  `retry-after` header. Every authorized request counts into the relay's
  RPM window, including retried 429s, and the pacer counts each attempt;
  concurrent tasks share one window per relay. `/v1/models` discovery
  requests are paced separately and stay outside this limit. The values in
  these examples are illustrative; the limit assigned to each account by
  the operator is authoritative.
- The executor captures two request identifiers from response headers:
  `x-asterroute-request-id` as `asterroute_request_id`, and
  `x-asterroute-provider-request-id` as `upstream_request_id`. The first
  drives ACP-to-gateway reconciliation; the second stays with upstream
  billing and diagnostics.
- `reconcileUrl` (optional) names the relay's read-only bulk lookup
  endpoint (`POST /api/usage/reconcile/lookup`). When configured, ACP
  posts local request ids that have no reconciliation entry yet, computes
  presence and token states locally, and reads settlement fields from the
  response; ACP never writes actual cost or settled state to the relay.
- Dispatch selects a relay with `"executor": "asterroute"` or by its
  display name; each relay's catalog appears in `list_models`, the web
  panel, and the companion executor list under model endpoints.

## Provider presets

A preset is a data entry that pre-fills relay fields, so a provider can be
configured with a name in place of a full JSON block:

```json
{
  "executor": {
    "relays": [
      {
        "id": "asterroute",
        "preset": "asterroute",
        "apiKey": "sk-your-relay-key",
        "requestsPerMinute": 10
      }
    ]
  }
}
```

Explicit fields override the preset; `presetNames()` lists the registry.
Presets carry no code branches, and removing every preset entry leaves ACP
functional with any manual relay configuration.

## Protocol auto-detection

`protocol: "auto"` probes the endpoint once per process and selects the
protocol that completes the agent tool loop:

1. Responses API availability.
2. Responses tool calling: a `ping` tool request that must return a
   `function_call` for `ping`.
3. Chat Completions tool calling: the same check with `tool_calls`.
4. The protocol that passed both checks is selected; responses wins ties.

The probe uses a 1024-token output cap (room for reasoning models), runs
once, and is cached for the process
lifetime. Explicit `chat` or `responses` never probes. The detection result
shows in executor discovery (`protocols.selected`, per-protocol tool loop
checks, probe model).

## Model capabilities

Each model entry may carry a `capabilities` object:

```json
{
  "id": "model-id",
  "capabilities": {
    "chat": true,
    "responses": false,
    "tools": true,
    "reasoning": true,
    "vision": false
  }
}
```

Capabilities declared by the provider in `/v1/models` pass through. When a
provider declares none, the field stays unknown (`null`) and the protocol
probe records verified capabilities for the probed model. `featured` and
`route_tier` metadata pass through when present.

## Live model catalog

On startup and every 60 seconds, AgentControlPlane reads `GET /v1/models`
from the relay and builds the model catalog:

- `list_models` and the companion panel show the relay's current models.
- Dispatch-time model validation prefers the live catalog; the static
  `models` allowlist applies when the relay is offline.
- New models added to the relay appear without a restart.

## Using the relay from the web AI

Say "use OpenCodex" to route the envelope to `openai-compatible`, or name a
model from the relay's catalog:

```text
<ACP_TASK>
{
  "workspace": "DEFAULT",
  "objective": "...",
  "executor": "openai-compatible",
  "model": "deepseek/deepseek-v4-pro",
  "profile": "balanced"
}
</ACP_TASK>
```

## Usage accounting

Every task stores measured input, output, reasoning, and total tokens. The
`usage_report` MCP tool aggregates them per executor, which gives the relay
per-user usage evidence for billing or quota checks.

Relays that bill KV-cache reads at the full input price (cache hits carry
no discount) reconcile directly from `input_tokens`, which counts the whole
prompt including the cached portion; `cached_input_tokens` labels that
portion and `uncached_input_tokens` the remainder. Relays that discount
cache reads subtract `cached_input_tokens` from `input_tokens` first.
