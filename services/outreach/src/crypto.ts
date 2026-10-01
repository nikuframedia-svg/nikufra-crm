import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

export interface EncryptedPayload {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export function encryptJson(value: unknown, aad: string, keyVersion = config.activeKeyVersion): EncryptedPayload {
  const key = config.encryptionKeys.get(keyVersion);
  if (!key) throw new HttpError(503, "encryption_not_configured", "A encriptação de credenciais ainda não está configurada.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag(), keyVersion };
}

export function decryptJson<T>(value: EncryptedPayload, aad: string): T {
  const key = config.encryptionKeys.get(value.keyVersion);
  if (!key) throw new HttpError(503, "key_unavailable", `A chave de credencial v${value.keyVersion} não está disponível.`);
  const decipher = createDecipheriv("aes-256-gcm", key, value.nonce);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(value.authTag);
  return JSON.parse(Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString("utf8")) as T;
}

export function needsReEncryption(keyVersion: number) {
  return keyVersion !== config.activeKeyVersion;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest();
}

export function hmac(value: string) {
  if (Buffer.byteLength(config.hmacSecret) < 32) throw new HttpError(503, "hmac_not_configured", "A assinatura segura do Outreach ainda não está configurada.");
  return createHmac("sha256", config.hmacSecret).update(value).digest("hex");
}

export function unsubscribeHmac(value: string) {
  if (Buffer.byteLength(config.unsubscribeSecret) < 32) throw new HttpError(503, "unsubscribe_secret_not_configured", "A assinatura de unsubscribe ainda não está configurada.");
  return createHmac("sha256", config.unsubscribeSecret).update(value).digest("hex");
}

export function verifyHmac(value: string, signature: string | undefined) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature) || Buffer.byteLength(config.webhookSecret) < 32) return false;
  const expected = createHmac("sha256", config.webhookSecret).update(value).digest();
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function hashSuppressionIdentity(scope: string, value: string) {
  return hmac(`${scope}:${value.trim().toLowerCase()}`);
}
