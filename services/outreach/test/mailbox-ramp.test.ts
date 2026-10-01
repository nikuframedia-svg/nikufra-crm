import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db.js", () => ({ pool: { query: mocks.query }, transaction: vi.fn() }));

import { advanceMailboxRamp, validateMailboxRamp } from "../src/mutations.js";
import type { Actor } from "../src/types.js";

const ready = {
  provider: "google",
  email: "mia@nikufra.ai",
  status: "active",
  sendEnabled: false,
  dailyLimit: 10,
  rampDailyLimit: 1,
  dnsReady: true,
  credentialsReady: true,
  adminExceptionRecorded: false,
};

const admin: Actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@nikufra.ai",
  name: "Admin",
  crmRole: "admin",
  outreachRole: "viewer",
  capabilities: new Set(),
};

describe("mailbox activation and ramp", () => {
  beforeEach(() => mocks.query.mockReset());

  it("uses the database ramp independently from the configured ceiling", () => {
    expect(Math.min(ready.dailyLimit, ready.rampDailyLimit)).toBe(1);
    expect(() => validateMailboxRamp(ready, { sendEnabled: true })).not.toThrow();
  });

  it("requires passing DNS and a connected provider", () => {
    expect(() => validateMailboxRamp({ ...ready, dailyLimit: 1, dnsReady: false }, { sendEnabled: true })).toThrowError(/SPF/);
    expect(() => validateMailboxRamp({ ...ready, dailyLimit: 1, credentialsReady: false }, { sendEnabled: true })).toThrowError(/Liga novamente/);
  });

  it("delegates step order, the 48-hour window and incident checks to the atomic RPC", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: "mailbox-1", daily_limit: 10, ramp_daily_limit: 3 }] });

    await expect(advanceMailboxRamp(admin, "mailbox-1")).resolves.toEqual({
      id: "mailbox-1",
      dailyLimit: 3,
      configuredDailyLimit: 10,
      rampDailyLimit: 3,
    });
    expect(mocks.query.mock.calls[0]?.[0]).toContain("private.outreach_advance_mailbox_ramp");
    expect(mocks.query.mock.calls[0]?.[1]).toEqual(["mailbox-1", admin.id]);
  });

  it("requires the formal privileged-account exception for Maria", () => {
    const maria = { ...ready, email: "maria@nikufra.ai" };
    expect(() => validateMailboxRamp(maria, { sendEnabled: true })).toThrowError(/Super Admin/);
    expect(() => validateMailboxRamp(maria, { sendEnabled: true, adminExceptionRecorded: true })).not.toThrow();
  });
});
