const baseUrl = process.env.AGENT_CONTROL_URL ?? "http://127.0.0.1:4318";
const origin = `chrome-extension://${"a".repeat(32)}`;

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed (${response.status}): ${payload?.error?.message ?? "unknown error"}`,
    );
  }
  return payload;
}

const pairing = await json("/v1/companion/pairings", {
  method: "POST",
  headers: { origin, "content-type": "application/json" },
  body: JSON.stringify({ label: "Companion live smoke test" }),
});
const approvalUrl = new URL(pairing.approval_url);
const approvalPath = `${approvalUrl.pathname}${approvalUrl.search}`;
const page = await fetch(pairing.approval_url);
if (!page.ok || !(await page.text()).includes("Approve companion")) {
  throw new Error("Pairing approval page was not rendered");
}
const approval = await fetch(pairing.approval_url, {
  method: "POST",
  headers: { origin: baseUrl },
});
if (!approval.ok) throw new Error(`Pairing approval failed (${approval.status})`);

const claim = await json(`/v1/companion/pairings/${pairing.pairing_id}`, {
  headers: {
    origin,
    "x-acp-pairing-secret": pairing.pairing_secret,
  },
});
const authHeaders = { origin, authorization: `Bearer ${claim.token}` };
const options = await json("/v1/companion/options", { headers: authHeaders });
await json("/v1/companion/session", {
  method: "DELETE",
  headers: authHeaders,
});

console.log(
  JSON.stringify(
    {
      status: "passed",
      service_version: options.version,
      default_executor: options.default_executor,
      executor_count: options.executors.length,
      workspace_count: options.workspaces.length,
      approval_path: approvalPath.replace(/secret=[^&]+/, "secret=<redacted>"),
      session_revoked: true,
    },
    null,
    2,
  ),
);
