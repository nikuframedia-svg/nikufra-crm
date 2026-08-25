begin;

-- A sequência comercial da Nikufra coloca o piloto antes da proposta.
update public.pipeline_settings
set ordem = case estado
  when 'nao_contactado' then 1
  when 'contactado' then 2
  when 'reuniao_marcada' then 3
  when 'reuniao_feita' then 4
  when 'piloto' then 5
  when 'proposta' then 6
  when 'cliente' then 7
  when 'perdido' then 8
  when 'adiado' then 9
end,
probabilidade_padrao = case estado
  when 'nao_contactado' then 0
  when 'contactado' then 5
  when 'reuniao_marcada' then 15
  when 'reuniao_feita' then 30
  when 'piloto' then 50
  when 'proposta' then 75
  when 'cliente' then 100
  when 'perdido' then 0
  when 'adiado' then 10
end;

create or replace function public.probabilidade_padrao(estado public.oportunidade_estado)
returns integer language sql immutable strict as $$
  select case estado
    when 'nao_contactado' then 0 when 'contactado' then 5 when 'reuniao_marcada' then 15
    when 'reuniao_feita' then 30 when 'piloto' then 50 when 'proposta' then 75
    when 'cliente' then 100 when 'perdido' then 0 when 'adiado' then 10
  end
$$;

alter table public.google_tokens
  add column if not exists people_sync_token text,
  add column if not exists other_contacts_sync_token text,
  add column if not exists calendar_sync_token text,
  add column if not exists people_contacts_synced bigint not null default 0,
  add column if not exists calendar_events_synced bigint not null default 0,
  add column if not exists calendar_last_sync_at timestamptz;

alter table public.contactos
  add column if not exists google_resource_name text;
create unique index if not exists contactos_google_resource_unique
  on public.contactos(google_resource_name) where google_resource_name is not null;

alter table public.atividades
  add column if not exists calendar_event_id text;
drop index if exists public.atividades_message_contacto_unique;
create unique index atividades_message_contacto_unique
  on public.atividades(message_id, contacto_id);
create unique index if not exists atividades_calendar_contacto_unique
  on public.atividades(calendar_event_id, contacto_id);

create or replace view public.metricas_funil
with (security_invoker = true) as
with etapas(estado, ordem) as (values
  ('nao_contactado'::public.oportunidade_estado, 1), ('contactado', 2), ('reuniao_marcada', 3),
  ('reuniao_feita', 4), ('piloto', 5), ('proposta', 6), ('cliente', 7)
), contagens as (
  select e.estado, e.ordem, count(distinct h.oportunidade_id) as n
  from etapas e left join public.estado_historico h on h.estado_novo = e.estado
  group by e.estado, e.ordem
), passos as (
  select *, lag(n) over (order by ordem) as n_anterior from contagens
)
select estado, ordem, n,
  case when n_anterior is null then 100.0 else round(100.0 * n / nullif(n_anterior, 0), 1) end as taxa_passo,
  (n < 5) as amostra_insuficiente
from passos order by ordem;

commit;
