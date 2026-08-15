import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve("browser-companion");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
);
if (manifest.manifest_version !== 3 || manifest.version !== "0.4.1") {
  throw new Error("Browser companion manifest is not v0.4.1 Manifest V3");
}

const files = [
  "src/background.js",
  "src/content.js",
  "src/panel.js",
  "src/protocol.js",
  "src/site-adapters.js",
  "popup/popup.js",
];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${file} failed syntax validation:\n${result.stderr}`);
  }
}
const harness = path.resolve(
  "tests",
  "fixtures",
  "companion-harness",
  "harness.js",
);
const harnessResult = spawnSync(process.execPath, ["--check", harness], {
  encoding: "utf8",
});
if (harnessResult.status !== 0) {
  throw new Error(`Browser harness failed syntax validation:\n${harnessResult.stderr}`);
}
console.log(`Browser companion validated (${files.length + 1} scripts)`);
