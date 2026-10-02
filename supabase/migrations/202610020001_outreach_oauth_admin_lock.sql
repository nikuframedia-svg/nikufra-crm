begin;

-- OAuth callbacks must keep the approving admin stable until credentials are
-- stored. The API role can read profiles but cannot lock them directly without
-- the broad UPDATE privilege, so lock the one authorized row as the owner.
create function private.outreach_lock_active_admin(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.profiles
  where id = p_profile_id and ativo and role = 'admin'
  for share;
  return found;
end;
$$;

revoke all on function private.outreach_lock_active_admin(uuid)
from public, anon, authenticated;
grant execute on function private.outreach_lock_active_admin(uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'outreach_service') then
    execute 'grant execute on function private.outreach_lock_active_admin(uuid) to outreach_service';
  end if;
end $$;

commit;
