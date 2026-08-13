import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Orchestrator } from "../src/core/orchestrator.js";
import { TaskStore } from "../src/core/store.js";

class RecoveryCodex extends EventEmitter {
  async start() {}

  async request(method) {
    if (method === "model/list") {
      return { data: [] };
    }
    if (method === "windowsSandbox/readiness") {
      return { status: "ready" };
    }
    if (method === "thread/resume") {
      return {
        thread: {
          turns: [
            {
              id: "recovered-turn",
              status: "failed",
              error: { message: "network unavailable" },
              items: [],
            },
          ],
        },
      };
    }
    return {};
  }

  respond() {}
}

test("reconciles a stale running task from persisted Codex history", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-recovery-"));
  const store = new TaskStore(stateDir);
  const task = store.createTask({
    workspace: "C:\\workspace",
    brief: { objective: "test" },
    policy: { name: "economy" },
  });
  store.updateTask(task.id, {
    status: "running",
    threadId: "thread-1",
    turnId: "old-turn",
  });

  const config = {
    limits: { maxConcurrentTasks: 1 },
  };
  const orchestrator = new Orchestrator({
    config,
    store,
    codex: new RecoveryCodex(),
  });
  await orchestrator.start();

  const recovered = store.getTask(task.id, true);
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.turnId, "recovered-turn");
  assert.equal(recovered.error.message, "network unavailable");
  assert.equal(recovered.events.at(-1).type, "task.recovered");
});
