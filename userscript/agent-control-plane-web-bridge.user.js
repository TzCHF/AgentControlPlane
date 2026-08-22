// ==UserScript==
// @name         AgentControlPlane Web Bridge Preview
// @namespace    https://github.com/Ya-KARAS/AgentControlPlane
// @version      0.1.0
// @description  Preview the AgentControlPlane web bridge on supported AI websites.
// @author       Ya-KARAS
// @match        https://chatgpt.com/*
// @match        https://chat.deepseek.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const ROOT_ID = "acp-web-bridge-preview";
  if (document.getElementById(ROOT_ID)) return;

  const root = document.createElement("section");
  root.id = ROOT_ID;
  root.setAttribute("aria-label", "AgentControlPlane web bridge preview");

  const style = document.createElement("style");
  style.textContent = `
    #${ROOT_ID} { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; font-family: system-ui, sans-serif; }
    #${ROOT_ID} button { border: 0; border-radius: 999px; background: #536af5; color: #fff; cursor: pointer; font: inherit; }
    #${ROOT_ID} .acp-trigger { box-shadow: 0 8px 24px rgba(28, 39, 102, .28); font-weight: 700; padding: 10px 16px; }
    #${ROOT_ID} .acp-panel { background: #fff; border: 1px solid #d8dcf6; border-radius: 12px; box-shadow: 0 12px 36px rgba(15, 23, 42, .22); color: #172033; margin-bottom: 10px; max-width: 300px; padding: 16px; }
    #${ROOT_ID} .acp-panel[hidden] { display: none; }
    #${ROOT_ID} .acp-panel h2 { font-size: 15px; margin: 0 30px 8px 0; }
    #${ROOT_ID} .acp-panel p { font-size: 13px; line-height: 1.5; margin: 0; }
    #${ROOT_ID} .acp-close { background: transparent; color: #526079; font-size: 18px; line-height: 1; padding: 2px 6px; position: absolute; right: 8px; top: 8px; }
  `;

  const panel = document.createElement("div");
  panel.className = "acp-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <button class="acp-close" type="button" aria-label="Close">×</button>
    <h2>ACP 网页桥接预览</h2>
    <p>Userscript preview only. Local dispatch and mobile relay are not enabled.</p>
  `;

  const trigger = document.createElement("button");
  trigger.className = "acp-trigger";
  trigger.type = "button";
  trigger.textContent = "ACP";
  trigger.setAttribute("aria-expanded", "false");

  const setOpen = (open) => {
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  };

  trigger.addEventListener("click", () => setOpen(panel.hidden));
  panel.querySelector(".acp-close").addEventListener("click", () => setOpen(false));

  root.append(style, panel, trigger);
  document.body.append(root);
})();
