do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then
    create role supabase_realtime_admin noinherit nologin;
  end if;
end $$;

create schema if not exists _realtime;
alter schema _realtime owner to supabase_admin;
