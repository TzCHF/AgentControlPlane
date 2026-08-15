# AgentControlPlane 发布与验收清单

## 现在仓库状态（本地）

- 分支：`main`（路径 `C:\Users\YOUR_USER\Documents\Github\AgentControlPlane`）
- 本地领先 origin/main 的提交数：请以你的本地 git log 为准。
- 关键提交：
  - `586bde0`（`v0.3.2`）
  - `3adfec3`（`v0.4.0`）
  - `1356880`（新增真实对照脚本与结果产物）
  - `7e6f3da`（更新真实对照结果文件）
  - `778047b`（记录真实对照说明并更新 Changelog）
  - `bb4e5be`（smoke 脚本在执行器不可用时返回 partial）
  - `31a9b21`（补充发布清单）

## 本地预检

执行：

```powershell
cd C:\Users\YOUR_USER\Documents\Github\AgentControlPlane
npm.cmd test
npm.cmd run check
npm.cmd run smoke:companion
npm.cmd run benchmark:real
npm.cmd run benchmark:report -- benchmark/real-results.json
```

预期：

- `test`：通过（72/72）
- `check`：`Browser companion validated`
- `smoke:companion`：`status: "passed"`
- `benchmark:real`：写入 `benchmark/real-results.json` 并同步刷新 `benchmark/real-summary.json`、`benchmark/real-report.json`
- `benchmark:report`：基于结果文件生成一致摘要

## 已经生成的发布材料

- `benchmark/real-results.json`
- `benchmark/real-report.json`
- `benchmark/real-summary.json`
- `docs/REAL-TOKEN-COMPARISON-RESULTS.md`
- `scripts/benchmark-real.js`
- `scripts/smoke.js`（包含 `smoke_execution_status`，可在环境受限时给出 `partial`）
- `CHANGELOG.md`（v0.4.0 与真实对照说明已补充）

## 发布动作（已完成 2026-08-14）

- `git push origin main`：完成，`origin/main` 与本地 `main` 同步，v0.4 全部提交已上传。
- `git push origin --tags`：完成，`v0.4.0` 标签已上传。
- GitHub Release：已创建
  [AgentControlPlane v0.4.0](https://github.com/Ya-KARAS/AgentControlPlane/releases/tag/v0.4.0)，
  说明取自 `CHANGELOG.md` 的 v0.4.0 条目，并附 `benchmark/real-summary.json` 作为发布资产。
- 发布前本地验证：`npm test` 72/72 通过；`npm run check` 通过
  （`Browser companion validated`）；`npm run smoke:companion` 返回 `status: "passed"`。

## v0.3.2 状态

- `v0.3.2` 已有本地 tag 且对应提交 `586bde0`。
- 现有 `main` 工作在该基础上继续到 `v0.4.0`。



