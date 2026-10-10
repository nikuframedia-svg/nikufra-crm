begin;
create extension if not exists pgtap;
select plan(17);

select has_table('public', 'meeting_outcomes', 'resultados de reuniões têm tabela canónica');
select has_type('public', 'meeting_outcome_type', 'resultados usam enum validado');
select has_function(
  'public',
  'meeting_metrics',
  array['timestamp with time zone','timestamp with time zone','text','uuid','text','text'],
  'RPC agregada de reuniões existe'
);
select has_function(
  'private',
  'invoke_google_calendar_sync',
  array[]::text[],
  'sincronização Calendar tem invocação leve independente'
);
select ok(
  exists(select 1 from cron.job where jobname = 'nikufra-calendar-sync'),
  'Calendar fica sincronizado automaticamente sem depender do backfill Gmail'
);
select policies_are(
  'public',
  'meeting_outcomes',
  array['meeting_outcomes_read','meeting_outcomes_insert','meeting_outcomes_update'],
  'resultados estão protegidos por RLS explícita'
);
select has_column('public', 'google_calendar_events', 'occurrence_key', 'eventos têm chave canónica');
select ok(
  (
    select pg_get_expr(index.indpred, index.indrelid) is null
    from pg_index index
    join pg_class relation on relation.oid = index.indexrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'atividades_mailbox_provider_message_unique'
  ),
  'índice Gmail usado por ON CONFLICT deixou de ser parcial'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.meeting_metrics(timestamp with time zone,timestamp with time zone,text,uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.meeting_metrics(timestamp with time zone,timestamp with time zone,text,uuid,text,text)',
    'EXECUTE'
  ),
  'apenas authenticated recebe EXECUTE na RPC'
);

-- In a populated database the first synthetic user is not the bootstrap
-- administrator, so create the same invitation a real administrator would.
-- Fresh isolated schemas have no inviter yet and exercise first-admin setup.
do $$
declare
  inviter_id uuid;
begin
  select id into inviter_id from public.profiles where ativo order by created_at limit 1;
  if inviter_id is not null then
    insert into public.user_invitations(email, nome, invited_by)
    values ('meeting-one@nikufra.ai', 'Meeting One', inviter_id)
    on conflict (email) do nothing;
  end if;
end;
$$;

insert into auth.users(id, email, raw_user_meta_data, created_at, updated_at)
values ('d1000000-0000-4000-8000-000000000001', 'meeting-one@nikufra.ai', '{"nome":"Meeting One"}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.user_invitations(email, nome, invited_by)
values
  ('meeting-two@nikufra.ai', 'Meeting Two', 'd1000000-0000-4000-8000-000000000001'),
  ('meeting-inactive@nikufra.ai', 'Meeting Inactive', 'd1000000-0000-4000-8000-000000000001')
on conflict (email) do nothing;

insert into auth.users(id, email, raw_user_meta_data, created_at, updated_at)
values
  ('d1000000-0000-4000-8000-000000000002', 'meeting-two@nikufra.ai', '{"nome":"Meeting Two"}'::jsonb, now(), now()),
  ('d1000000-0000-4000-8000-000000000003', 'meeting-inactive@nikufra.ai', '{"nome":"Meeting Inactive"}'::jsonb, now(), now())
on conflict (id) do nothing;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from public.profiles where ativo and role = 'admin' order by created_at limit 1),
  true
);
update public.profiles
set ativo = id in (
  'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002'
)
where id in (
  'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000003'
);

insert into public.google_calendar_events(
  user_id, google_event_id, titulo, inicio, fim, estado,
  ical_uid, occurrence_key, original_start, event_type,
  self_response_status, organizer_is_self,
  internal_human_count, external_human_count, resource_count,
  dia_inteiro, privado, cancelled_at, google_updated_at
)
values
  -- The same invitation in two calendars: one meeting, two participations.
  ('d1000000-0000-4000-8000-000000000001', 'external-shared', 'Cliente A', '2099-10-05 09:00+01', '2099-10-05 10:00+01', 'confirmed', 'shared@google', 'shared@google', '2099-10-05 09:00+01', 'default', 'accepted', true, 1, 1, 0, false, false, null, null),
  ('d1000000-0000-4000-8000-000000000002', 'external-shared', 'Cliente A', '2099-10-05 09:00+01', '2099-10-05 10:00+01', 'confirmed', 'shared@google', 'shared@google', '2099-10-05 09:00+01', 'default', 'accepted', false, 1, 1, 0, false, false, null, null),
  -- Internal meeting also appears in both calendars.
  ('d1000000-0000-4000-8000-000000000001', 'internal-shared', 'Equipa', '2099-10-07 10:00+01', '2099-10-07 11:00+01', 'confirmed', 'internal@google', 'internal@google', '2099-10-07 10:00+01', 'default', 'accepted', true, 2, 0, 0, false, false, null, null),
  ('d1000000-0000-4000-8000-000000000002', 'internal-shared', 'Equipa', '2099-10-07 10:00+01', '2099-10-07 11:00+01', 'confirmed', 'internal@google', 'internal@google', '2099-10-07 10:00+01', 'default', 'accepted', false, 2, 0, 0, false, false, null, null),
  -- Personal, declined, all-day and pre-classification legacy rows are excluded.
  ('d1000000-0000-4000-8000-000000000001', 'personal', 'Bloco pessoal', '2099-10-05 11:00+01', '2099-10-05 12:00+01', 'confirmed', 'personal@google', 'personal@google::2099-10-05T10:00:00.000Z', '2099-10-05 11:00+01', 'default', 'accepted', true, 1, 0, 0, false, false, null, null),
  ('d1000000-0000-4000-8000-000000000001', 'declined', 'Recusada', '2099-10-05 12:00+01', '2099-10-05 13:00+01', 'confirmed', 'declined@google', 'declined@google::2099-10-05T11:00:00.000Z', '2099-10-05 12:00+01', 'default', 'declined', false, 1, 1, 0, false, false, null, null),
  ('d1000000-0000-4000-8000-000000000001', 'all-day', 'Feriado', '2099-10-05 00:00+01', '2099-10-06 00:00+01', 'confirmed', 'all-day@google', 'all-day@google::2099-10-04T23:00:00.000Z', '2099-10-05 00:00+01', 'default', 'accepted', true, 1, 1, 0, true, false, null, null),
  ('d1000000-0000-4000-8000-000000000001', 'legacy', 'Sem classificação', '2099-10-05 14:00+01', '2099-10-05 15:00+01', 'confirmed', null, null, null, 'default', null, false, 0, 1, 0, false, false, null, null),
  -- Private meetings remain measurable because the sync stores only "Ocupado"
  -- as their title. A zero-length calendar block is never a meeting.
  ('d1000000-0000-4000-8000-000000000001', 'private-external', 'Ocupado', '2099-10-07 15:00+01', '2099-10-07 16:00+01', 'confirmed', 'private@google', 'private@google', '2099-10-07 15:00+01', 'default', 'accepted', true, 1, 1, 0, false, true, null, null),
  ('d1000000-0000-4000-8000-000000000001', 'zero-duration', 'Bloco vazio', '2099-10-07 17:00+01', '2099-10-07 17:00+01', 'confirmed', 'zero@google', 'zero@google', '2099-10-07 17:00+01', 'default', 'accepted', true, 1, 1, 0, false, false, null, null),
  -- Cancellation remains available for the cancellation series, but does not
  -- inflate meeting_count or participation_count.
  ('d1000000-0000-4000-8000-000000000001', 'cancelled', 'Cancelada', '2099-10-06 09:00+01', '2099-10-06 10:00+01', 'cancelled', 'cancelled@google', 'cancelled@google', '2099-10-06 09:00+01', 'default', 'accepted', true, 1, 1, 0, false, false, '2099-10-04 09:00+01', null),
  -- During a reschedule, team calendars can briefly disagree on the start.
  -- The occurrence remains one meeting and uses the newest observed start.
  ('d1000000-0000-4000-8000-000000000001', 'rescheduled-old', 'Reagendada', '2099-11-06 09:00+00', '2099-11-06 10:00+00', 'confirmed', 'rescheduled@google', 'rescheduled@google', '2099-11-06 09:00+00', 'default', 'accepted', true, 1, 1, 0, false, false, null, '2099-11-04 10:00+00'),
  ('d1000000-0000-4000-8000-000000000002', 'rescheduled-new', 'Reagendada', '2099-11-05 09:00+00', '2099-11-05 10:00+00', 'confirmed', 'rescheduled@google', 'rescheduled@google', '2099-11-06 09:00+00', 'default', 'accepted', false, 1, 1, 0, false, false, null, '2099-11-04 11:00+00');

insert into public.meeting_outcomes(
  occurrence_key, outcome, source, created_by, updated_by, confirmed_by
)
values
  ('shared@google', 'held', 'manual', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001'),
  ('internal@google', 'scheduled', 'manual', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

select results_eq(
  $$select * from public.meeting_metrics(
    '2099-10-05 00:00+01', '2099-10-09 00:00+01', 'day', null, 'external', 'Europe/Lisbon'
  )$$,
  $$values
    ('2099-10-05'::date, 1::bigint, 2::bigint, 0::bigint, 1::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint),
    ('2099-10-06'::date, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 1::bigint, 0::bigint, 0::bigint, 0::bigint),
    ('2099-10-07'::date, 1::bigint, 1::bigint, 1::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint),
    ('2099-10-08'::date, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint)
  $$,
  'equipa é deduplicada, cancelamentos são separados, privados contam e dias vazios são preenchidos'
);

select is(
  (
    select participation_count
    from public.meeting_metrics(
      '2099-10-05 00:00+01', '2099-10-06 00:00+01', 'day',
      'd1000000-0000-4000-8000-000000000001', 'external', 'Europe/Lisbon'
    )
  ),
  1::bigint,
  'filtro por pessoa conta apenas a participação dessa pessoa'
);

select results_eq(
  $$select meeting_count, participation_count, scheduled_count
    from public.meeting_metrics(
      '2099-10-07 00:00+01', '2099-10-08 00:00+01', 'day', null, 'internal', 'Europe/Lisbon'
    )$$,
  $$values (1::bigint, 2::bigint, 1::bigint)$$,
  'reuniões internas são opt-in e deduplicadas'
);

select results_eq(
  $$select bucket_start, meeting_count, participation_count
    from public.meeting_metrics(
      '2099-11-05 00:00+00', '2099-11-07 00:00+00', 'day', null, 'external', 'Europe/Lisbon'
    )
    where meeting_count > 0$$,
  $$values ('2099-11-05'::date, 1::bigint, 2::bigint)$$,
  'reagendamento divergente continua único e preserva ambas as participações'
);

select is(
  (
    select coalesce(sum(meeting_count), 0)
    from public.meeting_metrics(
      '2099-11-06 00:00+00', '2099-11-07 00:00+00', 'day', null, 'external', 'Europe/Lisbon'
    )
  ),
  0::numeric,
  'cópia antiga fora da data canónica não duplica a reunião no período seguinte'
);

select throws_ok(
  $$select * from public.meeting_metrics(now() - interval '1 day', now(), 'quarter', null, 'all', 'Europe/Lisbon')$$,
  '22023',
  'A granularidade deve ser day, week ou month',
  'granularidade inválida falha de forma explícita'
);

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
select is(
  (
    select coalesce(sum(meeting_count), 0)
    from public.meeting_metrics(
      '2099-10-05 00:00+01', '2099-10-09 00:00+01', 'day', null, 'all', 'Europe/Lisbon'
    )
  ),
  0::numeric,
  'perfil inativo não lê métricas por security invoker/RLS'
);
select is(
  (select count(*) from public.meeting_outcomes),
  0::bigint,
  'perfil inativo não lê resultados manuais'
);

reset role;
select * from finish();
rollback;
