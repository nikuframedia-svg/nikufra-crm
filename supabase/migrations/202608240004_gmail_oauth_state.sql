begin;

create table public.google_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  state_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.google_oauth_states for each row execute function public.set_updated_at();
alter table public.google_oauth_states enable row level security;
alter table public.google_oauth_states force row level security;
revoke all on public.google_oauth_states from anon, authenticated;

commit;
