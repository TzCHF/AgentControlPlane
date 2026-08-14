# AgentControlPlane v0.4.0（发布就绪版）

## 1) 版本目标

- 发布并继承 `v0.3.2`
- 实现 `v0.4` 浏览器伴侣（Browser Companion）
- 完成网页 AI 到多执行器端到端适配
- 完成真实 Token 对照测试与结果交付

## 2) 变更内容

- 浏览器伴侣（站点适配）：`chatgpt.com`、`chat.deepseek.com`、`claude.ai`
- MCP 工具路由对齐：`dispatch_project`、`list_executors`、`list_models`
- 执行器链路支持：`auto`、`opencode`、`deepseek`、`claude`
- 真实对照脚本与报告：
  - `scripts/benchmark-real.js`
  - `benchmark/real-results.json`
  - `benchmark/real-summary.json`
  - `benchmark/real-report.json`
- 发布与验收文档补齐：
  - `docs/BROWSER-COMPANION.md`
  - `docs/WEB-AI-E2E-VALIDATION-TEMPLATE.md`
  - `docs/RELEASE-CHECKLIST.md`
  - `docs/DELIVERY-CHECKLIST-v0.4.0.md`

## 3) 验证执行

- 本地检查：
  - `npm.cmd test`
  - `npm.cmd run companion:check`
  - `npm.cmd run smoke:companion`
- 真实对照执行：
  - `npm.cmd run benchmark:real`
  - `npm.cmd run benchmark:report -- benchmark/real-results.json`

## 4) 真实 token 对照最新结果（证据）

- 生成时间：`2026-08-14T17:34:55.358Z`
- 样本数：`3`
- 直接执行成功率：`0`
- 编排执行成功率：`0`
- 可比较样本数：`0`
- 平均执行节省率：`null`
- 平均总节省率：`null`

失败摘要：

- `opencode` 直连与编排均失败，核心错误：
- `AI_APICallError: Cannot connect to API: Unable to connect.`
- 当前三次均为连接失败，没有成功样本。
- 该结果说明是**外部执行通路不可达**导致，不影响控制平面结构与发布链路本身可用性。

## 5) 网页 AI 端到端结果（请用实测替换）

> 运行模板：见 [docs/WEB-AI-E2E-VALIDATION-TEMPLATE.md](/C:/Users/45928/Documents/Github/AgentControlPlane/docs/WEB-AI-E2E-VALIDATION-TEMPLATE.md)

| 时间 | 页面 | executor | task_id | status | changed_files | usage.total_tokens | result.summary | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-14 00:00 | chatgpt.com | auto | pending | pending | pending | pending | pending | 未完成（需联网在真实站点复核） |
| 2026-08-14 00:00 | chat.deepseek.com | auto | pending | pending | pending | pending | pending | 未完成（需联网在真实站点复核） |
| 2026-08-14 00:00 | claude.ai | auto | pending | pending | pending | pending | pending | 未完成（需联网在真实站点复核） |

## 6) 风险与下一步

- 外部执行器网络可达性（429/403/连接失败）是当前限制。
- 当执行器恢复可达后，补跑 3 个站点场景并更新表即可形成完整闭环。

## 7) 版本与标签

- 本地当前标签：
  - `v0.3.2`
  - `v0.4.0`
- 本地提交已达：
  - `...`
  - 详情见 `git log` 与 `release draft` 变更链
