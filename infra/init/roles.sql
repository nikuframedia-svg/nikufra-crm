-- Corre depois do bootstrap assinado que cria estas roles reservadas.
-- A password nunca fica neste ficheiro: é lida do ambiente do contentor.
\set pgpass `echo "$POSTGRES_PASSWORD"`

alter user authenticator with password :'pgpass';
alter user pgbouncer with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
alter user supabase_storage_admin with password :'pgpass';
