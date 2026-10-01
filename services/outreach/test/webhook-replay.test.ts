import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  packSecret: vi.fn(() => Buffer.from("encrypted")),
  unpackSecret: vi.fn(),
  createSuppression: vi.fn(),
}));
vi.mock("../src/db.js", () => ({ pool: { query: mocks.query }, transaction: vi.fn() }));
vi.mock("../src/repository.js", () => ({ packSecret: mocks.packSecret, unpackSecret: mocks.unpackSecret, providerSession: vi.fn() }));
vi.mock("../src/providers.js", () => ({ listInboundMessages: vi.fn() }));
vi.mock("../src/mutations.js", () => ({ createSuppression: mocks.createSuppression, createSuppressionWithClient: vi.fn() }));

import { processWebhookEvents, storeWebhook, webhookStoragePayload } from "../src/inbound.js";

describe("webhook replay gate", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.packSecret.mockClear();
    mocks.unpackSecret.mockReset();
    mocks.createSuppression.mockReset().mockResolvedValue({ id: "suppression-1" });
  });

  it("relies on the provider/event unique key and reports replays idempotently", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: "first" }] }).mockResolvedValueOnce({ rows: [] });
    await expect(storeWebhook("google", "event-1", "{}", true)).resolves.toEqual({ accepted: true, replay: false });
    await expect(storeWebhook("google", "event-1", "{}", true)).resolves.toEqual({ accepted: false, replay: true });
    expect(mocks.query.mock.calls[0]?.[0]).toContain("on conflict(provider,provider_event_id) do nothing");
  });

  it("stores only a hash/minimal metadata for Google wake-ups", async () => {
    const raw = JSON.stringify({ emailAddress: "private@example.com", historyId: "123" });
    const storage = webhookStoragePayload("google", "event-google", raw);
    expect(storage.identityEmail).toBeNull();
    expect(JSON.stringify(storage.value)).not.toContain("private@example.com");
    expect(JSON.stringify(storage.value)).not.toContain("historyId");

    mocks.query.mockResolvedValueOnce({ rows: [{ id: "first" }] });
    await storeWebhook("google", "event-google", raw, true);
    expect(JSON.stringify(mocks.packSecret.mock.calls[0]?.[0])).not.toContain("private@example.com");
    expect(mocks.query.mock.calls[0]?.[1]?.[2]).toBeNull();
  });

  it("HMAC-indexes encrypted provider PII and applies a complaint webhook", async () => {
    const raw = JSON.stringify({ type: "complaint", recipient: "lead@example.com", messageId: "provider-1" });
    mocks.query.mockResolvedValueOnce({ rows: [{ id: "stored" }] });
    await storeWebhook("microsoft", "event-complaint", raw, true);
    expect(mocks.query.mock.calls[0]?.[0]).toContain("private.outreach_identity_hmac($3)");
    expect(mocks.query.mock.calls[0]?.[1]?.[2]).toBe("lead@example.com");
    expect(mocks.packSecret.mock.calls[0]?.[0]).toEqual({ raw });

    mocks.query.mockReset();
    mocks.unpackSecret.mockReturnValue({ raw });
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "stored", provider: "microsoft", provider_event_id: "event-complaint", body_encrypted: Buffer.from("encrypted") }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "outbound-message", mailbox_id: "mailbox-1", campaign_id: "campaign-1", job_id: "job-1" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ paused: true }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(processWebhookEvents()).resolves.toEqual({ processed: 1 });
    expect(mocks.createSuppression).toHaveBeenCalledWith(null, expect.objectContaining({ email: "lead@example.com", reason: "complaint" }), "outreach_webhook");
    expect(mocks.query.mock.calls[1]?.[0]).toContain("outreach_messages");
    expect(mocks.query.mock.calls[2]?.[0]).toContain("outreach_record_delivery_incident");
    expect(mocks.query.mock.calls[2]?.[1]).toEqual(["complaint", "mailbox-1", "campaign-1", "job-1", "stored"]);
    expect(mocks.query.mock.calls[3]?.[1]).toEqual(["stored", null, false]);
    expect(mocks.query.mock.calls[4]?.[0]).toContain("delete from private.outreach_webhook_events");
  });

  it("does not suppress an email-only webhook without a matching outbound provider id", async () => {
    const raw = JSON.stringify({ type: "complaint", recipient: "victim@example.com", messageId: "spoofed-provider-id" });
    mocks.unpackSecret.mockReturnValue({ raw });
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "stored", provider: "microsoft", provider_event_id: "event-spoofed", body_encrypted: Buffer.from("encrypted") }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(processWebhookEvents()).resolves.toEqual({ processed: 1 });

    expect(mocks.createSuppression).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[2]?.[1]).toEqual(["stored", "unmatched_delivery_signal", false]);
  });
});
