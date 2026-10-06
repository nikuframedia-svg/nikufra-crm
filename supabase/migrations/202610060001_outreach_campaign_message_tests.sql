-- One-message test campaigns use the ordinary outbound worker and its gates.
-- Keep them out of the main campaign list and make retries idempotent.
alter table public.outreach_campaigns
  add column test_source_campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  add column test_idempotency_key text unique,
  add column test_request_hash text;

create index outreach_campaigns_test_source_idx
  on public.outreach_campaigns(test_source_campaign_id)
  where test_source_campaign_id is not null;

-- Membership is separate from recipients because the same CRM contact may
-- appear in several lists while remaining one campaign recipient.
create table public.outreach_campaign_audiences (
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  audience_id uuid not null references public.outreach_audiences(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (campaign_id, audience_id)
);

insert into public.outreach_campaign_audiences(campaign_id,audience_id)
select distinct recipient.campaign_id,member.audience_id
from public.outreach_recipients recipient
join public.outreach_audience_members member on member.id=recipient.audience_member_id
on conflict do nothing;

alter table public.outreach_campaign_audiences enable row level security;
alter table public.outreach_campaign_audiences force row level security;
create policy outreach_campaign_audiences_service_all on public.outreach_campaign_audiences
  for all to public
  using (current_user in ('service_role','outreach_service'))
  with check (current_user in ('service_role','outreach_service'));
create policy outreach_campaign_audiences_managers_read on public.outreach_campaign_audiences
  for select to authenticated
  using (public.is_admin() or public.has_outreach_capability('manage_campaigns'));
revoke all on public.outreach_campaign_audiences from public, anon, authenticated;
grant select, insert, update, delete on public.outreach_campaign_audiences to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'outreach_service') then
    execute 'grant select, insert, update, delete on public.outreach_campaign_audiences to outreach_service';
  end if;
end $$;
