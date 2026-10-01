import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

const mocks = vi.hoisted(() => ({
  config: { outboundEnvEnabled: false, shadowMode: true },
  query: vi.fn(),
  dispatchJob: vi.fn(),
  leaseDueJobs: vi.fn(),
  reconcileAmbiguousJobs: vi.fn(),
  recoverExpiredLeases: vi.fn(),
}));

vi.mock("../src/config.js", () => ({ config: mocks.config }));
vi.mock("../src/db.js", () => ({ pool: { query: mocks.query } }));
vi.mock("../src/delivery.js", () => ({
  dispatchJob: mocks.dispatchJob,
  leaseDueJobs: mocks.leaseDueJobs,
  reconcileAmbiguousJobs: mocks.reconcileAmbiguousJobs,
  recoverExpiredLeases: mocks.recoverExpiredLeases,
}));

import { runSchedulerCycle } from "../src/scheduler.js";

describe("outbound shadow mode", () => {
  beforeEach(() => {
    [mocks.query, mocks.dispatchJob, mocks.leaseDueJobs, mocks.reconcileAmbiguousJobs, mocks.recoverExpiredLeases]
      .forEach((mock) => mock.mockReset());
    mocks.config.outboundEnvEnabled = false;
    mocks.config.shadowMode = true;
    mocks.reconcileAmbiguousJobs.mockResolvedValue({ checked: 0, confirmed: 0 });
  });

  it("evaluates due-job eligibility without leasing, dispatching, or mutating state", async () => {
    mocks.query.mockResolvedValue({ rows: [{ due_jobs: "12", eligible_jobs: "9", blocked_jobs: "3", next_due_at: new Date("2026-09-30T12:00:00Z") }] });

    const result = await runSchedulerCycle();

    expect(result).toMatchObject({ mode: "shadow", shadow: { dueJobs: 12, eligibleJobs: 9, blockedJobs: 3, nextDueAt: "2026-09-30T12:00:00.000Z" } });
    expect(mocks.dispatchJob).not.toHaveBeenCalled();
    expect(mocks.leaseDueJobs).not.toHaveBeenCalled();
    expect(mocks.reconcileAmbiguousJobs).toHaveBeenCalledOnce();
    expect(mocks.recoverExpiredLeases).not.toHaveBeenCalled();
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain("outreach_recipient_eligibility");
    expect(sql).not.toMatch(/\b(?:insert|update|delete)\b/i);
  });

  it("stays read-only when SEND is true but shadow mode was not explicitly disabled", async () => {
    mocks.config.outboundEnvEnabled = true;
    mocks.config.shadowMode = true;
    mocks.query.mockResolvedValue({ rows: [{ due_jobs: "1", eligible_jobs: "1", blocked_jobs: "0", next_due_at: null }] });

    await expect(runSchedulerCycle()).resolves.toMatchObject({ mode: "shadow" });

    expect(mocks.recoverExpiredLeases).not.toHaveBeenCalled();
    expect(mocks.leaseDueJobs).not.toHaveBeenCalled();
    expect(mocks.dispatchJob).not.toHaveBeenCalled();
  });

  it("keeps sends disabled but still finalizes provider-proven reconciliation", async () => {
    mocks.config.shadowMode = false;
    mocks.reconcileAmbiguousJobs.mockResolvedValueOnce({ checked: 1, confirmed: 1 });

    await expect(runSchedulerCycle()).resolves.toEqual({ mode: "disabled", reconciliation: { checked: 1, confirmed: 1 }, failures: [] });

    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.dispatchJob).not.toHaveBeenCalled();
    expect(mocks.leaseDueJobs).not.toHaveBeenCalled();
    expect(mocks.reconcileAmbiguousJobs).toHaveBeenCalledOnce();
    expect(mocks.recoverExpiredLeases).not.toHaveBeenCalled();
  });

  it("keeps operational mode transitions and readiness aligned with the shadow gate", async () => {
    const [control, readiness] = await Promise.all([
      readFile(new URL("../../../infra/outreach-control.sh", import.meta.url), "utf8"),
      readFile(new URL("../../../infra/outreach-readiness.sh", import.meta.url), "utf8"),
    ]);

    expect(control).toContain("set_env OUTREACH_SHADOW_MODE true");
    expect(control.match(/set_env OUTREACH_SHADOW_MODE false/g)).toHaveLength(2);
    expect(readiness).toContain('"${OUTREACH_SHADOW_MODE:-true}" == true');
    expect(readiness).toContain('"${OUTREACH_SHADOW_MODE:-true}" == false');
    expect(readiness).toContain('"${worker_shadow_mode}" == true');
    expect(readiness).toContain('"${worker_shadow_mode}" == false');
  });
});
