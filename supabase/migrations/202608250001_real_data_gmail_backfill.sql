begin;

-- Remove apenas o seed fictício conhecido. IDs exatos evitam tocar em dados reais.
delete from public.faturacao where empresa_id::text like '10000000-0000-0000-0000-%';
delete from public.atividades where empresa_id::text like '10000000-0000-0000-0000-%';
delete from public.estado_historico where oportunidade_id::text like '30000000-0000-0000-0000-%';
delete from public.oportunidades where id::text like '30000000-0000-0000-0000-%';
delete from public.contactos where id::text like '20000000-0000-0000-0000-%';
delete from public.empresas where id::text like '10000000-0000-0000-0000-%';
delete from public.objetivos where ano = 2026 and user_id is null and (
  (tipo = 'faturacao' and mes is null and valor_alvo = 480000) or
  (tipo = 'faturacao' and mes = 8 and valor_alvo = 40000) or
  (tipo = 'reunioes' and mes = 8 and valor_alvo = 10) or
  (tipo = 'propostas' and mes = 8 and valor_alvo = 5)
);
delete from auth.users where id in ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');

alter table public.empresas
  add column if not exists nome_normalizado text,
  add column if not exists email_domain text;
create index if not exists empresas_nome_normalizado_idx on public.empresas(nome_normalizado);
create index if not exists empresas_email_domain_idx on public.empresas(email_domain) where email_domain is not null;

alter table public.contactos
  add column if not exists estado public.oportunidade_estado not null default 'nao_contactado',
  add column if not exists data_reuniao date;

alter table public.oportunidades
  add column if not exists data_reuniao date,
  add column if not exists data_proposta date,
  add column if not exists data_piloto date,
  add column if not exists avaliacao smallint check (avaliacao is null or avaliacao between 1 and 5),
  add column if not exists import_key text;
create unique index if not exists oportunidades_import_key_unique on public.oportunidades(import_key);

alter table public.faturacao
  add column if not exists valor_bruto numeric(14,2) check (valor_bruto is null or valor_bruto >= 0),
  add column if not exists valor_iva numeric(14,2) check (valor_iva is null or valor_iva >= 0),
  add column if not exists taxa_iva numeric(6,3) check (taxa_iva is null or taxa_iva between 0 and 100);

alter table public.google_tokens
  add column if not exists backfill_page_token text,
  add column if not exists backfill_complete boolean not null default false,
  add column if not exists backfill_started_at timestamptz,
  add column if not exists last_sync_at timestamptz,
  add column if not exists messages_synced bigint not null default 0,
  add column if not exists contacts_created bigint not null default 0,
  add column if not exists sync_error text;

alter table public.atividades
  add column if not exists direcao text check (direcao is null or direcao in ('enviado', 'recebido')),
  add column if not exists reuniao_inferida boolean not null default false;
drop index if exists public.atividades_message_id_unique;
create unique index if not exists atividades_message_contacto_unique on public.atividades(message_id, contacto_id) where message_id is not null and contacto_id is not null;

-- Métricas de email agregadas sem expor corpos de mensagens.
create or replace view public.metricas_email as
select
  user_id,
  count(*) filter (where tipo = 'email_enviado') as enviados,
  count(*) filter (where tipo = 'email_recebido') as recebidos,
  count(distinct contacto_id) as contactos_unicos,
  count(distinct contacto_id) filter (where tipo = 'email_recebido') as contactos_com_resposta,
  count(*) filter (where reuniao_inferida) as sinais_reuniao,
  min(data) as primeiro_email,
  max(data) as ultimo_email
from public.atividades
where message_id is not null
group by user_id;
grant select on public.metricas_email to authenticated;

commit;
