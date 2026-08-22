# Cross-device roadmap

This document describes public product directions that are open for community
feedback. It is not a release commitment, technical specification, or hosted
service announcement.

## Goal

Let a person discuss a coding task on a supported web AI page from a desktop
or phone, send a compact approved brief to their own computer, and receive a
verified result from a local executor.

The local computer remains the place where code is read, changed, and tested.
The web page is a control surface, not a remote code-execution environment.

## Public work areas

### Desktop web bridge

The current browser companion remains the primary desktop integration. Future
work may also provide a userscript-based web bridge for people who prefer a
lightweight installation and for faster experiments with supported web AI
sites.

### Phone web bridge

The intended phone experience is to prepare and approve a task on a supported
mobile web page, then view task status and evidence there. Phone support does
not mean that a phone directly executes local engineering commands.

### Device connection choices

Users should be able to choose an appropriate connection mode:

- local-network connection for devices on the same trusted network;
- a managed relay for a low-configuration experience;
- a self-hosted compatible relay for users who need to control their own
  deployment.

Availability, supported platforms, and operational limits will be announced
only after each mode has been tested.

### Supported web AI sites

Site support should grow through small, independently testable adapters. The
first candidates are ChatGPT and DeepSeek web pages. Other sites are evaluated
by whether they can provide a clear user-approved brief and display a compact
result safely.

### Executor choice

The control plane stays executor-neutral. Users can select a ready local
executor such as OpenCode, Codex, Claude Code, or a configured compatible
model endpoint. A web AI page never grants an executor permissions beyond the
local ACP policy.

## What is intentionally not specified here

This public roadmap does not disclose authentication implementation details,
device pairing secrets, relay topology, abuse controls, infrastructure
providers, operational procedures, pricing, or unreleased security work.

## Give feedback

Use [GitHub Discussions](https://github.com/Ya-KARAS/AgentControlPlane/discussions)
for product questions and early ideas. Use a
[Feature request](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=feature_request.yml)
when you can describe an expected behavior and acceptance criteria. Report
reproducible problems with the
[Bug report form](https://github.com/Ya-KARAS/AgentControlPlane/issues/new?template=bug_report.yml).

Do not post credentials, access tokens, private logs, local paths, or security
details in public discussions or issues.
