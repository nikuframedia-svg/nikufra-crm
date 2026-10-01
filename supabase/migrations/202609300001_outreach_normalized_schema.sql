begin;

-- Outreach is a CRM module, not a second tenant or identity system.  All
-- records below therefore reference the existing CRM profiles/contacts and
-- deliberately omit workspaces and workspace memberships.
create type public.outreach_role as enum ('viewer', 'sales_rep', 'campaign_manager');
create type public.outreach_system_mode as enum ('disabled', 'canary', 'live');
create type public.outreach_mailbox_provider as enum ('google', 'microsoft', 'smtp_imap');
create type public.outreach_mailbox_status as enum ('disconnected', 'pending', 'active', 'paused', 'error');
create type public.outreach_campaign_status as enum ('draft', 'paused', 'running', 'completed', 'archived');
create type public.outreach_eligibility_status as enum ('pending', 'eligible', 'ineligible');
create type public.outreach_recipient_status as enum (
  'pending', 'eligible', 'ineligible', 'active', 'replied', 'suppressed',
  'bounced', 'completed', 'deleted', 'reconciliation_required'
);
create type public.outreach_job_status as enum (
  'pending', 'leased', 'sent', 'cancelled', 'failed', 'reconciliation_required'
);
create type public.outreach_thread_status as enum ('open', 'archived');
create type public.outreach_message_direction as enum ('inbound', 'outbound');
create type public.outreach_message_kind as enum (
  'email', 'reply', 'auto_reply', 'hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe'
);
create type public.outreach_verification_status as enum ('unknown', 'pending', 'valid', 'risky', 'invalid', 'catch_all');
create type public.outreach_check_status as enum ('unknown', 'pass', 'warn', 'fail');
create type public.communication_suppression_scope as enum ('email', 'domain', 'company');

alter table public.profiles
  add column outreach_role public.outreach_role not null default 'viewer';

-- Eligibility is intentionally fail-closed: a contact without an explicitly
-- recorded lawful basis never becomes sendable merely because it has email.
alter table public.contactos
  add column outreach_legal_basis text,
  add column outreach_consent_at timestamptz,
  add column outreach_consent_source text,
  add column outreach_legal_basis_evidence text,
  add column outreach_legal_basis_recorded_at timestamptz,
  add column outreach_legal_basis_recorded_by uuid references public.profiles(id) on delete set null,
  add column outreach_legitimate_interest_purpose text,
  add column outreach_lia_reference text,
  add column outreach_legitimate_interest_expires_at timestamptz,
  add constraint contactos_outreach_legal_basis_valid
    check (outreach_legal_basis is null or outreach_legal_basis in (
      'consent', 'legitimate_interest', 'contract', 'not_applicable'
    )),
  add constraint contactos_outreach_consent_consistent
    check (
      (
        outreach_legal_basis = 'consent'
        and outreach_consent_at is not null
        and nullif(trim(outreach_consent_source), '') is not null
      )
      or (
        outreach_legal_basis is distinct from 'consent'
        and outreach_consent_at is null
        and outreach_consent_source is null
      )
    ),
  add constraint contactos_outreach_contract_evidence_consistent
    check (
      (
        outreach_legal_basis = 'contract'
        and nullif(trim(outreach_legal_basis_evidence), '') is not null
      )
      or (
        outreach_legal_basis is distinct from 'contract'
        and outreach_legal_basis_evidence is null
      )
    ),
  add constraint contactos_outreach_lia_consistent
    check (
      (
        outreach_legal_basis = 'legitimate_interest'
        and nullif(trim(outreach_legitimate_interest_purpose), '') is not null
        and nullif(trim(outreach_lia_reference), '') is not null
        and outreach_legitimate_interest_expires_at is not null
      )
      or (
        outreach_legal_basis is distinct from 'legitimate_interest'
        and outreach_legitimate_interest_purpose is null
        and outreach_lia_reference is null
        and outreach_legitimate_interest_expires_at is null
      )
    );

-- The Gmail importer and Outreach worker share this tuple for deduplication.
alter table public.atividades
  add column source_mailbox_email citext;

drop index if exists public.atividades_message_contacto_unique;
create unique index atividades_mailbox_provider_message_unique
  on public.atividades(source_mailbox_email, message_id, contacto_id)
  where source_mailbox_email is not null and message_id is not null and contacto_id is not null;

create table public.outreach_system_state (
  id boolean primary key default true check (id),
  mode public.outreach_system_mode not null default 'disabled',
  send_enabled boolean not null default false,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  canary_started_at timestamptz,
  worker_last_heartbeat_at timestamptz,
  worker_continuous_since timestamptz,
  worker_heartbeat_owner text,
  last_incident_at timestamptz,
  last_incident_reason text,
  kill_reason text,
  settings jsonb not null default jsonb_build_object(
    'workspaceName', 'Nikufra Outreach',
    'timezone', 'Europe/Lisbon',
    'defaultDailyLimit', 10,
    'bounceWarningThreshold', 3,
    'bouncePauseThreshold', 5,
    'complaintPauseThreshold', 0.1
  ) check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_system_live_requires_approval check (
    mode <> 'live' or (
      send_enabled and approved_by is not null and approved_at is not null
      and canary_started_at is not null
    )
  ),
  constraint outreach_system_disabled_is_off check (mode <> 'disabled' or not send_enabled),
  constraint outreach_system_canary_clock check (
    mode = 'disabled' or canary_started_at is not null
  )
);

insert into public.outreach_system_state(id) values (true);

create table public.outreach_mailboxes (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  provider public.outreach_mailbox_provider not null,
  email citext not null unique,
  display_name text not null default '',
  owner_profile_id uuid references public.profiles(id) on delete set null,
  status public.outreach_mailbox_status not null default 'disconnected',
  send_enabled boolean not null default false,
  daily_limit integer not null default 10 check (daily_limit between 1 and 500),
  ramp_daily_limit integer not null default 1 check (ramp_daily_limit in (1, 3, 5, 10)),
  ramp_started_at timestamptz not null default now(),
  last_incident_at timestamptz,
  timezone text not null default 'Europe/Lisbon',
  provider_account_id text,
  settings jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_mailbox_google_only_initially check (
    provider <> 'google' or provider_account_id is null or char_length(provider_account_id) <= 500
  )
);

create table public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  nome text not null check (char_length(trim(nome)) between 1 and 180),
  descricao text not null default '',
  status public.outreach_campaign_status not null default 'draft',
  created_by uuid not null references public.profiles(id),
  stop_company_on_reply boolean not null default true,
  timezone text not null default 'Europe/Lisbon',
  send_days smallint[] not null default array[1,2,3,4,5]::smallint[],
  send_window_start time not null default '09:00',
  send_window_end time not null default '17:00',
  starts_at timestamptz,
  ends_at timestamptz,
  daily_limit integer not null default 10 check (daily_limit between 1 and 10000),
  gap_minutes integer not null default 5 check (gap_minutes between 0 and 1440),
  jitter_minutes integer not null default 2 check (jitter_minutes between 0 and 1440),
  launched_at timestamptz,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_campaign_window_valid check (send_window_start < send_window_end),
  constraint outreach_campaign_days_valid check (
    cardinality(send_days) between 1 and 7
    and send_days <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint outreach_campaign_period_valid check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.outreach_campaign_steps (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  position integer not null check (position > 0),
  kind text not null default 'email' check (kind in ('email', 'wait')),
  delay_minutes integer not null default 0 check (delay_minutes between 0 and 525600),
  reply_to_previous boolean not null default true,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, position)
);

create table public.outreach_campaign_variants (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  step_id uuid not null references public.outreach_campaign_steps(id) on delete cascade,
  nome text not null default 'A',
  weight integer not null default 100 check (weight between 0 and 10000),
  subject_template text not null,
  body_template text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (step_id, nome)
);

create table public.outreach_audiences (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  nome text not null check (char_length(trim(nome)) between 1 and 180),
  descricao text not null default '',
  filter_definition jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outreach_audience_members (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  audience_id uuid not null references public.outreach_audiences(id) on delete cascade,
  contact_id uuid not null references public.contactos(id) on delete cascade,
  eligibility_status public.outreach_eligibility_status not null default 'pending',
  eligibility_reasons text[] not null default '{}'::text[],
  assessed_at timestamptz,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  unique (audience_id, contact_id)
);

create table public.outreach_recipients (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  audience_member_id uuid references public.outreach_audience_members(id) on delete set null,
  contact_id uuid references public.contactos(id) on delete set null,
  company_id uuid references public.empresas(id) on delete set null,
  email_snapshot citext,
  identity_hmac bytea,
  variable_snapshot jsonb not null default '{}'::jsonb,
  status public.outreach_recipient_status not null default 'pending',
  current_step integer not null default 0 check (current_step >= 0),
  eligibility_reasons text[] not null default '{}'::text[],
  responded_at timestamptz,
  unsubscribed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_recipient_has_identity check (
    contact_id is not null or email_snapshot is not null or identity_hmac is not null
  )
);

create unique index outreach_recipients_campaign_contact_unique
  on public.outreach_recipients(campaign_id, contact_id)
  where contact_id is not null;
create unique index outreach_recipients_campaign_identity_unique
  on public.outreach_recipients(campaign_id, identity_hmac)
  where identity_hmac is not null;

create table public.outreach_jobs (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  recipient_id uuid not null references public.outreach_recipients(id) on delete cascade,
  step_id uuid not null references public.outreach_campaign_steps(id) on delete cascade,
  variant_id uuid references public.outreach_campaign_variants(id) on delete set null,
  mailbox_id uuid references public.outreach_mailboxes(id) on delete set null,
  scheduled_at timestamptz not null,
  status public.outreach_job_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  lease_owner text,
  lease_expires_at timestamptz,
  idempotency_key text not null unique,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_job_lease_consistent check (
    status <> 'leased' or (lease_owner is not null and lease_expires_at is not null)
  )
);

create table public.outreach_threads (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  recipient_id uuid references public.outreach_recipients(id) on delete set null,
  contact_id uuid references public.contactos(id) on delete set null,
  company_id uuid references public.empresas(id) on delete set null,
  mailbox_id uuid not null references public.outreach_mailboxes(id) on delete cascade,
  provider_thread_id text,
  subject text,
  status public.outreach_thread_status not null default 'open',
  assigned_to uuid references public.profiles(id) on delete set null,
  classification text not null default 'unclassified' check (classification in (
    'positive', 'question', 'objection', 'negative', 'auto_reply', 'unclassified'
  )),
  unread boolean not null default true,
  starred boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index outreach_threads_provider_unique
  on public.outreach_threads(mailbox_id, provider_thread_id)
  where provider_thread_id is not null;

create table public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  thread_id uuid references public.outreach_threads(id) on delete set null,
  campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  recipient_id uuid references public.outreach_recipients(id) on delete set null,
  contact_id uuid references public.contactos(id) on delete set null,
  company_id uuid references public.empresas(id) on delete set null,
  mailbox_id uuid not null references public.outreach_mailboxes(id) on delete cascade,
  direction public.outreach_message_direction not null,
  kind public.outreach_message_kind not null default 'email',
  provider_message_id text not null,
  provider_thread_id text,
  internet_message_id text,
  subject text,
  snippet text,
  body_text text,
  headers jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  pii_redacted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mailbox_id, provider_message_id)
);

create table public.outreach_email_verifications (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  contact_id uuid references public.contactos(id) on delete set null,
  email citext not null,
  status public.outreach_verification_status not null default 'unknown',
  provider text,
  reasons text[] not null default '{}'::text[],
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.outreach_dns_checks (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  mailbox_id uuid references public.outreach_mailboxes(id) on delete cascade,
  domain citext not null,
  spf_status public.outreach_check_status not null default 'unknown',
  dkim_status public.outreach_check_status not null default 'unknown',
  dmarc_status public.outreach_check_status not null default 'unknown',
  mx_status public.outreach_check_status not null default 'unknown',
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);

create table public.outreach_metric_daily (
  metric_date date not null,
  campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  mailbox_id uuid references public.outreach_mailboxes(id) on delete set null,
  sent integer not null default 0 check (sent >= 0),
  replies integer not null default 0 check (replies >= 0),
  positive_replies integer not null default 0 check (positive_replies >= 0),
  hard_bounces integer not null default 0 check (hard_bounces >= 0),
  complaints integer not null default 0 check (complaints >= 0),
  unsubscribes integer not null default 0 check (unsubscribes >= 0),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (metric_date, campaign_id, mailbox_id)
);

create table public.outreach_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  mailbox_id uuid references public.outreach_mailboxes(id) on delete set null,
  recipient_id uuid references public.outreach_recipients(id) on delete set null,
  message_id uuid references public.outreach_messages(id) on delete set null,
  occurred_at timestamptz not null default now(),
  dimensions jsonb not null default '{}'::jsonb
);

create table public.outreach_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.communication_suppressions (
  id uuid primary key default gen_random_uuid(),
  scope public.communication_suppression_scope not null,
  email citext,
  domain citext,
  company_id uuid references public.empresas(id) on delete set null,
  identity_hmac bytea,
  reason text not null check (reason in (
    'unsubscribe', 'hard_bounce', 'complaint', 'manual', 'legal', 'contact_deleted'
  )),
  source text not null default 'outreach',
  note text not null default '',
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deactivated_by uuid references public.profiles(id) on delete set null,
  deactivated_at timestamptz,
  constraint communication_suppression_identity check (
    (scope = 'email' and (email is not null or identity_hmac is not null))
    or (scope = 'domain' and (domain is not null or identity_hmac is not null))
    or (scope = 'company' and (company_id is not null or identity_hmac is not null))
  ),
  constraint communication_suppression_deactivation check (
    active or deactivated_at is not null
  )
);

create unique index communication_suppressions_active_identity_unique
  on public.communication_suppressions(scope, identity_hmac)
  where active and identity_hmac is not null;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.outreach_credentials (
  mailbox_id uuid primary key references public.outreach_mailboxes(id) on delete cascade,
  encrypted_payload bytea not null,
  nonce bytea not null,
  auth_tag bytea not null,
  key_version integer not null check (key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.outreach_oauth_states (
  state_hash bytea primary key,
  mailbox_id uuid references public.outreach_mailboxes(id) on delete cascade,
  provider public.outreach_mailbox_provider not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pkce_verifier_encrypted bytea,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table private.outreach_delivery_ledger (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.outreach_jobs(id) on delete cascade,
  mailbox_id uuid not null references public.outreach_mailboxes(id) on delete cascade,
  recipient_id uuid not null references public.outreach_recipients(id) on delete cascade,
  idempotency_key text not null unique,
  provider_message_id text,
  status text not null check (status in ('sending', 'accepted', 'confirmed', 'ambiguous', 'reconciled', 'failed')),
  payload_hash bytea not null,
  provider_response jsonb not null default '{}'::jsonb,
  first_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now()
);

create unique index outreach_delivery_provider_message_unique
  on private.outreach_delivery_ledger(mailbox_id, provider_message_id)
  where provider_message_id is not null;

create table private.outreach_provider_message_ledger (
  mailbox_id uuid not null references public.outreach_mailboxes(id) on delete cascade,
  provider_message_id text not null,
  source text not null check (source in ('crm_gmail', 'outreach_inbound', 'outreach_outbound')),
  first_seen_at timestamptz not null default now(),
  primary key (mailbox_id, provider_message_id)
);

-- One mailbox-email/provider-message gate is shared by the CRM Gmail sync and
-- Outreach.  The CRM may still keep one activity association per contact; this
-- ledger owns only message-level side effects so multi-recipient links survive.
create table private.communication_provider_message_ledger (
  mailbox_email citext not null,
  provider_message_id text not null,
  first_source text not null check (first_source in (
    'crm_gmail', 'outreach_inbound', 'outreach_outbound'
  )),
  claim_xid bigint not null default txid_current(),
  first_seen_at timestamptz not null default now(),
  primary key (mailbox_email, provider_message_id),
  check (mailbox_email = lower(trim(mailbox_email::text))::citext),
  check (length(trim(provider_message_id)) > 0)
);

create table private.outreach_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  identity_hmac bytea,
  body_encrypted bytea not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique (provider, provider_event_id)
);

create index outreach_webhook_identity_idx
  on private.outreach_webhook_events(identity_hmac)
  where identity_hmac is not null;

-- Ambiguous inbound provider events are retained encrypted until a human or a
-- later sync can match them. The clear sender/body never enters public tables;
-- identity_hmac supports conservative job cancellation and RGPD erasure.
create table private.outreach_inbound_reconciliation (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.outreach_mailboxes(id) on delete cascade,
  provider_message_id text not null,
  identity_hmac bytea,
  payload_encrypted bytea not null,
  nonce bytea not null,
  auth_tag bytea not null,
  key_version integer not null check (key_version > 0),
  kind text not null check (kind in (
    'reply', 'hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe', 'unknown'
  )),
  status text not null default 'reconciliation_required' check (status in (
    'reconciliation_required', 'resolved', 'ignored'
  )),
  received_at timestamptz not null default now(),
  resolved_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (mailbox_id, provider_message_id),
  check (length(trim(provider_message_id)) > 0),
  check ((status = 'resolved') = (resolved_at is not null))
);

create index outreach_inbound_reconciliation_identity_idx
  on private.outreach_inbound_reconciliation(identity_hmac)
  where identity_hmac is not null;

create table private.outreach_unsubscribe_tokens (
  token_hash bytea primary key,
  recipient_id uuid not null references public.outreach_recipients(id) on delete cascade,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table private.outreach_canary_allowlist (
  email citext primary key,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now()
);

insert into private.outreach_canary_allowlist(email)
values ('joao@nikufra.ai'), ('joaomilhazes71@gmail.com')
on conflict (email) do nothing;

create table private.outreach_hmac_keys (
  key_version integer primary key check (key_version > 0),
  key_material bytea not null check (octet_length(key_material) >= 32),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into private.outreach_hmac_keys(key_version, key_material)
values (1, gen_random_bytes(32));

create table private.outreach_import_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_sha256 bytea not null,
  dry_run boolean not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  counts jsonb not null default '{}'::jsonb,
  ambiguities jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (snapshot_sha256, dry_run)
);

-- Read access is capability-based. Mutations run only through the versioned
-- API using service_role/outreach_service; the browser receives no table write
-- privileges even when its user is an administrator.
create or replace function public.has_outreach_capability(capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.ativo
      and (
        p.role = 'admin'
        or case capability
          when 'view_campaigns' then p.outreach_role in ('viewer', 'sales_rep', 'campaign_manager')
          when 'view_metrics' then p.outreach_role in ('viewer', 'sales_rep', 'campaign_manager')
          when 'manage_threads' then p.outreach_role in ('sales_rep', 'campaign_manager')
          when 'manage_campaigns' then p.outreach_role = 'campaign_manager'
          when 'launch_campaigns' then p.outreach_role = 'campaign_manager'
          else false
        end
      )
  );
$$;

revoke all on function public.has_outreach_capability(text) from public, anon;
grant execute on function public.has_outreach_capability(text) to authenticated;

-- Harden the existing profile guard so a member cannot self-promote inside
-- Outreach through the otherwise legitimate self-update policy.
create or replace function public.protect_profile_security_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and
     (new.role is distinct from old.role or
      new.outreach_role is distinct from old.outreach_role or
      new.ativo is distinct from old.ativo or
      new.email is distinct from old.email) then
    raise exception 'Só um administrador pode alterar role, permissões, estado ou email';
  end if;

  if old.role = 'admin' and old.ativo and
     (new.role <> 'admin' or not new.ativo) then
    perform pg_advisory_xact_lock(hashtextextended('nikufra:last-active-admin', 0));
    if not exists (
      select 1 from public.profiles
      where id <> old.id and role = 'admin' and ativo
    ) then
      raise exception 'O CRM tem de manter pelo menos um administrador ativo';
    end if;
  end if;
  return new;
end $$;

create or replace function public.audit_profile_security_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role or
     new.outreach_role is distinct from old.outreach_role or
     new.ativo is distinct from old.ativo or
     new.email is distinct from old.email then
    insert into public.audit_log(actor_id, tabela, registo_id, acao, alteracoes)
    values (
      auth.uid(), 'profiles', new.id, 'UPDATE',
      jsonb_build_object(
        'role_anterior', old.role, 'role_novo', new.role,
        'outreach_role_anterior', old.outreach_role,
        'outreach_role_novo', new.outreach_role,
        'ativo_anterior', old.ativo, 'ativo_novo', new.ativo,
        'email_alterado', new.email is distinct from old.email
      )
    );
  end if;
  return new;
end $$;

revoke execute on function public.protect_profile_security_fields() from public, anon, authenticated;
revoke execute on function public.audit_profile_security_changes() from public, anon, authenticated;

-- Common indexes for the API and the concurrent scheduler.
create index outreach_campaigns_status_idx on public.outreach_campaigns(status, updated_at desc);
create index outreach_audience_members_contact_idx on public.outreach_audience_members(contact_id, audience_id);
create index outreach_recipients_campaign_status_idx on public.outreach_recipients(campaign_id, status);
create index outreach_recipients_contact_idx on public.outreach_recipients(contact_id) where contact_id is not null;
create index outreach_jobs_due_idx on public.outreach_jobs(scheduled_at, id)
  where status in ('pending', 'reconciliation_required');
create index outreach_jobs_recipient_idx on public.outreach_jobs(recipient_id, status);
create index outreach_threads_assigned_idx on public.outreach_threads(assigned_to, last_message_at desc);
create index outreach_threads_contact_idx on public.outreach_threads(contact_id, last_message_at desc);
create index outreach_messages_thread_idx on public.outreach_messages(thread_id, occurred_at);
create index outreach_verifications_email_idx on public.outreach_email_verifications(email, verified_at desc);
create index outreach_dns_mailbox_idx on public.outreach_dns_checks(mailbox_id, checked_at desc);
create index outreach_events_campaign_idx on public.outreach_events(campaign_id, occurred_at desc);
create index communication_suppressions_email_idx on public.communication_suppressions(email) where active and email is not null;
create index communication_suppressions_domain_idx on public.communication_suppressions(domain) where active and domain is not null;
create index communication_suppressions_company_idx on public.communication_suppressions(company_id) where active and company_id is not null;

-- Keep updated_at uniform with the rest of the CRM.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'outreach_system_state', 'outreach_mailboxes', 'outreach_campaigns',
    'outreach_campaign_steps', 'outreach_campaign_variants', 'outreach_audiences',
    'outreach_recipients', 'outreach_jobs', 'outreach_threads'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name
    );
  end loop;
end $$;

create trigger set_updated_at before update on private.outreach_credentials
for each row execute function public.set_updated_at();

-- RLS remains enabled even for table owners.  The API's narrowly privileged
-- login receives an explicit current_user policy later in this migration.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'outreach_system_state', 'outreach_mailboxes', 'outreach_campaigns',
    'outreach_campaign_steps', 'outreach_campaign_variants', 'outreach_audiences',
    'outreach_audience_members', 'outreach_recipients', 'outreach_jobs',
    'outreach_threads', 'outreach_messages', 'outreach_email_verifications',
    'outreach_dns_checks', 'outreach_metric_daily', 'outreach_events',
    'outreach_audit_log', 'communication_suppressions'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy %I_service_all on public.%I for all to public using (current_user in (''service_role'', ''outreach_service'')) with check (current_user in (''service_role'', ''outreach_service''))',
      table_name, table_name
    );
  end loop;
end $$;

create policy outreach_system_state_read on public.outreach_system_state
for select to authenticated using (public.has_outreach_capability('view_campaigns'));
create policy outreach_campaigns_read on public.outreach_campaigns
for select to authenticated using (public.has_outreach_capability('view_campaigns'));
create policy outreach_campaign_steps_read on public.outreach_campaign_steps
for select to authenticated using (public.has_outreach_capability('view_campaigns'));
create policy outreach_campaign_variants_read on public.outreach_campaign_variants
for select to authenticated using (public.has_outreach_capability('view_campaigns'));
create policy outreach_metric_daily_read on public.outreach_metric_daily
for select to authenticated using (public.has_outreach_capability('view_metrics'));
create policy outreach_events_read on public.outreach_events
for select to authenticated using (
  public.is_admin() or public.has_outreach_capability('manage_campaigns')
);

create policy outreach_mailboxes_managers_read on public.outreach_mailboxes
for select to authenticated using (public.is_admin() or public.has_outreach_capability('manage_campaigns'));
create policy outreach_audiences_managers_read on public.outreach_audiences
for select to authenticated using (public.is_admin() or public.has_outreach_capability('manage_campaigns'));
create policy outreach_audience_members_managers_read on public.outreach_audience_members
for select to authenticated using (public.is_admin() or public.has_outreach_capability('manage_campaigns'));
create policy outreach_recipients_managers_read on public.outreach_recipients
for select to authenticated using (public.is_admin() or public.has_outreach_capability('manage_campaigns'));
create policy outreach_jobs_managers_read on public.outreach_jobs
for select to authenticated using (public.is_admin() or public.has_outreach_capability('manage_campaigns'));
create policy outreach_verifications_managers_read on public.outreach_email_verifications
for select to authenticated using (public.is_admin() or public.has_outreach_capability('manage_campaigns'));
create policy outreach_dns_managers_read on public.outreach_dns_checks
for select to authenticated using (public.is_admin() or public.has_outreach_capability('manage_campaigns'));

create policy outreach_threads_team_read on public.outreach_threads
for select to authenticated using (
  public.is_admin()
  or public.has_outreach_capability('manage_campaigns')
  or (public.has_outreach_capability('manage_threads') and assigned_to = auth.uid())
);
create policy outreach_messages_team_read on public.outreach_messages
for select to authenticated using (
  public.is_admin()
  or public.has_outreach_capability('manage_campaigns')
  or exists (
    select 1 from public.outreach_threads t
    where t.id = outreach_messages.thread_id and t.assigned_to = auth.uid()
  )
);
create policy outreach_audit_admin_read on public.outreach_audit_log
for select to authenticated using (public.is_admin());
create policy communication_suppressions_admin_read on public.communication_suppressions
for select to authenticated using (public.is_admin());

-- The NOINHERIT API login needs narrowly scoped access to the CRM source of
-- truth. These policies are keyed by current_user so they do not require the
-- role to exist in local databases at parse time and cannot be reached by a
-- JWT/browser role.
create policy profiles_outreach_service_read on public.profiles
for select to public using (current_user in ('service_role', 'outreach_service'));
create policy empresas_outreach_service_read on public.empresas
for select to public using (current_user in ('service_role', 'outreach_service'));
create policy contactos_outreach_service_read on public.contactos
for select to public using (current_user in ('service_role', 'outreach_service'));
create policy oportunidades_outreach_service_read on public.oportunidades
for select to public using (current_user in ('service_role', 'outreach_service'));
create policy atividades_outreach_service_read on public.atividades
for select to public using (current_user in ('service_role', 'outreach_service'));

-- API-only dark deploy: browser roles receive no direct table privileges.
-- Capability/RLS policies remain enabled as defence in depth for a future,
-- explicit exposure, but every current read/write goes through the API.
revoke all on public.outreach_system_state, public.outreach_mailboxes,
  public.outreach_campaigns, public.outreach_campaign_steps,
  public.outreach_campaign_variants, public.outreach_audiences,
  public.outreach_audience_members, public.outreach_recipients,
  public.outreach_jobs, public.outreach_threads, public.outreach_messages,
  public.outreach_email_verifications, public.outreach_dns_checks,
  public.outreach_metric_daily, public.outreach_events,
  public.outreach_audit_log, public.communication_suppressions
from public, anon, authenticated;

revoke all on private.outreach_credentials, private.outreach_oauth_states,
  private.outreach_delivery_ledger, private.outreach_provider_message_ledger,
  private.communication_provider_message_ledger,
  private.outreach_webhook_events, private.outreach_inbound_reconciliation,
  private.outreach_unsubscribe_tokens,
  private.outreach_canary_allowlist, private.outreach_hmac_keys,
  private.outreach_import_runs
from public, anon, authenticated;

-- service_role is the local/test fallback.  Production additionally creates a
-- NOINHERIT LOGIN role named outreach_service before applying migrations.
grant usage on schema public, private to service_role;
grant select, insert, update, delete on all tables in schema private to service_role;
grant select on public.outreach_system_state to service_role;
grant select, insert, update, delete on public.outreach_mailboxes, public.outreach_campaigns,
  public.outreach_campaign_steps, public.outreach_campaign_variants,
  public.outreach_audiences, public.outreach_audience_members,
  public.outreach_recipients, public.outreach_jobs, public.outreach_threads,
  public.outreach_messages, public.outreach_email_verifications,
  public.outreach_dns_checks, public.outreach_metric_daily,
  public.outreach_events, public.outreach_audit_log,
  public.communication_suppressions to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'outreach_service') then
    execute 'grant usage on schema public, private to outreach_service';
    execute 'grant select on public.profiles, public.empresas, public.contactos, public.oportunidades, public.atividades to outreach_service';
    execute 'grant select on public.outreach_system_state to outreach_service';
    execute 'grant select, insert, update, delete on public.outreach_mailboxes, public.outreach_campaigns, public.outreach_campaign_steps, public.outreach_campaign_variants, public.outreach_audiences, public.outreach_audience_members, public.outreach_recipients, public.outreach_jobs, public.outreach_threads, public.outreach_messages, public.outreach_email_verifications, public.outreach_dns_checks, public.outreach_metric_daily, public.outreach_events, public.outreach_audit_log, public.communication_suppressions to outreach_service';
    execute 'grant select, insert, update, delete on private.outreach_credentials, private.outreach_oauth_states, private.outreach_delivery_ledger, private.outreach_provider_message_ledger, private.outreach_webhook_events, private.outreach_inbound_reconciliation, private.outreach_unsubscribe_tokens, private.outreach_canary_allowlist to outreach_service';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
