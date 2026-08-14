# AgentControlPlane

[English](../../../README.md) | **简体中文** | [繁體中文](../zh-TW/README.md) | [Français](../fr/README.md) | [Español](../es/README.md) | [日本語](../ja/README.md)

> 面向单用户评估的实验性、本地优先软件。

AgentControlPlane 将支持 MCP 的网页 AI 与用户电脑上的可替换工程执行 Agent 连接起来。用户只需要在网页 AI 中完成一次需求沟通和澄清；控制平面会把最终需求压缩成结构化工程 Brief，保存任务状态，收集执行证据，并把结果返回网页 AI，从而避免在网页 AI 与 Coding Agent 之间反复手工复制粘贴上下文。

本地 AgentControlPlane 核心基于 [Apache License 2.0](../../../LICENSE) 开源。托管 Relay、托管服务、品牌版本和企业运维可以作为独立产品提供。

## 为什么需要它

网页 AI 与 Coding Agent 之间的手工交接通常会重复传递上下文，也容易在二次整理 Prompt 时产生偏差。AgentControlPlane 把这条反馈链变成机器可读流程：

```text
网页 AI -> 精简工程 Brief -> AgentControlPlane -> 本地 Executor
网页 AI <- 结果/证据/状态 <- Task Store <- 本地 Executor
```

它不会把网页聊天额度转换为工程执行额度，也不会绕过任何 Provider 的使用限制。被选中的 Executor 仍然使用它自己的账号、订阅或 API 配置。

## 支持的层

北向接口使用标准 MCP，不绑定某一个模型。当前已经完整记录 ChatGPT 自定义连接方式；其他支持 MCP 的网页 AI 也可以使用同一组工具。

当前本地 Executor 包括：

- OpenCode CLI
- Codex App Server
- Claude Code CLI
- OpenAI-Compatible 本地接口，包括 OpenCodex
- 通过 OpenAI-Compatible Adapter 使用 DeepSeek

Claude Code 为可选 Executor。仅安装 CLI 还不够；只有登录 Claude Pro/Max，或为 CLI 配置 Anthropic API Key 后，Adapter 才会处于可用状态。否则 Discovery 会返回 `not_authenticated`，自动路由会跳过它。

启动时，`executor.provider: "auto"` 会发现已安装或已配置的执行后端，并从 `executor.routing.order` 中选择第一个可用项。每个任务也可以显式指定 `executor: "opencode"`、`"codex"`、`"claude"`、`"openai-compatible"` 或 `"deepseek"`。

同一个 Workspace 会为不同 Executor 分别保存独立工程 Thread，因此 Codex、OpenCode、Claude Code 不会误用彼此的 Session。网页 AI 还可以把一个 Executor 已完成的工程结果交接给另一个 Executor，只传递必要的结构化证据，而不是重新发送整个网页对话。

## 快速开始

要求：Node.js 22 或更高版本，以及至少一个支持的本地 Executor。

```powershell
git clone https://github.com/Ya-KARAS/AgentControlPlane.git
cd AgentControlPlane
npm.cmd install
npm.cmd test
npm.cmd run doctor
npm.cmd start
```

服务默认监听 `http://127.0.0.1:4318`。`npm.cmd run doctor` 会列出所有已发现 Executor 和自动选择的默认 Executor。只要检测到已经安装的 CLI 或已经配置好的本地 Endpoint，用户无需手工选择 Executor。

连接 ChatGPT 请参考 [CHATGPT-CONNECTION.md](../../CHATGPT-CONNECTION.md)。不同网页 AI 可能仍需要一次性的 Connector、权限或 Tunnel 配置；这些账号级设置不能由本地服务自动完成。

## 派发示例

可以直接对已经连接的网页 AI 说：

```text
使用 balanced 配置并自动选择 Executor。检查项目，实现并测试 GET /hello，
完成验证后返回修改文件和测试证据。如果执行结果显示阻塞、误解或未完成，
自动修正工程 Brief 并继续同一项目。如果需要独立复核，再把完成结果交给
另一个 Executor 做 Review 或验证。
```

网页 AI 会调用 `dispatch_project`，通过 `task_status` 查询状态；同一 Executor 的修正使用 `continue_project`，需要切换 Executor 做 Review、验证或继续开发时使用 `handoff_project`。

## 执行配置与 Token

| Profile | 适用场景 | 推理强度 | 子 Agent | 默认预算 |
|---|---|---|---:|---:|
| economy | 小型、明确修改 | low | 0 | 30k |
| balanced | 常规 Feature / Fix | high | 最多 2 | 90k |
| deep | 架构、大范围重构、复杂调试 | ultra | 最多 4 | 220k |

Profile 是默认执行策略。任务仍然可以显式覆盖模型、推理强度、子 Agent 数量和 Token Budget。只有在目标 Executor 支持时才会传递模型字段；OpenCode 和 Claude Code 默认使用自身配置的模型。Token 统计精度取决于各 Executor 暴露的 Telemetry。

受控模式与直接执行的 Token 对比方法见 [BENCHMARKING.md](../../BENCHMARKING.md)。

## MCP 工具

- `dispatch_project` — 使用自动或指定 Executor 派发精简工程 Brief
- `dispatch_opencode` — OpenCode 兼容快捷入口
- `task_status` — 获取任务状态、结果、证据、Usage 和可选事件
- `continue_project` — 在同一个 Executor Thread 中修正或继续任务
- `handoff_project` — 将精简工程证据交给另一个 Executor 做 Review 或继续执行
- `cancel_task` — 停止排队或运行中的任务
- `list_tasks` — 查看最近任务
- `list_executors` — 查看 Executor Discovery、可用状态、能力和默认路由
- `list_profiles` — 查看执行策略
- `list_models` — 查看某个 Executor 的缓存模型目录
- `usage_report` — 汇总已测量的工程 Token 使用量

## 默认安全策略

- Workspace 必须位于配置好的 Allowlist Root 内。
- HTTP 服务拒绝绑定到非 Loopback 地址。
- Codex 默认使用 workspace-write，网络关闭，并在 Windows 上执行 Sandbox Readiness 检查。
- 其他 CLI 与 OpenAI-Compatible Adapter 使用当前本地用户权限，只应在可信 Workspace 中运行。
- 可通过 `AGENT_CONTROL_TOKEN` 启用 Bearer Token 认证。
- Task State 与 Append-only Audit Log 保存在项目 Workspace 之外。

不要把本地服务直接暴露到公网。远程访问应使用经过认证的私有 Tunnel，或独立加固的 Hosted Relay。

## 文档

- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [PROTOCOL.md](../../PROTOCOL.md)
- [CHATGPT-CONNECTION.md](../../CHATGPT-CONNECTION.md)
- [BENCHMARKING.md](../../BENCHMARKING.md)
- [SECURITY-REVIEW.md](../../SECURITY-REVIEW.md)
- [COMMERCIALIZATION.md](../../COMMERCIALIZATION.md)
- [SECURITY.md](../../../SECURITY.md)
- [CHANGELOG.md](../../../CHANGELOG.md)

默认 Workspace Allowlist 为当前仓库的父目录。针对不同机器的本地配置请使用 `AGENT_CONTROL_CONFIG`，不要把本机路径、Token 或凭据提交到仓库。