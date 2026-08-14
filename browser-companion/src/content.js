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
      settings: (values) => saveSettings(values).catch(reportError),
    },
  });

  function reportError(error) {
    panel.open();
    panel.setStatus(error.message, "error");
  }

  async function refreshState() {
    currentState = await message("ACP_STATE");
    panel.setSettings(currentState.settings);
    if (!currentState.connected) {
      panel.setStatus(
        currentState.pending
          ? `Pairing code ${formatCode(currentState.pending.code)} is waiting for approval`
          : "Not paired with the local control plane",
      );
      return;
    }
    const options = await message("ACP_OPTIONS");
    panel.setOptions(options, currentState.settings);
    panel.setStatus(`Connected · ${options.default_executor}`, "success");
  }

  async function saveSettings(values) {
    const patch = {
      workspace: values.workspace,
      profile: values.profile,
      executor: values.executor,
      autoDispatch: values.autoDispatch,
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
      `Approve code ${formatCode(response.code)} in the local tab`,
    );
    const deadline = Date.parse(response.expires_at);
    while (Date.now() < deadline) {
      await delay(1500);
      const pairing = await message("ACP_PAIR_STATUS");
      if (pairing.status === "connected") {
        await refreshState();
        return;
      }
      if (pairing.status === "expired") break;
    }
    throw new Error("Pairing request expired");
  }

  async function teach() {
    await refreshState();
    const composer = adapters.findComposer(document, adapter);
    if (!composer) throw new Error("Could not find this site's message composer");
    adapters.writeComposer(
      composer,
      protocol.controllerPrompt(currentState.settings),
    );
    panel.setStatus("Controller prompt inserted for review", "success");
  }

  async function useLatest() {
    const text = adapters.latestAssistantText(document, adapter);
    if (!text) throw new Error("Could not find an assistant reply on this page");
    const envelope = protocol.extractTaskEnvelope(text);
    panel.setObjective(envelope ? JSON.stringify(envelope, null, 2) : text);
    panel.open();
    panel.setStatus(
      envelope ? "ACP_TASK envelope loaded" : "Latest reply loaded as objective",
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
    if (!currentState?.connected) throw new Error("Pair the companion before dispatch");
    const request = protocol.normalizeDispatch(envelope, {
      ...currentState.settings,
      ...settings,
    });
    const response = await message("ACP_DISPATCH", {
      request,
      pageUrl: location.href,
    });
    panel.open();
    panel.setStatus(`Task ${response.task.id.slice(0, 8)} queued`);
    await pollTask(response.task.id);
  }

  async function pollTask(taskId) {
    const deadline = Date.now() + 4 * 60 * 60 * 1000;
    while (Date.now() < deadline) {
      const response = await message("ACP_TASK_STATUS", { taskId });
      const task = response.task;
      panel.setStatus(`Task ${task.id.slice(0, 8)} · ${task.status}`);
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
    throw new Error("Task monitoring timed out");
  }

  async function returnResult(text) {
    const composer = adapters.findComposer(document, adapter);
    if (!composer) throw new Error("Task finished, but the web AI composer was not found");
    adapters.writeComposer(composer, text);
    if (currentState.settings.autoSubmitResults) {
      await delay(250);
      adapters.submitComposer(document, adapter, composer);
    }
  }

  async function inspectConversation() {
    monitorTimer = null;
    if (!currentState?.connected || !currentState.settings.autoDispatch) return;
    const text = adapters.latestAssistantText(document, adapter);
    const envelope = protocol.extractTaskEnvelope(text);
    if (!envelope) return;
    const id = protocol.stableEnvelopeId(envelope);
    if (seen.has(id)) return;
    seen.add(id);
    if (seen.size > 100) seen.delete(seen.values().next().value);
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
      reportError(error);
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
    panel.setStatus(`Local service unavailable: ${error.message}`, "error");
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
