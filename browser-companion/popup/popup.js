import { makeT } from "../src/i18n.js";

const elements = Object.fromEntries(
  ["status", "language", "workspace", "profile", "executor", "autoSubmitResults", "pair", "enable", "refresh"].map(
    (id) => [id, document.getElementById(id)],
  ),
);

let lang = "zh";
let t = makeT(lang);

function message(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error ?? "Request failed"));
      resolve(response.result);
    });
  });
}

function status(text, kind = "normal") {
  elements.status.textContent = text;
  elements.status.style.color = kind === "error" ? "#f85149" : kind === "success" ? "#3fb950" : "#8b949e";
}

function relabel() {
  elements.workspaceLabel.childNodes[0].textContent = `${t("workspaceLabel")} `;
  elements.profileLabel.childNodes[0].textContent = `${t("profileLabel")} `;
  elements.executorLabel.childNodes[0].textContent = `${t("executorLabel")} `;
  elements.languageLabel.childNodes[0].textContent = `${t("languageLabel")} `;
  elements.autoSubmitLabel.textContent = t("popupAutoSubmit");
  elements.pair.textContent = t("popupPairLocalService");
  elements.enable.textContent = t("popupEnableSite");
  elements.refresh.textContent = t("popupRefresh");
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
  lang = current.settings?.language === "en" ? "en" : "zh";
  t = makeT(lang);
  elements.language.value = lang;
  relabel();
  if (current.pending) {
    const pairing = await message("ACP_PAIR_STATUS");
    if (pairing.status === "connected") current = await message("ACP_STATE");
  }
  elements.autoSubmitResults.checked = current.settings.autoSubmitResults;
  if (!current.connected) {
    status(
      current.pending
        ? t("popupApproveCode", {
            code: `${current.pending.code.slice(0, 3)}-${current.pending.code.slice(3)}`,
          })
        : t("popupNotPaired"),
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
  status(t("popupConnected", { executor: available.default_executor }), "success");
}

async function save() {
  await message("ACP_SETTINGS", {
    patch: {
      workspace: elements.workspace.value,
      profile: elements.profile.value,
      executor: elements.executor.value,
      autoSubmitResults: elements.autoSubmitResults.checked,
    },
  });
  status(t("popupSettingsSaved"), "success");
}

elements.language.addEventListener("change", async () => {
  lang = elements.language.value === "en" ? "en" : "zh";
  t = makeT(lang);
  relabel();
  await message("ACP_SETTINGS", { patch: { language: lang } });
  status(t("popupSettingsSaved"), "success");
});

elements.pair.addEventListener("click", async () => {
  try {
    const result = await message("ACP_PAIR_START", { label: "Browser toolbar" });
    status(t("popupApproveCode", { code: `${result.code.slice(0, 3)}-${result.code.slice(3)}` }));
  } catch (error) {
    status(error.message, "error");
  }
});

elements.enable.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await message("ACP_ENABLE_SITE", { url: tab.url });
    status(
      result.granted ? t("popupEnabledSite", { pattern: result.pattern }) : t("popupSiteNotGranted"),
      result.granted ? "success" : "normal",
    );
  } catch (error) {
    status(error.message, "error");
  }
});

elements.refresh.addEventListener("click", () => refresh().catch((error) => status(error.message, "error")));
for (const element of [elements.workspace, elements.profile, elements.executor, elements.autoSubmitResults]) {
  element.addEventListener("change", () => save().catch((error) => status(error.message, "error")));
}

refresh().catch((error) => status(`${t("popupNotPaired")} · ${error.message}`, "error"));
