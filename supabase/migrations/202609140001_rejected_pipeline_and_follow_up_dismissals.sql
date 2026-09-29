begin;

-- The existing `perdido` database state is presented as "Recusado" in the CRM.
-- Keeping the enum value avoids breaking historical metrics and older clients.
alter table public.oportunidades
  add column if not exists valor_proposta numeric(14,2);

update public.oportunidades
set valor_proposta = 0
where estado = 'perdido' and valor_proposta is null;

alter table public.oportunidades
  drop constraint if exists oportunidades_valor_proposta_valido;
alter table public.oportunidades
  add constraint oportunidades_valor_proposta_valido
  check (valor_proposta is null or valor_proposta >= 0);

-- Older clients do not send valor_proposta. Defaulting it here keeps
-- them compatible while guaranteeing every refused deal has a usable value.
create or replace function public.set_oportunidade_defaults()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and not new.probabilidade_manual then
    new.probabilidade := public.probabilidade_padrao(new.estado);
  elsif tg_op = 'UPDATE' and new.estado is distinct from old.estado and not new.probabilidade_manual then
    new.probabilidade := public.probabilidade_padrao(new.estado);
  end if;
  if new.estado = 'cliente' and new.data_fecho is null then new.data_fecho := current_date; end if;
  if new.estado = 'perdido' and new.valor_proposta is null then new.valor_proposta := 0; end if;
  return new;
end $$;

update public.oportunidades
set valor_proposta = 0
where estado = 'perdido' and valor_proposta is null;

alter table public.oportunidades
  drop constraint if exists recusado_exige_valor_proposta;
alter table public.oportunidades
  add constraint recusado_exige_valor_proposta
  check (estado <> 'perdido' or valor_proposta is not null);

create table public.follow_up_dismissals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.contactos(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, contact_id)
);

alter table public.follow_up_dismissals enable row level security;
alter table public.follow_up_dismissals force row level security;

create policy follow_up_dismissals_read
on public.follow_up_dismissals for select to authenticated
using (user_id = auth.uid() and public.is_active_member());

create policy follow_up_dismissals_insert
on public.follow_up_dismissals for insert to authenticated
with check (user_id = auth.uid() and public.is_active_member());

create policy follow_up_dismissals_delete
on public.follow_up_dismissals for delete to authenticated
using (user_id = auth.uid() and public.is_active_member());

revoke all on public.follow_up_dismissals from public, anon;
grant select, insert, delete on public.follow_up_dismissals to authenticated;

create index follow_up_dismissals_contact_idx
on public.follow_up_dismissals(contact_id);

create or replace view public.follow_up_suggestions
with (security_invoker = true) as
select
  c.id as contact_id,
  c.empresa_id,
  opportunity.id as opportunity_id,
  opportunity.owner_id,
  activity.user_id,
  e.nome as empresa,
  c.nome as contacto_nome,
  c.email::text as contacto_email,
  coalesce(c.cargo, '') as contacto_cargo,
  coalesce(opportunity.estado, c.estado) as estado,
  max(activity.data) as ultima_interacao_em,
  count(*)::bigint as total_interacoes,
  count(*) filter (
    where activity.tipo in ('email_enviado', 'email_recebido')
  )::bigint as total_mensagens,
  count(*) filter (where activity.tipo = 'email_enviado')::bigint as emails_enviados,
  count(*) filter (where activity.tipo = 'email_recebido')::bigint as emails_recebidos,
  count(*) filter (where activity.tipo = 'reuniao')::bigint as reunioes,
  (array_agg(
    coalesce(nullif(activity.assunto, ''), activity.descricao)
    order by activity.data desc
  ))[1] as ultimo_assunto,
  (array_agg(
    coalesce(nullif(activity.snippet, ''), activity.descricao)
    order by activity.data desc
  ))[1] as ultimo_resumo
from public.atividades activity
join public.contactos c on c.id = activity.contacto_id
join public.empresas e on e.id = c.empresa_id
left join lateral (
  select o.id, o.owner_id, o.estado
  from public.oportunidades o
  where o.empresa_id = c.empresa_id and not o.arquivado
  order by o.updated_at desc, o.created_at desc
  limit 1
) opportunity on true
where not e.arquivado
  and not c.optout
  and activity.tipo in (
    'email_enviado', 'email_recebido', 'chamada', 'reuniao', 'visita', 'proposta_enviada'
  )
  and not exists (
    select 1
    from public.follow_up_dismissals dismissal
    where dismissal.user_id = activity.user_id
      and dismissal.contact_id = c.id
  )
group by
  c.id,
  c.empresa_id,
  opportunity.id,
  opportunity.owner_id,
  opportunity.estado,
  activity.user_id,
  e.nome;

grant select on public.follow_up_suggestions to authenticated;

notify pgrst, 'reload schema';

commit;
