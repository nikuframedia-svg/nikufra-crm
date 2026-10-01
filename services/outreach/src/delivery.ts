import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "./config.js";
import { sha256, unsubscribeHmac } from "./crypto.js";
import { pool, transaction } from "./db.js";
import { HttpError } from "./errors.js";
import { buildMime } from "./mime.js";
import { providerSession } from "./repository.js";
import { isProviderAuthorizationFailure, prepareProviderSession, reconcileProviderMessage, sendProviderMessage } from "./providers.js";
import type { ProviderSession } from "./providers.js";
import type { DeliveryEnvelope, ProviderReceipt } from "./types.js";

interface JobRow {
  id: string;
  campaign_id: string;
  recipient_id: string;
  step_id: string;
  variant_id: string | null;
  mailbox_id: string;
  idempotency_key: string;
  email: string;
  mailbox_email: string;
  sender_name: string;
  subject_template: string;
  body_template: string;
  variable_snapshot: Record<string, unknown>;
  provider_thread_id: string | null;
  in_reply_to: string | null;
  references: string[] | null;
}

// Must stay aligned with private.outreach_lock_send_gate_writer() and the
// explicit xact locks in transition/trip/incident SQL paths.
export const OUTBOUND_SEND_GATE = [20_260_930, 1] as const;

function assertOutboundProcessGate() {
  if (config.shadowMode) {
    throw new HttpError(503, "outbound_shadow_mode", "O Outreach está em shadow mode read-only.");
  }
  if (!config.outboundEnvEnabled) {
    throw new HttpError(503, "outbound_env_disabled", "O hard gate de envio está desligado.");
  }
}

export async function withOutboundProviderPermit<T>(
  jobId: string,
  operation: (client: PoolClient) => Promise<T>,
) {
  assertOutboundProcessGate();
  const client = await pool.connect();
  let locked = false;
  let releaseError: Error | undefined;
  try {
    await client.query(
      `select pg_advisory_lock_shared($1,$2)`,
      [...OUTBOUND_SEND_GATE],
    );
    locked = true;
    // This RPC re-runs the complete eligibility decision after the shared
    // permit is held. Writers that won the exclusive lock are now committed
    // and visible; writers that lost wait until the provider call returns.
    await client.query(
      `select private.outreach_assert_provider_permit($1,$2)`,
      [jobId, config.workerId],
    );
    return await operation(client);
  } finally {
    if (locked) {
      try {
        const unlocked = await client.query<{ unlocked: boolean }>(
          `select pg_advisory_unlock_shared($1,$2) unlocked`,
          [...OUTBOUND_SEND_GATE],
        );
        if (!unlocked.rows[0]?.unlocked) {
          releaseError = new Error("O permit partilhado de outbound não pôde ser libertado.");
        }
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error(String(error));
      }
    }
    client.release(releaseError);
    if (releaseError) throw releaseError;
  }
}

export async function withCurrentProviderSession<T>(
  jobId: string,
  mailboxId: string,
  operation: (session: ProviderSession, client: PoolClient) => Promise<T>,
) {
  // Refresh before taking the shared permit so no network token exchange can
  // consume the writer wait budget. The refresh persists with CAS semantics.
  await prepareProviderSession(await providerSession(mailboxId));
  return withOutboundProviderPermit(jobId, async (client) => {
    // Re-load after the permit/recheck. A full reauthorization may have
    // replaced the row while the worker waited for a pool connection or lock;
    // the provider must receive that current grant, never the cached old one.
    const currentSession = await providerSession(mailboxId, client);
    return operation(currentSession, client);
  });
}

export async function recoverExpiredLeases() {
  const result = await pool.query(`
    update public.outreach_jobs j
    set status=case when exists(select 1 from private.outreach_delivery_ledger l where l.job_id=j.id) then 'reconciliation_required'::public.outreach_job_status else 'pending'::public.outreach_job_status end,
        lease_owner=null,lease_expires_at=null,last_error='lease_expired',updated_at=now()
    where j.status='leased' and j.lease_expires_at<now() returning j.id`);
  return result.rowCount ?? 0;
}

export async function leaseDueJobs(limit = 20, workerId = config.workerId) {
  if (!config.outboundEnvEnabled || config.shadowMode) return [] as string[];
  // The SECURITY DEFINER claim function owns the mailbox advisory lock,
  // eligibility check and one-live-lease-per-mailbox invariant. A client-side
  // SELECT ... SKIP LOCKED cannot prevent two workers claiming different jobs
  // for the same mailbox in parallel.
  const jobs = await pool.query<{ id: string }>(
    `select id from private.outreach_claim_jobs($1,$2,$3)`,
    [workerId, limit, config.leaseSeconds],
  );
  return jobs.rows.map((row) => row.id);
}

function render(template: string, variables: Record<string, unknown>) {
  const missing = new Set<string>();
  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null || value === "") {
      missing.add(key);
      return "";
    }
    return String(value);
  });
  if (missing.size) throw new HttpError(409, "template_variables_missing", "Faltam variáveis obrigatórias no snapshot do destinatário.", { variables: [...missing] });
  return rendered;
}

export function unsubscribeToken(recipientId: string, deliveryId: string) {
  // A different delivery must receive a different one-click token. Keeping the
  // job id in the MAC input remains deterministic for reconciliation/retries,
  // while preventing a previously consumed token from becoming a no-op after
  // a lawful re-subscription followed by a later campaign.
  return `${deliveryId}.${unsubscribeHmac(`unsubscribe:${recipientId}:${deliveryId}`)}`;
}

async function loadJob(jobId: string): Promise<JobRow> {
  const result = await pool.query<JobRow>(`
    select j.id,j.campaign_id,j.recipient_id,j.step_id,j.variant_id,j.mailbox_id,j.idempotency_key,
           r.email_snapshot::text email,m.email::text mailbox_email,m.display_name sender_name,
           v.subject_template,v.body_template,r.variable_snapshot,
           t.provider_thread_id,
           (select msg.internet_message_id from public.outreach_messages msg where msg.thread_id=t.id and msg.direction='outbound' order by msg.occurred_at desc limit 1) in_reply_to,
           (select array_agg(msg.internet_message_id order by msg.occurred_at) filter (where msg.internet_message_id is not null) from public.outreach_messages msg where msg.thread_id=t.id) references
    from public.outreach_jobs j
    join public.outreach_recipients r on r.id=j.recipient_id
    join public.outreach_mailboxes m on m.id=j.mailbox_id
    join public.outreach_campaign_variants v on v.id=j.variant_id
    left join lateral (select * from public.outreach_threads th where th.recipient_id=r.id and th.mailbox_id=m.id order by th.last_message_at desc limit 1) t on true
    where j.id=$1 and j.status='leased' and j.lease_owner=$2`, [jobId, config.workerId]);
  const row = result.rows[0];
  if (!row) throw new HttpError(409, "job_not_leased", "O job já não está reservado por este worker.");
  return row;
}

async function createEnvelope(job: JobRow) {
  const token = unsubscribeToken(job.recipient_id, job.id);
  const tokenHash = sha256(token);
  await pool.query(`insert into private.outreach_unsubscribe_tokens(token_hash,recipient_id,expires_at) values($1,$2,now()+interval '2 years') on conflict(token_hash) do nothing`, [tokenHash, job.recipient_id]);
  const senderName = job.sender_name || job.mailbox_email.split("@")[0] || "Nikufra";
  const variables = { ...job.variable_snapshot, remetente: senderName, sender: senderName, sender_email: job.mailbox_email };
  return {
    jobId: job.id,
    recipientId: job.recipient_id,
    campaignId: job.campaign_id,
    mailboxId: job.mailbox_id,
    fromEmail: job.mailbox_email,
    senderName,
    to: job.email,
    subject: render(job.subject_template, variables),
    text: render(job.body_template, variables),
    unsubscribeUrl: `${config.publicUrl}/api/outreach/v1/unsubscribe/${encodeURIComponent(token)}`,
    providerThreadId: job.provider_thread_id,
    inReplyTo: job.in_reply_to,
    references: job.references ?? [],
    idempotencyKey: job.idempotency_key,
  } satisfies DeliveryEnvelope;
}

function payloadHash(envelope: DeliveryEnvelope) {
  return createHash("sha256").update(JSON.stringify({ from: envelope.fromEmail, to: envelope.to, subject: envelope.subject, text: envelope.text, unsubscribeUrl: envelope.unsubscribeUrl, inReplyTo: envelope.inReplyTo, references: envelope.references })).digest();
}

async function beginDispatch(job: JobRow, envelope: DeliveryEnvelope) {
  assertOutboundProcessGate();
  const mime = buildMime({ idempotencyKey: envelope.idempotencyKey, senderName: envelope.senderName, from: envelope.fromEmail, to: envelope.to, subject: envelope.subject, text: envelope.text, unsubscribeUrl: envelope.unsubscribeUrl, inReplyTo: envelope.inReplyTo, references: envelope.references });
  await transaction(async (client) => {
    await client.query(`select private.outreach_assert_dispatch_eligible($1,$2)`, [job.id, payloadHash(envelope)]);
    await client.query(`update private.outreach_delivery_ledger set provider_response=$2::jsonb,last_attempt_at=now() where job_id=$1`, [job.id, JSON.stringify({ expectedInternetMessageId: mime.internetMessageId })]);
  }, "serializable");
  return mime.internetMessageId;
}

async function recordProviderAccepted(jobId: string, receipt: ProviderReceipt, client: PoolClient) {
  await client.query("begin");
  try {
    // Bound unexpected row-lock contention so the shared permit remains well
    // below the exclusive writer's 20s lock budget (10s POST + at most 2s).
    await client.query(`set local lock_timeout='2s'`);
    const accepted = await client.query(`
      update private.outreach_delivery_ledger
      set status='accepted',provider_message_id=$2,
          provider_response=provider_response||$3::jsonb,last_attempt_at=now()
      where job_id=$1 and status='sending'
      returning id`, [jobId, receipt.providerMessageId, JSON.stringify(receipt)]);
    if (!accepted.rows[0]) {
      throw new HttpError(409, "delivery_reservation_lost", "A reserva de delivery deixou de estar disponível após a resposta do provider.");
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function finalizeDispatch(job: JobRow, envelope: DeliveryEnvelope, receipt: ProviderReceipt, scheduleFollowUp = true) {
  return transaction(async (client) => {
    const claimed = await client.query(`
      update private.outreach_delivery_ledger
      set status='confirmed',provider_message_id=$2,
          provider_response=provider_response||$3::jsonb,last_attempt_at=now()
      where job_id=$1 and status in ('sending','accepted','ambiguous')
      returning id`, [job.id, receipt.providerMessageId, JSON.stringify(receipt)]);
    // Another worker may have found the same Gmail Sent message. The ledger is
    // the compare-and-set gate so messages, metrics and next-step progression
    // are finalized exactly once.
    if (!claimed.rows[0]) return false;
    await client.query(`update public.outreach_jobs set status='sent',provider_message_id=$2,sent_at=$3,lease_owner=null,lease_expires_at=null,last_error=null where id=$1`, [job.id, receipt.providerMessageId, receipt.acceptedAt]);
    const thread = await client.query<{ id: string }>(`
      insert into public.outreach_threads(campaign_id,recipient_id,contact_id,company_id,mailbox_id,provider_thread_id,subject,last_message_at)
      select r.campaign_id,r.id,r.contact_id,r.company_id,$2,$3,$4,$5 from public.outreach_recipients r where r.id=$1
      on conflict(mailbox_id,provider_thread_id) where provider_thread_id is not null do update set last_message_at=excluded.last_message_at,subject=coalesce(public.outreach_threads.subject,excluded.subject)
      returning id`, [job.recipient_id, job.mailbox_id, receipt.providerThreadId, envelope.subject, receipt.acceptedAt]);
    const threadId = thread.rows[0]?.id;
    await client.query(`
      insert into public.outreach_messages(thread_id,campaign_id,recipient_id,contact_id,company_id,mailbox_id,direction,kind,provider_message_id,provider_thread_id,internet_message_id,subject,snippet,body_text,occurred_at)
      select $1,r.campaign_id,r.id,r.contact_id,r.company_id,$3,'outbound','email',$4,$5,$6,$7,left($8,500),$8,$9
      from public.outreach_recipients r where r.id=$2
      on conflict(mailbox_id,provider_message_id) do nothing`, [threadId, job.recipient_id, job.mailbox_id, receipt.providerMessageId, receipt.providerThreadId, receipt.internetMessageId, envelope.subject, envelope.text, receipt.acceptedAt]);
    if (scheduleFollowUp) await scheduleNextStep(client, job);
    return true;
  }, "serializable");
}

async function scheduleNextStep(client: import("pg").PoolClient, job: JobRow) {
  // A reply, bounce or suppression can arrive while the provider request is in
  // flight. Lock and re-check the recipient before materialising a follow-up;
  // whichever transaction wins first leaves the final state consistent.
  const recipientState = await client.query<{ status: string; responded_at: Date | null; suppressed: boolean }>(`
    select r.status::text,r.responded_at,
           private.outreach_is_suppressed(r.email_snapshot::text,r.company_id) suppressed
    from public.outreach_recipients r where r.id=$1 for update`, [job.recipient_id]);
  const recipient = recipientState.rows[0];
  if (!recipient || recipient.responded_at || recipient.suppressed || ["replied", "suppressed", "bounced", "deleted"].includes(recipient.status)) return;

  const next = await client.query<{ step_id: string; variant_id: string | null; delay_minutes: number; jitter_minutes: number }>(`
    with current_step as (select * from public.outreach_campaign_steps where id=$1),
    next_email as (
      select s.* from public.outreach_campaign_steps s,current_step current
      where s.campaign_id=current.campaign_id and s.position>current.position and s.ativo and s.kind='email'
      order by s.position limit 1
    )
    select s.id step_id,(select v.id from public.outreach_campaign_variants v where v.step_id=s.id and v.ativo order by v.weight desc,v.id limit 1) variant_id,
           (select coalesce(sum(between_steps.delay_minutes),0)::int from public.outreach_campaign_steps between_steps,current_step current where between_steps.campaign_id=current.campaign_id and between_steps.ativo and between_steps.position>current.position and between_steps.position<=s.position) delay_minutes,
           c.jitter_minutes
    from next_email s join public.outreach_campaigns c on c.id=s.campaign_id`, [job.step_id]);
  const row = next.rows[0];
  if (!row) {
    await client.query(`update public.outreach_recipients set status='completed',completed_at=now() where id=$1 and responded_at is null and status not in ('replied','suppressed','bounced','deleted')`, [job.recipient_id]);
    return;
  }
  const jitter = Math.min(config.maxJitterSeconds, Math.max(0, row.jitter_minutes * 60));
  const scheduledAt = new Date(Date.now() + row.delay_minutes * 60_000 + Math.floor(Math.random() * (jitter + 1)) * 1_000);
  await client.query(`insert into public.outreach_jobs(campaign_id,recipient_id,step_id,variant_id,mailbox_id,scheduled_at,idempotency_key) values($1,$2,$3,$4,$5,$6,$7) on conflict(idempotency_key) do nothing`, [job.campaign_id, job.recipient_id, row.step_id, row.variant_id, job.mailbox_id, scheduledAt, `campaign:${job.campaign_id}:recipient:${job.recipient_id}:step:${row.step_id}`]);
  await client.query(`update public.outreach_recipients set current_step=current_step+1,status='active' where id=$1 and responded_at is null and status not in ('replied','suppressed','bounced','deleted')`, [job.recipient_id]);
}

async function markAmbiguous(jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 2_000) : "Falha de provider desconhecida";
  await transaction(async (client) => {
    await client.query(`update private.outreach_delivery_ledger set status='ambiguous',provider_response=provider_response||$2::jsonb,last_attempt_at=now() where job_id=$1`, [jobId, JSON.stringify({ error: message })]);
    await client.query(`update public.outreach_jobs set status='reconciliation_required',lease_owner=null,lease_expires_at=null,last_error=$2 where id=$1`, [jobId, message]);
  });
}

export async function abortReservedBeforeProvider(jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 2_000) : "Falha antes da chamada ao provider";
  // The provider call provably did not start. Close only our reservation and
  // preserve any terminal state committed by the writer that made the job
  // ineligible (suppression, reply, disconnect or RGPD erase).
  await pool.query(`
    with failed_reservation as (
      update private.outreach_delivery_ledger
      set status='failed',
          provider_response=provider_response||$2::jsonb,
          last_attempt_at=now()
      where job_id=$1 and status='sending'
      returning id
    )
    update public.outreach_jobs
    set status='cancelled',lease_owner=null,lease_expires_at=null,
        last_error=$3,updated_at=now()
    where id=$1
      and status in ('leased','reconciliation_required')
      and exists (select 1 from failed_reservation)`, [
    jobId,
    JSON.stringify({ error: message, providerCallStarted: false }),
    `dispatch_revalidation_failed: ${message}`,
  ]);
}

async function disableMailboxAfterAuthorizationFailure(mailboxId: string, error: unknown) {
  if (!isProviderAuthorizationFailure(error)) return;
  await pool.query(`update public.outreach_mailboxes set status='error',send_enabled=false,last_error='oauth_reauthorization_required',updated_at=now() where id=$1`, [mailboxId]);
}

async function cancelBeforeDispatch(jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 2_000) : "Falha na revalidação transacional";
  await pool.query(`update public.outreach_jobs set status='cancelled',lease_owner=null,lease_expires_at=null,last_error=$2,updated_at=now() where id=$1 and status='leased'`, [jobId, `dispatch_revalidation_failed: ${message}`]);
}

export function dispatchCanaryTripReason(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const detail = typeof error === "object" && error !== null && "detail" in error ? String(error.detail ?? "") : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "P2001") return "dispatch.eligibility_failed" as const;
  if (code === "P2002") return "dispatch.ledger_conflict" as const;
  if (code === "P2003" && (
    detail === "eligibility_failed"
    // Compatibility with databases installed before the structured detail was
    // added. Operational P2003 failures (lease, reservation, credential) have
    // distinct fixed messages and must never trip the canary.
    || message.startsWith("Permit de provider recusado: [")
    || message.includes("configuração temporal inválida")
  )) return "dispatch.eligibility_failed" as const;
  return null;
}

async function tripCanaryAfterDispatchFailure(jobId: string, reason: NonNullable<ReturnType<typeof dispatchCanaryTripReason>>) {
  const result = await pool.query<{ tripped: boolean }>(
    `select private.outreach_trip_canary($1,$2) tripped`,
    [reason, jobId],
  );
  return Boolean(result.rows[0]?.tripped);
}

export async function handleDispatchGuardFailure(jobId: string, error: unknown) {
  const reason = dispatchCanaryTripReason(error);
  if (reason === "dispatch.eligibility_failed") {
    // This job definitively did not reach the provider, so cancel it before
    // tripping the canary. The trip then pauses campaigns and quarantines any
    // other leases whose provider boundary may be ambiguous.
    await cancelBeforeDispatch(jobId, error);
    await tripCanaryAfterDispatchFailure(jobId, reason);
    return { reason, disposition: "cancelled" as const };
  }
  if (reason === "dispatch.ledger_conflict") {
    // An existing ledger may represent a provider attempt. Never cancel or
    // retry blindly: trip canary first, then ensure live-mode calls also enter
    // reconciliation when the DB function correctly returns false.
    await tripCanaryAfterDispatchFailure(jobId, reason);
    await pool.query(`update public.outreach_jobs set status='reconciliation_required',lease_owner=null,lease_expires_at=null,last_error='dispatch_ledger_conflict',updated_at=now() where id=$1 and status='leased'`, [jobId]);
    return { reason, disposition: "reconciliation_required" as const };
  }
  await cancelBeforeDispatch(jobId, error);
  return { reason: null, disposition: "cancelled" as const };
}

export async function handleProviderPermitFailure(jobId: string, error: unknown) {
  // The provider call provably did not start. Close the sending reservation
  // first; only then may a failed final eligibility decision trip canary.
  await abortReservedBeforeProvider(jobId, error);
  const reason = dispatchCanaryTripReason(error);
  if (reason !== "dispatch.eligibility_failed") {
    return { reason: null, disposition: "cancelled" as const, canaryTripped: false };
  }
  const canaryTripped = await tripCanaryAfterDispatchFailure(jobId, reason);
  return { reason, disposition: "cancelled" as const, canaryTripped };
}

export async function dispatchJob(jobId: string) {
  assertOutboundProcessGate();
  const job = await loadJob(jobId);
  const envelope = await createEnvelope(job);
  try {
    await beginDispatch(job, envelope);
  } catch (error) {
    await handleDispatchGuardFailure(job.id, error);
    throw error;
  }
  let receipt: ProviderReceipt;
  let providerCallStarted = false;
  try {
    // OAuth refresh can take up to 20s and therefore runs before the shared
    // permit. Eligibility is rechecked only after this preparation completes.
    receipt = await withCurrentProviderSession(job.id, job.mailbox_id, async (session, permitClient) => {
      providerCallStarted = true;
      const providerReceipt = await sendProviderMessage(session, envelope, { credentialsPrepared: true });
      // Make the receipt durable before releasing the permit. The ledger has
      // no exclusive writer trigger, so this cannot self-deadlock.
      await recordProviderAccepted(job.id, providerReceipt, permitClient);
      return providerReceipt;
    });
  } catch (error) {
    await disableMailboxAfterAuthorizationFailure(job.mailbox_id, error);
    if (providerCallStarted) await markAmbiguous(jobId, error);
    else await handleProviderPermitFailure(jobId, error);
    throw error;
  }
  await finalizeDispatch(job, envelope, receipt);
  return { jobId, receipt };
}

export async function sendThreadReply(input: {
  threadId: string;
  actorId: string;
  canHandleAny: boolean;
  subject?: string;
  body: string;
  idempotencyKey: string;
}) {
  assertOutboundProcessGate();
  const prepared = await transaction(async (client) => {
    const selected = await client.query<JobRow & { thread_id: string; assigned_to: string | null; default_subject: string }>(`
      select gen_random_uuid()::text id,r.campaign_id,r.id recipient_id,s.id step_id,null::uuid variant_id,t.mailbox_id,
             ('manual:'||$4)::text idempotency_key,r.email_snapshot::text email,m.email::text mailbox_email,m.display_name sender_name,
             ''::text subject_template,''::text body_template,r.variable_snapshot,t.provider_thread_id,
             (select msg.internet_message_id from public.outreach_messages msg where msg.thread_id=t.id and msg.direction='outbound' order by msg.occurred_at desc limit 1) in_reply_to,
             (select array_agg(msg.internet_message_id order by msg.occurred_at) filter(where msg.internet_message_id is not null) from public.outreach_messages msg where msg.thread_id=t.id) references,
             t.id thread_id,t.assigned_to,coalesce(t.subject,'Re: conversa Nikufra') default_subject
      from public.outreach_threads t join public.outreach_recipients r on r.id=t.recipient_id join public.outreach_mailboxes m on m.id=t.mailbox_id
      join lateral (select step.id from public.outreach_campaign_steps step where step.campaign_id=r.campaign_id and step.ativo and step.kind='email' order by step.position desc limit 1) s on true
      where t.id=$1 and ($2::boolean or t.assigned_to=$3) for update of t,r`, [input.threadId, input.canHandleAny, input.actorId, input.idempotencyKey]);
    const row = selected.rows[0];
    if (!row) throw new HttpError(404, "thread_not_found", "Conversa não encontrada ou não atribuída a ti.");
    const decision = await client.query<{ decision: { eligible?: boolean; reasons?: string[] } }>(`select private.outreach_recipient_eligibility($1,$2,now()) decision`, [row.recipient_id, row.mailbox_id]);
    const reasons = (decision.rows[0]?.decision.reasons ?? []).filter((reason) => reason !== "already_replied" && reason !== "company_already_replied");
    if (reasons.length) throw new HttpError(409, "manual_reply_ineligible", "A resposta não pode ser enviada neste momento.", { reasons });
    const existing = await client.query<{ id: string; status: string }>(`select id,status::text status from public.outreach_jobs where idempotency_key=$1`, [`manual:${input.idempotencyKey}`]);
    if (existing.rows[0]) return { duplicate: true as const, jobId: existing.rows[0].id, status: existing.rows[0].status };
    await client.query(`insert into public.outreach_jobs(id,campaign_id,recipient_id,step_id,variant_id,mailbox_id,scheduled_at,status,attempt_count,max_attempts,lease_owner,lease_expires_at,idempotency_key) values($1,$2,$3,$4,null,$5,now(),'leased',0,1,$6,now()+($7::int||' seconds')::interval,$8)`, [row.id, row.campaign_id, row.recipient_id, row.step_id, row.mailbox_id, config.workerId, config.leaseSeconds, row.idempotency_key]);
    return { duplicate: false as const, job: row };
  }, "serializable");
  if (prepared.duplicate) return prepared;
  const job = prepared.job;
  const token = unsubscribeToken(job.recipient_id, job.id);
  await pool.query(`insert into private.outreach_unsubscribe_tokens(token_hash,recipient_id,expires_at) values($1,$2,now()+interval '2 years') on conflict(token_hash) do nothing`, [sha256(token), job.recipient_id]);
  const envelope: DeliveryEnvelope = {
    jobId: job.id,
    recipientId: job.recipient_id,
    campaignId: job.campaign_id,
    mailboxId: job.mailbox_id,
    fromEmail: job.mailbox_email,
    senderName: job.sender_name || job.mailbox_email.split("@")[0] || "Nikufra",
    to: job.email,
    subject: input.subject?.trim() || job.default_subject,
    text: input.body,
    unsubscribeUrl: `${config.publicUrl}/api/outreach/v1/unsubscribe/${encodeURIComponent(token)}`,
    providerThreadId: job.provider_thread_id,
    inReplyTo: job.in_reply_to,
    references: job.references ?? [],
    idempotencyKey: job.idempotency_key,
  };
  try {
    await beginDispatch(job, envelope);
  } catch (error) {
    await handleDispatchGuardFailure(job.id, error);
    throw error;
  }
  await pool.query(`update private.outreach_delivery_ledger set provider_response=provider_response||$2::jsonb where job_id=$1`, [job.id, JSON.stringify({ manualSubject: envelope.subject, manualBody: envelope.text, threadId: input.threadId })]);
  let receipt: ProviderReceipt;
  let providerCallStarted = false;
  try {
    receipt = await withCurrentProviderSession(job.id, job.mailbox_id, async (session, permitClient) => {
      providerCallStarted = true;
      const providerReceipt = await sendProviderMessage(session, envelope, { credentialsPrepared: true });
      await recordProviderAccepted(job.id, providerReceipt, permitClient);
      return providerReceipt;
    });
  } catch (error) {
    await disableMailboxAfterAuthorizationFailure(job.mailbox_id, error);
    if (providerCallStarted) await markAmbiguous(job.id, error);
    else await handleProviderPermitFailure(job.id, error);
    throw error;
  }
  await finalizeDispatch(job, envelope, receipt, false);
  return { duplicate: false, jobId: job.id, receipt };
}

export async function reconcileAmbiguousJobs(limit = 20) {
  // Reconciliation is read-only at the provider boundary and must keep
  // running under the kill switch. It can only confirm a message that already
  // exists in Sent; it never calls the provider send endpoint.
  const rows = await pool.query<{ id: string; mailbox_id: string; provider_response: { expectedInternetMessageId?: string; manualSubject?: string; manualBody?: string } }>(`
    with candidates as materialized (
      select job.id,job.mailbox_id,ledger.provider_response,ledger.last_attempt_at
      from private.outreach_delivery_ledger ledger
      join public.outreach_jobs job on job.id=ledger.job_id
      where ledger.status in ('sending','accepted','ambiguous')
      order by ledger.last_attempt_at,job.id
      limit $1
    ), normalized as (
      update public.outreach_jobs job
      set status='reconciliation_required',lease_owner=null,lease_expires_at=null,
          last_error=coalesce(job.last_error,'nonterminal_delivery_ledger'),updated_at=now()
      from candidates candidate
      where job.id=candidate.id
      returning job.id
    )
    select candidate.id,candidate.mailbox_id,candidate.provider_response
    from candidates candidate join normalized using(id)
    order by candidate.last_attempt_at,candidate.id`, [limit]);
  let confirmed = 0;
  for (const row of rows.rows) {
    const internetMessageId = row.provider_response.expectedInternetMessageId;
    if (!internetMessageId) continue;
    try {
      const session = await providerSession(row.mailbox_id);
      const receipt = await reconcileProviderMessage(session, internetMessageId);
      if (!receipt) {
        // Rotate no-match jobs behind newer reconciliation work instead of
        // allowing the first page to starve every later ambiguous delivery.
        await pool.query(`
          update private.outreach_delivery_ledger
          set last_attempt_at=now(),
              provider_response=jsonb_set(
                provider_response || jsonb_build_object(
                  'lastReconciliation','not_found',
                  'lastReconciliationAt',now()
                ),
                '{reconciliationNotFoundCount}',
                to_jsonb(
                  case
                    when provider_response->>'reconciliationNotFoundCount' ~ '^[0-9]+$'
                      then (provider_response->>'reconciliationNotFoundCount')::integer + 1
                    else 1
                  end
                ),
                true
              )
          where job_id=$1`, [row.id]);
        continue;
      }
      const job = await pool.query<JobRow>(`select j.id,j.campaign_id,j.recipient_id,j.step_id,j.variant_id,j.mailbox_id,j.idempotency_key,r.email_snapshot::text email,m.email::text mailbox_email,m.display_name sender_name,coalesce(v.subject_template,'') subject_template,coalesce(v.body_template,'') body_template,r.variable_snapshot,t.provider_thread_id,(select msg.internet_message_id from public.outreach_messages msg where msg.thread_id=t.id and msg.direction='outbound' order by msg.occurred_at desc limit 1) in_reply_to,(select array_agg(msg.internet_message_id order by msg.occurred_at) filter(where msg.internet_message_id is not null) from public.outreach_messages msg where msg.thread_id=t.id) references from public.outreach_jobs j join public.outreach_recipients r on r.id=j.recipient_id join public.outreach_mailboxes m on m.id=j.mailbox_id left join public.outreach_campaign_variants v on v.id=j.variant_id left join lateral(select * from public.outreach_threads th where th.recipient_id=r.id and th.mailbox_id=m.id order by th.last_message_at desc limit 1)t on true where j.id=$1 and j.status='reconciliation_required'`, [row.id]);
      const value = job.rows[0];
      if (!value) continue;
      const envelope = await createEnvelope(value);
      if (row.provider_response.manualSubject !== undefined) envelope.subject = row.provider_response.manualSubject;
      if (row.provider_response.manualBody !== undefined) envelope.text = row.provider_response.manualBody;
      if (await finalizeDispatch(value, envelope, receipt, !value.idempotency_key.startsWith("manual:"))) confirmed += 1;
    } catch (error) {
      console.error("outreach reconciliation failed", { jobId: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: rows.rowCount ?? 0, confirmed };
}
