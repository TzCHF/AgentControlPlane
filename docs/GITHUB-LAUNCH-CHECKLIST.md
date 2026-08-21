# GitHub launch checklist

This checklist prepares a public AgentControlPlane release for reproducible
testing and community feedback.

## Repository metadata

- Description: `Web AI to local coding agents: MCP dispatch, executor routing, persisted evidence, usage, and cross-executor continuation.`
- Website: use the public documentation or release page available at launch.
- Topics: `ai-agents`, `coding-agent`, `mcp`, `opencode`, `codex`,
  `claude-code`, `local-first`, `developer-tools`, `automation`, `self-hosted`,
  `typescript`, `windows`.
- Social Preview: upload `docs/assets/social-preview.png` in repository
  Settings → General → Social preview.
- Discussions: enable the repository feature and create `Q&A`, `Show and tell`,
  `Executor adapters`, and `Roadmap` categories.

## Release evidence

- `npm run verify` passes from a clean clone.
- `npm run demo` completes through a documented executor and preserves the demo
  workspace for inspection.
- The Release contains a Windows source/install archive, browser companion ZIP,
  SHA256 values, release notes, and known limits.
- The 90-second recording shows the command, task id, executor, generated file,
  terminal status, and verification result.
- Benchmark claims link to committed input cases, raw results, and the report
  generator.

## Community readiness

- Bug and executor request forms render correctly.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and the pull request
  template are visible from the repository Community Profile.
- Five scoped `good first issue` entries include file locations and acceptance
  criteria.
- A pinned Discussion explains the public test, supported routes, and feedback
  format.

## Publication sequence

1. Publish the tagged GitHub Release and verify every attached asset.
2. Run the documented demo from the release archive.
3. Publish the demonstration and benchmark from the maintainer account.
4. Record referral traffic, clones, completed demos, issues, discussions, and
   external contributors each week.
