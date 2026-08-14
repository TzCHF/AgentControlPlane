# AgentControlPlane

[English](../../../README.md) | [简体中文](../zh-CN/README.md) | [繁體中文](../zh-TW/README.md) | [Français](../fr/README.md) | [Español](../es/README.md) | **日本語**

> 単一ユーザーでの評価を目的とした、実験的な local-first ソフトウェアです。

AgentControlPlane は、MCP 対応の Web AI と、ユーザーの PC 上で動作する交換可能な Engineering Agent を接続します。要件の整理は Web AI 側で一度だけ行い、その結果を control plane がコンパクトな構造化 Engineering Brief に変換します。タスク状態、実行証拠、結果を保持し、Web AI と Coding Agent の間で何度も手動コピー＆ペーストする必要を減らします。

ローカルの AgentControlPlane コアは [Apache License 2.0](../../../LICENSE) でオープンソース公開されています。Hosted Relay、マネージドサービス、ブランド版、エンタープライズ運用機能は別製品として提供できます。

## なぜ必要なのか

Web AI と Coding Agent の間で手動 handoff を行うと、同じコンテキストを何度も渡すことになり、要件の再解釈ミスも起こりやすくなります。AgentControlPlane はこのループを機械可読な形にします。

```text
Web AI -> compact brief -> AgentControlPlane -> local executor
Web AI <- result/evidence/status <- Task Store <- local executor
```

チャット利用枠を Engineering Agent の利用枠へ変換したり、Provider の制限を回避したりするものではありません。選択された Executor は、それぞれ自身のアカウント、サブスクリプション、API 設定を使用します。

## 対応インターフェース

Northbound インターフェースは標準 MCP を使用し、特定モデルには依存しません。現在は ChatGPT との接続方法を文書化していますが、MCP 対応の他の Web AI も同じツールを利用できます。

現在のローカル Executor：

- OpenCode CLI
- Codex App Server
- Claude Code CLI
- OpenCodex を含む OpenAI-compatible ローカル endpoint
- OpenAI-compatible adapter 経由の DeepSeek

Claude Code は任意です。CLI をインストールしただけでは有効にならず、Claude Pro/Max へのログイン、または Anthropic API Key の設定が必要です。認証されていない場合、Discovery は `not_authenticated` を返し、自動 routing ではスキップされます。

起動時に `executor.provider: "auto"` を指定すると、インストール済み／設定済み backend を検出し、`executor.routing.order` の中から最初の利用可能な Executor を選択します。タスク単位で `executor: "opencode"`、`"codex"`、`"claude"`、`"openai-compatible"`、`"deepseek"` を明示することもできます。

Persistent project thread は Executor ごとに分離されます。同じ Workspace でも Codex、OpenCode、Claude Code が独立した Session を保持できます。また、ある Executor の完了結果を別の Executor に handoff する際は、必要な構造化証拠だけを渡し、Web AI の会話全体を再送しません。

## クイックスタート

要件：Node.js 22 以上、および少なくとも 1 つの対応ローカル Executor。

```powershell
git clone https://github.com/Ya-KARAS/AgentControlPlane.git
cd AgentControlPlane
npm.cmd install
npm.cmd test
npm.cmd run doctor
npm.cmd start
```

サービスは `http://127.0.0.1:4318` で待ち受けます。`npm.cmd run doctor` で検出された Executor と自動選択されるデフォルト Executor を確認できます。

ChatGPT との接続は [CHATGPT-CONNECTION.md](../../CHATGPT-CONNECTION.md) を参照してください。他の Web AI では Connector、権限、Tunnel などの初回設定が必要になる場合があります。

## Delegation の例

接続済みの Web AI に次のように依頼できます。

```text
balanced profile と自動 Executor 選択を使用してください。プロジェクトを確認し、
GET /hello を実装・テスト・検証して、変更ファイルとテスト証拠を返してください。
ブロッカーや誤解があれば brief を修正して同じプロジェクトを継続してください。
独立したレビューが必要なら、完了結果を別の Executor に handoff してください。
```

Web AI は `dispatch_project` を呼び出し、`task_status` で状態を確認します。同じ Executor で修正を続ける場合は `continue_project`、別の Executor に Review・検証・後続作業を任せる場合は `handoff_project` を使用します。

## Profile と Usage

| Profile | 用途 | Effort | Subagents | Budget |
|---|---|---|---:|---:|
| economy | 小規模で明確な変更 | low | 0 | 30k |
| balanced | 通常の機能追加・修正 | high | 最大 2 | 90k |
| deep | アーキテクチャ、大規模 Refactor、難しい Debug | ultra | 最大 4 | 220k |

Profile はデフォルトポリシーです。タスクごとに model、effort、subagent 数、Token Budget を上書きできます。Usage の精度は各 Executor が提供する telemetry に依存します。

Controlled 実行と Direct 実行の比較方法は [BENCHMARKING.md](../../BENCHMARKING.md) を参照してください。

## MCP ツール

- `dispatch_project` — 自動または明示 routing で compact brief を送信
- `dispatch_opencode` — OpenCode 向け互換ショートカット
- `task_status` — 状態、結果、証拠、Usage、任意イベントを取得
- `continue_project` — 同じ Executor Thread で修正・継続
- `handoff_project` — compact evidence を別の Executor に渡して Review・継続
- `cancel_task` — Queue 中または実行中のタスクを停止
- `list_tasks` — 最近のタスクを一覧表示
- `list_executors` — Discovery、Readiness、Capability、デフォルト routing を表示
- `list_profiles` — 実行ポリシーを表示
- `list_models` — Executor のキャッシュ済み model catalog を表示
- `usage_report` — 計測済み Engineering Token Usage を集計

## デフォルトの安全設計

- Workspace は設定済み Allowlist Root 内に限定されます。
- HTTP サービスは非 Loopback bind を拒否します。
- Codex は workspace-write、network disabled を使用し、Windows では Sandbox Readiness を事前確認します。
- その他の CLI / OpenAI-compatible adapter はローカルユーザー権限で動作するため、信頼できる Workspace のみで使用してください。
- `AGENT_CONTROL_TOKEN` による任意の Bearer 認証を利用できます。
- Task State と append-only Audit Log は Project Workspace の外部に保存されます。

ローカルサーバーを直接インターネットへ公開しないでください。リモート利用には認証済み Private Tunnel または別途強化された Hosted Relay を使用してください。

## ドキュメント

- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [PROTOCOL.md](../../PROTOCOL.md)
- [CHATGPT-CONNECTION.md](../../CHATGPT-CONNECTION.md)
- [BENCHMARKING.md](../../BENCHMARKING.md)
- [SECURITY-REVIEW.md](../../SECURITY-REVIEW.md)
- [COMMERCIALIZATION.md](../../COMMERCIALIZATION.md)
- [SECURITY.md](../../../SECURITY.md)
- [CHANGELOG.md](../../../CHANGELOG.md)

デフォルトの Workspace Allowlist はこのリポジトリの親ディレクトリです。マシン固有設定には `AGENT_CONTROL_CONFIG` を使用し、ローカルパスや認証情報をコミットしないでください。