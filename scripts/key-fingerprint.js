// Prints a masked identity for the configured relay key without ever
// printing the key itself: SHA-256 fingerprint prefix, length, and source.
// Reads ASTERROUTE_API_KEY from the environment first, then falls back to
// config/local.json (which should normally hold null).
import crypto from "node:crypto";
import fs from "node:fs";

const envKey = process.env.ASTERROUTE_API_KEY ?? null;
let fileKey = null;
try {
  const config = JSON.parse(fs.readFileSync("config/local.json", "utf8"));
  fileKey = config?.executor?.relays?.[0]?.apiKey ?? null;
} catch {
  /* config unreadable */
}
const key = envKey ?? fileKey;
if (!key) {
  console.log("key: not configured (env or local.json)");
  process.exit(1);
}
const fingerprint = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
console.log(
  `key source: ${envKey ? "ASTERROUTE_API_KEY" : "config/local.json"} · ` +
    `length: ${key.length} · sha256[0:16]: ${fingerprint}`,
);
