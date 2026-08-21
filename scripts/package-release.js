import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeZip } from "./lib/zip-store.js";
import { createSha256Manifest } from "./sha256-manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readFiles(base, relativePaths, prefix = "") {
  return relativePaths.map((relative) => {
    const file = path.resolve(base, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`Required release file is missing: ${relative}`);
    }
    return {
      name: path.posix.join(prefix, relative.replaceAll("\\", "/")),
      data: fs.readFileSync(file),
    };
  });
}

export function browserCompanionFiles(projectRoot = root) {
  const companionRoot = path.join(projectRoot, "browser-companion");
  const files = [
    "manifest.json",
    ...walkFiles(path.join(companionRoot, "src")).map((file) => `src/${file}`),
    ...walkFiles(path.join(companionRoot, "popup")).map((file) => `popup/${file}`),
  ];
  return files.sort();
}

function walkFiles(directory, relative = "") {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Required release directory is missing: ${directory}`);
  }
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    const childRelative = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(child, childRelative));
    else if (entry.isFile()) files.push(childRelative);
  }
  return files.sort();
}

export function packageBrowserCompanion(projectRoot, target) {
  const companionRoot = path.join(projectRoot, "browser-companion");
  writeZip(target, readFiles(companionRoot, browserCompanionFiles(projectRoot)));
}

function trackedFiles(projectRoot) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return output.split("\0").filter(Boolean).sort();
}

export function packageSource(projectRoot, target, version) {
  const files = trackedFiles(projectRoot);
  if (files.length === 0) throw new Error("Git reported no tracked source files.");
  writeZip(
    target,
    readFiles(projectRoot, files, `AgentControlPlane-v${version}`),
  );
}

export function main(argv = process.argv.slice(2)) {
  const outIndex = argv.indexOf("--out-dir");
  const outDir = path.resolve(outIndex >= 0 ? argv[outIndex + 1] : path.join(root, "dist"));
  if (outIndex >= 0 && !argv[outIndex + 1]) throw new Error("--out-dir requires a path.");
  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const source = path.join(outDir, `agent-control-plane-v${version}-windows.zip`);
  const companion = path.join(outDir, `agent-control-plane-browser-companion-v${version}.zip`);
  packageSource(root, source, version);
  packageBrowserCompanion(root, companion);
  const manifest = path.join(outDir, "SHA256SUMS");
  fs.writeFileSync(manifest, createSha256Manifest([source, companion]), "utf8");
  console.log(`Windows source archive: ${source}`);
  console.log(`Browser companion archive: ${companion}`);
  console.log(`SHA256 manifest: ${manifest}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
