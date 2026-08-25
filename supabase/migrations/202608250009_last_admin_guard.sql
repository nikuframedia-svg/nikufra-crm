begin;

-- Access changes already require an active administrator. This additional
-- invariant prevents concurrent updates from leaving the CRM without any
-- active administrator able to invite or recover the team.
create or replace function public.protect_profile_security_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and
     (new.role is distinct from old.role or
      new.ativo is distinct from old.ativo or
      new.email is distinct from old.email) then
    raise exception 'Só um administrador pode alterar role, estado ou email';
  end if;

  if old.role = 'admin' and old.ativo and
     (new.role <> 'admin' or not new.ativo) then
    perform pg_advisory_xact_lock(hashtextextended('nikufra:last-active-admin', 0));
    if not exists (
      select 1 from public.profiles
      where id <> old.id and role = 'admin' and ativo
    ) then
      raise exception 'O CRM tem de manter pelo menos um administrador ativo';
    end if;
  end if;

  return new;
end $$;

revoke execute on function public.protect_profile_security_fields() from public, anon, authenticated;

commit;
