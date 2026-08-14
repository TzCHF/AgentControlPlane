# AgentControlPlane 发布与验收清单

## 现在仓库状态（本地）

- 分支：`main`（路径 `C:\Users\45928\Documents\Github\AgentControlPlane`）
- 本地领先 `origin/main` 的提交数：`26`
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
cd C:\Users\45928\Documents\Github\AgentControlPlane
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

## 需要联网后执行的发布动作

```powershell
cd C:\Users\45928\Documents\Github\AgentControlPlane
git push origin main
git push origin --tags
```

然后在 GitHub 创建 Release（建议）：

1. Tag：`v0.4.0`（或 `v0.4.1` 递增新版本）
2. 标题：`AgentControlPlane v0.4.0`
3. 说明：使用 `CHANGELOG.md` 中 v0.4.0 条目 + `docs/REAL-TOKEN-COMPARISON-RESULTS.md`
4. 附加说明：`benchmark/real-summary.json`

## v0.3.2 状态

- `v0.3.2` 已有本地 tag 且对应提交 `586bde0`。
- 现有 `main` 工作在该基础上继续到 `v0.4.0`。



