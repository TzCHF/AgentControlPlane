# 真实 Token 对照验证结果（v0.4.0）

## 验证目标

- 比较同一任务在“网页 AI 直接执行路径”和“ACP 编排路径（控制器 + 执行器）”下的 token 消耗与成功率。
- 覆盖执行器：`opencode`，用于验证网页 AI 到多执行器链路中的真实调度能力。

## 验证命令

```powershell
npm.cmd run benchmark:real
npm.cmd run benchmark:report -- benchmark/real-results.json
```

## 结果文件

- `benchmark/real-results.json`
- `benchmark/real-summary.json`
- `benchmark/real-report.json`（汇总结果）

## 最新一次结果（2026-08-14）

- `generated_at`: `2026-08-14T17:07:25.750Z`
- `case_count`: `3`
- 直接路径成功率：`0`
- 编排路径成功率：`0`
- 可比较样本数：`0`
- 平均执行节省率：`null`
- 平均总节省率：`null`

## 失败原因（关键）

- `opencode` 的 direct 阶段三次都失败，报错内容为：
  - `AI_APICallError: Cannot connect to API: Unable to connect.`
  - 部分运行出现 `npm registry` 侧 `ECONNREFUSED`（`@opencode-ai/plugin` 插件安装失败）

## 结论

- 本地浏览器伴侣与 ACP 派发链路本身可用（对应测试 `npm run test` 与 `npm run smoke:companion` 已通过）。
- 真实 token 对照当前未形成有效成功样本，原因是执行器网络/API 通路不可达。
- 一旦 `opencode` 执行器的 API 可达并可稳定运行，执行同一命令即可获得可对照样本。
