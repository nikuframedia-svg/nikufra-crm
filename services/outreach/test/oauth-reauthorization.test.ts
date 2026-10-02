import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query })),
}));

import { prepareMailboxReauthorization } from "../src/repository.js";

describe("mailbox OAuth reauthorization", () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it("quarantines only leases with a dispatch ledger and requeues pre-dispatch leases", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ authorized: true }] })
      .mockResolvedValueOnce({ rows: [{ id: "00000000-0000-4000-8000-000000000010" }] })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await prepareMailboxReauthorization(
      "00000000-0000-4000-8000-000000000010",
      "00000000-0000-4000-8000-000000000001",
      Buffer.alloc(32, 7),
    );

    const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toContain("pg_advisory_xact_lock(20260930,1)");
    expect(statements[1]).toContain("private.outreach_lock_active_admin");
    expect(statements[2]).toContain("for update of m,oauth_state");
    const withLedger = statements.find((sql) => sql.includes("status='reconciliation_required'"));
    const withoutLedger = statements.find((sql) =>
      sql.includes("mailbox_reauthorization_before_dispatch") && sql.includes("status='pending'"),
    );

    expect(withLedger).toContain("status='leased'");
    expect(withLedger).toContain("private.outreach_delivery_ledger");
    expect(withLedger).toContain("exists");
    expect(withoutLedger).toContain("status='leased'");
    expect(withoutLedger).toContain("private.outreach_delivery_ledger");
    expect(withoutLedger).toContain("not exists");
  });

  it("preserves the old authorization while a provider delivery is nonterminal", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ authorized: true }] })
      .mockResolvedValueOnce({ rows: [{ id: "00000000-0000-4000-8000-000000000010" }] })
      .mockResolvedValueOnce({ rows: [{ job_id: "00000000-0000-4000-8000-000000000020" }] });

    await expect(prepareMailboxReauthorization(
      "00000000-0000-4000-8000-000000000010",
      "00000000-0000-4000-8000-000000000001",
      Buffer.alloc(32, 7),
    )).rejects.toMatchObject({ status: 409, code: "mailbox_reconciliation_pending" });

    const sql = mocks.query.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).toContain("ledger.status in ('sending','accepted','ambiguous')");
    expect(sql).not.toContain("status='pending',send_enabled=false");
    expect(sql).not.toContain("mailbox.oauth.reauthorization_started");
  });
});
