#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
BACKUP_ROOT="${NIKUFRA_BACKUP_ROOT:-/home/luis/services/nikufra-crm/backups}"

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
[[ -n "${WAL_ARCHIVE_PASSWORD:-}" ]] || { echo "WAL_ARCHIVE_PASSWORD em falta; executa configure-backups.sh." >&2; exit 1; }
[[ -n "${POSTGRES_PASSWORD:-}" ]] || { echo "POSTGRES_PASSWORD em falta." >&2; exit 1; }

mkdir -p "${BACKUP_ROOT}/wal" "${BACKUP_ROOT}/wal-encrypted" "${BACKUP_ROOT}/base"
chmod 700 "${BACKUP_ROOT}/wal" "${BACKUP_ROOT}/wal-encrypted" "${BACKUP_ROOT}/base"

"${COMPOSE[@]}" exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" db \
  psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  --set=wal_pass="${WAL_ARCHIVE_PASSWORD}" <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nikufra_wal') then
    create role nikufra_wal;
  end if;
end $$;
alter role nikufra_wal noinherit login replication nosuperuser nobypassrls nocreatedb nocreaterole;
select format('alter role nikufra_wal password %L', :'wal_pass') \gexec

-- A replication login must not inherit or SET ROLE into anything else.
select format('revoke %I from nikufra_wal', parent.rolname)
from pg_auth_members membership
join pg_roles parent on parent.oid = membership.roleid
join pg_roles child on child.oid = membership.member
where child.rolname = 'nikufra_wal'
\gexec

do $$
begin
  if not exists (
    select 1 from pg_roles
    where rolname = 'nikufra_wal'
      and rolcanlogin and rolreplication and not rolsuper and not rolinherit
      and not rolbypassrls and not rolcreatedb and not rolcreaterole
      and not exists (
        select 1 from pg_auth_members membership
        where membership.member = pg_roles.oid
      )
  ) then
    raise exception 'nikufra_wal role hardening verification failed';
  end if;
end $$;

-- PostgreSQL's parsed view is the authority: fail before starting the WAL
-- receiver if the intended rule is missing, duplicated or rejected. Compare
-- the database and role arrays directly so broader lists cannot pass.
do $$
declare
  matching_hba_rules bigint;
begin
  if exists (select 1 from pg_hba_file_rules where error is not null) then
    raise exception 'pg_hba.conf contains invalid rules';
  end if;

  select count(*)
  into matching_hba_rules
  from pg_hba_file_rules
  where type = 'host'
    and database = array['replication']::text[]
    and user_name = array['nikufra_wal']::text[]
    and address = 'samenet'
    and netmask is null
    and auth_method = 'scram-sha-256'
    and coalesce(cardinality(options), 0) = 0
    and error is null;

  if matching_hba_rules <> 1 then
    raise exception 'nikufra_wal HBA verification failed: expected one rule, found %',
      matching_hba_rules;
  end if;
end $$;
SQL

echo "Role de replicação e diretórios PITR preparados."
