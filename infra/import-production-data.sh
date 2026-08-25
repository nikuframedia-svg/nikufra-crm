#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
DUMP_FILE="${1:-}"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
SERVICES=(db auth rest realtime kong functions)

if [[ -z "${DUMP_FILE}" || ! -f "${DUMP_FILE}" ]]; then
  echo "Uso: $0 /caminho/para/nikufra-crm-data.dump" >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Falta ${ENV_FILE}." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

"${COMPOSE[@]}" up -d --wait db auth
db_container="$("${COMPOSE[@]}" ps -q db)"
company_count="$(docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${db_container}" psql -U supabase_admin -d postgres -Atc "select count(*) from public.empresas" 2>/dev/null || echo 0)"
if [[ "${company_count}" != "0" && "${NIKUFRA_ALLOW_DATA_REPLACE:-}" != "replace-production-data" ]]; then
  echo "A produção já contém ${company_count} empresas. Importação recusada sem confirmação explícita." >&2
  exit 1
fi

backup_dir="${SCRIPT_DIR}/backups"
backup_stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
backup_container="/tmp/nikufra-before-import-${backup_stamp}.dump"
backup_host="${backup_dir}/nikufra-before-import-${backup_stamp}.dump"
install -d -m 700 "${backup_dir}"
docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${db_container}" pg_dump -U supabase_admin -d postgres -Fc -f "${backup_container}"
docker cp "${db_container}:${backup_container}" "${backup_host}"
docker exec "${db_container}" unlink "${backup_container}"
chmod 600 "${backup_host}"

"${COMPOSE[@]}" stop functions kong realtime rest auth

restore_container="/tmp/nikufra-production-data.dump"
docker cp "${DUMP_FILE}" "${db_container}:${restore_container}"
docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD}" "${db_container}" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres <<'SQL'
do $$
declare tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into tables
  from pg_tables
  where schemaname in ('public', 'auth');
  execute 'truncate table ' || tables || ' restart identity cascade';
end $$;
SQL
docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${db_container}" \
  pg_restore --data-only --disable-triggers --exit-on-error -U supabase_admin -d postgres "${restore_container}"
docker exec "${db_container}" unlink "${restore_container}"

"${COMPOSE[@]}" up -d --wait "${SERVICES[@]}"
"${SCRIPT_DIR}/production-healthcheck.sh"

docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${db_container}" psql -U supabase_admin -d postgres -P pager=off -c \
  "select (select count(*) from public.empresas) empresas, (select count(*) from public.contactos) contactos, (select count(*) from public.oportunidades) oportunidades, (select count(*) from auth.users) utilizadores, (select count(*) from public.google_tokens) contas_google;"

echo "Importação concluída. Backup anterior preservado em ${backup_host}."
