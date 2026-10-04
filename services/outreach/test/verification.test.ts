import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveMx: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn() }));
vi.mock("node:dns", () => ({ promises: { resolveMx: mocks.resolveMx, resolve4: mocks.resolve4, resolve6: mocks.resolve6 } }));

import { verifyEmailAddress } from "../src/verification.js";

describe("email verification evidence", () => {
  beforeEach(() => {
    mocks.resolveMx.mockReset();
    mocks.resolve4.mockReset();
    mocks.resolve6.mockReset();
  });

  it("does not mark an invented mailbox valid merely because its domain has MX", async () => {
    mocks.resolveMx.mockResolvedValue([{ exchange: "smtp.google.com", priority: 1 }]);

    await expect(verifyEmailAddress("does-not-exist@example.com")).resolves.toMatchObject({
      email: "does-not-exist@example.com",
      status: "unknown",
      disposable: false,
      roleAddress: false,
    });
  });

  it("rejects RFC 7505 null MX domains", async () => {
    mocks.resolveMx.mockResolvedValue([{ exchange: ".", priority: 0 }]);
    await expect(verifyEmailAddress("lead@example.com")).resolves.toMatchObject({ status: "invalid", mxHosts: [] });
  });

  it("treats an A record as an implicit MX without claiming the mailbox exists", async () => {
    mocks.resolveMx.mockRejectedValue({ code: "ENODATA" });
    mocks.resolve4.mockResolvedValue(["192.0.2.1"]);
    mocks.resolve6.mockRejectedValue({ code: "ENODATA" });
    await expect(verifyEmailAddress("lead@example.com")).resolves.toMatchObject({ status: "unknown", mxHosts: [] });
  });

  it("rejects a domain with neither MX nor address records", async () => {
    mocks.resolveMx.mockRejectedValue({ code: "ENODATA" });
    mocks.resolve4.mockRejectedValue({ code: "ENODATA" });
    mocks.resolve6.mockRejectedValue({ code: "ENODATA" });
    await expect(verifyEmailAddress("lead@example.com")).resolves.toMatchObject({ status: "invalid", mxHosts: [] });
  });

  it("keeps temporary DNS failures inconclusive", async () => {
    mocks.resolveMx.mockRejectedValue({ code: "ENODATA" });
    mocks.resolve4.mockRejectedValue({ code: "ESERVFAIL" });
    mocks.resolve6.mockRejectedValue({ code: "ENODATA" });
    await expect(verifyEmailAddress("lead@example.com")).resolves.toMatchObject({ status: "unknown", mxHosts: [] });
  });
});
