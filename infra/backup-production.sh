#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
BACKUP_ROOT="${NIKUFRA_BACKUP_ROOT:-/home/luis/services/nikufra-crm/backups}"
DAILY_DIR="${BACKUP_ROOT}/daily"
MONTHLY_DIR="${BACKUP_ROOT}/monthly"
LOCK_FILE="${BACKUP_ROOT}/.backup.lock"
FORCE_MONTHLY=false

if [[ "${1:-}" == "--monthly" ]]; then FORCE_MONTHLY=true
elif [[ -n "${1:-}" ]]; then echo "Uso: $0 [--monthly]" >&2; exit 2
fi

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}" >&2; exit 1; }
mkdir -p "${DAILY_DIR}" "${MONTHLY_DIR}"
chmod 700 "${BACKUP_ROOT}" "${DAILY_DIR}" "${MONTHLY_DIR}"
exec 9>"${LOCK_FILE}"
flock -n 9 || { echo "Já existe um backup em execução" >&2; exit 1; }

stamp="$(date -u +%F)"
month="$(date -u +%Y-%m)"
partial="${DAILY_DIR}/.nikufra-${stamp}.partial"
daily="${DAILY_DIR}/nikufra-${stamp}.dump"
trap 'rm -f -- "${partial}"' EXIT

"${COMPOSE[@]}" exec -T db pg_dump -U postgres -d postgres -Fc --no-owner --no-acl > "${partial}"
"${COMPOSE[@]}" exec -T db pg_restore --list < "${partial}" >/dev/null
chmod 600 "${partial}"
mv -- "${partial}" "${daily}"
sha256sum "${daily}" > "${daily}.sha256"
chmod 600 "${daily}.sha256"

if [[ "$(date -u +%d)" == "01" || "${FORCE_MONTHLY}" == "true" ]]; then
  monthly="${MONTHLY_DIR}/nikufra-${month}.dump"
  cp --preserve=mode,timestamps "${daily}" "${monthly}"
  sha256sum "${monthly}" > "${monthly}.sha256"
  chmod 600 "${monthly}" "${monthly}.sha256"
fi

find "${DAILY_DIR}" -maxdepth 1 -type f \( -name 'nikufra-*.dump' -o -name 'nikufra-*.dump.sha256' \) -mtime +31 -delete
find "${MONTHLY_DIR}" -maxdepth 1 -type f \( -name 'nikufra-*.dump' -o -name 'nikufra-*.dump.sha256' \) -mtime +400 -delete

size="$(du -h "${daily}" | awk '{ print $1 }')"
echo "Backup ${daily} verificado (${size})"
