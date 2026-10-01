import { config } from "./config.js";
import { runConcurrentBatch } from "./batch.js";
import { dispatchJob, leaseDueJobs, reconcileAmbiguousJobs, recoverExpiredLeases } from "./delivery.js";
import { pool } from "./db.js";

export interface ShadowEvaluation {
  evaluatedAt: string;
  dueJobs: number;
  eligibleJobs: number;
  blockedJobs: number;
  nextDueAt: string | null;
}

export async function evaluateShadowJobs(): Promise<ShadowEvaluation> {
  const result = await pool.query<{
    due_jobs: string;
    eligible_jobs: string;
    blocked_jobs: string;
    next_due_at: Date | null;
  }>(`
    with due as (
      select j.scheduled_at,
             coalesce((private.outreach_recipient_eligibility(j.recipient_id,j.mailbox_id,now())->>'eligible')::boolean,false) eligible
      from public.outreach_jobs j
      where j.status='pending' and j.scheduled_at<=now()
    )
    select count(*)::text due_jobs,
           count(*) filter(where eligible)::text eligible_jobs,
           count(*) filter(where not eligible)::text blocked_jobs,
           min(scheduled_at) next_due_at
    from due`);
  const row = result.rows[0];
  return {
    evaluatedAt: new Date().toISOString(),
    dueJobs: Number(row?.due_jobs ?? 0),
    eligibleJobs: Number(row?.eligible_jobs ?? 0),
    blockedJobs: Number(row?.blocked_jobs ?? 0),
    nextDueAt: row?.next_due_at ? new Date(row.next_due_at).toISOString() : null,
  };
}

export async function runSchedulerCycle() {
  // Reconciliation stays alive under the outbound kill switch and only
  // confirms an already-visible provider message. Expired-lease recovery is
  // deliberately held while disabled so shadow evaluation cannot mutate job
  // state; the DB claim function recovers leases before the next active claim.
  const reconciliation = await reconcileAmbiguousJobs();
  // Shadow is an independent, non-bypassable read-only gate. Even a stale or
  // prematurely enabled SEND flag must never lease/recover/dispatch while
  // shadow remains true.
  if (config.shadowMode) {
    return { mode: "shadow" as const, reconciliation, shadow: await evaluateShadowJobs(), failures: [] as string[] };
  }
  // Disabling shadow is not itself permission to send: the environment hard
  // gate must also be active.
  if (!config.outboundEnvEnabled) return { mode: "disabled" as const, reconciliation, failures: [] as string[] };

  const recovered = await recoverExpiredLeases();
  const jobs = await leaseDueJobs(20);
  const settled = await runConcurrentBatch(jobs, (jobId) => dispatchJob(jobId), 5);
  const failures = settled.flatMap((result) => result.status === "rejected"
    ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
    : []);
  return { mode: "active" as const, recovered, reconciliation, leased: jobs.length, failures };
}
