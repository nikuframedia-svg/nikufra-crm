#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

CRM_API_PORT="${CRM_API_PORT:-8800}"

status=0
for service in db auth rest realtime kong functions outreach-api outreach-worker wal-archive; do
  if [[ "$("${COMPOSE[@]}" ps --status running --services "${service}")" != "${service}" ]]; then
    echo "FAIL ${service}: não está running"
    status=1
  else
    echo "OK   ${service}"
  fi
done

if curl --fail --silent -H "apikey: ${ANON_KEY}" "http://127.0.0.1:${CRM_API_PORT}/auth/v1/health" >/dev/null; then
  echo "OK   auth API"
else
  echo "FAIL auth API"
  status=1
fi

if curl --fail --silent "http://127.0.0.1:${OUTREACH_API_PORT:-8787}/healthz" >/dev/null; then
  echo "OK   Outreach API"
else
  echo "FAIL Outreach API"
  status=1
fi

if "${COMPOSE[@]}" exec -T outreach-worker node -e \
  "fetch('http://127.0.0.1:8788/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
  echo "OK   Outreach worker"
else
  echo "FAIL Outreach worker"
  status=1
fi

slot_snapshot="$("${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -AtF '|' -c \
  "select active, wal_status, coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn), 0)::bigint, safe_wal_size, current_setting('max_slot_wal_keep_size') from pg_replication_slots where slot_name='nikufra_offsite' and slot_type='physical'" 2>/dev/null || true)"
IFS='|' read -r slot_active slot_status slot_lag slot_safe slot_limit <<<"${slot_snapshot}"
min_slot_safe="${WAL_SLOT_MIN_SAFE_BYTES:-536870912}"
if [[ "${slot_active:-}" == t \
  && "${slot_status:-}" =~ ^(reserved|extended)$ \
  && "${slot_lag:-}" =~ ^[0-9]+$ \
  && "${slot_safe:-}" =~ ^[0-9]+$ \
  && "${min_slot_safe}" =~ ^[0-9]+$ \
  && "${slot_safe}" -ge "${min_slot_safe}" \
  && "${slot_limit:-}" != -1 ]]; then
  echo "OK   WAL slot ativo (${slot_status}, retained=${slot_lag}B, safe=${slot_safe}B, limit=${slot_limit})"
else
  echo "FAIL WAL slot não está seguro (active=${slot_active:-missing}, status=${slot_status:-missing}, retained=${slot_lag:-missing}B, safe=${slot_safe:-missing}B, limit=${slot_limit:-missing})"
  status=1
fi

db_disk_used="$("${COMPOSE[@]}" exec -T db df -P /var/lib/postgresql/data 2>/dev/null | awk 'NR==2 {gsub("%", "", $5); print $5}' || true)"
if [[ "${db_disk_used}" =~ ^[0-9]+$ ]] && (( db_disk_used < 80 )); then
  echo "OK   volume PostgreSQL abaixo de 80% (${db_disk_used}%)"
else
  echo "FAIL volume PostgreSQL sem margem segura (${db_disk_used:-desconhecido}%)"
  status=1
fi

if curl --fail --silent \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  "http://127.0.0.1:${CRM_API_PORT}/rest/v1/profiles?select=id&limit=0" >/dev/null; then
  echo "OK   REST API"
else
  echo "FAIL REST API"
  status=1
fi

exit "${status}"
