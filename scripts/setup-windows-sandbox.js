import { CodexAppServerClient } from "../src/core/codex-client.js";

if (process.platform !== "win32") {
  console.log("Windows sandbox setup is not required on this platform.");
  process.exit(0);
}

const client = new CodexAppServerClient();
let completeSetup;
const setupCompleted = new Promise((resolve) => {
  completeSetup = resolve;
});

client.on("notification", (message) => {
  if (message.method === "windowsSandbox/setupCompleted") {
    completeSetup(message.params);
  }
});

try {
  await client.start();
  const before = await client.request("windowsSandbox/readiness", {});
  if (before.status === "ready") {
    console.log("Codex Windows sandbox is already ready.");
  } else {
    const started = await client.request("windowsSandbox/setup/start", {
      mode: "unelevated",
      cwd: process.cwd(),
    });
    if (!started.started) {
      throw new Error("Codex declined to start Windows sandbox setup.");
    }
    const result = await Promise.race([
      setupCompleted,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Windows sandbox setup timed out.")),
          120000,
        ),
      ),
    ]);
    if (!result.success) {
      throw new Error(result.error ?? "Windows sandbox setup failed.");
    }
    const after = await client.request("windowsSandbox/readiness", {});
    console.log(`Codex Windows sandbox status: ${after.status}`);
    if (after.status !== "ready") process.exitCode = 1;
  }
} finally {
  client.stop();
}
