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
| 2026-08-14 00:00 | chatgpt.com | auto | `...` | completed | `acp-e2e-ok.txt` | 1 | `...` | 通过 |
| 2026-08-14 00:00 | chat.deepseek.com | auto | `...` | completed | `acp-e2e-ok.txt` | 1 | `...` | 通过 |
| 2026-08-14 00:00 | claude.ai | auto | `...` | completed | `acp-e2e-ok.txt` | 1 | `...` | 通过 |

> 如果某执行器不可用，记录 `error_code` 与 `assistant` 返回信息，不得跳过列；  
> 例如：`executor_unavailable` / `no_executor_available` / `403` / `unknown_executor`.

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
