# Contributing to AgentControlPlane

AgentControlPlane accepts focused bug fixes, executor adapters, protocol tests,
documentation corrections, and reproducible compatibility reports.

## Start locally

Requirements: Node.js 22 or newer and npm.

```powershell
git clone https://github.com/Ya-KARAS/AgentControlPlane.git
cd AgentControlPlane
npm.cmd ci
npm.cmd run verify
```

`npm run verify` runs the same test and syntax checks used by CI. Tests must use
local mocks unless their command and filename identify them as live tests.

## Choose an issue

- Bugs need a minimal reproduction, operating system, ACP version, executor,
  and sanitized output.
- Executor proposals need a stable machine-readable interface, a documented
  authentication method, and capability evidence for filesystem or tool use.
- `good first issue` entries have a small scope and explicit acceptance
  criteria.

Open a Discussion for design exploration. Open an Issue once the expected
behavior and acceptance criteria are concrete.

## Prepare a pull request

1. Keep the control plane provider-neutral. Provider-specific presets belong in
   the registry as data.
2. Preserve loopback networking, workspace allowlists, compact results, usage
   accounting, and append-only audit behavior.
3. Add or update tests for behavior changes.
4. Run `npm run verify`.
5. Run `copy_lint.py` on changed user-facing prose when the grounded-copy skill
   is available.
6. Describe the changed behavior, verification commands, and known limits in
   the pull request.

Read [AGENTS.md](AGENTS.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) before
changing orchestration, executor, persistence, protocol, or security behavior.

## Security and credentials

Keep API keys, account tokens, local paths, and private logs out of commits and
issues. Follow [SECURITY.md](SECURITY.md) for private vulnerability reports.

## License

Contributions are submitted under the repository's
[GNU Affero General Public License 3.0](LICENSE).
