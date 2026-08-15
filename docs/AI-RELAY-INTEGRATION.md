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
AI relay (中转站) -> upstream models (DeepSeek, GLM, OpenAI ...)
```

The relay provides the model catalog and the compute; AgentControlPlane
provides the delegation workflow and usage evidence that the relay can bill
against.

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
