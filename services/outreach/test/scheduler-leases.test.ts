import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  providerSession: vi.fn(),
  reconcileProviderMessage: vi.fn(),
  sendProviderMessage: vi.fn(),
}));

const client = {
  query: vi.fn(),
};

vi.mock("../src/config.js", () => ({ config: {
  outboundEnvEnabled: true,
  workerId: "default-worker",
  leaseSeconds: 180,
  maxJitterSeconds: 90,
  publicUrl: "https://crm.nikufra.ai",
  hmacSecret: "0123456789abcdef0123456789abcdef",
  unsubscribeSecret: "0123456789abcdef0123456789abcdef",
} }));
vi.mock("../src/db.js", () => ({
  pool: { query: mocks.poolQuery },
  transaction: (callback: (value: typeof client) => unknown) => callback(client),
}));
vi.mock("../src/repository.js", () => ({ providerSession: mocks.providerSession }));
vi.mock("../src/providers.js", () => ({ reconcileProviderMessage: mocks.reconcileProviderMessage, sendProviderMessage: mocks.sendProviderMessage }));

import { leaseDueJobs, reconcileAmbiguousJobs, recoverExpiredLeases } from "../src/delivery.js";

describe("scheduler lease and ambiguity semantics", () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    mocks.providerSession.mockReset();
    mocks.reconcileProviderMessage.mockReset();
    mocks.sendProviderMessage.mockReset();
    client.query.mockClear();
  });

  it("delegates atomic per-mailbox leases to the narrow DB claim function", async () => {
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [{ id: "job-a" }, { id: "job-b" }] })
      .mockResolvedValueOnce({ rows: [{ id: "job-c" }] });
    await expect(leaseDueJobs(2, "worker-one")).resolves.toEqual(["job-a", "job-b"]);
    await expect(leaseDueJobs(2, "worker-two")).resolves.toEqual(["job-c"]);
    expect(mocks.poolQuery.mock.calls[0]?.[0]).toContain("private.outreach_claim_jobs");
    expect(mocks.poolQuery.mock.calls[0]?.[1]).toEqual(["worker-one", 2, 180]);
    expect(mocks.poolQuery.mock.calls[1]?.[1]).toEqual(["worker-two", 2, 180]);
  });

  it("routes an expired lease with a delivery ledger to reconciliation instead of resending", async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: "job-a" }], rowCount: 1 });
    await expect(recoverExpiredLeases()).resolves.toBe(1);
    const sql = String(mocks.poolQuery.mock.calls[0]?.[0]);
    expect(sql).toContain("private.outreach_delivery_ledger");
    expect(sql).toContain("reconciliation_required");
    expect(sql).toContain("else 'pending'");
  });

  it("reconciles a crash after ledger reservation without sending again", async () => {
    const expectedInternetMessageId = "<outreach-job-a@nikufra.ai>";
    const receipt = {
      providerMessageId: "provider-message-a",
      providerThreadId: "provider-thread-a",
      internetMessageId: expectedInternetMessageId,
      acceptedAt: "2026-10-01T00:00:00.000Z",
      raw: {},
    };
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [{ id: "job-a", mailbox_id: "mailbox-a", idempotency_key: "manual:job-a", provider_message_id: "provider-message-a", provider_response: { expectedInternetMessageId } }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        id: "job-a",
        campaign_id: "campaign-a",
        recipient_id: "recipient-a",
        step_id: "step-a",
        variant_id: "variant-a",
        mailbox_id: "mailbox-a",
        idempotency_key: "manual:job-a",
        email: "lead@example.com",
        mailbox_email: "sender@example.com",
        sender_name: "Sender",
        subject_template: "Subject",
        body_template: "Body",
        variable_snapshot: {},
        provider_thread_id: null,
        in_reply_to: null,
        references: [],
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mocks.providerSession.mockResolvedValue({ provider: "google" });
    mocks.reconcileProviderMessage.mockResolvedValue(receipt);
    client.query
      .mockResolvedValueOnce({ rows: [{ id: "ledger-a" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "thread-a" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(reconcileAmbiguousJobs()).resolves.toEqual({ checked: 1, confirmed: 1 });

    const candidateSql = String(mocks.poolQuery.mock.calls[0]?.[0]);
    expect(candidateSql).toContain("from private.outreach_delivery_ledger ledger");
    expect(candidateSql).toContain("ledger.status in ('sending','accepted','ambiguous')");
    expect(candidateSql).toContain("job.lease_expires_at <= now()");
    expect(candidateSql).toContain("normalized as");
    expect(candidateSql).toContain("set status='reconciliation_required'");
    expect(candidateSql).not.toContain("where job.status='reconciliation_required'");
    expect(mocks.reconcileProviderMessage).toHaveBeenCalledWith(expect.anything(), expectedInternetMessageId, { providerMessageId: "provider-message-a", idempotencyKey: "manual:job-a" });
    expect(mocks.sendProviderMessage).not.toHaveBeenCalled();
    expect(String(client.query.mock.calls[0]?.[0])).toContain("status in ('sending','accepted','ambiguous')");
  });

  it("keeps a reserved delivery in reconciliation when Sent has no match", async () => {
    const expectedInternetMessageId = "<outreach-job-a@nikufra.ai>";
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [{ id: "job-a", mailbox_id: "mailbox-a", idempotency_key: "manual:job-a", provider_message_id: null, provider_response: { expectedInternetMessageId } }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mocks.providerSession.mockResolvedValue({ provider: "google" });
    mocks.reconcileProviderMessage.mockResolvedValue(null);

    await expect(reconcileAmbiguousJobs()).resolves.toEqual({ checked: 1, confirmed: 0 });

    expect(String(mocks.poolQuery.mock.calls[1]?.[0])).toContain("lastReconciliation");
    expect(String(mocks.poolQuery.mock.calls[1]?.[0])).toContain("reconciliationNotFoundCount");
    expect(mocks.sendProviderMessage).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });
});
