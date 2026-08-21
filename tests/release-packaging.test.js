import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  browserCompanionFiles,
  packageBrowserCompanion,
  packageSource,
} from "../scripts/package-release.js";
import { createSha256Manifest } from "../scripts/sha256-manifest.js";
import { createZip, listZipEntryNames } from "../scripts/lib/zip-store.js";

test("ZIP output is byte-identical for the same entries", () => {
  const entries = [
    { name: "b.txt", data: Buffer.from("two") },
    { name: "a.txt", data: Buffer.from("one") },
  ];
  assert.deepEqual(createZip(entries), createZip([...entries].reverse()));
  assert.deepEqual(listZipEntryNames(createZip(entries)), ["a.txt", "b.txt"]);
});

test("browser companion archive contains the exact public payload", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-browser-zip-"));
  try {
    const target = path.join(temp, "companion.zip");
    packageBrowserCompanion(root, target);
    assert.deepEqual(
      listZipEntryNames(fs.readFileSync(target)),
      browserCompanionFiles(root),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("source archive contains tracked files under one versioned root", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-source-zip-"));
  try {
    const target = path.join(temp, "source.zip");
    packageSource(root, target, "test");
    const names = listZipEntryNames(fs.readFileSync(target));
    assert.ok(names.includes("AgentControlPlane-vtest/package.json"));
    assert.ok(names.every((name) => name.startsWith("AgentControlPlane-vtest/")));
    assert.equal(names.some((name) => name.includes("config/local.json")), false);
    assert.equal(names.some((name) => name.includes("node_modules/")), false);
    assert.equal(names.some((name) => name.includes("dist/")), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("SHA256 manifest uses stable filename ordering and known hashes", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-sha256-"));
  try {
    const alpha = path.join(temp, "alpha.txt");
    const beta = path.join(temp, "beta.txt");
    fs.writeFileSync(alpha, "alpha");
    fs.writeFileSync(beta, "beta");
    const manifest = createSha256Manifest([beta, alpha]);
    const alphaHash = crypto.createHash("sha256").update("alpha").digest("hex");
    assert.equal(manifest.split("\n")[0], `${alphaHash}  alpha.txt`);
    assert.match(manifest, /beta\.txt\n$/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("SHA256 manifest rejects missing files and directories", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-sha256-invalid-"));
  try {
    assert.throws(() => createSha256Manifest([path.join(temp, "missing.zip")]), /does not exist/);
    assert.throws(() => createSha256Manifest([temp]), /not a file/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
