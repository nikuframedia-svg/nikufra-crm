import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  providerSession: vi.fn(),
  listInboundMessages: vi.fn(),
  createSuppressionWithClient: vi.fn(),
  createSuppression: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: { query: mocks.poolQuery },
  transaction: vi.fn(async (callback: (client: { query: typeof mocks.clientQuery }) => unknown) => callback({ query: mocks.clientQuery })),
}));
vi.mock("../src/repository.js", () => ({
  packSecret: () => Buffer.from("encrypted"),
  providerSession: mocks.providerSession,
}));
vi.mock("../src/providers.js", () => ({
  isProviderAuthorizationFailure: (error: unknown) => error instanceof Error && error.message === "reauthorize",
  listInboundMessages: mocks.listInboundMessages,
}));
vi.mock("../src/mutations.js", () => ({
  createSuppressionWithClient: mocks.createSuppressionWithClient,
  createSuppression: mocks.createSuppression,
}));

import { ingestMessage, purgeInboundReconciliation, syncAllMailboxes, syncMailbox } from "../src/inbound.js";
import type { InboundProviderMessage } from "../src/types.js";

const message: InboundProviderMessage = {
  providerMessageId: "gmail-message-1",
  providerThreadId: "gmail-thread-1",
  internetMessageId: "<message-1@example.com>",
  inReplyTo: "<sent-1@nikufra.ai>",
  references: ["<sent-1@nikufra.ai>"],
  from: "Lead <lead@example.com>",
  subject: "Re: Olá",
  text: "Tenho interesse.",
  receivedAt: "2026-09-30T09:00:00.000Z",
  autoSubmitted: null,
};

function matchedRelation() {
  return {
    thread_id: "00000000-0000-4000-8000-000000000010",
    campaign_id: "00000000-0000-4000-8000-000000000011",
    recipient_id: "00000000-0000-4000-8000-000000000012",
    contact_id: "00000000-0000-4000-8000-000000000013",
    company_id: "00000000-0000-4000-8000-000000000014",
    email_snapshot: "lead@example.com",
  };
}

describe("inbound synchronization", () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.clientQuery.mockReset();
    mocks.providerSession.mockReset();
    mocks.listInboundMessages.mockReset();
    mocks.createSuppressionWithClient.mockReset().mockResolvedValue({ id: "suppression-1" });
    mocks.createSuppression.mockReset().mockResolvedValue({ id: "suppression-1" });
  });

  afterEach(() => vi.useRealTimers());

  it("claims a provider message before any thread mutation", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ email: "mia@nikufra.ai" }] })
      .mockResolvedValueOnce({ rows: [matchedRelation()] })
      .mockResolvedValueOnce({ rows: [{ id: matchedRelation().recipient_id }] })
      .mockResolvedValueOnce({ rows: [{ claimed: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "00000000-0000-4000-8000-000000000020" }] });

    await expect(ingestMessage("00000000-0000-4000-8000-000000000001", message)).resolves.toBe(true);

    expect(mocks.clientQuery.mock.calls[2]?.[0]).toContain("for update");
    expect(mocks.clientQuery.mock.calls[3]?.[0]).toContain("outreach_claim_provider_message");
    expect(mocks.clientQuery.mock.calls[3]?.[1]).toEqual(["mia@nikufra.ai", "gmail-message-1"]);
    expect(mocks.clientQuery.mock.calls[4]?.[0]).toContain("update public.outreach_threads");
    expect(mocks.clientQuery.mock.calls[5]?.[0]).toContain("insert into public.outreach_messages");
  });

  it("keeps the reply visible but leaves shared effects to CRM when Gmail already owns the claim", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ email: "mia@nikufra.ai" }] })
      .mockResolvedValueOnce({ rows: [matchedRelation()] })
      .mockResolvedValueOnce({ rows: [{ id: matchedRelation().recipient_id }] })
      .mockResolvedValueOnce({ rows: [{ claimed: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "00000000-0000-4000-8000-000000000020" }] });

    await expect(ingestMessage("00000000-0000-4000-8000-000000000001", message)).resolves.toBe(true);

    expect(mocks.clientQuery).toHaveBeenCalledTimes(6);
    expect(mocks.clientQuery.mock.calls[4]?.[0]).toContain("update public.outreach_threads");
    expect(mocks.clientQuery.mock.calls[5]?.[0]).toContain("insert into public.outreach_messages");
    const executedSql = mocks.clientQuery.mock.calls.map(([sql]) => String(sql)).join("\n");
    expect(executedSql).not.toMatch(/update public\.outreach_(recipients|jobs)|outreach_metric_daily|insert into public\.atividades/);
  });

  it("does not count an already stored Outreach message as newly imported", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ email: "mia@nikufra.ai" }] })
      .mockResolvedValueOnce({ rows: [matchedRelation()] })
      .mockResolvedValueOnce({ rows: [{ id: matchedRelation().recipient_id }] })
      .mockResolvedValueOnce({ rows: [{ claimed: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(ingestMessage("00000000-0000-4000-8000-000000000001", message)).resolves.toBe(false);
  });

  it("does not guess by sender when the same email belongs to two campaigns", async () => {
    const senderOnly = { ...message, providerMessageId: "gmail-ambiguous-1", providerThreadId: null, inReplyTo: null };
    const second = { ...matchedRelation(), campaign_id: "00000000-0000-4000-8000-000000000099", recipient_id: "00000000-0000-4000-8000-000000000098" };
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ email: "mia@nikufra.ai" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [matchedRelation(), second] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ id: "reconciliation-1" }], rowCount: 1 });

    await expect(ingestMessage("00000000-0000-4000-8000-000000000001", senderOnly)).resolves.toBe(true);

    expect(mocks.clientQuery).toHaveBeenCalledTimes(6);
    expect(mocks.clientQuery.mock.calls[1]?.[0]).toContain("with candidates as");
    expect(mocks.clientQuery.mock.calls[2]?.[0]).toContain("lower(r.email_snapshot::text)=$2");
    expect(mocks.clientQuery.mock.calls[3]?.[0]).toContain("inbound.match_ambiguous");
    const auditPayload = JSON.stringify(mocks.clientQuery.mock.calls[3]?.[1]);
    expect(auditPayload).toContain("sender_fallback");
    expect(auditPayload).not.toContain("lead@example.com");
    expect(auditPayload).not.toContain("gmail-ambiguous-1");
    expect(mocks.clientQuery.mock.calls[4]?.[0]).toContain("ambiguous_inbound_reply");
    expect(mocks.clientQuery.mock.calls[4]?.[0]).toContain("ledger.status in ('sending','accepted','ambiguous')");
    expect(mocks.clientQuery.mock.calls[4]?.[0]).toContain("then 'reconciliation_required'");
    expect(mocks.clientQuery.mock.calls[5]?.[0]).toContain("private.outreach_inbound_reconciliation");
    expect(mocks.clientQuery.mock.calls[5]?.[0]).toContain("private.outreach_identity_hmac($3)");
    expect(mocks.clientQuery.mock.calls[5]?.[1]?.[2]).toBe("lead@example.com");
    const sql = mocks.clientQuery.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).not.toContain("outreach_claim_provider_message");
    expect(sql).not.toContain("insert into public.outreach_messages");
  });

  it("quarantines an unmatched permanent DSN without suppressing or tripping canary", async () => {
    const bounce: InboundProviderMessage = {
      ...message,
      providerMessageId: "dsn-1",
      providerThreadId: null,
      inReplyTo: null,
      references: [],
      from: "Mailer Daemon <mailer-daemon@example.net>",
      subject: "Delivery Status Notification (Failure)",
      text: "Final-Recipient: rfc822; lost@example.com\nOriginal-Message-ID: <unknown@nikufra.ai>\nStatus: 5.1.1",
      headers: { "content-type": "multipart/report; report-type=delivery-status" },
    };
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ email: "mia@nikufra.ai" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "reconciliation-1" }] });

    await expect(ingestMessage("00000000-0000-4000-8000-000000000001", bounce)).resolves.toBe(true);

    expect(mocks.createSuppressionWithClient).not.toHaveBeenCalled();
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("outreach_trip_canary"))).toBe(false);
    expect(mocks.clientQuery.mock.calls[1]?.[1]?.[2]).toEqual(["<unknown@nikufra.ai>"]);
    expect(mocks.clientQuery.mock.calls[3]?.[0]).toContain("outreach_inbound_reconciliation");
  });

  it("maps an ARF complaint by Original-Message-ID and persists the complaint", async () => {
    const complaint: InboundProviderMessage = {
      ...message,
      providerMessageId: "arf-1",
      providerThreadId: null,
      inReplyTo: null,
      references: [],
      from: "feedback-loop@example.net",
      subject: "Complaint feedback loop",
      text: "Feedback-Type: abuse\nOriginal-Rcpt-To: rfc822; lead@example.com\nOriginal-Message-ID: <sent-1@nikufra.ai>",
      headers: { "content-type": "multipart/report; report-type=feedback-report" },
    };
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ email: "mia@nikufra.ai" }] })
      .mockResolvedValueOnce({ rows: [matchedRelation()] })
      .mockResolvedValueOnce({ rows: [{ id: matchedRelation().recipient_id }] })
      .mockResolvedValueOnce({ rows: [{ claimed: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "message-complaint" }] });

    await expect(ingestMessage("00000000-0000-4000-8000-000000000001", complaint)).resolves.toBe(true);

    expect(mocks.createSuppressionWithClient).toHaveBeenCalledWith(expect.anything(), null, expect.objectContaining({ email: "lead@example.com", reason: "complaint" }), "outreach_inbound");
    expect(mocks.clientQuery.mock.calls[1]?.[1]?.[2]).toEqual(["<sent-1@nikufra.ai>"]);
    expect(mocks.clientQuery.mock.calls[5]?.[1]?.[6]).toBe("complaint");
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("outreach_trip_canary"))).toBe(false);
  });

  it("rejects a spoofed DSN whose reported recipient does not match the referenced outbound recipient", async () => {
    const spoofed: InboundProviderMessage = {
      ...message,
      providerMessageId: "dsn-spoofed",
      providerThreadId: null,
      text: "Final-Recipient: rfc822; victim@example.com\nOriginal-Message-ID: <sent-1@nikufra.ai>\nStatus: 5.1.1",
      headers: { "content-type": "multipart/report; report-type=delivery-status" },
    };
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ email: "mia@nikufra.ai" }] })
      .mockResolvedValueOnce({ rows: [matchedRelation()] })
      .mockResolvedValueOnce({ rows: [{ id: "reconciliation-spoofed" }] });

    await expect(ingestMessage("00000000-0000-4000-8000-000000000001", spoofed)).resolves.toBe(true);

    expect(mocks.createSuppressionWithClient).not.toHaveBeenCalled();
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("outreach_trip_canary"))).toBe(false);
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toContain("outreach_inbound_reconciliation");
  });

  it("quarantines a referenced DSN that omits the affected recipient", async () => {
    const spoofed: InboundProviderMessage = {
      ...message,
      providerMessageId: "dsn-no-recipient",
      providerThreadId: null,
      text: "Original-Message-ID: <sent-1@nikufra.ai>\nStatus: 5.1.1",
      headers: { "content-type": "multipart/report; report-type=delivery-status" },
    };
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ email: "mia@nikufra.ai" }] })
      .mockResolvedValueOnce({ rows: [matchedRelation()] })
      .mockResolvedValueOnce({ rows: [{ id: "reconciliation-no-recipient" }] });

    await expect(ingestMessage("00000000-0000-4000-8000-000000000001", spoofed)).resolves.toBe(true);

    expect(mocks.createSuppressionWithClient).not.toHaveBeenCalled();
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("outreach_trip_canary"))).toBe(false);
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toContain("outreach_inbound_reconciliation");
  });

  it("retains no decryptable PII when an unmatched event has no identity", async () => {
    const unidentified = {
      ...message,
      providerMessageId: "unidentified-1",
      providerThreadId: null,
      inReplyTo: null,
      references: [],
      from: "",
      subject: "Private subject",
      text: "Private body with secret@example.com",
    };
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ email: "mia@nikufra.ai" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "reconciliation-minimal" }] });

    await expect(ingestMessage("00000000-0000-4000-8000-000000000001", unidentified)).resolves.toBe(true);

    const parameters = mocks.clientQuery.mock.calls[2]?.[1] ?? [];
    expect(parameters[2]).toBeNull();
    expect(JSON.stringify(parameters)).not.toContain("Private body");
    expect(JSON.stringify(parameters)).not.toContain("secret@example.com");
  });

  it("uses an overlap and advances only to the pre-fetch watermark", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T10:00:00.000Z"));
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [{ last_sync_at: new Date("2026-09-30T09:30:00.000Z") }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mocks.providerSession.mockResolvedValue({ provider: "google" });
    mocks.listInboundMessages.mockResolvedValue([]);

    await expect(syncMailbox("00000000-0000-4000-8000-000000000001")).resolves.toEqual({ imported: 0, scanned: 0 });

    expect(mocks.listInboundMessages.mock.calls[0]?.[1]).toEqual(new Date("2026-09-30T09:25:00.000Z"));
    expect(mocks.poolQuery.mock.calls[1]?.[1]?.[1]).toEqual(new Date("2026-09-30T10:00:00.000Z"));
  });

  it("disables a mailbox whose Google authorization was revoked", async () => {
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [{ id: "00000000-0000-4000-8000-000000000001" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ last_sync_at: null }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mocks.providerSession.mockRejectedValue(new Error("reauthorize"));

    await expect(syncAllMailboxes()).resolves.toEqual({ mailboxes: 1, imported: 0 });

    expect(mocks.poolQuery.mock.calls[2]?.[0]).toContain("send_enabled=case when $2 then false");
    expect(mocks.poolQuery.mock.calls[2]?.[1]).toEqual([
      "00000000-0000-4000-8000-000000000001",
      true,
      "oauth_reauthorization_required",
    ]);
  });

  it("purges every reconciliation row after the absolute 90-day TTL", async () => {
    mocks.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });

    await expect(purgeInboundReconciliation()).resolves.toBe(3);

    const sql = String(mocks.poolQuery.mock.calls[0]?.[0]);
    expect(sql).toContain("or created_at<now()-interval '90 days'");
    expect(sql).toContain("status='resolved'");
    expect(sql).toContain("status='ignored'");
  });
});
