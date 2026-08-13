import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
    const deadline = Date.now() + 10 * 60 * 1000;
    const poll = async () => {
      try {
        const response = await fetch(`${baseUrl}/v1/tasks/${taskId}`);
        const body = await response.json();
        if (terminal.has(body.task.status)) return resolve(body.task);
        if (Date.now() >= deadline) {
          return reject(new Error(`Timed out waiting for task ${taskId}`));
        }
        setTimeout(poll, 1000);
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
  path.join(projectRoot, ".smoke-workspace-"),
);
fs.writeFileSync(
  path.join(workspace, "README.md"),
  "# AgentControlPlane smoke workspace\n",
  "utf8",
);
process.env.AGENT_CONTROL_STATE_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "acp-live-state-"),
);

const app = await createApplication();
await new Promise((resolve) =>
  app.server.listen(0, "127.0.0.1", resolve),
);
const { port } = app.server.address();
const baseUrl = `http://127.0.0.1:${port}`;

const client = new Client({
  name: "agent-control-plane-smoke",
  version: "0.1.0",
});
const transport = new StreamableHTTPClientTransport(
  new URL(`${baseUrl}/mcp`),
);

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 8);

  const dispatch = await client.callTool({
    name: "dispatch_project",
    arguments: {
      workspace,
      objective:
        "Read README.md only. Make no changes. Return its first Markdown heading exactly as the summary.",
      constraints: [
        "Do not modify any file.",
        "Do not use the network.",
      ],
      acceptance_criteria: [
        "No files changed.",
        "Summary contains AgentControlPlane smoke workspace.",
      ],
      profile: "economy",
      max_subagents: 0,
      token_budget: 100000,
    },
  });
  if (dispatch.isError || !dispatch.structuredContent?.task) {
    throw new Error(
      `Dispatch failed: ${dispatch.content?.map((entry) => entry.text).join(" ")}`,
    );
  }
  const firstTask = await waitForTerminal(
    baseUrl,
    dispatch.structuredContent.task.id,
  );
  assert.equal(firstTask.status, "completed");
  assert.match(firstTask.result.summary, /AgentControlPlane smoke workspace/);

  const followUp = await client.callTool({
    name: "continue_project",
    arguments: {
      task_id: firstTask.id,
      objective:
        "Read README.md again. Make no changes. Return the first line exactly.",
      profile: "economy",
      max_subagents: 0,
      token_budget: 100000,
    },
  });
  if (followUp.isError || !followUp.structuredContent?.task) {
    throw new Error(
      `Follow-up failed: ${followUp.content?.map((entry) => entry.text).join(" ")}`,
    );
  }
  const secondTask = await waitForTerminal(
    baseUrl,
    followUp.structuredContent.task.id,
  );
  assert.equal(secondTask.status, "completed");
  assert.equal(secondTask.threadId, firstTask.threadId);
  assert.match(secondTask.result.summary, /AgentControlPlane smoke workspace/);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        tools: tools.tools.length,
        thread_reused: true,
        first_task: firstTask.id,
        follow_up_task: secondTask.id,
        first_usage: firstTask.usage,
        follow_up_usage: secondTask.usage,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close().catch(() => {});
  await app.close().catch(() => {});
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
