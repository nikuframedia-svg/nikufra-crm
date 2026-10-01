import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { config } from "./config.js";
import { pool } from "./db.js";

export interface WorkerHeartbeat {
  recordedAt: string;
  healthy: boolean;
  continuousSince: string | null;
}

export interface WorkerReadinessState {
  lastHeartbeat: WorkerHeartbeat | null;
  lastSchedulerAt: string | null;
  lastInboundAt: string | null;
  schedulerError: string | null;
  inboundError: string | null;
  heartbeatError: string | null;
}

function isFresh(value: string | null, now: number, maximumAgeMs: number) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now + 30_000 && now - timestamp <= maximumAgeMs;
}

export function workerReadiness(
  state: WorkerReadinessState,
  now = Date.now(),
  schedulerMaximumAgeMs = Math.max(300_000, config.schedulerIntervalMs * 3),
  inboundMaximumAgeMs = Math.max(300_000, config.inboundIntervalMs * 3),
) {
  const heartbeatFresh = state.lastHeartbeat?.healthy === true
    && isFresh(state.lastHeartbeat.recordedAt, now, 150_000);
  const schedulerFresh = isFresh(state.lastSchedulerAt, now, schedulerMaximumAgeMs);
  const inboundFresh = isFresh(state.lastInboundAt, now, inboundMaximumAgeMs);
  const errors = [state.schedulerError, state.inboundError, state.heartbeatError].filter((value): value is string => Boolean(value));
  return {
    ready: heartbeatFresh && schedulerFresh && inboundFresh && errors.length === 0,
    heartbeatFresh,
    schedulerFresh,
    inboundFresh,
    errors,
  };
}

export function createHeartbeatInstanceId(workerId: string, host: string, bootId: string) {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9_.:-]/g, "_");
  return `${safe(workerId).slice(0, 48)}:${safe(host).slice(0, 24)}:${safe(bootId).slice(0, 36)}`;
}

// Lease ownership intentionally stays stable (`config.workerId`), while the
// heartbeat owner is boot-unique. A crash/restart inside the five-minute gap
// therefore resets worker_continuous_since instead of inheriting uptime.
export const heartbeatInstanceId = createHeartbeatInstanceId(config.workerId, hostname(), randomUUID());

/**
 * Persist worker liveness in the database so the 24-hour canary gate survives
 * process restarts and cannot be inferred from an in-memory health endpoint.
 */
export async function recordWorkerHeartbeat(healthy: boolean): Promise<WorkerHeartbeat> {
  const result = await pool.query<{
    worker_last_heartbeat_at: Date | string;
    worker_continuous_since: Date | string | null;
  }>(`
    select worker_last_heartbeat_at,worker_continuous_since
    from private.outreach_record_worker_heartbeat($1,$2)`, [heartbeatInstanceId, healthy]);
  const row = result.rows[0];
  return {
    recordedAt: row?.worker_last_heartbeat_at
      ? new Date(row.worker_last_heartbeat_at).toISOString()
      : new Date().toISOString(),
    healthy,
    continuousSince: row?.worker_continuous_since
      ? new Date(row.worker_continuous_since).toISOString()
      : null,
  };
}
