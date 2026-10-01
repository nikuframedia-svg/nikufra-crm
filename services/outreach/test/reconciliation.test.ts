import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db.js", () => ({ pool: { query: mocks.query }, transaction: vi.fn() }));

import { listInboundReconciliation, listJobReconciliation } from "../src/repository.js";

describe("inbound reconciliation privacy", () => {
  beforeEach(() => mocks.query.mockReset());

  it("returns operational metadata without selecting identity or encrypted payload fields", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "reconciliation-1", kind: "reply", status: "reconciliation_required" }] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });

    await expect(listInboundReconciliation({ page: 1, pageSize: 25, offset: 0 })).resolves.toMatchObject({
      items: [{ id: "reconciliation-1" }],
      page: { total: 1 },
    });

    const listingSql = String(mocks.query.mock.calls[0]?.[0]);
    expect(listingSql).not.toContain("payload_encrypted");
    expect(listingSql).not.toContain("identity_hmac");
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(["reconciliation_required", 25, 0]);
  });
});

describe("job reconciliation evidence", () => {
  beforeEach(() => mocks.query.mockReset());

  it("lists only operational proof and computes the no-retry adjudication gate", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "job-1", notFoundCount: 2, eligibleForCancellation: true }] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });

    await expect(listJobReconciliation({ page: 1, pageSize: 25, offset: 0 })).resolves.toMatchObject({
      items: [{ id: "job-1", notFoundCount: 2, eligibleForCancellation: true }],
      page: { total: 1 },
    });

    const listingSql = String(mocks.query.mock.calls[0]?.[0]);
    expect(listingSql).toContain("reconciliationNotFoundCount");
    expect(listingSql).toContain("job.status='reconciliation_required'");
    expect(listingSql).not.toContain("evidence_reference");
  });
});
