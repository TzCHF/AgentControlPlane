# AsterRoute provider

> [中文文档](PROVIDER-ASTERROUTE.zh-CN.md)

AsterRoute is the official AI relay (中转站) for AgentControlPlane. It is an
OpenAI-compatible gateway that authenticates, relays, meters, and bills model
requests; AgentControlPlane supplies the agent loop, web AI hand-off, task
state, and per-task token accounting. The two integrate only through the
standard OpenAI protocol. AsterRoute works with any OpenAI or Anthropic SDK,
and AgentControlPlane works with any OpenAI-compatible provider.

## Setup

1. Register for an AsterRoute API key (project + prepaid balance) at
   [`https://asterroute.com/register?utm_source=agentcontrolplane&utm_medium=integration&utm_campaign=asterroute-acp`](https://asterroute.com/register?utm_source=agentcontrolplane&utm_medium=integration&utm_campaign=asterroute-acp).
2. Keep the key in the `ASTERROUTE_API_KEY` environment variable, not in
   configuration files.
3. Add the official preset relay to `config/local.json`:

   ```json
   {
     "executor": {
       "relays": [
         {
           "id": "asterroute",
           "preset": "asterroute",
           "apiKeyEnv": "ASTERROUTE_API_KEY",
           "reconcileUrl": "https://asterroute.com",
           "requestsPerMinute": 10
         }
       ]
     }
   }
   ```

   The preset pre-fills `baseUrl: "https://asterroute.com/v1"` (the OpenAI-
   compatible base URL) and `protocol: "auto"`. Explicit fields override the
   preset.
4. Start the service with `npm start`. The local panel binds to
   `http://127.0.0.1:4318`.

AsterRoute's own walkthrough for this integration is published at
[`https://asterroute.com/integrations/agentcontrolplane?utm_source=agentcontrolplane&utm_medium=docs&utm_campaign=asterroute-acp`](https://asterroute.com/integrations/agentcontrolplane?utm_source=agentcontrolplane&utm_medium=docs&utm_campaign=asterroute-acp).

## Usage in the Dashboard

Open `http://127.0.0.1:4318/` after startup:

- The **Executors** grid shows the `asterroute` relay as a model-endpoint
  executor with its base URL, readiness, and protocol probe result. Relays
  appear from executor data only; the panel has no AsterRoute-specific code.
- The **Model catalog** selector lists `asterroute`; its entries come from
  `GET /v1/models` and refresh every 60 seconds, so models added on the
  AsterRoute side appear without a restart.
- The **Usage summary** aggregates measured input, output, reasoning, and
  total tokens per executor. The per-model table shows estimated versus
  settled cost and reconciliation states, which come from the
  `reconcileUrl` lookup — ACP only reads settlement data and never writes
  cost or settled state to AsterRoute.

Model selection always stays with the client. ACP lists the live catalog;
it does not switch the model you picked.

## Error guidance

| AsterRoute error | What to do |
|---|---|
| `401 invalid_api_key` | Re-issue or rotate the key in the AsterRoute console, then update `ASTERROUTE_API_KEY` and restart ACP. |
| `402 insufficient_balance` | Top up the project balance in the AsterRoute console (minimum €25). |
| `429 rate_limit_exceeded` | The account rate limit is reached. Retry with exponential backoff; the executor honors `retry-after` headers. |
| `400 model_not_allowed` / `400 model_required` | Fix the model ID: `GET /v1/models` on the AsterRoute base URL is authoritative, and dispatch-time validation uses that live catalog. |
| `503 provider_unavailable` | An upstream provider is unavailable. Check the [status page](https://asterroute.com/status?utm_source=agentcontrolplane&utm_medium=error&utm_campaign=asterroute-acp) and retry with backoff. |

## Related documents

- [AI relay integration](AI-RELAY-INTEGRATION.md)
- [Beta onboarding](BETA-ONBOARDING.md)
