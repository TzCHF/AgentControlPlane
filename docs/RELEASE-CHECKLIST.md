# AgentControlPlane 发布与验收清单

## 当前仓库状态（本地）

- 分支：`main`（基于本地 `C:\Users\45928\Documents\Github\AgentControlPlane`）
- 本地领先 `origin/main` 的提交数：`7`
- 关键提交序列：
  - `586bde0`（`v0.3.2`）
  - `3adfec3`（`v0.4.0`）
  - `1356880`（新增真实对照脚本与结果文件）
  - `778047b`（记录真实对照结果说明与 Changelog 更新）
  - `bb4e5be`（修正 smoke，在执行器不可用时返回 partial）

## 预检（本地）

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
- `benchmark`：输出 `benchmark/real-results.json`，当前环境可见 `direct_success_rate`、`controlled_success_rate`

## 发布材料（本地已生成）

- `benchmark/real-results.json`
- `benchmark/real-report.json`
- `benchmark/real-summary.json`
- `docs/REAL-TOKEN-COMPARISON-RESULTS.md`
- `scripts/benchmark-real.js`
- `scripts/smoke.js`（已支持环境不可用时返回 `smoke_execution_status`）
- `CHANGELOG.md`（已补充 v0.4 说明）

## 需要联网执行的发布步骤（你一旦有外网就可直接跑）

```powershell
cd C:\Users\45928\Documents\Github\AgentControlPlane
git push origin main
git push origin --tags
```

然后在 GitHub 仓库页面创建 Release：

1. Tag：`v0.4.0`（如已存在可直接改为 `v0.4.1`）
2. 标题：`AgentControlPlane v0.4.0`
3. 发布说明：按 `CHANGELOG.md` v0.4.0 与 `docs/REAL-TOKEN-COMPARISON-RESULTS.md` 组合
4. 可选：附加对照摘要（`benchmark/real-summary.json`）

## v0.3.2 状态

- `v0.3.2` 已有本地 tag，且对应本地提交 `586bde0`。
- 当前工作在 `main` 上继续向 `v0.4.0` 做增强。
