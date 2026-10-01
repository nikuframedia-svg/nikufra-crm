import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(),
}));

import { adjudicateJobReconciliation } from "../src/mutations.js";
import type { Actor } from "../src/types.js";

const admin: Actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@nikufra.ai",
  name: "Admin",
  crmRole: "admin",
  outreachRole: "viewer",
  capabilities: new Set(),
};

describe("job reconciliation adjudication", () => {
  beforeEach(() => mocks.query.mockReset());

  it("uses the atomic admin RPC and never exposes a retry outcome", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{
      id: "00000000-0000-4000-8000-000000000010",
      status: "cancelled",
      provider_message_id: null,
    }] });

    await expect(adjudicateJobReconciliation(
      admin,
      "00000000-0000-4000-8000-000000000010",
      {
        outcome: "cancelled",
        reason: "Provider confirmou ausência definitiva",
        evidence: "ticket:provider-case-12345",
      },
    )).resolves.toEqual({
      id: "00000000-0000-4000-8000-000000000010",
      status: "cancelled",
      providerMessageId: null,
      retryAllowed: false,
    });

    expect(String(mocks.query.mock.calls[0]?.[0])).toContain("private.outreach_adjudicate_job_reconciliation");
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([
      "00000000-0000-4000-8000-000000000010",
      admin.id,
      "cancelled",
      "Provider confirmou ausência definitiva",
      "ticket:provider-case-12345",
      null,
    ]);
  });

  it("requires an administrator and explicit provider proof for a sent outcome", async () => {
    await expect(adjudicateJobReconciliation(
      { ...admin, crmRole: "member" },
      "00000000-0000-4000-8000-000000000010",
      {},
    )).rejects.toMatchObject({ status: 403, code: "admin_required" });
    await expect(adjudicateJobReconciliation(
      admin,
      "00000000-0000-4000-8000-000000000010",
      { outcome: "confirmed_sent", reason: "Envio confirmado externamente", evidence: "ticket:provider-case-12345" },
    )).rejects.toMatchObject({ name: "ZodError" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
