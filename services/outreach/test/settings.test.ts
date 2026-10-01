import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db.js", () => ({
  pool: { query: mocks.query },
  transaction: vi.fn(async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query })),
}));

import { ignoreInboundReconciliation, updateSystemSettings } from "../src/mutations.js";
import type { Actor } from "../src/types.js";

const admin: Actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@nikufra.ai",
  name: "Admin",
  crmRole: "admin",
  outreachRole: "viewer",
  capabilities: new Set(),
};

describe("settings mutation boundary", () => {
  beforeEach(() => mocks.query.mockReset());

  it.each([
    { mode: "canary" },
    { mode: "live", confirmation: "ACTIVATE_LIVE" },
    { mode: "disabled" },
    { sendEnabled: true },
  ])("rejects rollout control fields from the generic settings API: %j", async (patch) => {
    await expect(updateSystemSettings(admin, patch)).rejects.toMatchObject({ name: "ZodError" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("updates operational settings without invoking the rollout transition RPC", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ settings: { timezone: "Europe/Lisbon" } }] });

    await expect(updateSystemSettings(admin, { timezone: "Europe/Lisbon" })).resolves.toEqual({
      settings: { timezone: "Europe/Lisbon" },
    });

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0]?.[0]).toContain("private.outreach_update_settings");
    expect(mocks.query.mock.calls[0]?.[0]).not.toContain("outreach_transition_system");
  });
});

describe("inbound reconciliation mutations", () => {
  beforeEach(() => mocks.query.mockReset());

  it("ignore is atomic with its audit entry", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{
        id: "00000000-0000-4000-8000-000000000010",
        status: "ignored",
        mailbox_id: "00000000-0000-4000-8000-000000000020",
        kind: "reply",
        error: "unmatched_inbound",
      }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(ignoreInboundReconciliation(
      admin,
      "00000000-0000-4000-8000-000000000010",
    )).resolves.toEqual({ id: "00000000-0000-4000-8000-000000000010", status: "ignored" });

    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[0]?.[0]).toContain("private.outreach_inbound_reconciliation");
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(["00000000-0000-4000-8000-000000000010"]);
    expect(mocks.query.mock.calls[1]?.[0]).toContain("public.outreach_audit_log");
    expect(mocks.query.mock.calls[1]?.[1]?.[1]).toBe("inbound.reconciliation.ignored");
  });

  it("does not audit a missing or already-finalized item", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(ignoreInboundReconciliation(
      admin,
      "00000000-0000-4000-8000-000000000010",
    )).rejects.toMatchObject({ status: 404, code: "inbound_reconciliation_not_found" });
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
});
