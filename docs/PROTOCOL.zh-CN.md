# 控制面协议

> [English](PROTOCOL.md)

## 工程简报

```json
{
  "workspace": "D:\\Projects\\example",
  "executor": "auto",
  "objective": "Add a tested GET /hello endpoint.",
  "constraints": ["Do not add a framework dependency."],
  "acceptance_criteria": [
    "GET /hello returns HTTP 200",
    "Response JSON equals {\"message\":\"hello\"}",
    "Automated tests pass"
  ],
  "context": ["The project already uses node:test."],
  "evidence_required": ["test command and result", "changed file list"],
  "profile": "balanced",
  "model": null,
  "reasoning_effort": null,
  "max_subagents": null,
  "token_budget": null
}
```

`executor` 可以是 `auto`、`opencode`、`codex`、`claude`、`openai-compatible` 或 `deepseek`。`auto` 会在任务持久化之前解析为实际的执行器，因此状态和审计记录始终显示工作实际运行在哪里。

## 紧凑结果

```json
{
  "status": "completed",
  "summary": "Implemented and tested the endpoint.",
  "changed_files": ["server.js", "server.test.js"],
  "tests": [{"command": "npm test", "status": "passed"}],
  "blockers": [],
  "next_action": null,
  "usage": {
    "input_tokens": 0,
    "cached_input_tokens": 0,
    "output_tokens": 0,
    "reasoning_output_tokens": 0,
    "total_tokens": 0
  },
  "subagents": []
}
```

Web 控制器应轮询直到出现终态。当结果为 `blocked`、`partial` 或 `failed` 时，它应使用结构化的 `blocker` 和证据来修正简报，或解释为什么需要用户输入。这就是自动反馈回路，它取代了在两个对话之间复制输出的做法。

## MCP 工具

- `dispatch_project` — 创建带 `auto` 或显式路由的异步任务。
- `dispatch_opencode` — 向后兼容的 OpenCode 快捷方式。
- `task_status` — 读取紧凑状态、结果、用量、执行器历史、最新 continuation
  package、reroute 原因和可选的最新事件。
- `continue_project` — 向同一项目发送更正或后续消息。可选的 `executor`
  会在能力门禁通过后使用另一个执行器继续；省略时保留原执行器和持久会话。
- `cancel_task` — 中断排队或进行中的工作。
- `list_tasks` — 列出最近的任务。
- `list_executors` — 检查发现结果、能力和当前默认值。
- `list_profiles` — 检查模型/预算策略。
- `list_models` — 检查一个执行器的缓存目录。
- `usage_report` — 聚合测得的工程用量。

## 跨执行器续接

每个任务都会暴露稳定的 `logical_task_id`。子续接任务继承该 id，并继续用
`parentTaskId` 表示直接父子关系。`executor_history` 只追加，记录每次获得的
执行器会话。出现允许自动切换的基础设施故障时，ACP 会保存紧凑的
`continuation` package，并可选择下一个兼容执行器。

自动 reroute 默认关闭。只有设置 `executor.reroute.enabled=true` 才启用，且受
`max_reroutes` 限制；允许原因仅包括 `quota_exhausted`、`rate_limited`、
`executor_unavailable`、`authentication_unavailable` 和
`provider_unavailable`。测试、构建、实现和验证失败不会切换执行器。没有兼容
执行器时任务进入 `blocked`，不会静默使用不兼容后端。

## Token 预算

用量测量和中断精度取决于执行器的遥测数据。Codex 暴露实时的线程目标，可以在运行期间轮询。CLI 适配器可能只在最终事件中报告累计用量，因此它们的预算也作为策略指导发送，但无法始终以相同的粒度强制执行。Provider 在两次测量之间可能会消耗额外的 token。
