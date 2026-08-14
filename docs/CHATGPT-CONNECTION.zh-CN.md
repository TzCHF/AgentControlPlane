# 将 ChatGPT 连接到 AgentControlPlane

> [English](CHATGPT-CONNECTION.md)

AgentControlPlane 是一个仅含工具的 MCP 服务器。推荐的私有用途路径是 OpenAI Secure MCP Tunnel，因为服务器可以保持绑定在 loopback 地址，且无需打开入站防火墙端口。

官方参考：

- [连接并测试你的插件](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [MCP 认证](https://developers.openai.com/plugins/build/auth)

## 1. 验证本地服务

在本仓库中：

```powershell
npm.cmd install
npm.cmd test
npm.cmd run doctor
npm.cmd start
```

让服务保持在其默认的 loopback 地址：

```text
http://127.0.0.1:4318/mcp
```

用于隧道时，请勿将主机更改为 `0.0.0.0`。

## 2. 创建 Secure MCP Tunnel

在 OpenAI Platform 的隧道设置中：

1. 创建一个隧道，并将其关联到将使用它的 ChatGPT 工作区或个人工作区。
2. 向操作者授予运行客户端和选择隧道所需的隧道权限。
3. 从隧道设置页面下载当前的 `tunnel-client` 版本。
4. 为 `tunnel-client` 创建一个运行时 API 密钥，并将其保存在本仓库之外。

隧道运行时密钥用于 `tunnel-client` 向 OpenAI 隧道控制平面进行身份验证。AgentControlPlane 本身不需要也不存储 OpenAI API 密钥。

以当前 `tunnel-client help quickstart` 的输出为准。针对本仓库中的 HTTP 服务器，初始化一个命名配置文件：

```powershell
$env:CONTROL_PLANE_API_KEY = "<runtime key>"
tunnel-client init `
  --sample sample_mcp_http_local `
  --profile agent-control-plane `
  --tunnel-id <tunnel_id> `
  --mcp-server-url http://127.0.0.1:4318/mcp
```

然后验证并运行它：

```powershell
tunnel-client doctor --profile agent-control-plane --explain
tunnel-client run --profile agent-control-plane
```

保持 AgentControlPlane 和 `tunnel-client` 同时运行。

## 3. 在 ChatGPT 中添加它

1. 在 ChatGPT 中，打开 **设置 → 安全与登录**，并启用开发者模式。
2. 打开 ChatGPT 插件页面，选择加号按钮。
3. 输入名称和描述。
4. 在 Connection 下，选择 **Tunnel**。
5. 选择关联的隧道，或粘贴其 `tunnel_id`。
6. 查看发现的工具并创建连接。
7. 开始一个新对话，并从工具菜单中启用该连接。

工具名称、schema、描述、注解或身份验证发生变化后，打开连接并选择 **Refresh**，然后开始一个新对话。

## 4. 首次验证提示词

从一个只读任务开始：

```text
Use AgentControlPlane to list the available execution profiles and models.
Do not dispatch engineering work yet.
```

然后派发一个小型项目任务：

```text
Use the balanced profile. Ask the engineering agent to inspect my selected
workspace, make no changes, and return the repository title plus test command.
```

预期流程如下：

```text
ChatGPT conversation
  -> AgentControlPlane MCP tool
  -> persistent Codex project thread
  -> compact result and measured usage
  -> ChatGPT follow-up or acceptance
```

## 安全说明

- Secure MCP Tunnel 用于私有连接和开发者模式测试。它不能替代公开插件提交所需的稳定公共 HTTPS 端点。
- 在没有经过认证的网关的情况下，请勿为该服务使用通用的公共转发 URL。
- ChatGPT 不会向 MCP 服务器发送任意由客户提供的 API 密钥。生产环境的公共部署应使用兼容 MCP 的 OAuth 2.1，验证 issuer、audience、过期时间和 scopes，并可选地在网关处校验 OpenAI 管理的 mTLS。
- `AGENT_CONTROL_TOKEN` 适用于直接 HTTP 客户端和私有反向代理，但它不是生产环境 ChatGPT 的认证设计。
- 保持 `workspaceRoots` 范围狭窄。任何被授权派发工作的人都可能让 Codex 编辑这些根目录内的文件。

## 当前限制

创建 Platform 隧道、授予其权限以及配置运行时密钥属于账户级操作。本仓库有意不将这些操作自动化。
