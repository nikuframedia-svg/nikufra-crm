begin;

create or replace function public.delete_billing_entry(target_entry_id uuid, actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_entry public.faturacao%rowtype;
begin
  if not exists (
    select 1 from public.profiles
    where id = actor_user_id and ativo and role = 'admin'
  ) then
    raise exception 'Apenas administradores podem apagar lançamentos';
  end if;

  delete from public.faturacao
  where id = target_entry_id
  returning * into deleted_entry;
  if not found then raise exception 'Lançamento não encontrado'; end if;

  insert into public.audit_log(actor_id, tabela, registo_id, acao, alteracoes)
  values (actor_user_id, 'faturacao', target_entry_id, 'DELETE', jsonb_build_object('anterior', to_jsonb(deleted_entry)));

  return jsonb_build_object('deleted', true, 'id', target_entry_id);
end;
$$;

revoke all on function public.delete_billing_entry(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_billing_entry(uuid, uuid) to service_role;

commit;
