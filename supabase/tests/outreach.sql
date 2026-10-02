begin;
create extension if not exists pgtap;
select plan(183);

-- Self-contained principals. The first @nikufra.ai account becomes the local
-- test admin; invitations exercise the same onboarding path as production.
insert into public.user_invitations(email, nome, invited_by)
select 'outreach-admin@nikufra.ai', 'Outreach Admin', p.id
from public.profiles p
where p.role = 'admin' and p.ativo
  and not exists (
    select 1 from auth.users u where u.id = 'a0000000-0000-4000-8000-000000000001'
  )
order by p.created_at
limit 1
on conflict (email) do update set used_at = null;

insert into auth.users(id, email, raw_user_meta_data, created_at, updated_at)
values (
  'a0000000-0000-4000-8000-000000000001',
  'outreach-admin@nikufra.ai',
  '{"nome":"Outreach Admin"}'::jsonb,
  now(), now()
) on conflict (id) do nothing;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from public.profiles where role = 'admin' and ativo order by created_at limit 1),
  true
);
update public.profiles
set role = 'admin', ativo = true
where id = 'a0000000-0000-4000-8000-000000000001';

insert into public.user_invitations(email, nome, invited_by)
values
  ('outreach-viewer@example.test', 'Viewer', 'a0000000-0000-4000-8000-000000000001'),
  ('outreach-sales@example.test', 'Sales', 'a0000000-0000-4000-8000-000000000001'),
  ('outreach-manager@example.test', 'Manager', 'a0000000-0000-4000-8000-000000000001')
on conflict (email) do update set used_at = null;

insert into auth.users(id, email, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000002', 'outreach-viewer@example.test', '{"nome":"Viewer"}', now(), now()),
  ('a0000000-0000-4000-8000-000000000003', 'outreach-sales@example.test', '{"nome":"Sales"}', now(), now()),
  ('a0000000-0000-4000-8000-000000000004', 'outreach-manager@example.test', '{"nome":"Manager"}', now(), now())
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
update public.profiles set outreach_role = 'viewer'
where id = 'a0000000-0000-4000-8000-000000000002';
update public.profiles set outreach_role = 'sales_rep'
where id = 'a0000000-0000-4000-8000-000000000003';
update public.profiles set outreach_role = 'campaign_manager'
where id = 'a0000000-0000-4000-8000-000000000004';

select throws_ok(
  $$select private.outreach_update_profile_role('a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000002','sales_rep')$$,
  'P0001', null, 'não-admin não promove roles Outreach'
);
select is(
  (private.outreach_update_profile_role(
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002',
    'sales_rep'
  )).outreach_role::text,
  'sales_rep',
  'admin altera role por função estreita'
);
do $$ begin
  perform private.outreach_update_profile_role(
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002',
    'viewer'
  );
end $$;
select ok(exists(
  select 1 from public.outreach_audit_log where action = 'profile_role_updated'
), 'alteração de role fica auditada');

select has_table('public', 'outreach_campaigns', 'campanhas normalizadas existem');
select has_table('public', 'outreach_recipients', 'destinatários normalizados existem');
select has_table('public', 'outreach_jobs', 'jobs normalizados existem');
select has_table('public', 'communication_suppressions', 'supressão canónica existe');
select has_table('private', 'outreach_credentials', 'credenciais vivem no schema privado');
select has_table('private', 'outreach_delivery_ledger', 'ledger vive no schema privado');
select has_table('private', 'communication_provider_message_ledger', 'dedupe partilhado vive no schema privado');
select has_table('private', 'outreach_inbound_reconciliation', 'inbound ambíguo fica cifrado no schema privado');
select has_table('private', 'outreach_job_adjudications', 'prova de adjudicação fica no schema privado');
select has_table('public', 'outreach_campaign_mailboxes', 'campanha tem seleção explícita de mailboxes');
select has_trigger(
  'public', 'atividades', 'set_atividade_source_mailbox_email',
  'atividades Gmail legadas recebem mailbox determinística'
);
select ok(exists(
  select 1 from pg_constraint constraint_row
  where constraint_row.conrelid='public.outreach_campaign_mailboxes'::regclass
    and constraint_row.contype='p'
    and pg_get_constraintdef(constraint_row.oid)='PRIMARY KEY (campaign_id, mailbox_id)'
), 'associação campanha-mailbox não admite duplicados');
select ok(exists(
  select 1
  from pg_trigger trigger_row
  join pg_proc function_row on function_row.oid=trigger_row.tgfoid
  join pg_namespace function_schema on function_schema.oid=function_row.pronamespace
  where trigger_row.tgrelid='public.outreach_campaign_mailboxes'::regclass
    and trigger_row.tgname='a_outreach_send_gate_campaign_mailbox_writer'
    and not trigger_row.tgisinternal
    and trigger_row.tgtype=30
    and function_schema.nspname='private'
    and function_row.proname='outreach_lock_send_gate_writer'
), 'seleção campanha-mailbox adquire writer permit antes de qualquer escrita');
select col_type_is('public', 'profiles', 'outreach_role', 'outreach_role', 'perfil tem role granular');
select col_default_is('public', 'profiles', 'outreach_role', 'viewer'::public.outreach_role, 'novos perfis começam como viewer');
select is(
  (select mode::text from public.outreach_system_state where id),
  'disabled',
  'outbound começa desativado'
);
select is(
  (select send_enabled from public.outreach_system_state where id),
  false,
  'kill switch começa desligado'
);
select ok(
  lower(pg_get_functiondef('private.enforce_outreach_mailbox_live_activation()'::regprocedure))
    like '%from public.outreach_system_state%for update%',
  'ativação de mailbox serializa no mesmo state lock da promoção live'
);
select throws_ok(
  $$select private.outreach_update_settings('a0000000-0000-4000-8000-000000000003', '{"timezone":"UTC"}'::jsonb)$$,
  'P0001', null, 'não-admin não altera definições'
);
select throws_ok(
  $$select private.outreach_update_settings('a0000000-0000-4000-8000-000000000001', '{"trackOpens":true}'::jsonb)$$,
  'P0001', null, 'tracking inseguro não entra nas definições'
);
select is(
  (private.outreach_update_settings(
    'a0000000-0000-4000-8000-000000000001',
    '{"timezone":"UTC","defaultDailyLimit":12}'::jsonb
  )).settings ->> 'timezone',
  'UTC',
  'admin altera apenas definições validadas'
);
select ok(exists(
  select 1 from public.outreach_audit_log where action = 'settings_updated'
), 'alteração de definições fica auditada');

select is(has_schema_privilege('authenticated', 'private', 'usage'), false, 'browser não usa schema privado');
select is(has_table_privilege('authenticated', 'private.outreach_credentials', 'select'), false, 'browser não lê credenciais');
select is(has_table_privilege('authenticated', 'private.outreach_delivery_ledger', 'select'), false, 'browser não lê ledger');
select is(has_table_privilege('authenticated', 'private.communication_provider_message_ledger', 'select'), false, 'browser não lê dedupe partilhado');
select is(has_table_privilege('authenticated', 'private.outreach_inbound_reconciliation', 'select'), false, 'browser não lê payloads inbound cifrados');
select is(has_table_privilege('authenticated', 'private.outreach_delivery_incidents', 'select'), false, 'browser não lê ledger de incidentes');
select ok(not exists(
  select 1
  from information_schema.role_table_grants grant_row
  where grant_row.grantee in ('anon', 'authenticated')
    and grant_row.table_schema = 'public'
    and (
      grant_row.table_name like 'outreach\_%' escape '\'
      or grant_row.table_name = 'communication_suppressions'
    )
    and grant_row.privilege_type = 'SELECT'
), 'dark deploy não expõe nenhuma tabela Outreach diretamente ao browser');
select is(has_table_privilege('authenticated', 'public.outreach_campaigns', 'insert'), false, 'browser não escreve campanhas diretamente');
select is(has_table_privilege('authenticated', 'public.communication_suppressions', 'update'), false, 'browser não altera suppressions diretamente');
select is(has_table_privilege('authenticated', 'public.outreach_campaign_mailboxes', 'select'), false, 'browser não lê associações campanha-mailbox diretamente');
select ok(
  not has_function_privilege('authenticated','public.claim_google_provider_message(text,text)','execute')
  and not has_function_privilege('anon','public.claim_google_provider_message(text,text)','execute'),
  'browser não reclama mensagens através do RPC Gmail'
);
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  not has_function_privilege('outreach_service','public.claim_google_provider_message(text,text)','execute')
else true end, 'API Outreach não pode fingir ser o sincronizador Gmail');
select ok(
  has_function_privilege('service_role','public.claim_google_provider_message(text,text)','execute'),
  'apenas service_role recebe o RPC Gmail estreito'
);
select ok(
  not has_function_privilege('authenticated','public.is_contact_import_suppressed(text,text)','execute')
  and not has_function_privilege('anon','public.is_contact_import_suppressed(text,text)','execute'),
  'browser não consulta tombstones de importação'
);
select ok(
  has_function_privilege('service_role','public.is_contact_import_suppressed(text,text)','execute'),
  'gmail-sync recebe apenas o RPC booleano de tombstones'
);
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  not has_function_privilege('outreach_service','public.is_contact_import_suppressed(text,text)','execute')
else true end, 'API Outreach não enumera tombstones de importação');

insert into public.contact_import_suppressions(
  email, google_resource_name, deleted_by
) values (
  'Deleted.Person@Example.test', 'people/deleted-person',
  'a0000000-0000-4000-8000-000000000001'
);
select ok(exists(
  select 1 from public.contact_import_suppressions
  where email is null and google_resource_name is null
    and email_hmac is not null and google_resource_hmac is not null
), 'tombstone de importação guarda apenas HMAC, nunca PII clara');
select ok(
  public.is_contact_import_suppressed(
    ' deleted.person@example.test ', 'people/deleted-person'
  )
  and not public.is_contact_import_suppressed(
    'other.person@example.test', 'people/other-person'
  ),
  'RPC Gmail deteta email/recurso normalizados sem revelar o HMAC'
);
insert into public.communication_suppressions(scope, email, reason, source)
values ('email', 'rotation@example.test', 'manual', 'key-rotation-test');
update public.communication_suppressions
set email = null
where source = 'key-rotation-test';
insert into private.outreach_hmac_keys(key_version, key_material, active)
values (2, gen_random_bytes(32), true);
select ok(
  public.is_contact_import_suppressed(
    'deleted.person@example.test', 'people/deleted-person'
  )
  and private.outreach_is_suppressed('rotation@example.test', null),
  'rotação da chave ativa não invalida tombstones nem suppressions antigas'
);
select throws_ok(
  $$delete from private.outreach_hmac_keys where key_version = 1$$,
  'P0001', null, 'versão HMAC histórica não pode ser eliminada silenciosamente'
);

-- The dedicated API role is provisioned by deploy scripts. When present it is
-- deliberately useful for Outreach without inheriting or bypassing CRM rules.
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then (
  select rolcanlogin and not rolinherit and not rolsuper and not rolbypassrls
  from pg_roles where rolname = 'outreach_service'
) else true end, 'service role é LOGIN, NOINHERIT e sem bypass privilegiado');
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  has_table_privilege('outreach_service','public.profiles','select')
  and has_table_privilege('outreach_service','public.contactos','select')
else true end, 'service role lê apenas as fontes CRM necessárias');
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  has_function_privilege('outreach_service','private.outreach_lock_active_admin(uuid)','execute')
  and not has_table_privilege('outreach_service','public.profiles','update')
else true end, 'callback OAuth bloqueia o administrador sem permissão ampla de escrita no perfil');
select ok(
  private.outreach_lock_active_admin('a0000000-0000-4000-8000-000000000001'),
  'callback OAuth reconhece o administrador ativo'
);
select ok(
  not private.outreach_lock_active_admin('a0000000-0000-4000-8000-000000000002'),
  'callback OAuth rejeita um perfil não administrador'
);
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  not has_table_privilege('outreach_service','public.contactos','insert')
  and not has_table_privilege('outreach_service','public.contactos','update')
  and not has_table_privilege('outreach_service','public.oportunidades','update')
  and not has_table_privilege('outreach_service','public.atividades','insert')
else true end, 'service comprometido não escreve livremente no CRM');
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  has_table_privilege('outreach_service','public.outreach_campaigns','insert,update,delete')
else true end, 'service role gere apenas entidades normalizadas Outreach');
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  has_table_privilege('outreach_service','public.outreach_campaign_mailboxes','select,insert,update,delete')
else true end, 'service role gere a seleção explícita de mailboxes da campanha');
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  has_function_privilege(
    'outreach_service',
    'private.outreach_recipient_eligibility(uuid,uuid,timestamptz)',
    'execute'
  )
else true end, 'service role usa a elegibilidade autoritativa com escopo de campanha');
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  not has_function_privilege(
    'outreach_service',
    'private.outreach_recipient_eligibility_without_campaign_scope(uuid,uuid,timestamptz)',
    'execute'
  )
else true end, 'service role não contorna o escopo campanha-mailbox');
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  not has_table_privilege('outreach_service','public.outreach_system_state','update')
else true end, 'service role não contorna transições e definições validadas');
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  has_table_privilege('outreach_service','private.outreach_credentials','select')
else true end, 'service role acede ao cofre privado necessário');
select ok(case when exists(select 1 from pg_roles where rolname = 'outreach_service') then
  has_function_privilege('outreach_service','private.outreach_update_settings(uuid,jsonb)','execute')
  and has_function_privilege('outreach_service','private.outreach_update_profile_role(uuid,uuid,public.outreach_role)','execute')
  and has_function_privilege('outreach_service','private.outreach_transition_system(public.outreach_system_mode,uuid,boolean,text)','execute')
  and has_function_privilege('outreach_service','private.outreach_claim_provider_message(text,text,text)','execute')
  and has_function_privilege('outreach_service','private.outreach_trip_canary(text,uuid)','execute')
  and has_function_privilege('outreach_service','private.outreach_record_delivery_incident(text,uuid,uuid,uuid,text,uuid)','execute')
  and has_function_privilege('outreach_service','private.outreach_adjudicate_job_reconciliation(uuid,uuid,text,text,text,text)','execute')
  and not has_table_privilege('outreach_service','private.outreach_delivery_incidents','select')
  and not has_table_privilege('outreach_service','private.outreach_job_adjudications','select')
  and has_function_privilege('outreach_service','private.outreach_record_worker_heartbeat(text,boolean)','execute')
  and has_function_privilege('outreach_service','private.outreach_advance_mailbox_ramp(uuid,uuid)','execute')
else true end, 'service role usa apenas mutações administrativas estreitas');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', true);
select ok(public.has_outreach_capability('view_campaigns'), 'viewer consulta campanhas');
select is(public.has_outreach_capability('manage_threads'), false, 'viewer não gere respostas');
select throws_ok(
  $$insert into public.outreach_campaigns(nome, created_by) values ('Intrusão', 'a0000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'viewer não contorna API'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000003', true);
select ok(public.has_outreach_capability('manage_threads'), 'sales rep gere respostas');
select is(public.has_outreach_capability('manage_campaigns'), false, 'sales rep não gere campanhas');

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000004', true);
select ok(public.has_outreach_capability('manage_campaigns'), 'manager gere campanhas');
select ok(public.has_outreach_capability('launch_campaigns'), 'manager pode lançar campanhas');
reset role;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select ok(public.has_outreach_capability('manage_suppressions'), 'admin tem controlo total');

insert into public.empresas(id, nome, nome_normalizado, email_domain, origem)
values
  ('b0000000-0000-4000-8000-000000000001', 'Outreach Test One', 'outreach test one', 'one.example', 'outbound_email'),
  ('b0000000-0000-4000-8000-000000000002', 'Outreach Test Two', 'outreach test two', 'two.example', 'outbound_email'),
  ('b0000000-0000-4000-8000-000000000003', 'Outreach Rotation', 'outreach rotation', 'example.test', 'outbound_email');

insert into public.contactos(
  id, empresa_id, nome, email, outreach_legal_basis,
  outreach_legitimate_interest_purpose, outreach_lia_reference,
  outreach_legitimate_interest_expires_at
) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Contacto Um', 'one@one.example', 'legitimate_interest', 'Prospecção B2B industrial', 'LIA-TEST-001', now() + interval '1 year'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'Contacto Dois', 'two@two.example', 'legitimate_interest', 'Prospecção B2B industrial', 'LIA-TEST-002', now() + interval '1 year'),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'Contacto Rotação', 'rotation@example.test', 'legitimate_interest', 'Teste de rotação', 'LIA-TEST-003', now() + interval '1 year');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$update public.contactos set outreach_legal_basis='contract' where id='c0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'viewer não altera a base legal Outreach'
);
select throws_ok(
  $$update public.contactos set outreach_legal_basis_recorded_at=now()-interval '1 day' where id='c0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'viewer não adultera timestamp de accountability'
);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$update public.contactos set outreach_legal_basis='contract' where id='c0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'sales rep não altera a base legal Outreach'
);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000004', true);
select lives_ok(
  $$update public.contactos set outreach_legal_basis='contract', outreach_legal_basis_evidence='CONTRACT-TEST-001', outreach_legitimate_interest_purpose=null, outreach_lia_reference=null, outreach_legitimate_interest_expires_at=null where id='c0000000-0000-4000-8000-000000000001'$$,
  'campaign manager altera a base legal Outreach'
);
select throws_ok(
  $$update public.contactos set outreach_legal_basis_recorded_by='a0000000-0000-4000-8000-000000000004' where id='c0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'campaign manager não adultera responsável de accountability'
);
reset role;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select ok(exists(
  select 1 from public.outreach_audit_log
  where action = 'contact.compliance_updated'
    and actor_id = 'a0000000-0000-4000-8000-000000000004'
    and entity_id = 'c0000000-0000-4000-8000-000000000001'
), 'alteração da base legal fica auditada atomicamente');
select throws_ok(
  $$update public.contactos set outreach_legal_basis='legitimate_interest', outreach_legal_basis_evidence=null, outreach_legitimate_interest_purpose=null, outreach_lia_reference=null, outreach_legitimate_interest_expires_at=null where id='c0000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'interesse legítimo sem LIA documentada é recusado'
);
select throws_ok(
  $$update public.contactos set outreach_legal_basis='consent', outreach_consent_at=now(), outreach_consent_source=null, outreach_legitimate_interest_purpose=null, outreach_lia_reference=null, outreach_legitimate_interest_expires_at=null where id='c0000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'consentimento sem origem auditável é recusado'
);
select lives_ok(
  $$update public.contactos set outreach_legal_basis='consent', outreach_consent_at=now(), outreach_consent_source='crm_manual', outreach_legitimate_interest_purpose=null, outreach_lia_reference=null, outreach_legitimate_interest_expires_at=null where id='c0000000-0000-4000-8000-000000000002'; update public.contactos set outreach_legal_basis='legitimate_interest', outreach_consent_at=null, outreach_consent_source=null, outreach_legitimate_interest_purpose='Prospecção B2B industrial', outreach_lia_reference='LIA-TEST-002-RENEWED', outreach_legitimate_interest_expires_at=now()+interval '1 year' where id='c0000000-0000-4000-8000-000000000002'$$,
  'base legal e consentimento mudam atomicamente'
);

insert into public.oportunidades(
  id, empresa_id, contacto_principal_id, owner_id, titulo, tipo
) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Opp Um', 'consultoria'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Opp Dois', 'consultoria');

insert into public.atividades(
  oportunidade_id, empresa_id, contacto_id, user_id, tipo, descricao,
  message_id, source_mailbox_email
) values (
  'd0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'email_recebido', 'Atividade Gmail legada',
  'legacy-null-mailbox-message', null
);
select is(
  (select source_mailbox_email::text from public.atividades
   where message_id='legacy-null-mailbox-message'),
  'outreach-admin@nikufra.ai',
  'atividade sem source usa o email normalizado do perfil proprietário'
);
select is(
  public.claim_google_provider_message(
    ' OUTREACH-ADMIN@NIKUFRA.AI ', 'legacy-null-mailbox-message'
  ),
  false,
  'atividade legada reparada impede nova eleição de efeitos globais'
);
select is(
  (select first_source from private.communication_provider_message_ledger
   where mailbox_email='outreach-admin@nikufra.ai'
     and provider_message_id='legacy-null-mailbox-message'),
  'crm_gmail',
  'claim reconhece a atividade legada como propriedade do CRM'
);
delete from public.atividades where message_id='legacy-null-mailbox-message';

insert into public.outreach_mailboxes(
  id, provider, email, display_name, owner_profile_id, status,
  send_enabled, daily_limit, ramp_daily_limit, timezone, created_by
) values (
  'e0000000-0000-4000-8000-000000000001', 'google', 'sender@nikufra.ai', 'Sender',
  'a0000000-0000-4000-8000-000000000001', 'active', true, 10, 10, 'UTC',
  'a0000000-0000-4000-8000-000000000001'
);

insert into public.outreach_campaigns(
  id, nome, status, created_by, timezone, send_days,
  send_window_start, send_window_end, gap_minutes
) values (
  'f0000000-0000-4000-8000-000000000001', 'Campanha de teste', 'running',
  'a0000000-0000-4000-8000-000000000001', 'UTC',
  array[0,1,2,3,4,5,6]::smallint[], '00:00', '23:59:59', 0
);
insert into public.outreach_campaign_mailboxes(campaign_id, mailbox_id, selected_by)
values (
  'f0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001'
);
insert into public.outreach_campaign_steps(id, campaign_id, position, kind)
values ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 1, 'email');

insert into public.outreach_recipients(
  id, campaign_id, contact_id, company_id, email_snapshot, status
) values
  ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'one@one.example', 'active'),
  ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'two@two.example', 'active');

insert into public.outreach_threads(
  id, campaign_id, recipient_id, contact_id, company_id, mailbox_id,
  provider_thread_id, classification, assigned_to
) values
  ('f3000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'provider-thread-1', 'positive', 'a0000000-0000-4000-8000-000000000003'),
  ('f3000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'provider-thread-2', 'positive', 'a0000000-0000-4000-8000-000000000004');
insert into public.outreach_events(event_type, campaign_id, mailbox_id, recipient_id)
values (
  'fixture', 'f0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select count(*) from public.outreach_campaigns$$,
  '42501', null, 'viewer usa a API e não lê campanhas via PostgREST'
);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select count(*) from public.outreach_threads$$,
  '42501', null, 'sales rep usa a API e não contorna o dark deploy'
);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select count(*) from public.outreach_mailboxes$$,
  '42501', null, 'manager também passa pela API durante dark deploy'
);
reset role;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);

-- A Gmail-first outbound record still updates Outreach-local delivery state and
-- metrics, but it must not replay CRM pipeline/activity effects.
update public.outreach_recipients
set status = 'pending'
where id = 'f2000000-0000-4000-8000-000000000002';
select ok(
  public.claim_google_provider_message(
    ' Sender@Nikufra.ai ', 'cross-sync-outbound-message'
  ),
  'Gmail reclama primeiro uma mensagem outbound normalizada'
);
insert into public.outreach_messages(
  id, thread_id, campaign_id, recipient_id, contact_id, company_id,
  mailbox_id, direction, kind, provider_message_id, occurred_at
) values (
  'f5000000-0000-4000-8000-000000000007', 'f3000000-0000-4000-8000-000000000002',
  'f0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001', 'outbound', 'email',
  'cross-sync-outbound-message', now()
);
select ok(
  (select status = 'active' from public.outreach_recipients
   where id = 'f2000000-0000-4000-8000-000000000002')
  and coalesce((select sum(sent) from public.outreach_metric_daily), 0) = 1
  and (select estado = 'nao_contactado' from public.contactos
       where id = 'c0000000-0000-4000-8000-000000000002')
  and (select estado = 'nao_contactado' from public.oportunidades
       where id = 'd0000000-0000-4000-8000-000000000002')
  and not exists (
    select 1 from public.atividades
    where message_id = 'cross-sync-outbound-message'
  ),
  'Gmail-first outbound aplica estado/métrica Outreach sem duplicar CRM'
);

-- A Gmail-first inbound reply must still become visible and stop Outreach jobs;
-- only the CRM activity/suggestion belongs to the shared claim owner.
update public.outreach_threads set unread = false
where id = 'f3000000-0000-4000-8000-000000000002';
insert into public.outreach_jobs(
  id, campaign_id, recipient_id, step_id, mailbox_id,
  scheduled_at, idempotency_key
) values (
  'f4000000-0000-4000-8000-000000000009', 'f0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001', now(), 'cross-sync-reply-job'
);
select ok(
  public.claim_google_provider_message(
    ' Sender@Nikufra.ai ', 'cross-sync-provider-message'
  ),
  'Gmail reclama atomicamente os efeitos de uma mensagem normalizada'
);
insert into public.outreach_messages(
  id, thread_id, campaign_id, recipient_id, contact_id, company_id,
  mailbox_id, direction, kind, provider_message_id, occurred_at
) values (
  'f5000000-0000-4000-8000-000000000009', 'f3000000-0000-4000-8000-000000000002',
  'f0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001', 'inbound', 'reply',
  'cross-sync-provider-message', now()
);
select ok(
  exists (
    select 1 from public.outreach_messages
    where provider_message_id = 'cross-sync-provider-message'
  )
  and (select unread from public.outreach_threads
       where id = 'f3000000-0000-4000-8000-000000000002')
  and (select status = 'replied' and responded_at is not null
       from public.outreach_recipients
       where id = 'f2000000-0000-4000-8000-000000000002')
  and (select status = 'cancelled' from public.outreach_jobs
       where id = 'f4000000-0000-4000-8000-000000000009')
  and exists (
    select 1 from private.outreach_provider_message_ledger
    where provider_message_id = 'cross-sync-provider-message'
  )
  and not exists (
    select 1 from public.atividades
    where message_id = 'cross-sync-provider-message'
  ),
  'Gmail-first inbound aplica thread, resposta e cancelamento só no Outreach'
);
select is(
  private.outreach_claim_provider_message(
    'sender@nikufra.ai', 'cross-sync-provider-message', 'outreach_inbound'
  ),
  false,
  'claim repetido perde a eleição independentemente da origem'
);
insert into public.atividades(
  oportunidade_id, empresa_id, contacto_id, user_id, tipo, descricao,
  message_id, source_mailbox_email
) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'email_recebido', 'Associação Gmail um', 'cross-sync-provider-message', 'sender@nikufra.ai'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'email_recebido', 'Associação Gmail dois', 'cross-sync-provider-message', 'sender@nikufra.ai');
select is((
  select count(*)::integer from public.atividades
  where source_mailbox_email = 'sender@nikufra.ai'
    and message_id = 'cross-sync-provider-message'
), 2, 'dedupe global preserva associações Gmail multi-contacto');
update public.outreach_recipients
set responded_at = null, status = 'active'
where id = 'f2000000-0000-4000-8000-000000000002';
select ok(
  private.outreach_claim_provider_message(
    'sender@nikufra.ai', 'outreach-preclaimed-message', 'outreach_inbound'
  ),
  'backend pode reclamar a mensagem antes de atualizar a thread'
);
insert into public.outreach_messages(
  id, thread_id, campaign_id, recipient_id, contact_id, company_id,
  mailbox_id, direction, kind, provider_message_id, occurred_at
) values (
  'f5000000-0000-4000-8000-000000000008', 'f3000000-0000-4000-8000-000000000002',
  'f0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001', 'inbound', 'reply',
  'outreach-preclaimed-message', now()
);
select ok(
  (select responded_at is not null from public.outreach_recipients where id = 'f2000000-0000-4000-8000-000000000002')
  and exists (
    select 1 from private.outreach_provider_message_ledger
    where provider_message_id = 'outreach-preclaimed-message'
  ),
  'trigger reconhece o pre-claim da mesma transação e aplica os efeitos uma vez'
);
update public.outreach_recipients
set responded_at = null, status = 'active'
where id = 'f2000000-0000-4000-8000-000000000002';

insert into public.outreach_jobs(
  id, campaign_id, recipient_id, step_id, mailbox_id,
  scheduled_at, idempotency_key
) values
  ('f4000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', now(), 'job-one'),
  ('f4000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', now(), 'job-two');

insert into public.outreach_jobs(
  id, campaign_id, recipient_id, step_id, mailbox_id,
  scheduled_at, status, idempotency_key
) values (
  'f4000000-0000-4000-8000-000000000050',
  'f0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001', now(),
  'reconciliation_required', 'suppression-after-ambiguous'
);
insert into private.outreach_delivery_ledger(
  job_id, mailbox_id, recipient_id, idempotency_key, status, payload_hash
) values (
  'f4000000-0000-4000-8000-000000000050',
  'e0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'suppression-after-ambiguous', 'ambiguous', decode(repeat('50',32),'hex')
);

insert into public.communication_suppressions(scope, email, reason, source)
values ('email', 'one@one.example', 'manual', 'test');

select ok((select optout from public.contactos where id = 'c0000000-0000-4000-8000-000000000001'), 'supressão reflete optout');
select is((select status::text from public.outreach_recipients where id = 'f2000000-0000-4000-8000-000000000001'), 'suppressed', 'supressão marca destinatário');
select is((select status::text from public.outreach_jobs where id = 'f4000000-0000-4000-8000-000000000001'), 'cancelled', 'supressão cancela job futuro');
select ok(
  (select status='reconciliation_required' from public.outreach_jobs
   where id='f4000000-0000-4000-8000-000000000050')
  and (select status='ambiguous' from private.outreach_delivery_ledger
       where job_id='f4000000-0000-4000-8000-000000000050'),
  'supressão preserva reconciliação quando já existe delivery ambíguo'
);
select ok((select identity_hmac is not null from public.communication_suppressions where email = 'one@one.example'), 'supressão recebe HMAC');

-- The second contact is unsuppressed and proves the only automatic pipeline
-- transition is the first one.
insert into public.outreach_messages(
  id, thread_id, campaign_id, recipient_id, contact_id, company_id,
  mailbox_id, direction, kind, provider_message_id, occurred_at
) values (
  'f5000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002',
  'f0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001', 'outbound', 'email', 'provider-message-out-1', now()
);
select is((select estado::text from public.contactos where id = 'c0000000-0000-4000-8000-000000000002'), 'contactado', 'primeiro envio marca contacto');
select is((select estado::text from public.oportunidades where id = 'd0000000-0000-4000-8000-000000000002'), 'contactado', 'primeiro envio avança oportunidade uma etapa');

update public.oportunidades set estado = 'reuniao_feita' where id = 'd0000000-0000-4000-8000-000000000002';
insert into public.outreach_messages(
  id, thread_id, campaign_id, recipient_id, contact_id, company_id,
  mailbox_id, direction, kind, provider_message_id, occurred_at
) values (
  'f5000000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000002',
  'f0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001', 'outbound', 'email', 'provider-message-out-2', now()
);
select is((select estado::text from public.oportunidades where id = 'd0000000-0000-4000-8000-000000000002'), 'reuniao_feita', 'envio posterior não regride pipeline');

insert into public.outreach_messages(
  id, thread_id, campaign_id, recipient_id, contact_id, company_id,
  mailbox_id, direction, kind, provider_message_id, occurred_at
) values (
  'f5000000-0000-4000-8000-000000000003', 'f3000000-0000-4000-8000-000000000002',
  'f0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001', 'inbound', 'auto_reply', 'provider-message-auto', now()
);
select is((select status::text from public.outreach_jobs where id = 'f4000000-0000-4000-8000-000000000002'), 'pending', 'auto-reply não cancela follow-up');
select is((select responded_at is null from public.outreach_recipients where id = 'f2000000-0000-4000-8000-000000000002'), true, 'auto-reply não conta como resposta humana');
select ok(
  not exists(select 1 from public.atividades where message_id = 'provider-message-auto')
  and coalesce((select sum(positive_replies) from public.outreach_metric_daily), 0) = 2,
  'auto-reply não cria sugestão nem incrementa resposta positiva'
);

insert into public.outreach_jobs(
  id, campaign_id, recipient_id, step_id, mailbox_id,
  scheduled_at, status, idempotency_key
) values (
  'f4000000-0000-4000-8000-000000000051',
  'f0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002',
  'f1000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001', now(),
  'reconciliation_required', 'reply-after-accepted'
);
insert into private.outreach_delivery_ledger(
  job_id, mailbox_id, recipient_id, idempotency_key, status, payload_hash,
  provider_message_id
) values (
  'f4000000-0000-4000-8000-000000000051',
  'e0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002',
  'reply-after-accepted', 'accepted', decode(repeat('51',32),'hex'),
  'reply-after-accepted-provider'
);

insert into public.outreach_messages(
  id, thread_id, campaign_id, recipient_id, contact_id, company_id,
  mailbox_id, direction, kind, provider_message_id, subject, snippet, occurred_at
) values (
  'f5000000-0000-4000-8000-000000000004', 'f3000000-0000-4000-8000-000000000002',
  'f0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001', 'inbound', 'reply', 'provider-message-reply',
  'Resposta positiva', 'Vamos reunir', now()
);
select is((select status::text from public.outreach_jobs where id = 'f4000000-0000-4000-8000-000000000002'), 'cancelled', 'resposta humana cancela follow-up');
select ok(
  (select status='reconciliation_required' from public.outreach_jobs
   where id='f4000000-0000-4000-8000-000000000051')
  and (select status='accepted' from private.outreach_delivery_ledger
       where job_id='f4000000-0000-4000-8000-000000000051'),
  'resposta humana preserva reconciliação quando o provider já aceitou o envio'
);
select ok((select responded_at is not null from public.outreach_recipients where id = 'f2000000-0000-4000-8000-000000000002'), 'resposta humana fica registada');
select ok(exists(
  select 1 from public.atividades
  where message_id = 'provider-message-reply'
    and contacto_id = 'c0000000-0000-4000-8000-000000000002'
), 'resposta positiva cria atividade/sugestão CRM');
select is((select estado::text from public.oportunidades where id = 'd0000000-0000-4000-8000-000000000002'), 'reuniao_feita', 'resposta positiva não avança pipeline');

-- These two regression fixtures have proved that reply/suppression never hide
-- an uncertain provider outcome. Close them explicitly before later live-gate
-- scenarios so they do not contaminate unrelated readiness assertions.
update private.outreach_delivery_ledger
set status='reconciled',
    first_attempt_at=now()-interval '1 day',
    last_attempt_at=now()-interval '1 day'
where job_id in (
  'f4000000-0000-4000-8000-000000000050',
  'f4000000-0000-4000-8000-000000000051'
);
update public.outreach_jobs
set status='cancelled',updated_at=now()
where id in (
  'f4000000-0000-4000-8000-000000000050',
  'f4000000-0000-4000-8000-000000000051'
);

select throws_ok(
  $$insert into public.outreach_messages(thread_id, mailbox_id, direction, provider_message_id, occurred_at) values ('f3000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','inbound','provider-message-reply',now())$$,
  '23505', null, 'provider message é deduplicada por mailbox'
);

-- Fail closed in disabled mode, then enforce canary allowlist after every
-- technical/legal prerequisite is fresh and green.
insert into public.outreach_email_verifications(contact_id, email, status, verified_at, expires_at)
values ('c0000000-0000-4000-8000-000000000002', 'two@two.example', 'valid', now(), now() + interval '30 days');
insert into public.outreach_dns_checks(mailbox_id, domain, spf_status, dkim_status, dmarc_status, mx_status)
values ('e0000000-0000-4000-8000-000000000001', 'nikufra.ai', 'pass', 'pass', 'pass', 'pass');
-- Delivery-trigger fixtures above deliberately occurred "today" to validate
-- metrics. Move them outside the quota window before testing a fresh canary;
-- quota-specific assertions below create their own reservation.
update public.outreach_messages
set occurred_at = now() - interval '1 day'
where id in (
  'f5000000-0000-4000-8000-000000000007',
  'f5000000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000002'
);
update public.outreach_recipients
set responded_at = null, status = 'active'
where id = 'f2000000-0000-4000-8000-000000000002';
select is(
  (private.outreach_recipient_eligibility('f2000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001') ->> 'eligible')::boolean,
  false,
  'eligibilidade falha com outbound desligado'
);
select throws_ok(
  $$select private.outreach_transition_system('live','a0000000-0000-4000-8000-000000000001',true,null)$$,
  'P0001', null, 'live não pode saltar o canary'
);
select is(
  (private.outreach_transition_system(
    'canary','a0000000-0000-4000-8000-000000000001',false,null
  )).mode::text,
  'canary',
  'estado transita disabled para canary'
);
select is(
  (private.outreach_recipient_eligibility('f2000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001') ->> 'eligible')::boolean,
  false,
  'canary bloqueia email fora da allowlist'
);
insert into private.outreach_canary_allowlist(email, added_by)
values ('two@two.example', 'a0000000-0000-4000-8000-000000000001');
select is(
  (private.outreach_recipient_eligibility('f2000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001') ->> 'eligible')::boolean,
  true,
  'canary aceita contacto allowlisted e plenamente elegível'
);
update public.contactos
set outreach_legitimate_interest_expires_at = now() - interval '1 minute'
where id = 'c0000000-0000-4000-8000-000000000002';
select ok(
  (private.outreach_recipient_eligibility(
    'f2000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001'
  ) -> 'reasons') ? 'lawful_basis_missing',
  'LIA expirada bloqueia o envio mesmo com os restantes gates verdes'
);
update public.contactos
set outreach_legitimate_interest_expires_at = now() + interval '1 year'
where id = 'c0000000-0000-4000-8000-000000000002';
update public.outreach_dns_checks
set checked_at = now() - interval '25 hours'
where mailbox_id = 'e0000000-0000-4000-8000-000000000001';
select ok(
  (private.outreach_recipient_eligibility(
    'f2000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001'
  ) -> 'reasons') ? 'dns_not_ready',
  'DNS aprovado há mais de 24 horas deixa de ser elegível'
);
update public.outreach_dns_checks
set checked_at = now()
where mailbox_id = 'e0000000-0000-4000-8000-000000000001';
insert into public.outreach_campaigns(
  id, nome, status, created_by, timezone, send_days,
  send_window_start, send_window_end, daily_limit, gap_minutes
) values (
  'f0000000-0000-4000-8000-000000000002', 'Campanha isolada', 'running',
  'a0000000-0000-4000-8000-000000000001', 'UTC',
  array[0,1,2,3,4,5,6]::smallint[], '00:00', '23:59:59', 1, 0
);
insert into public.outreach_campaign_steps(id, campaign_id, position, kind)
values (
  'f1000000-0000-4000-8000-000000000002',
  'f0000000-0000-4000-8000-000000000002', 1, 'email'
);
insert into public.outreach_recipients(
  id, campaign_id, contact_id, company_id, email_snapshot, status
) values (
  'f2000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
  'two@two.example', 'active'
);
insert into public.outreach_campaign_mailboxes(campaign_id, mailbox_id, selected_by)
values (
  'f0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001'
);
select is(
  (private.outreach_recipient_eligibility(
    'f2000000-0000-4000-8000-000000000003',
    'e0000000-0000-4000-8000-000000000001'
  ) ->> 'eligible')::boolean,
  true,
  'quota de outra campanha não esgota o limite desta campanha'
);
update public.outreach_recipients set status = 'completed'
where id = 'f2000000-0000-4000-8000-000000000003';
select ok(
  (private.outreach_recipient_eligibility(
    'f2000000-0000-4000-8000-000000000003',
    'e0000000-0000-4000-8000-000000000001'
  ) -> 'reasons') ? 'recipient_terminal_status',
  'estado completed é terminal e falha fechado'
);
update public.outreach_recipients set status = 'active'
where id = 'f2000000-0000-4000-8000-000000000003';

insert into public.outreach_jobs(
  id,campaign_id,recipient_id,step_id,mailbox_id,scheduled_at,status,
  lease_owner,lease_expires_at,idempotency_key
) values
  ('f4000000-0000-4000-8000-000000000030','f0000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001',now(),'leased','canary-pre-dispatch',now()+interval '2 minutes','canary-pre-dispatch'),
  ('f4000000-0000-4000-8000-000000000031','f0000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001',now(),'leased','canary-after-reservation',now()+interval '2 minutes','canary-after-reservation');
insert into private.outreach_delivery_ledger(job_id,mailbox_id,recipient_id,idempotency_key,status,payload_hash)
values('f4000000-0000-4000-8000-000000000031','e0000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000003','canary-after-reservation','sending',decode(repeat('cd',32),'hex'));

delete from public.outreach_campaign_mailboxes
where campaign_id='f0000000-0000-4000-8000-000000000002'
  and mailbox_id='e0000000-0000-4000-8000-000000000001';
select ok(
  (private.outreach_recipient_eligibility(
    'f2000000-0000-4000-8000-000000000003',
    'e0000000-0000-4000-8000-000000000001'
  ) -> 'reasons') ? 'campaign_mailbox_not_selected',
  'deselecionar após materialização torna o job inelegível'
);
select throws_ok(
  $$select private.outreach_assert_dispatch_eligible(
    'f4000000-0000-4000-8000-000000000030',
    extensions.digest('campaign mailbox scope', 'sha256')
  )$$,
  'P2001', null,
  'dispatch recusa um job existente cuja mailbox deixou de estar selecionada'
);
insert into public.outreach_campaign_mailboxes(campaign_id, mailbox_id, selected_by)
values (
  'f0000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001'
);

select ok(
  private.outreach_trip_canary('ledger_duplicate', null),
  'incidente explícito faz trip atómico do canary'
);
select ok(
  (select mode = 'disabled' and not send_enabled
   from public.outreach_system_state where id)
  and not exists (
    select 1 from public.outreach_campaigns where status = 'running'
  )
  and exists (
    select 1 from public.outreach_audit_log
    where action = 'canary_tripped' and details ->> 'reason' = 'ledger_duplicate'
  )
  and (select status='pending' from public.outreach_jobs where id='f4000000-0000-4000-8000-000000000030')
  and (select status='reconciliation_required' from public.outreach_jobs where id='f4000000-0000-4000-8000-000000000031'),
  'trip desliga outbound, pausa campanhas e audita sem PII'
);
select is(
  private.outreach_trip_canary('ledger_duplicate', null),
  false,
  'trip repetido fora de canary é idempotente'
);
update public.outreach_jobs set status='cancelled',lease_owner=null,lease_expires_at=null
where id in ('f4000000-0000-4000-8000-000000000030','f4000000-0000-4000-8000-000000000031');
-- This synthetic test knows the provider boundary was never crossed. Closing
-- its reservation prevents it from consuming quota in unrelated claim tests.
update private.outreach_delivery_ledger
set status='failed',last_attempt_at=now()
where job_id='f4000000-0000-4000-8000-000000000031' and status='sending';
update public.outreach_campaigns set status = 'running', paused_at = null
where id in (
  'f0000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000002'
);
do $$ begin
  perform private.outreach_transition_system(
    'canary','a0000000-0000-4000-8000-000000000001',false,null
  );
end $$;
update public.outreach_mailboxes
set ramp_daily_limit = 10, ramp_started_at = now() - interval '49 hours',
    last_incident_at = null
where id = 'e0000000-0000-4000-8000-000000000001';
insert into public.outreach_messages(
  id, thread_id, campaign_id, recipient_id, contact_id, company_id,
  mailbox_id, direction, kind, provider_message_id, occurred_at
) values (
  'f5000000-0000-4000-8000-000000000006',
  'f3000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'inbound', 'complaint', 'provider-message-complaint', now()
);
select ok(
  (select mode = 'disabled' and not send_enabled
   from public.outreach_system_state where id)
  and exists (
    select 1 from public.outreach_audit_log
    where action = 'canary_tripped' and details ->> 'reason' = 'complaint'
  ),
  'complaint durante canary aciona automaticamente o kill switch'
);
update public.outreach_campaigns set status = 'running', paused_at = null
where id in (
  'f0000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000002'
);
do $$ begin
  perform private.outreach_transition_system(
    'canary','a0000000-0000-4000-8000-000000000001',false,null
  );
end $$;
update public.outreach_mailboxes
set ramp_daily_limit = 10, ramp_started_at = now() - interval '49 hours',
    last_incident_at = null
where id = 'e0000000-0000-4000-8000-000000000001';

update public.outreach_recipients
set responded_at = now(), status = 'replied'
where id = 'f2000000-0000-4000-8000-000000000002';
insert into public.outreach_jobs(
  id, campaign_id, recipient_id, step_id, mailbox_id, scheduled_at, status,
  lease_owner, lease_expires_at, idempotency_key
) values (
  'f4000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001', now(), 'leased', 'manual-test',
  now() + interval '2 minutes', 'manual:reply-test'
);
select ok(
  private.outreach_assert_dispatch_eligible(
    'f4000000-0000-4000-8000-000000000003',
    extensions.digest('manual reply payload', 'sha256')
  ) is not null,
  'resposta manual ignora apenas o bloqueio de resposta anterior'
);
select throws_ok(
  $$select private.outreach_assert_dispatch_eligible(
    'f4000000-0000-4000-8000-000000000003',
    extensions.digest('manual reply payload', 'sha256')
  )$$,
  'P2002', null, 'reserva/ledger repetido tem código de erro distinto'
);
insert into public.outreach_jobs(
  id, campaign_id, recipient_id, step_id, mailbox_id, scheduled_at, status,
  lease_owner, lease_expires_at, idempotency_key
) values (
  'f4000000-0000-4000-8000-000000000010',
  'f0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001', now(), 'leased',
  'ineligible-test', now() + interval '2 minutes', 'manual:ineligible-test'
);
select throws_ok(
  $$select private.outreach_assert_dispatch_eligible(
    'f4000000-0000-4000-8000-000000000010',
    extensions.digest('ineligible payload', 'sha256')
  )$$,
  'P2001', null, 'reply manual não ignora estado terminal e usa P2001'
);
update public.outreach_jobs
set status = 'cancelled', lease_owner = null, lease_expires_at = null
where id = 'f4000000-0000-4000-8000-000000000010';
update public.outreach_campaigns
set daily_limit = 1
where id = 'f0000000-0000-4000-8000-000000000001';
select ok(
  (private.outreach_recipient_eligibility(
    'f2000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001'
  ) -> 'reasons') ? 'daily_quota_reached',
  'reserva sending no ledger consome quota antes da confirmação do provider'
);
update public.outreach_campaigns
set daily_limit = 10
where id = 'f0000000-0000-4000-8000-000000000001';
update public.outreach_jobs
set status = 'sent', sent_at = now(), lease_owner = null, lease_expires_at = null
where id = 'f4000000-0000-4000-8000-000000000003';
update private.outreach_delivery_ledger
set status='confirmed',provider_message_id='provider-message-out-2'
where job_id='f4000000-0000-4000-8000-000000000003';

-- Give the mailbox an explicit, confirmed recent activity for the pacing
-- tests. The earlier metric fixtures were intentionally moved to yesterday so
-- they would not contaminate the independent quota assertion.
update public.outreach_messages
set occurred_at = now()
where id = 'f5000000-0000-4000-8000-000000000002';
update public.outreach_campaigns set gap_minutes = 60
where id = 'f0000000-0000-4000-8000-000000000002';
insert into public.outreach_jobs(
  id, campaign_id, recipient_id, step_id, mailbox_id,
  scheduled_at, idempotency_key
) values
  (
    'f4000000-0000-4000-8000-000000000004',
    'f0000000-0000-4000-8000-000000000002',
    'f2000000-0000-4000-8000-000000000003',
    'f1000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001', now(), 'pacing-job-one'
  ),
  (
    'f4000000-0000-4000-8000-000000000005',
    'f0000000-0000-4000-8000-000000000002',
    'f2000000-0000-4000-8000-000000000003',
    'f1000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001', now(), 'pacing-job-two'
  );
select ok(
  (private.outreach_recipient_eligibility(
    'f2000000-0000-4000-8000-000000000003',
    'e0000000-0000-4000-8000-000000000001'
  ) -> 'reasons') ? 'mailbox_gap_not_elapsed',
  'reserva recente aplica gap da campanha à mailbox inteira'
);
select is(
  (select count(*)::integer from private.outreach_claim_jobs('gap-worker', 10, 120)),
  0,
  'scheduler não reclama jobs enquanto o gap decorre'
);
select ok(
  (select count(*) = 2 from public.outreach_jobs
   where id in (
     'f4000000-0000-4000-8000-000000000004',
     'f4000000-0000-4000-8000-000000000005'
   ) and status = 'pending' and last_error is null),
  'gap é transitório e não cancela nem marca os jobs como falhados'
);
update public.outreach_campaigns set gap_minutes = 0
where id = 'f0000000-0000-4000-8000-000000000002';
select is(
  (select count(*)::integer from private.outreach_claim_jobs('worker-one', 10, 120)),
  1,
  'primeiro worker reclama no máximo um job da mailbox'
);
select is(
  (select count(*)::integer from private.outreach_claim_jobs('worker-two', 10, 120)),
  0,
  'segundo worker respeita o lease ativo da mesma mailbox'
);
select is(
  (select count(*)::integer from public.outreach_jobs
   where mailbox_id = 'e0000000-0000-4000-8000-000000000001'
     and status = 'leased' and lease_expires_at > now()),
  1,
  'barreira concorrente mantém apenas um lease vivo por mailbox'
);
insert into public.outreach_jobs(
  id, campaign_id, recipient_id, step_id, mailbox_id, scheduled_at, status,
  lease_owner, lease_expires_at, idempotency_key
) values
  ('f4000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', now() + interval '1 hour', 'leased', 'crashed-before-dispatch', now() - interval '1 minute', 'lease-expired-no-ledger'),
  ('f4000000-0000-4000-8000-000000000007', 'f0000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', now() + interval '1 hour', 'leased', 'crashed-after-dispatch', now() - interval '1 minute', 'lease-expired-with-ledger');
insert into private.outreach_delivery_ledger(
  job_id, mailbox_id, recipient_id, idempotency_key, status, payload_hash
) values (
  'f4000000-0000-4000-8000-000000000007',
  'e0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000003',
  'lease-expired-with-ledger', 'sending', decode(repeat('ab', 32), 'hex')
);
select is(
  (select count(*)::integer from private.outreach_claim_jobs('lease-recovery-worker', 1, 120)),
  0,
  'recuperação de leases não reclama jobs agendados no futuro'
);
select is(
  (select status::text from public.outreach_jobs where id='f4000000-0000-4000-8000-000000000006'),
  'pending',
  'crash antes da reserva de dispatch regressa o job a pending'
);
select is(
  (select status::text from public.outreach_jobs where id='f4000000-0000-4000-8000-000000000007'),
  'reconciliation_required',
  'lease expirado com ledger nunca é reenviado automaticamente'
);
-- The reconciliation transition above is itself a canary incident and must
-- trip the system. Subsequent ramp/readiness fixtures explicitly begin a new
-- canary window instead of relying on stale mode state.
do $$ begin
  perform private.outreach_transition_system(
    'canary','a0000000-0000-4000-8000-000000000001',false,null
  );
end $$;
update public.outreach_jobs
set status = 'cancelled', lease_owner = null, lease_expires_at = null
where id in (
  'f4000000-0000-4000-8000-000000000004',
  'f4000000-0000-4000-8000-000000000005',
  'f4000000-0000-4000-8000-000000000006'
);
update public.outreach_recipients
set responded_at = null, status = 'active'
where id = 'f2000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select private.outreach_transition_system(
    'live','a0000000-0000-4000-8000-000000000001',true,null
  )$$,
  'P0001', null, 'live bloqueia antes de 48 horas completas de canary'
);
update public.outreach_system_state
set canary_started_at = now() - interval '49 hours'
where id;
select ok(
  (private.outreach_record_worker_heartbeat('worker-readiness-test', true)).worker_continuous_since
    is not null,
  'heartbeat inicia a janela persistente de estabilidade do worker'
);
select throws_ok(
  $$select private.outreach_transition_system(
    'live','a0000000-0000-4000-8000-000000000001',true,null
  )$$,
  'P0001', null, 'live bloqueia antes de 24 horas contínuas de worker'
);

update public.outreach_mailboxes
set ramp_daily_limit = 1,
    ramp_started_at = now() - interval '49 hours',
    last_incident_at = null
where id = 'e0000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select private.outreach_advance_mailbox_ramp(
    'e0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000003'
  )$$,
  'P0001', null, 'não-admin não avança o ramp da mailbox'
);
select throws_ok(
  $$select private.outreach_advance_mailbox_ramp(
    'e0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'Ramp exige pelo menos um envio confirmado no patamar atual',
  'ramp não avança sem amostra outbound confirmada no patamar atual'
);
update public.outreach_jobs
set provider_message_id = 'provider-message-out-2'
where id = 'f4000000-0000-4000-8000-000000000003';
select is(
  (private.outreach_advance_mailbox_ramp(
    'e0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001'
  )).ramp_daily_limit,
  3,
  'ramp avança estritamente de 1 para 3 após 48 horas limpas'
);
select throws_ok(
  $$select private.outreach_advance_mailbox_ramp(
    'e0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', null, 'ramp seguinte exige nova janela de 48 horas'
);

update public.outreach_system_state
set canary_started_at = now() - interval '49 hours',
    worker_continuous_since = now() - interval '25 hours',
    worker_last_heartbeat_at = now(),
    worker_heartbeat_owner = 'worker-readiness-test'
where id;
select throws_ok(
  $$select private.outreach_transition_system(
    'live','a0000000-0000-4000-8000-000000000001',true,null
  )$$,
  'P0001', null, 'live bloqueia durante 48 horas após qualquer incidente'
);
update public.outreach_system_state
set last_incident_at = now() - interval '49 hours'
where id;
update public.outreach_jobs
set status = 'cancelled', lease_owner = null, lease_expires_at = null
where id = 'f4000000-0000-4000-8000-000000000007';
-- The lease-recovery assertion above deliberately created a possibly sent
-- delivery. Close that fixture explicitly before testing the unrelated ramp
-- proof; the dedicated regression below verifies that a nonterminal ledger
-- blocks live independently from the job status.
update private.outreach_delivery_ledger
set status='reconciled',last_attempt_at=now()
where job_id='f4000000-0000-4000-8000-000000000007';
select throws_ok(
  $$select private.outreach_transition_system(
    'live','a0000000-0000-4000-8000-000000000001',true,null
  )$$,
  'P0001', null, 'live bloqueia sem prova durável de todos os patamares do ramp'
);
update public.outreach_system_state
set canary_started_at = now() - interval '193 hours'
where id;
insert into public.outreach_audit_log(actor_id,action,entity_type,entity_id,details,created_at)
values
  ('a0000000-0000-4000-8000-000000000001','mailbox_ramp_advanced','mailbox','e0000000-0000-4000-8000-000000000001','{"daily_limit":3}',now()-interval '169 hours'),
  ('a0000000-0000-4000-8000-000000000001','mailbox_ramp_advanced','mailbox','e0000000-0000-4000-8000-000000000001','{"daily_limit":5}',now()-interval '121 hours'),
  ('a0000000-0000-4000-8000-000000000001','mailbox_ramp_advanced','mailbox','e0000000-0000-4000-8000-000000000001','{"daily_limit":10}',now()-interval '73 hours');
insert into public.outreach_jobs(
  id,campaign_id,recipient_id,step_id,mailbox_id,scheduled_at,status,
  provider_message_id,sent_at,idempotency_key
) values
  ('f4000000-0000-4000-8000-000000000020','f0000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001',now()-interval '181 hours','sent','ramp-stage-1',now()-interval '181 hours','ramp-stage-1'),
  ('f4000000-0000-4000-8000-000000000021','f0000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001',now()-interval '145 hours','sent','ramp-stage-3',now()-interval '145 hours','ramp-stage-3'),
  ('f4000000-0000-4000-8000-000000000022','f0000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001',now()-interval '97 hours','sent','ramp-stage-5',now()-interval '97 hours','ramp-stage-5'),
  ('f4000000-0000-4000-8000-000000000023','f0000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001',now()-interval '49 hours','sent','ramp-stage-10',now()-interval '49 hours','ramp-stage-10');
insert into public.outreach_messages(
  id,campaign_id,recipient_id,contact_id,company_id,mailbox_id,direction,kind,
  provider_message_id,occurred_at
) values
  ('f5000000-0000-4000-8000-000000000020','f0000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','outbound','email','ramp-stage-1',now()-interval '181 hours'),
  ('f5000000-0000-4000-8000-000000000021','f0000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','outbound','email','ramp-stage-3',now()-interval '145 hours'),
  ('f5000000-0000-4000-8000-000000000022','f0000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','outbound','email','ramp-stage-5',now()-interval '97 hours'),
  ('f5000000-0000-4000-8000-000000000023','f0000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','outbound','email','ramp-stage-10',now()-interval '49 hours');
update public.outreach_mailboxes
set ramp_daily_limit = 10, ramp_started_at = now() - interval '73 hours'
where id = 'e0000000-0000-4000-8000-000000000001';
select is(
  (private.outreach_transition_system(
    'live','a0000000-0000-4000-8000-000000000001',true,null
  )).mode::text,
  'live',
  'live exige confirmação, 48h de canary e 24h de worker estável'
);
insert into public.outreach_mailboxes(
  id,provider,email,display_name,owner_profile_id,status,send_enabled,
  daily_limit,ramp_daily_limit,timezone,created_by
) values (
  'e0000000-0000-4000-8000-000000000002','google','new-live-mailbox@nikufra.ai',
  'New live mailbox','a0000000-0000-4000-8000-000000000001','active',false,
  10,1,'UTC','a0000000-0000-4000-8000-000000000001'
);
select throws_ok(
  $$update public.outreach_mailboxes
    set send_enabled=true
    where id='e0000000-0000-4000-8000-000000000002'$$,
  'P0001', 'Live só permite ativar mailboxes com ramp 1/3/5/10 e prova durável completa',
  'live rejeita ativação tardia de mailbox nova ainda no patamar 1'
);
select lives_ok(
  $$update public.outreach_mailboxes
      set send_enabled=false
      where id='e0000000-0000-4000-8000-000000000001';
    update public.outreach_mailboxes
      set send_enabled=true
      where id='e0000000-0000-4000-8000-000000000001'$$,
  'live permite reativar mailbox cuja prova durável já foi concluída'
);
select throws_ok(
  $$select private.outreach_advance_mailbox_ramp(
    'e0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'Ramp só pode avançar durante canary',
  'ramp não pode ser avançado depois da promoção para live'
);
select lives_ok($outer$
do $test$
declare paused boolean;
begin
  begin
    delete from public.outreach_metric_daily where mailbox_id='e0000000-0000-4000-8000-000000000001';
    update public.outreach_system_state set settings=settings||'{"bounceWarningThreshold":3,"bouncePauseThreshold":5}'::jsonb where id;
    insert into public.outreach_metric_daily(metric_date,campaign_id,mailbox_id,sent,hard_bounces)
    values(current_date,'f0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',100,3);
    paused := private.outreach_record_delivery_incident('hard_bounce','e0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001',null,'provider_webhook','f7000000-0000-4000-8000-000000000001');
    if paused or (select mode<>'live' from public.outreach_system_state where id) then raise exception 'bounce abaixo do limite pausou live'; end if;
    paused := private.outreach_record_delivery_incident('hard_bounce','e0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001',null,'provider_webhook','f7000000-0000-4000-8000-000000000002');
    if not paused or (select mode<>'disabled' from public.outreach_system_state where id) then raise exception 'bounce igual ao limite não pausou live'; end if;
    raise exception using errcode='PT001',message='rollback threshold fixture';
  exception when sqlstate 'PT001' then null;
  end;
end
$test$;
$outer$, 'hard-bounce abaixo do limiar avisa e igualdade pausa live atomicamente');
select lives_ok($outer$
do $test$
declare paused boolean;
begin
  begin
    delete from public.outreach_metric_daily where mailbox_id='e0000000-0000-4000-8000-000000000001';
    update public.outreach_system_state set settings=settings||'{"complaintPauseThreshold":0.1}'::jsonb where id;
    insert into public.outreach_metric_daily(metric_date,campaign_id,mailbox_id,sent)
    values(current_date,'f0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',1000);
    paused := private.outreach_record_delivery_incident('complaint','e0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001',null,'provider_webhook','f7000000-0000-4000-8000-000000000003');
    if not paused or (select mode<>'disabled' from public.outreach_system_state where id) then raise exception 'complaint igual ao limite não pausou live'; end if;
    raise exception using errcode='PT001',message='rollback threshold fixture';
  exception when sqlstate 'PT001' then null;
  end;
end
$test$;
$outer$, 'complaint igual ao limiar configurado pausa live');
select lives_ok($outer$
do $test$
declare paused boolean;
begin
  begin
    delete from public.outreach_metric_daily where mailbox_id='e0000000-0000-4000-8000-000000000001';
    paused := private.outreach_record_delivery_incident('hard_bounce','e0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001',null,'provider_webhook','f7000000-0000-4000-8000-000000000004');
    if not paused or (select mode<>'disabled' from public.outreach_system_state where id) then raise exception 'incidente sem denominador não falhou fechado'; end if;
    raise exception using errcode='PT001',message='rollback threshold fixture';
  exception when sqlstate 'PT001' then null;
  end;
end
$test$;
$outer$, 'incidente com sent=0 evita divisão por zero e pausa live fail-closed');
select throws_ok(
  $$select private.outreach_transition_system('canary','a0000000-0000-4000-8000-000000000001',false,null)$$,
  'P0001', null, 'state machine proíbe regressão live para canary'
);
select throws_ok(
  $$update public.outreach_system_state set mode='canary', send_enabled=true where id$$,
  'P0001', null, 'trigger impede contornar a state machine diretamente'
);
update public.outreach_campaigns
set status = 'running', paused_at = null
where id = 'f0000000-0000-4000-8000-000000000001';
update public.outreach_mailboxes
set ramp_daily_limit = 10, ramp_started_at = now() - interval '49 hours'
where id = 'e0000000-0000-4000-8000-000000000001';
update public.outreach_jobs
set status = 'leased', lease_owner = 'kill-switch-test',
    lease_expires_at = now() + interval '2 minutes'
where id in (
  'f4000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000003'
);
do $$ begin
  perform private.outreach_transition_system(
    'disabled','a0000000-0000-4000-8000-000000000001',false,'test kill switch'
  );
end $$;
select ok(
  (select mode = 'disabled' and not send_enabled
   from public.outreach_system_state where id)
  and not exists (select 1 from public.outreach_campaigns where status = 'running')
  and not exists (select 1 from public.outreach_mailboxes where ramp_daily_limit <> 1)
  and not exists (select 1 from public.outreach_jobs where status = 'leased')
  and (select status='pending' from public.outreach_jobs where id='f4000000-0000-4000-8000-000000000001')
  and (select status='reconciliation_required' from public.outreach_jobs where id='f4000000-0000-4000-8000-000000000003'),
  'kill switch corta outbound, pausa campanhas, reseta ramp e reconcilia leases'
);

-- Dry-run migration is repeatable and never touches credential storage.
select is(
  (private.import_outreach_legacy_snapshot(
    '{"version":1,"mailboxes":[],"leads":[],"campaigns":[],"messages":[],"threads":[],"jobs":[],"suppressions":[],"audit":[]}'::jsonb,
    true
  ) ->> 'idempotent')::boolean,
  false,
  'primeiro dry-run calcula inventário'
);
select is(
  (private.import_outreach_legacy_snapshot(
    '{"version":1,"mailboxes":[],"leads":[],"campaigns":[],"messages":[],"threads":[],"jobs":[],"suppressions":[],"audit":[]}'::jsonb,
    true
  ) ->> 'idempotent')::boolean,
  true,
  'segundo dry-run é idempotente'
);

create temporary table legacy_snapshot_fixture(snapshot jsonb) on commit drop;
insert into legacy_snapshot_fixture(snapshot) values (
  $json${
    "version": 1,
    "mailboxes": [{
      "id": "legacy-test-mailbox", "provider": "google",
      "email": "legacy-sender@nikufra.ai", "senderName": "Legacy Sender",
      "status": "connected", "dailyLimit": 50,
      "lastSyncAt": "2026-09-29T10:00:00Z",
      "authentication": {"spf": true, "dkim": true, "dmarc": true}
    }],
    "leads": [{
      "id": "legacy-test-lead", "email": "legacy-person@legacy-test.example",
      "firstName": "Legacy", "lastName": "Person", "company": "Legacy Test Company",
      "status": "active", "legalBasis": "legal-entity-optout"
    }],
    "campaigns": [{
      "id": "legacy-test-campaign", "name": "Legacy campaign", "status": "running",
      "leadIds": ["legacy-test-lead"],
      "schedule": {"timezone": "Europe/Lisbon", "days": [1,2,3,4,5], "startTime": "09:00", "endTime": "17:00"},
      "sequence": [{
        "id": "legacy-test-step", "order": 1, "kind": "email",
        "variants": [{"id": "legacy-test-variant", "name": "A", "weight": 100, "subject": "Olá", "body": "Mensagem"}]
      }]
    }],
    "threads": [{
      "id": "legacy-test-thread", "campaignId": "legacy-test-campaign",
      "leadId": "legacy-test-lead", "mailboxId": "legacy-test-mailbox",
      "providerThreadId": "legacy-test-provider-thread", "subject": "Olá",
      "classification": "unclassified", "lastMessageAt": "2026-09-29T11:00:00Z"
    }],
    "messages": [{
      "id": "legacy-test-message", "threadId": "legacy-test-thread",
      "direction": "outbound", "status": "sent",
      "providerMessageId": "legacy-test-provider-message", "subject": "Olá",
      "body": "Mensagem", "sentAt": "2026-09-29T11:00:00Z"
    }, {
      "id": "legacy-test-message-admin-confirmed", "threadId": "legacy-test-thread",
      "direction": "outbound", "status": "sent",
      "providerMessageId": "legacy-test-provider-message-admin-confirmed", "subject": "Olá outra vez",
      "body": "Mensagem confirmada pelo administrador", "sentAt": "2026-09-29T11:05:00Z"
    }],
    "jobs": [{
      "id": "legacy-test-job-delivered", "campaignId": "legacy-test-campaign",
      "leadId": "legacy-test-lead", "stepId": "legacy-test-step",
      "mailboxId": "legacy-test-mailbox", "status": "pending",
      "dueAt": "2026-10-01T10:00:00Z", "idempotencyKey": "legacy-test-job-delivered-key",
      "providerMessageId": "legacy-test-provider-message"
    }, {
      "id": "legacy-test-job-unresolved", "campaignId": "legacy-test-campaign",
      "leadId": "legacy-test-lead", "stepId": "legacy-test-step",
      "mailboxId": "legacy-test-mailbox", "status": "pending",
      "dueAt": "2026-10-01T10:05:00Z", "idempotencyKey": "legacy-test-job-unresolved-key"
    }, {
      "id": "legacy-test-job-admin-confirmed", "campaignId": "legacy-test-campaign",
      "leadId": "legacy-test-lead", "stepId": "legacy-test-step",
      "mailboxId": "legacy-test-mailbox", "status": "pending",
      "dueAt": "2026-10-01T10:07:00Z", "idempotencyKey": "legacy-test-job-admin-confirmed-key"
    }, {
      "id": "legacy-test-job-missing-mailbox", "campaignId": "legacy-test-campaign",
      "leadId": "legacy-test-lead", "stepId": "legacy-test-step",
      "mailboxId": "legacy-missing-mailbox", "status": "pending",
      "dueAt": "2026-10-01T10:10:00Z", "idempotencyKey": "legacy-test-job-missing-mailbox-key"
    }],
    "suppressions": [], "audit": []
  }$json$::jsonb
);
select is(
  (private.import_outreach_legacy_snapshot((select snapshot from legacy_snapshot_fixture), false) ->> 'idempotent')::boolean,
  false,
  'importação real executa uma única vez'
);
select ok(exists(
  select 1 from public.outreach_mailboxes
  where legacy_id = 'legacy-test-mailbox' and status = 'disconnected'
    and not send_enabled and daily_limit = 10 and ramp_daily_limit = 1
), 'mailbox importada exige reautorização e começa limitada');
select ok(exists(
  select 1 from public.outreach_campaigns
  where legacy_id = 'legacy-test-campaign' and status = 'paused'
), 'campanha ativa do legado entra pausada');
select ok(
  exists(select 1 from public.outreach_recipients where legacy_id = 'recipient:legacy-test-campaign:legacy-test-lead' and status = 'reconciliation_required')
  and exists(select 1 from public.outreach_jobs where legacy_id = 'legacy-test-job-delivered' and status = 'sent' and provider_message_id='legacy-test-provider-message' and sent_at='2026-09-29T11:00:00Z')
  and exists(select 1 from public.outreach_jobs where legacy_id = 'legacy-test-job-unresolved' and status = 'reconciliation_required')
  and exists(select 1 from public.outreach_jobs where legacy_id = 'legacy-test-job-admin-confirmed' and status = 'reconciliation_required'),
  'import só confirma jobs com providerMessageId e mensagem outbound exata'
);
select ok(
  not exists(select 1 from public.outreach_jobs where legacy_id='legacy-test-job-missing-mailbox')
  and exists(
    select 1
    from private.outreach_import_runs run
    where not run.dry_run
      and (run.counts->>'jobs_ambiguous')::integer=1
      and run.ambiguities @> '[{"legacy_type":"job","legacy_id":"legacy-test-job-missing-mailbox","mailbox_legacy_id":"legacy-missing-mailbox","reason":"mailbox_missing"}]'::jsonb
  ),
  'job legado sem mailbox é isolado e contabilizado sem inventar associação'
);
select ok(
  exists(select 1 from public.outreach_threads where legacy_id = 'legacy-test-thread')
  and exists(select 1 from public.outreach_messages where legacy_id = 'legacy-test-message'),
  'threads e mensagens legadas são normalizadas'
);
select ok(exists(
  select 1 from public.outreach_system_state where id and mode = 'disabled' and not send_enabled
), 'importação real mantém os dois kill switches desligados');
select is(
  (private.import_outreach_legacy_snapshot((select snapshot from legacy_snapshot_fixture), false) ->> 'idempotent')::boolean,
  true,
  'repetição da importação real é idempotente'
);
select is((select count(*)::integer from private.outreach_credentials), 0, 'importador nunca cria credenciais');

select throws_ok(
  $$select private.outreach_adjudicate_job_reconciliation(
    (select id from public.outreach_jobs where legacy_id='legacy-test-job-unresolved'),
    'a0000000-0000-4000-8000-000000000002','cancelled',
    'Ausência confirmada pelo provider','ticket:legacy-provider-case-123',null
  )$$,
  '42501', 'Apenas administradores podem adjudicar jobs ambíguos',
  'viewer não adjudica reconciliação legacy'
);

-- Rebuild the already-proven readiness fixture after the operational disable
-- performed above. Only the unresolved imported job must block promotion.
update public.outreach_jobs
set status='cancelled',lease_owner=null,lease_expires_at=null
where id='f4000000-0000-4000-8000-000000000003';
do $$ begin
  perform private.outreach_transition_system(
    'canary','a0000000-0000-4000-8000-000000000001',false,null
  );
end $$;
update public.outreach_system_state
set canary_started_at=now()-interval '193 hours',
    worker_continuous_since=now()-interval '25 hours',
    worker_last_heartbeat_at=now(),worker_heartbeat_owner='legacy-adjudication-test',
    last_incident_at=now()-interval '193 hours'
where id;
update public.outreach_mailboxes
set ramp_daily_limit=10,ramp_started_at=now()-interval '73 hours',last_incident_at=null
where id='e0000000-0000-4000-8000-000000000001';
update public.outreach_dns_checks
set checked_at=now()
where mailbox_id='e0000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select private.outreach_transition_system(
    'live','a0000000-0000-4000-8000-000000000001',true,null
  )$$,
  'P0001', 'Live exige reconciliação integral de jobs ambíguos',
  'job legacy sem prova bloqueia o gate live'
);
select throws_ok(
  $$select private.outreach_adjudicate_job_reconciliation(
    (select id from public.outreach_jobs where legacy_id='legacy-test-job-admin-confirmed'),
    'a0000000-0000-4000-8000-000000000001','confirmed_sent',
    'Mensagem confirmada no arquivo do provider','ticket:legacy-provider-sent-456',
    'provider-message-out-2'
  )$$,
  'P0001', 'A evidência não corresponde a uma mensagem outbound deste job',
  'adjudicação sent rejeita providerMessageId de outra mailbox/campanha/destinatário'
);
do $$ begin
  perform private.outreach_adjudicate_job_reconciliation(
    (select id from public.outreach_jobs where legacy_id='legacy-test-job-admin-confirmed'),
    'a0000000-0000-4000-8000-000000000001','confirmed_sent',
    'Mensagem confirmada no arquivo do provider','ticket:legacy-provider-sent-456',
    'legacy-test-provider-message-admin-confirmed'
  );
end $$;
select ok(
  exists(
    select 1 from public.outreach_jobs job
    where job.legacy_id='legacy-test-job-admin-confirmed'
      and job.status='sent'
      and job.provider_message_id='legacy-test-provider-message-admin-confirmed'
      and job.sent_at='2026-09-29T11:05:00Z'
  )
  and exists(
    select 1 from private.outreach_job_adjudications adjudication
    join public.outreach_jobs job on job.id=adjudication.job_id
    where job.legacy_id='legacy-test-job-admin-confirmed'
      and adjudication.outcome='confirmed_sent'
      and adjudication.evidence_reference='ticket:legacy-provider-sent-456'
  )
  and exists(
    select 1 from public.outreach_audit_log audit
    join public.outreach_jobs job on job.id=audit.entity_id
    where job.legacy_id='legacy-test-job-admin-confirmed'
      and audit.action='job.reconciliation.adjudicated'
      and audit.details->>'outcome'='confirmed_sent'
      and audit.details ? 'evidence_sha256'
      and audit.details::text not like '%ticket:legacy-provider-sent-456%'
  ),
  'adjudicação sent exige mensagem outbound exata, guarda prova privada e audita apenas hash'
);
do $$ begin
  perform private.outreach_adjudicate_job_reconciliation(
    (select id from public.outreach_jobs where legacy_id='legacy-test-job-unresolved'),
    'a0000000-0000-4000-8000-000000000001','cancelled',
    'Provider confirmou ausência definitiva','ticket:legacy-provider-case-123',null
  );
end $$;
select ok(
  exists(
    select 1 from public.outreach_jobs job
    where job.legacy_id='legacy-test-job-unresolved'
      and job.status='cancelled'
      and job.last_error like 'admin_adjudicated_no_retry:%'
  )
  and exists(
    select 1 from private.outreach_job_adjudications adjudication
    join public.outreach_jobs job on job.id=adjudication.job_id
    where job.legacy_id='legacy-test-job-unresolved'
      and adjudication.outcome='cancelled'
      and adjudication.evidence_reference='ticket:legacy-provider-case-123'
  )
  and exists(
    select 1 from public.outreach_audit_log audit
    join public.outreach_jobs job on job.id=audit.entity_id
    where job.legacy_id='legacy-test-job-unresolved'
      and audit.action='job.reconciliation.adjudicated'
      and audit.details->>'never_requeue'='true'
      and audit.details ? 'evidence_sha256'
      and audit.details::text not like '%ticket:legacy-provider-case-123%'
  ),
  'adjudicação legacy guarda prova privada, audita hash e nunca requeue'
);
insert into public.outreach_jobs(
  id,campaign_id,recipient_id,step_id,mailbox_id,scheduled_at,status,idempotency_key
) values (
  'f4000000-0000-4000-8000-000000000052',
  'f0000000-0000-4000-8000-000000000002',
  'f2000000-0000-4000-8000-000000000003',
  'f1000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001',now(),
  'cancelled','cancelled-with-accepted-ledger'
);
insert into private.outreach_delivery_ledger(
  job_id,mailbox_id,recipient_id,idempotency_key,status,payload_hash,
  provider_message_id
) values (
  'f4000000-0000-4000-8000-000000000052',
  'e0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000003',
  'cancelled-with-accepted-ledger','accepted',decode(repeat('52',32),'hex'),
  'cancelled-with-accepted-ledger-provider'
);
select throws_ok(
  $$select private.outreach_transition_system(
    'live','a0000000-0000-4000-8000-000000000001',true,null
  )$$,
  'P0001', 'Live exige reconciliação integral de jobs ambíguos',
  'ledger não terminal bloqueia live mesmo se o job foi marcado cancelled'
);
update private.outreach_delivery_ledger
set status='reconciled',last_attempt_at=now()
where job_id='f4000000-0000-4000-8000-000000000052';
select is(
  (private.outreach_transition_system(
    'live','a0000000-0000-4000-8000-000000000001',true,null
  )).mode::text,
  'live',
  'adjudicação do último job ambíguo desbloqueia o gate live'
);

insert into public.outreach_jobs(
  id,campaign_id,recipient_id,step_id,mailbox_id,scheduled_at,status,idempotency_key
) values (
  'f4000000-0000-4000-8000-000000000040',
  'f0000000-0000-4000-8000-000000000002',
  'f2000000-0000-4000-8000-000000000003',
  'f1000000-0000-4000-8000-000000000002',
  'e0000000-0000-4000-8000-000000000001',now(),
  'reconciliation_required','persistent-provider-not-found'
);
insert into private.outreach_delivery_ledger(
  job_id,mailbox_id,recipient_id,idempotency_key,status,payload_hash,provider_response
) values (
  'f4000000-0000-4000-8000-000000000040',
  'e0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000003',
  'persistent-provider-not-found','sending',decode(repeat('ef',32),'hex'),
  '{"lastReconciliation":"not_found","reconciliationNotFoundCount":1}'::jsonb
);
select throws_ok(
  $$select private.outreach_adjudicate_job_reconciliation(
    'f4000000-0000-4000-8000-000000000040',
    'a0000000-0000-4000-8000-000000000001','cancelled',
    'Provider ainda sem confirmação suficiente','ticket:provider-case-pending',null
  )$$,
  'P0001', 'O ledger ainda não tem prova persistente de ausência no provider',
  'uma única pesquisa sem match não permite encerrar delivery ambíguo'
);
update private.outreach_delivery_ledger
set provider_response=provider_response||'{"reconciliationNotFoundCount":2}'::jsonb
where job_id='f4000000-0000-4000-8000-000000000040';
do $$ begin
  perform private.outreach_adjudicate_job_reconciliation(
    'f4000000-0000-4000-8000-000000000040',
    'a0000000-0000-4000-8000-000000000001','cancelled',
    'Provider confirmou ausência em pesquisas repetidas','ticket:provider-case-closed',null
  );
end $$;
select ok(
  (select status='cancelled' from public.outreach_jobs where id='f4000000-0000-4000-8000-000000000040')
  and (select status='reconciled' and provider_response->>'adminAdjudication'='cancelled'
       from private.outreach_delivery_ledger where job_id='f4000000-0000-4000-8000-000000000040')
  and exists(select 1 from private.outreach_job_adjudications where job_id='f4000000-0000-4000-8000-000000000040'),
  'not_found persistente só fecha por prova administrativa e nunca volta a pending'
);

-- RGPD deletion redacts Outreach PII, retains only a keyed tombstone and keeps
-- aggregate metrics for operational reporting.
insert into public.outreach_events(
  event_type, campaign_id, mailbox_id, recipient_id, message_id, dimensions
) values (
  'reply_received', 'f0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002',
  'f5000000-0000-4000-8000-000000000004',
  '{"email":"two@two.example"}'::jsonb
);
insert into public.outreach_audit_log(actor_id, action, entity_type, entity_id, details)
values (
  'a0000000-0000-4000-8000-000000000001', 'test', 'contact',
  'c0000000-0000-4000-8000-000000000002',
  '{"email":"two@two.example"}'::jsonb
);
insert into private.outreach_webhook_events(
  provider, provider_event_id, identity_hmac, body_encrypted, signature_valid
) values (
  'rotation-test', 'rotation-v1-webhook',
  (select identity_hmac from public.communication_suppressions where source='key-rotation-test'),
  decode('0102', 'hex'), true
);
insert into private.outreach_inbound_reconciliation(
  mailbox_id, provider_message_id, identity_hmac,
  payload_encrypted, nonce, auth_tag, key_version, kind
) values (
  'e0000000-0000-4000-8000-000000000001', 'rotation-v1-inbound',
  (select identity_hmac from public.communication_suppressions where source='key-rotation-test'),
  decode('0102', 'hex'), decode('0304', 'hex'), decode('0506', 'hex'), 1, 'reply'
);
delete from public.contactos where id = 'c0000000-0000-4000-8000-000000000003';
select ok(
  not exists(select 1 from private.outreach_webhook_events where provider_event_id='rotation-v1-webhook')
  and not exists(select 1 from private.outreach_inbound_reconciliation where provider_message_id='rotation-v1-inbound'),
  'eliminação RGPD remove PII HMAC criada por uma chave histórica'
);
select ok(
  private.outreach_is_suppressed('rotation@example.test', null),
  'tombstone continua a bloquear reimport após rotação e eliminação'
);
insert into private.outreach_inbound_reconciliation(
  id, mailbox_id, provider_message_id, identity_hmac,
  payload_encrypted, nonce, auth_tag, key_version, kind
) values (
  'f6000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'ambiguous-provider-message',
  private.outreach_identity_hmac('two@two.example'),
  decode('0102', 'hex'), decode('0304', 'hex'), decode('0506', 'hex'), 1,
  'reply'
);
delete from public.contactos where id = 'c0000000-0000-4000-8000-000000000002';
select ok(
  not exists (select 1 from public.outreach_recipients where id = 'f2000000-0000-4000-8000-000000000002')
  and not exists (select 1 from public.outreach_messages where recipient_id = 'f2000000-0000-4000-8000-000000000002')
  and not exists (select 1 from public.outreach_threads where recipient_id = 'f2000000-0000-4000-8000-000000000002')
  and not exists (select 1 from public.outreach_jobs where recipient_id = 'f2000000-0000-4000-8000-000000000002'),
  'eliminação remove linhas operacionais pseudónimas'
);
select ok(not exists(
  select 1 from public.outreach_email_verifications
  where lower(email::text) = 'two@two.example'
), 'eliminação remove verificação de email');
select ok(not exists(
  select 1 from private.outreach_inbound_reconciliation
  where identity_hmac = private.outreach_identity_hmac('two@two.example')
), 'eliminação remove payload inbound cifrado ainda correlacionável');
select ok(not exists(
  select 1 from public.outreach_events
  where dimensions::text like '%two@two.example%'
), 'eliminação remove eventos com PII');
select ok(exists(
  select 1 from public.outreach_audit_log
  where action = 'test' and entity_id is null
    and details = '{"redacted":true,"reason":"contact_deleted"}'::jsonb
), 'auditoria é preservada apenas de forma redigida');
select ok(not exists(
  select 1 from private.outreach_provider_message_ledger
  where provider_message_id in (
    'cross-sync-outbound-message','cross-sync-provider-message',
    'outreach-preclaimed-message','provider-message-out-1','provider-message-out-2',
    'provider-message-auto','provider-message-reply'
  )
) and not exists(
  select 1 from private.communication_provider_message_ledger
  where provider_message_id in (
    'cross-sync-outbound-message','cross-sync-provider-message',
    'outreach-preclaimed-message','provider-message-out-1','provider-message-out-2',
    'provider-message-auto','provider-message-reply'
  )
), 'identificadores do provider são removidos');
select ok(exists(
  select 1 from public.communication_suppressions
  where reason = 'contact_deleted' and identity_hmac is not null
    and email is null and domain is null and company_id is null
), 'eliminação preserva apenas tombstone HMAC');
select ok(exists(
  select 1 from public.outreach_metric_daily
  where campaign_id = 'f0000000-0000-4000-8000-000000000001'
), 'métricas agregadas sobrevivem à eliminação');

select * from finish();
rollback;
