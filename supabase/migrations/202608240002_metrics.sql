begin;

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
  round(100.0 * count(*) filter (where h.reuniao_feita) / nullif(count(*) filter (where h.contactado), 0), 1) as taxa_reuniao,
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
  round(100.0 * (1 - count(*) filter (where feita)::numeric / nullif(count(*) filter (where marcada), 0)), 1) as taxa_no_show,
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
  round(avg(dias)::numeric, 1) as media_dias,
  round(percentile_cont(0.5) within group (order by dias)::numeric, 1) as mediana_dias,
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
  select extract(epoch from (cliente - contacto)) / 86400.0 as dias from marcos where contacto is not null and cliente is not null
)
select count(*) as n, round(avg(dias)::numeric, 1) as media_dias,
  round(percentile_cont(0.5) within group (order by dias)::numeric, 1) as mediana_dias,
  (count(*) < 5) as amostra_insuficiente
from ciclos;

create or replace view public.metricas_pipeline
with (security_invoker = true) as
select count(*) as n_ativas, sum(valor_estimado) as pipeline_total,
  sum(valor_estimado * probabilidade / 100.0) as pipeline_ponderado,
  avg(valor_estimado) as valor_medio
from public.oportunidades
where estado in ('nao_contactado','contactado','reuniao_marcada','reuniao_feita','proposta','piloto') and not arquivado;

create or replace view public.metricas_distribuicao_vertical
with (security_invoker = true) as
select e.vertical, count(o.id) as n, sum(o.valor_estimado) as valor_total,
  sum(o.valor_estimado * o.probabilidade / 100.0) as valor_ponderado
from public.empresas e join public.oportunidades o on o.empresa_id = e.id
where not e.arquivado and not o.arquivado group by e.vertical order by valor_total desc;

create or replace view public.metricas_cliente
with (security_invoker = true) as
select e.id as empresa_id, e.nome,
  coalesce(sum(f.valor) filter (where f.tipo = 'faturado'), 0) as faturacao_acumulada,
  extract(year from age(current_date, min(o.data_fecho))) * 12 + extract(month from age(current_date, min(o.data_fecho))) as meses_ativo,
  coalesce(sum(distinct o.valor_recorrente_anual), 0) as valor_recorrente_anual,
  count(distinct o.id) as numero_projetos
from public.empresas e join public.oportunidades o on o.empresa_id = e.id and o.estado = 'cliente'
left join public.faturacao f on f.empresa_id = e.id
group by e.id, e.nome;

grant select on public.metricas_taxa_reuniao_coorte, public.metricas_no_show, public.metricas_tempo_estado,
  public.metricas_ciclo_venda, public.metricas_pipeline, public.metricas_distribuicao_vertical, public.metricas_cliente to authenticated;

commit;
