# AgentControlPlane Web Bridge userscript preview

This is a desktop-only visual preview of a future AgentControlPlane web bridge.
It adds an ACP button to supported web AI pages and opens an informational
panel. It does not read a conversation, send a task, call a local service, use
a relay, store credentials, or run engineering commands.

## Supported sites

- `https://chatgpt.com/*`
- `https://chat.deepseek.com/*`

## Install

1. Install a userscript manager such as Tampermonkey in a desktop browser.
2. Open `agent-control-plane-web-bridge.user.js` from this directory.
3. Use the userscript manager's install action.
4. Open a supported site and look for the floating ACP button in the lower
   right corner.

## Disable or uninstall

Open the userscript manager, find `AgentControlPlane Web Bridge Preview`, then
disable or remove it. The script has no persistent settings or account data.

## Current boundary

This preview intentionally has no connection to AgentControlPlane. Local task
dispatch, device pairing, mobile relay support, and webpage-content extraction
remain out of scope until their security and product designs are complete.
