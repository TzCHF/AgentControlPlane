import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/core/config.js";
import { createApplication } from "../src/server.js";

function waitForTerminal(baseUrl, taskId) {
  const terminal = new Set([
    "completed",
    "partial",
    "blocked",
    "failed",
    "cancelled",
    "interrupted",
  ]);
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5 * 60 * 1000;
    const poll = async () => {
      try {
        const response = await fetch(`${baseUrl}/v1/tasks/${taskId}?events=1`);
        const body = await response.json();
        if (terminal.has(body.task.status)) return resolve(body.task);
        if (Date.now() >= deadline) {
          return reject(new Error(`Timed out waiting for task ${taskId}`));
        }
        setTimeout(poll, 250);
      } catch (error) {
        reject(error);
      }
    };
    poll();
  });
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const workspace = fs.mkdtempSync(
  path.join(projectRoot, ".smoke-workspace-budget-"),
);
fs.writeFileSync(
  path.join(workspace, "README.md"),
  "# Hard budget smoke test\n",
  "utf8",
);
process.env.AGENT_CONTROL_STATE_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "acp-budget-state-"),
);

const config = loadConfig();
config.limits.tokenUsagePollIntervalMs = 250;
const app = await createApplication({ config });
await new Promise((resolve) =>
  app.server.listen(0, "127.0.0.1", resolve),
);
const { port } = app.server.address();
const baseUrl = `http://127.0.0.1:${port}`;

try {
  const response = await fetch(`${baseUrl}/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspace,
      objective:
        "Read README.md and explain its heading in detail. Do not modify any file.",
      constraints: [
        "Do not modify any file.",
        "Do not use the network.",
      ],
      acceptance_criteria: ["No files changed."],
      profile: "economy",
      model: "deepseek/deepseek-v4-flash",
      reasoning_effort: "low",
      max_subagents: 0,
      token_budget: 1000,
    }),
  });
  const dispatched = await response.json();
  assert.equal(
    response.status,
    202,
    `Dispatch failed: ${JSON.stringify(dispatched)}`,
  );

  const task = await waitForTerminal(baseUrl, dispatched.task.id);
  assert.equal(task.status, "interrupted");
  assert.equal(task.error?.code, "token_budget_exceeded");
  assert.ok(task.usage?.total_tokens >= 1000);
  assert.ok(
    task.events?.some(
      (event) => event.type === "task.token_budget_exceeded",
    ),
  );
  assert.equal(
    fs.readFileSync(path.join(workspace, "README.md"), "utf8"),
    "# Hard budget smoke test\n",
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        task_id: task.id,
        task_status: task.status,
        budget: task.policy.tokenBudget,
        measured_total_tokens: task.usage.total_tokens,
        error_code: task.error.code,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close().catch(() => {});
  fs.rmSync(workspace, { recursive: true, force: true });
}
