#!/usr/bin/env bash
set -Eeuo pipefail

# Install this operator script beside the persistent infra directory. It uses
# the currently deployed Compose files and database function for each step.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_INFRA="${NIKUFRA_CURRENT_INFRA:-${SCRIPT_DIR}/../current/infra}"
target="${1:-}"
actor_id="${2:-}"

case "${target}" in
  15|20|25) ;;
  *) echo "Uso: $0 {15|20|25} <admin-uuid>" >&2; exit 2 ;;
esac
[[ "${actor_id}" =~ ^[0-9a-fA-F-]{36}$ ]] || {
  echo "Falta um UUID de administrador CRM válido." >&2
  exit 2
}
[[ -f "${CURRENT_INFRA}/.env" ]] || {
  echo "Não foi encontrado o ambiente da release atual." >&2
  exit 1
}

COMPOSE=(docker compose --env-file "${CURRENT_INFRA}/.env"
  -f "${CURRENT_INFRA}/docker-compose.yml"
  -f "${CURRENT_INFRA}/docker-compose.production.yml")

"${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  --set="target=${target}" --set="actor=${actor_id}" <<'SQL'
begin;
select set_config('outreach.target_level', :'target', true);
select set_config('outreach.actor_id', :'actor', true);
do $$
declare
  mailbox_id uuid;
  target_level integer := current_setting('outreach.target_level')::integer;
  expected_level integer := target_level - 5;
  admin_id uuid := current_setting('outreach.actor_id')::uuid;
begin
  if not exists (
    select 1 from public.outreach_campaigns
    where id = '01497165-e76f-4e6f-983f-d84e41c5f50c'
      and status = 'running' and daily_limit >= 75
  ) then
    raise exception 'A campanha principal não está preparada para 75/dia';
  end if;
  if (
    select count(*) from public.outreach_mailboxes
    where email in ('mia@getnikufra.com','maria@getnikufra.com','marta@getnikufra.com')
      and daily_limit = 25 and ramp_daily_limit = expected_level
  ) <> 3 then
    raise exception 'As três mailboxes não estão no patamar esperado %', expected_level;
  end if;

  for mailbox_id in
    select id from public.outreach_mailboxes
    where email in ('mia@getnikufra.com','maria@getnikufra.com','marta@getnikufra.com')
    order by email
  loop
    perform private.outreach_advance_mailbox_live_ramp(mailbox_id, admin_id);
  end loop;
end;
$$;
commit;
select email, daily_limit, ramp_daily_limit,
       least(daily_limit,ramp_daily_limit) as effective_daily_limit
from public.outreach_mailboxes
where email in ('mia@getnikufra.com','maria@getnikufra.com','marta@getnikufra.com')
order by email;
SQL
