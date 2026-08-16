# AsterRoute 供应商

> [English](PROVIDER-ASTERROUTE.md)

AsterRoute 是 AgentControlPlane 的官方 AI 中转站。它是一台 OpenAI 兼容网关，
负责鉴权、转发、计量与计费；AgentControlPlane 提供 agent 循环、网页 AI 委派、
任务状态与逐任务 token 用量记账。两者仅通过标准 OpenAI 协议集成：AsterRoute
可对接任意 OpenAI/Anthropic SDK，AgentControlPlane 也可对接任意 OpenAI 兼容供应商。

## 配置

1. 在
   [`https://asterroute.com/register?utm_source=agentcontrolplane&utm_medium=integration&utm_campaign=asterroute-acp`](https://asterroute.com/register?utm_source=agentcontrolplane&utm_medium=integration&utm_campaign=asterroute-acp)
   注册 AsterRoute API Key（项目 + 预付余额）。
2. Key 放入环境变量 `ASTERROUTE_API_KEY`，不要写进配置文件。
3. 在 `config/local.json` 中添加官方 preset relay：

   ```json
   {
     "executor": {
       "relays": [
         {
           "id": "asterroute",
           "preset": "asterroute",
           "apiKeyEnv": "ASTERROUTE_API_KEY",
           "reconcileUrl": "https://asterroute.com",
           "requestsPerMinute": 10
         }
       ]
     }
   }
   ```

   preset 会预填 `baseUrl: "https://asterroute.com/v1"`（OpenAI 兼容 Base URL）
   与 `protocol: "auto"`；显式字段覆盖 preset。
4. 用 `npm start` 启动服务。本地面板绑定 `http://127.0.0.1:4318`。

AsterRoute 官网上的同套集成步骤见
[`https://asterroute.com/integrations/agentcontrolplane?utm_source=agentcontrolplane&utm_medium=docs&utm_campaign=asterroute-acp`](https://asterroute.com/integrations/agentcontrolplane?utm_source=agentcontrolplane&utm_medium=docs&utm_campaign=asterroute-acp)。

## 面板中的用量位置

启动后打开 `http://127.0.0.1:4318/`：

- **执行器**网格把 `asterroute` relay 显示为模型端点执行器，含其 Base URL、
  就绪状态与协议探测结果。relay 全部来自执行器数据，面板没有任何 AsterRoute
  专用代码。
- **模型目录**下拉框列出 `asterroute`；条目来自 `GET /v1/models`，每 60 秒
  刷新一次，AsterRoute 侧新增模型无需重启即可出现。
- **用量汇总**按执行器汇总已测量的输入、输出、推理与总 token。按模型的分组表
  显示预估/结算成本与对账状态，数据来自 `reconcileUrl` 查询——ACP 只读结算
  数据，绝不向 AsterRoute 写成本或 settled 状态。

模型选择权始终在客户端。ACP 只列出实时目录，不替换你选定的模型。

## 错误引导

| AsterRoute 错误码 | 处理方式 |
|---|---|
| `401 invalid_api_key` | 到 AsterRoute 后台重发/更换 Key，然后更新 `ASTERROUTE_API_KEY` 并重启 ACP。 |
| `402 insufficient_balance` | 到 AsterRoute 后台充值项目余额（最低 €25）。 |
| `429 rate_limit_exceeded` | 账户限速已触发；指数退避重试，执行器会遵守 `retry-after` 头。 |
| `400 model_not_allowed` / `400 model_required` | 修正模型 ID：以 AsterRoute Base URL 的 `GET /v1/models` 为准，派发时校验也使用该实时目录。 |
| `503 provider_unavailable` | 上游供应商不可用；查看 [状态页](https://asterroute.com/status?utm_source=agentcontrolplane&utm_medium=error&utm_campaign=asterroute-acp) 并退避重试。 |

## 相关文档

- [AI 中转站集成](AI-RELAY-INTEGRATION.zh-CN.md)
- [Beta 接入指南](BETA-ONBOARDING.zh-CN.md)
