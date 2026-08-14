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
