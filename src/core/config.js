import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ControlPlaneError } from "./errors.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..");

function merge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? merge(base?.[key] ?? {}, value)
        : value;
  }
  return result;
}

export function loadConfig(configPath = process.env.AGENT_CONTROL_CONFIG) {
  const defaultPath = path.join(projectRoot, "config", "default.json");
  const parseJsonFile = (target) =>
    JSON.parse(fs.readFileSync(target, "utf8").replace(/^\uFEFF/, ""));
  const defaults = parseJsonFile(defaultPath);
  let config = defaults;

  if (configPath) {
    const absolute = path.resolve(configPath);
    if (!fs.existsSync(absolute)) {
      throw new ControlPlaneError(
        "config_not_found",
        `Configuration file does not exist: ${absolute}`,
      );
    }
    config = merge(defaults, parseJsonFile(absolute));
  }

  if (process.env.AGENT_CONTROL_PORT) {
    config.server.port = Number(process.env.AGENT_CONTROL_PORT);
  }
  if (process.env.AGENT_CONTROL_HOST) {
    config.server.host = process.env.AGENT_CONTROL_HOST;
  }
  if (!Number.isInteger(config.server.port) || config.server.port < 1) {
    throw new ControlPlaneError("invalid_config", "server.port must be a valid port");
  }

  config.projectRoot = projectRoot;
  if (!Array.isArray(config.workspaceRoots) || config.workspaceRoots.length === 0) {
    config.workspaceRoots = [path.dirname(projectRoot)];
  }
  config.stateDir = path.resolve(
    process.env.AGENT_CONTROL_STATE_DIR ??
      path.join(projectRoot, ".agent-control"),
  );
  return config;
}
