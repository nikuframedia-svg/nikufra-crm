import type { Pool, PoolClient } from "pg";
import { config } from "./config.js";
import { decryptJson, encryptJson, hashSuppressionIdentity, needsReEncryption, randomToken, sha256 } from "./crypto.js";
import { pool, transaction } from "./db.js";
import { HttpError } from "./errors.js";
import type { Actor, MailboxRecord, OAuthCredential, Provider, ProviderCredential } from "./types.js";
import type { ProviderSession } from "./providers.js";

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

function providerFromDb(value: string): Provider {
  return value === "smtp_imap" ? "smtp" : value as Provider;
}

function providerToDb(value: Provider) {
  return value === "smtp" ? "smtp_imap" : value;
}

function mapMailbox(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    provider: providerFromDb(String(row.provider)),
    email: String(row.email),
    displayName: String(row.display_name ?? ""),
    ownerProfileId: row.owner_profile_id ? String(row.owner_profile_id) : null,
    status: String(row.status),
    sendEnabled: Boolean(row.send_enabled),
    dailyLimit: Math.min(Number(row.daily_limit), Number(row.ramp_daily_limit ?? row.daily_limit)),
    configuredDailyLimit: Number(row.daily_limit),
    rampDailyLimit: Number(row.ramp_daily_limit ?? 1),
    timezone: String(row.timezone),
    lastSyncAt: row.last_sync_at ? new Date(String(row.last_sync_at)).toISOString() : null,
    lastError: row.last_error ? String(row.last_error) : null,
    sentToday: Number(row.sent_today ?? 0),
    repliesToday: Number(row.replies_today ?? 0),
    bounceRate: Number(row.bounce_rate ?? 0),
    healthScore: Number(row.health_score ?? 0),
    dns: row.dns ?? null,
  };
}

export async function audit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown = {},
  client: Pool | PoolClient = pool,
) {
  await client.query(
    `insert into public.outreach_audit_log(actor_id, action, entity_type, entity_id, details)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [actorId, action, entityType, entityId, JSON.stringify(details)],
  );
}

export async function overview(actor: Actor) {
  const result = await pool.query<{
    campaigns_total: string;
    campaigns_running: string;
    sent_today: string;
    replies_total: string;
    positive_replies: string;
    queued_jobs: string;
    ready_mailboxes: string;
    daily_capacity: string;
    mode: "disabled" | "canary" | "live";
    send_enabled: boolean;
  }>(`
    select
      (select count(*) from public.outreach_campaigns where status <> 'archived')::text campaigns_total,
      (select count(*) from public.outreach_campaigns where status = 'running')::text campaigns_running,
      (select count(*) from public.outreach_messages where direction = 'outbound' and occurred_at >= current_date)::text sent_today,
      (select count(*) from public.outreach_messages where direction = 'inbound' and kind = 'reply')::text replies_total,
      (select count(*) from public.outreach_threads where classification = 'positive')::text positive_replies,
      (select count(*) from public.outreach_jobs where status in ('pending','leased','reconciliation_required'))::text queued_jobs,
      (select count(*) from public.outreach_mailboxes where status = 'active')::text ready_mailboxes,
      (select coalesce(sum(least(daily_limit,ramp_daily_limit)),0) from public.outreach_mailboxes where status = 'active' and send_enabled)::text daily_capacity,
      state.mode::text mode,
      state.send_enabled
    from public.outreach_system_state state where state.id = true
  `);
  const row = result.rows[0];
  if (!row) throw new HttpError(503, "outreach_not_initialized", "O schema Outreach ainda não foi inicializado.");
  const canViewOperationalDetail = actor.crmRole === "admin" || actor.outreachRole === "campaign_manager";
  const nextJobs = canViewOperationalDetail
    ? await pool.query(`
        select j.id,c.nome as "campaignName",coalesce(contact.nome,r.email_snapshot::text,'Contacto') as "contactName",j.scheduled_at as "dueAt"
        from public.outreach_jobs j
        join public.outreach_campaigns c on c.id=j.campaign_id
        join public.outreach_recipients r on r.id=j.recipient_id
        left join public.contactos contact on contact.id=r.contact_id
        where j.status='pending' order by j.scheduled_at limit 5`)
    : { rows: [] };
  return {
    campaignsTotal: Number(row.campaigns_total),
    campaignsRunning: Number(row.campaigns_running),
    sentToday: Number(row.sent_today),
    repliesTotal: Number(row.replies_total),
    positiveReplies: Number(row.positive_replies),
    queuedJobs: Number(row.queued_jobs),
    readyMailboxes: Number(row.ready_mailboxes),
    dailyCapacity: Number(row.daily_capacity),
    sendMode: row.mode,
    outboundEnabled: config.outboundEnvEnabled && !config.shadowMode && row.send_enabled && row.mode !== "disabled",
    nextJobs: nextJobs.rows,
  };
}

export async function metrics(days = 30) {
  const safeDays = Math.max(1, Math.min(365, days));
  const [daily, totals] = await Promise.all([
    pool.query(`
      select metric_date::text as date,
             sum(sent)::int as sent,
             sum(replies)::int as replies,
             sum(positive_replies)::int as "positiveReplies",
             sum(hard_bounces)::int as "hardBounces",
             sum(complaints)::int as complaints,
             sum(unsubscribes)::int as unsubscribes
      from public.outreach_metric_daily
      where metric_date >= current_date - ($1::int - 1)
      group by metric_date order by metric_date`, [safeDays]),
    pool.query(`
      select coalesce(sum(sent),0)::int sent, coalesce(sum(replies),0)::int replies,
             coalesce(sum(positive_replies),0)::int "positiveReplies",
             coalesce(sum(hard_bounces),0)::int "hardBounces",
             coalesce(sum(complaints),0)::int complaints,
             coalesce(sum(unsubscribes),0)::int unsubscribes
      from public.outreach_metric_daily where metric_date >= current_date - ($1::int - 1)`, [safeDays]),
  ]);
  return { days: safeDays, daily: daily.rows, totals: totals.rows[0] ?? {} };
}

export async function listCampaigns(pagination: Pagination, search = "") {
  const query = `%${search.trim()}%`;
  const [items, count] = await Promise.all([
    pool.query(`
      select c.id, c.nome as name, c.descricao as description, c.status, c.daily_limit as "dailyLimit",c.launched_at as "launchedAt",
             count(distinct r.id)::int as "recipientCount",
             count(distinct r.id) filter (where r.status in ('active','replied','completed'))::int as "startedCount",
             count(distinct m.id) filter (where m.direction='outbound')::int as "sentCount",
             count(distinct m.id) filter (where m.direction='inbound' and m.kind='reply')::int as "replyCount",
             count(distinct m.id) filter (where m.kind='hard_bounce')::int as "bounceCount",
             count(distinct t.id) filter (where t.classification='positive')::int as "positiveCount",
             case when count(distinct r.id)=0 then 0 else round(100.0 * count(distinct r.id) filter (where r.status in ('replied','completed')) / count(distinct r.id))::int end as progress,
             c.created_at as "createdAt", c.updated_at as "updatedAt"
      from public.outreach_campaigns c
      left join public.outreach_recipients r on r.campaign_id=c.id
      left join public.outreach_messages m on m.campaign_id=c.id
      left join public.outreach_threads t on t.campaign_id=c.id
      where ($1 = '%%' or c.nome ilike $1) and c.status <> 'archived'
      group by c.id order by c.updated_at desc limit $2 offset $3`, [query, pagination.pageSize, pagination.offset]),
    pool.query<{ count: string }>(`select count(*)::text count from public.outreach_campaigns where ($1='%%' or nome ilike $1) and status <> 'archived'`, [query]),
  ]);
  return { items: items.rows, page: { page: pagination.page, pageSize: pagination.pageSize, total: Number(count.rows[0]?.count ?? 0) } };
}

export interface CampaignReadiness {
  ready: boolean;
  activeStepVariantCount: number;
  eligibleRecipientCount: number;
  selectedMailboxCount: number;
  readyMailboxCount: number;
  blockers: string[];
}

export async function campaignReadiness(
  campaignId: string,
  client: Pool | PoolClient = pool,
): Promise<CampaignReadiness> {
  const result = await client.query<{
    activeStepVariantCount: number;
    eligibleRecipientCount: number;
    selectedMailboxCount: number;
    readyMailboxCount: number;
  }>(`
    select
      (select count(*)::int
       from public.outreach_campaign_steps step
       where step.campaign_id=$1 and step.ativo and step.kind='email'
         and exists (
           select 1 from public.outreach_campaign_variants variant
           where variant.step_id=step.id and variant.ativo
         )) as "activeStepVariantCount",
      (select count(*)::int
       from public.outreach_recipients recipient
       where recipient.campaign_id=$1 and recipient.status='eligible') as "eligibleRecipientCount",
      (select count(*)::int
       from public.outreach_campaign_mailboxes selection
       where selection.campaign_id=$1) as "selectedMailboxCount",
      (select count(*)::int
       from public.outreach_campaign_mailboxes selection
       join public.outreach_mailboxes mailbox on mailbox.id=selection.mailbox_id
       where selection.campaign_id=$1
         and mailbox.provider='google'
         and mailbox.status='active'
         and mailbox.send_enabled
         and coalesce((
           select dns.spf_status='pass'
             and dns.dkim_status='pass'
             and dns.dmarc_status='pass'
             and dns.mx_status='pass'
             and dns.checked_at > now()-interval '24 hours'
           from public.outreach_dns_checks dns
           where dns.mailbox_id=mailbox.id
           order by dns.checked_at desc,dns.id desc
           limit 1
         ),false)) as "readyMailboxCount"`, [campaignId]);
  const row = result.rows[0];
  const activeStepVariantCount = Number(row?.activeStepVariantCount ?? 0);
  const eligibleRecipientCount = Number(row?.eligibleRecipientCount ?? 0);
  const selectedMailboxCount = Number(row?.selectedMailboxCount ?? 0);
  const readyMailboxCount = Number(row?.readyMailboxCount ?? 0);
  const blockers = [
    ...(!activeStepVariantCount ? ["Adiciona pelo menos um passo de email ativo com uma variante ativa."] : []),
    ...(!eligibleRecipientCount ? ["Adiciona pelo menos um destinatário elegível."] : []),
    ...(!selectedMailboxCount ? ["Seleciona pelo menos uma mailbox para a campanha."] : []),
    ...(selectedMailboxCount && !readyMailboxCount ? ["Pelo menos uma mailbox selecionada tem de ser Google, estar ativa para envio e ter SPF, DKIM, DMARC e MX aprovados nas últimas 24 horas."] : []),
  ];
  return {
    ready: blockers.length === 0,
    activeStepVariantCount,
    eligibleRecipientCount,
    selectedMailboxCount,
    readyMailboxCount,
    blockers,
  };
}

export async function getCampaign(id: string) {
  const campaign = await pool.query(`select c.id, c.nome as name, c.descricao as description, c.status, c.stop_company_on_reply as "stopCompanyOnReply", c.timezone, c.send_days as "sendDays", c.send_window_start::text as "sendWindowStart", c.send_window_end::text as "sendWindowEnd", c.starts_at as "startsAt", c.ends_at as "endsAt", c.daily_limit as "dailyLimit", c.gap_minutes as "gapMinutes", c.jitter_minutes as "jitterMinutes", c.launched_at as "launchedAt", c.paused_at as "pausedAt", c.created_at as "createdAt", c.updated_at as "updatedAt",
    coalesce((select array_agg(selection.mailbox_id order by selection.mailbox_id) from public.outreach_campaign_mailboxes selection where selection.campaign_id=c.id),'{}'::uuid[]) as "mailboxIds",
    coalesce((select array_agg(distinct member.audience_id) from public.outreach_recipients recipient join public.outreach_audience_members member on member.id=recipient.audience_member_id where recipient.campaign_id=c.id),'{}'::uuid[]) as "audienceIds",
    (select count(*)::int from public.outreach_recipients recipient where recipient.campaign_id=c.id) as "recipientCount",
    (select count(*)::int from public.outreach_messages message where message.campaign_id=c.id and message.direction='outbound') as "sentCount",
    (select count(*)::int from public.outreach_messages message where message.campaign_id=c.id and message.direction='inbound' and message.kind='reply') as "replyCount",
    (select count(*)::int from public.outreach_messages message where message.campaign_id=c.id and message.kind='hard_bounce') as "bounceCount",
    (select count(*)::int from public.outreach_threads thread where thread.campaign_id=c.id and thread.classification='positive') as "positiveCount"
    from public.outreach_campaigns c where c.id=$1`, [id]);
  if (!campaign.rows[0]) throw new HttpError(404, "campaign_not_found", "Campanha não encontrada.");
  const [steps, recipients, readiness, availableMailboxes] = await Promise.all([
    pool.query(`select s.id, s.position, s.kind, s.delay_minutes as "delayMinutes", s.reply_to_previous as "replyToPrevious", s.ativo as active,
      coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.nome,'weight',v.weight,'subject',v.subject_template,'body',v.body_template,'active',v.ativo) order by v.nome) filter (where v.id is not null),'[]') variants
      from public.outreach_campaign_steps s left join public.outreach_campaign_variants v on v.step_id=s.id where s.campaign_id=$1 group by s.id order by s.position`, [id]),
    pool.query(`select status, count(*)::int count from public.outreach_recipients where campaign_id=$1 group by status order by status`, [id]),
    campaignReadiness(id),
    pool.query(`
      select mailbox.id,mailbox.email::text email,mailbox.display_name as "displayName",
        case when mailbox.provider='smtp_imap' then 'smtp' else mailbox.provider::text end provider,
        mailbox.status::text status,mailbox.send_enabled as "sendEnabled",
        dns.checked_at as "dnsCheckedAt",
        coalesce(
          dns.spf_status='pass' and dns.dkim_status='pass'
          and dns.dmarc_status='pass' and dns.mx_status='pass'
          and dns.checked_at > now()-interval '24 hours',
          false
        ) as "dnsReady",
        (mailbox.provider='google' and mailbox.status='active' and mailbox.send_enabled
          and coalesce(
            dns.spf_status='pass' and dns.dkim_status='pass'
            and dns.dmarc_status='pass' and dns.mx_status='pass'
            and dns.checked_at > now()-interval '24 hours',
            false
          )) as ready,
        (selection.mailbox_id is not null) as selected
      from public.outreach_mailboxes mailbox
      left join public.outreach_campaign_mailboxes selection
        on selection.campaign_id=$1 and selection.mailbox_id=mailbox.id
      left join lateral (
        select latest.* from public.outreach_dns_checks latest
        where latest.mailbox_id=mailbox.id
        order by latest.checked_at desc,latest.id desc limit 1
      ) dns on true
      order by mailbox.email`, [id]),
  ]);
  return {
    ...campaign.rows[0],
    steps: steps.rows,
    recipientCounts: recipients.rows,
    readiness,
    availableMailboxes: availableMailboxes.rows,
    blockers: readiness.blockers,
    warnings: [],
  };
}

export async function listAudiences(pagination: Pagination, search = "") {
  const query = `%${search.trim()}%`;
  const [items, count] = await Promise.all([
    pool.query(`select a.id, a.nome as name, a.descricao as description, a.filter_definition as "filterDefinition", a.created_at as "createdAt", a.updated_at as "updatedAt", count(m.id)::int as "memberCount", count(m.id) filter (where m.eligibility_status='eligible')::int as "eligibleCount" from public.outreach_audiences a left join public.outreach_audience_members m on m.audience_id=a.id where ($1='%%' or a.nome ilike $1) group by a.id order by a.updated_at desc limit $2 offset $3`, [query, pagination.pageSize, pagination.offset]),
    pool.query<{ count: string }>(`select count(*)::text count from public.outreach_audiences where ($1='%%' or nome ilike $1)`, [query]),
  ]);
  return { items: items.rows, page: { page: pagination.page, pageSize: pagination.pageSize, total: Number(count.rows[0]?.count ?? 0) } };
}

export async function listMailboxes() {
  const result = await pool.query(`
    select m.*,
      coalesce(today.sent,0)::int sent_today,
      coalesce(today.replies,0)::int replies_today,
      case when coalesce(period.sent,0)=0 then 0 else round(100.0*coalesce(period.hard_bounces,0)/period.sent,2) end bounce_rate,
      greatest(0,least(100,
        (case when m.status='active' then 40 else 0 end)
        +(case when dns.spf_status='pass' then 15 else 0 end)
        +(case when dns.dkim_status='pass' then 15 else 0 end)
        +(case when dns.dmarc_status='pass' then 15 else 0 end)
        +(case when dns.mx_status='pass' then 15 else 0 end)
        -(case when coalesce(period.sent,0)=0 then 0 else least(40,round(400.0*coalesce(period.hard_bounces,0)/period.sent)::int) end)
      ))::int health_score,
      case when dns.mailbox_id is null then null else jsonb_build_object('spf',dns.spf_status,'dkim',dns.dkim_status,'dmarc',dns.dmarc_status,'mx',dns.mx_status,'checkedAt',dns.checked_at) end dns
    from public.outreach_mailboxes m
    left join lateral (
      select count(*) filter(where direction='outbound') sent,
             count(*) filter(where direction='inbound' and kind='reply') replies
      from public.outreach_messages message where message.mailbox_id=m.id and message.occurred_at>=current_date
    ) today on true
    left join lateral (
      select coalesce(sum(sent),0) sent,coalesce(sum(hard_bounces),0) hard_bounces
      from public.outreach_metric_daily metric where metric.mailbox_id=m.id and metric.metric_date>=current_date-29
    ) period on true
    left join lateral (
      select * from public.outreach_dns_checks latest where latest.mailbox_id=m.id order by latest.checked_at desc limit 1
    ) dns on true
    order by m.email`);
  return result.rows.map(mapMailbox);
}

export async function listThreads(actor: Actor, pagination: Pagination, status = "open") {
  const restrictAssigned = actor.crmRole !== "admin" && actor.outreachRole === "sales_rep";
  const [items, count] = await Promise.all([
    pool.query(`
      select t.id,t.campaign_id as "campaignId",campaign.nome as "campaignName",t.contact_id as "contactId",t.subject,t.status,t.classification,t.unread,t.starred,t.assigned_to as "assignedTo",t.last_message_at as "lastMessageAt",
             c.nome as "contactName",c.email as "contactEmail",e.nome as "companyName",m.email as "mailboxEmail",
             (select msg.snippet from public.outreach_messages msg where msg.thread_id=t.id order by msg.occurred_at desc limit 1) preview
      from public.outreach_threads t
      left join public.outreach_campaigns campaign on campaign.id=t.campaign_id left join public.contactos c on c.id=t.contact_id left join public.empresas e on e.id=t.company_id left join public.outreach_mailboxes m on m.id=t.mailbox_id
      where ($1='' or t.status::text=$1) and (not $2::boolean or t.assigned_to=$3)
      order by t.last_message_at desc limit $4 offset $5`, [status, restrictAssigned, actor.id, pagination.pageSize, pagination.offset]),
    pool.query<{ count: string }>(`select count(*)::text count from public.outreach_threads t where ($1='' or t.status::text=$1) and (not $2::boolean or t.assigned_to=$3)`, [status, restrictAssigned, actor.id]),
  ]);
  return { items: items.rows, page: { page: pagination.page, pageSize: pagination.pageSize, total: Number(count.rows[0]?.count ?? 0) } };
}

export async function getThread(actor: Actor, id: string) {
  const restrictAssigned = actor.crmRole !== "admin" && actor.outreachRole === "sales_rep";
  const thread = await pool.query(`select t.*,campaign.nome campaign_name,c.nome contact_name,c.email contact_email,e.nome company_name,m.email mailbox_email from public.outreach_threads t left join public.outreach_campaigns campaign on campaign.id=t.campaign_id left join public.contactos c on c.id=t.contact_id left join public.empresas e on e.id=t.company_id join public.outreach_mailboxes m on m.id=t.mailbox_id where t.id=$1 and (not $2::boolean or t.assigned_to=$3)`, [id, restrictAssigned, actor.id]);
  if (!thread.rows[0]) throw new HttpError(404, "thread_not_found", "Conversa não encontrada ou não atribuída a ti.");
  const messages = await pool.query(`select id,direction,kind,subject,snippet,body_text as body,occurred_at as "occurredAt" from public.outreach_messages where thread_id=$1 order by occurred_at`, [id]);
  return { ...thread.rows[0], messages: messages.rows };
}

export async function listSuppressions(pagination: Pagination) {
  const [items, count] = await Promise.all([
    pool.query(`select id,scope,email,domain,company_id as "companyId",reason,source,note,active,created_at as "createdAt",deactivated_at as "deactivatedAt" from public.communication_suppressions where active order by created_at desc limit $1 offset $2`, [pagination.pageSize, pagination.offset]),
    pool.query<{ count: string }>(`select count(*)::text count from public.communication_suppressions where active`),
  ]);
  return { items: items.rows, page: { page: pagination.page, pageSize: pagination.pageSize, total: Number(count.rows[0]?.count ?? 0) } };
}

export async function listAudit(pagination: Pagination) {
  const [items, count] = await Promise.all([
    pool.query(`select a.id,a.action,a.entity_type as "entityType",a.entity_id as "entityId",a.details,a.created_at as "createdAt",p.nome as "actorName",p.email as "actorEmail" from public.outreach_audit_log a left join public.profiles p on p.id=a.actor_id order by a.created_at desc limit $1 offset $2`, [pagination.pageSize, pagination.offset]),
    pool.query<{ count: string }>(`select count(*)::text count from public.outreach_audit_log`),
  ]);
  return { items: items.rows, page: { page: pagination.page, pageSize: pagination.pageSize, total: Number(count.rows[0]?.count ?? 0) } };
}

export async function listInboundReconciliation(pagination: Pagination, status = "reconciliation_required") {
  const safeStatus = status === "resolved" || status === "ignored" ? status : "reconciliation_required";
  const [items, count] = await Promise.all([
    pool.query(`
      select reconciliation.id,reconciliation.mailbox_id as "mailboxId",mailbox.email::text as "mailboxEmail",
             reconciliation.kind,reconciliation.status,reconciliation.received_at as "receivedAt",
             reconciliation.resolved_at as "resolvedAt",reconciliation.error
      from private.outreach_inbound_reconciliation reconciliation
      join public.outreach_mailboxes mailbox on mailbox.id=reconciliation.mailbox_id
      where reconciliation.status=$1
      order by reconciliation.received_at desc
      limit $2 offset $3`, [safeStatus, pagination.pageSize, pagination.offset]),
    pool.query<{ count: string }>(`select count(*)::text count from private.outreach_inbound_reconciliation where status=$1`, [safeStatus]),
  ]);
  return { items: items.rows, page: { page: pagination.page, pageSize: pagination.pageSize, total: Number(count.rows[0]?.count ?? 0) } };
}

export async function listJobReconciliation(pagination: Pagination) {
  const [items, count] = await Promise.all([
    pool.query(`
      select job.id,job.legacy_id as "legacyId",job.campaign_id as "campaignId",
             campaign.nome as "campaignName",job.mailbox_id as "mailboxId",
             mailbox.email::text as "mailboxEmail",job.last_error as "lastError",
             job.provider_message_id as "providerMessageId",job.updated_at as "updatedAt",
             ledger.status as "ledgerStatus",
             coalesce(
               case when ledger.provider_response->>'reconciliationNotFoundCount' ~ '^[0-9]+$'
                    then (ledger.provider_response->>'reconciliationNotFoundCount')::integer end,
               0
             ) as "notFoundCount",
             ledger.provider_response->>'lastReconciliationAt' as "lastReconciliationAt",
             ledger.provider_response->>'expectedInternetMessageId' as "expectedInternetMessageId",
             case when ledger.id is null then 'legacy_without_ledger' else 'provider_ambiguous' end as source,
             (
               (ledger.id is null and job.legacy_id is not null)
               or (
                 ledger.status in ('sending','accepted','ambiguous')
                 and ledger.provider_response->>'lastReconciliation'='not_found'
                 and coalesce(
                   case when ledger.provider_response->>'reconciliationNotFoundCount' ~ '^[0-9]+$'
                        then (ledger.provider_response->>'reconciliationNotFoundCount')::integer end,
                   0
                 ) >= 2
               )
             ) as "eligibleForCancellation"
      from public.outreach_jobs job
      join public.outreach_campaigns campaign on campaign.id=job.campaign_id
      left join public.outreach_mailboxes mailbox on mailbox.id=job.mailbox_id
      left join private.outreach_delivery_ledger ledger on ledger.job_id=job.id
      where job.status='reconciliation_required'
      order by job.updated_at,job.id
      limit $1 offset $2`, [pagination.pageSize, pagination.offset]),
    pool.query<{ count: string }>(`
      select count(*)::text count from public.outreach_jobs
      where status='reconciliation_required'`),
  ]);
  return {
    items: items.rows,
    page: { page: pagination.page, pageSize: pagination.pageSize, total: Number(count.rows[0]?.count ?? 0) },
  };
}

export async function settings(actor?: Actor) {
  const [state, providers, members, canaryAllowlist] = await Promise.all([
    pool.query(`select mode,send_enabled as "sendEnabled",approved_at as "approvedAt",kill_reason as "killReason",settings,updated_at as "updatedAt" from public.outreach_system_state where id=true`),
    Promise.resolve({ google: config.google.enabled, microsoft: config.microsoft.enabled, smtp: config.smtpEnabled }),
    actor?.crmRole === "admin"
      ? pool.query(`select id,nome as name,email,role::text as "crmRole",coalesce(outreach_role::text,'viewer') as "outreachRole",
                           case when role::text='admin' then 'admin' else coalesce(outreach_role::text,'viewer') end as role,
                           ativo as active
                    from public.profiles order by ativo desc,nome,email`).then((result) => result.rows)
      : Promise.resolve([]),
    actor?.crmRole === "admin"
      ? pool.query<{ email: string }>(`select email::text email from private.outreach_canary_allowlist order by email`).then((result) => result.rows.map((row) => row.email))
      : Promise.resolve([]),
  ]);
  const stateRow = state.rows[0] as ({
    mode: "disabled" | "canary" | "live";
    sendEnabled: boolean;
    approvedAt: Date | null;
    killReason: string | null;
    settings: Record<string, unknown> | null;
    updatedAt: Date;
  } | undefined);
  const operational = stateRow?.settings && typeof stateRow.settings === "object" ? stateRow.settings : {};
  const role = actor?.crmRole === "admin" ? "admin" : actor?.outreachRole ?? "viewer";
  const capabilities = actor ? [...actor.capabilities] : [];
  const mode = stateRow?.mode ?? "disabled";
  const sendEnabled = stateRow?.sendEnabled ?? false;
  return {
    ...operational,
    mode,
    sendMode: mode,
    sendEnabled,
    approvedAt: stateRow?.approvedAt ?? null,
    killReason: stateRow?.killReason ?? null,
    updatedAt: stateRow?.updatedAt ?? null,
    outboundEnvEnabled: config.outboundEnvEnabled,
    outboundEnabled: config.outboundEnvEnabled && !config.shadowMode && sendEnabled && mode !== "disabled",
    shadowMode: config.shadowMode,
    inboundEnabled: config.inboundEnabled,
    adminOnly: config.adminOnly,
    providers,
    canaryAllowlist,
    trackingOpens: false,
    trackingClicks: false,
    role,
    capabilities,
    members,
    actor: actor ? { id: actor.id, role: actor.crmRole, outreachRole: actor.outreachRole, capabilities } : null,
  };
}

export async function getMailbox(id: string, client: Pool | PoolClient = pool): Promise<MailboxRecord & { providerDb: string }> {
  const result = await client.query(`select m.*, (select count(*) from public.outreach_messages msg where msg.mailbox_id=m.id and msg.direction='outbound' and msg.occurred_at>=current_date)::int sent_today from public.outreach_mailboxes m where m.id=$1`, [id]);
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "mailbox_not_found", "Mailbox não encontrada.");
  return { id: row.id, email: row.email, senderName: row.display_name, provider: providerFromDb(row.provider), providerDb: row.provider, status: row.status, sendEnabled: row.send_enabled, dailyLimit: Math.min(Number(row.daily_limit), Number(row.ramp_daily_limit ?? row.daily_limit)), sentToday: Number(row.sent_today), lastInboundSyncAt: row.last_sync_at };
}

interface StoredCredentialVersion {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

// Only a completed OAuth callback may create or replace a credential. Token
// refreshes use the compare-and-swap path below so an old request can never
// resurrect a credential deleted by disconnect/reauthorization, nor overwrite
// a newer authorization.
async function storeInitialCredential(mailboxId: string, credential: ProviderCredential, client: Pool | PoolClient = pool) {
  const encrypted = encryptJson(credential, `outreach-mailbox:${mailboxId}`);
  await client.query(`insert into private.outreach_credentials(mailbox_id,encrypted_payload,nonce,auth_tag,key_version) values($1,$2,$3,$4,$5) on conflict(mailbox_id) do update set encrypted_payload=excluded.encrypted_payload,nonce=excluded.nonce,auth_tag=excluded.auth_tag,key_version=excluded.key_version,updated_at=now()`, [mailboxId, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, encrypted.keyVersion]);
}

async function replaceCredentialIfCurrent(
  mailboxId: string,
  credential: ProviderCredential,
  expected: StoredCredentialVersion,
  client: Pool | PoolClient = pool,
) {
  const encrypted = encryptJson(credential, `outreach-mailbox:${mailboxId}`);
  const updated = await client.query(`
    update private.outreach_credentials credential
    set encrypted_payload=$2,nonce=$3,auth_tag=$4,key_version=$5,updated_at=now()
    from public.outreach_mailboxes mailbox
    where credential.mailbox_id=$1
      and mailbox.id=credential.mailbox_id
      and mailbox.status='active'
      and credential.encrypted_payload=$6
      and credential.nonce=$7
      and credential.auth_tag=$8
      and credential.key_version=$9
    returning credential.mailbox_id`, [
    mailboxId,
    encrypted.ciphertext,
    encrypted.nonce,
    encrypted.authTag,
    encrypted.keyVersion,
    expected.ciphertext,
    expected.nonce,
    expected.authTag,
    expected.keyVersion,
  ]);
  if (!updated.rows[0]) {
    throw new HttpError(409, "mailbox_authorization_changed", "A autorização da mailbox mudou durante a atualização do token.");
  }
  return {
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
  } satisfies StoredCredentialVersion;
}

export async function providerSession(mailboxId: string, client: Pool | PoolClient = pool): Promise<ProviderSession> {
  const result = await client.query(`select m.provider,m.status,c.encrypted_payload,c.nonce,c.auth_tag,c.key_version from public.outreach_mailboxes m join private.outreach_credentials c on c.mailbox_id=m.id where m.id=$1`, [mailboxId]);
  const row = result.rows[0];
  if (!row) throw new HttpError(409, "mailbox_not_connected", "A mailbox ainda não tem credenciais autorizadas.");
  let version: StoredCredentialVersion = {
    ciphertext: row.encrypted_payload,
    nonce: row.nonce,
    authTag: row.auth_tag,
    keyVersion: row.key_version,
  };
  const credentials = decryptJson<ProviderCredential>(version, `outreach-mailbox:${mailboxId}`);
  // Reauthorization deliberately sets the mailbox pending before revoking the
  // old provider grant. It may still read/decrypt that credential, but only an
  // active mailbox is allowed to mutate it.
  if (needsReEncryption(row.key_version) && row.status === "active") {
    version = await replaceCredentialIfCurrent(mailboxId, credentials, version, client);
  }
  return {
    provider: providerFromDb(row.provider),
    credentials,
    persist: async (next) => {
      version = await replaceCredentialIfCurrent(mailboxId, next, version, client);
    },
  };
}

export function packSecret(value: unknown, aad: string) {
  const encrypted = encryptJson(value, aad);
  return Buffer.from(JSON.stringify({ v: encrypted.keyVersion, c: encrypted.ciphertext.toString("base64"), n: encrypted.nonce.toString("base64"), t: encrypted.authTag.toString("base64") }), "utf8");
}

export function unpackSecret<T>(value: Buffer, aad: string) {
  const parsed = JSON.parse(value.toString("utf8")) as { v: number; c: string; n: string; t: string };
  return decryptJson<T>({ keyVersion: parsed.v, ciphertext: Buffer.from(parsed.c, "base64"), nonce: Buffer.from(parsed.n, "base64"), authTag: Buffer.from(parsed.t, "base64") }, aad);
}

export async function createOAuthState(actor: Actor, input: { mailboxId: string; provider: Exclude<Provider, "smtp">; redirectUri: string; verifier: string }) {
  const state = randomToken(32);
  const stateHash = sha256(state);
  await transaction(async (client) => {
    const mailbox = await client.query(`select id from public.outreach_mailboxes where id=$1 and provider=$2 for update`, [input.mailboxId, providerToDb(input.provider)]);
    if (!mailbox.rows[0]) throw new HttpError(404, "mailbox_not_found", "Mailbox não encontrada para este provider.");
    await client.query(`insert into private.outreach_oauth_states(state_hash,mailbox_id,provider,profile_id,pkce_verifier_encrypted,redirect_uri,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`, [stateHash, input.mailboxId, providerToDb(input.provider), actor.id, packSecret({ verifier: input.verifier }, `oauth-state:${state}`), input.redirectUri]);
  }, "serializable");
  return state;
}

export async function consumeOAuthState(state: string, provider: Exclude<Provider, "smtp">) {
  return transaction(async (client) => {
    const result = await client.query(`select * from private.outreach_oauth_states where state_hash=$1 and provider=$2 and used_at is null and expires_at>now() for update`, [sha256(state), providerToDb(provider)]);
    const row = result.rows[0];
    if (!row) throw new HttpError(400, "oauth_state_invalid", "O pedido OAuth expirou ou já foi utilizado.");
    await client.query(`update private.outreach_oauth_states set used_at=now() where state_hash=$1`, [sha256(state)]);
    const secret = unpackSecret<{ verifier: string }>(row.pkce_verifier_encrypted, `oauth-state:${state}`);
    return {
      mailboxId: row.mailbox_id as string,
      profileId: row.profile_id as string,
      redirectUri: row.redirect_uri as string,
      verifier: secret.verifier,
      oauthStateHash: row.state_hash as Buffer,
    };
  }, "serializable");
}

export async function markMailboxConnected(mailboxId: string, identity: { email: string; name: string }, credential: OAuthCredential, actorId: string, oauthStateHash: Buffer) {
  await transaction(async (client) => {
    const permitted = await client.query(`
      select m.id
      from public.outreach_mailboxes m
      join public.profiles profile on profile.id=$2
      join private.outreach_oauth_states oauth_state
        on oauth_state.state_hash=$3 and oauth_state.mailbox_id=m.id
       and oauth_state.profile_id=profile.id and oauth_state.provider=m.provider
      where m.id=$1 and m.provider='google' and m.status='pending'
        and oauth_state.used_at is not null and oauth_state.expires_at>now()
        and profile.ativo and profile.role='admin'
      for update of m,profile,oauth_state`, [mailboxId, actorId, oauthStateHash]);
    if (!permitted.rows[0]) throw new HttpError(403, "oauth_callback_not_authorized", "A autorização deixou de pertencer a um administrador ativo ou a mailbox já não pode ser ligada.");
    await storeInitialCredential(mailboxId, credential, client);
    await client.query(`update public.outreach_mailboxes set email=$2,display_name=coalesce(nullif(display_name,''),$3),provider_account_id=$2,status='active',last_error=null where id=$1`, [mailboxId, identity.email, identity.name]);
    await client.query(`delete from private.outreach_oauth_states where mailbox_id=$1`, [mailboxId]);
    await client.query(`insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details) values($1,'mailbox.oauth.connected','mailbox',$2,$3::jsonb)`, [actorId, mailboxId, JSON.stringify({ provider: "google", email: identity.email })]);
  }, "serializable");
}

export async function assertOAuthCallbackAuthorized(mailboxId: string, actorId: string, oauthStateHash: Buffer) {
  const permitted = await pool.query(`
    select m.id
    from public.outreach_mailboxes m
    join public.profiles profile on profile.id=$2
    join private.outreach_oauth_states oauth_state
      on oauth_state.state_hash=$3 and oauth_state.mailbox_id=m.id
     and oauth_state.profile_id=profile.id and oauth_state.provider=m.provider
    where m.id=$1 and m.provider='google'
      and m.status in ('pending','active','error','disconnected')
      and oauth_state.used_at is not null and oauth_state.expires_at>now()
      and profile.ativo and profile.role='admin'`, [mailboxId, actorId, oauthStateHash]);
  if (!permitted.rows[0]) throw new HttpError(403, "oauth_callback_not_authorized", "A autorização deixou de pertencer a um administrador ativo ou a mailbox já não pode ser ligada.");
}

export async function assertMailboxReconciliationClear(client: PoolClient, mailboxId: string) {
  const pending = await client.query<{ job_id: string }>(`
    select ledger.job_id
    from private.outreach_delivery_ledger ledger
    where ledger.mailbox_id=$1
      and ledger.status in ('sending','accepted','ambiguous')
    order by ledger.last_attempt_at,ledger.job_id
    limit 1`, [mailboxId]);
  if (pending.rows[0]) {
    throw new HttpError(
      409,
      "mailbox_reconciliation_pending",
      "A mailbox tem entregas ambíguas por reconciliar. Conclui a reconciliação antes de desligar ou renovar a autorização.",
    );
  }
}

export async function prepareMailboxReauthorization(mailboxId: string, actorId: string, oauthStateHash: Buffer) {
  await transaction(async (client) => {
    await client.query(`select pg_advisory_xact_lock(20260930,1)`);
    const permitted = await client.query(`
      select m.id from public.outreach_mailboxes m
      join public.profiles profile on profile.id=$2
      join private.outreach_oauth_states oauth_state
        on oauth_state.state_hash=$3 and oauth_state.mailbox_id=m.id
       and oauth_state.profile_id=profile.id and oauth_state.provider=m.provider
      where m.id=$1 and m.provider='google'
        and m.status in ('pending','active','error','disconnected')
        and oauth_state.used_at is not null and oauth_state.expires_at>now()
        and profile.ativo and profile.role='admin'
      for update of m,profile,oauth_state`, [mailboxId, actorId, oauthStateHash]);
    if (!permitted.rows[0]) throw new HttpError(403, "oauth_callback_not_authorized", "A autorização deixou de pertencer a um administrador ativo ou a mailbox já não pode ser ligada.");
    // Keep the old grant available until every possibly accepted provider
    // call is resolved. The exclusive send permit makes this check stable
    // against a concurrent provider POST.
    await assertMailboxReconciliationClear(client, mailboxId);
    await client.query(`update public.outreach_mailboxes set status='pending',send_enabled=false,updated_at=now() where id=$1`, [mailboxId]);
    await client.query(`
      update public.outreach_jobs job set status='reconciliation_required',lease_owner=null,lease_expires_at=null,
        last_error='mailbox_reauthorization',updated_at=now()
      where job.mailbox_id=$1 and job.status='leased'
        and exists (
          select 1 from private.outreach_delivery_ledger ledger
          where ledger.job_id=job.id
            and ledger.status in ('sending','accepted','ambiguous')
        )`, [mailboxId]);
    await client.query(`
      update public.outreach_jobs job set status='pending',lease_owner=null,lease_expires_at=null,
        last_error='mailbox_reauthorization_before_dispatch',updated_at=now()
      where job.mailbox_id=$1 and job.status='leased'
        and not exists (
          select 1 from private.outreach_delivery_ledger ledger
          where ledger.job_id=job.id
            and ledger.status in ('sending','accepted','ambiguous')
        )`, [mailboxId]);
    await client.query(`insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details) values($1,'mailbox.oauth.reauthorization_started','mailbox',$2,'{}')`, [actorId, mailboxId]);
  }, "serializable");
}

export async function deleteMailboxCredential(mailboxId: string) {
  await pool.query(`delete from private.outreach_credentials where mailbox_id=$1`, [mailboxId]);
}

export { hashSuppressionIdentity };
