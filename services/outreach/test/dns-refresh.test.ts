import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), inspectDomain: vi.fn() }));
vi.mock("../src/db.js", () => ({ pool: { query: mocks.query } }));
vi.mock("../src/dns.js", () => ({ inspectDomain: mocks.inspectDomain }));

import { refreshDueDnsChecks } from "../src/dns-refresh.js";

describe("automatic DNS refresh", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.inspectDomain.mockReset();
  });

  it("checks and records DNS for an active campaign mailbox before the 24-hour gate expires", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: "mailbox-1", email: "mia@getnikufra.com", selector: "google" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mocks.inspectDomain.mockResolvedValue({
      checkedAt: "2026-10-23T15:00:00.000Z",
      spf: { status: "pass" }, dkim: { status: "pass" },
      dmarc: { status: "pass" }, mx: { status: "pass" },
    });

    await expect(refreshDueDnsChecks()).resolves.toEqual({ due: 1, refreshed: 1, failures: [] });
    expect(mocks.inspectDomain).toHaveBeenCalledWith("getnikufra.com", "google");
    expect(mocks.query.mock.calls[0]?.[0]).toContain("interval '12 hours'");
    expect(mocks.query.mock.calls[1]?.[1]?.slice(0, 6)).toEqual(["mailbox-1", "getnikufra.com", "pass", "pass", "pass", "pass"]);
    expect(mocks.query.mock.calls[1]?.[0]).toContain("mailbox.dns.automatically_checked");
  });

  it("keeps retrying other mailboxes when one DNS lookup fails", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [
      { id: "mailbox-1", email: "one@example.com", selector: "google" },
      { id: "mailbox-2", email: "two@example.com", selector: "google" },
    ] }).mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mocks.inspectDomain.mockRejectedValueOnce(new Error("resolver unavailable"))
      .mockResolvedValueOnce({
        checkedAt: "2026-10-23T15:00:00.000Z",
        spf: { status: "pass" }, dkim: { status: "pass" },
        dmarc: { status: "pass" }, mx: { status: "pass" },
      });

    await expect(refreshDueDnsChecks()).resolves.toEqual({
      due: 2, refreshed: 1, failures: [{ mailboxId: "mailbox-1", error: "resolver unavailable" }],
    });
  });
});
