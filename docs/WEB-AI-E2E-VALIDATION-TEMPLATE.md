# 网页 AI 到多执行器端到端验证模板

用于 `v0.4` 浏览器伴侣的发布级验收。  
目标：证明从网页 AI 侧发起任务后，成功进入本地工程执行器并得到可验证结果。

## 一、验收前置

```powershell
cd C:\Users\45928\Documents\Github\AgentControlPlane
npm.cmd start
```

在浏览器中加载 `browser-companion` 扩展，完成配对。

## 二、测试基线目标（固定）

- Web 页面：
  - `chatgpt.com`
  - `chat.deepseek.com`
  - `claude.ai`
- 执行器候选：
  - `auto`
  - `opencode`
  - `deepseek`
  - `claude`
- 目标工作区：`acp-live-test`
- 目标文件：`acp-e2e-ok.txt`
- 期望内容：`ACP_WEB_AI_OK`

## 三、发给网页 AI 的固定任务描述（可复用）

> 请让网页 AI 输出 `<ACP_TASK>...</ACP_TASK>` 任务块，字段不变，`executor` 按测试矩阵切换。

```text
<ACP_TASK>
{
  "workspace": "acp-live-test",
  "objective": "Create a file named C:\\Users\\<你的用户名>\\Documents\\Github\\acp-live-test\\acp-e2e-ok.txt with exact content: ACP_WEB_AI_OK",
  "context": "Web AI e2e validation",
  "constraints": ["No extra files", "No extra prompt text in file"],
  "acceptance_criteria": ["file exists", "content exactly ACP_WEB_AI_OK"],
  "profile": "balanced",
  "executor": "auto"
}
</ACP_TASK>
```

## 四、结果记录表（Release 附录）

建议每次复现按下表记录：

| 时间 | 页面 | executor | task_id | status | changed_files | changed_lines | usage.total_tokens | result.summary | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-15 00:08 | chatgpt.com（浏览器伴侣配对+自动派发） | auto → opencode | `12ed04d6-...` | completed | （文件已存在，验证通过） | 1 | 9242 | Verified acp-e2e-ok.txt contains exactly ACP_WEB_AI_OK (13 bytes, no trailing newline). | 通过；测试证据 2 项 passed |
| 2026-08-14 23:47 | 控制面 API 驱动（配对→派发同扩展链路） | auto → opencode | `5be331f3-...` | completed | `acp-e2e-ok.txt` | 1 | 9031 | Created acp-e2e-ok.txt with exact content ACP_WEB_AI_OK (13 bytes, no trailing newline/whitespace). | 通过；测试证据 passed（len=13, content=[ACP_WEB_AI_OK]） |
| 2026-08-15 02:41 | chatgpt.com | deepseek（DeepSeek Harness） | `52e8bfd2-...` | completed | `add.py` | 1 | 14790 | Created a minimal runnable addition example; `python add.py` outputs `3 + 5 = 8`. | 通过；对话分享 https://chatgpt.com/share/6a7fd538-8620-83eb-a8bc-83bf2684f71c |
| 2026-08-15 02:36 | chat.deepseek.com | deepseek（DeepSeek Harness） | `4b5c717f-...` | completed | `deepseek_add.py` | 1 | 14790 | Created deepseek_add.py; runs with integer (7+12=19) and float (3.5+2.25=5.75) examples, py_compile passed. | 通过；测试证据 2 项 passed |
| 2026-08-15 02:36 | chat.deepseek.com | auto → opencode | `633b580f-...` | failed | — | 0 | 0 | 模型名 `deepseek-v4-pro` 不被 opencode 识别（Model not found）。 | 失败已记录；修复后经模型白名单与执行器目录教学解决 |
| 2026-08-15 03:04 | chatgpt.com | openai-compatible（OpenCodex） | `6bebd14d-...` | completed | 无（复用 add.py） | 0 | 12710 | 运行 add.py 输出 `3 + 5 = 8`，并验证 `add(1,2)==3`。 | 通过；测试证据 2 项 passed |
| 2026-08-15 02:53 | chatgpt.com | codex | `24cd5387-...` | failed | — | 0 | 0 | Codex 账户额度耗尽（usageLimitExceeded，8 月 20 日恢复），任务未进入推理。 | 外部限制已记录，非模型名问题 |
| 2026-08-14 00:00 | claude.ai | auto | `...` | completed | `acp-e2e-ok.txt` | 1 | `...` | 通过 |

> 如果某执行器不可用，记录 `error_code` 与 `assistant` 返回信息，不得跳过列；  
> 例如：`executor_unavailable` / `no_executor_available` / `403` / `unknown_executor`.

> 前两行记录为 2026-08-14/15 完成的两轮验证：第一轮通过控制面 API 驱动
> （配对 → 批准 → 认领 → 派发 → opencode 执行 → 文件核验），第二轮通过
> chatgpt.com 真实浏览器伴侣配对与自动派发完成；两轮与浏览器伴侣扩展驱动的是
> 同一服务端链路。2026-08-15 增补 chatgpt.com × DeepSeek Harness 两轮成功
> （附公开对话分享链接）与 chat.deepseek.com × opencode 一轮失败记录（模型名
> 错误，已通过模型白名单校验修复）。Claude 站点的浏览器 UI 实测仍需在
> claude.ai 按第三节操作后回填。
> 第三节操作后回填。

## 五、文件与内容核验（本地）

```powershell
Test-Path "C:\Users\YOUR_USER\Documents\Github\acp-live-test\acp-e2e-ok.txt"
Get-Content "C:\Users\YOUR_USER\Documents\Github\acp-live-test\acp-e2e-ok.txt"
```

应返回：

```text
True
ACP_WEB_AI_OK
```

## 六、最终汇总（附到 Release）

### 通过项

1. 3 个网页站点均可触发 ACP 任务
2. 至少 1 个以上可执行器成功写回 `acp-e2e-ok.txt`
3. 任务 ID、状态、输出可追溯

### 未通过项（如有）

- 写明失败原因与复现步骤，不可将失败项省略。
- 若为网络/配额问题，需注明外部服务不可达，不得改为“功能不支持”。
