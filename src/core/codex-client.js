import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { ControlPlaneError } from "./errors.js";

export class CodexAppServerClient extends EventEmitter {
  constructor({ command = "codex", requestTimeoutMs = 30000 } = {}) {
    super();
    this.command = command;
    this.requestTimeoutMs = requestTimeoutMs;
    this.process = null;
    this.nextId = 1;
    this.pending = new Map();
    this.ready = false;
  }

  async start() {
    if (this.ready) return;
    if (this.process) throw new Error("Codex app-server is already starting");

    this.process = spawn(
      this.command,
      ["app-server", "--stdio", "--enable", "multi_agent"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    const stdout = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });
    stdout.on("line", (line) => this.#handleLine(line));
    this.process.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.emit("stderr", text);
    });
    this.process.on("exit", (code, signal) => {
      this.ready = false;
      this.process = null;
      const error = new ControlPlaneError(
        "codex_app_server_exited",
        `Codex app-server exited (code=${code}, signal=${signal})`,
      );
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      this.emit("exit", { code, signal });
    });
    this.process.on("error", (error) => {
      this.emit("error", error);
    });

    await this.request("initialize", {
      clientInfo: {
        name: "agent-control-plane",
        title: "AgentControlPlane",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify("initialized");
    this.ready = true;
  }

  stop() {
    if (!this.process) return;
    this.process.kill();
  }

  request(method, params = null, timeoutMs = this.requestTimeoutMs) {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(
        new ControlPlaneError(
          "codex_app_server_unavailable",
          "Codex app-server is not running",
        ),
      );
    }
    const id = this.nextId++;
    const payload = { id, method, params };
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ControlPlaneError(
            "codex_request_timeout",
            `Codex request timed out: ${method}`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
    });
  }

  notify(method, params = undefined) {
    if (!this.process?.stdin?.writable) return;
    const payload = params === undefined ? { method } : { method, params };
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  respond(id, result) {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("protocolError", { line });
      return;
    }

    if (Object.hasOwn(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new ControlPlaneError(
            "codex_rpc_error",
            message.error.message ?? `Codex request failed: ${pending.method}`,
            message.error,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (Object.hasOwn(message, "id") && message.method) {
      this.emit("serverRequest", message);
      return;
    }

    if (message.method) {
      this.emit("notification", message);
    }
  }
}

