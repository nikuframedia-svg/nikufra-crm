begin;

create type public.chat_conversation_kind as enum ('channel', 'direct', 'group');
create type public.chat_member_role as enum ('owner', 'member');
create type public.chat_agent_provider as enum ('anthropic');

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.chat_conversation_kind not null,
  nome text,
  descricao text not null default '',
  privado boolean not null default true,
  created_by uuid not null references public.profiles(id),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_channel_name check (
    (kind = 'channel' and char_length(trim(coalesce(nome, ''))) between 2 and 80)
    or (kind <> 'channel' and (nome is null or char_length(trim(nome)) between 2 and 80))
  )
);

create table public.chat_conversation_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.chat_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);

create table public.chat_agents (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) between 2 and 50),
  descricao text not null default '',
  provider public.chat_agent_provider not null default 'anthropic',
  model text not null default 'claude-sonnet-5' check (char_length(trim(model)) between 2 and 100),
  instrucoes text not null default '',
  ativo boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Credenciais nunca são expostas pelo PostgREST. Apenas as Edge Functions com
-- service role podem ler ou escrever estes valores cifrados.
create table public.chat_agent_secrets (
  agent_id uuid primary key references public.chat_agents(id) on delete cascade,
  api_key_encrypted text not null,
  updated_at timestamptz not null default now()
);

create table public.chat_agent_mcp_servers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.chat_agents(id) on delete cascade,
  nome text not null check (char_length(trim(nome)) between 2 and 60),
  url text not null check (url ~ '^https://'),
  authorization_token_encrypted text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, nome)
);

create table public.chat_conversation_agents (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  agent_id uuid not null references public.chat_agents(id) on delete cascade,
  added_by uuid not null references public.profiles(id),
  ativo boolean not null default true,
  added_at timestamptz not null default now(),
  primary key (conversation_id, agent_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id),
  agent_id uuid references public.chat_agents(id),
  parent_message_id uuid references public.chat_messages(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 8000),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_message_single_author check ((sender_id is null) <> (agent_id is null))
);

create index chat_conversations_recent_idx on public.chat_conversations(last_message_at desc);
create index chat_members_user_idx on public.chat_conversation_members(user_id, conversation_id);
create index chat_messages_conversation_idx on public.chat_messages(conversation_id, created_at desc);
create index chat_messages_parent_idx on public.chat_messages(parent_message_id, created_at) where parent_message_id is not null;
create index chat_conversation_agents_agent_idx on public.chat_conversation_agents(agent_id);

create trigger set_chat_conversations_updated_at before update on public.chat_conversations for each row execute function public.set_updated_at();
create trigger set_chat_agents_updated_at before update on public.chat_agents for each row execute function public.set_updated_at();
create trigger set_chat_agent_secrets_updated_at before update on public.chat_agent_secrets for each row execute function public.set_updated_at();
create trigger set_chat_agent_mcp_updated_at before update on public.chat_agent_mcp_servers for each row execute function public.set_updated_at();
create trigger set_chat_messages_updated_at before update on public.chat_messages for each row execute function public.set_updated_at();

create or replace function public.is_chat_member(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_conversation_members
    where conversation_id = target_conversation_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_chat(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.chat_conversation_members
    where conversation_id = target_conversation_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

revoke all on function public.is_chat_member(uuid) from public;
revoke all on function public.can_manage_chat(uuid) from public;
grant execute on function public.is_chat_member(uuid), public.can_manage_chat(uuid) to authenticated;

create or replace function public.create_chat_conversation(
  p_kind public.chat_conversation_kind,
  p_nome text default null,
  p_descricao text default '',
  p_member_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation_id uuid;
  other_member uuid;
begin
  if not public.is_active_member() then
    raise exception 'Conta sem acesso ao chat';
  end if;

  if p_kind = 'channel' and char_length(trim(coalesce(p_nome, ''))) not between 2 and 80 then
    raise exception 'O canal precisa de um nome entre 2 e 80 caracteres';
  end if;

  if p_kind = 'direct' then
    select member_id into other_member
    from unnest(p_member_ids) member_id
    where member_id <> auth.uid()
    limit 1;
    if other_member is null then raise exception 'Seleciona uma pessoa'; end if;

    select c.id into conversation_id
    from public.chat_conversations c
    where c.kind = 'direct'
      and exists (select 1 from public.chat_conversation_members m where m.conversation_id = c.id and m.user_id = auth.uid())
      and exists (select 1 from public.chat_conversation_members m where m.conversation_id = c.id and m.user_id = other_member)
      and (select count(*) from public.chat_conversation_members m where m.conversation_id = c.id) = 2
    limit 1;
    if conversation_id is not null then return conversation_id; end if;
  end if;

  insert into public.chat_conversations(kind, nome, descricao, privado, created_by)
  values (
    p_kind,
    nullif(trim(p_nome), ''),
    left(trim(coalesce(p_descricao, '')), 500),
    p_kind <> 'channel',
    auth.uid()
  )
  returning id into conversation_id;

  insert into public.chat_conversation_members(conversation_id, user_id, role)
  values (conversation_id, auth.uid(), 'owner');

  insert into public.chat_conversation_members(conversation_id, user_id, role)
  select conversation_id, p.id, 'member'
  from public.profiles p
  where p.id = any(p_member_ids)
    and p.id <> auth.uid()
    and p.ativo
  on conflict do nothing;

  return conversation_id;
end;
$$;

create or replace function public.add_chat_members(p_conversation_id uuid, p_member_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if not public.can_manage_chat(p_conversation_id) then
    raise exception 'Sem permissão para adicionar membros';
  end if;
  insert into public.chat_conversation_members(conversation_id, user_id)
  select p_conversation_id, p.id
  from public.profiles p
  where p.id = any(p_member_ids) and p.ativo
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.attach_chat_agent(p_conversation_id uuid, p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_chat(p_conversation_id) then
    raise exception 'Sem permissão para adicionar agentes';
  end if;
  if not exists (select 1 from public.chat_agents where id = p_agent_id and ativo) then
    raise exception 'Agente indisponível';
  end if;
  insert into public.chat_conversation_agents(conversation_id, agent_id, added_by, ativo)
  values (p_conversation_id, p_agent_id, auth.uid(), true)
  on conflict (conversation_id, agent_id) do update set ativo = true, added_by = excluded.added_by, added_at = now();
end;
$$;

create or replace function public.mark_chat_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation_id
    and user_id = auth.uid();
  if not found then raise exception 'Sem acesso a esta conversa'; end if;
end;
$$;

revoke all on function public.create_chat_conversation(public.chat_conversation_kind, text, text, uuid[]) from public;
revoke all on function public.add_chat_members(uuid, uuid[]) from public;
revoke all on function public.attach_chat_agent(uuid, uuid) from public;
revoke all on function public.mark_chat_read(uuid) from public;
grant execute on function public.create_chat_conversation(public.chat_conversation_kind, text, text, uuid[]) to authenticated;
grant execute on function public.add_chat_members(uuid, uuid[]) to authenticated;
grant execute on function public.attach_chat_agent(uuid, uuid) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;

create or replace function public.touch_chat_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;
create trigger touch_chat_conversation after insert on public.chat_messages for each row execute function public.touch_chat_conversation();

alter table public.chat_conversations enable row level security;
alter table public.chat_conversations force row level security;
alter table public.chat_conversation_members enable row level security;
alter table public.chat_conversation_members force row level security;
alter table public.chat_agents enable row level security;
alter table public.chat_agents force row level security;
alter table public.chat_agent_secrets enable row level security;
alter table public.chat_agent_secrets force row level security;
alter table public.chat_agent_mcp_servers enable row level security;
alter table public.chat_agent_mcp_servers force row level security;
alter table public.chat_conversation_agents enable row level security;
alter table public.chat_conversation_agents force row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_messages force row level security;

create policy chat_conversations_read on public.chat_conversations
for select to authenticated
using (public.is_active_member() and public.is_chat_member(id));
create policy chat_conversations_update on public.chat_conversations
for update to authenticated
using (public.can_manage_chat(id))
with check (public.can_manage_chat(id));

create policy chat_members_read on public.chat_conversation_members
for select to authenticated
using (public.is_active_member() and public.is_chat_member(conversation_id));

create policy chat_agents_read on public.chat_agents
for select to authenticated
using (public.is_active_member() and ativo);

create policy chat_conversation_agents_read on public.chat_conversation_agents
for select to authenticated
using (public.is_active_member() and public.is_chat_member(conversation_id));

create policy chat_messages_read on public.chat_messages
for select to authenticated
using (public.is_active_member() and public.is_chat_member(conversation_id));
create policy chat_messages_insert on public.chat_messages
for insert to authenticated
with check (
  public.is_active_member()
  and public.is_chat_member(conversation_id)
  and sender_id = auth.uid()
  and agent_id is null
);
create policy chat_messages_update_own on public.chat_messages
for update to authenticated
using (sender_id = auth.uid() and public.is_chat_member(conversation_id))
with check (sender_id = auth.uid() and agent_id is null and public.is_chat_member(conversation_id));

grant select, update on public.chat_conversations to authenticated;
grant select on public.chat_conversation_members to authenticated;
grant select on public.chat_agents to authenticated;
grant select on public.chat_conversation_agents to authenticated;
grant select, insert, update on public.chat_messages to authenticated;
revoke all on public.chat_agent_secrets from anon, authenticated;
revoke all on public.chat_agent_mcp_servers from anon, authenticated;
revoke delete on public.chat_conversations, public.chat_conversation_members, public.chat_agents, public.chat_conversation_agents, public.chat_messages from anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.chat_conversations;
exception when duplicate_object or undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.chat_conversation_members;
exception when duplicate_object or undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.chat_conversation_agents;
exception when duplicate_object or undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object or undefined_object then null;
end $$;

commit;
