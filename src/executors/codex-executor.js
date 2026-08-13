import { CodexAppServerClient } from "../core/codex-client.js";
import { ExecutorAdapter } from "./executor.js";

export class CodexExecutor extends ExecutorAdapter {
  constructor(options) {
    super({
      id: "codex",
      displayName: "Codex App Server",
      capabilities: {
        persistentThreads: true,
        tokenUsage: true,
        hardInterrupt: true,
        subagents: true,
      },
    });
    this.client = new CodexAppServerClient(options);
    for (const event of ["notification", "serverRequest", "stderr"] ) {
      this.client.on(event, (payload) => this.emit(event, payload));
    }
  }

  async start() {
    await this.client.start();
    this.ready = Boolean(this.client.ready);
  }

  async stop() {
    await this.client.stop();
    this.ready = false;
  }

  request(...args) {
    return this.client.request(...args);
  }

  respond(...args) {
    return this.client.respond(...args);
  }

  listModels(params = {}) {
    return this.client.request("model/list", params);
  }

  getSandboxReadiness(params = {}) {
    return this.client.request("windowsSandbox/readiness", params);
  }

  startThread(params) {
    return this.client.request("thread/start", params);
  }

  resumeThread(params) {
    return this.client.request("thread/resume", params);
  }

  setGoal(params) {
    return this.client.request("thread/goal/set", params);
  }

  getGoal(params, timeoutMs) {
    return this.client.request("thread/goal/get", params, timeoutMs);
  }

  startTurn(params) {
    return this.client.request("turn/start", params);
  }

  interruptTurn(params, timeoutMs) {
    return this.client.request("turn/interrupt", params, timeoutMs);
  }
}
