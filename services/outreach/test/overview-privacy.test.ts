import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, OutreachRole } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  config: {
    outboundEnvEnabled: true,
    shadowMode: true,
    google: { enabled: true },
    microsoft: { enabled: false },
    smtpEnabled: false,
    inboundEnabled: true,
    adminOnly: true,
  },
}));
vi.mock("../src/db.js", () => ({ pool: { query: mocks.query }, transaction: vi.fn() }));
vi.mock("../src/config.js", () => ({ config: mocks.config }));

import { overview } from "../src/repository.js";

function actor(crmRole: "admin" | "member", outreachRole: OutreachRole): Actor {
  return { id: "00000000-0000-4000-8000-000000000001", email: "user@nikufra.ai", name: "User", crmRole, outreachRole, capabilities: new Set() };
}

const aggregate = {
  campaigns_total: "3",
  campaigns_running: "1",
  sent_today: "4",
  replies_total: "2",
  positive_replies: "1",
  queued_jobs: "7",
  mode: "disabled",
  send_enabled: false,
};

describe("overview privacy", () => {
  beforeEach(() => mocks.query.mockReset());

  it("returns only aggregates to a viewer without querying job identities", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [aggregate] });

    const result = await overview(actor("member", "viewer"));

    expect(result.nextJobs).toEqual([]);
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("contactName");
  });

  it("allows campaign managers to see operational next-job detail", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [aggregate] })
      .mockResolvedValueOnce({ rows: [{ id: "job-1", campaignName: "Campaign", contactName: "Lead", dueAt: "2026-09-30T12:00:00Z" }] });

    const result = await overview(actor("member", "campaign_manager"));

    expect(result.nextJobs).toHaveLength(1);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("never reports outbound active while shadow mode is enabled", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ ...aggregate, mode: "live", send_enabled: true }] });

    const result = await overview(actor("member", "viewer"));

    expect(result.outboundEnabled).toBe(false);
  });
});
