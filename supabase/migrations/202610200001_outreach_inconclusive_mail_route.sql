begin;

-- A documented, admin-approved campaign may begin a bounded pilot while the
-- system is still in canary. The existing per-mailbox ramp and campaign quotas
-- remain authoritative. Approval expires, and any missing consent or opt-out
-- still blocks dispatch.
create table private.outreach_campaign_pilots (
  campaign_id uuid primary key references public.outreach_campaigns(id) on delete cascade,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > approved_at)
);
revoke all on private.outreach_campaign_pilots from public, anon, authenticated;
create table private.outreach_campaign_pilot_recipients (
  campaign_id uuid not null references private.outreach_campaign_pilots(campaign_id) on delete cascade,
  recipient_id uuid not null references public.outreach_recipients(id) on delete cascade,
  primary key (campaign_id, recipient_id)
);
revoke all on private.outreach_campaign_pilot_recipients from public, anon, authenticated;

create or replace function private.outreach_approve_campaign_pilot(
  target_campaign_id uuid,
  actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  recipient_count integer;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id=actor_id and p.ativo and p.role='admin'
  ) then
    raise exception 'Só um administrador ativo pode aprovar o piloto';
  end if;
  if not exists (
    select 1 from public.outreach_system_state s
    where s.id and s.mode='canary' and s.send_enabled
  ) then
    raise exception 'O piloto só pode ser aprovado durante canary ativo';
  end if;
  if not exists (
    select 1 from public.outreach_campaigns c
    where c.id=target_campaign_id and c.status='draft'
  ) then
    raise exception 'O piloto exige uma campanha em rascunho';
  end if;

  select count(*) into recipient_count
  from public.outreach_recipients r
  where r.campaign_id=target_campaign_id;
  if recipient_count < 1 or recipient_count > 100 then
    raise exception 'O piloto aceita entre 1 e 100 destinatários';
  end if;
  if exists (
    select 1
    from public.outreach_recipients r
    left join public.contactos c on c.id=r.contact_id
    where r.campaign_id=target_campaign_id
      and (
        r.status <> 'eligible'
        or c.id is null or c.email is null or c.optout
        or c.outreach_legal_basis <> 'consent'
        or c.outreach_consent_at is null
        or nullif(trim(c.outreach_consent_source), '') is null
        or c.outreach_legal_basis_recorded_at is null
        or c.outreach_legal_basis_recorded_by is null
        or private.outreach_is_suppressed(c.email::text,c.empresa_id)
      )
  ) then
    raise exception 'O piloto exige consentimento documentado e elegibilidade de todos os destinatários';
  end if;

  insert into private.outreach_campaign_pilots(campaign_id,approved_by,expires_at)
  values (target_campaign_id,actor_id,now()+interval '30 days')
  on conflict(campaign_id) do update
  set approved_by=excluded.approved_by,approved_at=now(),expires_at=excluded.expires_at;
  insert into private.outreach_campaign_pilot_recipients(campaign_id,recipient_id)
  select target_campaign_id,r.id from public.outreach_recipients r
  where r.campaign_id=target_campaign_id
  on conflict do nothing;

  insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details)
  values (actor_id,'campaign.pilot_approved','campaign',target_campaign_id,
    jsonb_build_object('recipient_count',recipient_count,'expires_in_days',30));
end;
$$;
revoke all on function private.outreach_approve_campaign_pilot(uuid, uuid) from public, anon, authenticated;
grant execute on function private.outreach_approve_campaign_pilot(uuid, uuid) to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname='outreach_service') then
    execute 'grant execute on function private.outreach_approve_campaign_pilot(uuid, uuid) to outreach_service';
  end if;
end $$;

-- A recent DNS check can establish that a domain accepts mail without proving
-- that this individual mailbox exists. Treat that precise result as an
-- inconclusive warning. Invalid, risky, expired and DNS-error results remain
-- blocked; the consent, suppression, quota and sender checks still apply.
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
  is_message_test boolean;
  is_approved_pilot boolean := false;
  has_inconclusive_mail_route boolean := false;
  has_owned_mailbox_history boolean := false;
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

  select recipient.campaign_id, recipient.contact_id, contact.email::text,
         campaign.test_source_campaign_id is not null
           and campaign.daily_limit = 1
           and (select count(*) from public.outreach_recipients test_recipient
                where test_recipient.campaign_id=campaign.id) = 1
           and exists (
             select 1 from public.outreach_recipients source_recipient
             where source_recipient.campaign_id=campaign.test_source_campaign_id
               and source_recipient.contact_id=recipient.contact_id
           )
  into target_campaign_id, target_contact_id, target_email, is_message_test
  from public.outreach_recipients recipient
  join public.outreach_campaigns campaign on campaign.id=recipient.campaign_id
  left join public.contactos contact on contact.id=recipient.contact_id
  where recipient.id=target_recipient_id;
  is_message_test := coalesce(is_message_test, false);
  has_owned_mailbox_history := private.outreach_has_owned_mailbox_email(target_contact_id, target_email);
  select exists (
    select 1 from private.outreach_campaign_pilots p
    join private.outreach_campaign_pilot_recipients approved
      on approved.campaign_id=p.campaign_id
     and approved.recipient_id=target_recipient_id
    where p.campaign_id=target_campaign_id
      and p.approved_at <= eligibility_time and p.expires_at > eligibility_time
  ) into is_approved_pilot;

  select coalesce((
    select v.status='unknown'
      and v.provider='dns_syntax'
      and v.verified_at is not null
      and (v.expires_at is null or v.expires_at > eligibility_time)
      and v.reasons && array[
        'Domínio com MX válido, mas a existência desta caixa não foi confirmada.',
        'Domínio com A/AAAA para receber correio, mas a existência desta caixa não foi confirmada.'
      ]::text[]
    from public.outreach_email_verifications v
    where lower(v.email::text)=lower(target_email)
    order by v.verified_at desc nulls last,v.created_at desc,v.id desc
    limit 1
  ), false) into has_inconclusive_mail_route;

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

  if has_owned_mailbox_history or has_inconclusive_mail_route or is_message_test or is_approved_pilot then
    select coalesce(jsonb_agg(reason), '[]'::jsonb) into remaining_reasons
    from jsonb_array_elements_text(coalesce(decision -> 'reasons', '[]'::jsonb)) as entries(reason)
    where not (reason = 'email_not_verified' and (has_owned_mailbox_history or has_inconclusive_mail_route))
      and not (reason = 'lawful_basis_missing' and is_message_test)
      and not (reason = 'not_in_canary_allowlist' and (is_message_test or is_approved_pilot));
    decision := jsonb_set(decision, '{reasons}', remaining_reasons, true);
    decision := jsonb_set(decision, '{eligible}',
      to_jsonb(jsonb_array_length(remaining_reasons) = 0), true);
  end if;
  return decision;
end;
$$;

comment on function private.outreach_recipient_eligibility(uuid, uuid, timestamptz)
  is 'Authoritative send eligibility. Recent DNS-only inconclusive results are warnings; documented admin-approved pilot campaigns bypass the canary recipient allowlist while retaining ramp, quota and safety gates.';

notify pgrst, 'reload schema';
commit;
