#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
BACKUP_DIR="${SCRIPT_DIR}/backups"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
BACKUP_FILE="${BACKUP_DIR}/nikufra-crm-${STAMP}.dump.gz"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Falta ${ENV_FILE}. Copia .env.example, gera segredos e aplica chmod 600." >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

notify_failure() {
  local exit_code=$?
  if command -v mail >/dev/null 2>&1 && [[ -n "${BACKUP_FAILURE_EMAIL:-}" ]]; then
    printf 'O backup Nikufra CRM falhou em %s (código %s). Verificar o servidor imediatamente.\n' "$(hostname)" "${exit_code}" | mail -s "[ALERTA] Backup CRM falhou" "${BACKUP_FAILURE_EMAIL}"
  fi
  exit "${exit_code}"
}
trap notify_failure ERR

docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" exec -T db \
  pg_dump -U postgres -d postgres -Fc | gzip -9 > "${BACKUP_FILE}"
chmod 600 "${BACKUP_FILE}"

gzip -t "${BACKUP_FILE}"
rclone copy "${BACKUP_FILE}" "${RCLONE_REMOTE}/daily/"

if [[ "$(date -u +%d)" == "01" ]]; then
  rclone copy "${BACKUP_FILE}" "${RCLONE_REMOTE}/monthly/"
fi

rclone delete "${RCLONE_REMOTE}/daily/" --min-age 30d
rclone delete "${RCLONE_REMOTE}/monthly/" --min-age 366d

find "${BACKUP_DIR}" -type f -name 'nikufra-crm-*.dump.gz' -mtime +7 -delete
printf 'Backup verificado e copiado: %s\n' "${BACKUP_FILE}"
