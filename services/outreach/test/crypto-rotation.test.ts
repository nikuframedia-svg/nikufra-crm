import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db.js", () => ({
  transaction: vi.fn(async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query })),
}));

import { decryptJson, encryptJson, needsReEncryption } from "../src/crypto.js";
import { packedSecretKeyVersion, rotateCredentialKeys, rotateCredentialRow } from "../src/rotation.js";

function packedWithKey(value: unknown, aad: string, keyVersion: number) {
  const encrypted = encryptJson(value, aad, keyVersion);
  return Buffer.from(JSON.stringify({
    v: encrypted.keyVersion,
    c: encrypted.ciphertext.toString("base64"),
    n: encrypted.nonce.toString("base64"),
    t: encrypted.authTag.toString("base64"),
  }));
}

describe("credential encryption and rotation", () => {
  beforeEach(() => mocks.query.mockReset());

  it("binds ciphertext to the mailbox AAD", () => {
    const encrypted = encryptJson({ refreshToken: "secret" }, "outreach-mailbox:a", 1);
    expect(decryptJson(encrypted, "outreach-mailbox:a")).toEqual({ refreshToken: "secret" });
    expect(() => decryptJson(encrypted, "outreach-mailbox:b")).toThrow();
  });

  it("re-encrypts an old credential with the active key version", () => {
    const old = encryptJson({ kind: "oauth", accessToken: "a", refreshToken: "r", expiresAt: 1, scope: "gmail", tokenType: "Bearer" }, "outreach-mailbox:mailbox-1", 1);
    expect(needsReEncryption(old.keyVersion)).toBe(true);
    const rotated = rotateCredentialRow({ mailbox_id: "mailbox-1", encrypted_payload: old.ciphertext, nonce: old.nonce, auth_tag: old.authTag, key_version: old.keyVersion });
    expect(rotated.keyVersion).toBe(2);
    expect(decryptJson(rotated, "outreach-mailbox:mailbox-1")).toMatchObject({ refreshToken: "r" });
  });

  it("rotates mixed-key durable stores and gates retirement on old OAuth state TTL", async () => {
    const oldCredential = encryptJson({ kind: "oauth", accessToken: "old", refreshToken: "r", expiresAt: 1, scope: "gmail", tokenType: "Bearer" }, "outreach-mailbox:mailbox-old", 1);
    const activeCredential = encryptJson({ kind: "oauth", accessToken: "new", refreshToken: "r", expiresAt: 1, scope: "gmail", tokenType: "Bearer" }, "outreach-mailbox:mailbox-new", 2);
    const oldInbound = encryptJson({ message: "old" }, "outreach-inbound:mailbox-old:message-old", 1);
    const activeInbound = encryptJson({ message: "new" }, "outreach-inbound:mailbox-new:message-new", 2);
    const oldWebhook = packedWithKey({ raw: "old" }, "webhook:microsoft:webhook-old", 1);
    const activeWebhook = packedWithKey({ raw: "new" }, "webhook:microsoft:webhook-new", 2);
    const oldOAuth = packedWithKey({ verifier: "old" }, "oauth-state:unavailable", 1);
    const activeOAuth = packedWithKey({ verifier: "new" }, "oauth-state:unavailable", 2);

    mocks.query
      .mockResolvedValueOnce({ rows: [
        { mailbox_id: "mailbox-old", encrypted_payload: oldCredential.ciphertext, nonce: oldCredential.nonce, auth_tag: oldCredential.authTag, key_version: 1 },
        { mailbox_id: "mailbox-new", encrypted_payload: activeCredential.ciphertext, nonce: activeCredential.nonce, auth_tag: activeCredential.authTag, key_version: 2 },
      ], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [
        { id: "webhook-old", provider: "microsoft", provider_event_id: "webhook-old", body_encrypted: oldWebhook },
        { id: "webhook-new", provider: "microsoft", provider_event_id: "webhook-new", body_encrypted: activeWebhook },
      ], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [
        { id: "inbound-old", mailbox_id: "mailbox-old", provider_message_id: "message-old", payload_encrypted: oldInbound.ciphertext, nonce: oldInbound.nonce, auth_tag: oldInbound.authTag, key_version: 1 },
        { id: "inbound-new", mailbox_id: "mailbox-new", provider_message_id: "message-new", payload_encrypted: activeInbound.ciphertext, nonce: activeInbound.nonce, auth_tag: activeInbound.authTag, key_version: 2 },
      ], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [
        { state_hash: Buffer.from("old-live"), pkce_verifier_encrypted: oldOAuth, expires_at: "2026-10-01T00:10:00.000Z", expired: false },
        { state_hash: Buffer.from("old-expired"), pkce_verifier_encrypted: oldOAuth, expires_at: "2026-09-30T23:00:00.000Z", expired: true },
        { state_hash: Buffer.from("active"), pkce_verifier_encrypted: activeOAuth, expires_at: "2026-10-01T00:10:00.000Z", expired: false },
      ], rowCount: 3 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await rotateCredentialKeys(true);

    expect(result).toMatchObject({
      scanned: 9,
      foundPending: 5,
      rotated: 3,
      pending: 1,
      invalidatedOAuthStates: 2,
      retirementReady: false,
      safeToRetireAfter: "2026-10-01T00:10:00.000Z",
      stores: {
        credentials: { pending: 0, rotated: 1 },
        webhooks: { pending: 0, rotated: 1 },
        inboundReconciliation: { pending: 0, rotated: 1 },
        oauthStates: { pending: 1, invalidated: 2 },
      },
    });
    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.filter((sql) => sql.includes("update private.outreach_credentials"))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes("update private.outreach_webhook_events"))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes("update private.outreach_inbound_reconciliation"))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes("update private.outreach_oauth_states"))).toHaveLength(2);
    expect(statements.some((sql) => sql.includes("delete from private.outreach_oauth_states"))).toBe(true);
    const webhookUpdate = mocks.query.mock.calls.find(([sql]) => String(sql).includes("update private.outreach_webhook_events"));
    expect(packedSecretKeyVersion(webhookUpdate?.[1]?.[1] as Buffer)).toBe(2);
  });
});
