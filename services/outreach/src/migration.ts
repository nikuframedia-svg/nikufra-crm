import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool } from "./db.js";
import { HttpError } from "./errors.js";

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isLegacySecretKey(value: string) {
  const key = normalizedKey(value);
  return key.includes("credential")
    || key.includes("password")
    || key.includes("secret")
    || key.includes("token")
    || key.includes("webhook")
    || key.includes("oauthstate")
    || key.includes("providerconnection")
    || key.includes("encryptionkey")
    || key.includes("keymaterial")
    || key === "apikey"
    || key.endsWith("privatekey")
    || key.includes("unsubscribekey");
}

export function sanitizeLegacySnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeLegacySnapshot);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !isLegacySecretKey(key))
    .map(([key, nested]) => [key, sanitizeLegacySnapshot(nested)]));
}

export function stableSnapshotHash(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export async function readLegacySnapshot(path: string) {
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > 64 * 1024 * 1024) throw new HttpError(413, "snapshot_too_large", "O snapshot excede 64 MB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "snapshot_invalid_json", "O snapshot não contém JSON válido.");
  }
  return sanitizeLegacySnapshot(parsed);
}

export async function importLegacySnapshot(snapshot: unknown, apply = false) {
  const result = await pool.query<{ result: Record<string, unknown> }>(`select private.import_outreach_legacy_snapshot($1::jsonb,$2) result`, [JSON.stringify(snapshot), !apply]);
  return { hash: stableSnapshotHash(snapshot), ...(result.rows[0]?.result ?? {}) };
}
