# AgentControlPlane v0.4.0 Release Notes (Draft)

## 概要

v0.4.0 完成了“网页 AI 到本地工程执行器”的补强体验层：  
- 新增 **Browser Companion（浏览器伴侣）**，支持在网页 AI 对话中快速将任务转给本地执行器。  
- 支持多执行器调度（`auto`/`opencode`/`deepseek`/`claude`），并能通过本地服务记录任务状态与结果。  
- 增加真实 token 对照框架与报告产物，提供“网页 AI 讨论 + 本地执行”与“直接本地执行”的对比验证链路。  

## 变更要点

- `v0.4.0`：实现 Browser Companion 核心能力与站点适配器（ChatGPT / DeepSeek / Claude）。  
- MCP 工具补充说明更新：`dispatch_project` 与执行器可见性、`list_executors`/`list_models` 说明一致化。  
- 真实对照脚本与输出：`benchmark-real.js`、`benchmark/real-results.json`、`benchmark/real-summary.json`、`benchmark/real-report.json`。  
- 真实对照结果文档：[`REAL-TOKEN-COMPARISON-RESULTS.md`](/C:/Users/45928/Documents/Github/AgentControlPlane/docs/REAL-TOKEN-COMPARISON-RESULTS.md)。  
- 烟雾链路与发布清单增强：`smoke` 可返回可归档的部分执行结果、release checklist 指南完整化。  

## 验证清单

### 1) Browser Companion 与多站点适配

1. `npm.cmd test`  
2. `npm.cmd run companion:check`  
3. `npm.cmd run smoke:companion`  

### 2) 真实 Token 对照

1. `npm.cmd run benchmark:real`  
2. `npm.cmd run benchmark:report -- benchmark/real-results.json`  

### 3) 网页 AI → 多执行器端到端

请按照 [`WEB-AI-E2E-VALIDATION-TEMPLATE.md`](/C:/Users/45928/Documents/Github/AgentControlPlane/docs/WEB-AI-E2E-VALIDATION-TEMPLATE.md) 运行：
- Web 页面：`chatgpt.com`、`chat.deepseek.com`、`claude.ai`  
- 执行器：`auto`（优先）以及所需的明确 executor 覆测  
- 记录 `task_id / status / changed_files / usage`  

## 发布文件/产物

- 变更说明：`CHANGELOG.md`（v0.4.0）  
- 真实对照：`docs/REAL-TOKEN-COMPARISON-RESULTS.md`  
- 发布执行检查：`docs/RELEASE-CHECKLIST.md`  
- 伴侣运行与验收：`docs/BROWSER-COMPANION.md`  
- 端到端模板：`docs/WEB-AI-E2E-VALIDATION-TEMPLATE.md`  

## 已验证结果（示例）

| 时间 | 页面 | executor | task_id | status | changed_files | usage | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-14 | chatgpt.com | auto | `TBD` | completed | `acp-live-test/benchmark...` | `TBD` | 示例值 |
| 2026-08-14 | chat.deepseek.com | auto | `TBD` | completed | `...` | `TBD` | 示例值 |
| 2026-08-14 | claude.ai | auto | `TBD` | completed | `...` | `TBD` | 示例值 |

> `TBD` 由你在现场执行后按实际结果替换，不得留空。

## 风险说明

- 本次 benchmark 的可复现实验依赖外部执行器可达性（如 OpenCode/DeepSeek/Claude 可访问状态）。  
- 某些执行器在当前环境可能返回 `partial` 或外部限流/联网失败，这不影响控制平面链路完整性；Release 应写入对应异常与重试记录。

## 后续建议

- 继续扩展更多站点适配器与默认安全模板（例如可选 `opencode -> codex` 迁移策略）。  
- 完善失败分类报表（含 429 / limit / 认证状态）作为持续指标。
