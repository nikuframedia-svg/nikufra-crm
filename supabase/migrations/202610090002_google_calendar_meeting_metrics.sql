begin;

-- PostgREST emits `on conflict (source_mailbox_email,message_id,contacto_id)`
-- without the predicate of the old partial index. PostgreSQL therefore could
-- not infer the index and returned 42P10. A regular unique index has the same
-- null semantics (rows containing a null are not considered duplicates) and
-- can be used safely by every importer.
lock table public.atividades in share row exclusive mode;
drop index if exists public.atividades_mailbox_provider_message_unique;
create unique index atividades_mailbox_provider_message_unique
  on public.atividades(source_mailbox_email, message_id, contacto_id);

alter table public.google_calendar_events
  add column if not exists ical_uid text,
  add column if not exists occurrence_key text,
  add column if not exists recurring_event_id text,
  add column if not exists original_start timestamptz,
  add column if not exists event_type text not null default 'default',
  add column if not exists self_response_status text,
  add column if not exists organizer_is_self boolean not null default false,
  add column if not exists internal_human_count integer not null default 0,
  add column if not exists external_human_count integer not null default 0,
  add column if not exists resource_count integer not null default 0,
  add column if not exists cancelled_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.google_calendar_events'::regclass
      and conname = 'google_calendar_events_self_response_status_check'
  ) then
    alter table public.google_calendar_events
      add constraint google_calendar_events_self_response_status_check
      check (
        self_response_status is null
        or self_response_status in ('accepted', 'declined', 'tentative', 'needsAction', 'unknown')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.google_calendar_events'::regclass
      and conname = 'google_calendar_events_human_counts_check'
  ) then
    alter table public.google_calendar_events
      add constraint google_calendar_events_human_counts_check
      check (
        internal_human_count >= 0
        and external_human_count >= 0
        and resource_count >= 0
      );
  end if;
end;
$$;

create index if not exists google_calendar_events_occurrence_idx
  on public.google_calendar_events(occurrence_key, user_id)
  where occurrence_key is not null;
create index if not exists google_calendar_events_metrics_idx
  on public.google_calendar_events(inicio, user_id, estado)
  where occurrence_key is not null and not dia_inteiro;

do $$
begin
  if not exists (
    select 1 from pg_type
    where typnamespace = 'public'::regnamespace and typname = 'meeting_outcome_type'
  ) then
    create type public.meeting_outcome_type as enum (
      'scheduled', 'held', 'cancelled', 'no_show', 'unknown', 'tentative'
    );
  end if;
end;
$$;

create table if not exists public.meeting_outcomes (
  id uuid primary key default gen_random_uuid(),
  occurrence_key text not null unique,
  outcome public.meeting_outcome_type not null,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'google', 'import')),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_meeting_outcome_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
      new.confirmed_by := auth.uid();
    else
      new.updated_by := coalesce(new.updated_by, new.created_by);
      new.confirmed_by := coalesce(new.confirmed_by, new.updated_by, new.created_by);
    end if;
    new.confirmed_at := coalesce(new.confirmed_at, now());
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if auth.uid() is not null then
      new.updated_by := auth.uid();
      if new.outcome is distinct from old.outcome
        or new.notes is distinct from old.notes then
        new.confirmed_by := auth.uid();
        new.confirmed_at := now();
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists set_meeting_outcome_audit_fields on public.meeting_outcomes;
create trigger set_meeting_outcome_audit_fields
before insert or update on public.meeting_outcomes
for each row execute function public.set_meeting_outcome_audit_fields();

alter table public.meeting_outcomes enable row level security;
alter table public.meeting_outcomes force row level security;

drop policy if exists meeting_outcomes_read on public.meeting_outcomes;
create policy meeting_outcomes_read
on public.meeting_outcomes for select to authenticated
using (public.is_active_member());

drop policy if exists meeting_outcomes_insert on public.meeting_outcomes;
create policy meeting_outcomes_insert
on public.meeting_outcomes for insert to authenticated
with check (public.is_active_member() and created_by = auth.uid());

drop policy if exists meeting_outcomes_update on public.meeting_outcomes;
create policy meeting_outcomes_update
on public.meeting_outcomes for update to authenticated
using (public.is_active_member())
with check (public.is_active_member());

revoke all on table public.meeting_outcomes from public, anon, authenticated;
grant select, insert, update on table public.meeting_outcomes to authenticated;

-- Calendar rows created before this migration deliberately retain a null
-- occurrence_key. They are excluded from analytics until the controlled full
-- resync below has classified attendees and expanded recurring occurrences.
create or replace function public.meeting_metrics(
  p_from timestamptz,
  p_to timestamptz,
  p_grain text,
  p_user_id uuid default null,
  p_kind text default 'external',
  p_timezone text default 'Europe/Lisbon'
)
returns table (
  bucket_start date,
  meeting_count bigint,
  participation_count bigint,
  scheduled_count bigint,
  held_count bigint,
  cancelled_count bigint,
  no_show_count bigint,
  unknown_count bigint,
  tentative_count bigint
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  bucket_step interval;
  local_from timestamp;
  local_to timestamp;
begin
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception using errcode = '22023', message = 'O intervalo de métricas é inválido';
  end if;
  if p_grain not in ('day', 'week', 'month') then
    raise exception using errcode = '22023', message = 'A granularidade deve ser day, week ou month';
  end if;
  if p_kind not in ('external', 'internal', 'all') then
    raise exception using errcode = '22023', message = 'O tipo deve ser external, internal ou all';
  end if;

  -- This also validates the IANA timezone before any data is read.
  local_from := p_from at time zone p_timezone;
  local_to := p_to at time zone p_timezone;
  bucket_step := case p_grain
    when 'day' then interval '1 day'
    when 'week' then interval '1 week'
    else interval '1 month'
  end;

  return query
  with buckets as (
    select generated::date as bucket_start
    from generate_series(
      date_trunc(p_grain, local_from),
      date_trunc(p_grain, local_to - interval '1 microsecond'),
      bucket_step
    ) generated
  ), base_rows as (
    select
      event.occurrence_key,
      event.user_id,
      event.inicio,
      event.google_updated_at,
      event.estado,
      event.cancelled_at,
      event.self_response_status,
      event.internal_human_count,
      event.external_human_count
    from public.google_calendar_events event
    where public.is_active_member()
      and event.occurrence_key is not null
      and event.fim > event.inicio
      and not event.dia_inteiro
      and coalesce(event.self_response_status, 'unknown') <> 'declined'
      and event.event_type in ('default', 'fromGmail')
      and (p_user_id is null or event.user_id = p_user_id)
  ), candidate_occurrences as (
    -- Use the indexed interval only to find possible occurrence keys. All
    -- copies of each key are then rolled up before the canonical start is
    -- checked, so a stale rescheduled copy cannot appear in two periods.
    select distinct row_data.occurrence_key
    from base_rows row_data
    where row_data.inicio >= p_from
      and row_data.inicio < p_to
  ), occurrence_rollup as (
    select
      row_data.occurrence_key,
      (array_agg(
        row_data.inicio
        order by row_data.google_updated_at desc nulls last, row_data.inicio desc
      ))[1] as inicio,
      count(distinct row_data.user_id)::bigint as participations,
      (array_agg(
        row_data.internal_human_count
        order by row_data.google_updated_at desc nulls last, row_data.inicio desc
      ))[1] as internal_human_count,
      (array_agg(
        row_data.external_human_count
        order by row_data.google_updated_at desc nulls last, row_data.inicio desc
      ))[1] as external_human_count,
      -- A stale/cancelled copy in one colleague's calendar must not cancel an
      -- occurrence that is still active in another colleague's calendar.
      bool_and(
        row_data.estado = 'cancelled' or row_data.cancelled_at is not null
      ) as calendar_cancelled,
      bool_and(row_data.self_response_status = 'tentative') as response_tentative
    from base_rows row_data
    join candidate_occurrences candidate
      on candidate.occurrence_key = row_data.occurrence_key
    group by row_data.occurrence_key
  ), occurrences as (
    select
      occurrence_rollup.*,
      date_trunc(p_grain, occurrence_rollup.inicio at time zone p_timezone)::date as bucket_start
    from occurrence_rollup
    where occurrence_rollup.inicio >= p_from
      and occurrence_rollup.inicio < p_to
      and (
        (p_kind = 'external' and occurrence_rollup.external_human_count > 0)
        or (
          p_kind = 'internal'
          and occurrence_rollup.external_human_count = 0
          and occurrence_rollup.internal_human_count >= 2
        )
        or (
          p_kind = 'all'
          and (
            occurrence_rollup.external_human_count > 0
            or occurrence_rollup.internal_human_count >= 2
          )
        )
      )
  ), classified as (
    select
      occurrence.*,
      case
        when occurrence.calendar_cancelled then 'cancelled'::public.meeting_outcome_type
        when manual.outcome is not null then manual.outcome
        when occurrence.response_tentative then 'tentative'::public.meeting_outcome_type
        when occurrence.inicio >= now() then 'scheduled'::public.meeting_outcome_type
        else 'unknown'::public.meeting_outcome_type
      end as effective_outcome
    from occurrences occurrence
    left join public.meeting_outcomes manual
      on manual.occurrence_key = occurrence.occurrence_key
  )
  select
    bucket.bucket_start,
    count(classified.occurrence_key) filter (
      where classified.effective_outcome not in ('cancelled', 'no_show')
    )::bigint as meeting_count,
    coalesce(sum(classified.participations) filter (
      where classified.effective_outcome not in ('cancelled', 'no_show')
    ), 0)::bigint as participation_count,
    count(classified.occurrence_key) filter (
      where classified.effective_outcome = 'scheduled'
    )::bigint as scheduled_count,
    count(classified.occurrence_key) filter (
      where classified.effective_outcome = 'held'
    )::bigint as held_count,
    count(classified.occurrence_key) filter (
      where classified.effective_outcome = 'cancelled'
    )::bigint as cancelled_count,
    count(classified.occurrence_key) filter (
      where classified.effective_outcome = 'no_show'
    )::bigint as no_show_count,
    count(classified.occurrence_key) filter (
      where classified.effective_outcome = 'unknown'
    )::bigint as unknown_count,
    count(classified.occurrence_key) filter (
      where classified.effective_outcome = 'tentative'
    )::bigint as tentative_count
  from buckets bucket
  left join classified on classified.bucket_start = bucket.bucket_start
  group by bucket.bucket_start
  order by bucket.bucket_start;
end;
$$;

revoke all on function public.meeting_metrics(timestamptz,timestamptz,text,uuid,text,text)
  from public, anon;
grant execute on function public.meeting_metrics(timestamptz,timestamptz,text,uuid,text,text)
  to authenticated;

-- Calendar has its own lightweight schedule so a long Gmail/contact backfill
-- cannot leave the agenda and its metrics stale. The endpoint still validates
-- the service-role token and each Google account independently.
create or replace function private.invoke_google_calendar_sync()
returns void
language plpgsql
security definer
set search_path = private, public, vault, net, pg_temp
as $$
declare
  sync_url text;
  service_key text;
begin
  select decrypted_secret into sync_url
  from vault.decrypted_secrets where name = 'gmail_sync_url';
  select decrypted_secret into service_key
  from vault.decrypted_secrets where name = 'gmail_sync_service_key';
  if sync_url is null or service_key is null then
    raise warning 'gmail_sync_url ou gmail_sync_service_key ainda não configurado no Vault';
    return;
  end if;
  perform net.http_post(
    url := sync_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('calendarOnly', true),
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function private.invoke_google_calendar_sync()
  from public, anon, authenticated;

do $$
begin
  if exists(select 1 from cron.job where jobname = 'nikufra-calendar-sync') then
    perform cron.unschedule('nikufra-calendar-sync');
  end if;
  -- Offset from the full Gmail job to avoid refreshing the same token twice at
  -- the exact same instant.
  perform cron.schedule(
    'nikufra-calendar-sync',
    '7,22,37,52 * * * *',
    'select private.invoke_google_calendar_sync()'
  );
end;
$$;

-- The importer will now request expanded recurring instances, classify all
-- attendees and reconcile its local Calendar projection after the full pass.
-- Clearing only the Calendar cursor does not disturb Gmail or People cursors.
update public.google_tokens
set calendar_sync_token = null,
    calendar_events_synced = 0,
    calendar_last_sync_at = null;

notify pgrst, 'reload schema';

commit;
