begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.profile_role as enum ('admin', 'member');
create type public.vertical_type as enum ('metalomecanica', 'automovel', 'aluminio', 'cortica', 'compositos', 'eletronica', 'outro');
create type public.origem_type as enum ('outbound_email', 'outbound_linkedin', 'referencia', 'inbound', 'evento', 'rede_pessoal');
create type public.oportunidade_estado as enum ('nao_contactado', 'contactado', 'reuniao_marcada', 'reuniao_feita', 'proposta', 'piloto', 'cliente', 'perdido', 'adiado');
create type public.oportunidade_tipo as enum ('consultoria', 'licenca_pp1', 'piloto', 'misto');
create type public.motivo_perda_type as enum ('preco', 'timing', 'sem_orcamento', 'concorrente', 'sem_resposta', 'nao_prioritario', 'outro');
create type public.atividade_tipo as enum ('email_enviado', 'email_recebido', 'chamada', 'reuniao', 'visita', 'proposta_enviada', 'nota');
create type public.faturacao_tipo as enum ('contratualizado', 'faturado', 'recebido');
create type public.objetivo_tipo as enum ('faturacao', 'reunioes', 'novas_leads', 'propostas');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  email text not null unique,
  role public.profile_role not null default 'member',
  ativo boolean not null default false,
  cor text not null default '#3B82F6' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nif text,
  website text,
  vertical public.vertical_type not null default 'outro',
  pais char(2) not null default 'PT',
  cidade text,
  num_colaboradores integer check (num_colaboradores is null or num_colaboradores >= 0),
  num_unidades_fabris integer check (num_unidades_fabris is null or num_unidades_fabris >= 0),
  erp text,
  mes text,
  nivel_maturidade_digital integer check (nivel_maturidade_digital between 1 and 5),
  origem public.origem_type not null,
  notas text not null default '',
  arquivado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contactos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null,
  cargo text,
  email citext,
  telefone text,
  linkedin_url text,
  principal boolean not null default false,
  optout boolean not null default false,
  notas text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index contactos_email_unique on public.contactos(email) where email is not null;
create unique index contactos_um_principal_por_empresa on public.contactos(empresa_id) where principal;

create or replace function public.probabilidade_padrao(estado public.oportunidade_estado)
returns integer language sql immutable strict as $$
  select case estado
    when 'nao_contactado' then 0 when 'contactado' then 5 when 'reuniao_marcada' then 15
    when 'reuniao_feita' then 30 when 'proposta' then 50 when 'piloto' then 75
    when 'cliente' then 100 when 'perdido' then 0 when 'adiado' then 10 end;
$$;

create table public.oportunidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  contacto_principal_id uuid references public.contactos(id),
  owner_id uuid not null references public.profiles(id),
  titulo text not null,
  estado public.oportunidade_estado not null default 'nao_contactado',
  tipo public.oportunidade_tipo not null,
  valor_estimado numeric(14,2) not null default 0 check (valor_estimado >= 0),
  valor_recorrente_anual numeric(14,2) check (valor_recorrente_anual is null or valor_recorrente_anual >= 0),
  probabilidade integer not null default 0 check (probabilidade between 0 and 100),
  probabilidade_manual boolean not null default false,
  data_prevista_fecho date,
  data_primeiro_contacto date,
  data_fecho date,
  motivo_perda public.motivo_perda_type,
  notas_perda text,
  notas text not null default '',
  arquivado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint perda_exige_motivo check (estado <> 'perdido' or motivo_perda is not null),
  constraint cliente_exige_fecho check (estado <> 'cliente' or data_fecho is not null)
);

create table public.estado_historico (
  id uuid primary key default gen_random_uuid(),
  oportunidade_id uuid not null references public.oportunidades(id),
  estado_anterior public.oportunidade_estado,
  estado_novo public.oportunidade_estado not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.atividades (
  id uuid primary key default gen_random_uuid(),
  oportunidade_id uuid references public.oportunidades(id),
  empresa_id uuid not null references public.empresas(id),
  contacto_id uuid references public.contactos(id),
  user_id uuid not null references public.profiles(id),
  tipo public.atividade_tipo not null,
  data timestamptz not null default now(),
  duracao_min integer check (duracao_min is null or duracao_min >= 0),
  descricao text not null,
  message_id text,
  thread_id text,
  assunto text,
  snippet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index atividades_message_id_unique on public.atividades(message_id) where message_id is not null;

create table public.faturacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  oportunidade_id uuid references public.oportunidades(id),
  tipo public.faturacao_tipo not null,
  valor numeric(14,2) not null check (valor >= 0),
  data date not null,
  descricao text not null,
  recorrente boolean not null default false,
  referencia_externa text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.objetivos (
  id uuid primary key default gen_random_uuid(),
  ano integer not null check (ano between 2020 and 2100),
  mes integer check (mes between 1 and 12),
  tipo public.objetivo_tipo not null,
  valor_alvo numeric(14,2) not null check (valor_alvo >= 0),
  user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index objetivos_unicos_equipa on public.objetivos(ano, coalesce(mes, 0), tipo) where user_id is null;
create unique index objetivos_unicos_pessoa on public.objetivos(ano, coalesce(mes, 0), tipo, user_id) where user_id is not null;

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  assunto text not null,
  corpo text not null,
  utilizacoes integer not null default 0,
  respostas integer not null default 0,
  ativo boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.google_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  refresh_token_encrypted text not null,
  history_id text,
  scopes text[] not null default array['gmail.readonly', 'gmail.compose'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  tabela text not null,
  registo_id uuid,
  acao text not null check (acao in ('INSERT', 'UPDATE', 'ARCHIVE', 'RGPD_DELETE')),
  alteracoes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','empresas','contactos','oportunidades','estado_historico','atividades','faturacao','objetivos','templates','google_tokens','audit_log'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

create or replace function public.set_oportunidade_defaults()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and not new.probabilidade_manual then
    new.probabilidade := public.probabilidade_padrao(new.estado);
  elsif tg_op = 'UPDATE' and new.estado is distinct from old.estado and not new.probabilidade_manual then
    new.probabilidade := public.probabilidade_padrao(new.estado);
  end if;
  if new.estado = 'cliente' and new.data_fecho is null then new.data_fecho := current_date; end if;
  return new;
end $$;
create trigger oportunidade_defaults before insert or update on public.oportunidades for each row execute function public.set_oportunidade_defaults();

create or replace function public.log_estado_historico()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.estado is distinct from old.estado then
    insert into public.estado_historico(oportunidade_id, estado_anterior, estado_novo, changed_by)
    values (new.id, case when tg_op = 'INSERT' then null else old.estado end, new.estado, auth.uid());
  end if;
  return new;
end $$;
create trigger oportunidade_estado_historico after insert or update of estado on public.oportunidades for each row execute function public.log_estado_historico();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) not like '%@nikufra.ai' then
    raise exception 'Apenas endereços @nikufra.ai são permitidos';
  end if;
  insert into public.profiles(id, nome, email, role, ativo)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)), lower(new.email), 'member', false);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and ativo);
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and ativo and role = 'admin');
$$;
revoke all on function public.is_active_member() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_active_member(), public.is_admin() to authenticated;

create or replace function public.protect_profile_security_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id and not public.is_admin() and
     (new.role is distinct from old.role or new.ativo is distinct from old.ativo or new.email is distinct from old.email) then
    raise exception 'Só um administrador pode alterar role, estado ou email';
  end if;
  return new;
end $$;
create trigger protect_profile_security_fields before update on public.profiles for each row execute function public.protect_profile_security_fields();

do $$ declare t text; begin
  foreach t in array array['profiles','empresas','contactos','oportunidades','estado_historico','atividades','faturacao','objetivos','templates','google_tokens','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

create policy profiles_read on public.profiles for select to authenticated using (public.is_active_member());
create policy profiles_read_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid() and public.is_active_member()) with check (id = auth.uid() and public.is_active_member());
create policy profiles_admin_all on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

do $$ declare t text; begin
  foreach t in array array['empresas','contactos','oportunidades','atividades','templates'] loop
    execute format('create policy %I_read on public.%I for select to authenticated using (public.is_active_member())', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.is_active_member())', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.is_active_member()) with check (public.is_active_member())', t, t);
  end loop;
end $$;

create policy estado_historico_read on public.estado_historico for select to authenticated using (public.is_active_member());
create policy faturacao_read on public.faturacao for select to authenticated using (public.is_active_member());
create policy faturacao_admin_write on public.faturacao for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy objetivos_read on public.objetivos for select to authenticated using (public.is_active_member());
create policy objetivos_admin_write on public.objetivos for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy google_tokens_own on public.google_tokens for select to authenticated using (user_id = auth.uid() and public.is_active_member());
create policy audit_admin_read on public.audit_log for select to authenticated using (public.is_admin());

-- O cliente nunca recebe permissão de hard delete. Eliminação RGPD corre apenas numa Edge Function com service role.
revoke delete on all tables in schema public from anon, authenticated;

create index oportunidades_estado_idx on public.oportunidades(estado) where not arquivado;
create index oportunidades_owner_idx on public.oportunidades(owner_id) where not arquivado;
create index estado_historico_opp_data_idx on public.estado_historico(oportunidade_id, changed_at);
create index atividades_empresa_data_idx on public.atividades(empresa_id, data desc);
create index atividades_user_data_idx on public.atividades(user_id, data desc);
create index faturacao_data_tipo_idx on public.faturacao(data, tipo);

commit;
