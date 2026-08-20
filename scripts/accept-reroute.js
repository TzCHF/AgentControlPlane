import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/core/config.js";
import {
  ACCEPTANCE_REASONS,
  runRerouteAcceptance,
} from "../src/core/reroute-acceptance.js";
import { buildExecutors } from "../src/server.js";

function usage() {
  return [
    "Usage: node scripts/accept-reroute.js --to <executor> [options]",
    "",
    "Options:",
    "  --to <id>               real executor that completes the task",
    "  --reason <reason>       injected infrastructure failure",
    "  --timeout-minutes <n>   terminal wait limit (default: 10)",
    "  --config <path>         optional configuration override",
    "  --keep                  preserve the temporary workspace",
    "  --help                  show this help",
    "",
    `Reasons: ${ACCEPTANCE_REASONS.join(", ")}`,
  ].join("\n");
}

export function parseArgs(argv) {
  const options = {
    targetId: null,
    reason: "quota_exhausted",
    timeoutMinutes: 10,
    configPath: null,
    keep: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--to") options.targetId = argv[++index] ?? null;
    else if (arg === "--reason") options.reason = argv[++index] ?? null;
    else if (arg === "--config") options.configPath = argv[++index] ?? null;
    else if (arg === "--timeout-minutes") {
      options.timeoutMinutes = Number(argv[++index]);
    } else {
      throw new TypeError(`Unknown argument: ${arg}`);
    }
  }
  if (options.help) return options;
  if (!options.targetId) throw new TypeError("--to is required");
  if (!ACCEPTANCE_REASONS.includes(options.reason)) {
    throw new TypeError(`Unsupported acceptance reason: ${options.reason}`);
  }
  if (!Number.isFinite(options.timeoutMinutes) || options.timeoutMinutes <= 0) {
    throw new TypeError("--timeout-minutes must be greater than zero");
  }
  return options;
}

function safeRemoveTemporaryRoot(root) {
  const temp = path.resolve(os.tmpdir());
  const resolved = path.resolve(root);
  const relative = path.relative(temp, resolved);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(resolved).startsWith("acp-reroute-acceptance-")
  ) {
    throw new Error(`Refusing to remove non-acceptance path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return { passed: true, help: true };
  }
  const baseConfig = loadConfig(options.configPath ?? undefined);
  const configured = buildExecutors(baseConfig);
  const targetExecutor = configured.get(options.targetId);
  if (!targetExecutor) {
    throw new Error(
      `Unknown executor ${options.targetId}. Available: ${[
        ...configured.keys(),
      ].join(", ")}`,
    );
  }
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "acp-reroute-acceptance-"),
  );
  const workspace = path.join(root, "workspace");
  const stateDir = path.join(root, "state");
  try {
    const report = await runRerouteAcceptance({
      baseConfig,
      targetId: options.targetId,
      targetExecutor,
      reason: options.reason,
      workspace,
      stateDir,
      timeoutMs: options.timeoutMinutes * 60 * 1000,
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
    return report;
  } finally {
    if (options.keep) {
      console.log(`Temporary acceptance root: ${root}`);
    } else {
      safeRemoveTemporaryRoot(root);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
