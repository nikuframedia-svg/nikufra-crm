begin;

-- Preserve the full precision of calculated metrics in the data layer.
-- Presentation precision is applied centrally by the frontend formatters.
create or replace view public.metricas_taxa_reuniao_coorte
with (security_invoker = true) as
with hits as (
  select oportunidade_id,
    bool_or(estado_novo = 'contactado') as contactado,
    bool_or(estado_novo = 'reuniao_feita') as reuniao_feita
  from public.estado_historico group by oportunidade_id
)
select date_trunc('month', o.data_primeiro_contacto)::date as coorte,
  count(*) filter (where h.contactado) as n_contactadas,
  count(*) filter (where h.reuniao_feita) as n_reunioes,
  100.0 * count(*) filter (where h.reuniao_feita) / nullif(count(*) filter (where h.contactado), 0) as taxa_reuniao,
  (count(*) filter (where h.contactado) < 5) as amostra_insuficiente
from public.oportunidades o join hits h on h.oportunidade_id = o.id
where o.data_primeiro_contacto is not null
group by 1 order by 1;

create or replace view public.metricas_no_show
with (security_invoker = true) as
with hits as (
  select oportunidade_id,
    bool_or(estado_novo = 'reuniao_marcada') as marcada,
    bool_or(estado_novo = 'reuniao_feita') as feita
  from public.estado_historico group by oportunidade_id
)
select count(*) filter (where marcada) as n_marcadas,
  count(*) filter (where feita) as n_feitas,
  100.0 * (1 - count(*) filter (where feita)::numeric / nullif(count(*) filter (where marcada), 0)) as taxa_no_show,
  (count(*) filter (where marcada) < 5) as amostra_insuficiente
from hits;

create or replace view public.metricas_tempo_estado
with (security_invoker = true) as
with entradas as (
  select oportunidade_id, estado_novo as estado, changed_at as entrada,
    lead(changed_at) over (partition by oportunidade_id order by changed_at) as saida
  from public.estado_historico
), duracoes as (
  select estado, extract(epoch from (coalesce(saida, now()) - entrada)) / 86400.0 as dias, saida is null as ainda_ativo
  from entradas
)
select estado, count(*) as n,
  avg(dias)::numeric as media_dias,
  percentile_cont(0.5) within group (order by dias)::numeric as mediana_dias,
  count(*) filter (where ainda_ativo) as n_ainda_ativos,
  (count(*) < 5) as amostra_insuficiente
from duracoes group by estado;

create or replace view public.metricas_ciclo_venda
with (security_invoker = true) as
with marcos as (
  select oportunidade_id,
    min(changed_at) filter (where estado_novo = 'contactado') as contacto,
    min(changed_at) filter (where estado_novo = 'cliente') as cliente
  from public.estado_historico group by oportunidade_id
), ciclos as (
  select extract(epoch from (cliente - contacto)) / 86400.0 as dias
  from marcos where contacto is not null and cliente is not null
)
select count(*) as n,
  avg(dias)::numeric as media_dias,
  percentile_cont(0.5) within group (order by dias)::numeric as mediana_dias,
  (count(*) < 5) as amostra_insuficiente
from ciclos;

create or replace view public.metricas_resultados
with (security_invoker = true) as
select count(*) filter (where estado = 'cliente') as n_clientes,
  count(*) filter (where estado = 'perdido') as n_perdidas,
  count(*) filter (where estado in ('cliente', 'perdido')) as n_finalizadas,
  100.0 * count(*) filter (where estado = 'cliente') / nullif(count(*) filter (where estado in ('cliente', 'perdido')), 0) as taxa_ganho,
  avg(valor_estimado) filter (where estado = 'cliente') as valor_medio_ganho
from public.oportunidades where not arquivado;

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
  case when n_anterior is null then 100.0 else 100.0 * n / nullif(n_anterior, 0) end as taxa_passo,
  (n < 5) as amostra_insuficiente
from passos order by ordem;

grant select on public.metricas_taxa_reuniao_coorte, public.metricas_no_show,
  public.metricas_tempo_estado, public.metricas_ciclo_venda,
  public.metricas_resultados, public.metricas_funil to authenticated;

notify pgrst, 'reload schema';

commit;
