import { makeT } from "./i18n.js";

export function createPanel({ adapterId, handlers, language = "zh" }) {
  let lang = language === "en" ? "en" : "zh";
  let t = makeT(lang);
  let currentStatus = { text: t("checking"), kind: "normal" };
  let currentHint = t("hintUnpaired");
  let currentOptions = null;
  let currentSettings = null;
  let currentObjective = "";

  const host = document.createElement("div");
  host.id = "agent-control-plane-companion";
  host.style.cssText = "all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  document.documentElement.append(host);

  let fields = {};
  let panel = null;
  let status = null;
  let hint = null;
  let badge = null;

  function render() {
    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box}button,input,select,textarea{font:inherit}.launcher{width:52px;height:52px;border:0;border-radius:50%;background:#238636;color:white;font:700 14px system-ui;box-shadow:0 5px 18px #0006;cursor:pointer}.panel{display:none;width:min(390px,calc(100vw - 36px));max-height:min(680px,calc(100vh - 96px));overflow:auto;margin-bottom:10px;padding:16px;border:1px solid #30363d;border-radius:14px;background:#0d1117;color:#e6edf3;font:14px system-ui;box-shadow:0 12px 36px #0008}.panel.open{display:block}.row{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:9px 0}.stack{display:grid;gap:6px;margin:9px 0}label{color:#8b949e;font-size:12px}input,select,textarea{width:100%;padding:8px;border:1px solid #30363d;border-radius:7px;background:#161b22;color:#e6edf3}textarea{min-height:86px;resize:vertical}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.actions button{padding:8px 10px;border:1px solid #30363d;border-radius:7px;background:#21262d;color:#e6edf3;cursor:pointer}.actions .primary{background:#238636;border-color:#238636}.status{padding:8px;border-radius:7px;background:#161b22;color:#8b949e;overflow-wrap:anywhere}.hint{padding:8px;border-radius:7px;background:#161b22;color:#8b949e;font-size:12px;line-height:1.8}.advanced{margin:9px 0}.advanced summary{cursor:pointer;color:#58a6ff;font-size:13px}.toggle{display:flex;align-items:center;gap:7px;color:#c9d1d9}.toggle input{width:auto}.title{display:flex;justify-content:space-between;align-items:center;gap:8px}.title select{width:auto;padding:4px 6px;font-size:12px}.badge{font:12px ui-monospace;color:#58a6ff}
      </style>
      <section class="panel">
        <div class="title"><strong>AgentControlPlane</strong><span class="badge"></span><select data-field="language"><option value="zh">中文</option><option value="en">English</option></select></div>
        <div class="status"></div>
        <p class="hint"></p>
        <div class="actions"><button class="primary" data-action="connect">${t("pair")}</button><button data-action="teach">${t("teach")}</button><button data-action="dispatch">${t("dispatch")}</button></div>
        <details class="advanced"><summary>${t("advancedSummary")}</summary>
          <p class="hint">${t("defaultsHint")}</p>
          <div class="actions"><button data-action="latest">${t("useLatest")}</button><button data-action="disconnect">${t("disconnect")}</button></div>
          <div class="stack"><label>${t("workspaceLabel")}</label><select data-field="workspace"><option value="">${t("selectAfterPairing")}</option></select></div>
          <div class="row"><div><label>${t("profileLabel")}</label><select data-field="profile"><option value="auto">${t("profileAuto")}</option><option value="economy">${t("profileEconomy")}</option><option value="balanced">${t("profileBalanced")}</option><option value="deep">${t("profileDeep")}</option></select></div><div><label>${t("executorLabel")}</label><select data-field="executor"><option value="auto">${t("executorAuto")}</option></select></div></div>
          <div class="stack"><label>${t("objectiveLabel")}</label><textarea data-field="objective" placeholder="${t("objectivePlaceholder")}"></textarea></div>
          <div class="stack"><label>${t("confirmLabel")}</label><input data-field="confirmWords" placeholder="${t("confirmPlaceholder")}"></div>
          <label class="toggle"><input type="checkbox" data-field="autoSubmitResults"> ${t("autoSubmitLabel")}</label>
        </details>
      </section>
      <button class="launcher" title="${t("launcherTitle")}">ACP</button>`;

    panel = shadow.querySelector(".panel");
    status = shadow.querySelector(".status");
    hint = shadow.querySelector(".hint");
    badge = shadow.querySelector(".badge");
    fields = Object.fromEntries(
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
    for (const name of ["workspace", "profile", "executor", "confirmWords", "autoSubmitResults"]) {
      fields[name].addEventListener("change", () => handlers.settings?.(getValues()));
    }
    fields.language.addEventListener("change", () => {
      setLanguage(fields.language.value);
      handlers.settings?.({ language: lang });
    });

    status.textContent = currentStatus.text;
    status.style.color =
      currentStatus.kind === "error"
        ? "#f85149"
        : currentStatus.kind === "success"
          ? "#3fb950"
          : "#8b949e";
    hint.innerHTML = currentHint;
    if (currentOptions) applyOptions(currentOptions, currentSettings);
    else applySettings(currentSettings);
    fields.objective.value = currentObjective;
  }

  function getValues() {
    return {
      workspace: fields.workspace.value,
      profile: fields.profile.value,
      executor: fields.executor.value,
      confirmWords: fields.confirmWords.value,
      autoSubmitResults: fields.autoSubmitResults.checked,
      language: lang,
      objective: fields.objective.value,
    };
  }

  function applySettings(settings) {
    currentSettings = settings;
    if (!fields.workspace) return;
    for (const name of ["workspace", "profile", "executor", "confirmWords"]) {
      if (settings?.[name] != null) fields[name].value = settings[name];
    }
    fields.language.value = lang;
    fields.autoSubmitResults.checked = Boolean(settings?.autoSubmitResults);
  }

  function applyOptions(options, settings) {
    currentOptions = options;
    currentSettings = settings;
    const workspaces = options?.workspaces ?? [];
    fields.workspace.innerHTML = workspaces
      .map(
        (value) =>
          `<option value="${escapeAttribute(value)}">${escapeText(value)}</option>`,
      )
      .join("");
    fields.profile.innerHTML = Object.keys(options?.profiles ?? {})
      .map(
        (value) =>
          `<option value="${escapeAttribute(value)}">${escapeText(t(`profile${value[0].toUpperCase()}${value.slice(1)}`) ?? value)}</option>`,
      )
      .join("");
    const executors = options?.executors ?? [];
    const available = executors
      .filter((entry) => entry.discovery?.available !== false)
      .map((entry) => ({ id: entry.id, label: entry.display_name ?? entry.id }));
    const unavailable = executors
      .filter((entry) => entry.discovery?.available === false)
      .map((entry) => ({ id: entry.id, label: entry.display_name ?? entry.id }));
    fields.executor.innerHTML = [
      `<option value="auto">${t("executorAuto")}</option>`,
      ...available.map(
        (entry) =>
          `<option value="${escapeAttribute(entry.id)}">${escapeText(entry.label)}</option>`,
      ),
      ...unavailable.map(
        (entry) =>
          `<option value="${escapeAttribute(entry.id)}" disabled>${escapeText(entry.label)}（${t("executorUnavailable")}）</option>`,
      ),
    ].join("");
    applySettings(settings);
  }

  function setLanguage(next) {
    const resolved = next === "en" ? "en" : "zh";
    if (resolved === lang) return;
    lang = resolved;
    t = makeT(lang);
    render();
  }

  render();

  return {
    getValues,
    setSettings(settings) {
      applySettings(settings);
    },
    setOptions(options, settings) {
      applyOptions(options, settings);
    },
    setLanguage,
    setObjective(value) {
      currentObjective = value ?? "";
      if (fields.objective) fields.objective.value = currentObjective;
    },
    setStatus(value, kind = "normal") {
      currentStatus = { text: value, kind };
      if (!status) return;
      status.textContent = value;
      status.style.color =
        kind === "error" ? "#f85149" : kind === "success" ? "#3fb950" : "#8b949e";
    },
    setHint(html) {
      currentHint = html;
      if (hint) hint.innerHTML = html;
    },
    open() {
      panel?.classList.add("open");
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
