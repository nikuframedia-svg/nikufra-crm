import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveMx: vi.fn() }));
vi.mock("node:dns", () => ({ promises: { resolveMx: mocks.resolveMx } }));

import { verifyEmailAddress } from "../src/verification.js";

describe("email verification evidence", () => {
  beforeEach(() => mocks.resolveMx.mockReset());

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
});
