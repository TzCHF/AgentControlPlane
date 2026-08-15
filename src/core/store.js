import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ControlPlaneError } from "./errors.js";

function now() {
  return new Date().toISOString();
}

function emptyState() {
  return {
    version: 1,
    projects: {},
    tasks: {},
  };
}

export class TaskStore {
  constructor(
    stateDir,
    maxEvents = 500,
    maxTasks = 2000,
    maxAuditBytes = 10 * 1024 * 1024,
    integrityKey = null,
  ) {
    this.stateDir = stateDir;
    this.statePath = path.join(stateDir, "state.json");
    this.auditPath = path.join(stateDir, "audit.jsonl");
    this.auditArchivePath = path.join(stateDir, "audit.jsonl.1");
    this.maxEvents = maxEvents;
    this.maxTasks = maxTasks;
    this.maxAuditBytes = maxAuditBytes;
    this.integrityKey =
      typeof integrityKey === "string" && integrityKey.length > 0
        ? integrityKey
        : null;
    this.auditSeq = 1;
    this.auditPrev = null;
    fs.mkdirSync(stateDir, { recursive: true });
    this.state = fs.existsSync(this.statePath)
      ? JSON.parse(fs.readFileSync(this.statePath, "utf8"))
      : emptyState();
    this.#restoreAuditChain();
  }

  persist() {
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(temporary, this.statePath);
  }

  audit(type, payload) {
    if (
      fs.existsSync(this.auditPath) &&
      fs.statSync(this.auditPath).size >= this.maxAuditBytes
    ) {
      fs.rmSync(this.auditArchivePath, { force: true });
      fs.renameSync(this.auditPath, this.auditArchivePath);
    }
    const entry = {
      at: now(),
      type,
      ...payload,
      seq: this.auditSeq,
      prev: this.auditPrev,
    };
    const digest = this.#auditDigest(JSON.stringify(entry));
    entry.h = digest;
    fs.appendFileSync(
      this.auditPath,
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
    this.auditSeq += 1;
    this.auditPrev = digest;
  }

  #auditDigest(value) {
    if (this.integrityKey) {
      return crypto.createHmac("sha256", this.integrityKey).update(value).digest("hex");
    }
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  #restoreAuditChain() {
    const last =
      this.#readLastAuditLine(this.auditPath) ??
      this.#readLastAuditLine(this.auditArchivePath);
    if (!last) return;
    try {
      const entry = JSON.parse(last);
      if (entry && typeof entry.seq === "number") {
        this.auditSeq = entry.seq + 1;
        this.auditPrev = typeof entry.h === "string" ? entry.h : null;
      }
    } catch {
      // An unreadable tail line leaves the chain at its initial state.
    }
  }

  #readLastAuditLine(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (line) return line;
    }
    return null;
  }

  createTask({
    workspace,
    brief,
    policy,
    parentTaskId = null,
    executor = null,
    estimatedMinutes = null,
  }) {
    this.#pruneTasks();
    const id = crypto.randomUUID();
    const task = {
      id,
      parentTaskId,
      workspace,
      brief,
      policy,
      executor,
      estimatedMinutes,
      status: "queued",
      createdAt: now(),
      updatedAt: now(),
      startedAt: null,
      completedAt: null,
      threadId: null,
      turnId: null,
      executorSessionId: null,
      result: null,
      error: null,
      usage: null,
      subagents: [],
      events: [],
    };
    this.state.tasks[id] = task;
    this.persist();
    this.audit("task.created", {
      taskId: id,
      workspace,
      policy: policy.name,
    });
    return structuredClone(task);
  }

  updateTask(id, patch) {
    const task = this.state.tasks[id];
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: now() });
    this.persist();
    return structuredClone(task);
  }

  addEvent(id, event) {
    const task = this.state.tasks[id];
    if (!task) return;
    task.events.push({ at: now(), ...event });
    if (task.events.length > this.maxEvents) {
      task.events.splice(0, task.events.length - this.maxEvents);
    }
    task.updatedAt = now();
    this.persist();
    this.audit("task.event", {
      taskId: id,
      method: event.method ?? event.type ?? "event",
    });
  }

  getTask(id, includeEvents = false) {
    const task = this.state.tasks[id];
    if (!task) return null;
    const copy = structuredClone(task);
    if (!includeEvents) delete copy.events;
    return copy;
  }

  listTasks(limit = 20) {
    return Object.values(this.state.tasks)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((task) => {
        const copy = structuredClone(task);
        delete copy.events;
        return copy;
      });
  }

  listByStatus(statuses) {
    const wanted = new Set(statuses);
    return Object.values(this.state.tasks)
      .filter((task) => wanted.has(task.status))
      .map((task) => structuredClone(task));
  }

  getProject(workspace) {
    return structuredClone(this.state.projects[workspace] ?? null);
  }

  setProject(workspace, patch) {
    const current = this.state.projects[workspace] ?? {
      workspace,
      threadId: null,
      createdAt: now(),
    };
    this.state.projects[workspace] = {
      ...current,
      ...patch,
      updatedAt: now(),
    };
    this.persist();
    return structuredClone(this.state.projects[workspace]);
  }

  usageReport() {
    const total = {
      input_tokens: 0,
      cached_input_tokens: 0,
      uncached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 0,
      tasks_with_usage: 0,
    };
    for (const task of Object.values(this.state.tasks)) {
      if (!task.usage) continue;
      total.tasks_with_usage += 1;
      for (const key of Object.keys(total)) {
        if (key === "tasks_with_usage") continue;
        if (key === "uncached_input_tokens") {
          total[key] += Math.max(
            0,
            Number(task.usage.input_tokens ?? 0) -
              Number(task.usage.cached_input_tokens ?? 0),
          );
        } else {
          total[key] += Number(task.usage[key] ?? 0);
        }
      }
    }
    return total;
  }

  #pruneTasks() {
    const tasks = Object.values(this.state.tasks);
    if (tasks.length < this.maxTasks) return;
    const terminal = new Set([
      "completed",
      "partial",
      "blocked",
      "failed",
      "cancelled",
      "interrupted",
    ]);
    const removable = tasks
      .filter((task) => terminal.has(task.status))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const removeCount = tasks.length - this.maxTasks + 1;
    if (removable.length < removeCount) {
      throw new ControlPlaneError(
        "task_capacity_reached",
        "Stored task capacity is full of active work",
      );
    }
    for (const task of removable.slice(0, removeCount)) {
      delete this.state.tasks[task.id];
    }
    this.persist();
  }
}
