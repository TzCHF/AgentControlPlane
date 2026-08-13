import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OpenAICompatibleExecutor } from "../src/executors/openai-compatible-executor.js";
import { assertLifecycle } from "../src/executors/lifecycle.js";

function createMockServer() {
  let round = 0;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : {};
    requests.push({ method: req.method, url: req.url, body });
    res.setHeader("content-type", "application/json");

    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "deepseek/deepseek-v4-pro" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      round += 1;
      if (round === 1) {
        res.end(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                id: "fc_1",
                call_id: "call_1",
                name: "write_file",
                arguments: JSON.stringify({
                  path: "hello.txt",
                  content: "hi from opencodex",
                }),
                status: "completed",
              },
            ],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 2 },
            },
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    status: "completed",
                    summary: "Wrote hello.txt",
                    changed_files: ["hello.txt"],
                    tests: [],
                    blockers: [],
                    next_action: null,
                  }),
                },
              ],
            },
          ],
          usage: {
            input_tokens: 20,
            output_tokens: 10,
            total_tokens: 30,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 4 },
          },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        requests,
      });
    });
  });
}

function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error("Timed out"));
      }
      setTimeout(check, 5);
    };
    check();
  });
}

test("OpenAICompatibleExecutor satisfies the agent lifecycle contract", () => {
  const executor = new OpenAICompatibleExecutor({
    baseUrl: "http://127.0.0.1:1/v1",
  });
  assert.equal(assertLifecycle(executor), executor);
});

test("runs a tool loop against an OpenAI-compatible responses endpoint", async () => {
  const { server, baseUrl, requests } = await createMockServer();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "acp-openai-work-"));
  const executor = new OpenAICompatibleExecutor({
    baseUrl,
    model: "deepseek/deepseek-v4-pro",
    workspaceRoots: [workspace],
  });
  await executor.start();

  const notifications = [];
  executor.on("notification", (message) => notifications.push(message));

  const { thread } = await executor.startThread({ cwd: workspace });
  await executor.setGoal({
    threadId: thread.id,
    objective: "Write hello.txt",
    tokenBudget: 5000,
  });
  const { turn } = await executor.startTurn({
    threadId: thread.id,
    input: [{ type: "text", text: "Write hello.txt" }],
    model: "deepseek/deepseek-v4-pro",
    cwd: workspace,
    outputSchema: {},
  });

  await waitFor(() =>
    notifications.some((entry) => entry.method === "turn/completed"),
  );

  // The write_file tool actually executed against the workspace.
  assert.equal(
    fs.readFileSync(path.join(workspace, "hello.txt"), "utf8"),
    "hi from opencodex",
  );

  const completed = notifications.find(
    (entry) => entry.method === "turn/completed",
  );
  assert.equal(completed.params.turn.id, turn.id);
  const report = JSON.parse(completed.params.turn.items[0].text);
  assert.equal(report.status, "completed");
  assert.deepEqual(report.changed_files, ["hello.txt"]);

  const usageEvent = notifications
    .filter((entry) => entry.method === "thread/tokenUsage/updated")
    .at(-1);
  assert.equal(usageEvent.params.tokenUsage.last.totalTokens, 45);
  assert.equal(usageEvent.params.tokenUsage.last.inputTokens, 30);

  assert.equal(
    requests.filter((entry) => entry.url === "/v1/responses").length,
    2,
  );

  await executor.stop();
  await new Promise((resolve) => server.close(resolve));
});
