-- One-time, auditable owner override of the final ramp wait. All other live
-- readiness requirements remain enforced by the existing transition trigger.
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
    cross join public.outreach_system_state state
    where mailbox.id = target_mailbox_id
      and mailbox.provider = 'google'
      and mailbox.status = 'active'
      and mailbox.send_enabled
      and mailbox.ramp_daily_limit >= 10
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
      and state.send_enabled
      and (
        (
          ramp.level_10_at <= now() - interval '48 hours'
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
        )
        or (
          -- Named, time-limited operator override for the three proven
          -- mailboxes. It waives only the final 10-level sample/48h wait.
          mailbox.ramp_daily_limit = 25
          and mailbox.daily_limit >= 25
          and coalesce(state.settings #> '{liveRampOverride,mailboxIds}', '[]'::jsonb) ? mailbox.id::text
          and coalesce(state.settings #>> '{liveRampOverride,reason}', '') = 'owner_explicit_25_daily_2026_11_22'
          and coalesce(nullif(state.settings #>> '{liveRampOverride,approvedAt}', ''), '1970-01-01T00:00:00Z')::timestamptz <= now()
          and coalesce(nullif(state.settings #>> '{liveRampOverride,expiresAt}', ''), '1970-01-01T00:00:00Z')::timestamptz > now()
          and exists (
            select 1 from public.profiles profile
            where profile.id::text = state.settings #>> '{liveRampOverride,approvedBy}'
              and profile.ativo and profile.role = 'admin'
          )
          and (
            select count(*)
            from public.outreach_messages message
            join public.outreach_jobs job
              on job.mailbox_id = message.mailbox_id
             and job.campaign_id = message.campaign_id
             and job.recipient_id = message.recipient_id
             and job.provider_message_id = message.provider_message_id
             and job.status = 'sent'
            where message.mailbox_id = mailbox.id
              and message.direction = 'outbound'
              and message.occurred_at >= now() - interval '14 days'
          ) >= 20
          and not exists (
            select 1 from public.outreach_messages incident
            where incident.mailbox_id = mailbox.id
              and incident.kind in ('hard_bounce','complaint')
              and incident.occurred_at >= now() - interval '14 days'
          )
        )
      )
  );
$$;
