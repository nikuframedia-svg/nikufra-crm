#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
BACKUP_ROOT="${NIKUFRA_BACKUP_ROOT:-/home/luis/services/nikufra-crm/backups}"
BASE_DIR="${BACKUP_ROOT}/base"
LOCK_FILE="${BACKUP_ROOT}/.basebackup.lock"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
plain_name="base-${stamp}"
plain_dir="${BASE_DIR}/${plain_name}"
encrypted="${BASE_DIR}/${plain_name}.tar.gpg"
partial="${encrypted}.partial"

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
[[ -f "${BACKUP_ENCRYPTION_KEY_FILE:-}" && ! -L "${BACKUP_ENCRYPTION_KEY_FILE}" ]] || { echo "Chave de backup inválida." >&2; exit 1; }
[[ -n "${RCLONE_REMOTE:-}" ]] || { echo "RCLONE_REMOTE em falta." >&2; exit 1; }
RCLONE_BIN="${RCLONE_BIN:-$(command -v rclone || true)}"
[[ -n "${RCLONE_BIN}" ]] || RCLONE_BIN="${HOME}/.local/bin/rclone"
[[ -x "${RCLONE_BIN}" ]] || { echo "rclone em falta." >&2; exit 1; }
command -v gpg >/dev/null || { echo "gpg em falta." >&2; exit 1; }
command -v flock >/dev/null || { echo "flock em falta." >&2; exit 1; }
[[ "$(stat -c '%a' "${BACKUP_ENCRYPTION_KEY_FILE}")" == 600 ]] || { echo "A chave de backup tem de estar em modo 600." >&2; exit 1; }
mkdir -p "${BACKUP_ROOT}" "${BASE_DIR}"
chmod 700 "${BACKUP_ROOT}" "${BASE_DIR}"
exec 9>"${LOCK_FILE}"
flock -n 9 || { echo "Já existe um base backup em execução." >&2; exit 1; }
[[ ! -e "${plain_dir}" && ! -e "${encrypted}" ]] || { echo "Destino de base backup já existe." >&2; exit 1; }

cleanup() {
  rm -rf -- "${plain_dir}"
  rm -f -- "${partial}"
}
trap cleanup EXIT

"${COMPOSE[@]}" exec -T wal-archive pg_basebackup -h db -U nikufra_wal \
  -D "/base/${plain_name}" -Fp -X stream --checkpoint=fast --manifest-checksums=SHA256 --progress
"${COMPOSE[@]}" exec -T wal-archive pg_verifybackup "/base/${plain_name}"

tar -C "${BASE_DIR}" -cf - "${plain_name}" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-file "${BACKUP_ENCRYPTION_KEY_FILE}" --symmetric --cipher-algo AES256 \
  --compress-algo none --output "${partial}"
chmod 600 "${partial}"
mv -- "${partial}" "${encrypted}"
(cd "${BASE_DIR}" && sha256sum "$(basename "${encrypted}")" > "$(basename "${encrypted}").sha256")
chmod 600 "${encrypted}.sha256"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "${BACKUP_ENCRYPTION_KEY_FILE}" \
  --decrypt "${encrypted}" | tar -tf - >/dev/null

"${RCLONE_BIN}" copyto "${encrypted}" "${RCLONE_REMOTE}/base/$(basename "${encrypted}")"
"${RCLONE_BIN}" copyto "${encrypted}.sha256" "${RCLONE_REMOTE}/base/$(basename "${encrypted}.sha256")"
"${RCLONE_BIN}" delete "${RCLONE_REMOTE}/base/" --min-age 36d
find "${BASE_DIR}" -maxdepth 1 -type f -name 'base-*.tar.gpg*' -mtime +8 -delete
echo "Base backup físico verificado, cifrado e enviado offsite: ${encrypted}"
