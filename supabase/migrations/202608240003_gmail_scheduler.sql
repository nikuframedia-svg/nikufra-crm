begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.invoke_gmail_sync()
returns void language plpgsql security definer set search_path = private, public, vault, net as $$
declare
  sync_url text;
  service_key text;
begin
  select decrypted_secret into sync_url from vault.decrypted_secrets where name = 'gmail_sync_url';
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'gmail_sync_service_key';
  if sync_url is null or service_key is null then
    raise warning 'gmail_sync_url ou gmail_sync_service_key ainda não configurado no Vault';
    return;
  end if;
  perform net.http_post(
    url := sync_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end $$;

do $$
begin
  if exists(select 1 from cron.job where jobname = 'nikufra-gmail-sync') then
    perform cron.unschedule('nikufra-gmail-sync');
  end if;
  perform cron.schedule('nikufra-gmail-sync', '*/15 * * * *', 'select private.invoke_gmail_sync()');
end $$;

commit;
