# Connect ChatGPT to AgentControlPlane

> [中文文档](CHATGPT-CONNECTION.zh-CN.md)

AgentControlPlane is a tool-only MCP server. The recommended private-use path is
OpenAI Secure MCP Tunnel because the server can remain bound to loopback and no
inbound firewall port needs to be opened.

Official references:

- [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [MCP authentication](https://developers.openai.com/plugins/build/auth)

## 1. Verify the local service

From this repository:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run doctor
npm.cmd start
```

Keep the service on its default loopback address:

```text
http://127.0.0.1:4318/mcp
```

Do not change the host to `0.0.0.0` for tunnel use.

## 2. Create a Secure MCP Tunnel

In OpenAI Platform tunnel settings:

1. Create a tunnel and associate it with the ChatGPT workspace or personal
   workspace that will use it.
2. Grant the operator the tunnel permissions required to run the client and
   select the tunnel.
3. Download the current `tunnel-client` release from the tunnel settings page.
4. Create a runtime API key for `tunnel-client` and keep it outside this
   repository.

The tunnel runtime key authenticates `tunnel-client` to the OpenAI tunnel
control plane. AgentControlPlane itself does not require or store an OpenAI API
key.

Use the current `tunnel-client help quickstart` output as the source of truth.
For the HTTP server in this repository, initialize a named profile:

```powershell
$env:CONTROL_PLANE_API_KEY = "<runtime key>"
tunnel-client init `
  --sample sample_mcp_http_local `
  --profile agent-control-plane `
  --tunnel-id <tunnel_id> `
  --mcp-server-url http://127.0.0.1:4318/mcp
```

Then validate and run it:

```powershell
tunnel-client doctor --profile agent-control-plane --explain
tunnel-client run --profile agent-control-plane
```

Keep both AgentControlPlane and `tunnel-client` running.

## 3. Add it in ChatGPT

1. In ChatGPT, open **Settings → Security and login** and enable Developer mode.
2. Open the ChatGPT Plugins page and select the plus button.
3. Enter a name and description.
4. Under Connection, choose **Tunnel**.
5. Select the associated tunnel or paste its `tunnel_id`.
6. Review the discovered tools and create the connection.
7. Start a new conversation and enable the connection from the tools menu.

After tool names, schemas, descriptions, annotations, or authentication change,
open the connection and select **Refresh**, then start a new conversation.

## 4. First verification prompt

Start with a read-only task:

```text
Use AgentControlPlane to list the available execution profiles and models.
Do not dispatch engineering work yet.
```

Then dispatch a small project task:

```text
Use the balanced profile. Ask the engineering agent to inspect my selected
workspace, make no changes, and return the repository title plus test command.
```

The expected flow is:

```text
ChatGPT conversation
  -> AgentControlPlane MCP tool
  -> persistent Codex project thread
  -> compact result and measured usage
  -> ChatGPT follow-up or acceptance
```

## Security notes

- Secure MCP Tunnel is for private connections and developer-mode testing. It
  is not a substitute for the stable public HTTPS endpoint required for public
  plugin submission.
- Do not use a generic public forwarding URL for this service without an
  authenticated gateway.
- ChatGPT does not send arbitrary customer-provided API keys to an MCP server.
  A production public deployment should use MCP-compatible OAuth 2.1, validate
  issuer, audience, expiry, and scopes, and optionally verify OpenAI-managed
  mTLS at the gateway.
- `AGENT_CONTROL_TOKEN` is useful for direct HTTP clients and private reverse
  proxies, but it is not the production ChatGPT authentication design.
- Keep `workspaceRoots` narrow. Anyone authorized to dispatch work can cause
  Codex to edit files inside those roots.

## Current limitation

Creating the Platform tunnel, granting its permissions, and provisioning the
runtime key are account-level actions. They are intentionally not automated by
this repository.
