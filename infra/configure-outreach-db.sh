#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
profile="${1:-production}"

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
[[ -n "${OUTREACH_DATABASE_PASSWORD:-}" ]] || { echo "OUTREACH_DATABASE_PASSWORD em falta." >&2; exit 1; }
[[ -n "${POSTGRES_PASSWORD:-}" ]] || { echo "POSTGRES_PASSWORD em falta." >&2; exit 1; }

case "${profile}" in
  local)
    COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.local.yml")
    ;;
  production)
    COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
    ;;
  *)
    echo "Uso: $0 {local|production}" >&2
    exit 2
    ;;
esac

"${COMPOSE[@]}" exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" db \
  psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  --set=outreach_pass="${OUTREACH_DATABASE_PASSWORD}" <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'outreach_service') then
    create role outreach_service;
  end if;
end $$;
-- Re-assert every security attribute on every deploy. An accidentally or
-- maliciously elevated pre-existing role must never keep SUPERUSER,
-- BYPASSRLS, INHERIT or role/database creation privileges.
alter role outreach_service noinherit login nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
select format('alter role outreach_service password %L', :'outreach_pass') \gexec
grant connect on database postgres to outreach_service;
alter role outreach_service set statement_timeout = '30s';
alter role outreach_service set lock_timeout = '20s';

-- Role attributes alone are insufficient: membership of an elevated role
-- would still permit SET ROLE.  The service role must be completely standalone.
select format('revoke %I from outreach_service', parent.rolname)
from pg_auth_members membership
join pg_roles parent on parent.oid = membership.roleid
join pg_roles child on child.oid = membership.member
where child.rolname = 'outreach_service'
\gexec

do $$
begin
  if not exists (
    select 1 from pg_roles
    where rolname = 'outreach_service'
      and rolcanlogin and not rolsuper and not rolinherit and not rolbypassrls
      and not rolcreatedb and not rolcreaterole and not rolreplication
      and not exists (
        select 1 from pg_auth_members membership
        where membership.member = pg_roles.oid
      )
  ) then
    raise exception 'outreach_service role hardening verification failed';
  end if;
end $$;
SQL

echo "Role PostgreSQL outreach_service configurada com privilégios mínimos."
