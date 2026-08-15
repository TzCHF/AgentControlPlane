(async () => {
  if (globalThis.__ACP_COMPANION_LOADED__) return;
  globalThis.__ACP_COMPANION_LOADED__ = true;

  const base = chrome.runtime.getURL("src/");
  const [protocol, adapters, panelModule] = await Promise.all([
    import(`${base}protocol.js`),
    import(`${base}site-adapters.js`),
    import(`${base}panel.js`),
  ]);
  const adapter = adapters.detectAdapter(location.href);
  const seen = new Set();
  let currentState = null;
  let monitorTimer = null;

  function message(type, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error ?? "Companion request failed"));
          return;
        }
        resolve(response.result);
      });
    });
  }

  const panel = panelModule.createPanel({
    adapterId: adapter.id,
    handlers: {
      connect: () => connect().catch(reportError),
      teach: () => teach().catch(reportError),
      latest: () => useLatest().catch(reportError),
      dispatch: () => dispatchFromPanel().catch(reportError),
      disconnect: () => disconnect().catch(reportError),
      settings: (values) => saveSettings(values).catch(reportError),
    },
  });

  function reportError(error) {
    panel.open();
    panel.setStatus(error.message, "error");
  }

  const UNPAIRED_HINT =
    "① 点「配对」，在自动打开的批准页点「批准」<br>② 批准后控制器指令会自动放进输入框，点发送<br>③ 网页 AI 输出任务块后自动派发，结果在此显示";
  const CONNECTED_HINT =
    "已连接。新对话：控制器指令已自动放入输入框，发送即可。<br>旧对话：直接描述需求；网页 AI 输出任务块后，回复「执行」确认派发。";

  async function refreshState() {
    currentState = await message("ACP_STATE");
    panel.setSettings(currentState.settings);
    if (!currentState.connected) {
      panel.setHint(UNPAIRED_HINT);
      panel.setStatus(
        currentState.pending
          ? `Pairing code ${formatCode(currentState.pending.code)} is waiting for approval 配对码 ${formatCode(currentState.pending.code)} 等待批准`
          : "Not paired with the local control plane 未与本地控制面配对",
      );
      return;
    }
    const options = await message("ACP_OPTIONS");
    currentState.options = options;
    panel.setOptions(options, currentState.settings);
    panel.setHint(CONNECTED_HINT);
    panel.setStatus(`Connected · ${options.default_executor} 已连接 · ${options.default_executor}`, "success");
  }

  async function saveSettings(values) {
    const patch = {
      workspace: values.workspace,
      profile: values.profile,
      executor: values.executor,
      autoSubmitResults: values.autoSubmitResults,
    };
    const response = await message("ACP_SETTINGS", { patch });
    currentState = { ...currentState, settings: response.settings };
  }

  async function connect() {
    const response = await message("ACP_PAIR_START", {
      label: `${adapter.id} on ${location.hostname}`,
    });
    panel.open();
    panel.setStatus(
      `Approve code ${formatCode(response.code)} in the local tab 已打开批准页，请点击「批准」（配对码 ${formatCode(response.code)}）`,
    );
    const deadline = Date.parse(response.expires_at);
    while (Date.now() < deadline) {
      await delay(1500);
      const pairing = await message("ACP_PAIR_STATUS");
      if (pairing.status === "connected") {
        await refreshState();
        await autoTeach();
        return;
      }
      if (pairing.status === "expired") break;
    }
    throw new Error("Pairing request expired 配对请求已过期");
  }

  async function autoTeach() {
    try {
      await teach();
    } catch (error) {
      panel.setStatus(
        `Paired, but the controller prompt could not be inserted 已配对，但未能自动插入控制器指令：${error.message}，请点「教导网页 AI」`,
        "error",
      );
    }
  }

  async function disconnect() {
    await message("ACP_DISCONNECT");
    currentState = null;
    await refreshState();
    panel.setStatus(
      "Disconnected 已断开。任务历史保留，随时可重新配对。",
      "normal",
    );
  }

  async function teach() {
    await refreshState();
    const composer = adapters.findComposer(document, adapter);
    if (!composer) throw new Error("Could not find this site's message composer 找不到该站点的消息输入框");
    adapters.writeComposer(
      composer,
      protocol.controllerPrompt(currentState.settings),
    );
    panel.setStatus("Controller prompt inserted for review 控制器指令已插入，待审阅", "success");
  }

  async function useLatest() {
    const text = adapters.latestAssistantText(document, adapter);
    if (!text) throw new Error("Could not find an assistant reply on this page 找不到该页面上的 AI 回复");
    const envelope = protocol.extractTaskEnvelope(text);
    panel.setObjective(envelope ? JSON.stringify(envelope, null, 2) : text);
    panel.open();
    panel.setStatus(
      envelope ? "ACP_TASK envelope loaded ACP_TASK 信封已载入" : "Latest reply loaded as objective 最新回复已载入为目标",
      "success",
    );
  }

  async function dispatchFromPanel() {
    const values = panel.getValues();
    const envelope =
      protocol.extractTaskEnvelope(values.objective) ??
      tryJson(values.objective) ??
      { objective: values.objective };
    await dispatchEnvelope(envelope, values);
  }

  async function dispatchEnvelope(envelope, settings = currentState?.settings) {
    if (!currentState?.connected) await refreshState();
    if (!currentState?.connected) throw new Error("Pair the companion before dispatch 派发前请先配对");
    const resolvedSettings = {
      ...currentState.settings,
      ...settings,
    };
    if (!resolvedSettings.workspace) {
      resolvedSettings.workspace = currentState.options?.workspaces?.[0] ?? "";
    }
    const request = protocol.normalizeDispatch(envelope, resolvedSettings);
    const response = await message("ACP_DISPATCH", {
      request,
      pageUrl: location.href,
    });
    panel.open();
    panel.setStatus(`Task ${response.task.id.slice(0, 8)} queued 任务 ${response.task.id.slice(0, 8)} 已排队`);
    await pollTask(response.task.id);
  }

  async function pollTask(taskId) {
    const deadline = Date.now() + 4 * 60 * 60 * 1000;
    while (Date.now() < deadline) {
      const response = await message("ACP_TASK_STATUS", { taskId });
      const task = response.task;
      const sessionLabel = task.executor_session_id
        ? ` · 会话 ${task.executor_session_id}`
        : "";
      panel.setStatus(
        `Task ${task.id.slice(0, 8)} · ${task.status} 任务 ${task.id.slice(0, 8)} · ${task.status}${sessionLabel}`,
      );
      if (task.terminal) {
        const result = protocol.formatTaskResult(task);
        await returnResult(result);
        panel.setStatus(
          `Task ${task.id.slice(0, 8)} · ${task.status}`,
          task.status === "completed" ? "success" : "error",
        );
        return task;
      }
      await delay(2000);
    }
    throw new Error("Task monitoring timed out 任务监控超时");
  }

  async function returnResult(text) {
    const composer = adapters.findComposer(document, adapter);
    if (!composer) throw new Error("Task finished, but the web AI composer was not found 任务已完成，但未找到网页 AI 输入框");
    adapters.writeComposer(composer, text);
    if (currentState.settings.autoSubmitResults) {
      await delay(250);
      adapters.submitComposer(document, adapter, composer);
    }
  }

  const CONFIRM_WORDS =
    /^(yes|y|ok|okay|go|run|执行|确认|批准|好的|可以|是|对|派发|派发吧|派发吗|执行吧|确认派发|确认执行|是否派发)$/i;
  let pendingEnvelope = null;

  async function inspectConversation() {
    monitorTimer = null;
    if (!currentState?.connected) return;

    const userText = adapters.latestUserText(document, adapter).trim();
    if (pendingEnvelope && userText && CONFIRM_WORDS.test(userText)) {
      const envelope = pendingEnvelope;
      pendingEnvelope = null;
      await executeEnvelope(envelope).catch(reportError);
      return;
    }

    const text = adapters.latestAssistantText(document, adapter);
    const envelope = protocol.extractTaskEnvelope(text);
    if (!envelope) return;
    const id = protocol.stableEnvelopeId(envelope);
    if (seen.has(id)) return;
    seen.add(id);
    if (seen.size > 100) seen.delete(seen.values().next().value);

    pendingEnvelope = envelope;
    panel.setObjective(JSON.stringify(envelope, null, 2));
    panel.open();
    panel.setStatus(
      "Task envelope staged 任务块已暂存：回复「执行 / 是否派发」确认，或点「派发」",
      "success",
    );
  }

  async function executeEnvelope(envelope) {
    const id = protocol.stableEnvelopeId(envelope);
    const claim = await message("ACP_CLAIM_ENVELOPE", {
      pageUrl: location.href,
      envelopeId: id,
    });
    if (!claim.claimed) return;
    try {
      await dispatchEnvelope(envelope);
    } catch (error) {
      await message("ACP_RELEASE_ENVELOPE", {
        pageUrl: location.href,
        envelopeId: id,
      }).catch(() => null);
      panel.setObjective(JSON.stringify(envelope, null, 2));
      throw error;
    }
  }

  const observer = new MutationObserver(() => {
    if (monitorTimer) return;
    monitorTimer = setTimeout(inspectConversation, 800);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function formatCode(code) {
    return `${String(code).slice(0, 3)}-${String(code).slice(3)}`;
  }

  function tryJson(value) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  await refreshState().catch((error) => {
    panel.setStatus(`Local service unavailable 本地服务不可用：${error.message}`, "error");
  });
  if (currentState?.connected) {
    const active = await message("ACP_ACTIVE_TASKS", {
      pageUrl: location.href,
    }).catch(() => ({ task_ids: [] }));
    for (const taskId of active.task_ids) pollTask(taskId).catch(reportError);
  }
  inspectConversation();
})().catch((error) => {
  console.warn("AgentControlPlane companion failed to initialize", error);
});
