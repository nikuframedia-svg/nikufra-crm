begin;

-- Exact address snapshots from Gmail messages. This private evidence cannot be
-- forged by editing a CRM activity or by changing a contact's email later.
create table private.outreach_owned_mailbox_email_evidence (
  contact_id uuid not null references public.contactos(id) on delete cascade,
  email citext not null,
  mailbox_email citext not null,
  provider_message_id text not null,
  direction text not null check (direction in ('sent', 'received')),
  recorded_at timestamptz not null default now(),
  primary key (contact_id, email, mailbox_email, provider_message_id),
  check (length(trim(provider_message_id)) > 0)
);
create index outreach_owned_mailbox_email_evidence_lookup
  on private.outreach_owned_mailbox_email_evidence(contact_id, email);
create index outreach_messages_contact_recipient_lookup
  on public.outreach_messages(contact_id, recipient_id)
  where contact_id is not null;
revoke all on private.outreach_owned_mailbox_email_evidence from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'outreach_service') then
    revoke all on private.outreach_owned_mailbox_email_evidence from outreach_service;
  end if;
end $$;

-- Legacy CRM Gmail activities were imported before address snapshots existed.
-- Accept only message associations from a connected account whose mailbox
-- matches the activity owner. This one-time migration captures the current
-- address; later edits cannot transfer the exemption to another address.
insert into private.outreach_owned_mailbox_email_evidence(
  contact_id, email, mailbox_email, provider_message_id, direction
)
select distinct on (activity.contacto_id, contact.email, activity.source_mailbox_email, activity.message_id)
  activity.contacto_id, contact.email, activity.source_mailbox_email,
  activity.message_id,
  case when activity.tipo = 'email_recebido' then 'received' else 'sent' end
from public.atividades activity
join public.contactos contact on contact.id = activity.contacto_id
join public.profiles owner on owner.id = activity.user_id
join public.google_tokens token on token.user_id = activity.user_id
where activity.tipo in ('email_enviado', 'email_recebido')
  and activity.message_id is not null
  and activity.source_mailbox_email = owner.email
  and contact.email is not null
order by activity.contacto_id, contact.email, activity.source_mailbox_email,
  activity.message_id, activity.created_at;

-- Only the service-role Gmail importer may assert new evidence. It verifies
-- both the connected account and the contact's current address.
create function public.record_google_email_evidence(
  p_user_id uuid,
  p_contact_id uuid,
  p_email text,
  p_mailbox_email text,
  p_provider_message_id text,
  p_direction text
)
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  if p_direction not in ('sent', 'received')
    or nullif(trim(p_provider_message_id), '') is null
    or not exists (
      select 1 from public.google_tokens token
      join public.profiles owner on owner.id = token.user_id
      where token.user_id = p_user_id
        and owner.email = lower(trim(p_mailbox_email))::citext
    )
    or not exists (
      select 1 from public.contactos contact
      where contact.id = p_contact_id
        and contact.email = lower(trim(p_email))::citext
    ) then
    raise exception 'Invalid connected Gmail evidence';
  end if;

  insert into private.outreach_owned_mailbox_email_evidence(
    contact_id, email, mailbox_email, provider_message_id, direction
  ) values (
    p_contact_id, lower(trim(p_email))::citext,
    lower(trim(p_mailbox_email))::citext, trim(p_provider_message_id), p_direction
  ) on conflict do nothing;
end;
$$;
revoke all on function public.record_google_email_evidence(uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_google_email_evidence(uuid,uuid,text,text,text,text)
  to service_role;

-- A sent or received Outreach message also counts, but only when its stored
-- recipient address still equals the contact's current address.
create function private.outreach_has_owned_mailbox_email(p_contact_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = private, public, pg_temp
as $$
  select p_contact_id is not null and p_email is not null and (
    exists (
      select 1 from private.outreach_owned_mailbox_email_evidence evidence
      where evidence.contact_id = p_contact_id
        and evidence.email = lower(trim(p_email))::citext
    )
    or exists (
      select 1 from public.outreach_messages message
      join public.outreach_recipients recipient on recipient.id = message.recipient_id
      join public.outreach_mailboxes mailbox on mailbox.id = message.mailbox_id
      where message.contact_id = p_contact_id
        and recipient.contact_id = p_contact_id
        and recipient.email_snapshot = lower(trim(p_email))::citext
        and mailbox.provider = 'google'
        and message.direction in ('inbound', 'outbound')
    )
  );
$$;
revoke all on function private.outreach_has_owned_mailbox_email(uuid,text)
  from public, anon, authenticated;
grant execute on function private.outreach_has_owned_mailbox_email(uuid,text)
  to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'outreach_service') then
    grant execute on function private.outreach_has_owned_mailbox_email(uuid,text)
      to outreach_service;
  end if;
end $$;

-- Keep every other authoritative send guard. Remove only the address-check
-- reason when exact, trusted mailbox history exists for this contact/email.
create or replace function private.outreach_recipient_eligibility(
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
  target_contact_id uuid;
  target_email text;
  remaining_reasons jsonb;
begin
  decision := private.outreach_recipient_eligibility_without_campaign_scope(
    target_recipient_id, target_mailbox_id, eligibility_time
  );

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
    decision := jsonb_set(decision, '{reasons}',
      coalesce(decision -> 'reasons', '[]'::jsonb) || jsonb_build_array('dns_not_ready'), true);
    decision := jsonb_set(decision, '{eligible}', 'false'::jsonb, true);
  end if;

  select recipient.campaign_id, recipient.contact_id, contact.email::text
  into target_campaign_id, target_contact_id, target_email
  from public.outreach_recipients recipient
  left join public.contactos contact on contact.id = recipient.contact_id
  where recipient.id = target_recipient_id;

  if target_campaign_id is not null and not exists (
    select 1 from public.outreach_campaign_mailboxes selection
    where selection.campaign_id=target_campaign_id
      and selection.mailbox_id=target_mailbox_id
  ) then
    decision := jsonb_set(decision, '{reasons}',
      coalesce(decision -> 'reasons', '[]'::jsonb)
        || jsonb_build_array('campaign_mailbox_not_selected'), true);
    decision := jsonb_set(decision, '{eligible}', 'false'::jsonb, true);
  end if;

  if coalesce(decision -> 'reasons', '[]'::jsonb) ? 'email_not_verified'
    and private.outreach_has_owned_mailbox_email(target_contact_id, target_email) then
    select coalesce(jsonb_agg(reason), '[]'::jsonb) into remaining_reasons
    from jsonb_array_elements_text(decision -> 'reasons') as entries(reason)
    where reason <> 'email_not_verified';
    decision := jsonb_set(decision, '{reasons}', remaining_reasons, true);
    decision := jsonb_set(decision, '{eligible}',
      to_jsonb(jsonb_array_length(remaining_reasons) = 0), true);
  end if;
  return decision;
end;
$$;

notify pgrst, 'reload schema';
commit;
