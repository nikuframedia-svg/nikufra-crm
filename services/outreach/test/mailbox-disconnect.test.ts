import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  providerSession: vi.fn(),
  revokeProviderAuthorization: vi.fn(),
}));
vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query })),
}));
vi.mock("../src/repository.js", async () => {
  const actual = await vi.importActual<typeof import("../src/repository.js")>("../src/repository.js");
  return {
    ...actual,
    audit: vi.fn(),
    providerSession: mocks.providerSession,
  };
});
vi.mock("../src/providers.js", () => ({ revokeProviderAuthorization: mocks.revokeProviderAuthorization }));

import { disconnectMailbox } from "../src/mutations.js";
import type { Actor } from "../src/types.js";

const admin: Actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@nikufra.ai",
  name: "Admin",
  crmRole: "admin",
  outreachRole: "viewer",
  capabilities: new Set(),
};

describe("mailbox disconnect safety", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.providerSession.mockReset().mockResolvedValue({ provider: "google" });
    mocks.revokeProviderAuthorization.mockReset().mockResolvedValue({ supported: true, revoked: true });
  });

  it("cancels work without a dispatch ledger and quarantines only ambiguous leases", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "00000000-0000-4000-8000-000000000010" }] })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await expect(disconnectMailbox(admin, "00000000-0000-4000-8000-000000000010")).resolves.toMatchObject({
      disconnected: true,
      providerRevoked: true,
    });

    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toContain("pg_advisory_xact_lock(20260930,1)");
    const pending = statements.find((sql) => sql.includes("mailbox_disconnected_before_dispatch"));
    const leasedWithLedger = statements.find((sql) => sql.includes("mailbox_disconnected_during_lease"));
    const leasedWithoutLedger = statements.find((sql) =>
      sql.includes("mailbox_disconnected_before_dispatch") && sql.includes("not exists"),
    );
    expect(pending).toContain("status='pending'");
    expect(pending).toContain("status='cancelled'");
    expect(leasedWithLedger).toContain("status='leased'");
    expect(leasedWithLedger).toContain("status='reconciliation_required'");
    expect(leasedWithLedger).toContain("private.outreach_delivery_ledger");
    expect(leasedWithLedger).toContain("exists");
    expect(leasedWithoutLedger).toContain("status='leased'");
    expect(leasedWithoutLedger).toContain("status='cancelled'");
    expect(leasedWithoutLedger).toContain("private.outreach_delivery_ledger");
    expect(statements.some((sql) => sql.includes("status in ('pending','leased','reconciliation_required')"))).toBe(false);
    expect(mocks.revokeProviderAuthorization).toHaveBeenCalledOnce();
    const localAuditIndex = statements.findIndex((sql) => sql.includes("mailbox.oauth.disconnected"));
    expect(localAuditIndex).toBeGreaterThanOrEqual(0);
    expect(mocks.revokeProviderAuthorization.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.query.mock.invocationCallOrder[localAuditIndex] ?? 0,
    );
  });

  it("preserves the credential and grant while a provider delivery is nonterminal", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "00000000-0000-4000-8000-000000000010" }] })
      .mockResolvedValueOnce({ rows: [{ job_id: "00000000-0000-4000-8000-000000000020" }] });

    await expect(disconnectMailbox(admin, "00000000-0000-4000-8000-000000000010")).rejects.toMatchObject({
      status: 409,
      code: "mailbox_reconciliation_pending",
    });

    const sql = mocks.query.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).toContain("ledger.status in ('sending','accepted','ambiguous')");
    expect(sql).not.toContain("delete from private.outreach_credentials");
    expect(sql).not.toContain("status='disconnected'");
    expect(mocks.providerSession).not.toHaveBeenCalled();
    expect(mocks.revokeProviderAuthorization).not.toHaveBeenCalled();
  });
});
