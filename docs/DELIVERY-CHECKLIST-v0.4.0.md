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

- 分支：`main`
- 领先：`ahead 25`（相对 `origin/main`）
- 头提交：`3ab39a1`
- 本地未提交改动：无

## 最后发布动作（当前环境限制）

- 已尝试（当前环境）：
  - `git push origin main`（失败：`Failed to connect to github.com:443`）
  - `git push origin --tags`（失败：`Failed to connect to github.com:443`）
- 在 GitHub 创建 `v0.4.0` Release（可复用 `RELEASE-DRAFT-v0.4.0.md`）

> 备注：`git push` 当前会话环境无法访问 `github.com:443`，外部发布动作需要在你可联网/可认证环境执行。



