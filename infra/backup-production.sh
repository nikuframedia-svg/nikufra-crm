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
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
command -v gpg >/dev/null || { echo "gpg é obrigatório para cifrar o backup offsite" >&2; exit 1; }
RCLONE_BIN="${RCLONE_BIN:-$(command -v rclone || true)}"
[[ -n "${RCLONE_BIN}" ]] || RCLONE_BIN="${HOME}/.local/bin/rclone"
[[ -x "${RCLONE_BIN}" ]] || { echo "rclone é obrigatório para o backup offsite" >&2; exit 1; }
[[ -n "${RCLONE_REMOTE:-}" ]] || { echo "RCLONE_REMOTE em falta" >&2; exit 1; }
[[ -n "${BACKUP_ENCRYPTION_KEY_FILE:-}" && -f "${BACKUP_ENCRYPTION_KEY_FILE}" && ! -L "${BACKUP_ENCRYPTION_KEY_FILE}" ]] || {
  echo "BACKUP_ENCRYPTION_KEY_FILE inválida; executa configure-backups.sh" >&2
  exit 1
}
[[ "$(stat -c '%a' "${BACKUP_ENCRYPTION_KEY_FILE}")" == "600" ]] || { echo "A chave de backup tem de estar em modo 600" >&2; exit 1; }
mkdir -p "${DAILY_DIR}" "${MONTHLY_DIR}"
chmod 700 "${BACKUP_ROOT}" "${DAILY_DIR}" "${MONTHLY_DIR}"
exec 9>"${LOCK_FILE}"
flock -n 9 || { echo "Já existe um backup em execução" >&2; exit 1; }

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
month="$(date -u +%Y-%m)"
partial="${DAILY_DIR}/.nikufra-${stamp}.partial"
daily="${DAILY_DIR}/nikufra-${stamp}.dump"
encrypted_partial=""
globals_partial="${DAILY_DIR}/.nikufra-${stamp}.globals.partial"
globals="${DAILY_DIR}/nikufra-${stamp}.globals.sql"
globals_encrypted_partial=""
cleanup() {
  rm -f -- "${partial}" "${globals_partial}"
  [[ -z "${encrypted_partial}" ]] || rm -f -- "${encrypted_partial}"
  [[ -z "${globals_encrypted_partial}" ]] || rm -f -- "${globals_encrypted_partial}"
}
trap cleanup EXIT

"${COMPOSE[@]}" exec -T db pg_dump -U postgres -d postgres -Fc --no-owner > "${partial}"
"${COMPOSE[@]}" exec -T db pg_restore --list < "${partial}" >/dev/null
chmod 600 "${partial}"
mv -- "${partial}" "${daily}"
(cd "${DAILY_DIR}" && sha256sum "$(basename "${daily}")" > "$(basename "${daily}").sha256")
chmod 600 "${daily}.sha256"

# Role definitions are needed to make the ACLs above useful in a fresh
# disaster cluster. Password verifiers are deliberately excluded: deployment
# secrets recreate login passwords, while memberships and role attributes are
# preserved in this separately encrypted artifact.
"${COMPOSE[@]}" exec -T db pg_dumpall -U postgres --globals-only --no-role-passwords > "${globals_partial}"
[[ -s "${globals_partial}" ]] || { echo "O backup de roles/globals ficou vazio." >&2; exit 1; }
chmod 600 "${globals_partial}"
mv -- "${globals_partial}" "${globals}"
(cd "${DAILY_DIR}" && sha256sum "$(basename "${globals}")" > "$(basename "${globals}").sha256")
chmod 600 "${globals}.sha256"

encrypted="${daily}.gpg"
encrypted_partial="${encrypted}.partial"
gpg --batch --yes --pinentry-mode loopback --passphrase-file "${BACKUP_ENCRYPTION_KEY_FILE}" \
  --symmetric --cipher-algo AES256 --compress-algo none --output "${encrypted_partial}" "${daily}"
chmod 600 "${encrypted_partial}"
mv -- "${encrypted_partial}" "${encrypted}"
(cd "${DAILY_DIR}" && sha256sum "$(basename "${encrypted}")" > "$(basename "${encrypted}").sha256")
chmod 600 "${encrypted}.sha256"

globals_encrypted="${globals}.gpg"
globals_encrypted_partial="${globals_encrypted}.partial"
gpg --batch --yes --pinentry-mode loopback --passphrase-file "${BACKUP_ENCRYPTION_KEY_FILE}" \
  --symmetric --cipher-algo AES256 --compress-algo none --output "${globals_encrypted_partial}" "${globals}"
chmod 600 "${globals_encrypted_partial}"
mv -- "${globals_encrypted_partial}" "${globals_encrypted}"
(cd "${DAILY_DIR}" && sha256sum "$(basename "${globals_encrypted}")" > "$(basename "${globals_encrypted}").sha256")
chmod 600 "${globals_encrypted}.sha256"

# Autentica a cifra e valida o formato antes de qualquer upload.
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "${BACKUP_ENCRYPTION_KEY_FILE}" \
  --decrypt "${encrypted}" | "${COMPOSE[@]}" exec -T db pg_restore --list >/dev/null
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "${BACKUP_ENCRYPTION_KEY_FILE}" \
  --decrypt "${globals_encrypted}" >/dev/null
grep -q '^CREATE ROLE ' "${globals}"
"${RCLONE_BIN}" copyto "${encrypted}" "${RCLONE_REMOTE}/daily/$(basename "${encrypted}")"
"${RCLONE_BIN}" copyto "${encrypted}.sha256" "${RCLONE_REMOTE}/daily/$(basename "${encrypted}.sha256")"
"${RCLONE_BIN}" copyto "${globals_encrypted}" "${RCLONE_REMOTE}/daily/$(basename "${globals_encrypted}")"
"${RCLONE_BIN}" copyto "${globals_encrypted}.sha256" "${RCLONE_REMOTE}/daily/$(basename "${globals_encrypted}.sha256")"

if [[ "$(date -u +%d)" == "01" || "${FORCE_MONTHLY}" == "true" ]]; then
  monthly="${MONTHLY_DIR}/nikufra-${month}.dump"
  cp --preserve=mode,timestamps "${daily}" "${monthly}"
  (cd "${MONTHLY_DIR}" && sha256sum "$(basename "${monthly}")" > "$(basename "${monthly}").sha256")
  chmod 600 "${monthly}" "${monthly}.sha256"
  monthly_encrypted="${monthly}.gpg"
  cp --preserve=mode,timestamps "${encrypted}" "${monthly_encrypted}"
  (cd "${MONTHLY_DIR}" && sha256sum "$(basename "${monthly_encrypted}")" > "$(basename "${monthly_encrypted}").sha256")
  chmod 600 "${monthly_encrypted}" "${monthly_encrypted}.sha256"
  "${RCLONE_BIN}" copyto "${monthly_encrypted}" "${RCLONE_REMOTE}/monthly/$(basename "${monthly_encrypted}")"
  "${RCLONE_BIN}" copyto "${monthly_encrypted}.sha256" "${RCLONE_REMOTE}/monthly/$(basename "${monthly_encrypted}.sha256")"
  monthly_globals_encrypted="${MONTHLY_DIR}/nikufra-${month}.globals.sql.gpg"
  cp --preserve=mode,timestamps "${globals_encrypted}" "${monthly_globals_encrypted}"
  (cd "${MONTHLY_DIR}" && sha256sum "$(basename "${monthly_globals_encrypted}")" > "$(basename "${monthly_globals_encrypted}").sha256")
  chmod 600 "${monthly_globals_encrypted}" "${monthly_globals_encrypted}.sha256"
  "${RCLONE_BIN}" copyto "${monthly_globals_encrypted}" "${RCLONE_REMOTE}/monthly/$(basename "${monthly_globals_encrypted}")"
  "${RCLONE_BIN}" copyto "${monthly_globals_encrypted}.sha256" "${RCLONE_REMOTE}/monthly/$(basename "${monthly_globals_encrypted}.sha256")"
fi

find "${DAILY_DIR}" -maxdepth 1 -type f -name 'nikufra-*' -mtime +31 -delete
find "${MONTHLY_DIR}" -maxdepth 1 -type f -name 'nikufra-*' -mtime +400 -delete
"${RCLONE_BIN}" delete "${RCLONE_REMOTE}/daily/" --min-age 31d
"${RCLONE_BIN}" delete "${RCLONE_REMOTE}/monthly/" --min-age 401d

size="$(du -h "${daily}" | awk '{ print $1 }')"
echo "Backup ${daily} + roles/ACL verificado; cópia AES-256 autenticada enviada offsite (${size})"
