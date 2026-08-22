# Userscript local-dispatch design

Status: proposed. This document defines the public safety and product contract
for the first desktop-only userscript dispatch slice. It does not enable task
dispatch by itself.

## Goal

Allow a person on a supported desktop web AI page to prepare a small task
candidate and hand it to their local AgentControlPlane for review. The local
AgentControlPlane, not the web page or userscript, owns the final decision to
dispatch work to an executor.

## Scope

This slice is limited to desktop browsers and a locally running ACP instance.
It does not include a mobile client, relay service, remote access, background
task dispatch, webpage conversation extraction, or automatic executor choice.

## Trust boundary

Webpage content is untrusted, including AI replies, page scripts, browser DOM,
and text that resembles an ACP instruction. A userscript must never treat page
content as permission to create, continue, cancel, or approve an engineering
task.

The local ACP owner is the authority for workspace selection, executor choice,
task review, and execution. Existing ACP workspace allowlists, loopback-only
binding, rate limits, audit records, and executor policy remain in force.

## User flow

1. The person opens the ACP panel from the userscript.
2. The panel starts empty. It does not read or prefill the web AI conversation.
3. The person manually enters a compact objective and optional constraints.
4. The panel labels the submission as a candidate, not an executed task.
5. A local ACP review surface displays the candidate, selected workspace,
   selected executor, and execution impact before any dispatch action exists.
6. Only a fresh local user confirmation may create a task.
7. Results shown back in the userscript are compact status and evidence, never
   raw local logs, credentials, or unrestricted workspace data.

## Required safety rules

- No task creation, continuation, cancellation, or model selection happens on
  page load, page navigation, DOM mutation, or AI-generated text.
- No automatic reading, copying, or transmission of chat messages, cookies,
  browser storage, local paths, credentials, API keys, or access tokens.
- The userscript holds no long-lived ACP credential.
- The local review surface must reject stale, duplicated, or unapproved task
  candidates.
- The existing ACP origin, authentication, workspace, rate-limit, audit, and
  executor-policy checks cannot be bypassed by the userscript.
- The initial release remains loopback-only. It does not expose ACP through a
  public address or act as a relay.

## Data contract

The candidate contract is intentionally smaller than an ACP engineering brief:

```json
{
  "objective": "string, entered by the user",
  "constraints": ["optional user-entered strings"],
  "source": "userscript-preview"
}
```

The candidate contains no workspace path, executor identifier, model,
credential, conversation transcript, browser identifier, or local file data.
ACP resolves all local execution choices during the review step.

## Implementation gates

Implementation may begin only after these gates have tests:

1. A static userscript test proves that no chat extraction, network action, or
   task mutation is present before the local-review feature is added.
2. A local-review integration test proves that a candidate cannot produce a
   task without an explicit fresh local confirmation.
3. Negative tests prove that page-supplied task-shaped text, repeated requests,
   stale candidates, unknown origins, and workspace overrides are rejected.
4. A security review verifies that existing ACP loopback, authentication,
   workspace, audit, and rate-limit invariants still hold.
5. A Sol review is required before enabling real dispatch outside a development
   preview.

## Explicit non-goals

This design does not specify device pairing, mobile workflows, relay protocols,
cryptographic implementation, hosting, pricing, telemetry, or multi-user
access. Those areas need separate designs after the desktop local-review flow
has passed its security gates.

## Feedback

Discuss the user flow in
[GitHub Discussions](https://github.com/Ya-KARAS/AgentControlPlane/discussions).
Use a [Feature request](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=feature_request.yml)
for concrete acceptance criteria. Do not publish credentials, local paths,
security bypass ideas, or private logs.
