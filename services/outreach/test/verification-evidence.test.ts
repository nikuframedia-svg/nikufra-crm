import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query })),
}));

import { recordEmailVerificationEvidence } from "../src/mutations.js";
import type { Actor } from "../src/types.js";

const admin: Actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@nikufra.ai",
  name: "Admin",
  crmRole: "admin",
  outreachRole: "viewer",
  capabilities: new Set(),
};

describe("admin mailbox verification evidence", () => {
  beforeEach(() => mocks.query.mockReset());

  it("records bounded real-world evidence and its audit in one transaction", async () => {
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "00000000-0000-4000-8000-000000000010", email: "lead@example.com" }] })
      .mockResolvedValueOnce({ rows: [{ id: "00000000-0000-4000-8000-000000000020" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(recordEmailVerificationEvidence(admin, {
      contactId: "00000000-0000-4000-8000-000000000010",
      result: "valid",
      source: "mailbox_challenge",
      reference: "challenge:ticket-12345",
      expiresAt,
    })).resolves.toMatchObject({ status: "valid", source: "mailbox_challenge", email: "lead@example.com" });

    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(String(mocks.query.mock.calls[0]?.[0])).not.toMatch(/\bfor share\b/i);
    expect(String(mocks.query.mock.calls[1]?.[0])).toContain("evidence_reference,verified_by");
    expect(mocks.query.mock.calls[1]?.[1]?.[4]).toBe("challenge:ticket-12345");
    expect(String(mocks.query.mock.calls[2]?.[0])).toContain("public.outreach_audit_log");
    expect(JSON.stringify(mocks.query.mock.calls[2]?.[1])).not.toContain("challenge:ticket-12345");
    expect(JSON.stringify(mocks.query.mock.calls[2]?.[1])).toContain("referenceSha256");
  });

  it("rejects non-admin attestation before touching the database", async () => {
    await expect(recordEmailVerificationEvidence({ ...admin, crmRole: "member" }, {})).rejects.toMatchObject({
      status: 403,
      code: "admin_required",
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
