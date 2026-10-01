import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(),
}));

import { encryptJson } from "../src/crypto.js";
import { providerSession } from "../src/repository.js";
import type { OAuthCredential } from "../src/types.js";

const mailboxId = "00000000-0000-4000-8000-000000000010";
const oldCredential: OAuthCredential = {
  kind: "oauth",
  accessToken: "old-access",
  refreshToken: "old-refresh",
  expiresAt: 1,
  scope: "gmail.send",
  tokenType: "Bearer",
};
const refreshedCredential: OAuthCredential = {
  ...oldCredential,
  accessToken: "refreshed-access",
  expiresAt: 4_000_000_000_000,
};

function credentialRow() {
  const encrypted = encryptJson(oldCredential, `outreach-mailbox:${mailboxId}`);
  return {
    encrypted,
    row: {
      provider: "google",
      encrypted_payload: encrypted.ciphertext,
      nonce: encrypted.nonce,
      auth_tag: encrypted.authTag,
      key_version: encrypted.keyVersion,
    },
  };
}

describe("OAuth credential refresh compare-and-swap", () => {
  beforeEach(() => mocks.query.mockReset());

  it("does not recreate a credential deleted by a concurrent disconnect", async () => {
    const { row } = credentialRow();
    mocks.query
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
      // Disconnect committed the credential delete before refresh persisted.
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const session = await providerSession(mailboxId);
    await expect(session.persist(refreshedCredential)).rejects.toMatchObject({
      code: "mailbox_authorization_changed",
    });

    const persistSql = String(mocks.query.mock.calls[1]?.[0]);
    expect(persistSql).toContain("update private.outreach_credentials");
    expect(persistSql).toContain("mailbox.status='active'");
    expect(persistSql).not.toContain("insert into private.outreach_credentials");
    expect(persistSql).not.toContain("on conflict");
  });

  it("does not overwrite a newer authorization with a stale refresh", async () => {
    const { row, encrypted } = credentialRow();
    mocks.query
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
      // A new callback replaced the encrypted row, so the old version misses.
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const staleSession = await providerSession(mailboxId);
    await expect(staleSession.persist(refreshedCredential)).rejects.toMatchObject({
      code: "mailbox_authorization_changed",
    });

    const parameters = mocks.query.mock.calls[1]?.[1] as unknown[];
    expect(parameters[5]).toEqual(encrypted.ciphertext);
    expect(parameters[6]).toEqual(encrypted.nonce);
    expect(parameters[7]).toEqual(encrypted.authTag);
    expect(parameters[8]).toBe(encrypted.keyVersion);
  });
});
