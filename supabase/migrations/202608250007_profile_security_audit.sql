begin;

-- Fail closed even if a future policy accidentally widens profile updates:
-- only an active administrator may ever change access-control fields.
create or replace function public.protect_profile_security_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and
     (new.role is distinct from old.role or
      new.ativo is distinct from old.ativo or
      new.email is distinct from old.email) then
    raise exception 'Só um administrador pode alterar role, estado ou email';
  end if;
  return new;
end $$;

create or replace function public.audit_profile_security_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role or
     new.ativo is distinct from old.ativo or
     new.email is distinct from old.email then
    insert into public.audit_log(actor_id, tabela, registo_id, acao, alteracoes)
    values (
      auth.uid(),
      'profiles',
      new.id,
      'UPDATE',
      jsonb_build_object(
        'role_anterior', old.role,
        'role_novo', new.role,
        'ativo_anterior', old.ativo,
        'ativo_novo', new.ativo,
        'email_alterado', new.email is distinct from old.email
      )
    );
  end if;
  return new;
end $$;

drop trigger if exists audit_profile_security_changes on public.profiles;
create trigger audit_profile_security_changes
after update on public.profiles
for each row execute function public.audit_profile_security_changes();

revoke execute on function public.protect_profile_security_fields() from public, anon, authenticated;
revoke execute on function public.audit_profile_security_changes() from public, anon, authenticated;

commit;
