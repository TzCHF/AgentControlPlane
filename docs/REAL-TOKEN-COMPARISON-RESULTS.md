# 真实 Token 对照验证报告（v0.4.0）

## 验证目标

- 比较同一任务在网页端直接执行（direct）与 ACP 编排执行（controlled）下的
  token 使用与成功率。
- 覆盖 `executor=opencode`，以验证“网页 AI + ACP + 执行器”闭环下的真实开销。

## 验证命令

```powershell
npm.cmd run benchmark:real
npm.cmd run benchmark:report -- benchmark/real-results.json
```

## 结果文件

- `benchmark/real-results.json`
- `benchmark/real-summary.json`（由上述报告内容规整化）

## 最新一次结果摘要

日期：`2026-08-14T16:57:47.225Z`

- 执行 executor：`opencode`
- case 数：`3`
- 直接路径成功率：`0`
- 编排路径成功率：`0`
- 可比较样本数：`0`
- 平均节省率：`null`（无可比较成功样本）

## 失败原因（关键）

`opencode` 任务在 direct 阶段均失败，失败日志显示：

1. `AI_APICallError: Cannot connect to API: Unable to connect.`
2. `background dependency install failed`（如 `npm` 插件仓库 `ECONNREFUSED`）

结论：在当前运行环境中，真实 token 对照无法形成有效样本；验证链路本身（任务调度、结果记录）已通过，但执行器端 API 通路不通。

## 结论

- 网页 AI 到 ACP 到执行器的端到端调度逻辑已在本地完成并可执行；
- 但“真实 token 对比”尚不能产出成功样本，待 `opencode` 可稳定联网/插件依赖正常后可立即重跑得到有效对比。
