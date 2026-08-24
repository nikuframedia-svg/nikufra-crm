begin;
create extension if not exists pgtap;
select plan(13);

select policies_are('public', 'empresas', array['empresas_read','empresas_insert','empresas_update']);
select policies_are('public', 'contactos', array['contactos_read','contactos_insert','contactos_update']);
select policies_are('public', 'oportunidades', array['oportunidades_read','oportunidades_insert','oportunidades_update']);
select policies_are('public', 'atividades', array['atividades_read','atividades_insert','atividades_update']);
select policies_are('public', 'faturacao', array['faturacao_read','faturacao_admin_write']);
select policies_are('public', 'objetivos', array['objetivos_read','objetivos_admin_write']);
select policies_are('public', 'estado_historico', array['estado_historico_read']);

set local role anon;
select is_empty('select * from public.empresas', 'anon não lê empresas');
select throws_ok($$insert into public.empresas(nome, origem) values ('Intruso', 'inbound')$$, '42501', null, 'anon não escreve empresas');

reset role;
select has_trigger('public', 'oportunidades', 'oportunidade_estado_historico', 'histórico é escrito por trigger');
select has_trigger('public', 'oportunidades', 'oportunidade_defaults', 'probabilidade é definida por trigger');
select col_is_pk('public', 'estado_historico', 'id', 'histórico tem chave primária');
select isnt_empty($$select 1 from pg_class where relrowsecurity and relnamespace = 'public'::regnamespace$$, 'RLS está ativo');

select * from finish();
rollback;
