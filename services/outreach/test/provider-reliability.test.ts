import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    google: { enabled: true, clientId: "google-client", clientSecret: "google-secret" },
    microsoft: { enabled: false, clientId: "", clientSecret: "", tenant: "common" },
    smtpEnabled: false,
  },
}));

import { refreshOAuthCredential } from "../src/oauth.js";
import { isProviderAuthorizationFailure, listGmailMessageReferences, listInboundMessages, reconcileProviderMessage, sendProviderMessage, testProvider } from "../src/providers.js";
import { HttpError } from "../src/errors.js";
import type { DeliveryEnvelope, OAuthCredential } from "../src/types.js";

const expired: OAuthCredential = {
  kind: "oauth",
  accessToken: "expired-access",
  refreshToken: "refresh-token",
  expiresAt: 0,
  scope: "gmail.send gmail.readonly",
  tokenType: "Bearer",
};

const envelope: DeliveryEnvelope = {
  jobId: "job-1",
  recipientId: "recipient-1",
  campaignId: "campaign-1",
  mailboxId: "mailbox-1",
  fromEmail: "mia@nikufra.ai",
  senderName: "Mia",
  to: "lead@example.com",
  subject: "Olá",
  text: "Mensagem",
  unsubscribeUrl: "https://crm.nikufra.ai/api/outreach/v1/unsubscribe/token",
  providerThreadId: null,
  inReplyTo: null,
  references: [],
  idempotencyKey: "campaign:1:recipient:1:step:1",
};

describe("Google provider reliability", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("refreshes an expired token, persists it, and sends once", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 3600, token_type: "Bearer" }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "gmail-message-1", threadId: "gmail-thread-1" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const persist = vi.fn();

    const receipt = await sendProviderMessage({ provider: "google", credentials: expired, persist }, envelope);

    expect(receipt.providerMessageId).toBe("gmail-message-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0]?.[0]).toMatchObject({ accessToken: "fresh-access", refreshToken: "refresh-token" });
  });

  it("treats a revoked refresh grant as a terminal OAuth error without overwriting the credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 401, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const persist = vi.fn();

    await expect(testProvider({ provider: "google", credentials: expired, persist })).rejects.toMatchObject({ status: 502, code: "oauth_token_rejected" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();
  });

  it("distinguishes revoked authorization from transient provider failures", () => {
    expect(isProviderAuthorizationFailure(new HttpError(502, "oauth_token_rejected", "revoked"))).toBe(true);
    expect(isProviderAuthorizationFailure(new HttpError(502, "provider_error", "unauthorized", { providerStatus: 401 }))).toBe(true);
    expect(isProviderAuthorizationFailure(new HttpError(502, "provider_error", "transient", { providerStatus: 429 }))).toBe(false);
    expect(isProviderAuthorizationFailure(new HttpError(502, "provider_error", "down", { providerStatus: 503 }))).toBe(false);
  });

  it.each([429, 500, 503])("does not automatically retry an ambiguous Gmail %s response", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: status, message: "transient" } }), { status, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const credential = { ...expired, accessToken: "still-valid", expiresAt: Date.now() + 3_600_000 };

    await expect(sendProviderMessage({ provider: "google", credentials: credential, persist: vi.fn() }, envelope)).rejects.toMatchObject({ status: 502, code: "provider_error" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps a still-valid token without a refresh request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const current = { ...expired, expiresAt: Date.now() + 3_600_000 };
    await expect(refreshOAuthCredential("google", current)).resolves.toBe(current);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms an accepted Gmail message by provider ID when Gmail rewrites Message-ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "gmail-message-1", threadId: "gmail-thread-1", labelIds: ["SENT"], internalDate: "1791273601000",
      payload: { headers: [
        { name: "Message-Id", value: "<gmail-generated@mail.gmail.com>" },
        { name: "X-Nikufra-Idempotency-Key", value: envelope.idempotencyKey },
      ] },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const credential = { ...expired, expiresAt: Date.now() + 3_600_000 };

    await expect(reconcileProviderMessage(
      { provider: "google", credentials: credential, persist: vi.fn() },
      "<outreach-original@nikufra.ai>",
      { providerMessageId: "gmail-message-1", idempotencyKey: envelope.idempotencyKey },
    )).resolves.toMatchObject({ providerMessageId: "gmail-message-1", internetMessageId: "<gmail-generated@mail.gmail.com>" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/messages/gmail-message-1?format=metadata");
  });

  it("does not confirm a different Gmail Sent message under an accepted provider ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "gmail-message-1", labelIds: ["SENT"],
      payload: { headers: [
        { name: "Message-Id", value: "<gmail-generated@mail.gmail.com>" },
        { name: "X-Nikufra-Idempotency-Key", value: "another-job" },
      ] },
    }), { status: 200 })));
    const credential = { ...expired, expiresAt: Date.now() + 3_600_000 };

    await expect(reconcileProviderMessage(
      { provider: "google", credentials: credential, persist: vi.fn() },
      "<outreach-original@nikufra.ai>",
      { providerMessageId: "gmail-message-1", idempotencyKey: envelope.idempotencyKey },
    )).rejects.toMatchObject({ code: "provider_receipt_mismatch" });
  });

  it("falls back to the RFC 5322 search when Gmail no longer has the accepted ID", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "searched-message", threadId: "searched-thread" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const credential = { ...expired, expiresAt: Date.now() + 3_600_000 };

    await expect(reconcileProviderMessage(
      { provider: "google", credentials: credential, persist: vi.fn() },
      "<outreach-original@nikufra.ai>",
      { providerMessageId: "missing-message", idempotencyKey: envelope.idempotencyKey },
    )).resolves.toMatchObject({ providerMessageId: "searched-message" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("paginates Gmail inbox references before fetching every message", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const detail = /\/messages\/([^/]+)$/.exec(url.pathname)?.[1];
      if (detail) {
        return new Response(JSON.stringify({
          id: detail,
          threadId: `thread-${detail}`,
          internalDate: "1780228800000",
          payload: { mimeType: "text/plain", body: { data: Buffer.from(`body-${detail}`).toString("base64url") }, headers: [{ name: "From", value: "lead@example.com" }, { name: "Subject", value: detail }] },
        }), { status: 200 });
      }
      if (!url.searchParams.get("pageToken")) return new Response(JSON.stringify({ messages: [{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t2" }], nextPageToken: "page-2" }), { status: 200 });
      return new Response(JSON.stringify({ messages: [{ id: "m3", threadId: "t3" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const credential = { ...expired, accessToken: "valid", expiresAt: Date.now() + 3_600_000 };

    const messages = await listInboundMessages({ provider: "google", credentials: credential, persist: vi.fn() }, new Date("2026-05-30T00:00:00Z"));

    expect(messages.map((message) => message.providerMessageId)).toEqual(["m1", "m2", "m3"]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).searchParams.get("pageToken") === "page-2")).toBe(true);
  });

  it("fails closed instead of silently truncating an inbox beyond 5,000 messages", async () => {
    const refs = Array.from({ length: 5_000 }, (_, index) => ({ id: `m${index}`, threadId: `t${index}` }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: refs, nextPageToken: "more" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listGmailMessageReferences("valid", new Date("2026-05-30T00:00:00Z"))).rejects.toMatchObject({ status: 409, code: "gmail_sync_limit" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
