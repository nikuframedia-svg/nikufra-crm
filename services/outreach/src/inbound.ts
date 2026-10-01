import { createHash } from "node:crypto";
import { config } from "./config.js";
import { encryptJson } from "./crypto.js";
import { packSecret, providerSession, unpackSecret } from "./repository.js";
import { pool, transaction } from "./db.js";
import { isProviderAuthorizationFailure, listInboundMessages } from "./providers.js";
import { classifyReply, isAutomaticReply, isOptOutRequest } from "./reply-intent.js";
import type { InboundProviderMessage } from "./types.js";
import { deliverySignal, normalizedWebhookDeliveryEvent, type DeliverySignal } from "./delivery-signals.js";
import { createSuppression, createSuppressionWithClient } from "./mutations.js";

function senderAddress(value: string) {
  const bracketed = value.match(/<([^<>\s]+@[^<>\s]+)>/);
  const plain = value.match(/\b([^<>\s]+@[^<>\s]+)\b/);
  return (bracketed?.[1] ?? plain?.[1] ?? "").toLowerCase();
}

function inboundKind(message: InboundProviderMessage, signal: DeliverySignal | null) {
  if (signal) return signal.kind;
  if (isAutomaticReply(message)) return "auto_reply" as const;
  if (isOptOutRequest(message.text)) return "unsubscribe" as const;
  return "reply" as const;
}

interface InboundRelation {
  thread_id: string | null;
  campaign_id: string;
  recipient_id: string;
  contact_id: string | null;
  company_id: string | null;
  email_snapshot: string | null;
}

interface InboundResolution {
  relation: InboundRelation | null;
  ambiguous: boolean;
  strategy: "exact_reference" | "sender_fallback" | null;
}

async function recordAmbiguousInbound(
  client: import("pg").PoolClient,
  mailboxId: string,
  providerMessageId: string,
  strategy: "exact_reference" | "sender_fallback",
  candidateCount: number,
) {
  const providerMessageHash = createHash("sha256").update(providerMessageId).digest("hex");
  await client.query(`
    insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details)
    select null,'inbound.match_ambiguous','mailbox',$1,$2::jsonb
    where not exists (
      select 1 from public.outreach_audit_log audit
      where audit.action='inbound.match_ambiguous' and audit.entity_type='mailbox' and audit.entity_id=$1
        and audit.details->>'providerMessageHash'=$3
    )`, [mailboxId, JSON.stringify({ strategy, candidateCount, providerMessageHash }), providerMessageHash]);
}

async function resolveInboundRelation(
  client: import("pg").PoolClient,
  mailboxId: string,
  identityEmail: string,
  message: InboundProviderMessage,
  referenceIds: string[],
): Promise<InboundResolution> {
  // Provider thread and RFC822 reply references are authoritative. They are
  // evaluated before the sender address so the same lead may safely appear in
  // more than one campaign without a reply being attached to the newest one.
  const exact = await client.query<InboundRelation>(`
    with candidates as (
      select r.campaign_id,r.id recipient_id,r.contact_id,r.company_id,r.email_snapshot::text,t.id thread_id,0 priority
      from public.outreach_threads t
      join public.outreach_recipients r on r.id=t.recipient_id
      where t.mailbox_id=$1 and $2<>'' and t.provider_thread_id=$2
      union all
      select r.campaign_id,r.id recipient_id,r.contact_id,r.company_id,r.email_snapshot::text,prior.thread_id,1 priority
      from public.outreach_messages prior
      join public.outreach_recipients r on r.id=prior.recipient_id
      where prior.mailbox_id=$1 and cardinality($3::text[])>0 and prior.internet_message_id=any($3::text[])
    ), deduplicated as (
      select distinct on(recipient_id,campaign_id)
             thread_id,campaign_id,recipient_id,contact_id,company_id,email_snapshot,priority
      from candidates order by recipient_id,campaign_id,priority
    )
    select thread_id,campaign_id,recipient_id,contact_id,company_id,email_snapshot
    from deduplicated order by priority,recipient_id limit 2`,
  [mailboxId, message.providerThreadId ?? "", referenceIds]);
  if (exact.rows.length === 1) return { relation: exact.rows[0]!, ambiguous: false, strategy: "exact_reference" };
  if (exact.rows.length > 1) {
    await recordAmbiguousInbound(client, mailboxId, message.providerMessageId, "exact_reference", exact.rows.length);
    return { relation: null, ambiguous: true, strategy: "exact_reference" };
  }

  if (!identityEmail) return { relation: null, ambiguous: false, strategy: null };
  const sender = await client.query<InboundRelation>(`
    select latest.id thread_id,r.campaign_id,r.id recipient_id,r.contact_id,r.company_id,r.email_snapshot::text
    from public.outreach_recipients r
    left join lateral (
      select thread.id from public.outreach_threads thread
      where thread.recipient_id=r.id and thread.mailbox_id=$1
      order by thread.last_message_at desc,thread.id limit 1
    ) latest on true
    where lower(r.email_snapshot::text)=$2
    order by r.updated_at desc,r.id limit 2`, [mailboxId, identityEmail]);
  if (sender.rows.length === 1) return { relation: sender.rows[0]!, ambiguous: false, strategy: "sender_fallback" };
  if (sender.rows.length > 1) {
    await recordAmbiguousInbound(client, mailboxId, message.providerMessageId, "sender_fallback", sender.rows.length);
    return { relation: null, ambiguous: true, strategy: "sender_fallback" };
  }
  return { relation: null, ambiguous: false, strategy: null };
}

async function cancelAmbiguousReplyJobs(
  client: import("pg").PoolClient,
  mailboxId: string,
  identityEmail: string,
) {
  await client.query(`
    update public.outreach_jobs job
    set status=case
          when job.status='reconciliation_required' or exists (
            select 1 from private.outreach_delivery_ledger ledger
            where ledger.job_id=job.id
              and ledger.status in ('sending','accepted','ambiguous')
          ) then 'reconciliation_required'::public.outreach_job_status
          else 'cancelled'::public.outreach_job_status
        end,
        lease_owner=null,lease_expires_at=null,
        last_error='ambiguous_inbound_reply',updated_at=now()
    from public.outreach_recipients recipient
    where job.recipient_id=recipient.id and job.mailbox_id=$1
      and lower(recipient.email_snapshot::text)=lower($2)
      and job.status in ('pending','leased','reconciliation_required')`,
  [mailboxId, identityEmail]);
}

async function storeInboundReconciliation(
  client: import("pg").PoolClient,
  mailboxId: string,
  identityEmail: string | null,
  message: InboundProviderMessage,
  kind: "reply" | "hard_bounce" | "soft_bounce" | "complaint" | "unsubscribe" | "unknown",
  error: "ambiguous_exact_reference" | "ambiguous_sender_fallback" | "unmatched_delivery_signal" | "unmatched_inbound",
) {
  const aad = `outreach-inbound:${mailboxId}:${message.providerMessageId}`;
  const encrypted = encryptJson(identityEmail
    ? { message, error }
    : {
        kind,
        error,
        receivedAt: message.receivedAt,
        payloadSha256: createHash("sha256").update(JSON.stringify(message)).digest("hex"),
        piiOmitted: true,
      }, aad);
  const inserted = await client.query<{ id: string }>(`
    insert into private.outreach_inbound_reconciliation(
      mailbox_id,provider_message_id,identity_hmac,payload_encrypted,nonce,auth_tag,key_version,
      kind,status,received_at,error
    ) values($1,$2,case when $3::text is null then null else private.outreach_identity_hmac($3) end,$4,$5,$6,$7,$8,'reconciliation_required',$9,$10)
    on conflict(mailbox_id,provider_message_id) do nothing returning id`, [
    mailboxId,
    message.providerMessageId,
    identityEmail,
    encrypted.ciphertext,
    encrypted.nonce,
    encrypted.authTag,
    encrypted.keyVersion,
    kind,
    message.receivedAt,
    error,
  ]);
  return Boolean(inserted.rows[0]);
}

export async function ingestMessage(mailboxId: string, message: InboundProviderMessage) {
  const from = senderAddress(message.from);
  return transaction(async (client) => {
    const mailbox = await client.query<{ email: string }>(`select email::text email from public.outreach_mailboxes where id=$1 for share`, [mailboxId]);
    if (!mailbox.rows[0]) return false;
    const signal = deliverySignal(message);
    const optedOut = !signal && isOptOutRequest(message.text);
    const signalRecipients = signal?.recipients ?? [];

    // Safety effects precede association. A DSN/ARF sender is usually a
    // provider daemon, while an unsubscribe may have no matching campaign at
    // all; both still need to stop outbound globally.
    if (optedOut && from) {
      await createSuppressionWithClient(client, null, { scope: "email", email: from, reason: "unsubscribe", note: "Inbound opt-out" }, "outreach_inbound");
    }
    const identityEmail = signalRecipients.length === 1 ? signalRecipients[0]! : signal ? "" : from;
    const referenceIds = [...new Set([
      ...(signal?.referencedMessageIds ?? []),
      ...(message.inReplyTo ? [message.inReplyTo] : []),
      ...message.references,
    ].map((value) => value.trim()).filter(Boolean))];
    const resolution = await resolveInboundRelation(client, mailboxId, identityEmail, message, referenceIds);
    let relation = resolution.relation;
    if (signal) {
      // An email in the Inbox is not itself a trusted delivery event: DSN/ARF
      // headers and sender addresses are attacker controlled. Only a relation
      // proven by the provider thread or an RFC822 reference to an outbound
      // message may mutate suppressions or trip the safety circuit.
      const recipientMatches = signalRecipients.length === 1
        && Boolean(relation?.email_snapshot)
        && signalRecipients[0]!.toLowerCase() === relation!.email_snapshot!.toLowerCase();
      const trustedSignal = relation !== null && resolution.strategy === "exact_reference" && recipientMatches;
      if (!trustedSignal) relation = null;
    }
    if (!relation) {
      const kind = inboundKind(message, signal);
      const isHumanReply = kind === "reply" && !isAutomaticReply(message);
      if (resolution.ambiguous && isHumanReply && identityEmail) {
        await cancelAmbiguousReplyJobs(client, mailboxId, identityEmail);
      }
      const error = resolution.ambiguous && resolution.strategy === "exact_reference"
        ? "ambiguous_exact_reference"
        : resolution.ambiguous && resolution.strategy === "sender_fallback"
          ? "ambiguous_sender_fallback"
          : signal || optedOut
            ? "unmatched_delivery_signal"
            : "unmatched_inbound";
      return storeInboundReconciliation(client, mailboxId, identityEmail || null, message, kind === "auto_reply" ? "unknown" : kind, error);
    }
    if (signal?.kind === "hard_bounce" || signal?.kind === "complaint") {
      const affectedEmail = relation.email_snapshot;
      if (!affectedEmail) return storeInboundReconciliation(client, mailboxId, identityEmail || null, message, signal.kind, "unmatched_delivery_signal");
      await createSuppressionWithClient(client, null, { scope: "email", email: affectedEmail, reason: signal.kind, note: "Provider delivery signal" }, "outreach_inbound");
    }
    await client.query(`select id from public.outreach_recipients where id=$1 for update`, [relation.recipient_id]);
    // This is the shared, mailbox-address based claim used by both the CRM
    // Gmail importer and Outreach. It must happen in this same transaction,
    // before any thread/message side effect. The message trigger recognizes a
    // claim made by this XID and applies the Outreach effects exactly once.
    await client.query<{ claimed: boolean }>(
      `select private.outreach_claim_provider_message($1,$2,'outreach_inbound') claimed`,
      [mailbox.rows[0].email, message.providerMessageId],
    );
    // A false claim means CRM Gmail already owns shared side effects, not that
    // Outreach should hide the conversation. We still upsert the local thread
    // and message; the DB trigger sees the prior claim and skips recipient,
    // job, metrics, suppression, pipeline and activity effects.
    const classification = classifyReply(message);
    let threadId = relation.thread_id;
    if (threadId) {
      await client.query(`update public.outreach_threads set provider_thread_id=coalesce(provider_thread_id,$2),classification=case when classification='unclassified' or $3='positive' then $3 else classification end,last_message_at=greatest(last_message_at,$4),unread=true,status='open' where id=$1`, [threadId, message.providerThreadId, classification, message.receivedAt]);
    } else {
      const inserted = await client.query<{ id: string }>(`insert into public.outreach_threads(campaign_id,recipient_id,contact_id,company_id,mailbox_id,provider_thread_id,subject,classification,last_message_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(mailbox_id,provider_thread_id) where provider_thread_id is not null do update set last_message_at=excluded.last_message_at returning id`, [relation.campaign_id, relation.recipient_id, relation.contact_id, relation.company_id, mailboxId, message.providerThreadId, message.subject, classification, message.receivedAt]);
      threadId = inserted.rows[0]!.id;
    }
    const kind = inboundKind(message, signal);
    const inserted = await client.query(`insert into public.outreach_messages(thread_id,campaign_id,recipient_id,contact_id,company_id,mailbox_id,direction,kind,provider_message_id,provider_thread_id,internet_message_id,subject,snippet,body_text,headers,occurred_at) values($1,$2,$3,$4,$5,$6,'inbound',$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15) on conflict(mailbox_id,provider_message_id) do nothing returning id`, [threadId, relation.campaign_id, relation.recipient_id, relation.contact_id, relation.company_id, mailboxId, kind, message.providerMessageId, message.providerThreadId, message.internetMessageId, message.subject, message.text.slice(0, 500), message.text, JSON.stringify({ ...message.headers, inReplyTo: message.inReplyTo, references: message.references, from: message.from, autoSubmitted: message.autoSubmitted }), message.receivedAt]);
    return Boolean(inserted.rows[0]);
  }, "serializable");
}

export async function syncMailbox(mailboxId: string) {
  if (!config.inboundEnabled) return { imported: 0, disabled: true };
  const mailbox = await pool.query<{ last_sync_at: Date | null }>(`select last_sync_at from public.outreach_mailboxes where id=$1 and status='active'`, [mailboxId]);
  if (!mailbox.rows[0]) return { imported: 0, skipped: true };
  // Capture the watermark before the provider call. Advancing to `now()` after
  // a long fetch can otherwise skip a message that arrived during the fetch.
  // A small overlap is intentional and safe because provider IDs are deduped.
  const syncStartedAt = new Date();
  const since = mailbox.rows[0].last_sync_at
    ? new Date(mailbox.rows[0].last_sync_at.getTime() - 5 * 60_000)
    : new Date(syncStartedAt.getTime() - 7 * 86_400_000);
  const session = await providerSession(mailboxId);
  const messages = await listInboundMessages(session, since);
  let imported = 0;
  for (const message of messages.toSorted((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
    if (await ingestMessage(mailboxId, message)) imported += 1;
  }
  await pool.query(`update public.outreach_mailboxes set last_sync_at=$2,last_error=null where id=$1`, [mailboxId, syncStartedAt]);
  return { imported, scanned: messages.length };
}

export async function syncAllMailboxes() {
  if (!config.inboundEnabled) return { mailboxes: 0, imported: 0 };
  const mailboxes = await pool.query<{ id: string }>(`select id from public.outreach_mailboxes where status='active' and provider='google' order by last_sync_at nulls first`);
  let imported = 0;
  for (const mailbox of mailboxes.rows) {
    try {
      imported += (await syncMailbox(mailbox.id)).imported;
    } catch (error) {
      const authorizationFailed = isProviderAuthorizationFailure(error);
      const message = authorizationFailed
        ? "oauth_reauthorization_required"
        : error instanceof Error ? error.message.slice(0, 2_000) : "provider_sync_failed";
      await pool.query(
        `update public.outreach_mailboxes
         set status=case when $2 then 'error'::public.outreach_mailbox_status else status end,
             send_enabled=case when $2 then false else send_enabled end,
             last_error=$3
         where id=$1`,
        [mailbox.id, authorizationFailed, message],
      );
      console.error("outreach inbound sync failed", { mailboxId: mailbox.id, error: message });
    }
  }
  return { mailboxes: mailboxes.rowCount ?? 0, imported };
}

function webhookIdentity(payload: Record<string, unknown>) {
  const direct = normalizedWebhookDeliveryEvent(payload)?.email;
  if (direct) return direct;
  const queue: unknown[] = [payload];
  const visited = new Set<object>();
  let inspected = 0;
  let candidate: string | undefined;
  while (queue.length && inspected < 100) {
    const value = queue.shift();
    inspected += 1;
    if (typeof value !== "object" || value === null || visited.has(value)) continue;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:email|recipient|to|address|final_?recipient)$/i.test(key) && typeof child === "string" && child.includes("@")) {
        candidate = child;
        break;
      }
      if ((Array.isArray(child) || (typeof child === "object" && child !== null)) && queue.length < 100) queue.push(child);
    }
    if (candidate) break;
  }
  return candidate ? senderAddress(candidate) : "";
}

export function webhookStoragePayload(provider: string, providerEventId: string, raw: string) {
  if (provider === "google") {
    return {
      value: { eventId: providerEventId, payloadSha256: createHash("sha256").update(raw).digest("hex") },
      identityEmail: null,
    };
  }
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    // Signature-valid but malformed events are retained encrypted for a
    // bounded reconciliation window; the clear payload never reaches logs.
  }
  const identityEmail = webhookIdentity(parsed) || null;
  // If no identity can be extracted, retaining an opaque provider body would
  // make contact erasure impossible. Keep only non-PII reconciliation
  // metadata; mapped events remain encrypted and addressable by HMAC.
  return identityEmail
    ? { value: { raw }, identityEmail }
    : {
        value: { eventId: providerEventId, payloadSha256: createHash("sha256").update(raw).digest("hex"), unmapped: true },
        identityEmail: null,
      };
}

export async function storeWebhook(provider: string, providerEventId: string, raw: string, signatureValid: boolean) {
  const storage = webhookStoragePayload(provider, providerEventId, raw);
  const body = packSecret(storage.value, `webhook:${provider}:${providerEventId}`);
  const result = await pool.query(`insert into private.outreach_webhook_events(provider,provider_event_id,identity_hmac,body_encrypted,signature_valid) values($1,$2,case when $3::text is null then null else private.outreach_identity_hmac($3) end,$4,$5) on conflict(provider,provider_event_id) do nothing returning id`, [provider, providerEventId, storage.identityEmail, body, signatureValid]);
  return { accepted: Boolean(result.rows[0]), replay: !result.rows[0] };
}

export async function processWebhookEvents() {
  const events = await pool.query<{ id: string; provider: string; provider_event_id: string; body_encrypted: Buffer }>(`select id,provider,provider_event_id,body_encrypted from private.outreach_webhook_events where processed_at is null and signature_valid order by received_at limit 100`);
  if (!events.rowCount) return { processed: 0 };
  let googleWakeup = false;
  const googleEventIds: string[] = [];
  let processed = 0;
  for (const event of events.rows) {
    let processingError: string | null = null;
    let retryableFailure = false;
    try {
      if (event.provider === "google") {
        googleWakeup = true;
        googleEventIds.push(event.id);
      } else {
        const packed = unpackSecret<{ raw?: string }>(event.body_encrypted, `webhook:${event.provider}:${event.provider_event_id}`);
        const parsed = packed.raw ? JSON.parse(packed.raw) as unknown : null;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          processingError = "invalid_webhook_payload";
        } else {
          const signal = normalizedWebhookDeliveryEvent(parsed as Record<string, unknown>);
          if (!signal?.email) {
            processingError = "unsupported_webhook_event";
          } else {
            const matched = signal.providerMessageId
              ? await pool.query<{ id: string; mailbox_id: string; campaign_id: string | null; job_id: string | null }>(`
                  select message.id,message.mailbox_id,message.campaign_id,
                         (select job.id from public.outreach_jobs job
                          where job.mailbox_id=message.mailbox_id
                            and job.provider_message_id=message.provider_message_id
                          order by job.sent_at desc nulls last,job.id limit 1) job_id
                  from public.outreach_messages message
                  join public.outreach_recipients recipient on recipient.id=message.recipient_id
                  where message.direction='outbound' and message.provider_message_id=$1
                    and lower(recipient.email_snapshot::text)=lower($2)
                  limit 1`, [signal.providerMessageId, signal.email])
              : { rows: [] };
            if (!matched.rows[0]) {
              processingError = "unmatched_delivery_signal";
            } else {
              await createSuppression(null, {
                scope: "email",
                email: signal.email,
                reason: signal.kind,
                note: "Provider webhook delivery signal",
              }, "outreach_webhook");
              await pool.query(
                `select private.outreach_record_delivery_incident($1,$2,$3,$4,'provider_webhook',$5) paused`,
                [signal.kind, matched.rows[0].mailbox_id, matched.rows[0].campaign_id, matched.rows[0].job_id, event.id],
              );
            }
          }
        }
      }
    } catch {
      processingError = "webhook_processing_failed";
      retryableFailure = true;
    }
    if (event.provider !== "google") {
      await pool.query(
        `update private.outreach_webhook_events
         set processed_at=case when $3 then processed_at else now() end,processing_error=$2
         where id=$1`,
        [event.id, processingError, retryableFailure],
      );
      if (!retryableFailure) processed += 1;
    }
  }
  // Gmail push contains no durable message payload and is only a wake-up
  // signal. Provider message IDs remain the shared CRM/Outreach dedupe gate.
  if (googleWakeup) {
    await syncAllMailboxes();
    await pool.query(
      `update private.outreach_webhook_events set processed_at=now(),processing_error=null where id=any($1::uuid[])`,
      [googleEventIds],
    );
    processed += googleEventIds.length;
  }
  await purgeWebhookEvents();
  return { processed };
}

export async function purgeWebhookEvents() {
  const result = await pool.query(`
    delete from private.outreach_webhook_events
    where (processed_at is not null and processed_at<now()-interval '30 days')
       or received_at<now()-interval '90 days'`);
  return result.rowCount ?? 0;
}

export async function purgeInboundReconciliation() {
  const result = await pool.query(`
    delete from private.outreach_inbound_reconciliation
    where (status='resolved' and resolved_at<now()-interval '30 days')
       or (status='ignored' and created_at<now()-interval '30 days')
       or (identity_hmac is null and created_at<now()-interval '7 days')
       or created_at<now()-interval '90 days'`);
  return result.rowCount ?? 0;
}
