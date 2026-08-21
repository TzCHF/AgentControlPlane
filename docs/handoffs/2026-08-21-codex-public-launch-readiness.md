# DEVELOPMENT HANDOFF — Public launch readiness (2026-08-21)

DEVELOPMENT HANDOFF

Task:
Prepare AgentControlPlane for public discovery and reproducible first use with a
focused repository front page, social preview, contribution paths, and a live
one-command demo.

Status:
completed

Changed files:
- `README.md`
- `README.zh-CN.md`
- `docs/assets/social-preview.svg`
- `docs/assets/social-preview.png`
- `scripts/demo.js`
- `tests/demo.test.js`
- `src/server.js`
- `package.json`
- `.gitignore`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/executor_request.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `docs/GITHUB-LAUNCH-CHECKLIST.md`
- `CHANGELOG.md`

What was implemented:
- The English and Chinese README pages lead with the verified web-AI-to-local-
  executor workflow, a 1280×640 project visual, the live demo, supported
  executors, task evidence, safety limits, contribution links, and commercial
  terms.
- `npm run demo` discovers only the requested executor when possible, prefers
  OpenCode in automatic mode, confirms quota use, creates an isolated workspace,
  dispatches through MCP, verifies `hello.txt`, reports usage, and preserves the
  workspace for inspection.
- `createApplication` accepts an explicit executor map and default provider for
  focused local applications such as the demo.
- The repository includes contribution guidance, a conduct policy, structured
  bug and executor request forms, pull request checks, and a launch checklist.
- Social Preview source and PNG are committed as reproducible assets.

What remains:
- Upload `docs/assets/social-preview.png` through GitHub repository settings.
- Set the repository description and topics, enable Discussions, and create the
  launch categories.
- Create five scoped `good first issue` entries from the next roadmap slice.
- Package and publish v0.9 after the release archive and browser companion ZIP
  pass the release checklist.
- Record a 90-second screen capture of the live demo for launch posts.

Tests run:
- `node --test tests/demo.test.js tests/server-security.test.js` — PASS, 10/10
- Live `npm run demo -- --executor opencode --model opencode/mimo-v2.5-free --yes` — PASS
- `npm run verify` — PASS, 210/210
- `copy_lint.py` on changed user-facing prose — PASS, 0 findings
- `git diff --check` — PASS

Build:
PASS

Known issues:
- OpenCode requires access to its user configuration directory. Running the live
  demo inside the Codex filesystem sandbox produces an `EEXIST` startup error;
  the same command in the user's normal shell and the approved external test
  completes successfully.
- The live demo reported 10,148 tokens for its minimal OpenCode task. The output
  reports this value so users can evaluate the configured model before broader
  use.
- Automatic reroute remains disabled by default.

Decisions made:
- The demo performs a real MCP task and asks for quota confirmation.
- Explicit demo executor selection limits discovery and model catalog work to
  the selected executor. Automatic selection probes OpenCode first.
- The public README keeps account, provider, quota, safety, license, and
  commercial-use limits visible in dedicated sections.
- Repository metadata and release publication follow the committed launch
  checklist.

Do not change:
- User-owned `config/default.json` and `config/local.json`
- User-owned untracked `.mjs` scratch files
- API keys, relay keys, credentials, and other key material

Recommended next action:
- Merge the public-readiness pull request, verify the rendered README, upload the
  Social Preview PNG, then prepare the v0.9 release assets and recording.

Git:
branch: `feat/public-launch-readiness`
commit: pending
working tree: public-readiness changes plus the preserved user-owned config and
scratch files

Blockers:
- none for the repository changes
