import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const scriptPath = path.resolve(
  "userscript",
  "agent-control-plane-web-bridge.user.js",
);
const readScript = () => fs.readFileSync(scriptPath, "utf8");

test("userscript declares the preview metadata and supported sites", () => {
  const script = readScript();
  assert.match(script, /^\/\/ ==UserScript==$/m);
  assert.match(script, /^\/\/ @name\s+AgentControlPlane Web Bridge Preview$/m);
  assert.match(script, /^\/\/ @grant\s+none$/m);
  assert.match(script, /^\/\/ @run-at\s+document-idle$/m);

  const matches = [...script.matchAll(/^\/\/ @match\s+(.+)$/gm)]
    .map((entry) => entry[1]);
  assert.deepEqual(matches, [
    "https://chatgpt.com/*",
    "https://chat.deepseek.com/*",
  ]);
});

test("userscript injects a preview panel without task or network access", () => {
  const script = readScript();
  assert.match(script, /ACP 网页桥接预览/);
  assert.match(
    script,
    /Userscript preview only\. Local dispatch and mobile relay are not enabled\./,
  );
  assert.match(script, /document\.body\.append\(root\)/);
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|WebSocket|GM_xmlhttpRequest)\b/);
  assert.doesNotMatch(script, /\b(localhost|dispatch_project|ACP_TASK|api[_-]?key)\b/i);
});

test("userscript documentation states the preview safety boundary", () => {
  const readme = fs.readFileSync(path.resolve("userscript", "README.md"), "utf8");
  assert.match(readme, /desktop-only visual preview/);
  assert.match(readme, /does not read a conversation/i);
  assert.match(readme, /does not.*call a local service/i);
  assert.match(readme, /device pairing, mobile relay support/i);
});
