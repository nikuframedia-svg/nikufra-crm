begin;

-- Keep the deletion test self-contained on a pristine database. The normal
-- onboarding trigger promotes the first @nikufra.ai profile to administrator;
-- the whole fixture is rolled back at the end of this file.
insert into auth.users(id, email, raw_user_meta_data, created_at, updated_at)
values (
  'ee000000-0000-4000-8000-000000000001',
  'commercial-records-test@nikufra.ai',
  '{"nome":"Commercial records test"}'::jsonb,
  now(), now()
)
on conflict (id) do nothing;

do $$
declare
  actor_id uuid;
  company_id uuid := 'ef000000-0000-4000-8000-000000000001';
  contact_id uuid := 'ef000000-0000-4000-8000-000000000002';
  opportunity_id uuid := 'ef000000-0000-4000-8000-000000000003';
  result jsonb;
begin
  select id into actor_id
  from public.profiles
  where role = 'admin' and ativo
  limit 1;

  if actor_id is null then
    raise exception 'O teste requer um perfil administrador ativo';
  end if;

  insert into public.empresas(id, nome, origem)
  values (company_id, 'Empresa de teste de eliminação', 'inbound');
  insert into public.contactos(id, empresa_id, nome, email, principal)
  values (contact_id, company_id, 'Contacto de teste', 'delete-test@nikufra.ai', true);
  insert into public.oportunidades(id, empresa_id, contacto_principal_id, owner_id, titulo, tipo)
  values (opportunity_id, company_id, contact_id, actor_id, 'Oportunidade de teste', 'consultoria');
  insert into public.atividades(oportunidade_id, empresa_id, contacto_id, user_id, tipo, descricao)
  values (opportunity_id, company_id, contact_id, actor_id, 'email_enviado', 'Email de teste');
  insert into public.faturacao(empresa_id, oportunidade_id, tipo, valor, data, descricao)
  values (company_id, opportunity_id, 'contratualizado', 100, current_date, 'Faturação de teste');

  result := public.delete_commercial_records(array[contact_id], '{}'::uuid[], '{}'::uuid[], actor_id);

  if result ->> 'deleted_companies' <> '1'
    or result ->> 'deleted_contacts' <> '1'
    or result ->> 'deleted_opportunities' <> '1'
    or result ->> 'deleted_activities' <> '1'
    or result ->> 'deleted_revenue' <> '1' then
    raise exception 'Contagens de eliminação inesperadas: %', result;
  end if;
  if exists (select 1 from public.empresas where id = company_id)
    or exists (select 1 from public.contactos where id = contact_id)
    or exists (select 1 from public.oportunidades where id = opportunity_id)
    or exists (select 1 from public.atividades where empresa_id = company_id)
    or exists (select 1 from public.faturacao where empresa_id = company_id) then
    raise exception 'A eliminação deixou dados comerciais órfãos';
  end if;
  if not public.is_contact_import_suppressed('delete-test@nikufra.ai', null) then
    raise exception 'O contacto eliminado não ficou protegido contra reimportação';
  end if;
  if exists (
    select 1 from public.contact_import_suppressions
    where email is not null or google_resource_name is not null
  ) then
    raise exception 'O tombstone de importação conservou PII em claro';
  end if;
end;
$$;

rollback;
