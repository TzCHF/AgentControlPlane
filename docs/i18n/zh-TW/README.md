# AgentControlPlane

[English](../../../README.md) | [简体中文](../zh-CN/README.md) | **繁體中文** | [Français](../fr/README.md) | [Español](../es/README.md) | [日本語](../ja/README.md)

> 面向單一使用者評估的實驗性、本地優先軟體。

AgentControlPlane 將支援 MCP 的網頁 AI 與使用者電腦上的可替換工程執行 Agent 連接起來。使用者只需在網頁 AI 中完成一次需求討論與澄清；控制平面會把最終需求壓縮成結構化 Engineering Brief，保存任務狀態、收集執行證據，並把結果回傳給網頁 AI，避免在網頁 AI 與 Coding Agent 之間反覆手動複製貼上上下文。

本地 AgentControlPlane 核心依 [Apache License 2.0](../../../LICENSE) 開源。Hosted Relay、託管服務、品牌版本與企業營運可以作為獨立產品提供。

## 為什麼需要它

網頁 AI 與 Coding Agent 之間的手動交接通常會重複傳遞上下文，也容易在重新整理 Prompt 時產生偏差。AgentControlPlane 將這條回饋鏈變成機器可讀流程：

```text
網頁 AI -> 精簡 Engineering Brief -> AgentControlPlane -> 本地 Executor
網頁 AI <- 結果/證據/狀態 <- Task Store <- 本地 Executor
```

它不會把網頁聊天額度轉換成工程執行額度，也不會繞過 Provider 限制。被選中的 Executor 仍使用自己的帳號、訂閱或 API 設定。

## 支援範圍

北向介面使用標準 MCP，不綁定單一模型。現在已完整記錄 ChatGPT 自訂連線方式；其他支援 MCP 的網頁 AI 也可以使用同一組工具。

目前本地 Executor 包含：

- OpenCode CLI
- Codex App Server
- Claude Code CLI
- OpenAI-Compatible 本地端點，包括 OpenCodex
- 透過 OpenAI-Compatible Adapter 使用 DeepSeek

Claude Code 為可選 Executor。僅安裝 CLI 還不夠；必須登入 Claude Pro/Max，或為 CLI 設定 Anthropic API Key，Adapter 才會可用。否則 Discovery 會回傳 `not_authenticated`，自動路由會跳過它。

啟動時，`executor.provider: "auto"` 會探索已安裝或已設定的執行後端，並從 `executor.routing.order` 中選擇第一個可用項目。每個任務也可以明確指定 `executor: "opencode"`、`"codex"`、`"claude"`、`"openai-compatible"` 或 `"deepseek"`。

同一個 Workspace 會為不同 Executor 分別保存獨立工程 Thread，因此 Codex、OpenCode、Claude Code 不會誤用彼此的 Session。網頁 AI 也可以把某個 Executor 已完成的結果交接給另一個 Executor，只傳遞必要的結構化證據，而不是重新傳送整段網頁對話。

## 快速開始

需求：Node.js 22 或更高版本，以及至少一個受支援的本地 Executor。

```powershell
git clone https://github.com/Ya-KARAS/AgentControlPlane.git
cd AgentControlPlane
npm.cmd install
npm.cmd test
npm.cmd run doctor
npm.cmd start
```

服務預設監聽 `http://127.0.0.1:4318`。`npm.cmd run doctor` 會列出所有已發現 Executor 與自動選定的預設 Executor。只要偵測到已安裝 CLI 或已設定本地 Endpoint，使用者無需手動選擇 Executor。

連接 ChatGPT 請參考 [CHATGPT-CONNECTION.md](../../CHATGPT-CONNECTION.md)。不同網頁 AI 仍可能需要一次性的 Connector、權限或 Tunnel 設定；這些帳號層級操作無法由本地服務自動完成。

## 派發範例

可以直接對已連接的網頁 AI 說：

```text
使用 balanced 設定並自動選擇 Executor。檢查專案，實作並測試 GET /hello，
驗證後回傳修改檔案與測試證據。如果執行結果顯示阻塞、誤解或未完成，
自動修正 Engineering Brief 並繼續同一專案。如果需要獨立複核，再把完成
結果交給另一個 Executor 做 Review 或驗證。
```

網頁 AI 會呼叫 `dispatch_project`，透過 `task_status` 查詢狀態；同一 Executor 的修正使用 `continue_project`，切換 Executor 做 Review、驗證或後續工程工作時使用 `handoff_project`。

## 執行設定與 Token

| Profile | 適用情境 | 推理強度 | 子 Agent | 預設預算 |
|---|---|---|---:|---:|
| economy | 小型、明確修改 | low | 0 | 30k |
| balanced | 一般 Feature / Fix | high | 最多 2 | 90k |
| deep | 架構、大型重構、複雜除錯 | ultra | 最多 4 | 220k |

Profile 是預設執行策略。任務仍可明確覆寫模型、推理強度、子 Agent 數量與 Token Budget。只有在目標 Executor 支援時才會傳遞模型欄位；OpenCode 與 Claude Code 預設使用自身設定的模型。Token 統計精度取決於各 Executor 提供的 Telemetry。

受控模式與直接執行的 Token 比較方法見 [BENCHMARKING.md](../../BENCHMARKING.md)。

## MCP 工具

- `dispatch_project` — 使用自動或指定 Executor 派發精簡工程 Brief
- `dispatch_opencode` — OpenCode 相容快捷入口
- `task_status` — 取得任務狀態、結果、證據、Usage 與可選事件
- `continue_project` — 在同一個 Executor Thread 中修正或繼續任務
- `handoff_project` — 將精簡工程證據交給另一個 Executor 做 Review 或後續執行
- `cancel_task` — 停止排隊或執行中的任務
- `list_tasks` — 查看最近任務
- `list_executors` — 查看 Executor Discovery、可用狀態、能力與預設路由
- `list_profiles` — 查看執行策略
- `list_models` — 查看某 Executor 的快取模型清單
- `usage_report` — 彙總已測量的工程 Token 使用量

## 預設安全策略

- Workspace 必須位於設定好的 Allowlist Root 內。
- HTTP 服務拒絕綁定到非 Loopback 位址。
- Codex 預設使用 workspace-write、關閉網路，並在 Windows 上檢查 Sandbox Readiness。
- 其他 CLI 與 OpenAI-Compatible Adapter 使用目前本地使用者權限，只應在可信 Workspace 執行。
- 可透過 `AGENT_CONTROL_TOKEN` 啟用 Bearer Token 驗證。
- Task State 與 Append-only Audit Log 保存在專案 Workspace 之外。

不要把本地服務直接暴露到公網。遠端使用應透過已驗證的私有 Tunnel，或獨立加固的 Hosted Relay。

## 文件

- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [PROTOCOL.md](../../PROTOCOL.md)
- [CHATGPT-CONNECTION.md](../../CHATGPT-CONNECTION.md)
- [BENCHMARKING.md](../../BENCHMARKING.md)
- [SECURITY-REVIEW.md](../../SECURITY-REVIEW.md)
- [COMMERCIALIZATION.md](../../COMMERCIALIZATION.md)
- [SECURITY.md](../../../SECURITY.md)
- [CHANGELOG.md](../../../CHANGELOG.md)

預設 Workspace Allowlist 是目前倉庫的父目錄。針對不同機器的本地設定請使用 `AGENT_CONTROL_CONFIG`，不要把本機路徑、Token 或憑證提交到倉庫。