import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/core/config.js";
import { createApplication } from "../src/server.js";
import { buildBenchmarkReport } from "../src/benchmark/report.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const resultsPath =
  process.argv[2] ??
  path.join(projectRoot, "benchmark", "real-results.json");

const runAt = new Date().toISOString();
const output = {
  generated_at: runAt,
  cases: [],
};

const terminalStatus = new Set([
  "completed",
  "partial",
  "blocked",
  "failed",
  "cancelled",
  "interrupted",
]);

function createWorkspace(prefix) {
  return fs.mkdtempSync(path.join(projectRoot, `.benchmark-${prefix}-`));
}

function usageFrom(task) {
  return {
    input_tokens: Number(task?.usage?.input_tokens ?? 0),
    cached_input_tokens: Number(task?.usage?.cached_input_tokens ?? 0),
    uncached_input_tokens: Number(task?.usage?.uncached_input_tokens ?? 0),
    output_tokens: Number(task?.usage?.output_tokens ?? 0),
    reasoning_output_tokens: Number(task?.usage?.reasoning_output_tokens ?? 0),
    total_tokens: Number(task?.usage?.total_tokens ?? 0),
  };
}

function normalizedUsage(usage) {
  return {
    input_tokens: Number(usage?.input_tokens ?? 0),
    output_tokens: Number(usage?.output_tokens ?? 0),
    reasoning_output_tokens: Number(usage?.reasoning_output_tokens ?? 0),
    total_tokens: Number(usage?.total_tokens ?? 0),
    cached_input_tokens: Number(usage?.cached_input_tokens ?? 0),
    uncached_input_tokens: Number(usage?.uncached_input_tokens ?? 0),
  };
}

async function waitForTerminal(baseUrl, taskId) {
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/v1/tasks/${taskId}`);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Task query failed: ${response.status} ${error}`);
    }
    const body = await response.json();
    const task = body.task;
    if (terminalStatus.has(task.status)) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Timed out waiting for task ${taskId}`);
}

async function runTask(baseUrl, body) {
  const dispatch = await fetch(`${baseUrl}/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!dispatch.ok) {
    const error = await dispatch.text();
    return {
      ok: false,
      status: dispatch.status,
      body: error,
    };
  }
  const payload = await dispatch.json();
  const taskId = payload.task?.id;
  const startedAt = Date.now();
  if (!taskId) {
    return {
      ok: false,
      body: "No task id returned",
    };
  }

  const completed = await waitForTerminal(baseUrl, taskId);
  const durationMs = Date.now() - startedAt;
  return {
    ok: true,
    task: completed,
    error: completed.error ?? null,
    durationMs,
    success: completed.status === "completed" || completed.status === "partial",
  };
}

async function runPair({ baseUrl, executor, iteration, workspace }) {
  const direct = await runTask(baseUrl, {
    workspace,
    executor,
    profile: "economy",
    max_subagents: 0,
    constraints: [
      "Use only repository files under the workspace.",
      "Do not use the network.",
      "Do not ask follow-up questions.",
    ],
    acceptance_criteria: [
      "Create file benchmark_direct.txt in the workspace root.",
      "Set exact content with pair identifier and mode.",
    ],
    objective:
      "This is a benchmark task for direct mode. " +
      "In the workspace root, create a file named benchmark_direct.txt " +
      "containing a single line that starts with pair and mode and ends " +
      `with text: direct-${executor}-${iteration}. ` +
      "No tool output is needed in the file and no extra files may be modified.",
  });
  if (!direct.ok) {
    return {
      id: `pair-${executor}-${iteration}`,
      category: executor,
      direct: {
        success: false,
        duration_ms: null,
        executor_usage: normalizedUsage({}),
      },
      controlled: {
        success: false,
        duration_ms: null,
        controller_usage: normalizedUsage({}),
        executor_usage: normalizedUsage({}),
      },
      errors: [direct.body ?? `direct_http_${direct.status}`],
    };
  }

  if (!direct.success) {
    return {
      id: `pair-${executor}-${iteration}`,
      category: executor,
      direct: {
        success: false,
        duration_ms: direct.durationMs,
        executor_usage: usageFrom(direct.task),
      },
      controlled: {
        success: false,
        duration_ms: null,
        controller_usage: normalizedUsage({}),
        executor_usage: normalizedUsage({}),
      },
      errors: [
        `direct_failed:${direct.task?.error?.code ?? "unknown"}`,
        direct.task?.error?.message ?? "no_error_message",
      ],
    };
  }

  const controlled = await runTask(baseUrl, {
    workspace,
    executor,
    profile: "economy",
    max_subagents: 0,
    acceptance_criteria: ["Create benchmark_controlled.txt."],
    objective: `Create benchmark_controlled.txt with content: controlled-${executor}-${iteration}.`,
  });
  if (!controlled.ok) {
    return {
      id: `pair-${executor}-${iteration}`,
      category: executor,
      direct: {
        success: direct.success,
        duration_ms: direct.durationMs,
        executor_usage: usageFrom(direct.task),
      },
      controlled: {
        success: false,
        duration_ms: null,
        controller_usage: normalizedUsage({}),
        executor_usage: normalizedUsage({}),
      },
      errors: [controlled.body ?? `controlled_http_${controlled.status}`],
    };
  }

  if (!controlled.success) {
    return {
      id: `pair-${executor}-${iteration}`,
      category: executor,
      direct: {
        success: direct.success,
        duration_ms: direct.durationMs,
        executor_usage: usageFrom(direct.task),
      },
      controlled: {
        success: false,
        duration_ms: controlled.durationMs,
        controller_usage: normalizedUsage({}),
        executor_usage: usageFrom(controlled.task),
      },
      errors: [
        `controlled_failed:${controlled.task?.error?.code ?? "unknown"}`,
        controlled.task?.error?.message ?? "no_error_message",
      ],
    };
  }

  return {
    id: `pair-${executor}-${iteration}`,
    category: executor,
    direct: {
      success: direct.success,
      duration_ms: direct.durationMs,
      executor_usage: usageFrom(direct.task),
    },
    controlled: {
      success: controlled.success,
      duration_ms: controlled.durationMs,
      controller_usage: normalizedUsage({}),
      executor_usage: usageFrom(controlled.task),
    },
  };
}

async function main() {
  const opencodeHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "acp-opencode-home-"),
  );
  process.env.XDG_CONFIG_HOME = opencodeHome;
  process.env.HOME = opencodeHome;
  process.env.USERPROFILE = opencodeHome;
  process.env.APPDATA = path.join(opencodeHome, "AppData");
  process.env.AGENT_CONTROL_STATE_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "acp-benchmark-state-"),
  );
  const config = loadConfig();
  if (config.limits?.rateLimit) {
    config.limits.rateLimit.enabled = false;
  }
  const app = await createApplication({ config });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

  try {
    const available = await fetch(`${baseUrl}/v1/executors`).then((res) =>
      res.json(),
    );
    const candidates = [
      "opencode",
      "openai-compatible",
      "deepseek",
      "claude",
      "codex",
    ];
    const targets = (available.executors ?? []).filter(
      (entry) =>
        candidates.includes(entry.id) &&
        entry.ready &&
        entry.discovery?.available !== false,
    );
    const selected = targets.length > 0 ? targets.map((entry) => entry.id) : ["opencode"];
    if (targets.length === 0) {
      console.warn(
        "No executor reported ready; continuing with opencode fallback to keep benchmark output reproducible.",
      );
    }

    const runId = Date.now();
    for (const executor of selected) {
      for (let iteration = 1; iteration <= 3; iteration += 1) {
        const workspace = createWorkspace(`${executor}-${iteration}-${runId}`);
        fs.writeFileSync(
          path.join(workspace, "README.md"),
          "# benchmark workspace\n",
          "utf8",
        );
        const result = await runPair({
          baseUrl,
          executor,
          iteration,
          workspace,
        });
        output.cases.push(result);
        await new Promise((resolve) => setTimeout(resolve, 250));
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    }

    fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
    const report = {
      ...output,
      summary: buildBenchmarkReport(output.cases),
    };
    report.generated_at = report.summary.generated_at;
    const summaryPath = path.join(projectRoot, "benchmark", "real-summary.json");
    const reportPath = path.join(projectRoot, "benchmark", "real-report.json");
    fs.writeFileSync(resultsPath, JSON.stringify(report, null, 2), "utf8");
    fs.writeFileSync(summaryPath, JSON.stringify(report.summary, null, 2), "utf8");
    fs.writeFileSync(reportPath, JSON.stringify(report.summary, null, 2), "utf8");
    console.log(JSON.stringify(report.summary, null, 2));
  } finally {
    await app.close();
  }
}

await main();
