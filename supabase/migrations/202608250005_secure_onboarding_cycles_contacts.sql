begin;

-- The commercial cycle is explicitly the confirmed interval between first
-- contact and verbal agreement. It is independent from invoicing and project
-- delivery dates.
alter table public.oportunidades
  add column if not exists ciclo_acordo_meses numeric(6,2)
  check (ciclo_acordo_meses is null or ciclo_acordo_meses between 0 and 240);

update public.oportunidades o
set ciclo_acordo_meses = case lower(e.nome)
  when 'ficosa' then 1
  when 'nelo' then 3
  when 'jorge pires' then 2
  when 'metalogalva' then 2
end
from public.empresas e
where e.id = o.empresa_id
  and lower(e.nome) in ('ficosa', 'nelo', 'jorge pires', 'metalogalva');

create or replace view public.metricas_ciclo_acordo_verbal
with (security_invoker = true) as
select count(*) as n,
  avg(ciclo_acordo_meses) as media_meses,
  percentile_cont(0.5) within group (order by ciclo_acordo_meses)::numeric as mediana_meses,
  (count(*) < 5) as amostra_insuficiente
from public.oportunidades
where ciclo_acordo_meses is not null and not arquivado;

-- Google import is opt-in after a read-only preview. Existing installations
-- that have already imported data remain confirmed.
alter table public.google_tokens
  add column if not exists import_confirmed_at timestamptz,
  add column if not exists preview_messages_found bigint not null default 0,
  add column if not exists preview_contacts_found bigint not null default 0,
  add column if not exists preview_contacts_existing bigint not null default 0,
  add column if not exists preview_scanned_at timestamptz;

update public.google_tokens
set import_confirmed_at = coalesce(import_confirmed_at, last_sync_at, now())
where import_confirmed_at is null
  and (messages_synced > 0 or backfill_complete);

-- External Google accounts are allowed only after an administrator invite.
create table public.user_invitations (
  email citext primary key,
  nome text not null default '',
  invited_by uuid not null references public.profiles(id),
  invited_at timestamptz not null default now(),
  used_at timestamptz
);

alter table public.user_invitations enable row level security;
alter table public.user_invitations force row level security;
revoke all on public.user_invitations from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  admin_exists boolean;
  invitation public.user_invitations%rowtype;
begin
  select exists(select 1 from public.profiles where role = 'admin' and ativo)
    into admin_exists;

  if not admin_exists then
    if lower(new.email) not like '%@nikufra.ai' then
      raise exception 'A primeira conta tem de pertencer a @nikufra.ai';
    end if;
    insert into public.profiles(id, nome, email, role, ativo)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)), lower(new.email), 'admin', true);
    return new;
  end if;

  select * into invitation
  from public.user_invitations
  where email = lower(new.email) and used_at is null
  for update;

  if invitation.email is null then
    raise exception 'Este endereço ainda não foi convidado por um administrador';
  end if;

  insert into public.profiles(id, nome, email, role, ativo)
  values (
    new.id,
    coalesce(nullif(invitation.nome, ''), new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    lower(new.email),
    'member',
    true
  );

  update public.user_invitations set used_at = now() where email = invitation.email;
  return new;
end $$;

-- Deleted contacts are suppressed from future Google imports. Activities and
-- opportunities retain their commercial history but lose the contact link.
create table public.contact_import_suppressions (
  id uuid primary key default gen_random_uuid(),
  email citext,
  google_resource_name text,
  deleted_by uuid not null references public.profiles(id),
  deleted_at timestamptz not null default now(),
  check (email is not null or google_resource_name is not null)
);

create unique index contact_import_suppressions_email_unique
  on public.contact_import_suppressions(email) where email is not null;
create unique index contact_import_suppressions_resource_unique
  on public.contact_import_suppressions(google_resource_name) where google_resource_name is not null;

alter table public.contact_import_suppressions enable row level security;
alter table public.contact_import_suppressions force row level security;
revoke all on public.contact_import_suppressions from anon, authenticated;

alter table public.oportunidades
  drop constraint if exists oportunidades_contacto_principal_id_fkey,
  add constraint oportunidades_contacto_principal_id_fkey
    foreign key (contacto_principal_id) references public.contactos(id) on delete set null;

alter table public.atividades
  drop constraint if exists atividades_contacto_id_fkey,
  add constraint atividades_contacto_id_fkey
    foreign key (contacto_id) references public.contactos(id) on delete set null;

-- Least privilege: RLS remains the row boundary, and client roles receive only
-- the SQL operations the application actually uses. In particular, neither
-- anon nor authenticated can TRUNCATE or hard-delete CRM tables.
alter default privileges in schema public revoke all on tables from anon, authenticated;
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all tables in schema public from authenticated;

grant select, insert, update on public.empresas, public.contactos,
  public.oportunidades, public.atividades, public.templates to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.faturacao, public.objetivos,
  public.pipeline_settings to authenticated;
grant select on public.estado_historico, public.google_tokens,
  public.google_calendar_events, public.audit_log to authenticated;
grant select on public.metricas_taxa_reuniao_coorte, public.metricas_no_show,
  public.metricas_tempo_estado, public.metricas_ciclo_venda,
  public.metricas_ciclo_acordo_verbal, public.metricas_pipeline,
  public.metricas_resultados, public.metricas_funil,
  public.metricas_distribuicao_vertical, public.metricas_cliente,
  public.metricas_email to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_oportunidade_defaults() from public, anon, authenticated;
revoke execute on function public.log_estado_historico() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
