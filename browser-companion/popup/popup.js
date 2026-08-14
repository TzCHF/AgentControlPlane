const elements = Object.fromEntries(
  ["status", "workspace", "profile", "executor", "autoDispatch", "autoSubmitResults", "pair", "enable", "refresh"].map(
    (id) => [id, document.getElementById(id)],
  ),
);

function message(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error ?? "Request failed 请求失败"));
      resolve(response.result);
    });
  });
}

function status(text, kind = "normal") {
  elements.status.textContent = text;
  elements.status.style.color = kind === "error" ? "#f85149" : kind === "success" ? "#3fb950" : "#8b949e";
}

function options(select, values, selected) {
  select.replaceChildren(
    ...values.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      return option;
    }),
  );
  select.value = selected ?? values[0] ?? "";
}

async function refresh() {
  let current = await message("ACP_STATE");
  if (current.pending) {
    const pairing = await message("ACP_PAIR_STATUS");
    if (pairing.status === "connected") current = await message("ACP_STATE");
  }
  elements.autoDispatch.checked = current.settings.autoDispatch;
  elements.autoSubmitResults.checked = current.settings.autoSubmitResults;
  if (!current.connected) {
    status(
      current.pending
        ? `Approve pairing code ${current.pending.code.slice(0, 3)}-${current.pending.code.slice(3)} 请批准配对码 ${current.pending.code.slice(0, 3)}-${current.pending.code.slice(3)}`
        : "Not paired with 127.0.0.1:4318 未与 127.0.0.1:4318 配对",
    );
    return;
  }
  const available = await message("ACP_OPTIONS");
  options(elements.workspace, available.workspaces, current.settings.workspace);
  options(elements.profile, Object.keys(available.profiles), current.settings.profile);
  options(
    elements.executor,
    ["auto", ...available.executors.filter((entry) => entry.discovery?.available !== false).map((entry) => entry.id)],
    current.settings.executor,
  );
  status(`Connected · default ${available.default_executor} 已连接 · 默认 ${available.default_executor}`, "success");
}

async function save() {
  await message("ACP_SETTINGS", {
    patch: {
      workspace: elements.workspace.value,
      profile: elements.profile.value,
      executor: elements.executor.value,
      autoDispatch: elements.autoDispatch.checked,
      autoSubmitResults: elements.autoSubmitResults.checked,
    },
  });
  status("Settings saved 设置已保存", "success");
}

elements.pair.addEventListener("click", async () => {
  try {
    const result = await message("ACP_PAIR_START", { label: "Browser toolbar 浏览器工具栏" });
    status(`Approve code ${result.code.slice(0, 3)}-${result.code.slice(3)} 请批准配对码 ${result.code.slice(0, 3)}-${result.code.slice(3)}`);
  } catch (error) {
    status(error.message, "error");
  }
});

elements.enable.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await message("ACP_ENABLE_SITE", { url: tab.url });
    status(result.granted ? `Enabled ${result.pattern} 已启用 ${result.pattern}` : "Site permission was not granted 未授予站点权限", result.granted ? "success" : "normal");
  } catch (error) {
    status(error.message, "error");
  }
});

elements.refresh.addEventListener("click", () => refresh().catch((error) => status(error.message, "error")));
for (const element of [elements.workspace, elements.profile, elements.executor, elements.autoDispatch, elements.autoSubmitResults]) {
  element.addEventListener("change", () => save().catch((error) => status(error.message, "error")));
}

refresh().catch((error) => status(`Local service unavailable 本地服务不可用：${error.message}`, "error"));
