#!/usr/bin/env node
// Docs link checker.
//
// Scans markdown files for relative links and verifies each target exists
// on disk. Prints every broken link as <file>:<line>: broken link -> <target>
// and exits with code 1 when any broken link exists.
//
// Usage:
//   node scripts/check-docs-links.js                 # scan README + docs/*
//   node scripts/check-docs-links.js <file>...       # scan the given files
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const FENCE_RE = /^\s*(```|~~~)/;

function ignoredTarget(raw) {
  const target = raw.trim();
  if (!target) return true;
  if (/^(https?:\/\/|mailto:)/i.test(target)) return true;
  if (target.startsWith("#")) return true;
  if (target.startsWith("<") && target.endsWith(">")) return true; // placeholder
  // Absolute filesystem paths are machine-specific or placeholder targets;
  // this checker verifies repository-relative links only.
  if (path.isAbsolute(target.split(/[?#]/)[0])) return true;
  return false;
}

function stripInlineCode(line) {
  // Remove `inline code` spans; text inside them is code, and the checker
  // validates markdown links only.
  return line.replace(/`[^`]*`/g, "");
}

function targetPath(raw) {
  // Drop an optional title suffix: [text](target "title")
  const target = raw.trim().split(/\s+"[^"]*"$/)[0].trim();
  return target.split(/[?#]/)[0];
}

function scanFile(absFile) {
  const content = fs.readFileSync(absFile, "utf8");
  const lines = content.split("\n");
  const broken = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const code = stripInlineCode(line);
    LINK_RE.lastIndex = 0;
    let match;
    while ((match = LINK_RE.exec(code)) !== null) {
      const raw = match[2];
      if (ignoredTarget(raw)) continue;
      const rel = targetPath(raw);
      if (!rel) continue;
      const abs = path.resolve(path.dirname(absFile), rel);
      if (!fs.existsSync(abs)) {
        broken.push(`${absFile}:${i + 1}: broken link -> ${raw}`);
      }
    }
  }
  return broken;
}

function defaultFiles() {
  const files = ["README.md", "README.zh-CN.md"];
  const docsDir = path.join(root, "docs");
  for (const name of fs.readdirSync(docsDir)) {
    if (name.endsWith(".md")) files.push(path.join("docs", name));
  }
  return files;
}

const given = process.argv.slice(2);
const files = given.length > 0 ? given : defaultFiles();

const allBroken = [];
for (const file of files) {
  const abs = path.resolve(root, file);
  if (!fs.existsSync(abs)) {
    console.error(`${file}: file not found`);
    process.exitCode = 1;
    continue;
  }
  allBroken.push(...scanFile(abs));
}

for (const entry of allBroken) console.log(entry);
if (allBroken.length > 0) process.exit(1);
