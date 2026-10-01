begin;

-- Campaign delivery scope is explicit. A globally healthy mailbox is not
-- permission for every campaign to use it.
create table public.outreach_campaign_mailboxes (
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  mailbox_id uuid not null references public.outreach_mailboxes(id) on delete cascade,
  selected_by uuid references public.profiles(id) on delete set null,
  selected_at timestamptz not null default now(),
  primary key (campaign_id, mailbox_id)
);

create index outreach_campaign_mailboxes_mailbox_idx
  on public.outreach_campaign_mailboxes(mailbox_id, campaign_id);

-- Selection is part of final provider eligibility, so it participates in the
-- same writer/shared-permit protocol as suppressions, recipients and DNS.
-- Statement level avoids taking row locks before waiting for the advisory
-- writer lock and therefore preserves the protocol's lock ordering.
create trigger a_outreach_send_gate_campaign_mailbox_writer
before insert or update or delete on public.outreach_campaign_mailboxes
for each statement execute function private.outreach_lock_send_gate_writer();

-- Preserve only associations demonstrated by durable jobs. Campaigns that
-- never dispatched remain intentionally unassigned and therefore blocked.
insert into public.outreach_campaign_mailboxes(campaign_id, mailbox_id, selected_by, selected_at)
select distinct job.campaign_id, job.mailbox_id, campaign.created_by,
       coalesce(campaign.launched_at, campaign.created_at)
from public.outreach_jobs job
join public.outreach_campaigns campaign on campaign.id=job.campaign_id
where job.mailbox_id is not null
on conflict do nothing;

-- Keep the mature eligibility implementation as an inaccessible inner
-- decision, then add campaign delivery scope to the single decision consumed
-- by shadow evaluation, claiming, reservation and the final provider permit.
-- Renaming rather than copying the large function also keeps future fixes in
-- one place; callers resolve the public private-schema name to this wrapper.
alter function private.outreach_recipient_eligibility(uuid, uuid, timestamptz)
  rename to outreach_recipient_eligibility_without_campaign_scope;

create function private.outreach_recipient_eligibility(
  target_recipient_id uuid,
  target_mailbox_id uuid,
  eligibility_time timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  decision jsonb;
  target_campaign_id uuid;
begin
  decision := private.outreach_recipient_eligibility_without_campaign_scope(
    target_recipient_id,
    target_mailbox_id,
    eligibility_time
  );

  -- Existing installations may have the pre-freshness-boundary version of
  -- the inner function. Reassert the exact launch rule here: the latest check
  -- must be wholly inside the previous 24 hours, with all four signals green.
  if not coalesce((
    select dns.spf_status='pass'
      and dns.dkim_status='pass'
      and dns.dmarc_status='pass'
      and dns.mx_status='pass'
      and dns.checked_at > eligibility_time - interval '24 hours'
    from public.outreach_dns_checks dns
    where dns.mailbox_id=target_mailbox_id
    order by dns.checked_at desc, dns.id desc
    limit 1
  ), false) and not (coalesce(decision -> 'reasons', '[]'::jsonb) ? 'dns_not_ready') then
    decision := jsonb_set(
      decision,
      '{reasons}',
      coalesce(decision -> 'reasons', '[]'::jsonb)
        || jsonb_build_array('dns_not_ready'),
      true
    );
    decision := jsonb_set(decision, '{eligible}', 'false'::jsonb, true);
  end if;

  select recipient.campaign_id
  into target_campaign_id
  from public.outreach_recipients recipient
  where recipient.id=target_recipient_id;

  if target_campaign_id is not null and not exists (
    select 1
    from public.outreach_campaign_mailboxes selection
    where selection.campaign_id=target_campaign_id
      and selection.mailbox_id=target_mailbox_id
  ) then
    decision := jsonb_set(
      decision,
      '{reasons}',
      coalesce(decision -> 'reasons', '[]'::jsonb)
        || jsonb_build_array('campaign_mailbox_not_selected'),
      true
    );
    decision := jsonb_set(decision, '{eligible}', 'false'::jsonb, true);
  end if;

  return decision;
end;
$$;

comment on function private.outreach_recipient_eligibility(uuid, uuid, timestamptz)
  is 'Authoritative send eligibility, including explicit campaign-to-mailbox scope.';

revoke all on function private.outreach_recipient_eligibility_without_campaign_scope(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.outreach_recipient_eligibility(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function private.outreach_recipient_eligibility(uuid, uuid, timestamptz)
  to service_role;

alter table public.outreach_campaign_mailboxes enable row level security;
alter table public.outreach_campaign_mailboxes force row level security;

create policy outreach_campaign_mailboxes_service_all
on public.outreach_campaign_mailboxes
for all to public
using (current_user in ('service_role', 'outreach_service'))
with check (current_user in ('service_role', 'outreach_service'));

create policy outreach_campaign_mailboxes_managers_read
on public.outreach_campaign_mailboxes
for select to authenticated
using (public.is_admin() or public.has_outreach_capability('manage_campaigns'));

revoke all on public.outreach_campaign_mailboxes from public, anon, authenticated;
grant select, insert, update, delete on public.outreach_campaign_mailboxes to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname='outreach_service') then
    execute 'grant select, insert, update, delete on public.outreach_campaign_mailboxes to outreach_service';
    execute 'revoke all on function private.outreach_recipient_eligibility_without_campaign_scope(uuid, uuid, timestamptz) from outreach_service';
    execute 'grant execute on function private.outreach_recipient_eligibility(uuid, uuid, timestamptz) to outreach_service';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
