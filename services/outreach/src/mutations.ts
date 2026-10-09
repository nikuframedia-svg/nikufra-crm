import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor, Provider } from "./types.js";
import { pool, transaction } from "./db.js";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
import { assertMailboxReconciliationClear, audit, campaignReadiness, providerSession } from "./repository.js";
import { inspectDomain } from "./dns.js";
import { verifyEmailAddress } from "./verification.js";
import { revokeProviderAuthorization } from "./providers.js";

const uuid = z.uuid();
const campaignStepSchema = z.object({
  kind: z.enum(["email", "wait"]).default("email"),
  delayMinutes: z.number().int().min(0).max(525_600).default(0),
  replyToPrevious: z.boolean().default(true),
  active: z.boolean().default(true),
  variants: z.array(z.object({
    name: z.string().trim().min(1).max(40).default("A"),
    weight: z.number().int().min(0).max(10_000).default(100),
    subject: z.string().trim().min(1).max(998),
    body: z.string().trim().min(1).max(200_000),
    active: z.boolean().default(true),
  })).max(10).default([]),
}).superRefine((step, context) => {
  if (step.kind === "email" && !step.variants.length) context.addIssue({ code: "custom", path: ["variants"], message: "Um passo de email precisa de pelo menos uma variante." });
  if (step.kind === "wait" && step.variants.length) context.addIssue({ code: "custom", path: ["variants"], message: "Um passo de espera não pode ter variantes." });
  if (new Set(step.variants.map((variant) => variant.name)).size !== step.variants.length) context.addIssue({ code: "custom", path: ["variants"], message: "Os nomes das variantes têm de ser diferentes." });
});
type CampaignStepInput = z.infer<typeof campaignStepSchema>;

async function insertCampaignSteps(client: import("pg").PoolClient, campaignId: string, steps: CampaignStepInput[]) {
  for (const [index, step] of steps.entries()) {
    const inserted = await client.query<{ id: string }>(`insert into public.outreach_campaign_steps(campaign_id,position,kind,delay_minutes,reply_to_previous,ativo) values($1,$2,$3,$4,$5,$6) returning id`, [campaignId, index + 1, step.kind, step.delayMinutes, step.replyToPrevious, step.active]);
    for (const variant of step.variants) {
      await client.query(`insert into public.outreach_campaign_variants(step_id,nome,weight,subject_template,body_template,ativo) values($1,$2,$3,$4,$5,$6)`, [inserted.rows[0]!.id, variant.name, variant.weight, variant.subject, variant.body, variant.active]);
    }
  }
}

export const campaignInputSchema = z.object({
  name: z.string().trim().min(1).max(180),
  description: z.string().max(5_000).default(""),
  stopCompanyOnReply: z.boolean().default(true),
  timezone: z.string().min(1).max(80).default("Europe/Lisbon"),
  sendDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
  sendWindowStart: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  sendWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).default("17:00"),
  startsAt: z.iso.datetime().nullable().default(null),
  endsAt: z.iso.datetime().nullable().default(null),
  dailyLimit: z.number().int().min(1).max(10_000).default(10),
  gapMinutes: z.number().int().min(0).max(1_440).default(5),
  jitterMinutes: z.number().int().min(0).max(1_440).default(2),
  mailboxIds: z.array(uuid).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    "Uma mailbox só pode ser selecionada uma vez.",
  ).default([]),
  audienceId: uuid.optional(),
  steps: z.array(campaignStepSchema).max(50).default([]),
}).superRefine((value, context) => {
  if (value.sendWindowStart >= value.sendWindowEnd) context.addIssue({ code: "custom", path: ["sendWindowEnd"], message: "A janela de envio tem de terminar depois de começar." });
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) context.addIssue({ code: "custom", path: ["endsAt"], message: "A campanha tem de terminar depois de começar." });
});

async function replaceCampaignMailboxes(
  client: import("pg").PoolClient,
  campaignId: string,
  mailboxIds: string[],
  actorId: string,
) {
  if (mailboxIds.length) {
    const existing = await client.query<{ id: string }>(`
      select id from public.outreach_mailboxes
      where id=any($1::uuid[])
      order by id`, [mailboxIds]);
    if (existing.rows.length !== mailboxIds.length) {
      throw new HttpError(409, "campaign_mailbox_not_found", "Uma ou mais mailboxes selecionadas já não existem.");
    }
  }
  await client.query(`delete from public.outreach_campaign_mailboxes where campaign_id=$1`, [campaignId]);
  if (mailboxIds.length) {
    await client.query(`
      insert into public.outreach_campaign_mailboxes(campaign_id,mailbox_id,selected_by)
      select $1,selected.mailbox_id,$3
      from unnest($2::uuid[]) selected(mailbox_id)`, [campaignId, mailboxIds, actorId]);
  }
  return mailboxIds;
}

export async function createCampaign(actor: Actor, raw: unknown) {
  const input = campaignInputSchema.parse(raw);
  return transaction(async (client) => {
    const campaign = await client.query<{ id: string }>(`
      insert into public.outreach_campaigns(nome,descricao,created_by,stop_company_on_reply,timezone,send_days,send_window_start,send_window_end,starts_at,ends_at,daily_limit,gap_minutes,jitter_minutes)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [input.name, input.description, actor.id, input.stopCompanyOnReply, input.timezone, input.sendDays, input.sendWindowStart, input.sendWindowEnd, input.startsAt, input.endsAt, input.dailyLimit, input.gapMinutes, input.jitterMinutes],
    );
    const campaignId = campaign.rows[0]!.id;
    await insertCampaignSteps(client, campaignId, input.steps);
    await replaceCampaignMailboxes(client, campaignId, input.mailboxIds, actor.id);
    if (input.audienceId) {
      const members = await client.query<{ contact_id: string }>(`select contact_id from public.outreach_audience_members where audience_id=$1`, [input.audienceId]);
      if (!members.rows.length) throw new HttpError(409, "audience_empty", "A lista selecionada não existe ou ainda não tem contactos.");
      await materializeRecipients(client, input.audienceId, campaignId, await contactEligibility(members.rows.map((row) => row.contact_id), client));
    }
    await client.query(`insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details) values($1,'campaign.created','campaign',$2,$3::jsonb)`, [actor.id, campaignId, JSON.stringify({ name: input.name, steps: input.steps.length, mailboxIds: input.mailboxIds, audienceId: input.audienceId ?? null })]);
    return { id: campaignId, mailboxIds: input.mailboxIds };
  });
}

// PATCH must not inherit the creation defaults: an omitted field is left
// untouched. Zod applies defaults nested under `.partial()`, which would turn
// a mailbox-only update into an unintended reset of the campaign settings.
const campaignPatchSchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  description: z.string().max(5_000).optional(),
  stopCompanyOnReply: z.boolean().optional(),
  timezone: z.string().min(1).max(80).optional(),
  sendDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  sendWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  sendWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  dailyLimit: z.number().int().min(1).max(10_000).optional(),
  gapMinutes: z.number().int().min(0).max(1_440).optional(),
  jitterMinutes: z.number().int().min(0).max(1_440).optional(),
  mailboxIds: z.array(uuid).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    "Uma mailbox só pode ser selecionada uma vez.",
  ).optional(),
  addAudienceId: uuid.optional(),
  steps: z.array(campaignStepSchema).min(1).max(50).optional(),
}).strict().superRefine((value, context) => {
  if (value.sendWindowStart && value.sendWindowEnd && value.sendWindowStart >= value.sendWindowEnd) {
    context.addIssue({ code: "custom", path: ["sendWindowEnd"], message: "A janela de envio tem de terminar depois de começar." });
  }
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "A campanha tem de terminar depois de começar." });
  }
});

export async function updateCampaign(actor: Actor, campaignId: string, raw: unknown) {
  const input = campaignPatchSchema.parse(raw);
  const columns = new Map<string, unknown>([
    ["nome", input.name], ["descricao", input.description], ["stop_company_on_reply", input.stopCompanyOnReply],
    ["timezone", input.timezone], ["send_days", input.sendDays], ["send_window_start", input.sendWindowStart],
    ["send_window_end", input.sendWindowEnd], ["starts_at", input.startsAt], ["ends_at", input.endsAt],
    ["daily_limit", input.dailyLimit], ["gap_minutes", input.gapMinutes], ["jitter_minutes", input.jitterMinutes],
  ]);
  const entries = [...columns].filter((entry): entry is [string, unknown] => entry[1] !== undefined);
  let audienceEligibility: EligibilityResult[] | null = null;
  if (input.addAudienceId) {
    const members = await pool.query<{ contact_id: string }>(`select contact_id from public.outreach_audience_members where audience_id=$1`, [input.addAudienceId]);
    if (!members.rowCount) throw new HttpError(409, "audience_empty", "A audiência não existe ou ainda não tem contactos.");
    audienceEligibility = await contactEligibility(members.rows.map((row) => row.contact_id));
  }
  return transaction(async (client) => {
    if (input.mailboxIds !== undefined || input.steps !== undefined || input.addAudienceId !== undefined) {
      const campaign = await client.query<{ status: string }>(`
        select status::text status
        from public.outreach_campaigns
        where id=$1
        for update`, [campaignId]);
      if (!campaign.rows[0]) {
        throw new HttpError(404, "campaign_not_found", "Campanha não encontrada.");
      }
      if (campaign.rows[0].status !== "draft") {
        throw new HttpError(
          409,
          input.steps !== undefined ? "campaign_steps_locked" : input.addAudienceId !== undefined ? "campaign_audiences_locked" : "campaign_mailboxes_locked",
          input.steps !== undefined ? "A sequência só pode ser alterada antes do primeiro lançamento." : input.addAudienceId !== undefined ? "A lista de destinatários só pode ser associada antes do primeiro lançamento." : "As mailboxes da campanha só podem ser alteradas antes do primeiro lançamento.",
        );
      }
    }
    if (entries.length) {
      const assignments = entries.map(([column], index) => `${column}=$${index + 2}`).join(",");
      const result = await client.query(`update public.outreach_campaigns set ${assignments} where id=$1 and status in ('draft','paused') returning id`, [campaignId, ...entries.map(([, value]) => value)]);
      if (!result.rows[0]) throw new HttpError(409, "campaign_not_editable", "A campanha não existe ou não pode ser editada no estado atual.");
    }
    if (input.mailboxIds !== undefined) {
      await replaceCampaignMailboxes(client, campaignId, input.mailboxIds, actor.id);
      await client.query(`
        insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details)
        values($1,'campaign.mailboxes_updated','campaign',$2,$3::jsonb)`, [
        actor.id,
        campaignId,
        JSON.stringify({ mailboxIds: input.mailboxIds, mailboxCount: input.mailboxIds.length }),
      ]);
    }
    if (input.steps !== undefined) {
      const jobs = await client.query<{ count: string }>(`select count(*)::text count from public.outreach_jobs where campaign_id=$1`, [campaignId]);
      if (Number(jobs.rows[0]?.count ?? 0)) throw new HttpError(409, "campaign_steps_locked", "A sequência já tem jobs associados e não pode ser substituída.");
      await client.query(`delete from public.outreach_campaign_steps where campaign_id=$1`, [campaignId]);
      await insertCampaignSteps(client, campaignId, input.steps);
      const recipients = await client.query<{ id: string; contact_id: string }>(`select id,contact_id from public.outreach_recipients where campaign_id=$1 and contact_id is not null`, [campaignId]);
      const currentContacts = await contactEligibility(recipients.rows.map((row) => row.contact_id), client);
      const byContact = new Map(currentContacts.map((item) => [item.contactId, item]));
      for (const recipient of recipients.rows) {
        const current = byContact.get(recipient.contact_id);
        if (!current) continue;
        await client.query(`update public.outreach_recipients set variable_snapshot=$2::jsonb,status=$3,eligibility_reasons=$4 where id=$1`, [
          recipient.id, JSON.stringify(current.variables), current.eligible ? "eligible" : "ineligible", current.reasons,
        ]);
      }
      await client.query(`insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details) values($1,'campaign.steps_updated','campaign',$2,$3::jsonb)`, [actor.id, campaignId, JSON.stringify({ count: input.steps.length })]);
    }
    if (input.addAudienceId && audienceEligibility) await materializeRecipients(client, input.addAudienceId, campaignId, audienceEligibility);
    await client.query(`insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details) values($1,'campaign.updated','campaign',$2,$3::jsonb)`, [actor.id, campaignId, JSON.stringify({ ...Object.fromEntries(entries), addAudienceId: input.addAudienceId ?? null, stepsUpdated: input.steps !== undefined })]);
    const selected = await client.query<{ mailbox_id: string }>(`
      select mailbox_id from public.outreach_campaign_mailboxes
      where campaign_id=$1 order by mailbox_id`, [campaignId]);
    return { id: campaignId, audienceAdded: input.addAudienceId ?? null, mailboxIds: selected.rows.map((row) => row.mailbox_id) };
  }, "serializable");
}

export async function campaignAction(actor: Actor, campaignId: string, action: "launch" | "pause" | "resume") {
  return transaction(async (client) => {
    const campaign = await client.query<{ status: string }>(`select status::text status from public.outreach_campaigns where id=$1 for update`, [campaignId]);
    const current = campaign.rows[0]?.status;
    if (!current) throw new HttpError(404, "campaign_not_found", "Campanha não encontrada.");
    if (action === "pause") {
      if (current !== "running") throw new HttpError(409, "invalid_campaign_state", "Só uma campanha ativa pode ser pausada.");
      await client.query(`update public.outreach_campaigns set status='paused',paused_at=now() where id=$1`, [campaignId]);
    } else {
      const allowed = action === "launch" ? ["draft", "paused"] : ["paused"];
      if (!allowed.includes(current)) throw new HttpError(409, "invalid_campaign_state", "A campanha não pode avançar a partir do estado atual.");
      const readiness = await campaignReadiness(campaignId, client);
      if (!readiness.ready) {
        throw new HttpError(
          409,
          "campaign_not_ready",
          "A campanha precisa de um passo de email e variante ativos, destinatários elegíveis e uma mailbox Google com DNS recente.",
          readiness,
        );
      }
      await client.query(`update public.outreach_campaigns set status='running',launched_at=coalesce(launched_at,now()),paused_at=null where id=$1`, [campaignId]);
      await materializeInitialJobs(client, campaignId);
    }
    await client.query(`insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details) values($1,$2,'campaign',$3,'{}')`, [actor.id, `campaign.${action}`, campaignId]);
    return { id: campaignId, status: action === "pause" ? "paused" : "running" };
  }, "serializable");
}

const messageTestSchema = z.object({
  stepId: uuid,
  variantId: uuid,
  contactId: uuid,
  mailboxId: uuid,
  confirmed: z.literal(true),
}).strict();

export async function queueCampaignMessageTest(actor: Actor, sourceCampaignId: string, raw: unknown, idempotencyKey: string) {
  const input = messageTestSchema.parse(raw);
  const requestHash = createHash("sha256").update(JSON.stringify({ actorId: actor.id, sourceCampaignId, ...input })).digest("hex");
  if (config.shadowMode || !config.outboundEnvEnabled) {
    throw new HttpError(503, "outbound_disabled", "O envio de teste está desligado na operação Outreach.");
  }
  return transaction(async (client) => {
    const existing = await client.query<{ id: string; test_request_hash: string }>(`
      select id,test_request_hash from public.outreach_campaigns where test_idempotency_key=$1`, [idempotencyKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].test_request_hash !== requestHash) throw new HttpError(409, "idempotency_key_reused", "Esta chave de envio de teste já foi usada para outro pedido.");
      return { id: existing.rows[0].id, sourceCampaignId, queued: true, duplicate: true };
    }
    const member = await client.query<{ id: string }>(`
      select r.id from public.outreach_recipients r
      where r.campaign_id=$1 and r.contact_id=$2
      for share`, [sourceCampaignId, input.contactId]);
    if (!member.rows[0]) throw new HttpError(409, "test_contact_not_in_campaign", "O destinatário tem de fazer parte da lista desta campanha.");
    const [candidate] = await contactEligibility([input.contactId], client);
    const testWarnings = candidate?.reasons.filter((reason) => reason === "lawful_basis_missing") ?? [];
    const testBlockers = candidate?.reasons.filter((reason) => reason !== "lawful_basis_missing") ?? ["contact_not_found"];
    if (!candidate || testBlockers.length) {
      throw new HttpError(409, "test_contact_ineligible", "O contacto de teste não está elegível para envio.", { reasons: testBlockers });
    }
    const testCandidate = { ...candidate, eligible: true };
    const source = await client.query<{
      name: string; send_days: number[]; send_window_start: string; send_window_end: string;
      timezone: string; subject: string; body: string;
    }>(`
      select c.nome name,c.send_days,c.send_window_start::text,c.send_window_end::text,c.timezone,
             v.subject_template subject,v.body_template body
      from public.outreach_campaigns c
      join public.outreach_campaign_steps s on s.campaign_id=c.id and s.id=$2 and s.ativo and s.kind='email'
      join public.outreach_campaign_variants v on v.step_id=s.id and v.id=$3 and v.ativo
      join public.outreach_campaign_mailboxes selection on selection.campaign_id=c.id and selection.mailbox_id=$4
      where c.id=$1 and c.test_source_campaign_id is null
      for share of c,s,v`, [sourceCampaignId, input.stepId, input.variantId, input.mailboxId]);
    const template = source.rows[0];
    if (!template) throw new HttpError(409, "test_message_unavailable", "Seleciona uma mensagem ativa e uma mailbox desta campanha.");
    const operational = await client.query<{ send_enabled: boolean; mode: string }>(`select send_enabled,mode::text mode from public.outreach_system_state where id`, []);
    if (!operational.rows[0]?.send_enabled || operational.rows[0].mode === "disabled") {
      throw new HttpError(503, "outbound_disabled", "O envio está desligado nas definições Outreach.");
    }
    const inserted = await client.query<{ id: string }>(`
      insert into public.outreach_campaigns(nome,descricao,created_by,timezone,send_days,send_window_start,send_window_end,daily_limit,gap_minutes,jitter_minutes,test_source_campaign_id,test_idempotency_key,test_request_hash)
      values($1,$2,$3,$4,$5,$6,$7,1,0,0,$8,$9,$10)
      on conflict(test_idempotency_key) do nothing returning id`, [
      `Teste de entrega · ${template.name}`.slice(0, 180),
      "Envio individual de teste a partir de uma mensagem de campanha.",
      actor.id, template.timezone, template.send_days, template.send_window_start, template.send_window_end,
      sourceCampaignId, idempotencyKey, requestHash,
    ]);
    if (!inserted.rows[0]) {
      const duplicate = await client.query<{ id: string; test_request_hash: string }>(`select id,test_request_hash from public.outreach_campaigns where test_idempotency_key=$1`, [idempotencyKey]);
      if (!duplicate.rows[0] || duplicate.rows[0].test_request_hash !== requestHash) throw new HttpError(409, "idempotency_key_reused", "Esta chave de envio de teste já foi usada para outro pedido.");
      return { id: duplicate.rows[0].id, sourceCampaignId, queued: true, duplicate: true };
    }
    const testCampaignId = inserted.rows[0].id;
    await insertCampaignSteps(client, testCampaignId, [{ kind: "email", delayMinutes: 0, replyToPrevious: false, active: true, variants: [{ name: "A", weight: 100, subject: template.subject, body: template.body, active: true }] }]);
    await replaceCampaignMailboxes(client, testCampaignId, [input.mailboxId], actor.id);
    const audience = await client.query<{ id: string }>(`insert into public.outreach_audiences(nome,descricao,created_by) values($1,$2,$3) returning id`, [`Teste · ${candidate.contactName}`.slice(0, 180), "Destinatário único de teste de mensagem.", actor.id]);
    await client.query(`insert into public.outreach_audience_members(audience_id,contact_id,eligibility_status,eligibility_reasons,assessed_at,added_by) values($1,$2,'eligible',$3,now(),$4)`, [audience.rows[0]!.id, input.contactId, testWarnings, actor.id]);
    await materializeRecipients(client, audience.rows[0]!.id, testCampaignId, [testCandidate]);
    const readiness = await campaignReadiness(testCampaignId, client);
    if (!readiness.ready) throw new HttpError(409, "test_not_ready", "O teste precisa de uma mailbox pronta e um destinatário elegível.", readiness);
    await client.query(`update public.outreach_campaigns set status='running',launched_at=now() where id=$1`, [testCampaignId]);
    const recipient = await client.query<{ id: string }>(`select id from public.outreach_recipients where campaign_id=$1 and contact_id=$2`, [testCampaignId, input.contactId]);
    const decision = await client.query<{ decision: { eligible?: boolean; reasons?: string[] } }>(`select private.outreach_recipient_eligibility($1,$2,now()) decision`, [recipient.rows[0]?.id, input.mailboxId]);
    const temporaryReasons = new Set(["outside_send_window", "daily_quota_reached", "mailbox_gap_not_elapsed"]);
    const blockers = (decision.rows[0]?.decision?.reasons ?? ["eligibility_unavailable"]).filter((reason) => !temporaryReasons.has(reason));
    if (blockers.length) {
      const reasonLabels: Record<string, string> = {
        suppressed: "o contacto pediu para não receber emails",
        email_not_verified: "o endereço de email não tem verificação válida",
        mailbox_not_sendable: "a mailbox escolhida não está pronta",
        dns_not_ready: "o DNS da mailbox precisa de nova verificação",
        daily_quota_reached: "a quota diária da mailbox foi atingida",
        outbound_disabled: "o envio global está desligado",
      };
      throw new HttpError(409, "test_contact_ineligible", `Não foi possível preparar o teste: ${blockers.map((reason) => reasonLabels[reason] ?? reason).join(" · ")}.`, { reasons: blockers });
    }
    await materializeInitialJobs(client, testCampaignId);
    await audit(actor.id, "campaign.message_test_queued", "campaign", sourceCampaignId, {
      testCampaignId, stepId: input.stepId, variantId: input.variantId,
      contactId: input.contactId, mailboxId: input.mailboxId, warnings: testWarnings,
    }, client);
    return { id: testCampaignId, sourceCampaignId, queued: true, duplicate: false };
  }, "serializable");
}

async function materializeInitialJobs(client: import("pg").PoolClient, campaignId: string) {
  await client.query(`
    with first_email as (
      select s.* from public.outreach_campaign_steps s where s.campaign_id=$1 and s.ativo and s.kind='email' order by s.position limit 1
    ), first_step as (
      select s.id step_id,
             (select coalesce(sum(prior.delay_minutes),0)::int from public.outreach_campaign_steps prior where prior.campaign_id=s.campaign_id and prior.ativo and prior.position<=s.position) delay_minutes,
             (select v.id from public.outreach_campaign_variants v where v.step_id=s.id and v.ativo order by v.weight desc,v.id limit 1) variant_id
      from first_email s
    )
    insert into public.outreach_jobs(campaign_id,recipient_id,step_id,variant_id,mailbox_id,scheduled_at,idempotency_key)
    select $1,r.id,s.step_id,s.variant_id,m.id,now()+(s.delay_minutes||' minutes')::interval,
           'campaign:'||$1::text||':recipient:'||r.id::text||':step:'||s.step_id::text
    from public.outreach_recipients r cross join first_step s
    cross join lateral (
      select mailbox.id
      from public.outreach_campaign_mailboxes selection
      join public.outreach_mailboxes mailbox on mailbox.id=selection.mailbox_id
      where selection.campaign_id=$1
        and mailbox.provider='google' and mailbox.status='active' and mailbox.send_enabled
        and coalesce((
          select dns.spf_status='pass' and dns.dkim_status='pass' and dns.dmarc_status='pass' and dns.mx_status='pass'
            and dns.checked_at > now()-interval '24 hours'
          from public.outreach_dns_checks dns where dns.mailbox_id=mailbox.id
          order by dns.checked_at desc,dns.id desc limit 1
        ),false)
      order by md5(r.id::text||mailbox.id::text) limit 1
    ) m
    where r.campaign_id=$1 and r.status='eligible'
    on conflict(idempotency_key) do nothing`, [campaignId]);
  const scheduled = await client.query<{ count: string }>(`select count(*)::text count from public.outreach_jobs where campaign_id=$1 and status in ('pending','leased','reconciliation_required')`, [campaignId]);
  if (!Number(scheduled.rows[0]?.count ?? 0)) throw new HttpError(409, "campaign_jobs_not_materialized", "Não foi possível distribuir os destinatários por mailboxes elegíveis.");
}

const audienceSchema = z.object({
  name: z.string().trim().min(1).max(180),
  description: z.string().max(5_000).default(""),
  filterDefinition: z.record(z.string(), z.unknown()).default({}),
});

export async function createAudience(actor: Actor, raw: unknown) {
  const input = audienceSchema.parse(raw);
  return transaction(async (client) => {
    const result = await client.query<{ id: string }>(`insert into public.outreach_audiences(nome,descricao,filter_definition,created_by) values($1,$2,$3::jsonb,$4) returning id`, [input.name, input.description, JSON.stringify(input.filterDefinition), actor.id]);
    const id = result.rows[0]!.id;
    await audit(actor.id, "audience.created", "audience", id, { name: input.name }, client);
    return { id };
  });
}

export interface EligibilityResult {
  contactId: string;
  email: string | null;
  companyId: string;
  eligible: boolean;
  reasons: string[];
  verification: string;
  contactName: string;
  companyName: string;
  variables: Record<string, string | null>;
}

export async function contactEligibility(contactIds: string[], client?: import("pg").PoolClient): Promise<EligibilityResult[]> {
  if (!contactIds.length) return [];
  const result = await (client ?? pool).query<{
    id: string; email: string | null; optout: boolean; outreach_legal_basis: string | null; outreach_consent_at: Date | null;
    outreach_legal_basis_recorded_at: Date | null; outreach_legal_basis_recorded_by: string | null;
    outreach_consent_source: string | null; outreach_legal_basis_evidence: string | null;
    outreach_legitimate_interest_purpose: string | null; outreach_lia_reference: string | null;
    outreach_legitimate_interest_expires_at: Date | null;
    empresa_id: string; contact_name: string; company_name: string; cargo: string | null; telefone: string | null; linkedin_url: string | null;
    vertical: string; pais: string; cidade: string | null; website: string | null; verification_status: string | null; owned_mailbox_history: boolean; suppressed: boolean;
  }>(`
    select c.id,c.email::text,c.optout,c.outreach_legal_basis,c.outreach_consent_at,
           c.outreach_legal_basis_recorded_at,c.outreach_legal_basis_recorded_by,c.outreach_consent_source,
           c.outreach_legal_basis_evidence,c.outreach_legitimate_interest_purpose,c.outreach_lia_reference,
           c.outreach_legitimate_interest_expires_at,
           c.empresa_id,c.nome contact_name,e.nome company_name,c.cargo,c.telefone,c.linkedin_url,e.vertical::text,e.pais,e.cidade,e.website,
           verification.status::text verification_status,
           private.outreach_has_owned_mailbox_email(c.id, c.email::text) owned_mailbox_history,
           private.outreach_is_suppressed(c.email::text,c.empresa_id) suppressed
    from public.contactos c join public.empresas e on e.id=c.empresa_id
    left join lateral (
      select case when v.expires_at is null or v.expires_at>now()
        then v.status else 'unknown'::public.outreach_verification_status end status
      from public.outreach_email_verifications v
      where v.email=c.email
      order by v.verified_at desc nulls last,v.created_at desc,v.id desc limit 1
    ) verification on true
    where c.id=any($1::uuid[])`, [contactIds]);
  return result.rows.map((row) => {
    const reasons: string[] = [];
    if (!row.email) reasons.push("missing_email");
    if (row.optout) reasons.push("contact_optout");
    if (!row.outreach_legal_basis || row.outreach_legal_basis === "not_applicable"
      || !row.outreach_legal_basis_recorded_at || !row.outreach_legal_basis_recorded_by
      || (row.outreach_legal_basis === "consent" && (!row.outreach_consent_at || !row.outreach_consent_source?.trim()))
      || (row.outreach_legal_basis === "contract" && !row.outreach_legal_basis_evidence?.trim())
      || (row.outreach_legal_basis === "legitimate_interest" && (
        !row.outreach_legitimate_interest_purpose?.trim() || !row.outreach_lia_reference?.trim()
        || !row.outreach_legitimate_interest_expires_at
        || row.outreach_legitimate_interest_expires_at.getTime() <= Date.now()
      ))) reasons.push("lawful_basis_missing");
    if (!row.owned_mailbox_history && row.verification_status !== "valid") reasons.push(row.verification_status ? `verification_${row.verification_status}` : "verification_missing");
    if (row.suppressed) reasons.push("suppressed");
    const firstName = row.contact_name.trim().split(/\s+/)[0] ?? row.contact_name;
    return {
      contactId: row.id, email: row.email, companyId: row.empresa_id, eligible: reasons.length === 0, reasons,
      verification: row.owned_mailbox_history ? "owned_mailbox_history" : row.verification_status ?? "unknown",
      contactName: row.contact_name, companyName: row.company_name,
      variables: {
        nome: row.contact_name, name: row.contact_name, primeiro_nome: firstName, first_name: firstName,
        empresa: row.company_name, company: row.company_name, email: row.email, cargo: row.cargo, title: row.cargo,
        telefone: row.telefone, phone: row.telefone, linkedin: row.linkedin_url, vertical: row.vertical,
        pais: row.pais, country: row.pais, cidade: row.cidade, city: row.cidade, website: row.website,
      },
    };
  });
}

const addAudienceSchema = z.object({ contactIds: z.array(uuid).min(1).max(5_000), campaignId: uuid.optional() });

export async function addAudienceContacts(actor: Actor, audienceId: string, raw: unknown) {
  const input = addAudienceSchema.parse(raw);
  const eligibility = await contactEligibility(input.contactIds);
  const found = new Set(eligibility.map((item) => item.contactId));
  for (const id of input.contactIds) if (!found.has(id)) eligibility.push({ contactId: id, email: null, companyId: "", eligible: false, reasons: ["contact_not_found"], verification: "unknown", contactName: "", companyName: "", variables: {} });
  await transaction(async (client) => {
    const audience = await client.query(`select id from public.outreach_audiences where id=$1 for share`, [audienceId]);
    if (!audience.rows[0]) throw new HttpError(404, "audience_not_found", "Audiência não encontrada.");
    for (const item of eligibility.filter((entry) => entry.companyId)) {
      await client.query(`insert into public.outreach_audience_members(audience_id,contact_id,eligibility_status,eligibility_reasons,assessed_at,added_by) values($1,$2,$3,$4,now(),$5) on conflict(audience_id,contact_id) do update set eligibility_status=excluded.eligibility_status,eligibility_reasons=excluded.eligibility_reasons,assessed_at=now()`, [audienceId, item.contactId, item.eligible ? "eligible" : "ineligible", item.reasons, actor.id]);
    }
    if (input.campaignId) await materializeRecipients(client, audienceId, input.campaignId, eligibility);
    await client.query(`insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details) values($1,'audience.contacts_added','audience',$2,$3::jsonb)`, [actor.id, audienceId, JSON.stringify({ count: eligibility.length, eligible: eligibility.filter((item) => item.eligible).length, campaignId: input.campaignId ?? null })]);
  }, "serializable");
  return { assessed: eligibility.length, eligible: eligibility.filter((item) => item.eligible).length, items: eligibility };
}

async function materializeRecipients(client: import("pg").PoolClient, audienceId: string, campaignId: string, eligibility: EligibilityResult[]) {
  const campaign = await client.query(`select id from public.outreach_campaigns where id=$1 and status='draft' for update`, [campaignId]);
  if (!campaign.rows[0]) throw new HttpError(409, "campaign_not_editable", "Só é possível adicionar uma audiência a uma campanha em rascunho.");
  await client.query(`insert into public.outreach_campaign_audiences(campaign_id,audience_id) values($1,$2) on conflict do nothing`, [campaignId, audienceId]);
  for (const item of eligibility) {
    if (!item.companyId) continue;
    const member = await client.query<{ id: string }>(`select id from public.outreach_audience_members where audience_id=$1 and contact_id=$2`, [audienceId, item.contactId]);
    await client.query(`insert into public.outreach_recipients(campaign_id,audience_member_id,contact_id,company_id,email_snapshot,variable_snapshot,status,eligibility_reasons) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8) on conflict(campaign_id,contact_id) where contact_id is not null do update set audience_member_id=excluded.audience_member_id,email_snapshot=excluded.email_snapshot,variable_snapshot=excluded.variable_snapshot,status=excluded.status,eligibility_reasons=excluded.eligibility_reasons`, [campaignId, member.rows[0]?.id ?? null, item.contactId, item.companyId, item.email, JSON.stringify(item.variables), item.eligible ? "eligible" : "ineligible", item.reasons]);
  }
}

const mailboxSchema = z.object({
  provider: z.enum(["google", "microsoft", "smtp"]).default("google"),
  email: z.email(),
  displayName: z.string().max(180).default(""),
  ownerProfileId: uuid.nullable().default(null),
  dailyLimit: z.number().int().min(1).max(500).default(10),
  timezone: z.string().min(1).max(80).default("Europe/Lisbon"),
});

export async function createMailbox(actor: Actor, raw: unknown) {
  const input = mailboxSchema.parse(raw);
  if (input.provider !== "google") throw new HttpError(409, "provider_not_rolled_out", "No primeiro rollout só é possível ligar mailboxes Google.");
  try {
    return await transaction(async (client) => {
      const result = await client.query<{ id: string }>(`insert into public.outreach_mailboxes(provider,email,display_name,owner_profile_id,daily_limit,timezone,status,created_by) values('google',$1,$2,$3,$4,$5,'pending',$6) returning id`, [input.email.toLowerCase(), input.displayName, input.ownerProfileId, input.dailyLimit, input.timezone, actor.id]);
      const id = result.rows[0]!.id;
      await audit(actor.id, "mailbox.created", "mailbox", id, { email: input.email, provider: input.provider }, client);
      return { id };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new HttpError(409, "mailbox_exists", "Já existe uma mailbox com este email. Atualiza a lista ou volta a autorizá-la.");
    }
    throw error;
  }
}

const mailboxPatchSchema = z.object({
  displayName: z.string().max(180).optional(),
  ownerProfileId: uuid.nullable().optional(),
  dailyLimit: z.number().int().min(1).max(10).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  sendEnabled: z.boolean().optional(),
  adminExceptionRecorded: z.boolean().optional(),
}).strict();

interface MailboxRampState {
  provider: string;
  email: string;
  status: string;
  sendEnabled: boolean;
  dailyLimit: number;
  rampDailyLimit: number;
  dnsReady: boolean;
  credentialsReady: boolean;
  adminExceptionRecorded: boolean;
}

export function validateMailboxRamp(current: MailboxRampState, patch: z.infer<typeof mailboxPatchSchema>) {
  if (patch.sendEnabled === true) {
    if (current.provider !== "google") throw new HttpError(409, "provider_not_rolled_out", "No primeiro rollout só são permitidas mailboxes Google.");
    if (current.status !== "active" || !current.credentialsReady) throw new HttpError(409, "mailbox_not_connected", "Liga novamente esta mailbox ao Google antes de ativar envios.");
    if (!current.dnsReady) throw new HttpError(409, "mailbox_dns_not_ready", "SPF, DKIM, DMARC e MX têm de passar antes de ativar envios.");
    if (current.email.toLowerCase().startsWith("maria@") && !(patch.adminExceptionRecorded || current.adminExceptionRecorded)) {
      throw new HttpError(409, "privileged_mailbox_exception_required", "A mailbox Maria exige remoção do papel Super Admin ou uma exceção de segurança formalmente registada.");
    }
  }
}

export async function updateMailbox(actor: Actor, mailboxId: string, raw: unknown) {
  const input = mailboxPatchSchema.parse(raw);
  if (Object.keys(input).length === 0) throw new HttpError(400, "mailbox_patch_empty", "Não foi indicada nenhuma alteração.");
  return transaction(async (client) => {
    const currentResult = await client.query<{
      provider: string; email: string; status: string; send_enabled: boolean; daily_limit: number; ramp_daily_limit: number;
      settings: Record<string, unknown>; credentials_ready: boolean; dns_ready: boolean;
    }>(`
      select m.provider::text,m.email::text,m.status::text,m.send_enabled,m.daily_limit,m.ramp_daily_limit,m.settings,
             exists(select 1 from private.outreach_credentials credentials where credentials.mailbox_id=m.id) credentials_ready,
             coalesce((select dns.spf_status='pass' and dns.dkim_status='pass' and dns.dmarc_status='pass' and dns.mx_status='pass'
                       from public.outreach_dns_checks dns where dns.mailbox_id=m.id order by dns.checked_at desc limit 1),false) dns_ready
      from public.outreach_mailboxes m where m.id=$1 for update`, [mailboxId]);
    const current = currentResult.rows[0];
    if (!current) throw new HttpError(404, "mailbox_not_found", "Mailbox não encontrada.");
    const mailboxSettings = current.settings && typeof current.settings === "object" ? current.settings : {};
    validateMailboxRamp({
      provider: current.provider,
      email: current.email,
      status: current.status,
      sendEnabled: current.send_enabled,
      dailyLimit: current.daily_limit,
      rampDailyLimit: current.ramp_daily_limit,
      dnsReady: current.dns_ready,
      credentialsReady: current.credentials_ready,
      adminExceptionRecorded: mailboxSettings.adminExceptionRecorded === true,
    }, input);

    const nextSettings = {
      ...mailboxSettings,
      ...(input.adminExceptionRecorded !== undefined ? { adminExceptionRecorded: input.adminExceptionRecorded } : {}),
    };
    const updated = await client.query(`
      update public.outreach_mailboxes set
        display_name=coalesce($2,display_name),
        owner_profile_id=case when $3::boolean then $4::uuid else owner_profile_id end,
        daily_limit=coalesce($5,daily_limit),
        timezone=coalesce($6,timezone),
        send_enabled=coalesce($7,send_enabled),
        settings=$8::jsonb
      where id=$1 returning id`, [
      mailboxId,
      input.displayName ?? null,
      input.ownerProfileId !== undefined,
      input.ownerProfileId ?? null,
      input.dailyLimit ?? null,
      input.timezone ?? null,
      input.sendEnabled ?? null,
      JSON.stringify(nextSettings),
    ]);
    await client.query(`insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details) values($1,'mailbox.updated','mailbox',$2,$3::jsonb)`, [actor.id, mailboxId, JSON.stringify({ ...input, adminExceptionRecorded: input.adminExceptionRecorded ? true : undefined })]);
    return { id: updated.rows[0].id };
  }, "serializable");
}

export async function advanceMailboxRamp(actor: Actor, mailboxId: string) {
  const result = await pool.query<{ id: string; daily_limit: number; ramp_daily_limit: number }>(
    `select (private.outreach_advance_mailbox_ramp($1,$2)).*`,
    [mailboxId, actor.id],
  );
  const mailbox = result.rows[0];
  if (!mailbox) throw new HttpError(404, "mailbox_not_found", "Mailbox não encontrada.");
  return {
    id: mailbox.id,
    dailyLimit: Math.min(Number(mailbox.daily_limit), Number(mailbox.ramp_daily_limit)),
    configuredDailyLimit: Number(mailbox.daily_limit),
    rampDailyLimit: Number(mailbox.ramp_daily_limit),
  };
}

export async function revokeMailboxAuthorizationBestEffort(mailboxId: string) {
  try {
    return await revokeProviderAuthorization(await providerSession(mailboxId));
  } catch {
    // Local disconnect remains authoritative even when the provider is down or
    // the token was already revoked. Never log or return credential material.
    return { supported: true, revoked: false } as const;
  }
}

export async function disconnectMailbox(actor: Actor, mailboxId: string) {
  // Capture the credential only after the reconciliation blocker has passed,
  // while the exclusive DB permit prevents a new provider call. The provider
  // is still contacted only after the authoritative local cut commits.
  let revocationSession: Awaited<ReturnType<typeof providerSession>> | null = null;
  await transaction(async (client) => {
    await client.query(`select pg_advisory_xact_lock(20260930,1)`);
    const mailbox = await client.query<{ id: string }>(`
      select id from public.outreach_mailboxes where id=$1 for update`, [mailboxId]);
    if (!mailbox.rows[0]) throw new HttpError(404, "mailbox_not_found", "Mailbox não encontrada.");
    // A provider grant is evidence needed to reconcile a request that may
    // already have been accepted. Refuse the disconnect before any local
    // mutation so neither the credential nor the external grant is lost.
    await assertMailboxReconciliationClear(client, mailboxId);
    try {
      revocationSession = await providerSession(mailboxId, client);
    } catch {
      // A missing/expired credential must never prevent the authoritative
      // local disconnect. Provider revocation remains a best-effort follow-up.
    }
    // Any callback still in flight must fail its final state-bound check. This
    // prevents a consent page opened before disconnect from reconnecting the
    // mailbox after the administrator has explicitly cut authorization.
    await client.query(`delete from private.outreach_oauth_states where mailbox_id=$1`, [mailboxId]);
    await client.query(`delete from private.outreach_credentials where mailbox_id=$1`, [mailboxId]);
    await client.query(`
      update public.outreach_mailboxes
      set status='disconnected',send_enabled=false,last_error=null,updated_at=now()
      where id=$1`, [mailboxId]);
    await client.query(`
      update public.outreach_jobs
      set status='cancelled',lease_owner=null,lease_expires_at=null,
          last_error='mailbox_disconnected_before_dispatch',updated_at=now()
      where mailbox_id=$1 and status='pending'`, [mailboxId]);
    await client.query(`
      update public.outreach_jobs job
      set status='reconciliation_required',lease_owner=null,lease_expires_at=null,
          last_error='mailbox_disconnected_during_lease',updated_at=now()
      where job.mailbox_id=$1 and job.status='leased'
        and exists (
          select 1 from private.outreach_delivery_ledger ledger
          where ledger.job_id=job.id
            and ledger.status in ('sending','accepted','ambiguous')
        )`, [mailboxId]);
    await client.query(`
      update public.outreach_jobs job
      set status='cancelled',lease_owner=null,lease_expires_at=null,
          last_error='mailbox_disconnected_before_dispatch',updated_at=now()
      where job.mailbox_id=$1 and job.status='leased'
        and not exists (
          select 1 from private.outreach_delivery_ledger ledger
          where ledger.job_id=job.id
            and ledger.status in ('sending','accepted','ambiguous')
        )`, [mailboxId]);
    await client.query(`
      insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details)
      values($1,'mailbox.oauth.disconnected','mailbox',$2,$3::jsonb)`, [
      actor.id,
      mailboxId,
      JSON.stringify({ providerRevocationScheduled: revocationSession !== null }),
    ]);
  }, "serializable");
  let providerRevocation: { supported: boolean; revoked: boolean } = { supported: true, revoked: false };
  if (revocationSession) {
    try {
      providerRevocation = await revokeProviderAuthorization(revocationSession);
    } catch {
      // The local disconnect has already committed and remains authoritative.
    }
  }
  await pool.query(`
    insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details)
    values($1,'mailbox.oauth.revocation_result','mailbox',$2,$3::jsonb)`, [
    actor.id,
    mailboxId,
    JSON.stringify({ providerRevocationSupported: providerRevocation.supported, providerRevoked: providerRevocation.revoked }),
  ]);
  return { id: mailboxId, disconnected: true, providerRevoked: providerRevocation.revoked };
}

export async function recordDnsCheck(actor: Actor, mailboxId: string, selector = "google") {
  const mailbox = await pool.query<{ email: string }>(`select email::text from public.outreach_mailboxes where id=$1`, [mailboxId]);
  if (!mailbox.rows[0]) throw new HttpError(404, "mailbox_not_found", "Mailbox não encontrada.");
  const domain = mailbox.rows[0].email.split("@")[1];
  if (!domain) throw new HttpError(409, "mailbox_email_invalid", "A mailbox não tem um domínio válido.");
  const checked = await inspectDomain(domain, selector);
  const status = (value: string) => value === "pass" ? "pass" : value === "missing" ? "fail" : "warn";
  await transaction(async (client) => {
    await client.query(`insert into public.outreach_dns_checks(mailbox_id,domain,spf_status,dkim_status,dmarc_status,mx_status,details,checked_at) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [mailboxId, domain, status(checked.spf.status), status(checked.dkim.status), status(checked.dmarc.status), status(checked.mx.status), JSON.stringify(checked), checked.checkedAt]);
    await audit(actor.id, "mailbox.dns.checked", "mailbox", mailboxId, { domain }, client);
  });
  return checked;
}

export async function verifyContacts(actor: Actor, raw: unknown) {
  const input = z.object({ contactIds: z.array(uuid).min(1).max(100) }).parse(raw);
  const contacts = await pool.query<{ id: string; email: string | null; prior_valid: boolean; owned_mailbox_history: boolean }>(`
    select c.id,c.email::text,
      private.outreach_has_owned_mailbox_email(c.id,c.email::text) owned_mailbox_history,
      coalesce(latest.status='valid' and (latest.expires_at is null or latest.expires_at>now()),false) prior_valid
    from public.contactos c
    left join lateral (
      select v.status,v.expires_at from public.outreach_email_verifications v
      where v.email=c.email
      order by v.verified_at desc nulls last,v.created_at desc,v.id desc limit 1
    ) latest on true
    where c.id=any($1::uuid[])`, [input.contactIds]);
  const items: Array<{ contactId: string; email: string | null; status: string; reason: string; [key: string]: unknown }> = [];
  for (const contact of contacts.rows) {
    if (!contact.email) {
      items.push({ contactId: contact.id, email: null, status: "invalid", reason: "Sem email." });
      continue;
    }
    if (contact.owned_mailbox_history) {
      items.push({ contactId: contact.id, email: contact.email, status: "exempt", reason: "Dispensado: mensagem enviada ou recebida numa conta ligada ao CRM." });
      continue;
    }
    const verification = await verifyEmailAddress(contact.email);
    if (verification.status === "unknown" && contact.prior_valid) {
      items.push({ contactId: contact.id, email: contact.email, status: "valid", reason: "A análise DNS não confirma a caixa; mantém-se a prova anterior ainda válida.", retainedEvidence: true });
      continue;
    }
    const dbStatus = verification.status === "verified" ? "valid" : verification.status;
    items.push({ contactId: contact.id, ...verification, status: dbStatus });
  }
  await transaction(async (client) => {
    for (const item of items) {
      if (!item.email || item.retainedEvidence || item.status === "exempt") continue;
      await client.query(`insert into public.outreach_email_verifications(contact_id,email,status,provider,reasons,verified_at,expires_at) values($1,$2,$3,'dns_syntax',$4,now(),now()+interval '30 days')`, [item.contactId, item.email, item.status, [item.reason]]);
    }
    await audit(actor.id, "contacts.verified", "contact", null, { count: items.filter((item) => item.status !== "exempt").length, exemptCount: items.filter((item) => item.status === "exempt").length }, client);
  });
  return { items };
}

export async function recordEmailVerificationEvidence(actor: Actor, raw: unknown) {
  if (actor.crmRole !== "admin") {
    throw new HttpError(403, "admin_required", "Só um administrador pode validar uma mailbox por evidência externa.");
  }
  const input = z.object({
    contactId: uuid,
    result: z.literal("valid"),
    source: z.enum(["provider_mailbox_validation", "mailbox_challenge", "documented_consent"]),
    reference: z.string().trim().min(8).max(500),
    expiresAt: z.iso.datetime(),
  }).strict().parse(raw);
  const expiresAt = new Date(input.expiresAt);
  const now = Date.now();
  if (expiresAt.getTime() <= now || expiresAt.getTime() > now + 90 * 86_400_000) {
    throw new HttpError(400, "verification_expiry_invalid", "A validade da prova tem de terminar nos próximos 90 dias.");
  }
  const referenceSha256 = createHash("sha256").update(input.reference).digest("hex");
  return transaction(async (client) => {
    const contact = await client.query<{ id: string; email: string | null }>(
      // outreach_service has SELECT, but intentionally no UPDATE privilege on
      // CRM contacts. FOR SHARE requires that extra privilege in PostgreSQL.
      // The evidence is tied to the selected email; final eligibility checks
      // the current contact email again before dispatch.
      `select id,email::text from public.contactos where id=$1`,
      [input.contactId],
    );
    const row = contact.rows[0];
    if (!row) throw new HttpError(404, "contact_not_found", "Contacto não encontrado.");
    if (!row.email) throw new HttpError(409, "contact_email_missing", "O contacto não tem email para validar.");
    const inserted = await client.query<{ id: string }>(`
      insert into public.outreach_email_verifications(
        contact_id,email,status,provider,reasons,verified_at,expires_at,
        evidence_reference,verified_by
      ) values($1,$2,'valid',$3,'{}'::text[],now(),$4,$5,$6)
      returning id`, [row.id, row.email, input.source, expiresAt, input.reference, actor.id]);
    const id = inserted.rows[0]?.id;
    if (!id) throw new HttpError(500, "verification_not_recorded", "Não foi possível registar a prova de validação.");
    await audit(actor.id, "contact.verification.evidence_recorded", "contact", row.id, {
      verificationId: id,
      source: input.source,
      result: input.result,
      expiresAt: expiresAt.toISOString(),
      referenceSha256,
    }, client);
    return { id, contactId: row.id, email: row.email, status: "valid" as const, source: input.source, expiresAt: expiresAt.toISOString() };
  }, "serializable");
}

export async function updateThread(actor: Actor, threadId: string, action: "classify" | "archive" | "assign", raw: unknown) {
  const canHandleAny = actor.crmRole === "admin" || actor.outreachRole === "campaign_manager";
  let query: string;
  let values: unknown[];
  if (action === "classify") {
    const input = z.object({ classification: z.enum(["positive", "question", "objection", "negative", "auto_reply", "unclassified"]) }).parse(raw);
    query = canHandleAny
      ? `update public.outreach_threads set classification=$2,unread=false where id=$1 returning id`
      : `update public.outreach_threads set classification=$2,unread=false where id=$1 and assigned_to=$3 returning id`;
    values = canHandleAny ? [threadId, input.classification] : [threadId, input.classification, actor.id];
  } else if (action === "archive") {
    query = canHandleAny
      ? `update public.outreach_threads set status='archived',unread=false where id=$1 returning id`
      : `update public.outreach_threads set status='archived',unread=false where id=$1 and assigned_to=$2 returning id`;
    values = canHandleAny ? [threadId] : [threadId, actor.id];
  } else {
    const input = z.object({ profileId: uuid.nullable() }).parse(raw);
    query = `update public.outreach_threads set assigned_to=$2 where id=$1 returning id`;
    values = [threadId, input.profileId];
  }
  return transaction(async (client) => {
    const result = await client.query(query, values);
    if (!result.rows[0]) throw new HttpError(404, "thread_not_found", "Conversa não encontrada ou não atribuída a ti.");
    await audit(actor.id, `thread.${action}`, "thread", threadId, raw, client);
    return { id: threadId };
  }, "serializable");
}

const suppressionSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("email"), email: z.email(), reason: z.enum(["unsubscribe", "hard_bounce", "complaint", "manual", "legal", "contact_deleted"]).default("manual"), note: z.string().max(2_000).default("") }),
  z.object({ scope: z.literal("domain"), domain: z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i), reason: z.enum(["unsubscribe", "hard_bounce", "complaint", "manual", "legal", "contact_deleted"]).default("manual"), note: z.string().max(2_000).default("") }),
  z.object({ scope: z.literal("company"), companyId: uuid, reason: z.enum(["unsubscribe", "hard_bounce", "complaint", "manual", "legal", "contact_deleted"]).default("manual"), note: z.string().max(2_000).default("") }),
]);

export async function createSuppressionWithClient(client: import("pg").PoolClient, actor: Actor | null, raw: unknown, source = "outreach") {
  const input = suppressionSchema.parse(raw);
  const identityValue = input.scope === "email" ? input.email : input.scope === "domain" ? input.domain : input.companyId;
  const inserted = await client.query<{ id: string }>(`
      insert into public.communication_suppressions(scope,email,domain,company_id,identity_hmac,reason,source,note,created_by)
      values($1,$2,$3,$4,null,$5,$6,$7,$8) on conflict(scope,identity_hmac) where active and identity_hmac is not null
      do update set reason=excluded.reason,source=excluded.source,note=excluded.note returning id`,
      [input.scope, input.scope === "email" ? input.email.toLowerCase() : null, input.scope === "domain" ? input.domain.toLowerCase() : null, input.scope === "company" ? input.companyId : null, input.reason, source, input.note, actor?.id ?? null],
    );
    const recipientWhere = input.scope === "email" ? "lower(r.email_snapshot::text)=lower($2)" : input.scope === "domain" ? "split_part(lower(r.email_snapshot::text),'@',2)=lower($2)" : "r.company_id=$2::uuid";
    await client.query(`update public.outreach_recipients r set status='suppressed',unsubscribed_at=case when $3='unsubscribe' then now() else unsubscribed_at end where ${recipientWhere} and status not in ('deleted','completed')`, [input.scope, identityValue, input.reason]);
    await client.query(`
      update public.outreach_jobs j
      set status=case
            when j.status='reconciliation_required' or exists (
              select 1 from private.outreach_delivery_ledger ledger
              where ledger.job_id=j.id
                and ledger.status in ('sending','accepted','ambiguous')
            ) then 'reconciliation_required'::public.outreach_job_status
            else 'cancelled'::public.outreach_job_status
          end,
          lease_owner=null,lease_expires_at=null,last_error='global_suppression',updated_at=now()
      from public.outreach_recipients r
      where j.recipient_id=r.id and ${recipientWhere}
        and j.status in ('pending','leased','reconciliation_required')`, [input.scope, identityValue]);
    // `outreach_service` deliberately has read-only access to CRM contacts.
    // The SECURITY DEFINER suppression trigger is the single authority that
    // mirrors an email suppression into contactos.optout.
    await client.query(`insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details) values($1,'suppression.created','suppression',$2,$3::jsonb)`, [actor?.id ?? null, inserted.rows[0]!.id, JSON.stringify({ scope: input.scope, reason: input.reason, source })]);
  return { id: inserted.rows[0]!.id };
}

export async function createSuppression(actor: Actor | null, raw: unknown, source = "outreach") {
  return transaction((client) => createSuppressionWithClient(client, actor, raw, source), "serializable");
}

export async function deactivateSuppression(actor: Actor, id: string) {
  return transaction(async (client) => {
    const result = await client.query(`update public.communication_suppressions set active=false,deactivated_by=$2,deactivated_at=now() where id=$1 and active returning id`, [id, actor.id]);
    if (!result.rows[0]) throw new HttpError(404, "suppression_not_found", "Supressão ativa não encontrada.");
    await audit(actor.id, "suppression.deactivated", "suppression", id, {}, client);
    return { id };
  }, "serializable");
}

export async function updateSystemSettings(actor: Actor, raw: unknown) {
  const input = z.object({
    profileId: uuid.optional(),
    outreachRole: z.enum(["viewer", "sales_rep", "campaign_manager"]).optional(),
    workspaceName: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
    defaultDailyLimit: z.number().int().min(1).max(500).optional(),
    bounceWarningThreshold: z.number().min(0).max(100).optional(),
    bouncePauseThreshold: z.number().min(0.01).max(100).optional(),
    complaintPauseThreshold: z.number().min(0.01).max(100).optional(),
    trackingOpens: z.boolean().optional(),
    trackingClicks: z.boolean().optional(),
  }).strict().parse(raw);
  if ((input.profileId && !input.outreachRole) || (!input.profileId && input.outreachRole)) {
    throw new HttpError(400, "role_update_invalid", "Indica profileId e outreachRole.");
  }
  if (input.trackingOpens || input.trackingClicks) {
    throw new HttpError(409, "tracking_disabled", "Open e click tracking permanecem desligados no rollout inicial.");
  }

  const operationalEntries = Object.entries({
    workspaceName: input.workspaceName,
    timezone: input.timezone,
    defaultDailyLimit: input.defaultDailyLimit,
    bounceWarningThreshold: input.bounceWarningThreshold,
    bouncePauseThreshold: input.bouncePauseThreshold,
    complaintPauseThreshold: input.complaintPauseThreshold,
  }).filter((entry): entry is [string, string | number] => entry[1] !== undefined);
  if (!input.profileId && operationalEntries.length === 0) {
    throw new HttpError(400, "settings_patch_empty", "Não foi indicada nenhuma definição editável.");
  }

  return transaction(async (client) => {
    const changed: Record<string, unknown> = {};
    if (input.profileId && input.outreachRole) {
      const updated = await client.query<{ id: string; outreach_role: string }>(
        `select (private.outreach_update_profile_role($1,$2,$3)).*`,
        [actor.id, input.profileId, input.outreachRole],
      );
      if (!updated.rows[0]) throw new HttpError(404, "profile_not_found", "Utilizador ativo não encontrado.");
      changed.profileId = updated.rows[0].id;
      changed.outreachRole = updated.rows[0].outreach_role;
    }

    if (operationalEntries.length) {
      const patch = Object.fromEntries(operationalEntries);
      const updated = await client.query<{ settings: Record<string, unknown> }>(
        `select (private.outreach_update_settings($1,$2::jsonb)).*`,
        [actor.id, JSON.stringify(patch)],
      );
      changed.settings = updated.rows[0]?.settings ?? patch;
    }
    return changed;
  }, "serializable");
}

export async function ignoreInboundReconciliation(actor: Actor, reconciliationId: string) {
  return transaction(async (client) => {
    const result = await client.query<{ id: string; status: "ignored"; mailbox_id: string; kind: string; error: string }>(`
      update private.outreach_inbound_reconciliation
      set status='ignored',resolved_at=null
      where id=$1 and status='reconciliation_required'
      returning id,status::text,mailbox_id,kind::text,error`, [reconciliationId]);
    const item = result.rows[0];
    if (!item) throw new HttpError(404, "inbound_reconciliation_not_found", "Evento inbound pendente não encontrado.");
    await audit(actor.id, "inbound.reconciliation.ignored", "inbound_reconciliation", item.id, {
      mailboxId: item.mailbox_id,
      kind: item.kind,
      error: item.error,
    }, client);
    return { id: item.id, status: item.status };
  }, "serializable");
}

const jobAdjudicationSchema = z.object({
  outcome: z.enum(["cancelled", "confirmed_sent"]),
  reason: z.string().trim().min(8).max(500),
  evidence: z.string().trim().min(8).max(2_000),
  providerMessageId: z.string().trim().min(1).max(998).optional(),
}).strict().superRefine((value, context) => {
  if (value.outcome === "confirmed_sent" && !value.providerMessageId) {
    context.addIssue({
      code: "custom",
      path: ["providerMessageId"],
      message: "Uma confirmação de envio exige o providerMessageId comprovado.",
    });
  }
  if (value.outcome === "cancelled" && value.providerMessageId) {
    context.addIssue({
      code: "custom",
      path: ["providerMessageId"],
      message: "Um encerramento sem envio não aceita providerMessageId.",
    });
  }
});

export async function adjudicateJobReconciliation(actor: Actor, jobId: string, raw: unknown) {
  if (actor.crmRole !== "admin") {
    throw new HttpError(403, "admin_required", "Apenas administradores podem adjudicar entregas ambíguas.");
  }
  const input = jobAdjudicationSchema.parse(raw);
  const result = await pool.query<{
    id: string;
    status: "sent" | "cancelled";
    provider_message_id: string | null;
  }>(`
    select (private.outreach_adjudicate_job_reconciliation(
      $1,$2,$3,$4,$5,$6
    )).*`, [
    jobId,
    actor.id,
    input.outcome,
    input.reason,
    input.evidence,
    input.providerMessageId ?? null,
  ]);
  const job = result.rows[0];
  if (!job) throw new HttpError(404, "job_reconciliation_not_found", "Job pendente de reconciliação não encontrado.");
  return {
    id: job.id,
    status: job.status,
    providerMessageId: job.provider_message_id,
    retryAllowed: false,
  };
}

export function deterministicIdempotencyKey(...values: string[]) {
  return createHash("sha256").update(values.join(":"), "utf8").digest("hex");
}
