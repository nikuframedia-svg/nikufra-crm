import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(),
}));

import { abortReservedBeforeProvider, dispatchCanaryTripReason, handleDispatchGuardFailure, handleProviderPermitFailure } from "../src/delivery.js";

describe("final dispatch safety gate", () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue({ rows: [{ tripped: true }], rowCount: 1 });
  });

  it("cancels an ineligible unsent job and trips canary in a fresh query", async () => {
    const error = Object.assign(new Error("blocked"), { code: "P2001" });

    await expect(handleDispatchGuardFailure("00000000-0000-4000-8000-000000000001", error)).resolves.toEqual({
      reason: "dispatch.eligibility_failed",
      disposition: "cancelled",
    });

    expect(mocks.query.mock.calls[0]?.[0]).toContain("status='cancelled'");
    expect(mocks.query.mock.calls[1]?.[0]).toContain("private.outreach_trip_canary");
    expect(mocks.query.mock.calls[1]?.[1]).toEqual(["dispatch.eligibility_failed", "00000000-0000-4000-8000-000000000001"]);
  });

  it("trips canary and quarantines a duplicate ledger instead of retrying", async () => {
    const error = Object.assign(new Error("duplicate ledger"), { code: "P2002" });

    await expect(handleDispatchGuardFailure("00000000-0000-4000-8000-000000000002", error)).resolves.toEqual({
      reason: "dispatch.ledger_conflict",
      disposition: "reconciliation_required",
    });

    expect(mocks.query.mock.calls[0]?.[0]).toContain("private.outreach_trip_canary");
    expect(mocks.query.mock.calls[1]?.[0]).toContain("reconciliation_required");
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("status='cancelled'"))).toBe(false);
  });

  it("does not trip canary for an unrelated database error", async () => {
    const error = Object.assign(new Error("database unavailable"), { code: "08006" });

    expect(dispatchCanaryTripReason(error)).toBeNull();
    await handleDispatchGuardFailure("00000000-0000-4000-8000-000000000003", error);

    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls[0]?.[0]).toContain("status='cancelled'");
  });

  it("closes a writer-quarantined reservation when provider revalidation rejects before the call", async () => {
    await abortReservedBeforeProvider(
      "00000000-0000-4000-8000-000000000004",
      Object.assign(new Error("suppressed before provider"), { code: "P2003" }),
    );

    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain("set status='failed'");
    expect(sql).toContain("status in ('leased','reconciliation_required')");
    expect(sql).toContain("exists (select 1 from failed_reservation)");
  });

  it("closes the reservation before tripping canary on a P2003 eligibility recheck", async () => {
    const error = Object.assign(new Error('Permit de provider recusado: ["suppressed"]'), {
      code: "P2003",
      detail: "eligibility_failed",
    });

    await expect(handleProviderPermitFailure(
      "00000000-0000-4000-8000-000000000005",
      error,
    )).resolves.toEqual({
      reason: "dispatch.eligibility_failed",
      disposition: "cancelled",
      canaryTripped: true,
    });

    expect(mocks.query.mock.calls[0]?.[0]).toContain("set status='failed'");
    expect(mocks.query.mock.calls[1]?.[0]).toContain("private.outreach_trip_canary");
    expect(dispatchCanaryTripReason(
      Object.assign(new Error('Permit de provider recusado: ["suppressed"]'), { code: "P2003" }),
    )).toBe("dispatch.eligibility_failed");
  });

  it("asks the atomic trip gate in live but does not report a canary transition", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ tripped: false }], rowCount: 1 });
    const error = Object.assign(new Error('Permit de provider recusado: ["dns_not_ready"]'), {
      code: "P2003",
      detail: "eligibility_failed",
    });

    await expect(handleProviderPermitFailure(
      "00000000-0000-4000-8000-000000000006",
      error,
    )).resolves.toMatchObject({ canaryTripped: false });
    expect(mocks.query.mock.calls[1]?.[1]).toEqual([
      "dispatch.eligibility_failed",
      "00000000-0000-4000-8000-000000000006",
    ]);
  });

  it.each([
    "Permit de provider recusado: lease inválido",
    "Permit de provider recusado: reserva de delivery inválida",
    "Permit de provider recusado: credencial removida",
  ])("does not trip canary for operational P2003: %s", async (message) => {
    const error = Object.assign(new Error(message), { code: "P2003" });

    expect(dispatchCanaryTripReason(error)).toBeNull();
    await expect(handleProviderPermitFailure(
      "00000000-0000-4000-8000-000000000007",
      error,
    )).resolves.toMatchObject({ reason: null, canaryTripped: false });
    expect(mocks.query).toHaveBeenCalledOnce();
  });
});
