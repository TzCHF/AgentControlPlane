# AI 中转站集成

> [English](AI-RELAY-INTEGRATION.md)

AgentControlPlane 与 OpenAI-compatible 的 AI API 中转站配对：中转站提供模型供应链，控制面提供 agent 循环、网页 AI 委派、任务状态与逐任务的 token 用量记账。

## 两者如何相辅相成

```text
网页 AI（ChatGPT / DeepSeek ...）
        |
        v  <ACP_TASK> 信封
AgentControlPlane
        |  openai-compatible 执行器（ACP agent 循环）
        v  OpenAI-compatible /v1 请求
AI 中转站 -> 上游模型（DeepSeek、GLM、OpenAI ...）
```

中转站提供模型目录与算力；AgentControlPlane 提供委派工作流和用量证据，供中转站对账计费。

## 配置

创建 `config/local.json`（机器特定，已 gitignore），或使用 `AGENT_CONTROL_CONFIG`：

```json
{
  "executor": {
    "openaiCompat": {
      "baseUrl": "https://your-relay.example/v1",
      "apiKey": "sk-your-relay-key",
      "model": "deepseek/deepseek-v4-pro",
      "protocol": "responses",
      "models": ["deepseek/deepseek-v4-pro", "deepseek-v4-pro"]
    }
  }
}
```

- `baseUrl`：中转站的 OpenAI-compatible 端点。
- `apiKey`：中转站的 API 密钥（也可用环境变量 `AGENT_CONTROL_OPENAI_KEY`）。
- `model`：信封未指定模型时的默认模型。
- `models`：实时目录不可达时使用的静态白名单。

## 多个中转端点

`executor.relays` 里的每一项都注册一个具名中转端点。每个中转成为一个独立执行器，拥有自己的 id、显示名、实时模型目录与静态白名单：

```json
{
  "executor": {
    "relays": [
      {
        "id": "asterroute",
        "displayName": "AsterRoute",
        "baseUrl": "https://www.asterroute.com/v1",
        "apiKeyEnv": "ACP_RELAY_ASTERROUTE_KEY",
        "apiKey": "sk-your-relay-key",
        "model": null,
        "protocol": "chat",
        "models": [],
        "requestsPerMinute": 10
      },
      {
        "id": "secondary",
        "displayName": "Secondary Relay",
        "baseUrl": "https://second-relay.example/v1",
        "apiKeyEnv": "ACP_RELAY_SECONDARY_KEY",
        "apiKey": null,
        "protocol": "chat",
        "models": ["deepseek-v4-pro"]
      }
    ]
  }
}
```

- `id` 必填，且要与内置执行器 id（`codex`、`openai-compatible`、`deepseek`、`claude`、`opencode`）不同。
- `apiKeyEnv` 指定环境变量名；当 `apiKey` 为空时从该环境变量取密钥，密钥可以不出现在配置文件里。
- `requestsPerMinute` 控制对中转站的补全请求节奏：60 秒滑动窗口内超过上限时执行器会等待再发。执行器对 429 响应自动重试两次并遵守 `retry-after` 头。中转站对已授权请求（含重试的 429）都计入 RPM 窗口，节奏器同样计每一次尝试；并发任务共用一个窗口。`/v1/models` 目录发现请求单独限速，不占用该额度。
- 派发时用 `"executor": "asterroute"` 或显示名选中中转；每个中转的目录会出现在 `list_models`、网页面板，以及伴侣执行器列表的「模型端点」分组中。

## 实时模型目录

启动时及每 60 秒，AgentControlPlane 读取中转站的 `GET /v1/models` 并构建模型目录：

- `list_models` 与伴侣面板显示中转站当前模型。
- 派发时的模型名校验优先使用实时目录；中转站离线时回退到静态 `models` 白名单。
- 中转站新增模型无需重启即可出现。

## 从网页 AI 使用中转站

说"用 OpenCodex"即可把信封路由到 `openai-compatible`，或指定中转站目录里的模型名：

```text
<ACP_TASK>
{
  "workspace": "DEFAULT",
  "objective": "...",
  "executor": "openai-compatible",
  "model": "deepseek/deepseek-v4-pro",
  "profile": "balanced"
}
</ACP_TASK>
```

## 用量记账

每个任务保存已测量的输入、输出、推理与总 token。`usage_report` MCP 工具按执行器汇总，为中转站提供按用户的用量证据，用于计费或配额检查。

对缓存命中按全额输入价计费的中转站（缓存无折扣），直接用 `input_tokens` 对账即可——它统计的是整段输入（含缓存部分），`cached_input_tokens` 标注其中缓存命中的部分，`uncached_input_tokens` 标注其余部分。对缓存读取打折的中转站，先从 `input_tokens` 减去 `cached_input_tokens` 再计费。
