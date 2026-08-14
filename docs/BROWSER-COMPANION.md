# Browser companion

The AgentControlPlane browser companion connects a normal web AI conversation
to the local control plane when the web product does not provide a usable custom
MCP connection. It does not reuse, export, or bypass model quota. The web AI
plans the task; the selected local executor performs the engineering work with
its own account or provider configuration.

## Supported pages

- ChatGPT (`chatgpt.com`)
- DeepSeek (`chat.deepseek.com`)
- Claude (`claude.ai`)
- Other HTTPS chat pages after an explicit optional site permission

The generic adapter uses accessibility and composer heuristics. A web page can
change its DOM at any time, so the built-in adapters are preferred and adapter
failures are reported in the page panel instead of silently submitting text.

## Install for local testing

1. Start AgentControlPlane:

   ```powershell
   cd C:\Users\45928\Documents\Github\AgentControlPlane
   npm.cmd start
   ```

2. Open `chrome://extensions` or `edge://extensions`.
3. Enable developer mode.
4. Choose **Load unpacked** and select the repository's
   `browser-companion` directory.
5. Open a supported web AI page and click the floating **ACP** button.
6. Click **Pair**, compare the six-digit code, and approve the local page.
7. Select a known workspace, profile, and executor. `auto` chooses the first
   healthy installed/configured executor.

No API key or main control-plane bearer token is copied into the browser. A
paired extension receives a separate scoped credential that can access only
tasks created by that extension.

## Conversation protocol

Click **Teach web AI** to place the controller instructions in the current
composer. The web AI clarifies intent and emits one implementation-ready block:

```text
<ACP_TASK>
{
  "workspace": "DEFAULT",
  "objective": "Implement and verify the requested change",
  "context": "Only execution-relevant context",
  "constraints": ["Preserve compatibility"],
  "acceptance_criteria": ["Automated tests pass"],
  "profile": "balanced",
  "executor": "auto"
}
</ACP_TASK>
```

`DEFAULT` is resolved inside the extension and keeps the local filesystem path
out of the web conversation. When automatic dispatch is enabled, the companion
sends the envelope to AgentControlPlane, monitors the task, and inserts a
compact terminal block:

```text
<ACP_RESULT>
{
  "task_id": "...",
  "status": "completed",
  "executor": "opencode",
  "result": { "summary": "...", "changed_files": [], "tests": [] },
  "error": null,
  "usage": { "total_tokens": 0 }
}
</ACP_RESULT>
```

Automatic result submission is disabled by default because task results may
contain local file names or code details. Enable it per browser profile only
when the selected web AI conversation is trusted to receive those results.

## Pairing and security model

- Pairing creation and approval are accepted only over loopback.
- A request expires after 10 minutes by default.
- The approval page shows both the code and exact extension origin.
- The client token is returned once and stored by browser extension storage.
- AgentControlPlane stores only a SHA-256 hash of the client token.
- The token is bound to the exact extension origin.
- A paired client can read, follow up, or cancel only tasks it created.
- Known AI origins are granted in the manifest; every other HTTPS site requires
  a separate optional permission.
- The extension does not read cookies, browser history, passwords, or page
  storage.

Pairing state is stored in the configured AgentControlPlane state directory as
`companion-clients.json`. Removing that file while the service is stopped
revokes all browser companion sessions.

## Validation

Run:

```powershell
npm.cmd test
npm.cmd run companion:check
```

The test suite validates origin restrictions, one-time token delivery, hashed
credential persistence, per-client task ownership, protocol parsing, adapter
selection, manifest permissions, and the scoped dispatch/status/follow-up flow.
