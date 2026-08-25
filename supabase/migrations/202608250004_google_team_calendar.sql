begin;

create table public.google_calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  google_event_id text not null,
  calendar_id text not null default 'primary',
  titulo text not null,
  inicio timestamptz not null,
  fim timestamptz not null,
  dia_inteiro boolean not null default false,
  privado boolean not null default false,
  estado text not null default 'confirmed',
  localizacao text,
  html_link text,
  meet_link text,
  organizador_email text,
  participantes integer not null default 0 check (participantes >= 0),
  google_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, calendar_id, google_event_id),
  check (fim >= inicio)
);

create index google_calendar_events_start_idx on public.google_calendar_events(inicio);
create index google_calendar_events_user_start_idx on public.google_calendar_events(user_id, inicio);

create trigger set_google_calendar_events_updated_at
before update on public.google_calendar_events
for each row execute function public.set_updated_at();

alter table public.google_calendar_events enable row level security;
alter table public.google_calendar_events force row level security;

create policy google_calendar_events_read
on public.google_calendar_events for select to authenticated
using (public.is_active_member());

grant select on public.google_calendar_events to authenticated;

-- Force a complete Calendar pass once so existing and future events are copied
-- into the shared team agenda, including events that have no CRM contact.
update public.google_tokens
set calendar_sync_token = null,
    calendar_events_synced = 0,
    calendar_last_sync_at = null;

notify pgrst, 'reload schema';

commit;
