begin;

-- A company, its contacts and its pipeline opportunity form one commercial
-- record in the product. Deleting that record must therefore be atomic: a
-- partial delete would leave the Kanban and the contacts table inconsistent.
create or replace function public.delete_commercial_records(
  p_contact_ids uuid[],
  p_company_ids uuid[],
  p_opportunity_ids uuid[],
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  company_ids uuid[];
  deleted_contacts integer := 0;
  deleted_companies integer := 0;
  deleted_opportunities integer := 0;
  deleted_activities integer := 0;
  deleted_revenue integer := 0;
begin
  if not exists (
    select 1
    from public.profiles
    where id = p_actor_id and ativo and role = 'admin'
  ) then
    raise exception 'Apenas administradores podem eliminar registos comerciais';
  end if;

  select coalesce(array_agg(distinct resolved.empresa_id), '{}'::uuid[])
  into company_ids
  from (
    select e.id as empresa_id
    from public.empresas e
    where e.id = any(coalesce(p_company_ids, '{}'::uuid[]))
    union
    select c.empresa_id
    from public.contactos c
    where c.id = any(coalesce(p_contact_ids, '{}'::uuid[]))
    union
    select o.empresa_id
    from public.oportunidades o
    where o.id = any(coalesce(p_opportunity_ids, '{}'::uuid[]))
  ) resolved;

  if cardinality(company_ids) = 0 then
    return jsonb_build_object(
      'deleted', 0,
      'deleted_contacts', 0,
      'deleted_companies', 0,
      'deleted_opportunities', 0,
      'deleted_activities', 0,
      'deleted_revenue', 0,
      'deleted_company_ids', '[]'::jsonb
    );
  end if;

  -- Prevent a subsequent Google sync from silently recreating a record the
  -- administrator deliberately removed.
  insert into public.contact_import_suppressions(email, google_resource_name, deleted_by)
  select c.email, c.google_resource_name, p_actor_id
  from public.contactos c
  where c.empresa_id = any(company_ids)
    and (c.email is not null or c.google_resource_name is not null)
  on conflict do nothing;

  insert into public.audit_log(actor_id, tabela, registo_id, acao, alteracoes)
  select p_actor_id, 'contactos', c.id, 'RGPD_DELETE',
    jsonb_build_object('registo_comercial_removido', true, 'empresa_id', c.empresa_id)
  from public.contactos c
  where c.empresa_id = any(company_ids);

  insert into public.audit_log(actor_id, tabela, registo_id, acao, alteracoes)
  select p_actor_id, 'oportunidades', o.id, 'RGPD_DELETE',
    jsonb_build_object('registo_comercial_removido', true, 'empresa_id', o.empresa_id)
  from public.oportunidades o
  where o.empresa_id = any(company_ids);

  insert into public.audit_log(actor_id, tabela, registo_id, acao, alteracoes)
  select p_actor_id, 'empresas', e.id, 'RGPD_DELETE',
    jsonb_build_object('registo_comercial_removido', true)
  from public.empresas e
  where e.id = any(company_ids);

  delete from public.atividades
  where empresa_id = any(company_ids);
  get diagnostics deleted_activities = row_count;

  delete from public.faturacao
  where empresa_id = any(company_ids);
  get diagnostics deleted_revenue = row_count;

  delete from public.estado_historico h
  using public.oportunidades o
  where h.oportunidade_id = o.id
    and o.empresa_id = any(company_ids);

  delete from public.oportunidades
  where empresa_id = any(company_ids);
  get diagnostics deleted_opportunities = row_count;

  delete from public.contactos
  where empresa_id = any(company_ids);
  get diagnostics deleted_contacts = row_count;

  delete from public.empresas
  where id = any(company_ids);
  get diagnostics deleted_companies = row_count;

  return jsonb_build_object(
    'deleted', deleted_contacts,
    'deleted_contacts', deleted_contacts,
    'deleted_companies', deleted_companies,
    'deleted_opportunities', deleted_opportunities,
    'deleted_activities', deleted_activities,
    'deleted_revenue', deleted_revenue,
    'deleted_company_ids', to_jsonb(company_ids)
  );
end;
$$;

revoke all on function public.delete_commercial_records(uuid[], uuid[], uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.delete_commercial_records(uuid[], uuid[], uuid[], uuid)
  to service_role;

-- Pre-aggregate every user's real communication history. This avoids ranking
-- follow-ups from the 500 newest activities loaded for the dashboard and keeps
-- results correct as Gmail history grows.
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
