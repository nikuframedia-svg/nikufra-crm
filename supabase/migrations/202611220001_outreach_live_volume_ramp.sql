-- Continue the mailbox ramp after the guarded canary -> live transition.
-- The configured daily limit is still a separate ceiling: effective capacity
-- remains least(daily_limit, ramp_daily_limit).
alter table public.outreach_mailboxes
  drop constraint outreach_mailboxes_ramp_daily_limit_check;
alter table public.outreach_mailboxes
  add constraint outreach_mailboxes_ramp_daily_limit_check
  check (ramp_daily_limit in (1, 3, 5, 10, 15, 20, 25));

create or replace function private.outreach_advance_mailbox_live_ramp(
  target_mailbox_id uuid,
  actor_id uuid
)
returns public.outreach_mailboxes
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  mailbox_record public.outreach_mailboxes%rowtype;
  state_record public.outreach_system_state%rowtype;
  next_level integer;
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = actor_id and profile.ativo and profile.role = 'admin'
  ) then
    raise exception 'Apenas administradores podem avançar o ramp da mailbox';
  end if;

  select * into state_record
  from public.outreach_system_state
  where id
  for share;
  if state_record.id is null or state_record.mode <> 'live'
     or not state_record.send_enabled or state_record.approved_at is null then
    raise exception 'Ramp de volume exige Outreach live ativo';
  end if;

  select * into mailbox_record
  from public.outreach_mailboxes
  where id = target_mailbox_id
  for update;
  if mailbox_record.id is null then
    raise exception 'Mailbox não encontrada';
  end if;
  if mailbox_record.provider <> 'google' or mailbox_record.status <> 'active'
     or not mailbox_record.send_enabled then
    raise exception 'Ramp exige mailbox Google ativa para envio';
  end if;
  if mailbox_record.ramp_daily_limit = 25 then
    return mailbox_record;
  end if;
  if mailbox_record.ramp_daily_limit not in (10, 15, 20) then
    raise exception 'Ramp live exige patamar inicial 10, 15 ou 20';
  end if;
  if mailbox_record.daily_limit < mailbox_record.ramp_daily_limit + 5 then
    raise exception 'Limite diário configurado inferior ao próximo patamar';
  end if;
  if mailbox_record.ramp_started_at > now() - interval '48 hours'
     or state_record.approved_at > now() - interval '48 hours'
     or mailbox_record.last_incident_at > mailbox_record.ramp_started_at
     or state_record.last_incident_at > greatest(mailbox_record.ramp_started_at, state_record.approved_at) then
    raise exception 'Ramp exige 48 horas completas sem incidentes no patamar live';
  end if;
  if not exists (
    select 1 from public.outreach_dns_checks dns
    where dns.mailbox_id = target_mailbox_id
      and dns.checked_at >= now() - interval '24 hours'
      and dns.spf_status = 'pass' and dns.dkim_status = 'pass'
      and dns.dmarc_status = 'pass' and dns.mx_status = 'pass'
      and not exists (
        select 1 from public.outreach_dns_checks newer
        where newer.mailbox_id = dns.mailbox_id
          and newer.checked_at > dns.checked_at
      )
  ) then
    raise exception 'Ramp exige DNS recente e válido';
  end if;
  if exists (
    select 1 from public.outreach_messages message
    where message.kind in ('hard_bounce', 'complaint')
      and message.occurred_at > greatest(mailbox_record.ramp_started_at, state_record.approved_at)
  ) or exists (
    select 1 from public.outreach_jobs job
    where job.status in ('failed', 'reconciliation_required')
      and job.updated_at > greatest(mailbox_record.ramp_started_at, state_record.approved_at)
  ) then
    raise exception 'Ramp bloqueado por incidentes de entrega recentes';
  end if;
  if not exists (
    select 1
    from public.outreach_messages message
    join public.outreach_jobs job
      on job.mailbox_id = message.mailbox_id
     and job.campaign_id = message.campaign_id
     and job.recipient_id = message.recipient_id
     and job.provider_message_id = message.provider_message_id
     and job.status = 'sent'
    where message.mailbox_id = target_mailbox_id
      and message.direction = 'outbound'
      and message.occurred_at >= greatest(mailbox_record.ramp_started_at, state_record.approved_at)
      and message.occurred_at <= now()
  ) then
    raise exception 'Ramp exige pelo menos um envio confirmado no patamar live atual';
  end if;

  next_level := mailbox_record.ramp_daily_limit + 5;
  update public.outreach_mailboxes
  set ramp_daily_limit = next_level,
      ramp_started_at = now(),
      updated_at = now()
  where id = target_mailbox_id
  returning * into mailbox_record;

  insert into public.outreach_audit_log(
    actor_id, action, entity_type, entity_id, details
  ) values (
    actor_id, 'mailbox_live_ramp_advanced', 'mailbox', target_mailbox_id,
    jsonb_build_object('daily_limit', next_level)
  );
  return mailbox_record;
end;
$$;

revoke all on function private.outreach_advance_mailbox_live_ramp(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.outreach_advance_mailbox_live_ramp(uuid, uuid)
  to service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'outreach_service') then
    grant execute on function private.outreach_advance_mailbox_live_ramp(uuid, uuid)
      to outreach_service;
  end if;
end $$;

-- Re-enabling a mailbox after ramp 10 still relies on its completed canary
-- proof. The current live ramp clock may be newer than the level-10 proof.
create or replace function private.outreach_mailbox_live_ready(
  target_mailbox_id uuid,
  current_canary_started_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = private, public, pg_temp
as $$
  with ramp_audit as (
    select
      min(created_at) filter (where (details ->> 'daily_limit')::integer = 3) level_3_at,
      min(created_at) filter (where (details ->> 'daily_limit')::integer = 5) level_5_at,
      min(created_at) filter (where (details ->> 'daily_limit')::integer = 10) level_10_at
    from public.outreach_audit_log
    where action = 'mailbox_ramp_advanced'
      and entity_type = 'mailbox'
      and entity_id = target_mailbox_id
      and created_at >= current_canary_started_at
  ), latest_dns as (
    select dns.*
    from public.outreach_dns_checks dns
    where dns.mailbox_id = target_mailbox_id
    order by dns.checked_at desc
    limit 1
  )
  select exists (
    select 1
    from public.outreach_mailboxes mailbox
    cross join ramp_audit ramp
    cross join latest_dns dns
    where mailbox.id = target_mailbox_id
      and mailbox.provider = 'google'
      and mailbox.status = 'active'
      and mailbox.send_enabled
      and mailbox.ramp_daily_limit >= 10
      and ramp.level_10_at <= now() - interval '48 hours'
      and dns.checked_at >= now() - interval '24 hours'
      and dns.spf_status = 'pass' and dns.dkim_status = 'pass'
      and dns.dmarc_status = 'pass' and dns.mx_status = 'pass'
      and ramp.level_3_at is not null
      and ramp.level_5_at is not null
      and ramp.level_10_at is not null
      and current_canary_started_at < ramp.level_3_at
      and ramp.level_3_at < ramp.level_5_at
      and ramp.level_5_at < ramp.level_10_at
      and exists (
        select 1 from public.outreach_messages message
        join public.outreach_jobs job
          on job.mailbox_id = message.mailbox_id
         and job.campaign_id = message.campaign_id
         and job.recipient_id = message.recipient_id
         and job.provider_message_id = message.provider_message_id
         and job.status = 'sent'
        where message.mailbox_id = mailbox.id and message.direction = 'outbound'
          and message.occurred_at >= current_canary_started_at
          and message.occurred_at < ramp.level_3_at
      )
      and exists (
        select 1 from public.outreach_messages message
        join public.outreach_jobs job
          on job.mailbox_id = message.mailbox_id
         and job.campaign_id = message.campaign_id
         and job.recipient_id = message.recipient_id
         and job.provider_message_id = message.provider_message_id
         and job.status = 'sent'
        where message.mailbox_id = mailbox.id and message.direction = 'outbound'
          and message.occurred_at >= ramp.level_3_at
          and message.occurred_at < ramp.level_5_at
      )
      and exists (
        select 1 from public.outreach_messages message
        join public.outreach_jobs job
          on job.mailbox_id = message.mailbox_id
         and job.campaign_id = message.campaign_id
         and job.recipient_id = message.recipient_id
         and job.provider_message_id = message.provider_message_id
         and job.status = 'sent'
        where message.mailbox_id = mailbox.id and message.direction = 'outbound'
          and message.occurred_at >= ramp.level_5_at
          and message.occurred_at < ramp.level_10_at
      )
      and exists (
        select 1 from public.outreach_messages message
        join public.outreach_jobs job
          on job.mailbox_id = message.mailbox_id
         and job.campaign_id = message.campaign_id
         and job.recipient_id = message.recipient_id
         and job.provider_message_id = message.provider_message_id
         and job.status = 'sent'
        where message.mailbox_id = mailbox.id and message.direction = 'outbound'
          and message.occurred_at >= ramp.level_10_at
      )
  );
$$;
