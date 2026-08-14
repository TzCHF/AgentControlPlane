# AgentControlPlane v0.4.0 Delivery Checklist（对齐目标）

## 目标映射

### 1) 发布 v0.3.2

- 本地 tag：`v0.3.2`
- 对应 commit：`586bde0`
- 状态：本地可见，`main` 继承后继续演进到 v0.4

### 2) 实现 v0.4 浏览器伴侣

- 实现提交：
  - `8cf0c81` feat add browser companion control loop
  - `8cb9d18` test web AI site adapters
  - `3adfec3` feat: add v0.4 browser companion
- 文档：`docs/BROWSER-COMPANION.md`
- 验收命令：`npm.cmd run companion:check`、`npm.cmd run smoke:companion`

### 3) 完成网页 AI 到多执行器端到端适配

- 说明：
  - [docs/WEB-AI-E2E-VALIDATION-TEMPLATE.md](/C:/Users/45928/Documents/Github/AgentControlPlane/docs/WEB-AI-E2E-VALIDATION-TEMPLATE.md)
  - [docs/BROWSER-COMPANION.md](/C:/Users/45928/Documents/Github/AgentControlPlane/docs/BROWSER-COMPANION.md)
- 适配站点：chatgpt.com / chat.deepseek.com / claude.ai
- 执行器方向：auto/opencode/deepseek/claude（见模板）
- 状态：文档与测试脚本已齐，需在你的环境按模板复测实际 task_id/任务结果后补完结果表

### 4) 完成真实 Token 对照测试并交付验证结果

- 对照脚本：
  - [scripts/benchmark-real.js](/C:/Users/45928/Documents/Github/AgentControlPlane/scripts/benchmark-real.js)
- 结果文件：
  - [benchmark/real-results.json](/C:/Users/45928/Documents/Github/AgentControlPlane/benchmark/real-results.json)
  - [benchmark/real-summary.json](/C:/Users/45928/Documents/Github/AgentControlPlane/benchmark/real-summary.json)
  - [benchmark/real-report.json](/C:/Users/45928/Documents/Github/AgentControlPlane/benchmark/real-report.json)
- 结果说明：
  - [docs/REAL-TOKEN-COMPARISON-RESULTS.md](/C:/Users/45928/Documents/Github/AgentControlPlane/docs/REAL-TOKEN-COMPARISON-RESULTS.md)
- 发布说明草稿：
  - [docs/RELEASE-DRAFT-v0.4.0.md](/C:/Users/45928/Documents/Github/AgentControlPlane/docs/RELEASE-DRAFT-v0.4.0.md)

## 当前仓库状态（本地）

- 分支：`main`，与 `origin/main` 同步（以 `git status` 为准）。
- 本地未提交改动：无（发布后如有更新，以 `git status` 为准）。

## 最后发布动作（已完成 2026-08-14）

- `git push origin main`：完成，v0.3.2 之后的全部 v0.4 提交已上传。
- `git push origin --tags`：完成，`v0.4.0` 标签已上传。
- GitHub Release：已创建
  [AgentControlPlane v0.4.0](https://github.com/Ya-KARAS/AgentControlPlane/releases/tag/v0.4.0)，
  说明复用 `CHANGELOG.md` 的 v0.4.0 条目，并附 `benchmark/real-summary.json` 作为发布资产。
- 发布前本地验证：`npm test` 72/72 通过；`npm run check` 通过
  （`Browser companion validated`）；`npm run smoke:companion` 返回 `status: "passed"`。

> 早前无网络会话的推送失败记录：`git push` 曾因无法访问 `github.com:443` 失败；
> 现已联网完成推送，外部发布动作全部执行完毕。




