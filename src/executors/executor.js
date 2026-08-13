import { EventEmitter } from "node:events";

const requiredMethods = ["stop", "on"];
const executionMethods = ["start", "request", "respond"];

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
      ready: Boolean(this.ready),
      capabilities: structuredClone(this.capabilities),
    };
  }
}
