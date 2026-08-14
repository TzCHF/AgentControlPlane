import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isCompanionOrigin,
  PairingManager,
} from "../src/companion/pairing-manager.js";

const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;

test("recognizes supported browser-extension origins", () => {
  assert.equal(isCompanionOrigin(extensionOrigin), true);
  assert.equal(
    isCompanionOrigin("moz-extension://12345678-1234-1234-1234-123456789abc"),
    true,
  );
  assert.equal(isCompanionOrigin("https://attacker.example"), false);
});

test("pairs a browser companion without persisting its raw token", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-companion-"));
  const manager = new PairingManager({ stateDir });
  const started = manager.start({
    origin: extensionOrigin,
    label: "DeepSeek tab",
  });
  const pending = manager.inspect(
    started.pairing_id,
    started.pairing_secret,
  );
  assert.equal(pending.status, "pending");
  assert.match(pending.code, /^\d{6}$/);

  manager.approve(started.pairing_id, started.pairing_secret);
  const claim = manager.claim(
    started.pairing_id,
    started.pairing_secret,
    extensionOrigin,
  );
  assert.equal(claim.status, "approved");
  assert.match(claim.token, /^acpc_/);

  const client = manager.authenticate(claim.token, extensionOrigin);
  assert.equal(client.label, "DeepSeek tab");
  manager.rememberTask(client.id, "task-1");
  assert.equal(manager.ownsTask(client.id, "task-1"), true);

  const persisted = fs.readFileSync(
    path.join(stateDir, "companion-clients.json"),
    "utf8",
  );
  assert.equal(persisted.includes(claim.token), false);
  assert.match(persisted, /"token_hash"/);
  assert.equal(
    manager.claim(
      started.pairing_id,
      started.pairing_secret,
      extensionOrigin,
    ).status,
    "claimed",
  );
  assert.equal(manager.revoke(client.id), true);
  assert.equal(manager.authenticate(claim.token, extensionOrigin), null);
});

test("does not release a pairing token to a different extension", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-companion-"));
  const manager = new PairingManager({ stateDir });
  const started = manager.start({ origin: extensionOrigin });
  manager.approve(started.pairing_id, started.pairing_secret);
  assert.throws(
    () =>
      manager.claim(
        started.pairing_id,
        started.pairing_secret,
        `chrome-extension://${"b".repeat(32)}`,
      ),
    /different browser extension/,
  );
});

test("claims and authenticates without an Origin header", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-companion-"));
  const manager = new PairingManager({ stateDir });
  const started = manager.start({
    origin: extensionOrigin,
    label: "DeepSeek tab",
  });
  manager.approve(started.pairing_id, started.pairing_secret);
  const claim = manager.claim(started.pairing_id, started.pairing_secret, undefined);
  assert.equal(claim.status, "approved");
  const client = manager.authenticate(claim.token, undefined);
  assert.equal(client.label, "DeepSeek tab");
  assert.equal(manager.authenticate(claim.token, "https://attacker.example"), null);
  assert.equal(
    manager.authenticate(claim.token, `chrome-extension://${"b".repeat(32)}`),
    null,
  );
});
