import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ControlPlaneError } from "../core/errors.js";

const CLIENT_FILE_VERSION = 1;

function isoNow() {
  return new Date().toISOString();
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanLabel(value) {
  const label = String(value ?? "Browser companion")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return label || "Browser companion";
}

export function isCompanionOrigin(origin) {
  if (typeof origin !== "string") return false;
  return (
    /^chrome-extension:\/\/[a-p]{32}$/i.test(origin) ||
    /^moz-extension:\/\/[0-9a-f-]{36}$/i.test(origin)
  );
}

export class PairingManager {
  constructor({
    stateDir,
    pairingTtlMs = 10 * 60 * 1000,
    maxClients = 32,
    maxPending = 16,
    maxTasksPerClient = 500,
  }) {
    this.statePath = path.join(stateDir, "companion-clients.json");
    this.pairingTtlMs = pairingTtlMs;
    this.maxClients = maxClients;
    this.maxPending = maxPending;
    this.maxTasksPerClient = maxTasksPerClient;
    this.pending = new Map();
    fs.mkdirSync(stateDir, { recursive: true });
    this.state = this.#load();
  }

  start({ origin, label }) {
    if (!isCompanionOrigin(origin)) {
      throw new ControlPlaneError(
        "companion_origin_denied",
        "Pairing is only available to browser-extension origins",
      );
    }
    this.#prunePending();
    if (this.pending.size >= this.maxPending) {
      throw new ControlPlaneError(
        "companion_pairing_limit",
        "Too many browser companion pairing requests are pending",
      );
    }
    if (Object.keys(this.state.clients).length >= this.maxClients) {
      throw new ControlPlaneError(
        "companion_client_limit",
        "The paired browser companion limit has been reached",
      );
    }
    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(24).toString("base64url");
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    const createdAt = Date.now();
    this.pending.set(id, {
      id,
      origin,
      label: cleanLabel(label),
      secretHash: hash(secret),
      code,
      createdAt,
      expiresAt: createdAt + this.pairingTtlMs,
      status: "pending",
      token: null,
    });
    return {
      pairing_id: id,
      pairing_secret: secret,
      code,
      expires_at: new Date(createdAt + this.pairingTtlMs).toISOString(),
    };
  }

  inspect(id, secret) {
    const pairing = this.#pendingPairing(id, secret);
    return {
      pairing_id: pairing.id,
      label: pairing.label,
      origin: pairing.origin,
      code: pairing.code,
      status: pairing.status,
      expires_at: new Date(pairing.expiresAt).toISOString(),
    };
  }

  approve(id, secret) {
    const pairing = this.#pendingPairing(id, secret);
    if (pairing.status === "pending") {
      const token = `acpc_${crypto.randomBytes(32).toString("base64url")}`;
      const clientId = crypto.randomUUID();
      this.state.clients[clientId] = {
        id: clientId,
        label: pairing.label,
        origin: pairing.origin,
        token_hash: hash(token),
        created_at: isoNow(),
        last_used_at: null,
        task_ids: [],
        activated: false,
      };
      pairing.status = "approved";
      pairing.clientId = clientId;
      pairing.token = token;
      this.#persist();
    }
    return this.inspect(id, secret);
  }

  claim(id, secret, origin) {
    const pairing = this.#pendingPairing(id, secret);
    if (origin && !safeEqual(pairing.origin, origin)) {
      throw new ControlPlaneError(
        "companion_origin_denied",
        "The pairing was created by a different browser extension",
      );
    }
    if (pairing.status === "pending") {
      return { status: "pending", token: null, client_id: null };
    }
    if (pairing.status === "claimed") {
      return {
        status: "claimed",
        token: null,
        client_id: pairing.clientId,
      };
    }
    if (pairing.status !== "approved" || !pairing.token) {
      throw new ControlPlaneError("pairing_invalid", "Pairing state is invalid");
    }
    const result = {
      status: "approved",
      token: pairing.token,
      client_id: pairing.clientId,
    };
    pairing.status = "claimed";
    pairing.token = null;
    this.state.clients[pairing.clientId].activated = true;
    this.#persist();
    return result;
  }

  authenticate(token, origin) {
    if (!token) return null;
    if (origin && !isCompanionOrigin(origin)) return null;
    const tokenHash = hash(token);
    for (const client of Object.values(this.state.clients)) {
      if (
        client.activated !== false &&
        (!origin || safeEqual(client.origin, origin)) &&
        safeEqual(client.token_hash, tokenHash)
      ) {
        client.last_used_at = isoNow();
        return structuredClone(client);
      }
    }
    return null;
  }

  rememberTask(clientId, taskId) {
    const client = this.state.clients[clientId];
    if (!client) {
      throw new ControlPlaneError(
        "companion_client_not_found",
        "Paired browser companion was not found",
      );
    }
    client.task_ids = [
      taskId,
      ...client.task_ids.filter((entry) => entry !== taskId),
    ].slice(0, this.maxTasksPerClient);
    client.last_used_at = isoNow();
    this.#persist();
  }

  ownsTask(clientId, taskId) {
    return Boolean(this.state.clients[clientId]?.task_ids.includes(taskId));
  }

  listTaskIds(clientId) {
    return structuredClone(this.state.clients[clientId]?.task_ids ?? []);
  }

  revoke(clientId) {
    if (!this.state.clients[clientId]) return false;
    delete this.state.clients[clientId];
    this.#persist();
    return true;
  }

  listClients() {
    return Object.values(this.state.clients)
      .filter((client) => client.activated !== false)
      .map((client) => ({
      id: client.id,
      label: client.label,
      origin: client.origin,
      created_at: client.created_at,
      last_used_at: client.last_used_at,
      task_count: client.task_ids.length,
      }));
  }

  #pendingPairing(id, secret) {
    this.#prunePending();
    const pairing = this.pending.get(String(id));
    if (!pairing || !safeEqual(pairing.secretHash, hash(secret))) {
      throw new ControlPlaneError(
        "pairing_not_found",
        "Pairing request was not found or has expired",
      );
    }
    return pairing;
  }

  #prunePending() {
    const now = Date.now();
    let changed = false;
    for (const [id, pairing] of this.pending.entries()) {
      if (pairing.expiresAt <= now) {
        this.pending.delete(id);
        if (
          pairing.status === "approved" &&
          pairing.clientId &&
          this.state.clients[pairing.clientId]?.activated === false
        ) {
          delete this.state.clients[pairing.clientId];
          changed = true;
        }
      }
    }
    if (changed) this.#persist();
  }

  #load() {
    if (!fs.existsSync(this.statePath)) {
      return { version: CLIENT_FILE_VERSION, clients: {} };
    }
    try {
      const state = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      if (state?.version !== CLIENT_FILE_VERSION || !state.clients) {
        throw new Error("Unsupported companion client state version");
      }
      state.clients = Object.fromEntries(
        Object.entries(state.clients).filter(
          ([, client]) => client.activated !== false,
        ),
      );
      return state;
    } catch (error) {
      throw new ControlPlaneError(
        "companion_state_invalid",
        `Unable to load browser companion state: ${error.message}`,
      );
    }
  }

  #persist() {
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(temporary, this.statePath);
  }
}
