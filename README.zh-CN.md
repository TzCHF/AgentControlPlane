# AgentControlPlane

<div align="center">

[![CI](https://github.com/Ya-KARAS/AgentControlPlane/actions/workflows/ci.yml/badge.svg)](https://github.com/Ya-KARAS/AgentControlPlane/actions/workflows/ci.yml)
[![version](https://img.shields.io/github/v/release/Ya-KARAS/AgentControlPlane?label=version&color=536af5)](https://github.com/Ya-KARAS/AgentControlPlane/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D22-3c873a)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-Apache--2.0-d22128)](LICENSE)

</div>

> 面向单用户评估的实验性、本地优先软件。
>
> [English](README.md)

## 目录

- [为什么存在](#为什么存在)
- [支持范围](#支持范围)
- [快速开始](#快速开始)
- [派发示例](#派发示例)
- [配置档与用量](#配置档与用量)
- [MCP 工具](#mcp-工具)
- [安全默认值](#安全默认值)
- [文档](#文档)

AgentControlPlane 把支持 MCP 的网页 AI 与用户电脑上可互换的工程执行器连接起来。网页对话只澄清一次意图；控制平面发送精简的结构化简报，保存任务状态，返回证据，并支持后续跟进，无需人工复制粘贴。

AgentControlPlane 的本地核心按 [Apache License 2.0](LICENSE) 开源。独立运营的托管中继、托管服务、品牌与企业运营可另行分发。

## 为什么存在

网页 AI 与编码执行器之间的人工交接会重复上下文并产生转述错误。AgentControlPlane 让这条反馈回路保持机器可读：

```text
网页 AI -> 精简简报 -> AgentControlPlane -> 本地执行器
网页 AI <- 结果/证据/状态 <- 任务存储 <- 本地执行器
```

它不把聊天额度转换成工程额度，也不绕过供应商的限制。每个被选中的执行器仍然使用自己的账户、订阅或 API 配置。

## 支持范围

北向接口是标准 MCP，不绑定单一模型。ChatGPT 自定义应用是当前已完整记录的连接方式；其他支持 MCP 的网页 AI 客户端可以使用同一组工具。

对于不提供自定义 MCP 连接入口的账户或网页 AI 产品，v0.4 浏览器伴侣提供本地、供应商中立的桥接。它内置 ChatGPT、DeepSeek 和 Claude 的适配器，以及可选的通用 HTTPS 聊天适配器。见 [浏览器伴侣](docs/BROWSER-COMPANION.md)。

本地执行器层当前包括：

| 执行器 | 接口 | 可用性 |
|---|---|---|
| OpenCode | CLI | 自带配置好的默认模型 |
| Codex | App Server | workspace-write 执行，网络禁用 |
| Claude Code | CLI | 可选；需要 Claude Pro/Max 登录或 Anthropic API 密钥 |
| OpenAI-compatible | 本地端点 | 包括 OpenCodex |
| DeepSeek | OpenAI-compatible 适配器 | — |

Claude Code 是可选的。仅安装其 CLI 不够：只有完成 Claude Pro/Max 账号登录、或为 CLI 配置 Anthropic API 密钥后，适配器才可用。否则发现结果报告 `not_authenticated`，自动路由会跳过它。

启动时，`executor.provider: "auto"` 发现已安装/已配置的后端，并从 `executor.routing.order` 中选择第一个可用项。任务可以用 `executor: "opencode"`、`"codex"`、`"claude"`、`"openai-compatible"` 或 `"deepseek"` 覆盖该决定。

## 快速开始

前置条件：Node.js 22 或更新版本，以及至少一个受支持的本地执行器。

```powershell
git clone https://github.com/Ya-KARAS/AgentControlPlane.git
cd AgentControlPlane
npm.cmd install
npm.cmd test
npm.cmd run doctor
npm.cmd start
```

服务绑定在 `http://127.0.0.1:4318`。`npm.cmd run doctor` 列出每个被发现的执行器和自动默认项。检测到已安装的 CLI 或已配置的本地端点时，无需手动选择执行器。

对于没有自带 MCP 连接器的网页 AI，把 [`browser-companion`](browser-companion) 作为未打包的 Manifest V3 扩展加载，在网页 AI 页面上打开 ACP 面板，并批准一次性本地配对码。该扩展永远不需要控制平面的主 bearer 令牌。

连接 ChatGPT 请按 [docs/CHATGPT-CONNECTION.md](docs/CHATGPT-CONNECTION.md) 操作。网页供应商可能仍要求一次性的连接器、权限或隧道设置；这类账户级设置无法由本地服务代完成。

## 派发示例

对已连接的网页 AI 说：

```text
Use the balanced profile and automatic executor selection. Inspect the project,
implement a tested GET /hello endpoint, verify it, and return changed files plus
test evidence. If execution reports a blocker or misunderstanding, correct the
brief and continue the same project.
```

对话会调用 `dispatch_project`，轮询 `task_status`，并在结构化结果需要修正时使用 `continue_project`。

## 配置档与用量

| 配置档 | 用途 | 投入 | 子代理 | 预算 |
|---|---|---:|---:|
| economy | 小范围、明确的修改 | low | 0 | 30k |
| balanced | 常规功能与修复工作 | high | 最多 2 | 90k |
| deep | 架构与大规模重构 | ultra | 最多 4 | 220k |

配置档是策略默认值。模型、投入、子代理和预算的显式覆盖仍然可用。模型字段只在所选执行器有意义时才传递；否则 OpenCode 与 Claude 使用各自配置的默认模型。用量精度取决于执行器的遥测。

直接执行与受控执行的 token 对照实验见 [docs/BENCHMARKING.md](docs/BENCHMARKING.md)。

## MCP 工具

| 工具 | 用途 |
|---|---|
| `dispatch_project` | 排队一份简报，支持自动或显式执行器路由 |
| `dispatch_opencode` | OpenCode 兼容性快捷方式 |
| `task_status` | 读取状态、结果、证据、用量和可选事件 |
| `continue_project` | 向同一项目发送修正或后续指令 |
| `cancel_task` | 停止排队中或执行中的工作 |
| `list_tasks` | 列出最近任务 |
| `list_executors` | 列出发现结果、就绪状态、能力和默认路由 |
| `list_profiles` | 列出执行策略 |
| `list_models` | 列出某执行器的缓存模型目录 |
| `usage_report` | 汇总已测量的工程用量 |

## 安全默认值

- 工作区必须位于配置的允许列表根目录之内。
- HTTP 服务拒绝非回环绑定。
- Codex 使用 workspace-write 且网络禁用，并在执行前验证 Windows 沙箱就绪状态。
- 其他 CLI 与 OpenAI-compatible 适配器以本地用户权限运行；只在可信工作区上使用它们。
- 可选 bearer 认证可通过 `AGENT_CONTROL_TOKEN` 启用。
- 状态与只追加审计日志保存在项目工作区之外。

不要把本地服务器直接暴露到公网。使用经认证的私有隧道或单独加固的中继。

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)（架构）
- [docs/PROTOCOL.md](docs/PROTOCOL.md)（协议）
- [docs/CHATGPT-CONNECTION.md](docs/CHATGPT-CONNECTION.md)（ChatGPT 连接）
- [docs/BENCHMARKING.md](docs/BENCHMARKING.md)（基准测试）
- [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md)（安全审查）
- [docs/COMMERCIALIZATION.md](docs/COMMERCIALIZATION.md)（商业化）
- [SECURITY.md](SECURITY.md)（安全）
- [CHANGELOG.md](CHANGELOG.md)（变更记录）

默认工作区允许列表是此仓库的父目录。用 `AGENT_CONTROL_CONFIG` 做机器特定的覆盖，且不要把本地路径或凭据提交进仓库。
