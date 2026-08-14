import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function backgroundHarness() {
  const storage = {};
  const openedTabs = [];
  let onMessage;
  const requests = [];
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(
            keys.filter((key) => key in storage).map((key) => [key, storage[key]]),
          );
        },
        async set(patch) {
          Object.assign(storage, structuredClone(patch));
        },
      },
    },
    tabs: {
      async create(options) {
        openedTabs.push(options);
        return { id: openedTabs.length };
      },
    },
    permissions: { async request() { return true; } },
    scripting: {
      async getRegisteredContentScripts() { return []; },
      async unregisterContentScripts() {},
      async registerContentScripts() {},
    },
    runtime: {
      lastError: null,
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(listener) {
          onMessage = listener;
        },
      },
    },
  };
  const fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const pathname = new URL(url).pathname;
    if (pathname === "/v1/companion/pairings" && options.method === "POST") {
      return jsonResponse({
        pairing_id: "pair-1",
        pairing_secret: "secret-1",
        code: "123456",
        expires_at: new Date(Date.now() + 60000).toISOString(),
        approval_url: "http://127.0.0.1:4318/companion/approve?id=pair-1",
      }, 201);
    }
    if (pathname === "/v1/companion/pairings/pair-1") {
      return jsonResponse({
        status: "approved",
        token: "acpc_test",
        client_id: "client-1",
      });
    }
    if (pathname === "/v1/companion/options") {
      return jsonResponse({ default_executor: "opencode" });
    }
    if (pathname === "/v1/companion/tasks" && options.method === "POST") {
      return jsonResponse({ task: { id: "task-1", terminal: false } }, 202);
    }
    if (pathname === "/v1/companion/tasks/task-1") {
      return jsonResponse({
        task: { id: "task-1", status: "completed", terminal: true },
      });
    }
    if (pathname === "/v1/companion/session" && options.method === "DELETE") {
      return jsonResponse({ revoked: true });
    }
    return jsonResponse({ error: { message: `Unhandled ${pathname}` } }, 500);
  };
  const context = vm.createContext({
    chrome,
    fetch,
    URL,
    Response,
    Date,
    Math,
    JSON,
    String,
    Array,
    Object,
    Promise,
    Error,
    encodeURIComponent,
    structuredClone,
  });
  const source = fs.readFileSync(
    path.resolve("browser-companion", "src", "background.js"),
    "utf8",
  );
  vm.runInContext(source, context, { filename: "background.js" });

  const send = (type, payload = {}) =>
    new Promise((resolve, reject) => {
      const keepAlive = onMessage({ type, ...payload }, {}, (response) => {
        if (response.ok) resolve(response.result);
        else reject(new Error(response.error));
      });
      assert.equal(keepAlive, true);
    });
  return { send, storage, openedTabs, requests };
}

test("background pairs, deduplicates, resumes, and clears terminal tasks", async () => {
  const harness = backgroundHarness();
  const started = await harness.send("ACP_PAIR_START", { label: "test" });
  assert.equal(started.code, "123456");
  assert.equal(harness.openedTabs.length, 1);
  assert.equal((await harness.send("ACP_PAIR_STATUS")).status, "connected");
  assert.equal((await harness.send("ACP_STATE")).connected, true);

  const first = await harness.send("ACP_CLAIM_ENVELOPE", {
    pageUrl: "https://chat.deepseek.com/a/chat/s/1",
    envelopeId: "abc",
  });
  const duplicate = await harness.send("ACP_CLAIM_ENVELOPE", {
    pageUrl: "https://chat.deepseek.com/a/chat/s/1",
    envelopeId: "abc",
  });
  assert.equal(first.claimed, true);
  assert.equal(duplicate.claimed, false);
  await harness.send("ACP_RELEASE_ENVELOPE", {
    pageUrl: "https://chat.deepseek.com/a/chat/s/1",
    envelopeId: "abc",
  });
  assert.equal(
    (
      await harness.send("ACP_CLAIM_ENVELOPE", {
        pageUrl: "https://chat.deepseek.com/a/chat/s/1",
        envelopeId: "abc",
      })
    ).claimed,
    true,
  );

  await harness.send("ACP_DISPATCH", {
    pageUrl: "https://chat.deepseek.com/a/chat/s/1",
    request: { workspace: "C:\\work", objective: "test" },
  });
  assert.deepEqual(
    (
      await harness.send("ACP_ACTIVE_TASKS", {
        pageUrl: "https://chat.deepseek.com/a/chat/s/1",
      })
    ).task_ids,
    ["task-1"],
  );
  await harness.send("ACP_TASK_STATUS", { taskId: "task-1" });
  assert.deepEqual(harness.storage.activeTasks, []);
  await harness.send("ACP_DISCONNECT");
  assert.equal((await harness.send("ACP_STATE")).connected, false);
});
