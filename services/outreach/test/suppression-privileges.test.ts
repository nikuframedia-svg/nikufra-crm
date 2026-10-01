import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createSuppressionWithClient } from "../src/mutations.js";

describe("suppression privilege boundary", () => {
  it("relies on the SECURITY DEFINER trigger instead of updating CRM contacts", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "00000000-0000-4000-8000-000000000001" }] })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const client = { query } as unknown as PoolClient;

    await expect(createSuppressionWithClient(client, null, {
      scope: "email",
      email: "lead@example.com",
      reason: "unsubscribe",
      note: "RFC 8058 one-click",
    }, "unsubscribe")).resolves.toEqual({ id: "00000000-0000-4000-8000-000000000001" });

    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).toContain("insert into public.communication_suppressions");
    expect(sql).toContain("update public.outreach_recipients");
    expect(sql).toContain("update public.outreach_jobs");
    expect(sql).toContain("ledger.status in ('sending','accepted','ambiguous')");
    expect(sql).toContain("then 'reconciliation_required'");
    expect(sql).not.toMatch(/(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.contactos/i);
  });
});
