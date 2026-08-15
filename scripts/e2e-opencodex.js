// Temporary: OpenCodex (openai-compatible) E2E validation via companion API
const base = "http://127.0.0.1:4318";
const origin = "chrome-extension://gogiddhnbglgoaakfjeiapkhffhcmjeo";
const log = (entry) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, entry);

async function json(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

const started = await json("/v1/companion/pairings", {
  method: "POST",
  headers: { origin, "content-type": "application/json" },
  body: JSON.stringify({ label: "opencodex-e2e" }),
});
log(`pairing create: ${started.status}`);
if (started.status !== 201) process.exit(1);

const approvalUrl = new URL(started.payload.approval_url);
await json(approvalUrl.pathname + approvalUrl.search, {
  method: "POST",
  headers: { origin: base },
});
const claim = await json(`/v1/companion/pairings/${started.payload.pairing_id}`, {
  headers: { "x-acp-pairing-secret": started.payload.pairing_secret },
});
log(`pairing claim: ${claim.status} ${claim.payload.status}`);
if (!claim.payload.token) process.exit(1);
const token = claim.payload.token;

const dispatched = await json("/v1/companion/tasks", {
  method: "POST",
  headers: {
    origin,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    workspace: "C:\\Users\\45928\\Documents\\Github",
    objective:
      "Run the existing add.py in the workspace and verify that the two numbers add correctly (3 + 5 = 8). Report the actual runtime output.",
    context: ["OpenCodex end-to-end validation"],
    constraints: ["Do not modify files unless necessary", "Use Python"],
    acceptance_criteria: [
      "add.py runs without errors",
      "The reported output shows 3 + 5 = 8",
    ],
    profile: "economy",
    executor: "openai-compatible",
  }),
});
log(`dispatch: ${dispatched.status}`);
if (dispatched.status !== 202) {
  log(JSON.stringify(dispatched.payload));
  process.exit(1);
}
const taskId = dispatched.payload.task.id;
log(`task ${taskId.slice(0, 8)} · ${dispatched.payload.task.status}`);

const deadline = Date.now() + 5 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const state = await json(`/v1/companion/tasks/${taskId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const task = state.payload.task;
  log(`task ${taskId.slice(0, 8)} · ${task.status}`);
  if (task.terminal) {
    log(`FINAL status=${task.status} executor=${task.executor} session=${task.executor_session_id ?? "n/a"}`);
    log(`result=${JSON.stringify(task.result)}`);
    log(`error=${task.error ? JSON.stringify(task.error).slice(0, 300) : "null"}`);
    log(`usage=${JSON.stringify(task.usage)}`);
    process.exit(task.status === "completed" ? 0 : 1);
  }
}
log("timeout");
process.exit(1);
