export function createPanel({ adapterId, handlers }) {
  const host = document.createElement("div");
  host.id = "agent-control-plane-companion";
  host.style.cssText = "all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box}button,input,select,textarea{font:inherit}.launcher{width:52px;height:52px;border:0;border-radius:50%;background:#238636;color:white;font:700 14px system-ui;box-shadow:0 5px 18px #0006;cursor:pointer}.panel{display:none;width:min(390px,calc(100vw - 36px));max-height:min(680px,calc(100vh - 96px));overflow:auto;margin-bottom:10px;padding:16px;border:1px solid #30363d;border-radius:14px;background:#0d1117;color:#e6edf3;font:14px system-ui;box-shadow:0 12px 36px #0008}.panel.open{display:block}.row{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:9px 0}.stack{display:grid;gap:6px;margin:9px 0}label{color:#8b949e;font-size:12px}input,select,textarea{width:100%;padding:8px;border:1px solid #30363d;border-radius:7px;background:#161b22;color:#e6edf3}textarea{min-height:86px;resize:vertical}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.actions button{padding:8px 10px;border:1px solid #30363d;border-radius:7px;background:#21262d;color:#e6edf3;cursor:pointer}.actions .primary{background:#238636;border-color:#238636}.status{padding:8px;border-radius:7px;background:#161b22;color:#8b949e;overflow-wrap:anywhere}.hint{padding:8px;border-radius:7px;background:#161b22;color:#8b949e;font-size:12px;line-height:1.8}.advanced{margin:9px 0}.advanced summary{cursor:pointer;color:#58a6ff;font-size:13px}.toggle{display:flex;align-items:center;gap:7px;color:#c9d1d9}.toggle input{width:auto}.title{display:flex;justify-content:space-between;align-items:center}.badge{font:12px ui-monospace;color:#58a6ff}
    </style>
    <section class="panel">
      <div class="title"><strong>AgentControlPlane</strong><span class="badge"></span></div>
      <div class="status">Checking local connection… 正在检查本地连接…</div>
      <p class="hint">① 点「配对」，在自动打开的批准页点「批准」<br>② 点「教导网页 AI」，发送插入的控制器指令<br>③ 网页 AI 输出任务块后自动派发，结果在此显示</p>
      <div class="row"><div><label>Dispatch mode 派发模式</label><select data-field="dispatchMode"><option value="auto">Auto 自动派发</option><option value="confirm">Confirm word 回复「执行」确认</option><option value="manual">Manual 手动（按钮）</option></select></div></div>
      <div class="actions"><button class="primary" data-action="connect">Pair 配对</button><button data-action="teach">Teach web AI 教导网页 AI</button><button data-action="latest">Use latest reply 使用最新回复</button><button data-action="dispatch">Dispatch 派发</button><button data-action="disconnect">Disconnect 断开</button></div>
      <details class="advanced"><summary>Advanced settings 高级设置</summary>
        <div class="stack"><label>Workspace 工作区</label><select data-field="workspace"><option value="">Select after pairing 配对后选择</option></select></div>
        <div class="row"><div><label>Profile 配置档</label><select data-field="profile"><option>balanced</option></select></div><div><label>Executor 执行器</label><select data-field="executor"><option>auto</option></select></div></div>
        <div class="stack"><label>Objective or ACP_TASK envelope 目标或 ACP_TASK 信封</label><textarea data-field="objective" placeholder="Describe the engineering task 描述工程任务"></textarea></div>
        <label class="toggle"><input type="checkbox" data-field="autoSubmitResults"> Automatically send ACP_RESULT back to this web AI 自动将 ACP_RESULT 回传给该网页 AI</label>
      </details>
    </section>
    <button class="launcher" title="AgentControlPlane Companion 浏览器伴侣">ACP</button>`;
  document.documentElement.append(host);

  const panel = shadow.querySelector(".panel");
  const status = shadow.querySelector(".status");
  const badge = shadow.querySelector(".badge");
  const hint = shadow.querySelector(".hint");
  const fields = Object.fromEntries(
    [...shadow.querySelectorAll("[data-field]")].map((element) => [
      element.dataset.field,
      element,
    ]),
  );
  badge.textContent = adapterId;
  shadow.querySelector(".launcher").addEventListener("click", () => {
    panel.classList.toggle("open");
  });
  for (const button of shadow.querySelectorAll("[data-action]")) {
    button.addEventListener("click", () => handlers[button.dataset.action]?.());
  }
  for (const name of ["workspace", "profile", "executor", "dispatchMode", "autoSubmitResults"]) {
    fields[name].addEventListener("change", () => handlers.settings?.(getValues()));
  }

  function getValues() {
    return {
      workspace: fields.workspace.value,
      profile: fields.profile.value,
      executor: fields.executor.value,
      dispatchMode: fields.dispatchMode.value,
      autoSubmitResults: fields.autoSubmitResults.checked,
      objective: fields.objective.value,
    };
  }

  function setSettings(settings) {
    for (const name of ["workspace", "profile", "executor"]) {
      if (settings?.[name] != null) fields[name].value = settings[name];
    }
    fields.dispatchMode.value = settings?.dispatchMode ?? "auto";
    fields.autoSubmitResults.checked = Boolean(settings?.autoSubmitResults);
  }

  function setOptions(options, settings) {
    const workspaces = options?.workspaces ?? [];
    fields.workspace.innerHTML = workspaces
      .map((value) => `<option value="${escapeAttribute(value)}">${escapeText(value)}</option>`)
      .join("");
    fields.profile.innerHTML = Object.keys(options?.profiles ?? {})
      .map((value) => `<option value="${escapeAttribute(value)}">${escapeText(value)}</option>`)
      .join("");
    fields.executor.innerHTML = ["auto", ...(options?.executors ?? []).filter((entry) => entry.discovery?.available !== false).map((entry) => entry.id)]
      .map((value) => `<option value="${escapeAttribute(value)}">${escapeText(value)}</option>`)
      .join("");
    setSettings(settings);
  }

  return {
    getValues,
    setSettings,
    setOptions,
    setObjective(value) {
      fields.objective.value = value;
    },
    setStatus(value, kind = "normal") {
      status.textContent = value;
      status.style.color = kind === "error" ? "#f85149" : kind === "success" ? "#3fb950" : "#8b949e";
    },
    setHint(html) {
      hint.innerHTML = html;
    },
    open() {
      panel.classList.add("open");
    },
  };
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}
