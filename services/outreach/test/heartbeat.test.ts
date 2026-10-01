import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db.js", () => ({ pool: { query: mocks.query } }));

import { createHeartbeatInstanceId, heartbeatInstanceId, recordWorkerHeartbeat, workerReadiness } from "../src/heartbeat.js";

describe("durable worker heartbeat", () => {
  beforeEach(() => mocks.query.mockReset());

  it("uses a boot-unique owner so a restart cannot inherit continuous uptime", () => {
    const first = createHeartbeatInstanceId("outreach-worker", "host-a", "boot-a");
    const restarted = createHeartbeatInstanceId("outreach-worker", "host-a", "boot-b");
    expect(first).not.toBe(restarted);
    expect(heartbeatInstanceId.length).toBeLessThanOrEqual(120);
  });

  it("records both healthy and unhealthy states through the narrow DB function", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ worker_last_heartbeat_at: "2026-09-30T12:00:00Z", worker_continuous_since: "2026-09-30T12:00:00Z" }] })
      .mockResolvedValueOnce({ rows: [{ worker_last_heartbeat_at: "2026-09-30T12:01:00Z", worker_continuous_since: null }] });

    await expect(recordWorkerHeartbeat(true)).resolves.toMatchObject({ healthy: true, continuousSince: "2026-09-30T12:00:00.000Z" });
    await expect(recordWorkerHeartbeat(false)).resolves.toMatchObject({ healthy: false, continuousSince: null });
    expect(mocks.query.mock.calls[0]?.[0]).toContain("private.outreach_record_worker_heartbeat");
    expect(mocks.query.mock.calls[0]?.[1]?.[0]).toBe(heartbeatInstanceId);
    expect(mocks.query.mock.calls[1]?.[1]).toEqual([heartbeatInstanceId, false]);
  });

  it("is not ready during startup before both pipelines complete", () => {
    const result = workerReadiness({
      lastHeartbeat: null,
      lastSchedulerAt: null,
      lastInboundAt: null,
      schedulerError: null,
      inboundError: null,
      heartbeatError: null,
    }, Date.parse("2026-09-30T12:00:00Z"), 300_000, 300_000);
    expect(result).toMatchObject({ ready: false, heartbeatFresh: false, schedulerFresh: false, inboundFresh: false });
  });

  it("does not let one successful pipeline mask an error in the other", () => {
    const result = workerReadiness({
      lastHeartbeat: { recordedAt: "2026-09-30T12:00:00Z", healthy: true, continuousSince: "2026-09-30T10:00:00Z" },
      lastSchedulerAt: "2026-09-30T12:00:00Z",
      lastInboundAt: "2026-09-30T12:00:00Z",
      schedulerError: "scheduler_failed",
      inboundError: null,
      heartbeatError: null,
    }, Date.parse("2026-09-30T12:00:30Z"), 300_000, 300_000);
    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(["scheduler_failed"]);
  });

  it("rejects a stale heartbeat even when the work loops are fresh", () => {
    const result = workerReadiness({
      lastHeartbeat: { recordedAt: "2026-09-30T11:55:00Z", healthy: true, continuousSince: "2026-09-30T10:00:00Z" },
      lastSchedulerAt: "2026-09-30T12:00:00Z",
      lastInboundAt: "2026-09-30T12:00:00Z",
      schedulerError: null,
      inboundError: null,
      heartbeatError: null,
    }, Date.parse("2026-09-30T12:00:30Z"), 300_000, 300_000);
    expect(result).toMatchObject({ ready: false, heartbeatFresh: false, schedulerFresh: true, inboundFresh: true });
  });

  it("becomes ready only with fresh successful heartbeat, scheduler and inbound cycles", () => {
    const result = workerReadiness({
      lastHeartbeat: { recordedAt: "2026-09-30T12:00:00Z", healthy: true, continuousSince: "2026-09-30T10:00:00Z" },
      lastSchedulerAt: "2026-09-30T11:59:50Z",
      lastInboundAt: "2026-09-30T11:59:45Z",
      schedulerError: null,
      inboundError: null,
      heartbeatError: null,
    }, Date.parse("2026-09-30T12:00:30Z"), 300_000, 300_000);
    expect(result).toMatchObject({ ready: true, heartbeatFresh: true, schedulerFresh: true, inboundFresh: true, errors: [] });
  });
});
