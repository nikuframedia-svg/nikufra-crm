-- Corre depois do bootstrap assinado que cria estas roles reservadas.
-- A password nunca fica neste ficheiro: é lida do ambiente do contentor.
\set pgpass `echo "$POSTGRES_PASSWORD"`

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_functions_admin') then
    create role supabase_functions_admin noinherit login createrole;
  end if;
end $$;

alter user authenticator with password :'pgpass';
alter user pgbouncer with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
alter user supabase_storage_admin with password :'pgpass';
alter user supabase_functions_admin with password :'pgpass';
