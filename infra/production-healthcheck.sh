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
for service in db auth rest realtime kong functions; do
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

if curl --fail --silent -H "apikey: ${ANON_KEY}" "http://127.0.0.1:${CRM_API_PORT}/rest/v1/profiles?select=id&limit=0" >/dev/null; then
  echo "OK   REST API"
else
  echo "FAIL REST API"
  status=1
fi

exit "${status}"
