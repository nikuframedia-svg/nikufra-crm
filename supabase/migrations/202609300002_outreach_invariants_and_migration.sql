begin;

alter table public.outreach_email_verifications
  add column evidence_reference text,
  add column verified_by uuid references public.profiles(id) on delete set null;

-- Deterministic, keyed identities let RGPD deletion retain only the minimum
-- information required to prevent a later re-import or send.  The key never
-- leaves the private schema and can be versioned/rotated independently.
create or replace function private.outreach_identity_hmac(raw_identity text)
returns bytea
language sql
stable
security definer
set search_path = private, public, pg_temp
as $$
  select extensions.hmac(
    convert_to(lower(trim(raw_identity)), 'UTF8'),
    key_material,
    'sha256'
  )
  from private.outreach_hmac_keys
  where active
  order by key_version desc
  limit 1;
$$;

-- Matching deliberately checks every retained key version. Rotating the active
-- write key therefore cannot silently re-enable an old suppression/tombstone;
-- retired key material may be removed only after an explicit re-HMAC migration.
create or replace function private.outreach_identity_hmac_matches(
  stored_hmac bytea,
  raw_identity text
)
returns boolean
language sql
stable
security definer
set search_path = private, public, pg_temp
as $$
  select stored_hmac is not null
    and raw_identity is not null
    and exists (
      select 1
      from private.outreach_hmac_keys key_version
      where stored_hmac = extensions.hmac(
        convert_to(lower(trim(raw_identity)), 'UTF8'),
        key_version.key_material,
        'sha256'
      )
    );
$$;

create or replace function private.protect_outreach_hmac_key_history()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Chaves HMAC históricas não podem ser eliminadas';
  end if;
  if new.key_material is distinct from old.key_material then
    raise exception 'Material de uma versão HMAC é imutável';
  end if;
  return new;
end;
$$;

create trigger protect_outreach_hmac_key_history
before update of key_material or delete on private.outreach_hmac_keys
for each row execute function private.protect_outreach_hmac_key_history();

-- Google-contact import tombstones must remain useful after RGPD deletion
-- without retaining the deleted email/resource name in clear text. Prefixing
-- the namespace prevents an email that happens to equal a provider resource
-- identifier from colliding with that resource's digest.
alter table public.contact_import_suppressions
  add column email_hmac bytea,
  add column google_resource_hmac bytea;

update public.contact_import_suppressions
set email_hmac = case
      when email is not null then private.outreach_identity_hmac('email:' || email::text)
      else email_hmac
    end,
    google_resource_hmac = case
      when google_resource_name is not null
        then private.outreach_identity_hmac('google_resource:' || google_resource_name)
      else google_resource_hmac
    end;

drop index if exists public.contact_import_suppressions_email_unique;
drop index if exists public.contact_import_suppressions_resource_unique;
alter table public.contact_import_suppressions
  drop constraint if exists contact_import_suppressions_check;

-- Redact legacy tombstones only after their keyed digests have been backfilled.
update public.contact_import_suppressions
set email = null,
    google_resource_name = null
where email is not null or google_resource_name is not null;

alter table public.contact_import_suppressions
  add constraint contact_import_suppressions_hmac_identity
  check (email_hmac is not null or google_resource_hmac is not null);

create unique index contact_import_suppressions_email_hmac_unique
  on public.contact_import_suppressions(email_hmac) where email_hmac is not null;
create unique index contact_import_suppressions_resource_hmac_unique
  on public.contact_import_suppressions(google_resource_hmac)
  where google_resource_hmac is not null;

create or replace function private.normalize_contact_import_suppression()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  if new.email is not null then
    new.email_hmac := private.outreach_identity_hmac('email:' || new.email::text);
  end if;
  if new.google_resource_name is not null then
    new.google_resource_hmac := private.outreach_identity_hmac(
      'google_resource:' || new.google_resource_name
    );
  end if;
  new.email := null;
  new.google_resource_name := null;
  if new.email_hmac is null and new.google_resource_hmac is null then
    raise exception 'Tombstone de importação requer email ou recurso Google';
  end if;
  return new;
end;
$$;

create trigger normalize_contact_import_suppression
before insert or update of email, google_resource_name, email_hmac, google_resource_hmac
on public.contact_import_suppressions
for each row execute function private.normalize_contact_import_suppression();

-- Narrow PostgREST RPC for gmail-sync. It reveals only a boolean and never
-- exposes the digest/key material or accepts a caller-controlled source.
create or replace function public.is_contact_import_suppressed(
  p_email text default null,
  p_google_resource_name text default null
)
returns boolean
language sql
stable
security definer
set search_path = private, public, pg_temp
as $$
  select exists (
    select 1
    from public.contact_import_suppressions suppression
    where (
      nullif(trim(p_email), '') is not null
      and private.outreach_identity_hmac_matches(
        suppression.email_hmac, 'email:' || p_email
      )
    ) or (
      nullif(trim(p_google_resource_name), '') is not null
      and private.outreach_identity_hmac_matches(
        suppression.google_resource_hmac,
        'google_resource:' || p_google_resource_name
      )
    )
  );
$$;

create or replace function private.set_communication_suppression_hmac()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  raw_identity text;
begin
  raw_identity := case new.scope
    when 'email' then new.email::text
    when 'domain' then new.domain::text
    when 'company' then new.company_id::text
  end;

  if new.identity_hmac is null and raw_identity is not null then
    new.identity_hmac := private.outreach_identity_hmac(raw_identity);
  end if;
  return new;
end;
$$;

create trigger communication_suppression_hmac
before insert or update of scope, email, domain, company_id, identity_hmac
on public.communication_suppressions
for each row execute function private.set_communication_suppression_hmac();

create or replace function private.outreach_is_suppressed(
  candidate_email text,
  candidate_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = private, public, pg_temp
as $$
  select exists (
    select 1
    from public.communication_suppressions s
    where s.active
      and (
        (
          s.scope = 'email'
          and candidate_email is not null
          and (
            lower(s.email::text) = lower(trim(candidate_email))
            or private.outreach_identity_hmac_matches(s.identity_hmac, candidate_email)
          )
        )
        or (
          s.scope = 'domain'
          and candidate_email is not null
          and position('@' in candidate_email) > 0
          and (
            lower(s.domain::text) = lower(split_part(trim(candidate_email), '@', 2))
            or private.outreach_identity_hmac_matches(
              s.identity_hmac, split_part(candidate_email, '@', 2)
            )
          )
        )
        or (
          s.scope = 'company'
          and candidate_company_id is not null
          and (
            s.company_id = candidate_company_id
            or private.outreach_identity_hmac_matches(
              s.identity_hmac, candidate_company_id::text
            )
          )
        )
      )
  );
$$;

-- contactos.optout is now a compatibility mirror. Setting it to true creates
-- the canonical suppression; setting it false cannot bypass an active one.
create or replace function private.enforce_contact_communication_suppression()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  suppression_scope public.communication_suppression_scope;
begin
  if private.outreach_is_suppressed(new.email::text, new.empresa_id) then
    new.optout := true;
    return new;
  end if;

  if new.optout then
    suppression_scope := case when new.email is null then 'company' else 'email' end;
    insert into public.communication_suppressions(
      scope, email, company_id, reason, source, note, created_by
    )
    select
      suppression_scope,
      case when suppression_scope = 'email' then new.email else null end,
      case when suppression_scope = 'company' then new.empresa_id else null end,
      'manual', 'crm', 'Criado a partir de contactos.optout', auth.uid()
    where not exists (
      select 1
      from public.communication_suppressions s
      where s.active
        and s.scope = suppression_scope
        and (
          (suppression_scope = 'email' and lower(s.email::text) = lower(new.email::text))
          or (suppression_scope = 'company' and s.company_id = new.empresa_id)
        )
    );
  end if;
  return new;
end;
$$;

create trigger enforce_contact_communication_suppression
before insert or update of email, empresa_id, optout on public.contactos
for each row execute function private.enforce_contact_communication_suppression();

create or replace function private.apply_communication_suppression()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  -- Recompute the compatibility mirror from the canonical source. This also
  -- handles deactivation without implicitly re-enabling an Outreach recipient.
  update public.contactos c
  set optout = private.outreach_is_suppressed(c.email::text, c.empresa_id),
      updated_at = now()
  where c.optout is distinct from private.outreach_is_suppressed(c.email::text, c.empresa_id)
    and c.id::text is distinct from nullif(
      current_setting('app.outreach_redacting_contact', true), ''
    );

  if tg_op <> 'DELETE' and new.active then
    update public.outreach_recipients r
    set status = 'suppressed',
        eligibility_reasons = array_append(
          array_remove(r.eligibility_reasons, 'suppressed'), 'suppressed'
        ),
        updated_at = now()
    where private.outreach_is_suppressed(r.email_snapshot::text, r.company_id)
      and r.status not in ('completed', 'deleted');

    update public.outreach_jobs j
    set status = case
          when j.status = 'reconciliation_required' or exists (
            select 1 from private.outreach_delivery_ledger ledger
            where ledger.job_id = j.id
              and ledger.status in ('sending', 'accepted', 'ambiguous')
          ) then 'reconciliation_required'::public.outreach_job_status
          else 'cancelled'::public.outreach_job_status
        end,
        lease_owner = null,
        lease_expires_at = null,
        last_error = 'communication_suppression',
        updated_at = now()
    from public.outreach_recipients r
    where r.id = j.recipient_id
      and private.outreach_is_suppressed(r.email_snapshot::text, r.company_id)
      and j.status in ('pending', 'leased', 'reconciliation_required');
  end if;
  return coalesce(new, old);
end;
$$;

create trigger apply_communication_suppression
after insert or update of active, email, domain, company_id, identity_hmac
or delete on public.communication_suppressions
for each row execute function private.apply_communication_suppression();

create or replace function private.set_outreach_recipient_identity()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  canonical_email citext;
  canonical_company uuid;
begin
  if new.contact_id is not null then
    select c.email, c.empresa_id
    into canonical_email, canonical_company
    from public.contactos c
    where c.id = new.contact_id;

    if new.email_snapshot is null then new.email_snapshot := canonical_email; end if;
    if new.company_id is null then new.company_id := canonical_company; end if;
  end if;

  if new.identity_hmac is null and new.email_snapshot is not null then
    new.identity_hmac := private.outreach_identity_hmac(new.email_snapshot::text);
  end if;
  return new;
end;
$$;

create trigger set_outreach_recipient_identity
before insert or update of contact_id, email_snapshot, identity_hmac
on public.outreach_recipients
for each row execute function private.set_outreach_recipient_identity();

-- Single fail-closed eligibility decision used immediately before claiming and
-- immediately before dispatch. No caller is expected to reconstruct these
-- guardrails in application code.
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
  recipient_record public.outreach_recipients%rowtype;
  campaign_record public.outreach_campaigns%rowtype;
  mailbox_record public.outreach_mailboxes%rowtype;
  contact_record public.contactos%rowtype;
  system_record public.outreach_system_state%rowtype;
  dns_record public.outreach_dns_checks%rowtype;
  verification_record public.outreach_email_verifications%rowtype;
  local_time timestamp;
  reasons text[] := '{}'::text[];
  sent_today integer := 0;
  campaign_sent_today integer := 0;
  last_mailbox_activity_at timestamptz;
begin
  select * into recipient_record from public.outreach_recipients where id = target_recipient_id;
  if not found then
    return jsonb_build_object('eligible', false, 'reasons', array['recipient_missing']);
  end if;

  if recipient_record.status in (
    'ineligible', 'suppressed', 'bounced', 'completed', 'deleted',
    'reconciliation_required'
  ) then
    reasons := array_append(reasons, 'recipient_terminal_status');
  end if;

  select * into system_record from public.outreach_system_state where id;
  select * into campaign_record from public.outreach_campaigns where id = recipient_record.campaign_id;
  select * into mailbox_record from public.outreach_mailboxes where id = target_mailbox_id;
  select * into contact_record from public.contactos where id = recipient_record.contact_id;

  if system_record.id is null or not system_record.send_enabled or system_record.mode = 'disabled' then
    reasons := array_append(reasons, 'outbound_disabled');
  end if;
  if campaign_record.id is null or campaign_record.status <> 'running' then
    reasons := array_append(reasons, 'campaign_not_running');
  end if;
  if mailbox_record.id is null or mailbox_record.status <> 'active' or not mailbox_record.send_enabled then
    reasons := array_append(reasons, 'mailbox_not_sendable');
  elsif mailbox_record.provider <> 'google' then
    reasons := array_append(reasons, 'provider_not_enabled');
  end if;
  if contact_record.id is null or contact_record.email is null then
    reasons := array_append(reasons, 'contact_missing');
  elsif recipient_record.email_snapshot is null
     or lower(contact_record.email::text) <> lower(recipient_record.email_snapshot::text) then
    reasons := array_append(reasons, 'contact_email_changed');
  end if;
  if contact_record.id is not null and (
    contact_record.outreach_legal_basis is null
    or contact_record.outreach_legal_basis = 'not_applicable'
    or contact_record.outreach_legal_basis_recorded_at is null
    or contact_record.outreach_legal_basis_recorded_by is null
    or (
      contact_record.outreach_legal_basis = 'consent'
      and (
        contact_record.outreach_consent_at is null
        or nullif(trim(contact_record.outreach_consent_source), '') is null
      )
    )
    or (
      contact_record.outreach_legal_basis = 'contract'
      and nullif(trim(contact_record.outreach_legal_basis_evidence), '') is null
    )
    or (
      contact_record.outreach_legal_basis = 'legitimate_interest'
      and (
        nullif(trim(contact_record.outreach_legitimate_interest_purpose), '') is null
        or nullif(trim(contact_record.outreach_lia_reference), '') is null
        or contact_record.outreach_legitimate_interest_expires_at is null
        or contact_record.outreach_legitimate_interest_expires_at <= eligibility_time
      )
    )
  ) then
    reasons := array_append(reasons, 'lawful_basis_missing');
  end if;
  if contact_record.optout
     or private.outreach_is_suppressed(contact_record.email::text, contact_record.empresa_id) then
    reasons := array_append(reasons, 'suppressed');
  end if;

  select * into verification_record
  from public.outreach_email_verifications v
  where lower(v.email::text) = lower(contact_record.email::text)
  order by v.verified_at desc nulls last, v.created_at desc
  limit 1;
  if verification_record.id is null
     or verification_record.status <> 'valid'
     or verification_record.verified_at is null
     or (verification_record.expires_at is not null and verification_record.expires_at <= eligibility_time) then
    reasons := array_append(reasons, 'email_not_verified');
  end if;

  select * into dns_record
  from public.outreach_dns_checks d
  where d.mailbox_id = target_mailbox_id
  order by d.checked_at desc, d.id desc
  limit 1;
  if dns_record.id is null
     or dns_record.spf_status <> 'pass'
     or dns_record.dkim_status <> 'pass'
     or dns_record.dmarc_status <> 'pass'
     or dns_record.mx_status <> 'pass'
     or dns_record.checked_at <= eligibility_time - interval '24 hours' then
    reasons := array_append(reasons, 'dns_not_ready');
  end if;

  if recipient_record.responded_at is not null then
    reasons := array_append(reasons, 'already_replied');
  end if;
  if campaign_record.stop_company_on_reply and recipient_record.company_id is not null and exists (
    select 1
    from public.outreach_recipients sibling
    where sibling.campaign_id = recipient_record.campaign_id
      and sibling.company_id = recipient_record.company_id
      and sibling.responded_at is not null
  ) then
    reasons := array_append(reasons, 'company_already_replied');
  end if;

  if campaign_record.id is not null then
    local_time := eligibility_time at time zone campaign_record.timezone;
    if campaign_record.starts_at is not null and eligibility_time < campaign_record.starts_at
       or campaign_record.ends_at is not null and eligibility_time >= campaign_record.ends_at then
      reasons := array_append(reasons, 'outside_campaign_period');
    end if;
    if not extract(dow from local_time)::smallint = any(campaign_record.send_days)
       or local_time::time < campaign_record.send_window_start
       or local_time::time >= campaign_record.send_window_end then
      reasons := array_append(reasons, 'outside_send_window');
    end if;
  end if;

  if mailbox_record.id is not null then
    select count(*)::integer into sent_today
    from (
      select 'message:' || m.id::text as quota_unit
      from public.outreach_messages m
      where m.mailbox_id = mailbox_record.id
        and m.direction = 'outbound'
        and (m.occurred_at at time zone mailbox_record.timezone)::date =
            (eligibility_time at time zone mailbox_record.timezone)::date
      union all
      select 'reservation:' || ledger.id::text
      from private.outreach_delivery_ledger ledger
      where ledger.mailbox_id = mailbox_record.id
        and ledger.status in ('sending', 'accepted', 'confirmed', 'ambiguous', 'reconciled')
        and (ledger.first_attempt_at at time zone mailbox_record.timezone)::date =
            (eligibility_time at time zone mailbox_record.timezone)::date
        and not exists (
          select 1 from public.outreach_messages delivered
          where delivered.mailbox_id = ledger.mailbox_id
            and delivered.direction = 'outbound'
            and ledger.provider_message_id is not null
            and delivered.provider_message_id = ledger.provider_message_id
        )
    ) mailbox_quota;

    if campaign_record.id is not null then
      select count(*)::integer into campaign_sent_today
      from (
        select 'message:' || m.id::text as quota_unit
        from public.outreach_messages m
        where m.campaign_id = campaign_record.id
          and m.direction = 'outbound'
          and (m.occurred_at at time zone campaign_record.timezone)::date =
              (eligibility_time at time zone campaign_record.timezone)::date
        union all
        select 'reservation:' || ledger.id::text
        from private.outreach_delivery_ledger ledger
        join public.outreach_recipients reserved_recipient
          on reserved_recipient.id = ledger.recipient_id
        where reserved_recipient.campaign_id = campaign_record.id
          and ledger.status in ('sending', 'accepted', 'confirmed', 'ambiguous', 'reconciled')
          and (ledger.first_attempt_at at time zone campaign_record.timezone)::date =
              (eligibility_time at time zone campaign_record.timezone)::date
          and not exists (
            select 1 from public.outreach_messages delivered
            where delivered.campaign_id = campaign_record.id
              and delivered.direction = 'outbound'
              and ledger.provider_message_id is not null
              and delivered.provider_message_id = ledger.provider_message_id
          )
      ) campaign_quota;
    end if;

    if sent_today >= least(mailbox_record.daily_limit, mailbox_record.ramp_daily_limit)
       or (campaign_record.id is not null and campaign_sent_today >= campaign_record.daily_limit) then
      reasons := array_append(reasons, 'daily_quota_reached');
    end if;

    -- Pacing is mailbox-wide: an active reservation is considered an attempt
    -- even before a provider message exists, preventing concurrent workers from
    -- bursting a campaign's full daily quota in one scheduler tick.
    select max(pacing.activity_at) into last_mailbox_activity_at
    from (
      select message.occurred_at as activity_at
      from public.outreach_messages message
      where message.mailbox_id = mailbox_record.id
        and message.direction = 'outbound'
      union all
      select ledger.last_attempt_at
      from private.outreach_delivery_ledger ledger
      where ledger.mailbox_id = mailbox_record.id
        and ledger.status in ('sending', 'accepted', 'ambiguous')
    ) pacing;

    if campaign_record.id is not null
       and campaign_record.gap_minutes > 0
       and last_mailbox_activity_at is not null
       and last_mailbox_activity_at > eligibility_time
         - make_interval(mins => campaign_record.gap_minutes) then
      reasons := array_append(reasons, 'mailbox_gap_not_elapsed');
    end if;
  end if;

  if system_record.mode = 'canary' and contact_record.email is not null and not exists (
    select 1 from private.outreach_canary_allowlist a
    where lower(a.email::text) = lower(contact_record.email::text)
  ) then
    reasons := array_append(reasons, 'not_in_canary_allowlist');
  end if;

  return jsonb_build_object(
    'eligible', cardinality(reasons) = 0,
    'reasons', to_jsonb(reasons),
    'recipient_id', target_recipient_id,
    'mailbox_id', target_mailbox_id,
    'evaluated_at', eligibility_time
  );
exception
  when invalid_parameter_value then
    -- Invalid timezone/configuration must block, never fall back to UTC.
    return jsonb_build_object('eligible', false, 'reasons', array['invalid_schedule_configuration']);
end;
$$;

-- The provider boundary uses the matching session-level shared advisory lock.
-- Every mutation capable of making a previously eligible dispatch unsafe takes
-- the exclusive transaction-level form before it can commit.  The worker then
-- re-runs this complete decision while holding the shared permit.  Its own
-- delivery reservation is excluded only from quota and pacing calculations:
-- the reservation already consumed that slot during beginDispatch.
create or replace function private.outreach_assert_provider_permit(
  target_job_id uuid,
  target_worker_id text
)
returns uuid
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  job_record public.outreach_jobs%rowtype;
  ledger_record private.outreach_delivery_ledger%rowtype;
  campaign_record public.outreach_campaigns%rowtype;
  mailbox_record public.outreach_mailboxes%rowtype;
  decision jsonb;
  reasons text[] := '{}'::text[];
  permit_time timestamptz := now();
  sent_today integer := 0;
  campaign_sent_today integer := 0;
  last_mailbox_activity_at timestamptz;
begin
  select * into job_record
  from public.outreach_jobs job
  where job.id = target_job_id;
  if job_record.id is null
     or job_record.status <> 'leased'
     or job_record.lease_owner is distinct from target_worker_id
     or job_record.lease_expires_at is null
     or job_record.lease_expires_at <= permit_time then
    raise exception using
      errcode = 'P2003',
      message = 'Permit de provider recusado: lease inválido';
  end if;

  select * into ledger_record
  from private.outreach_delivery_ledger ledger
  where ledger.job_id = target_job_id;
  if ledger_record.id is null or ledger_record.status <> 'sending' then
    raise exception using
      errcode = 'P2003',
      message = 'Permit de provider recusado: reserva de delivery inválida';
  end if;

  if not exists (
    select 1 from private.outreach_credentials credential
    where credential.mailbox_id = job_record.mailbox_id
  ) then
    raise exception using
      errcode = 'P2003',
      message = 'Permit de provider recusado: credencial removida';
  end if;

  decision := private.outreach_recipient_eligibility(
    job_record.recipient_id,
    job_record.mailbox_id,
    permit_time
  );
  select coalesce(array_agg(item.reason), '{}'::text[])
  into reasons
  from jsonb_array_elements_text(coalesce(decision -> 'reasons', '[]'::jsonb))
    as item(reason)
  where item.reason not in ('daily_quota_reached', 'mailbox_gap_not_elapsed')
    and (
      job_record.idempotency_key not like 'manual:%'
      or item.reason not in ('already_replied', 'company_already_replied')
    );

  select * into campaign_record
  from public.outreach_campaigns campaign
  where campaign.id = job_record.campaign_id;
  select * into mailbox_record
  from public.outreach_mailboxes mailbox
  where mailbox.id = job_record.mailbox_id;

  if mailbox_record.id is not null then
    select count(*)::integer into sent_today
    from (
      select message.id::text quota_unit
      from public.outreach_messages message
      where message.mailbox_id = mailbox_record.id
        and message.direction = 'outbound'
        and (message.occurred_at at time zone mailbox_record.timezone)::date =
            (permit_time at time zone mailbox_record.timezone)::date
      union all
      select ledger.id::text
      from private.outreach_delivery_ledger ledger
      where ledger.mailbox_id = mailbox_record.id
        and ledger.job_id <> target_job_id
        and ledger.status in ('sending', 'accepted', 'confirmed', 'ambiguous', 'reconciled')
        and (ledger.first_attempt_at at time zone mailbox_record.timezone)::date =
            (permit_time at time zone mailbox_record.timezone)::date
        and not exists (
          select 1 from public.outreach_messages delivered
          where delivered.mailbox_id = ledger.mailbox_id
            and delivered.direction = 'outbound'
            and ledger.provider_message_id is not null
            and delivered.provider_message_id = ledger.provider_message_id
        )
    ) mailbox_quota;

    if campaign_record.id is not null then
      select count(*)::integer into campaign_sent_today
      from (
        select message.id::text quota_unit
        from public.outreach_messages message
        where message.campaign_id = campaign_record.id
          and message.direction = 'outbound'
          and (message.occurred_at at time zone campaign_record.timezone)::date =
              (permit_time at time zone campaign_record.timezone)::date
        union all
        select ledger.id::text
        from private.outreach_delivery_ledger ledger
        join public.outreach_recipients reserved_recipient
          on reserved_recipient.id = ledger.recipient_id
        where reserved_recipient.campaign_id = campaign_record.id
          and ledger.job_id <> target_job_id
          and ledger.status in ('sending', 'accepted', 'confirmed', 'ambiguous', 'reconciled')
          and (ledger.first_attempt_at at time zone campaign_record.timezone)::date =
              (permit_time at time zone campaign_record.timezone)::date
          and not exists (
            select 1 from public.outreach_messages delivered
            where delivered.campaign_id = campaign_record.id
              and delivered.direction = 'outbound'
              and ledger.provider_message_id is not null
              and delivered.provider_message_id = ledger.provider_message_id
          )
      ) campaign_quota;
    end if;

    if sent_today >= least(mailbox_record.daily_limit, mailbox_record.ramp_daily_limit)
       or (campaign_record.id is not null and campaign_sent_today >= campaign_record.daily_limit) then
      reasons := array_append(reasons, 'daily_quota_reached');
    end if;

    select max(pacing.activity_at) into last_mailbox_activity_at
    from (
      select message.occurred_at activity_at
      from public.outreach_messages message
      where message.mailbox_id = mailbox_record.id
        and message.direction = 'outbound'
      union all
      select ledger.last_attempt_at
      from private.outreach_delivery_ledger ledger
      where ledger.mailbox_id = mailbox_record.id
        and ledger.job_id <> target_job_id
        and ledger.status in ('sending', 'accepted', 'ambiguous')
    ) pacing;
    if campaign_record.id is not null
       and campaign_record.gap_minutes > 0
       and last_mailbox_activity_at is not null
       and last_mailbox_activity_at > permit_time
         - make_interval(mins => campaign_record.gap_minutes) then
      reasons := array_append(reasons, 'mailbox_gap_not_elapsed');
    end if;
  end if;

  if cardinality(reasons) > 0 then
    raise exception using
      errcode = 'P2003',
      message = format('Permit de provider recusado: %s', to_jsonb(reasons)),
      detail = 'eligibility_failed';
  end if;
  return ledger_record.id;
exception
  when invalid_parameter_value then
    raise exception using
      errcode = 'P2003',
      message = 'Permit de provider recusado: configuração temporal inválida',
      detail = 'eligibility_failed';
end;
$$;

create or replace function private.outreach_assert_dispatch_eligible(
  target_job_id uuid,
  target_payload_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  job_record public.outreach_jobs%rowtype;
  decision jsonb;
  filtered_reasons jsonb;
  ledger_id uuid;
begin
  select * into job_record
  from public.outreach_jobs
  where id = target_job_id
  for update;

  if job_record.id is null or job_record.status <> 'leased' then
    raise exception 'Job não está reservado para envio';
  end if;
  if job_record.lease_expires_at <= now() then
    raise exception 'Lease expirado';
  end if;

  -- Dispatch reservations for one mailbox are serialized. Eligibility counts
  -- committed sending/ambiguous ledger rows as quota so a second worker cannot
  -- pass the same final-slot check while the provider call is still pending.
  perform 1
  from public.outreach_mailboxes mailbox
  where mailbox.id = job_record.mailbox_id
  for update;
  if not found then
    raise exception 'Mailbox não encontrada';
  end if;

  decision := private.outreach_recipient_eligibility(job_record.recipient_id, job_record.mailbox_id, now());
  if job_record.idempotency_key like 'manual:%' then
    select coalesce(jsonb_agg(reason), '[]'::jsonb)
    into filtered_reasons
    from jsonb_array_elements_text(decision -> 'reasons') reason
    where reason not in ('already_replied', 'company_already_replied');
    decision := jsonb_set(decision, '{reasons}', filtered_reasons);
    decision := jsonb_set(
      decision,
      '{eligible}',
      to_jsonb(jsonb_array_length(filtered_reasons) = 0)
    );
  end if;
  if not coalesce((decision ->> 'eligible')::boolean, false) then
    update public.outreach_jobs
    set status = 'cancelled', last_error = (decision -> 'reasons')::text,
        lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = target_job_id;
    raise exception using
      errcode = 'P2001',
      message = format('Destinatário inelegível: %s', decision -> 'reasons');
  end if;

  insert into private.outreach_delivery_ledger(
    job_id, mailbox_id, recipient_id, idempotency_key, status, payload_hash
  ) values (
    job_record.id, job_record.mailbox_id, job_record.recipient_id,
    job_record.idempotency_key, 'sending', target_payload_hash
  )
  on conflict (job_id) do update
  set last_attempt_at = now()
  where private.outreach_delivery_ledger.payload_hash = excluded.payload_hash
    and private.outreach_delivery_ledger.status in ('failed', 'ambiguous')
  returning id into ledger_id;

  if ledger_id is null then
    raise exception using
      errcode = 'P2002',
      message = 'Ledger de entrega já existe ou payload divergente';
  end if;

  update public.outreach_jobs
  set attempt_count = attempt_count + 1, updated_at = now()
  where id = target_job_id;
  return ledger_id;
end;
$$;

-- Atomically elect one owner for message-level side effects across the CRM
-- Gmail importer and Outreach. Callers may still upsert their per-contact CRM
-- activity association when this returns false; only global side effects are
-- skipped. Existing CRM activities are recognized for backwards compatibility.
create or replace function private.outreach_claim_provider_message(
  p_mailbox_email text,
  p_provider_message_id text,
  p_source text
)
returns boolean
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  normalized_mailbox citext := nullif(lower(trim(p_mailbox_email)), '')::citext;
  normalized_message_id text := nullif(trim(p_provider_message_id), '');
  claimed boolean := false;
begin
  if normalized_mailbox is null or normalized_message_id is null then
    raise exception 'Mailbox e provider message id são obrigatórios';
  end if;
  if p_source not in ('crm_gmail', 'outreach_inbound', 'outreach_outbound') then
    raise exception 'Origem de mensagem inválida';
  end if;

  -- Data indexed before this migration already owns its side effects in CRM.
  if exists (
    select 1 from public.atividades a
    where lower(a.source_mailbox_email::text) = normalized_mailbox::text
      and a.message_id = normalized_message_id
  ) then
    insert into private.communication_provider_message_ledger(
      mailbox_email, provider_message_id, first_source
    ) values (normalized_mailbox, normalized_message_id, 'crm_gmail')
    on conflict do nothing;
    return false;
  end if;

  insert into private.communication_provider_message_ledger(
    mailbox_email, provider_message_id, first_source
  ) values (normalized_mailbox, normalized_message_id, p_source)
  on conflict do nothing
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

-- PostgREST exposes only the public schema in this installation. Gmail sync
-- receives a fixed-source wrapper rather than access to the private API or a
-- caller-controlled source value.
create or replace function public.claim_google_provider_message(
  p_mailbox_email text,
  p_provider_message_id text
)
returns boolean
language sql
volatile
security definer
set search_path = private, public, pg_temp
as $$
  select private.outreach_claim_provider_message(
    p_mailbox_email,
    p_provider_message_id,
    'crm_gmail'
  );
$$;

-- Canary incidents are fail-closed and idempotent. The worker calls this in a
-- fresh transaction after a dispatch transaction fails: trying to trip from a
-- transaction that is about to raise would roll the kill switch back too.
create or replace function private.outreach_trip_canary(
  reason text,
  job_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  state_record public.outreach_system_state%rowtype;
  paused_campaign_count integer := 0;
  released_lease_count integer := 0;
  requeued_lease_count integer := 0;
begin
  if reason is null or reason !~ '^[a-z0-9][a-z0-9_.:-]{0,119}$' then
    raise exception 'Motivo de canary inválido';
  end if;
  -- Exclusive half of the provider-boundary permit. If a send already owns
  -- the shared half, its provider call returns before this trip can commit;
  -- otherwise new sends wait and observe the disabled state.
  perform pg_advisory_xact_lock(20260930, 1);
  if job_id is not null and not exists (
    select 1 from public.outreach_jobs job where job.id = job_id
  ) then
    raise exception 'Job de canary não encontrado';
  end if;

  select * into state_record
  from public.outreach_system_state
  where id
  for update;

  if state_record.id is null or state_record.mode <> 'canary' then
    return false;
  end if;

  update public.outreach_system_state
  set mode = 'disabled',
      send_enabled = false,
      approved_by = null,
      approved_at = null,
      last_incident_at = now(),
      last_incident_reason = reason,
      kill_reason = 'canary_trip:' || reason,
      updated_at = now()
  where id;

  update public.outreach_campaigns
  set status = 'paused', paused_at = now(), updated_at = now()
  where status = 'running';
  get diagnostics paused_campaign_count = row_count;

  update public.outreach_mailboxes
  set ramp_daily_limit = 1,
      ramp_started_at = now(),
      last_incident_at = now(),
      updated_at = now()
  where send_enabled or status = 'active';

  -- Only a ledger proves that a leased job may have crossed the provider
  -- boundary. A pre-dispatch crash has no ambiguous outcome and is requeued.
  perform set_config('app.outreach_tripping_canary', 'true', true);
  update public.outreach_jobs job
  set status = 'reconciliation_required',
      lease_owner = null,
      lease_expires_at = null,
      last_error = 'canary_tripped:' || reason,
      updated_at = now()
  where job.status = 'leased'
    and exists (select 1 from private.outreach_delivery_ledger ledger where ledger.job_id=job.id);
  get diagnostics released_lease_count = row_count;
  update public.outreach_jobs job
  set status = 'pending', lease_owner = null, lease_expires_at = null,
      last_error = 'canary_released_pre_dispatch:' || reason,
      updated_at = now()
  where job.status = 'leased'
    and not exists (select 1 from private.outreach_delivery_ledger ledger where ledger.job_id=job.id);
  get diagnostics requeued_lease_count = row_count;
  perform set_config('app.outreach_tripping_canary', 'false', true);

  insert into public.outreach_audit_log(
    action, entity_type, entity_id, details
  ) values (
    'canary_tripped', 'system', job_id,
    jsonb_build_object(
      'reason', reason,
      'paused_campaigns', paused_campaign_count,
      'leases_requiring_reconciliation', released_lease_count,
      'leases_requeued_pre_dispatch', requeued_lease_count
    )
  );
  return true;
end;
$$;

-- Delivery incidents are deduplicated independently from suppression rows.
-- This makes provider-webhook retries harmless and gives the threshold
-- calculation one atomic authority for both inbound reports and webhooks.
create table if not exists private.outreach_delivery_incidents (
  source text not null check (source in ('inbound_message', 'provider_webhook')),
  source_id uuid not null,
  kind text not null check (kind in ('hard_bounce', 'complaint')),
  mailbox_id uuid not null references public.outreach_mailboxes(id) on delete cascade,
  campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  job_id uuid references public.outreach_jobs(id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (source, source_id)
);

-- Human adjudication is intentionally separate from the delivery ledger. It
-- keeps the supporting reference private, is immutable per job, and makes an
-- operator decision durable even for legacy jobs that never had a ledger.
create table if not exists private.outreach_job_adjudications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.outreach_jobs(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  outcome text not null check (outcome in ('cancelled', 'confirmed_sent')),
  reason text not null check (char_length(trim(reason)) between 8 and 500),
  evidence_reference text not null check (char_length(trim(evidence_reference)) between 8 and 2000),
  provider_message_id text,
  created_at timestamptz not null default now()
);

create or replace function private.outreach_record_delivery_incident(
  incident_kind text,
  incident_mailbox_id uuid,
  incident_campaign_id uuid,
  incident_job_id uuid,
  incident_source text,
  incident_source_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  state_record public.outreach_system_state%rowtype;
  mailbox_timezone text;
  metric_day date;
  inserted boolean := false;
  total_sent bigint := 0;
  total_bounces bigint := 0;
  total_complaints bigint := 0;
  bounce_rate numeric := 0;
  complaint_rate numeric := 0;
  bounce_warning_threshold numeric;
  bounce_pause_threshold numeric;
  complaint_pause_threshold numeric;
  pause_required boolean := false;
  warning_required boolean := false;
  paused_campaign_count integer := 0;
  reconciliation_count integer := 0;
  requeued_count integer := 0;
begin
  if incident_kind not in ('hard_bounce', 'complaint') then
    raise exception 'Tipo de incidente de delivery inválido';
  end if;
  if incident_source not in ('inbound_message', 'provider_webhook') then
    raise exception 'Origem de incidente de delivery inválida';
  end if;
  if incident_source_id is null then
    raise exception 'Identificador de incidente de delivery obrigatório';
  end if;

  perform pg_advisory_xact_lock(20260930, 1);

  -- Lock order is global state then mailbox everywhere in this function. Two
  -- simultaneous events at the threshold therefore cannot both observe the
  -- pre-threshold aggregate and escape enforcement.
  select * into state_record
  from public.outreach_system_state
  where id
  for update;
  if state_record.id is null then
    raise exception 'Estado global Outreach não inicializado';
  end if;

  select timezone into mailbox_timezone
  from public.outreach_mailboxes
  where id = incident_mailbox_id
  for update;
  if mailbox_timezone is null then
    raise exception 'Mailbox do incidente não encontrada';
  end if;
  if incident_job_id is not null and not exists (
    select 1 from public.outreach_jobs job
    where job.id = incident_job_id and job.mailbox_id = incident_mailbox_id
  ) then
    raise exception 'Job do incidente não pertence à mailbox';
  end if;

  insert into private.outreach_delivery_incidents(
    source, source_id, kind, mailbox_id, campaign_id, job_id
  ) values (
    incident_source, incident_source_id, incident_kind,
    incident_mailbox_id, incident_campaign_id, incident_job_id
  )
  on conflict (source, source_id) do nothing
  returning true into inserted;
  if not coalesce(inserted, false) then
    return false;
  end if;

  metric_day := (now() at time zone coalesce(mailbox_timezone, 'Europe/Lisbon'))::date;
  insert into public.outreach_metric_daily(
    metric_date, campaign_id, mailbox_id, hard_bounces, complaints
  ) values (
    metric_day, incident_campaign_id, incident_mailbox_id,
    case when incident_kind = 'hard_bounce' then 1 else 0 end,
    case when incident_kind = 'complaint' then 1 else 0 end
  )
  on conflict (metric_date, campaign_id, mailbox_id) do update set
    hard_bounces = public.outreach_metric_daily.hard_bounces + excluded.hard_bounces,
    complaints = public.outreach_metric_daily.complaints + excluded.complaints,
    updated_at = now();

  select coalesce(sum(sent), 0), coalesce(sum(hard_bounces), 0),
         coalesce(sum(complaints), 0)
  into total_sent, total_bounces, total_complaints
  from public.outreach_metric_daily
  where mailbox_id = incident_mailbox_id
    and metric_date >= metric_day - 29;

  -- An incident with a missing sent denominator is inconsistent and must not
  -- dilute to zero. Treat its rate as 100%, failing closed without division by
  -- zero; normal traffic uses the explicit rolling 30-day percentage.
  bounce_rate := case
    when total_sent = 0 then case when total_bounces > 0 then 100 else 0 end
    else 100.0 * total_bounces / total_sent
  end;
  complaint_rate := case
    when total_sent = 0 then case when total_complaints > 0 then 100 else 0 end
    else 100.0 * total_complaints / total_sent
  end;
  bounce_warning_threshold := coalesce((state_record.settings ->> 'bounceWarningThreshold')::numeric, 3);
  bounce_pause_threshold := coalesce((state_record.settings ->> 'bouncePauseThreshold')::numeric, 5);
  complaint_pause_threshold := coalesce((state_record.settings ->> 'complaintPauseThreshold')::numeric, 0.1);
  warning_required := incident_kind = 'hard_bounce'
    and bounce_rate >= bounce_warning_threshold;
  pause_required := (incident_kind = 'hard_bounce' and bounce_rate >= bounce_pause_threshold)
    or (incident_kind = 'complaint' and complaint_rate >= complaint_pause_threshold);

  update public.outreach_mailboxes
  set last_incident_at = now(), updated_at = now()
  where id = incident_mailbox_id;
  update public.outreach_system_state
  set last_incident_at = now(), last_incident_reason = incident_kind,
      updated_at = now()
  where id;

  if state_record.mode = 'canary' then
    perform private.outreach_trip_canary(incident_kind, incident_job_id);
    return true;
  end if;

  if state_record.mode <> 'live' or not pause_required then
    insert into public.outreach_audit_log(action, entity_type, entity_id, details)
    values (
      case when warning_required then 'delivery_incident_warning' else 'delivery_incident_recorded' end,
      'mailbox', incident_mailbox_id,
      jsonb_build_object(
        'kind', incident_kind,
        'window_days', 30,
        'sent', total_sent,
        'hard_bounces', total_bounces,
        'complaints', total_complaints,
        'bounce_rate', round(bounce_rate, 4),
        'complaint_rate', round(complaint_rate, 4),
        'mode', state_record.mode
      )
    );
    return false;
  end if;

  update public.outreach_system_state
  set mode = 'disabled', send_enabled = false,
      approved_by = null, approved_at = null,
      kill_reason = 'delivery_threshold:' || incident_kind,
      updated_at = now()
  where id;
  update public.outreach_campaigns
  set status = 'paused', paused_at = now(), updated_at = now()
  where status = 'running';
  get diagnostics paused_campaign_count = row_count;
  update public.outreach_mailboxes
  set ramp_daily_limit = 1, ramp_started_at = now(), updated_at = now()
  where ramp_daily_limit <> 1 or status = 'active' or send_enabled;

  perform set_config('app.outreach_tripping_canary', 'true', true);
  update public.outreach_jobs job
  set status = 'reconciliation_required', lease_owner = null,
      lease_expires_at = null,
      last_error = 'delivery_threshold:' || incident_kind,
      updated_at = now()
  where job.status = 'leased'
    and exists (select 1 from private.outreach_delivery_ledger ledger where ledger.job_id = job.id);
  get diagnostics reconciliation_count = row_count;
  update public.outreach_jobs job
  set status = 'pending', lease_owner = null, lease_expires_at = null,
      last_error = 'delivery_threshold_released_pre_dispatch',
      updated_at = now()
  where job.status = 'leased'
    and not exists (select 1 from private.outreach_delivery_ledger ledger where ledger.job_id = job.id);
  get diagnostics requeued_count = row_count;
  perform set_config('app.outreach_tripping_canary', 'false', true);

  insert into public.outreach_audit_log(action, entity_type, entity_id, details)
  values (
    'delivery_threshold_paused', 'mailbox', incident_mailbox_id,
    jsonb_build_object(
      'kind', incident_kind,
      'window_days', 30,
      'sent', total_sent,
      'hard_bounces', total_bounces,
      'complaints', total_complaints,
      'bounce_rate', round(bounce_rate, 4),
      'complaint_rate', round(complaint_rate, 4),
      'threshold', case when incident_kind = 'hard_bounce'
        then bounce_pause_threshold else complaint_pause_threshold end,
      'paused_campaigns', paused_campaign_count,
      'leases_requiring_reconciliation', reconciliation_count,
      'leases_requeued_pre_dispatch', requeued_count
    )
  );
  return true;
end;
$$;

create or replace function private.outreach_adjudicate_job_reconciliation(
  target_job_id uuid,
  actor_id uuid,
  target_outcome text,
  adjudication_reason text,
  evidence_reference text,
  confirmed_provider_message_id text default null
)
returns public.outreach_jobs
language plpgsql
security definer
set search_path = private, public, extensions, pg_temp
as $$
declare
  job_record public.outreach_jobs%rowtype;
  ledger_record private.outreach_delivery_ledger%rowtype;
  message_record public.outreach_messages%rowtype;
  evidence_sha256 text;
  not_found_count integer := 0;
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = actor_id and profile.ativo and profile.role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'Apenas administradores podem adjudicar jobs ambíguos';
  end if;
  if target_outcome not in ('cancelled', 'confirmed_sent') then
    raise exception 'Resultado de adjudicação inválido';
  end if;
  adjudication_reason := nullif(trim(adjudication_reason), '');
  evidence_reference := nullif(trim(evidence_reference), '');
  if adjudication_reason is null or char_length(adjudication_reason) not between 8 and 500 then
    raise exception 'Motivo de adjudicação inválido';
  end if;
  if evidence_reference is null or char_length(evidence_reference) not between 8 and 2000 then
    raise exception 'Evidência de adjudicação inválida';
  end if;

  select * into job_record
  from public.outreach_jobs job
  where job.id = target_job_id
  for update;
  if job_record.id is null or job_record.status <> 'reconciliation_required' then
    raise exception 'Job não está pendente de reconciliação';
  end if;
  if exists (
    select 1 from private.outreach_job_adjudications adjudication
    where adjudication.job_id = target_job_id
  ) then
    raise exception 'Job já foi adjudicado';
  end if;

  select * into ledger_record
  from private.outreach_delivery_ledger ledger
  where ledger.job_id = target_job_id
  for update;
  if ledger_record.id is not null then
    not_found_count := coalesce(
      nullif(ledger_record.provider_response ->> 'reconciliationNotFoundCount', '')::integer,
      0
    );
  end if;

  if target_outcome = 'cancelled' then
    if ledger_record.id is null then
      if job_record.legacy_id is null then
        raise exception 'Só jobs legados sem ledger podem ser encerrados por esta via';
      end if;
    elsif ledger_record.status not in ('sending', 'accepted', 'ambiguous')
       or not_found_count < 2
       or ledger_record.provider_response ->> 'lastReconciliation' is distinct from 'not_found' then
      raise exception 'O ledger ainda não tem prova persistente de ausência no provider';
    end if;
  else
    confirmed_provider_message_id := nullif(trim(confirmed_provider_message_id), '');
    if confirmed_provider_message_id is null then
      raise exception 'providerMessageId confirmado é obrigatório';
    end if;
    select * into message_record
    from public.outreach_messages message
    where message.mailbox_id = job_record.mailbox_id
      and message.campaign_id = job_record.campaign_id
      and message.recipient_id = job_record.recipient_id
      and message.direction = 'outbound'
      and message.provider_message_id = confirmed_provider_message_id;
    if message_record.id is null then
      raise exception 'A evidência não corresponde a uma mensagem outbound deste job';
    end if;
  end if;

  evidence_sha256 := encode(extensions.digest(evidence_reference, 'sha256'), 'hex');
  insert into private.outreach_job_adjudications(
    job_id, actor_id, outcome, reason, evidence_reference, provider_message_id
  ) values (
    target_job_id, actor_id, target_outcome, adjudication_reason,
    evidence_reference, confirmed_provider_message_id
  );

  if target_outcome = 'confirmed_sent' then
    update public.outreach_jobs
    set status = 'sent', provider_message_id = confirmed_provider_message_id,
        sent_at = message_record.occurred_at, lease_owner = null,
        lease_expires_at = null, last_error = null, updated_at = now()
    where id = target_job_id
    returning * into job_record;
    if ledger_record.id is not null then
      update private.outreach_delivery_ledger
      set status = 'confirmed', provider_message_id = confirmed_provider_message_id,
          provider_response = provider_response || jsonb_build_object(
            'adminAdjudication', target_outcome,
            'adjudicatedAt', now(),
            'evidenceSha256', evidence_sha256
          ),
          last_attempt_at = now()
      where id = ledger_record.id;
    end if;
  else
    update public.outreach_jobs
    set status = 'cancelled', lease_owner = null, lease_expires_at = null,
        last_error = 'admin_adjudicated_no_retry:' || left(adjudication_reason, 500),
        updated_at = now()
    where id = target_job_id
    returning * into job_record;
    if ledger_record.id is not null then
      update private.outreach_delivery_ledger
      set status = 'reconciled',
          provider_response = provider_response || jsonb_build_object(
            'adminAdjudication', target_outcome,
            'adjudicatedAt', now(),
            'evidenceSha256', evidence_sha256
          ),
          last_attempt_at = now()
      where id = ledger_record.id;
    end if;
  end if;

  insert into public.outreach_audit_log(
    actor_id, action, entity_type, entity_id, details
  ) values (
    actor_id, 'job.reconciliation.adjudicated', 'job', target_job_id,
    jsonb_build_object(
      'outcome', target_outcome,
      'reason', adjudication_reason,
      'evidence_sha256', evidence_sha256,
      'provider_message_id', confirmed_provider_message_id,
      'legacy_job', job_record.legacy_id is not null,
      'not_found_count', not_found_count,
      'never_requeue', true
    )
  );
  return job_record;
end;
$$;

create or replace function private.record_outreach_job_incident()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  incident_reason text;
  current_mode public.outreach_system_mode;
begin
  if current_setting('app.outreach_tripping_canary', true) = 'true' then
    return new;
  end if;
  if new.status not in ('failed', 'reconciliation_required')
     or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then
    return new;
  end if;

  incident_reason := 'job_' || new.status::text;
  update public.outreach_system_state
  set last_incident_at = now(),
      last_incident_reason = incident_reason,
      updated_at = now()
  where id
  returning mode into current_mode;

  if current_mode = 'canary' then
    perform private.outreach_trip_canary(incident_reason, new.id);
  end if;
  return new;
end;
$$;

create trigger record_outreach_job_incident
after insert or update of status on public.outreach_jobs
for each row execute function private.record_outreach_job_incident();

-- Side effects are derived from provider messages exactly once. The public
-- table deduplicates Outreach storage; the private mailbox-email gate above
-- deduplicates effects shared with the CRM Gmail sync.
create or replace function private.process_outreach_message()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  campaign_record public.outreach_campaigns%rowtype;
  recipient_record public.outreach_recipients%rowtype;
  mailbox_record public.outreach_mailboxes%rowtype;
  thread_record public.outreach_threads%rowtype;
  activity_user_id uuid;
  metric_day date;
  positive_reply boolean := false;
  message_source text;
  owns_shared_claim boolean := false;
begin
  if current_setting('app.outreach_importing', true) = 'true' then
    return new;
  end if;

  select * into campaign_record from public.outreach_campaigns where id = new.campaign_id;
  select * into recipient_record from public.outreach_recipients where id = new.recipient_id;
  select * into mailbox_record from public.outreach_mailboxes where id = new.mailbox_id;
  select * into thread_record from public.outreach_threads where id = new.thread_id;

  if mailbox_record.id is null then
    return new;
  end if;
  message_source := case
    when new.direction = 'outbound' then 'outreach_outbound'
    else 'outreach_inbound'
  end;
  select exists (
    select 1 from private.communication_provider_message_ledger shared
    where shared.mailbox_email = lower(mailbox_record.email::text)::citext
      and shared.provider_message_id = new.provider_message_id
      and shared.first_source = message_source
  ) into owns_shared_claim;
  if not owns_shared_claim then
    owns_shared_claim := private.outreach_claim_provider_message(
      mailbox_record.email::text,
      new.provider_message_id,
      message_source
    );
  end if;

  insert into private.outreach_provider_message_ledger(mailbox_id, provider_message_id, source)
  values (
    new.mailbox_id,
    new.provider_message_id,
    message_source
  )
  on conflict do nothing;

  if new.thread_id is not null then
    update public.outreach_threads
    set last_message_at = greatest(last_message_at, new.occurred_at),
        unread = case when new.direction = 'inbound' then true else unread end,
        updated_at = now()
    where id = new.thread_id;
  end if;

  metric_day := (new.occurred_at at time zone coalesce(mailbox_record.timezone, 'Europe/Lisbon'))::date;

  if new.direction = 'outbound' then
    update public.outreach_recipients
    set status = case when status in ('pending', 'eligible') then 'active' else status end,
        updated_at = now()
    where id = new.recipient_id;

    if owns_shared_claim then
      -- The common gate owns only effects also produced by Gmail sync. Local
      -- Outreach state and metrics above/below always process the unique row.
      update public.contactos
      set estado = 'contactado', updated_at = now()
      where id = new.contact_id and estado = 'nao_contactado';

      update public.oportunidades
      set estado = 'contactado',
          data_primeiro_contacto = coalesce(data_primeiro_contacto, new.occurred_at::date),
          updated_at = now()
      where estado = 'nao_contactado'
        and not arquivado
        and (
          contacto_principal_id = new.contact_id
          or (contacto_principal_id is null and empresa_id = new.company_id)
        );
    end if;

    insert into public.outreach_metric_daily(metric_date, campaign_id, mailbox_id, sent)
    values (metric_day, new.campaign_id, new.mailbox_id, 1)
    on conflict (metric_date, campaign_id, mailbox_id) do update
    set sent = public.outreach_metric_daily.sent + 1, updated_at = now();
    return new;
  end if;

  -- Automatic/OOO replies remain visible in the thread but do not stop the
  -- sequence or count as a human response.
  if new.kind in ('email', 'reply') then
    update public.outreach_recipients
    set status = 'replied', responded_at = coalesce(responded_at, new.occurred_at), updated_at = now()
    where id = new.recipient_id and status not in ('suppressed', 'bounced', 'deleted');

    update public.outreach_jobs job
    set status = case
          when job.status = 'reconciliation_required' or exists (
            select 1 from private.outreach_delivery_ledger ledger
            where ledger.job_id = job.id
              and ledger.status in ('sending', 'accepted', 'ambiguous')
          ) then 'reconciliation_required'::public.outreach_job_status
          else 'cancelled'::public.outreach_job_status
        end,
        lease_owner = null, lease_expires_at = null,
        last_error = 'reply_received', updated_at = now()
    where job.recipient_id = new.recipient_id
      and job.status in ('pending', 'leased', 'reconciliation_required');

    if campaign_record.stop_company_on_reply and new.company_id is not null then
      update public.outreach_jobs j
      set status = case
            when j.status = 'reconciliation_required' or exists (
              select 1 from private.outreach_delivery_ledger ledger
              where ledger.job_id = j.id
                and ledger.status in ('sending', 'accepted', 'ambiguous')
            ) then 'reconciliation_required'::public.outreach_job_status
            else 'cancelled'::public.outreach_job_status
          end,
          lease_owner = null, lease_expires_at = null,
          last_error = 'company_reply_received', updated_at = now()
      from public.outreach_recipients r
      where r.id = j.recipient_id
        and r.campaign_id = new.campaign_id
        and r.company_id = new.company_id
        and j.status in ('pending', 'leased', 'reconciliation_required');
    end if;

    insert into public.outreach_metric_daily(metric_date, campaign_id, mailbox_id, replies)
    values (metric_day, new.campaign_id, new.mailbox_id, 1)
    on conflict (metric_date, campaign_id, mailbox_id) do update
    set replies = public.outreach_metric_daily.replies + 1, updated_at = now();
  end if;

  positive_reply := new.kind = 'reply'
    and coalesce(thread_record.classification = 'positive', false);
  if positive_reply then
    activity_user_id := coalesce(
      thread_record.assigned_to,
      mailbox_record.owner_profile_id,
      campaign_record.created_by
    );

    if owns_shared_claim
       and activity_user_id is not null and new.contact_id is not null and new.company_id is not null
       and not exists (
         select 1 from public.atividades a
         where lower(a.source_mailbox_email::text) = lower(mailbox_record.email::text)
           and a.message_id = new.provider_message_id
           and a.contacto_id = new.contact_id
       ) then
      insert into public.atividades(
        oportunidade_id, empresa_id, contacto_id, user_id, tipo, data,
        descricao, message_id, thread_id, assunto, snippet, direcao,
        source_mailbox_email
      )
      select
        opportunity.id,
        new.company_id,
        new.contact_id,
        activity_user_id,
        'email_recebido',
        new.occurred_at,
        coalesce(nullif(new.subject, ''), 'Resposta positiva de Outreach'),
        new.provider_message_id,
        new.provider_thread_id,
        new.subject,
        new.snippet,
        'recebido',
        mailbox_record.email
      from (values (1)) seed(n)
      left join lateral (
        select o.id
        from public.oportunidades o
        where o.empresa_id = new.company_id and not o.arquivado
        order by o.updated_at desc
        limit 1
      ) opportunity on true;

      -- A previous dismissal must not hide a genuinely new positive reply.
      delete from public.follow_up_dismissals
      where contact_id = new.contact_id and user_id = activity_user_id;
    end if;

    insert into public.outreach_metric_daily(
      metric_date, campaign_id, mailbox_id, positive_replies
    ) values (metric_day, new.campaign_id, new.mailbox_id, 1)
    on conflict (metric_date, campaign_id, mailbox_id) do update
    set positive_replies = public.outreach_metric_daily.positive_replies + 1,
        updated_at = now();
  end if;

  if new.kind in ('hard_bounce', 'complaint', 'unsubscribe') and recipient_record.email_snapshot is not null then
    insert into public.communication_suppressions(
      scope, email, company_id, reason, source, note
    ) values (
      'email', recipient_record.email_snapshot, recipient_record.company_id,
      case new.kind
        when 'hard_bounce' then 'hard_bounce'
        when 'complaint' then 'complaint'
        else 'unsubscribe'
      end,
      'outreach',
      'Criado automaticamente por evento do provider'
    ) on conflict do nothing;

    update public.outreach_recipients
    set status = case
          when new.kind = 'hard_bounce' then 'bounced'::public.outreach_recipient_status
          else 'suppressed'::public.outreach_recipient_status
        end,
        unsubscribed_at = case when new.kind = 'unsubscribe' then new.occurred_at else unsubscribed_at end,
        updated_at = now()
    where id = new.recipient_id;

    if new.kind = 'unsubscribe' then
      insert into public.outreach_metric_daily(
        metric_date, campaign_id, mailbox_id, unsubscribes
      ) values (metric_day, new.campaign_id, new.mailbox_id, 1)
      on conflict (metric_date, campaign_id, mailbox_id) do update set
        unsubscribes = public.outreach_metric_daily.unsubscribes + 1,
        updated_at = now();
    elsif new.kind in ('complaint', 'hard_bounce') then
      perform private.outreach_record_delivery_incident(
        new.kind::text, new.mailbox_id, new.campaign_id, null,
        'inbound_message', new.id
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger process_outreach_message
after insert on public.outreach_messages
for each row execute function private.process_outreach_message();

-- Contact deletion retains only the global HMAC tombstone and anonymous daily
-- aggregates. Operational rows and provider identifiers are removed because
-- they can still be linked back to a person when combined with provider data.
create or replace function private.redact_outreach_contact()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  contact_hmac bytea;
  recipient_ids uuid[] := '{}'::uuid[];
  job_ids uuid[] := '{}'::uuid[];
  message_ids uuid[] := '{}'::uuid[];
  thread_ids uuid[] := '{}'::uuid[];
begin
  perform set_config('app.outreach_redacting_contact', old.id::text, true);
  contact_hmac := case
    when old.email is not null then private.outreach_identity_hmac(old.email::text)
    else private.outreach_identity_hmac(old.id::text)
  end;

  insert into public.communication_suppressions(
    scope, email, company_id, identity_hmac, reason, source, note, created_by
  ) values (
    'email',
    old.email,
    null,
    contact_hmac,
    'contact_deleted', 'rgpd', '', auth.uid()
  ) on conflict do nothing;

  -- Drop the clear identity immediately after its keyed digest has been stored.
  update public.communication_suppressions
  set email = null, domain = null, company_id = null, note = ''
  where active and (
    identity_hmac = contact_hmac
    or (
      old.email is not null
      and private.outreach_identity_hmac_matches(identity_hmac, old.email::text)
    )
  );

  select coalesce(array_agg(r.id), '{}'::uuid[]) into recipient_ids
  from public.outreach_recipients r where r.contact_id = old.id;
  select coalesce(array_agg(j.id), '{}'::uuid[]) into job_ids
  from public.outreach_jobs j where j.recipient_id = any(recipient_ids);
  select coalesce(array_agg(m.id), '{}'::uuid[]) into message_ids
  from public.outreach_messages m
  where m.contact_id = old.id or m.recipient_id = any(recipient_ids);
  select coalesce(array_agg(t.id), '{}'::uuid[]) into thread_ids
  from public.outreach_threads t
  where t.contact_id = old.id or t.recipient_id = any(recipient_ids);

  delete from public.outreach_events e
  where e.recipient_id = any(recipient_ids)
     or e.message_id = any(message_ids)
     or e.dimensions::text like '%' || old.id::text || '%'
     or (old.email is not null and lower(e.dimensions::text) like '%' || lower(old.email::text) || '%');

  update public.outreach_audit_log a
  set entity_id = null,
      details = '{"redacted":true,"reason":"contact_deleted"}'::jsonb
  where a.entity_id = old.id
     or a.entity_id = any(recipient_ids)
     or a.entity_id = any(job_ids)
     or a.entity_id = any(message_ids)
     or a.entity_id = any(thread_ids)
     or a.details::text like '%' || old.id::text || '%'
     or (old.email is not null and lower(a.details::text) like '%' || lower(old.email::text) || '%');

  delete from private.outreach_webhook_events
  where identity_hmac = contact_hmac
     or (
       old.email is not null
       and private.outreach_identity_hmac_matches(identity_hmac, old.email::text)
     );
  delete from private.outreach_inbound_reconciliation
  where identity_hmac = contact_hmac
     or (
       old.email is not null
       and private.outreach_identity_hmac_matches(identity_hmac, old.email::text)
     );
  delete from private.outreach_delivery_ledger
  where recipient_id = any(recipient_ids) or job_id = any(job_ids);
  delete from private.outreach_unsubscribe_tokens
  where recipient_id = any(recipient_ids);
  delete from private.outreach_provider_message_ledger ledger
  using public.outreach_messages message
  where message.id = any(message_ids)
    and ledger.mailbox_id = message.mailbox_id
    and ledger.provider_message_id = message.provider_message_id;
  delete from private.communication_provider_message_ledger ledger
  using public.outreach_messages message, public.outreach_mailboxes mailbox
  where message.id = any(message_ids)
    and mailbox.id = message.mailbox_id
    and ledger.mailbox_email = lower(mailbox.email::text)::citext
    and ledger.provider_message_id = message.provider_message_id;
  delete from private.communication_provider_message_ledger ledger
  using public.atividades activity
  where activity.contacto_id = old.id
    and activity.source_mailbox_email is not null
    and activity.message_id is not null
    and ledger.mailbox_email = lower(activity.source_mailbox_email::text)::citext
    and ledger.provider_message_id = activity.message_id;

  delete from public.outreach_jobs where id = any(job_ids);
  delete from public.outreach_messages where id = any(message_ids);
  delete from public.outreach_threads where id = any(thread_ids);
  delete from public.outreach_email_verifications
  where contact_id = old.id
     or (old.email is not null and lower(email::text) = lower(old.email::text));
  delete from public.outreach_recipients where id = any(recipient_ids);

  perform set_config('app.outreach_redacting_contact', '', true);
  return old;
end;
$$;

create trigger redact_outreach_contact
before delete on public.contactos
for each row execute function private.redact_outreach_contact();

-- Extend the existing atomic CRM deletion.  The contact trigger above owns
-- Outreach redaction, so every deletion path receives the same protection.
create or replace function public.delete_commercial_records(
  p_contact_ids uuid[],
  p_company_ids uuid[],
  p_opportunity_ids uuid[],
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  company_ids uuid[];
  deleted_contacts integer := 0;
  deleted_companies integer := 0;
  deleted_opportunities integer := 0;
  deleted_activities integer := 0;
  deleted_revenue integer := 0;
  outreach_recipients_redacted integer := 0;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and ativo and role = 'admin'
  ) then
    raise exception 'Apenas administradores podem eliminar registos comerciais';
  end if;

  select coalesce(array_agg(distinct resolved.empresa_id), '{}'::uuid[])
  into company_ids
  from (
    select e.id as empresa_id from public.empresas e
      where e.id = any(coalesce(p_company_ids, '{}'::uuid[]))
    union
    select c.empresa_id from public.contactos c
      where c.id = any(coalesce(p_contact_ids, '{}'::uuid[]))
    union
    select o.empresa_id from public.oportunidades o
      where o.id = any(coalesce(p_opportunity_ids, '{}'::uuid[]))
  ) resolved;

  if cardinality(company_ids) = 0 then
    return jsonb_build_object(
      'deleted', 0, 'deleted_contacts', 0, 'deleted_companies', 0,
      'deleted_opportunities', 0, 'deleted_activities', 0,
      'deleted_revenue', 0, 'outreach_recipients_redacted', 0,
      'outreach_recipients_removed', 0,
      'deleted_company_ids', '[]'::jsonb
    );
  end if;

  select count(*)::integer into outreach_recipients_redacted
  from public.outreach_recipients r
  where r.contact_id in (
    select c.id from public.contactos c where c.empresa_id = any(company_ids)
  );

  insert into public.contact_import_suppressions(
    email_hmac, google_resource_hmac, deleted_by
  )
  select
    case when c.email is not null
      then private.outreach_identity_hmac('email:' || c.email::text)
    end,
    case when c.google_resource_name is not null
      then private.outreach_identity_hmac('google_resource:' || c.google_resource_name)
    end,
    p_actor_id
  from public.contactos c
  where c.empresa_id = any(company_ids)
    and (c.email is not null or c.google_resource_name is not null)
  on conflict do nothing;

  insert into public.audit_log(actor_id, tabela, registo_id, acao, alteracoes)
  select p_actor_id, 'contactos', c.id, 'RGPD_DELETE',
    jsonb_build_object('registo_comercial_removido', true, 'empresa_id', c.empresa_id)
  from public.contactos c where c.empresa_id = any(company_ids);
  insert into public.audit_log(actor_id, tabela, registo_id, acao, alteracoes)
  select p_actor_id, 'oportunidades', o.id, 'RGPD_DELETE',
    jsonb_build_object('registo_comercial_removido', true, 'empresa_id', o.empresa_id)
  from public.oportunidades o where o.empresa_id = any(company_ids);
  insert into public.audit_log(actor_id, tabela, registo_id, acao, alteracoes)
  select p_actor_id, 'empresas', e.id, 'RGPD_DELETE',
    jsonb_build_object('registo_comercial_removido', true)
  from public.empresas e where e.id = any(company_ids);

  delete from public.atividades where empresa_id = any(company_ids);
  get diagnostics deleted_activities = row_count;
  delete from public.faturacao where empresa_id = any(company_ids);
  get diagnostics deleted_revenue = row_count;
  delete from public.estado_historico h using public.oportunidades o
  where h.oportunidade_id = o.id and o.empresa_id = any(company_ids);
  delete from public.oportunidades where empresa_id = any(company_ids);
  get diagnostics deleted_opportunities = row_count;
  delete from public.contactos where empresa_id = any(company_ids);
  get diagnostics deleted_contacts = row_count;
  delete from public.empresas where id = any(company_ids);
  get diagnostics deleted_companies = row_count;

  return jsonb_build_object(
    'deleted', deleted_contacts,
    'deleted_contacts', deleted_contacts,
    'deleted_companies', deleted_companies,
    'deleted_opportunities', deleted_opportunities,
    'deleted_activities', deleted_activities,
    'deleted_revenue', deleted_revenue,
    'outreach_recipients_redacted', outreach_recipients_redacted,
    'outreach_recipients_removed', outreach_recipients_redacted,
    'deleted_company_ids', to_jsonb(company_ids)
  );
end;
$$;

revoke all on function public.delete_commercial_records(uuid[], uuid[], uuid[], uuid)
from public, anon, authenticated;
grant execute on function public.delete_commercial_records(uuid[], uuid[], uuid[], uuid)
to service_role;

-- Idempotent bridge from the frozen v1 JSON snapshot.  It intentionally
-- imports no credentials, OAuth state, webhooks, unsubscribe tokens or local
-- encryption material.  Running/paused campaigns arrive paused and all
-- unresolved work arrives reconciliation_required.
create or replace function private.import_outreach_legacy_snapshot(
  snapshot jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  snapshot_hash bytea := extensions.digest(snapshot::text, 'sha256');
  v_run_id uuid;
  v_actor_id uuid;
  item jsonb;
  nested_item jsonb;
  variant_item jsonb;
  campaign_record public.outreach_campaigns%rowtype;
  v_delivery_message_id uuid;
  v_delivery_occurred_at timestamptz;
  v_mailbox_id uuid;
  v_audience_id uuid;
  v_contact_id uuid;
  v_company_id uuid;
  v_recipient_id uuid;
  v_thread_id uuid;
  v_step_id uuid;
  legacy_email citext;
  normalized_company text;
  legacy_domain text;
  match_count integer;
  import_counts jsonb := jsonb_build_object(
    'mailboxes', jsonb_array_length(coalesce(snapshot -> 'mailboxes', '[]'::jsonb)),
    'leads', jsonb_array_length(coalesce(snapshot -> 'leads', '[]'::jsonb)),
    'campaigns', jsonb_array_length(coalesce(snapshot -> 'campaigns', '[]'::jsonb)),
    'messages', jsonb_array_length(coalesce(snapshot -> 'messages', '[]'::jsonb)),
    'threads', jsonb_array_length(coalesce(snapshot -> 'threads', '[]'::jsonb)),
    'jobs', jsonb_array_length(coalesce(snapshot -> 'jobs', '[]'::jsonb)),
    'jobs_ambiguous', 0,
    'contacts_matched', 0,
    'contacts_created', 0,
    'contacts_ambiguous', 0
  );
  import_ambiguities jsonb := '[]'::jsonb;
  existing_counts jsonb;
begin
  if jsonb_typeof(snapshot) <> 'object'
     or coalesce((snapshot ->> 'version')::integer, 0) <> 1 then
    raise exception 'Snapshot Outreach v1 inválido';
  end if;

  select r.counts into existing_counts
  from private.outreach_import_runs r
  where r.snapshot_sha256 = snapshot_hash
    and r.dry_run = p_dry_run
    and r.status = 'completed';
  if found then
    return jsonb_build_object(
      'idempotent', true,
      'dry_run', p_dry_run,
      'counts', existing_counts
    );
  end if;

  select p.id into v_actor_id
  from public.profiles p
  where p.id = auth.uid() and p.ativo
  limit 1;
  if v_actor_id is null then
    select p.id into v_actor_id
    from public.profiles p
    where p.ativo and p.role = 'admin'
    order by p.created_at
    limit 1;
  end if;
  if v_actor_id is null then raise exception 'Importação requer um administrador ativo'; end if;

  insert into private.outreach_import_runs(snapshot_sha256, dry_run, status)
  values (snapshot_hash, p_dry_run, 'running')
  on conflict (snapshot_sha256, dry_run) do update
  set status = 'running', error = null, started_at = now(), finished_at = null
  returning id into v_run_id;

  -- Preview contact resolution without mutating CRM data.
  for item in select value from jsonb_array_elements(coalesce(snapshot -> 'leads', '[]'::jsonb))
  loop
    legacy_email := nullif(lower(trim(item ->> 'email')), '')::citext;
    normalized_company := nullif(
      lower(regexp_replace(trim(coalesce(item ->> 'company', '')), '\s+', ' ', 'g')),
      ''
    );
    legacy_domain := case
      when position('@' in coalesce(legacy_email::text, '')) > 0
        then lower(split_part(legacy_email::text, '@', 2))
      else null
    end;

    select count(*)::integer into match_count
    from public.contactos c
    where legacy_email is not null and lower(c.email::text) = lower(legacy_email::text);

    if match_count = 1 then
      import_counts := jsonb_set(
        import_counts, '{contacts_matched}',
        to_jsonb((import_counts ->> 'contacts_matched')::integer + 1)
      );
      continue;
    end if;

    select count(*)::integer into match_count
    from public.empresas e
    where normalized_company is not null
      and lower(regexp_replace(trim(e.nome), '\s+', ' ', 'g')) = normalized_company
      and (legacy_domain is null or lower(coalesce(e.email_domain, '')) = legacy_domain);

    if match_count > 1
       or (match_count = 0 and exists (
         select 1 from public.empresas e
         where (normalized_company is not null and lower(regexp_replace(trim(e.nome), '\s+', ' ', 'g')) = normalized_company)
            or (legacy_domain is not null and lower(coalesce(e.email_domain, '')) = legacy_domain)
       ))
       or legacy_email is null or normalized_company is null then
      import_counts := jsonb_set(
        import_counts, '{contacts_ambiguous}',
        to_jsonb((import_counts ->> 'contacts_ambiguous')::integer + 1)
      );
      import_ambiguities := import_ambiguities || jsonb_build_array(jsonb_build_object(
        'legacy_id', item ->> 'id',
        'email_hmac', encode(private.outreach_identity_hmac(coalesce(legacy_email::text, item ->> 'id')), 'hex'),
        'reason', case
          when legacy_email is null then 'email_missing'
          when normalized_company is null then 'company_missing'
          when match_count > 1 then 'multiple_company_matches'
          else 'possible_company_collision'
        end
      ));
    else
      import_counts := jsonb_set(
        import_counts, '{contacts_created}',
        to_jsonb((import_counts ->> 'contacts_created')::integer + 1)
      );
    end if;
  end loop;

  if p_dry_run then
    update private.outreach_import_runs
    set status = 'completed', counts = import_counts,
        ambiguities = import_ambiguities, finished_at = now()
    where id = v_run_id;
    return jsonb_build_object(
      'idempotent', false, 'dry_run', true,
      'counts', import_counts, 'ambiguities', import_ambiguities
    );
  end if;

  perform set_config('app.outreach_importing', 'true', true);
  create temporary table if not exists outreach_legacy_contact_map (
    legacy_id text primary key,
    contact_id uuid not null
  ) on commit drop;
  truncate table outreach_legacy_contact_map;

  -- A real import always begins behind both independent kill switches.
  update public.outreach_system_state
  set mode = 'disabled', send_enabled = false,
      approved_by = null, approved_at = null,
      kill_reason = 'legacy_import', updated_at = now()
  where id;

  for item in select value from jsonb_array_elements(coalesce(snapshot -> 'mailboxes', '[]'::jsonb))
  loop
    if nullif(trim(item ->> 'id'), '') is null or nullif(trim(item ->> 'email'), '') is null then
      continue;
    end if;
    insert into public.outreach_mailboxes(
      legacy_id, provider, email, display_name, status, send_enabled,
      daily_limit, provider_account_id, settings, last_sync_at, last_error, created_by
    ) values (
      item ->> 'id',
      case item ->> 'provider'
        when 'microsoft' then 'microsoft'::public.outreach_mailbox_provider
        when 'smtp' then 'smtp_imap'::public.outreach_mailbox_provider
        else 'google'::public.outreach_mailbox_provider
      end,
      lower(trim(item ->> 'email'))::citext,
      coalesce(item ->> 'senderName', ''),
      'disconnected', false,
      least(10, greatest(1, coalesce((item ->> 'dailyLimit')::integer, 10))),
      null,
      jsonb_build_object(
        'legacy_status', item ->> 'status',
        'legacy_health_score', item -> 'healthScore',
        'requires_reauthorization', true
      ),
      nullif(item ->> 'lastSyncAt', '')::timestamptz,
      'Reautorização obrigatória após migração',
      v_actor_id
    )
    on conflict (email) do update set
      legacy_id = excluded.legacy_id,
      email = excluded.email,
      display_name = excluded.display_name,
      status = 'disconnected',
      send_enabled = false,
      daily_limit = least(10, excluded.daily_limit),
      settings = excluded.settings,
      last_error = excluded.last_error,
      updated_at = now();

    select id into v_mailbox_id from public.outreach_mailboxes where legacy_id = item ->> 'id';
    insert into public.outreach_dns_checks(
      legacy_id, mailbox_id, domain, details, checked_at
    ) values (
      'legacy-dns:' || (item ->> 'id'),
      v_mailbox_id,
      lower(split_part(item ->> 'email', '@', 2))::citext,
      jsonb_build_object(
        'historical_only', true,
        'legacy_authentication', coalesce(item -> 'authentication', '{}'::jsonb)
      ),
      coalesce(nullif(item ->> 'lastSyncAt', '')::timestamptz, now())
    ) on conflict (legacy_id) do nothing;
  end loop;

  -- Resolve by normalized email first. Missing contacts are created only when
  -- company name/domain do not collide with an existing ambiguous candidate.
  for item in select value from jsonb_array_elements(coalesce(snapshot -> 'leads', '[]'::jsonb))
  loop
    legacy_email := nullif(lower(trim(item ->> 'email')), '')::citext;
    if legacy_email is null then continue; end if;
    normalized_company := nullif(
      lower(regexp_replace(trim(coalesce(item ->> 'company', '')), '\s+', ' ', 'g')),
      ''
    );
    legacy_domain := lower(split_part(legacy_email::text, '@', 2));

    select c.id into v_contact_id
    from public.contactos c
    where lower(c.email::text) = lower(legacy_email::text)
    limit 1;

    if v_contact_id is null then
      select count(*)::integer, (array_agg(e.id order by e.id))[1]
      into match_count, v_company_id
      from public.empresas e
      where normalized_company is not null
        and lower(regexp_replace(trim(e.nome), '\s+', ' ', 'g')) = normalized_company
        and lower(coalesce(e.email_domain, '')) = legacy_domain;

      if match_count > 1
         or normalized_company is null
         or (match_count = 0 and exists (
           select 1 from public.empresas e
           where lower(regexp_replace(trim(e.nome), '\s+', ' ', 'g')) = normalized_company
              or lower(coalesce(e.email_domain, '')) = legacy_domain
         )) then
        continue;
      end if;

      if match_count = 0 then
        insert into public.empresas(nome, nome_normalizado, email_domain, origem)
        values (
          trim(item ->> 'company'), normalized_company, legacy_domain, 'outbound_email'
        ) returning id into v_company_id;
      end if;

      insert into public.contactos(
        empresa_id, nome, cargo, email, optout
      ) values (
        v_company_id,
        coalesce(
          nullif(trim(concat_ws(' ', item ->> 'firstName', item ->> 'lastName')), ''),
          split_part(legacy_email::text, '@', 1)
        ),
        nullif(item ->> 'title', ''),
        legacy_email,
        (item ->> 'status') in ('unsubscribed', 'suppressed', 'bounced')
      ) returning id into v_contact_id;
    else
      select c.empresa_id into v_company_id from public.contactos c where c.id = v_contact_id;
    end if;

    insert into pg_temp.outreach_legacy_contact_map(legacy_id, contact_id)
    values (item ->> 'id', v_contact_id)
    on conflict (legacy_id) do update set contact_id = excluded.contact_id;

    insert into public.outreach_email_verifications(
      legacy_id, contact_id, email, status, provider, reasons,
      verified_at, expires_at
    ) values (
      'legacy-verification:' || (item ->> 'id'),
      v_contact_id, legacy_email, 'unknown', 'legacy_snapshot',
      array['historical_' || coalesce(item ->> 'verification', 'unknown')],
      null, now()
    ) on conflict (legacy_id) do nothing;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(snapshot -> 'campaigns', '[]'::jsonb))
  loop
    if nullif(item ->> 'id', '') is null then continue; end if;
    insert into public.outreach_campaigns(
      legacy_id, nome, descricao, status, created_by,
      stop_company_on_reply, timezone, send_days,
      send_window_start, send_window_end, starts_at, ends_at,
      daily_limit, gap_minutes, jitter_minutes, launched_at
    ) values (
      item ->> 'id',
      coalesce(nullif(trim(item ->> 'name'), ''), 'Campanha importada'),
      coalesce(item ->> 'description', ''),
      case item ->> 'status'
        when 'completed' then 'completed'::public.outreach_campaign_status
        when 'draft' then 'draft'::public.outreach_campaign_status
        else 'paused'::public.outreach_campaign_status
      end,
      v_actor_id,
      coalesce((item #>> '{settings,stopCompanyOnReply}')::boolean, true),
      coalesce(nullif(item #>> '{schedule,timezone}', ''), 'Europe/Lisbon'),
      coalesce(array(
        select value::smallint
        from jsonb_array_elements_text(coalesce(item #> '{schedule,days}', '[1,2,3,4,5]'::jsonb))
      ), array[1,2,3,4,5]::smallint[]),
      coalesce(nullif(item #>> '{schedule,startTime}', '')::time, '09:00'::time),
      coalesce(nullif(item #>> '{schedule,endTime}', '')::time, '17:00'::time),
      nullif(item #>> '{schedule,startsAt}', '')::timestamptz,
      nullif(item #>> '{schedule,endsAt}', '')::timestamptz,
      greatest(1, coalesce((item ->> 'dailyLimit')::integer, 10)),
      greatest(0, coalesce((item #>> '{settings,gapMinutes}')::integer, 5)),
      greatest(0, coalesce((item #>> '{settings,jitterMinutes}')::integer, 2)),
      nullif(item ->> 'launchedAt', '')::timestamptz
    )
    on conflict (legacy_id) do update set
      nome = excluded.nome, descricao = excluded.descricao,
      status = excluded.status, stop_company_on_reply = excluded.stop_company_on_reply,
      timezone = excluded.timezone, send_days = excluded.send_days,
      send_window_start = excluded.send_window_start,
      send_window_end = excluded.send_window_end,
      updated_at = now();

    select * into campaign_record from public.outreach_campaigns where legacy_id = item ->> 'id';
    insert into public.outreach_audiences(legacy_id, nome, descricao, filter_definition, created_by)
    values (
      'audience:' || (item ->> 'id'),
      'Audiência — ' || campaign_record.nome,
      'Importada do Outreach standalone',
      jsonb_build_object('legacy_campaign_id', item ->> 'id'),
      v_actor_id
    ) on conflict (legacy_id) do update set nome = excluded.nome, updated_at = now();
    select id into v_audience_id from public.outreach_audiences where legacy_id = 'audience:' || (item ->> 'id');

    for nested_item in select value from jsonb_array_elements(coalesce(item -> 'sequence', '[]'::jsonb))
    loop
      insert into public.outreach_campaign_steps(
        legacy_id, campaign_id, position, kind, delay_minutes, ativo
      ) values (
        (item ->> 'id') || ':' || (nested_item ->> 'id'),
        campaign_record.id,
        greatest(1, coalesce((nested_item ->> 'order')::integer, 1)),
        case when nested_item ->> 'kind' = 'wait' then 'wait' else 'email' end,
        greatest(0,
          coalesce((nested_item ->> 'delayDays')::integer, 0) * 1440
          + coalesce((nested_item ->> 'delayHours')::integer, 0) * 60
        ),
        true
      ) on conflict (legacy_id) do update set
        position = excluded.position, kind = excluded.kind,
        delay_minutes = excluded.delay_minutes, updated_at = now();
      select id into v_step_id from public.outreach_campaign_steps
      where legacy_id = (item ->> 'id') || ':' || (nested_item ->> 'id');

      for variant_item in select value from jsonb_array_elements(coalesce(nested_item -> 'variants', '[]'::jsonb))
      loop
        insert into public.outreach_campaign_variants(
          legacy_id, step_id, nome, weight, subject_template, body_template
        ) values (
          (item ->> 'id') || ':' || (nested_item ->> 'id') || ':' || (variant_item ->> 'id'),
          v_step_id,
          coalesce(nullif(variant_item ->> 'name', ''), 'A'),
          greatest(0, coalesce((variant_item ->> 'weight')::integer, 100)),
          coalesce(variant_item ->> 'subject', ''),
          coalesce(variant_item ->> 'body', '')
        ) on conflict (legacy_id) do update set
          nome = excluded.nome, weight = excluded.weight,
          subject_template = excluded.subject_template,
          body_template = excluded.body_template,
          updated_at = now();
      end loop;
    end loop;

    for nested_item in select value from jsonb_array_elements(coalesce(item -> 'leadIds', '[]'::jsonb))
    loop
      select m.contact_id into v_contact_id
      from pg_temp.outreach_legacy_contact_map m
      where m.legacy_id = trim(both '"' from nested_item::text);
      if v_contact_id is null then continue; end if;
      select c.empresa_id into v_company_id from public.contactos c where c.id = v_contact_id;

      insert into public.outreach_audience_members(
        legacy_id, audience_id, contact_id, eligibility_status,
        eligibility_reasons, added_by
      ) values (
        'audience-member:' || (item ->> 'id') || ':' || trim(both '"' from nested_item::text),
        v_audience_id, v_contact_id, 'pending', array['requires_fresh_eligibility_check'], v_actor_id
      ) on conflict (audience_id, contact_id) do nothing;

      insert into public.outreach_recipients(
        legacy_id, campaign_id, audience_member_id, contact_id, company_id,
        email_snapshot, variable_snapshot, status, eligibility_reasons
      )
      select
        'recipient:' || (item ->> 'id') || ':' || trim(both '"' from nested_item::text),
        campaign_record.id, member.id, v_contact_id, v_company_id, c.email,
        '{}'::jsonb, 'reconciliation_required', array['legacy_import_requires_review']
      from public.contactos c
      join public.outreach_audience_members member
        on member.audience_id = v_audience_id and member.contact_id = v_contact_id
      where c.id = v_contact_id
      on conflict (legacy_id) do update set
        contact_id = excluded.contact_id, company_id = excluded.company_id,
        email_snapshot = excluded.email_snapshot,
        status = 'reconciliation_required',
        eligibility_reasons = excluded.eligibility_reasons,
        updated_at = now();
    end loop;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(snapshot -> 'threads', '[]'::jsonb))
  loop
    select c.id into campaign_record.id from public.outreach_campaigns c where c.legacy_id = item ->> 'campaignId';
    select r.id, r.contact_id, r.company_id into v_recipient_id, v_contact_id, v_company_id
    from public.outreach_recipients r
    where r.legacy_id = 'recipient:' || (item ->> 'campaignId') || ':' || (item ->> 'leadId');
    select m.id into v_mailbox_id from public.outreach_mailboxes m where m.legacy_id = item ->> 'mailboxId';
    if v_mailbox_id is null then continue; end if;

    insert into public.outreach_threads(
      legacy_id, campaign_id, recipient_id, contact_id, company_id,
      mailbox_id, provider_thread_id, subject, status, classification,
      unread, starred, last_message_at
    ) values (
      item ->> 'id', campaign_record.id, v_recipient_id, v_contact_id, v_company_id,
      v_mailbox_id, nullif(item ->> 'providerThreadId', ''), item ->> 'subject',
      (case when coalesce((item ->> 'archived')::boolean, false) then 'archived' else 'open' end)::public.outreach_thread_status,
      case item ->> 'classification'
        when 'interested' then 'positive'
        when 'not-interested' then 'negative'
        when 'auto-reply' then 'auto_reply'
        when 'question' then 'question'
        when 'objection' then 'objection'
        else 'unclassified'
      end,
      coalesce((item ->> 'unread')::boolean, false),
      coalesce((item ->> 'starred')::boolean, false),
      coalesce(nullif(item ->> 'lastMessageAt', '')::timestamptz, now())
    ) on conflict (legacy_id) do update set
      provider_thread_id = excluded.provider_thread_id,
      classification = excluded.classification,
      last_message_at = excluded.last_message_at,
      updated_at = now();
  end loop;

  for item in select value from jsonb_array_elements(coalesce(snapshot -> 'messages', '[]'::jsonb))
  loop
    select t.id, t.campaign_id, t.recipient_id, t.contact_id, t.company_id, t.mailbox_id
    into v_thread_id, campaign_record.id, v_recipient_id, v_contact_id, v_company_id, v_mailbox_id
    from public.outreach_threads t where t.legacy_id = item ->> 'threadId';
    if v_mailbox_id is null then continue; end if;
    insert into public.outreach_messages(
      legacy_id, thread_id, campaign_id, recipient_id, contact_id, company_id,
      mailbox_id, direction, kind, provider_message_id, internet_message_id,
      subject, body_text, occurred_at
    ) values (
      item ->> 'id', v_thread_id, campaign_record.id, v_recipient_id, v_contact_id, v_company_id,
      v_mailbox_id,
      (case when item ->> 'direction' = 'inbound' then 'inbound' else 'outbound' end)::public.outreach_message_direction,
      (case
        when item ->> 'status' = 'bounced' then 'hard_bounce'
        when item ->> 'direction' = 'inbound' then 'reply'
        else 'email'
      end)::public.outreach_message_kind,
      coalesce(nullif(item ->> 'providerMessageId', ''), 'legacy:' || (item ->> 'id')),
      nullif(item ->> 'internetMessageId', ''),
      item ->> 'subject', item ->> 'body',
      coalesce(
        nullif(item ->> 'receivedAt', '')::timestamptz,
        nullif(item ->> 'sentAt', '')::timestamptz,
        now()
      )
    ) on conflict (legacy_id) do nothing;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(snapshot -> 'jobs', '[]'::jsonb))
  loop
    select c.id into campaign_record.id from public.outreach_campaigns c where c.legacy_id = item ->> 'campaignId';
    select r.id into v_recipient_id from public.outreach_recipients r
    where r.legacy_id = 'recipient:' || (item ->> 'campaignId') || ':' || (item ->> 'leadId');
    select s.id into v_step_id from public.outreach_campaign_steps s
    where s.legacy_id = (item ->> 'campaignId') || ':' || (item ->> 'stepId');
    select m.id into v_mailbox_id from public.outreach_mailboxes m where m.legacy_id = item ->> 'mailboxId';
    if v_mailbox_id is null then
      import_counts := jsonb_set(
        import_counts, '{jobs_ambiguous}',
        to_jsonb((import_counts ->> 'jobs_ambiguous')::integer + 1)
      );
      import_ambiguities := import_ambiguities || jsonb_build_array(jsonb_build_object(
        'legacy_type', 'job',
        'legacy_id', item ->> 'id',
        'mailbox_legacy_id', item ->> 'mailboxId',
        'reason', 'mailbox_missing'
      ));
      continue;
    end if;
    if campaign_record.id is null or v_recipient_id is null or v_step_id is null then continue; end if;
    v_delivery_message_id := null;
    v_delivery_occurred_at := null;
    if nullif(item ->> 'providerMessageId', '') is not null then
      select message.id,message.occurred_at
      into v_delivery_message_id,v_delivery_occurred_at
      from public.outreach_messages message
      where message.mailbox_id = v_mailbox_id
        and message.campaign_id = campaign_record.id
        and message.recipient_id = v_recipient_id
        and message.direction = 'outbound'
        and message.provider_message_id = item ->> 'providerMessageId';
    end if;
    insert into public.outreach_jobs(
      legacy_id, campaign_id, recipient_id, step_id, mailbox_id,
      scheduled_at, status, attempt_count, idempotency_key,
      provider_message_id, sent_at, last_error
    ) values (
      item ->> 'id', campaign_record.id, v_recipient_id, v_step_id, v_mailbox_id,
      coalesce(nullif(item ->> 'dueAt', '')::timestamptz, now()),
      case
        when v_delivery_message_id is not null then 'sent'::public.outreach_job_status
        when item ->> 'status' = 'cancelled' then 'cancelled'::public.outreach_job_status
        when item ->> 'status' = 'failed' then 'failed'::public.outreach_job_status
        else 'reconciliation_required'::public.outreach_job_status
      end,
      greatest(0, coalesce((item ->> 'attempts')::integer, 0)),
      coalesce(nullif(item ->> 'idempotencyKey', ''), 'legacy:' || (item ->> 'id')),
      nullif(item ->> 'providerMessageId', ''),
      case when v_delivery_message_id is not null then v_delivery_occurred_at else null end,
      case when v_delivery_message_id is not null then null else
        coalesce(item ->> 'failureReason', 'legacy_import_requires_reconciliation') end
    ) on conflict (legacy_id) do update set
      status = excluded.status,
      provider_message_id = excluded.provider_message_id,
      sent_at = excluded.sent_at,
      last_error = excluded.last_error,
      updated_at = now();
  end loop;

  for item in select value from jsonb_array_elements(coalesce(snapshot -> 'suppressions', '[]'::jsonb))
  loop
    if nullif(item ->> 'email', '') is null then continue; end if;
    insert into public.communication_suppressions(
      scope, email, reason, source, note, created_by,
      created_at
    ) values (
      'email', lower(trim(item ->> 'email'))::citext,
      case item ->> 'reason'
        when 'unsubscribe' then 'unsubscribe'
        when 'hard-bounce' then 'hard_bounce'
        when 'complaint' then 'complaint'
        when 'legal' then 'legal'
        else 'manual'
      end,
      'legacy_outreach', coalesce(item ->> 'note', ''), v_actor_id,
      coalesce(nullif(item ->> 'createdAt', '')::timestamptz, now())
    ) on conflict do nothing;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(snapshot -> 'audit', '[]'::jsonb))
  loop
    insert into public.outreach_audit_log(actor_id, action, entity_type, details, created_at)
    select v_actor_id, coalesce(item ->> 'action', 'legacy_event'),
      coalesce(item ->> 'entityType', 'unknown'),
      jsonb_build_object(
        'legacy_id', item ->> 'id',
        'historical_only', true,
        'pii_omitted', true
      ),
      coalesce(nullif(item ->> 'createdAt', '')::timestamptz, now())
    where not exists (
      select 1 from public.outreach_audit_log a
      where a.details ->> 'legacy_id' = item ->> 'id'
    );
  end loop;

  perform set_config('app.outreach_importing', 'false', true);
  update private.outreach_import_runs
  set status = 'completed', counts = import_counts,
      ambiguities = import_ambiguities, finished_at = now()
  where id = v_run_id;

  return jsonb_build_object(
    'idempotent', false, 'dry_run', false,
    'counts', import_counts, 'ambiguities', import_ambiguities,
    'outbound_enabled', false,
    'credentials_imported', false
  );
end;
$$;



-- Lawful-basis fields directly control whether Outreach may contact a person.
-- Keep ordinary CRM edits available to active members, but require the
-- campaign-management capability for these compliance fields and audit every
-- accepted change in the same transaction.
create or replace function public.protect_contact_outreach_compliance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_values jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT'
     and new.outreach_legal_basis is null
     and new.outreach_consent_at is null
     and new.outreach_consent_source is null
     and new.outreach_legal_basis_evidence is null
     and new.outreach_legitimate_interest_purpose is null
     and new.outreach_lia_reference is null
     and new.outreach_legitimate_interest_expires_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.outreach_legal_basis is not distinct from old.outreach_legal_basis
     and new.outreach_consent_at is not distinct from old.outreach_consent_at
     and new.outreach_consent_source is not distinct from old.outreach_consent_source
     and new.outreach_legal_basis_evidence is not distinct from old.outreach_legal_basis_evidence
     and new.outreach_legitimate_interest_purpose is not distinct from old.outreach_legitimate_interest_purpose
     and new.outreach_lia_reference is not distinct from old.outreach_lia_reference
     and new.outreach_legitimate_interest_expires_at is not distinct from old.outreach_legitimate_interest_expires_at
     and new.outreach_legal_basis_recorded_at is not distinct from old.outreach_legal_basis_recorded_at
     and new.outreach_legal_basis_recorded_by is not distinct from old.outreach_legal_basis_recorded_by then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    previous_values := jsonb_build_object(
      'lawful_basis_before', old.outreach_legal_basis,
      'consent_at_before', old.outreach_consent_at,
      'consent_source_before', old.outreach_consent_source,
      'evidence_before', old.outreach_legal_basis_evidence,
      'lia_reference_before', old.outreach_lia_reference
    );
  end if;

  if auth.uid() is not null
     and not public.is_admin()
     and not public.has_outreach_capability('manage_campaigns') then
    raise exception using
      errcode = '42501',
      message = 'Sem permissão para alterar a base legal Outreach';
  end if;

  if new.outreach_legal_basis in ('consent', 'legitimate_interest', 'contract')
     and auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Uma base legal enviável exige um utilizador responsável';
  end if;

  if new.outreach_legal_basis = 'legitimate_interest' and (
    nullif(trim(new.outreach_legitimate_interest_purpose), '') is null
    or nullif(trim(new.outreach_lia_reference), '') is null
    or new.outreach_legitimate_interest_expires_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Interesse legítimo exige finalidade, referência LIA e validade';
  end if;
  if new.outreach_legal_basis = 'contract'
     and nullif(trim(new.outreach_legal_basis_evidence), '') is null then
    raise exception using
      errcode = '23514',
      message = 'Execução de contrato exige uma referência documental';
  end if;

  if new.outreach_legal_basis is null then
    new.outreach_legal_basis_recorded_at := null;
    new.outreach_legal_basis_recorded_by := null;
  else
    new.outreach_legal_basis_recorded_at := now();
    new.outreach_legal_basis_recorded_by := auth.uid();
  end if;

  insert into public.outreach_audit_log(
    actor_id, action, entity_type, entity_id, details
  ) values (
    auth.uid(), 'contact.compliance_updated', 'contact', new.id,
    previous_values || jsonb_build_object(
      'lawful_basis_after', new.outreach_legal_basis,
      'consent_at_after', new.outreach_consent_at,
      'consent_source_after', new.outreach_consent_source,
      'evidence_after', new.outreach_legal_basis_evidence,
      'lia_reference_after', new.outreach_lia_reference,
      'recorded_at', new.outreach_legal_basis_recorded_at
    )
  );
  return new;
end;
$$;

revoke all on function public.protect_contact_outreach_compliance() from public, anon, authenticated;
create or replace function public.protect_contact_outreach_accountability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- UPDATE OF is syntactic in PostgreSQL, so this rejects an explicit attempt
  -- even when the caller writes the value already stored in the row. The
  -- compliance trigger may still assign these fields internally because its
  -- own NEW-row mutation does not recursively execute an UPDATE statement.
  if tg_op = 'UPDATE' or new.outreach_legal_basis_recorded_at is not null
     or new.outreach_legal_basis_recorded_by is not null then
    raise exception using
      errcode = '42501',
      message = 'Campos de accountability Outreach são geridos pelo servidor';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_contact_outreach_accountability() from public, anon, authenticated;
drop trigger if exists protect_contact_outreach_accountability on public.contactos;
create trigger protect_contact_outreach_accountability
before insert or update of outreach_legal_basis_recorded_at, outreach_legal_basis_recorded_by
on public.contactos
for each row execute function public.protect_contact_outreach_accountability();

drop trigger if exists protect_contact_outreach_compliance on public.contactos;
create trigger protect_contact_outreach_compliance
before insert or update of outreach_legal_basis, outreach_consent_at, outreach_consent_source,
  outreach_legal_basis_evidence, outreach_legitimate_interest_purpose,
  outreach_lia_reference, outreach_legitimate_interest_expires_at
on public.contactos
for each row execute function public.protect_contact_outreach_compliance();

create or replace function private.outreach_claim_jobs(
  worker_id text,
  claim_limit integer default 20,
  lease_seconds integer default 120
)
returns setof public.outreach_jobs
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  candidate public.outreach_jobs%rowtype;
  decision jsonb;
  claimed integer := 0;
  claimed_mailboxes uuid[] := '{}'::uuid[];
begin
  if char_length(trim(worker_id)) = 0 then raise exception 'worker_id obrigatório'; end if;
  if claim_limit not between 1 and 100 then raise exception 'claim_limit inválido'; end if;
  if lease_seconds not between 30 and 900 then raise exception 'lease_seconds inválido'; end if;

  -- A committed delivery ledger means the provider may already have accepted
  -- the message, so that lease must be reconciled. A crash before the atomic
  -- dispatch reservation created a ledger is safe to return to pending.
  update public.outreach_jobs
  set status = case
        when exists (
          select 1 from private.outreach_delivery_ledger ledger
          where ledger.job_id = outreach_jobs.id
        ) then 'reconciliation_required'::public.outreach_job_status
        else 'pending'::public.outreach_job_status
      end,
      lease_owner = null,
      lease_expires_at = null,
      last_error = case
        when exists (
          select 1 from private.outreach_delivery_ledger ledger
          where ledger.job_id = outreach_jobs.id
        ) then 'lease_expired_after_dispatch_reservation'
        else 'lease_expired_before_dispatch_reservation'
      end,
      updated_at = now()
  where status = 'leased' and lease_expires_at <= now();

  for candidate in
    select j.*
    from public.outreach_jobs j
    where j.status = 'pending' and j.scheduled_at <= now()
    order by j.scheduled_at, j.id
    for update skip locked
    limit claim_limit * 5
  loop
    if candidate.mailbox_id is null then
      update public.outreach_jobs
      set last_error = '["mailbox_not_sendable"]', updated_at = now()
      where id = candidate.id;
      continue;
    end if;

    -- One live lease per mailbox is a durable inter-worker barrier. The
    -- advisory lock closes the race where two workers select different jobs
    -- before either has committed its lease.
    if candidate.mailbox_id = any(claimed_mailboxes)
       or not pg_try_advisory_xact_lock(
         hashtextextended('outreach-mailbox:' || candidate.mailbox_id::text, 0)
       ) then
      continue;
    end if;
    if exists (
      select 1
      from public.outreach_jobs active_lease
      where active_lease.mailbox_id = candidate.mailbox_id
        and active_lease.id <> candidate.id
        and active_lease.status = 'leased'
        and active_lease.lease_expires_at > now()
    ) then
      continue;
    end if;

    decision := private.outreach_recipient_eligibility(candidate.recipient_id, candidate.mailbox_id, now());
    if coalesce((decision ->> 'eligible')::boolean, false) then
      update public.outreach_jobs
      set status = 'leased', lease_owner = worker_id,
          lease_expires_at = now() + make_interval(secs => lease_seconds),
          last_error = null, updated_at = now()
      where id = candidate.id
      returning * into candidate;
      return next candidate;
      claimed := claimed + 1;
      claimed_mailboxes := array_append(claimed_mailboxes, candidate.mailbox_id);
      exit when claimed >= claim_limit;
    else
      -- Pacing is transient. Leave the job untouched so it naturally becomes
      -- eligible on a later cycle instead of looking like a terminal failure.
      if not ((decision -> 'reasons') ? 'mailbox_gap_not_elapsed') then
        update public.outreach_jobs
        set last_error = (decision -> 'reasons')::text, updated_at = now()
        where id = candidate.id;
      end if;
    end if;
  end loop;
  return;
end;
$$;

-- Heartbeats turn the rollout's 24-hour stability requirement into durable
-- database state instead of a process-local timer. A restart, owner change or
-- five-minute heartbeat gap restarts the continuous window.
create or replace function private.outreach_record_worker_heartbeat(
  worker_id text,
  healthy boolean default true
)
returns public.outreach_system_state
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  current_state public.outreach_system_state%rowtype;
  next_state public.outreach_system_state%rowtype;
begin
  if worker_id is null or worker_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$' then
    raise exception 'worker_id inválido';
  end if;

  select * into current_state
  from public.outreach_system_state
  where id
  for update;

  update public.outreach_system_state
  set worker_last_heartbeat_at = now(),
      worker_heartbeat_owner = worker_id,
      worker_continuous_since = case
        when not healthy then null
        when current_state.worker_continuous_since is null
          or current_state.worker_last_heartbeat_at is null
          or current_state.worker_last_heartbeat_at < now() - interval '5 minutes'
          or current_state.worker_heartbeat_owner is distinct from worker_id
          then now()
        else current_state.worker_continuous_since
      end,
      updated_at = now()
  where id
  returning * into next_state;

  return next_state;
end;
$$;

-- Mailbox ramp is monotonic (1 -> 3 -> 5 -> 10) and each increase requires a
-- fresh 48-hour incident-free window. Eligibility uses the lower of this ramp
-- and the configured mailbox daily limit.
create or replace function private.outreach_advance_mailbox_ramp(
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
  if state_record.id is null or state_record.mode <> 'canary' then
    raise exception 'Ramp só pode avançar durante canary';
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
  if mailbox_record.ramp_daily_limit = 10 then
    return mailbox_record;
  end if;
  if mailbox_record.ramp_started_at > now() - interval '48 hours'
     or mailbox_record.last_incident_at > mailbox_record.ramp_started_at then
    raise exception 'Ramp exige 48 horas completas sem incidentes';
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
      and message.occurred_at >= mailbox_record.ramp_started_at
      and message.occurred_at <= now()
  ) then
    raise exception 'Ramp exige pelo menos um envio confirmado no patamar atual';
  end if;

  next_level := case mailbox_record.ramp_daily_limit
    when 1 then 3
    when 3 then 5
    when 5 then 10
  end;
  update public.outreach_mailboxes
  set ramp_daily_limit = next_level,
      ramp_started_at = now(),
      updated_at = now()
  where id = target_mailbox_id
  returning * into mailbox_record;

  insert into public.outreach_audit_log(
    actor_id, action, entity_type, entity_id, details
  ) values (
    actor_id, 'mailbox_ramp_advanced', 'mailbox', target_mailbox_id,
    jsonb_build_object('daily_limit', next_level)
  );
  return mailbox_record;
end;
$$;

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
      and mailbox.ramp_daily_limit = 10
      and mailbox.ramp_started_at <= now() - interval '48 hours'
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

create or replace function private.enforce_outreach_mailbox_live_activation()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  state_record public.outreach_system_state%rowtype;
begin
  if not new.send_enabled
     or (tg_op = 'UPDATE' and old.send_enabled) then
    return new;
  end if;
  -- Serialize a late mailbox activation with canary -> live.  Without this
  -- lock both transactions could inspect the other's pre-commit state and
  -- independently pass their readiness checks.
  select * into state_record
  from public.outreach_system_state
  where id
  for update;
  if state_record.mode = 'live'
     and not private.outreach_mailbox_live_ready(new.id, state_record.canary_started_at) then
    raise exception 'Live só permite ativar mailboxes com ramp 1/3/5/10 e prova durável completa';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_outreach_mailbox_live_activation() from public, anon, authenticated;
drop trigger if exists enforce_outreach_mailbox_live_activation on public.outreach_mailboxes;
create trigger enforce_outreach_mailbox_live_activation
after insert or update of send_enabled on public.outreach_mailboxes
for each row execute function private.enforce_outreach_mailbox_live_activation();

create or replace function private.enforce_outreach_system_transition()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  if new.mode = 'disabled' then
    new.send_enabled := false;
  elsif new.mode = old.mode then
    if not new.send_enabled then
      raise exception 'Canary/live exigem outbound ativo';
    end if;
  elsif old.mode = 'disabled' and new.mode = 'canary' then
    if not new.send_enabled then
      raise exception 'Canary exige outbound ativo';
    end if;
  elsif old.mode = 'canary' and new.mode = 'live' then
    if not new.send_enabled or new.approved_by is null or new.approved_at is null then
      raise exception 'Live exige canary e aprovação administrativa explícita';
    end if;
    if new.canary_started_at is null
       or new.canary_started_at > now() - interval '48 hours' then
      raise exception 'Live exige pelo menos 48 horas completas de canary';
    end if;
    if new.worker_continuous_since is null
       or new.worker_continuous_since > now() - interval '24 hours'
       or new.worker_last_heartbeat_at is null
       or new.worker_last_heartbeat_at < now() - interval '5 minutes' then
      raise exception 'Live exige worker saudável continuamente há 24 horas';
    end if;
    if new.last_incident_at is not null
       and new.last_incident_at > now() - interval '48 hours' then
      raise exception 'Live exige 48 horas sem incidentes de outbound';
    end if;
    if not exists (
      select 1 from public.outreach_mailboxes mailbox
      where mailbox.send_enabled
    ) then
      raise exception 'Live exige pelo menos uma mailbox Google ativa para envio';
    end if;
    if exists (
      select 1 from public.outreach_mailboxes mailbox
      where mailbox.send_enabled
        and not private.outreach_mailbox_live_ready(mailbox.id, new.canary_started_at)
    ) then
      raise exception 'Live exige ramp 1/3/5/10 comprovado, DNS fresco e 48 horas estáveis no patamar 10';
    end if;
    if exists (
      select 1 from public.outreach_jobs job
      where job.status = 'reconciliation_required'
    ) or exists (
      select 1 from private.outreach_delivery_ledger ledger
      where ledger.status in ('sending', 'accepted', 'ambiguous')
    ) then
      raise exception 'Live exige reconciliação integral de jobs ambíguos';
    end if;
  else
    raise exception 'Transição Outreach inválida: % -> %', old.mode, new.mode;
  end if;
  if new.mode = 'live' and (new.approved_by is null or new.approved_at is null) then
    raise exception 'Live exige aprovação administrativa explícita';
  end if;
  return new;
end;
$$;

create trigger enforce_outreach_system_transition
before update on public.outreach_system_state
for each row execute function private.enforce_outreach_system_transition();

create or replace function private.outreach_transition_system(
  target_mode public.outreach_system_mode,
  actor_id uuid,
  approve_live boolean default false,
  reason text default null
)
returns public.outreach_system_state
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  current_state public.outreach_system_state%rowtype;
  next_state public.outreach_system_state%rowtype;
  paused_campaign_count integer := 0;
  leases_requiring_reconciliation integer := 0;
  leases_requeued_pre_dispatch integer := 0;
begin
  perform pg_advisory_xact_lock(20260930, 1);
  if actor_id is null and target_mode <> 'disabled' then
    raise exception 'Canary/live exigem um administrador explícito';
  end if;
  if actor_id is null and session_user not in ('postgres', 'outreach_service', 'service_role') then
    raise exception 'Apenas o serviço operacional pode executar um kill switch sem ator';
  end if;
  if actor_id is not null and not exists (
      select 1 from public.profiles p
      where p.id = actor_id and p.ativo and p.role = 'admin'
    ) then
    raise exception 'Apenas administradores podem alterar o estado de outbound';
  end if;

  select * into current_state
  from public.outreach_system_state
  where id
  for update;

  if target_mode = current_state.mode and target_mode <> 'disabled' then
    return current_state;
  elsif target_mode = current_state.mode and target_mode = 'disabled' then
    null; -- idempotent operational disable still pauses/resets/reconciles
  elsif target_mode = 'disabled' then
    null; -- emergency kill switch is valid from every state
  elsif current_state.mode = 'disabled' and target_mode = 'canary' then
    null;
  elsif current_state.mode = 'canary' and target_mode = 'live' and approve_live then
    null;
  elsif target_mode = 'live' then
    raise exception 'Live exige canary e confirmação explícita';
  else
    raise exception 'Transição Outreach inválida: % -> %', current_state.mode, target_mode;
  end if;

  update public.outreach_system_state
  set mode = target_mode,
      send_enabled = target_mode <> 'disabled',
      approved_by = case when target_mode = 'live' then actor_id else null end,
      approved_at = case when target_mode = 'live' then now() else null end,
      canary_started_at = case
        when target_mode = 'canary' then now()
        else current_state.canary_started_at
      end,
      kill_reason = case when target_mode = 'disabled' then coalesce(nullif(reason, ''), 'admin_kill_switch') else null end,
      updated_at = now()
  where id
  returning * into next_state;

  if target_mode = 'disabled' then
    update public.outreach_campaigns
    set status = 'paused', paused_at = now(), updated_at = now()
    where status = 'running';
    get diagnostics paused_campaign_count = row_count;

    -- A ledger distinguishes a possibly-dispatched request from a crash that
    -- happened before dispatch reservation.
    perform set_config('app.outreach_tripping_canary', 'true', true);
    update public.outreach_jobs job
    set status = 'reconciliation_required', lease_owner = null,
        lease_expires_at = null,
        last_error = 'operational_disable:' || coalesce(nullif(reason, ''), 'admin_kill_switch'),
        updated_at = now()
    where job.status = 'leased'
      and exists (select 1 from private.outreach_delivery_ledger ledger where ledger.job_id=job.id);
    get diagnostics leases_requiring_reconciliation = row_count;
    update public.outreach_jobs job
    set status = 'pending', lease_owner = null,
        lease_expires_at = null,
        last_error = 'operational_disable_released_pre_dispatch',
        updated_at = now()
    where job.status = 'leased'
      and not exists (select 1 from private.outreach_delivery_ledger ledger where ledger.job_id=job.id);
    get diagnostics leases_requeued_pre_dispatch = row_count;
    perform set_config('app.outreach_tripping_canary', 'false', true);
  end if;

  -- Every fresh canary, as well as every rollback, starts at the first ramp
  -- level. Campaigns remain paused until a manager explicitly resumes them.
  if target_mode in ('disabled', 'canary') then
    update public.outreach_mailboxes
    set ramp_daily_limit = 1, ramp_started_at = now(), updated_at = now()
    where ramp_daily_limit <> 1 or status = 'active' or send_enabled;
  end if;

  insert into public.outreach_audit_log(actor_id, action, entity_type, entity_id, details)
  values (
    actor_id, 'system_mode_changed', 'system', null,
    jsonb_build_object(
      'from', current_state.mode,
      'to', next_state.mode,
      'send_enabled', next_state.send_enabled,
      'reason', reason,
      'paused_campaigns', paused_campaign_count,
      'leases_requiring_reconciliation', leases_requiring_reconciliation,
      'leases_requeued_pre_dispatch', leases_requeued_pre_dispatch
    )
  );
  return next_state;
end;
$$;

create or replace function private.outreach_update_settings(
  actor_id uuid,
  settings_patch jsonb
)
returns public.outreach_system_state
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  allowed_keys constant text[] := array[
    'workspaceName', 'timezone', 'defaultDailyLimit',
    'bounceWarningThreshold', 'bouncePauseThreshold',
    'complaintPauseThreshold'
  ];
  merged_settings jsonb;
  updated_state public.outreach_system_state%rowtype;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.ativo and p.role = 'admin'
  ) then
    raise exception 'Apenas administradores podem alterar definições de Outreach';
  end if;
  if jsonb_typeof(settings_patch) <> 'object' then
    raise exception 'settings_patch tem de ser um objeto JSON';
  end if;
  if exists (
    select 1 from jsonb_object_keys(settings_patch) key
    where not key = any(allowed_keys)
  ) then
    raise exception 'Definição desconhecida ou insegura';
  end if;

  select settings || settings_patch into merged_settings
  from public.outreach_system_state where id for update;

  if char_length(trim(coalesce(merged_settings ->> 'workspaceName', ''))) not between 1 and 120 then
    raise exception 'workspaceName inválido';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = merged_settings ->> 'timezone'
  ) then
    raise exception 'Timezone inválido';
  end if;
  if (merged_settings ->> 'defaultDailyLimit')::integer not between 1 and 500 then
    raise exception 'defaultDailyLimit inválido';
  end if;
  if (merged_settings ->> 'bounceWarningThreshold')::numeric not between 0 and 100
     or (merged_settings ->> 'bouncePauseThreshold')::numeric not between 0 and 100
     or (merged_settings ->> 'complaintPauseThreshold')::numeric not between 0 and 100 then
    raise exception 'Limiares inválidos';
  end if;
  if (merged_settings ->> 'bounceWarningThreshold')::numeric
     > (merged_settings ->> 'bouncePauseThreshold')::numeric then
    raise exception 'O aviso de bounce não pode exceder o limite de pausa';
  end if;

  update public.outreach_system_state
  set settings = merged_settings, updated_at = now()
  where id
  returning * into updated_state;

  insert into public.outreach_audit_log(actor_id, action, entity_type, details)
  values (
    actor_id, 'settings_updated', 'system',
    jsonb_build_object('changed_keys', (select jsonb_agg(key) from jsonb_object_keys(settings_patch) key))
  );
  return updated_state;
end;
$$;

create or replace function private.outreach_update_profile_role(
  actor_id uuid,
  target_profile_id uuid,
  target_role public.outreach_role
)
returns public.profiles
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  previous_claim text := current_setting('request.jwt.claim.sub', true);
  updated_profile public.profiles%rowtype;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.ativo and p.role = 'admin'
  ) then
    raise exception 'Apenas administradores podem alterar permissões de Outreach';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = target_profile_id and p.ativo
  ) then
    raise exception 'Perfil ativo não encontrado';
  end if;

  -- Existing profile guards/audit use auth.uid(). Supply the independently
  -- validated actor only for this transaction-scoped update.
  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  update public.profiles
  set outreach_role = target_role, updated_at = now()
  where id = target_profile_id
  returning * into updated_profile;
  perform set_config('request.jwt.claim.sub', coalesce(previous_claim, ''), true);

  insert into public.outreach_audit_log(actor_id, action, entity_type, entity_id, details)
  values (
    actor_id, 'profile_role_updated', 'profile', target_profile_id,
    jsonb_build_object('outreach_role', target_role)
  );
  return updated_profile;
exception
  when others then
    perform set_config('request.jwt.claim.sub', coalesce(previous_claim, ''), true);
    raise;
end;
$$;

-- Central writer half of the outbound provider permit.  Trigger names start
-- with "a_" so the lock is acquired before existing business-side triggers.
-- The two-int advisory namespace/key must stay aligned with delivery.ts.
create or replace function private.outreach_lock_send_gate_writer()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(20260930, 1);
  if tg_level = 'STATEMENT' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists a_outreach_send_gate_system_writer on public.outreach_system_state;
create trigger a_outreach_send_gate_system_writer
before update of mode, send_enabled on public.outreach_system_state
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_suppression_writer on public.communication_suppressions;
create trigger a_outreach_send_gate_suppression_writer
before insert or update or delete on public.communication_suppressions
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_contact_writer on public.contactos;
create trigger a_outreach_send_gate_contact_writer
before update of email, empresa_id, optout, outreach_legal_basis,
  outreach_consent_at, outreach_consent_source, outreach_legal_basis_evidence,
  outreach_legitimate_interest_purpose, outreach_lia_reference,
  outreach_legitimate_interest_expires_at,
  outreach_legal_basis_recorded_at, outreach_legal_basis_recorded_by
or delete on public.contactos
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_recipient_writer on public.outreach_recipients;
create trigger a_outreach_send_gate_recipient_writer
before update of status, responded_at, email_snapshot, company_id, contact_id, campaign_id
or delete on public.outreach_recipients
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_mailbox_writer on public.outreach_mailboxes;
create trigger a_outreach_send_gate_mailbox_writer
before update of provider, email, status, send_enabled, daily_limit,
  ramp_daily_limit, ramp_started_at, timezone
or delete on public.outreach_mailboxes
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_campaign_writer on public.outreach_campaigns;
create trigger a_outreach_send_gate_campaign_writer
before update of status, stop_company_on_reply, timezone, send_days,
  send_window_start, send_window_end, starts_at, ends_at, daily_limit, gap_minutes
or delete on public.outreach_campaigns
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_dns_writer on public.outreach_dns_checks;
create trigger a_outreach_send_gate_dns_writer
before insert or update or delete on public.outreach_dns_checks
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_verification_writer on public.outreach_email_verifications;
create trigger a_outreach_send_gate_verification_writer
before insert or update or delete on public.outreach_email_verifications
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_allowlist_writer on private.outreach_canary_allowlist;
create trigger a_outreach_send_gate_allowlist_writer
before insert or update or delete on private.outreach_canary_allowlist
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_inbound_writer on public.outreach_messages;
create trigger a_outreach_send_gate_inbound_writer
before insert on public.outreach_messages
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_job_status_writer on public.outreach_jobs;
create trigger a_outreach_send_gate_job_status_writer
before update of status on public.outreach_jobs
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_job_delete_writer on public.outreach_jobs;
create trigger a_outreach_send_gate_job_delete_writer
before delete on public.outreach_jobs
for each statement execute function private.outreach_lock_send_gate_writer();

drop trigger if exists a_outreach_send_gate_credential_delete_writer on private.outreach_credentials;
create trigger a_outreach_send_gate_credential_delete_writer
before delete on private.outreach_credentials
for each statement execute function private.outreach_lock_send_gate_writer();

revoke all on function private.outreach_identity_hmac(text) from public, anon, authenticated;
revoke all on function private.outreach_identity_hmac_matches(bytea, text) from public, anon, authenticated;
revoke all on function private.protect_outreach_hmac_key_history() from public, anon, authenticated;
revoke all on function private.normalize_contact_import_suppression() from public, anon, authenticated;
revoke all on function private.outreach_is_suppressed(text, uuid) from public, anon, authenticated;
revoke all on function private.outreach_claim_provider_message(text, text, text) from public, anon, authenticated;
revoke all on function private.outreach_recipient_eligibility(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.outreach_assert_provider_permit(uuid, text) from public, anon, authenticated;
revoke all on function private.outreach_assert_dispatch_eligible(uuid, bytea) from public, anon, authenticated;
revoke all on function private.outreach_claim_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function private.outreach_trip_canary(text, uuid) from public, anon, authenticated;
revoke all on function private.outreach_record_delivery_incident(text, uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.outreach_adjudicate_job_reconciliation(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.outreach_record_worker_heartbeat(text, boolean) from public, anon, authenticated;
revoke all on function private.outreach_advance_mailbox_ramp(uuid, uuid) from public, anon, authenticated;
revoke all on function private.outreach_mailbox_live_ready(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.outreach_transition_system(public.outreach_system_mode, uuid, boolean, text) from public, anon, authenticated;
revoke all on function private.outreach_update_settings(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.outreach_update_profile_role(uuid, uuid, public.outreach_role) from public, anon, authenticated;
revoke all on function private.import_outreach_legacy_snapshot(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.claim_google_provider_message(text, text) from public, anon, authenticated;
revoke all on function public.is_contact_import_suppressed(text, text) from public, anon, authenticated;
revoke all on function private.set_communication_suppression_hmac() from public, anon, authenticated;
revoke all on function private.enforce_contact_communication_suppression() from public, anon, authenticated;
revoke all on function private.apply_communication_suppression() from public, anon, authenticated;
revoke all on function private.set_outreach_recipient_identity() from public, anon, authenticated;
revoke all on function private.outreach_lock_send_gate_writer() from public, anon, authenticated;
revoke all on function private.process_outreach_message() from public, anon, authenticated;
revoke all on function private.record_outreach_job_incident() from public, anon, authenticated;
revoke all on function private.redact_outreach_contact() from public, anon, authenticated;
revoke all on function private.enforce_outreach_system_transition() from public, anon, authenticated;
revoke all on table private.outreach_delivery_incidents from public, anon, authenticated, service_role;
revoke all on table private.outreach_job_adjudications from public, anon, authenticated, service_role;

grant execute on function private.outreach_identity_hmac(text) to service_role;
grant execute on function private.outreach_is_suppressed(text, uuid) to service_role;
grant execute on function private.outreach_claim_provider_message(text, text, text) to service_role;
grant execute on function private.outreach_recipient_eligibility(uuid, uuid, timestamptz) to service_role;
grant execute on function private.outreach_assert_provider_permit(uuid, text) to service_role;
grant execute on function private.outreach_assert_dispatch_eligible(uuid, bytea) to service_role;
grant execute on function private.outreach_claim_jobs(text, integer, integer) to service_role;
grant execute on function private.outreach_trip_canary(text, uuid) to service_role;
grant execute on function private.outreach_record_delivery_incident(text, uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function private.outreach_adjudicate_job_reconciliation(uuid, uuid, text, text, text, text) to service_role;
grant execute on function private.outreach_record_worker_heartbeat(text, boolean) to service_role;
grant execute on function private.outreach_advance_mailbox_ramp(uuid, uuid) to service_role;
grant execute on function private.outreach_transition_system(public.outreach_system_mode, uuid, boolean, text) to service_role;
grant execute on function private.outreach_update_settings(uuid, jsonb) to service_role;
grant execute on function private.outreach_update_profile_role(uuid, uuid, public.outreach_role) to service_role;
grant execute on function private.import_outreach_legacy_snapshot(jsonb, boolean) to service_role;
grant execute on function public.claim_google_provider_message(text, text) to service_role;
grant execute on function public.is_contact_import_suppressed(text, text) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'outreach_service') then
    execute 'revoke all on table private.outreach_delivery_incidents from outreach_service';
    execute 'revoke all on table private.outreach_job_adjudications from outreach_service';
    execute 'grant execute on function private.outreach_identity_hmac(text) to outreach_service';
    execute 'grant execute on function private.outreach_is_suppressed(text, uuid) to outreach_service';
    execute 'grant execute on function private.outreach_claim_provider_message(text, text, text) to outreach_service';
    execute 'grant execute on function private.outreach_recipient_eligibility(uuid, uuid, timestamptz) to outreach_service';
    execute 'grant execute on function private.outreach_assert_provider_permit(uuid, text) to outreach_service';
    execute 'grant execute on function private.outreach_assert_dispatch_eligible(uuid, bytea) to outreach_service';
    execute 'grant execute on function private.outreach_claim_jobs(text, integer, integer) to outreach_service';
    execute 'grant execute on function private.outreach_trip_canary(text, uuid) to outreach_service';
    execute 'grant execute on function private.outreach_record_delivery_incident(text, uuid, uuid, uuid, text, uuid) to outreach_service';
    execute 'grant execute on function private.outreach_adjudicate_job_reconciliation(uuid, uuid, text, text, text, text) to outreach_service';
    execute 'grant execute on function private.outreach_record_worker_heartbeat(text, boolean) to outreach_service';
    execute 'grant execute on function private.outreach_advance_mailbox_ramp(uuid, uuid) to outreach_service';
    execute 'grant execute on function private.outreach_transition_system(public.outreach_system_mode, uuid, boolean, text) to outreach_service';
    execute 'grant execute on function private.outreach_update_settings(uuid, jsonb) to outreach_service';
    execute 'grant execute on function private.outreach_update_profile_role(uuid, uuid, public.outreach_role) to outreach_service';
    execute 'grant execute on function private.import_outreach_legacy_snapshot(jsonb, boolean) to outreach_service';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
