import { EventEmitter } from "node:events";

const requiredMethods = ["stop", "on"];
const executionMethods = ["start", "request", "respond"];

export function formatCliExitError(label, code, stderr = "") {
  const detail = String(stderr)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(-1000);
  const base = `${label} exited with code ${code}`;
  return detail ? `${base}: ${detail}` : base;
}

export function assertExecutor(executor, { execution = false } = {}) {
  if (!executor || typeof executor !== "object") {
    throw new TypeError("Executor must be an object");
  }
  for (const method of requiredMethods) {
    if (typeof executor[method] !== "function") {
      throw new TypeError(`Executor must implement ${method}()`);
    }
  }
  if (execution) {
    for (const method of executionMethods) {
      if (typeof executor[method] !== "function") {
        throw new TypeError(`Executor must implement ${method}()`);
      }
    }
  }
  return executor;
}

export class ExecutorAdapter extends EventEmitter {
  constructor({ id, displayName, capabilities = {} }) {
    super();
    this.id = id;
    this.displayName = displayName;
    this.capabilities = {
      persistentThreads: false,
      tokenUsage: false,
      hardInterrupt: false,
      subagents: false,
      ...capabilities,
    };
    this.ready = false;
    this.requiresWindowsSandbox = false;
    this.discovery = {
      available: null,
      status: "unknown",
      reason: null,
      detail: null,
      command: null,
      version: null,
      checked_at: null,
    };
  }

  async probe() {
    return { available: true, status: "available", reason: null };
  }

  setDiscovery(result = {}) {
    this.discovery = {
      ...this.discovery,
      ...result,
      available:
        result.available === undefined
          ? this.discovery.available
          : Boolean(result.available),
    };
    return structuredClone(this.discovery);
  }

  async start() {
    throw new Error("ExecutorAdapter.start() must be implemented");
  }

  async stop() {
    throw new Error("ExecutorAdapter.stop() must be implemented");
  }

  async request() {
    throw new Error("ExecutorAdapter.request() must be implemented");
  }

  respond() {
    throw new Error("ExecutorAdapter.respond() must be implemented");
  }

  describe() {
    return {
      id: this.id,
      display_name: this.displayName,
      kind: this.kind ?? null,
      ready: Boolean(this.ready),
      discovery: structuredClone(this.discovery),
      capabilities: structuredClone(this.capabilities),
    };
  }
}
