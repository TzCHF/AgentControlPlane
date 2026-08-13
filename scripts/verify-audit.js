import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

function defaultStateDir() {
  const explicit = process.env.AGENT_CONTROL_STATE_DIR;
  if (explicit) return explicit;
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? os.homedir(),
      "AgentControlPlane",
      "state",
    );
  }
  return path.join(
    process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
    "agent-control-plane",
  );
}

const stateDir = process.argv[2] ? path.resolve(process.argv[2]) : defaultStateDir();
const key = process.env.AGENT_CONTROL_AUDIT_KEY ?? null;

function digest(value) {
  if (key) {
    return crypto.createHmac("sha256", key).update(value).digest("hex");
  }
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

const lines = [
  ...readLines(path.join(stateDir, "audit.jsonl.1")),
  ...readLines(path.join(stateDir, "audit.jsonl")),
];

if (lines.length === 0) {
  console.log("No audit entries found.");
  process.exit(0);
}

let failures = 0;
let legacyCount = 0;
let chainEntries = 0;
let previous = null;
let expectedSeq = null;
let chainStarted = false;

lines.forEach((line, index) => {
  const lineNumber = index + 1;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    console.log(`Line ${lineNumber}: invalid JSON`);
    failures += 1;
    return;
  }
  const hasChain = typeof entry.seq === "number" && typeof entry.h === "string";
  if (!hasChain) {
    if (!chainStarted) {
      legacyCount += 1;
      return;
    }
    console.log(`Line ${lineNumber}: missing integrity hash inside the chain`);
    failures += 1;
    return;
  }
  chainStarted = true;
  chainEntries += 1;
  const { h, ...rest } = entry;
  if (digest(JSON.stringify(rest)) !== h) {
    console.log(`Line ${lineNumber}: hash mismatch (seq ${entry.seq})`);
    failures += 1;
    return;
  }
  if (expectedSeq === null) expectedSeq = entry.seq;
  if (entry.seq !== expectedSeq) {
    console.log(
      `Line ${lineNumber}: sequence gap (expected ${expectedSeq}, got ${entry.seq})`,
    );
    failures += 1;
  }
  expectedSeq = entry.seq + 1;
  if (chainEntries === 1 && entry.prev !== null) {
    console.log(`Line ${lineNumber}: first chained entry must have null prev`);
    failures += 1;
  } else if (chainEntries > 1 && entry.prev !== previous) {
    console.log(`Line ${lineNumber}: broken chain (prev mismatch)`);
    failures += 1;
  }
  previous = h;
});

if (failures > 0) {
  console.log(
    `Audit integrity check FAILED: ${failures} problem(s) across ${lines.length} entries.`,
  );
  process.exit(1);
}
console.log(
  `Audit integrity check passed: ${chainEntries} chained entries form a valid chain${legacyCount ? ` (${legacyCount} legacy entries without a hash)` : ""}.`,
);
