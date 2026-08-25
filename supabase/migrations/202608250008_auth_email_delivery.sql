begin;

-- Internal idempotency ledger for Auth email hooks. Recipient addresses are
-- hashed before storage and the table is never exposed through client roles.
create table public.auth_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_key text not null unique,
  recipient_hash text not null,
  action text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.auth_email_deliveries
for each row execute function public.set_updated_at();

alter table public.auth_email_deliveries enable row level security;
alter table public.auth_email_deliveries force row level security;
revoke all on public.auth_email_deliveries from public, anon, authenticated;

commit;
