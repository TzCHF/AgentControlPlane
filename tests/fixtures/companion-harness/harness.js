import {
  extractTaskEnvelope,
  formatTaskResult,
  normalizeDispatch,
} from "/src/protocol.js";
import {
  detectAdapter,
  findComposer,
  latestAssistantText,
  submitComposer,
  writeComposer,
} from "/src/site-adapters.js";
import { createPanel } from "/src/panel.js";

const checks = [];
function check(condition, message) {
  if (!condition) throw new Error(message);
  checks.push(message);
}

try {
  const adapter = detectAdapter(location.href);
  check(adapter.id === "generic", "generic adapter selected");
  const assistant = latestAssistantText(document, adapter);
  const envelope = extractTaskEnvelope(assistant);
  check(envelope?.objective === "Create hello.txt", "ACP_TASK extracted");
  const request = normalizeDispatch(envelope, { workspace: "C:\\harness" });
  check(request.workspace === "C:\\harness", "DEFAULT workspace resolved locally");

  const composer = findComposer(document, adapter);
  check(composer instanceof HTMLTextAreaElement, "composer discovered");
  writeComposer(composer, "Controller prompt");
  check(composer.value === "Controller prompt", "composer text inserted");

  let sent = 0;
  document.querySelector('button[aria-label="Send message"]').addEventListener("click", () => sent++);
  submitComposer(document, adapter, composer);
  check(sent === 1, "send button activated");

  const result = formatTaskResult({
    id: "harness-task",
    status: "completed",
    executor: "opencode",
    result: { summary: "Harness complete" },
  });
  check(result.includes("<ACP_RESULT>"), "ACP_RESULT formatted");
  createPanel({ adapterId: adapter.id, handlers: {} });
  check(Boolean(document.querySelector("#agent-control-plane-companion")), "ACP panel injected");

  document.querySelector("article").remove();
  document.querySelector("form").remove();
  const cases = [
    {
      id: "chatgpt",
      url: "https://chatgpt.com/c/test",
      html: '<div data-message-author-role="assistant">chatgpt reply</div><div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">Send</button>',
    },
    {
      id: "deepseek",
      url: "https://chat.deepseek.com/a/chat/s/test",
      html: '<div class="ds-markdown">deepseek reply</div><textarea></textarea><button aria-label="Send message">Send</button>',
    },
    {
      id: "claude",
      url: "https://claude.ai/chat/test",
      html: '<div data-testid="assistant-message">claude reply</div><div class="ProseMirror" contenteditable="true"></div><button aria-label="Send message">Send</button>',
    },
  ];
  for (const item of cases) {
    const fixture = document.createElement("section");
    fixture.innerHTML = item.html;
    document.body.append(fixture);
    const selected = detectAdapter(item.url);
    check(selected.id === item.id, `${item.id} adapter selected`);
    check(
      latestAssistantText(document, selected) === `${item.id} reply`,
      `${item.id} assistant reply detected`,
    );
    const siteComposer = findComposer(document, selected);
    writeComposer(siteComposer, `${item.id} result`);
    let siteSent = 0;
    fixture.querySelector("button").addEventListener("click", () => siteSent++);
    submitComposer(document, selected, siteComposer);
    check(siteSent === 1, `${item.id} send button activated`);
    fixture.remove();
  }

  const output = document.querySelector("#result");
  output.className = "pass";
  output.textContent = `PASS · ${checks.length} browser DOM checks`;
  document.documentElement.dataset.acpHarness = "passed";
} catch (error) {
  const output = document.querySelector("#result");
  output.className = "fail";
  output.textContent = `FAIL · ${error.message}`;
  document.documentElement.dataset.acpHarness = "failed";
  throw error;
}
