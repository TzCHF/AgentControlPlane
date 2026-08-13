import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../src/core/store.js";

test("persists tasks, projects, events, and usage totals", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-store-"));
  const store = new TaskStore(stateDir, 2);
  const task = store.createTask({
    workspace: "C:\\workspace",
    brief: { objective: "test" },
    policy: { name: "economy" },
  });
  store.updateTask(task.id, {
    usage: {
      input_tokens: 10,
      cached_input_tokens: 4,
      output_tokens: 3,
      reasoning_output_tokens: 2,
      total_tokens: 15,
    },
  });
  store.addEvent(task.id, { method: "one" });
  store.addEvent(task.id, { method: "two" });
  store.addEvent(task.id, { method: "three" });
  store.setProject("C:\\workspace", { threadId: "thread-1" });

  const reloaded = new TaskStore(stateDir, 2);
  assert.equal(reloaded.getProject("C:\\workspace").threadId, "thread-1");
  assert.equal(reloaded.getTask(task.id, true).events.length, 2);
  assert.equal(reloaded.usageReport().total_tokens, 15);
  assert.equal(reloaded.usageReport().uncached_input_tokens, 6);
  assert.equal(reloaded.listByStatus(["queued"]).length, 1);
});
