#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
BACKUP_ROOT="${NIKUFRA_BACKUP_ROOT:-/home/luis/services/nikufra-crm/backups}"
WAL_DIR="${BACKUP_ROOT}/wal"
ENCRYPTED_WAL_DIR="${BACKUP_ROOT}/wal-encrypted"
LOCK_FILE="${BACKUP_ROOT}/.wal-offsite.lock"

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
[[ -n "${RCLONE_REMOTE:-}" ]] || { echo "RCLONE_REMOTE em falta." >&2; exit 1; }
[[ -f "${BACKUP_ENCRYPTION_KEY_FILE:-}" && ! -L "${BACKUP_ENCRYPTION_KEY_FILE}" ]] || { echo "Chave de backup inválida." >&2; exit 1; }
RCLONE_BIN="${RCLONE_BIN:-$(command -v rclone || true)}"
[[ -n "${RCLONE_BIN}" ]] || RCLONE_BIN="${HOME}/.local/bin/rclone"
[[ -x "${RCLONE_BIN}" ]] || { echo "rclone em falta." >&2; exit 1; }
command -v gpg >/dev/null || { echo "gpg em falta." >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum em falta." >&2; exit 1; }
command -v flock >/dev/null || { echo "flock em falta." >&2; exit 1; }
[[ "$(stat -c '%a' "${BACKUP_ENCRYPTION_KEY_FILE}")" == 600 ]] || { echo "A chave de backup tem de estar em modo 600." >&2; exit 1; }
mkdir -p "${BACKUP_ROOT}" "${WAL_DIR}" "${ENCRYPTED_WAL_DIR}"
chmod 700 "${BACKUP_ROOT}" "${WAL_DIR}" "${ENCRYPTED_WAL_DIR}"
exec 9>"${LOCK_FILE}"
flock -w 120 9 || { echo "Outra sincronização WAL continua ativa após 120 segundos." >&2; exit 1; }
verify_dir=""
marker_partial="${BACKUP_ROOT}/.wal-offsite.last.partial"
current_partial=""
cleanup() {
  [[ -z "${verify_dir}" ]] || rm -rf -- "${verify_dir}"
  [[ -z "${current_partial}" ]] || rm -f -- "${current_partial}"
  rm -f -- "${marker_partial}"
}
trap cleanup EXIT
[[ "$("${COMPOSE[@]}" ps --status running --services wal-archive)" == "wal-archive" ]] || { echo "wal-archive não está ativo." >&2; exit 1; }

# Fecha um segmento em cada execução. Com cron a cada 10 minutos, o RPO
# offsite máximo fica abaixo dos 15 minutos acordados.
switched_segment="$("${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc \
  "select pg_walfile_name(pg_current_wal_lsn())")"
[[ "${switched_segment}" =~ ^0[0-9A-F]{23}$ ]] || { echo "Nome de segmento WAL inválido: ${switched_segment}" >&2; exit 1; }
"${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc "select pg_switch_wal()" >/dev/null
archived=false
for _ in $(seq 1 60); do
  if [[ -s "${WAL_DIR}/${switched_segment}" ]]; then archived=true; break; fi
  sleep 1
done
[[ "${archived}" == true ]] || { echo "O segmento fechado ${switched_segment} não chegou ao arquivo em 60 segundos." >&2; exit 1; }

# Os segmentos WAL contêm os mesmos dados sensíveis da base. Apenas a versão
# AES-256 autenticada sai do servidor; a chave permanece fora dos backups.
while IFS= read -r wal_path; do
  wal_name="$(basename "${wal_path}")"
  encrypted="${ENCRYPTED_WAL_DIR}/${wal_name}.gpg"
  checksum="${encrypted}.sha256"
  if [[ ! -f "${encrypted}" || ! -f "${checksum}" ]] \
    || ! (cd "${ENCRYPTED_WAL_DIR}" && sha256sum --check "${wal_name}.gpg.sha256" >/dev/null 2>&1); then
    partial="${encrypted}.partial"
    current_partial="${partial}"
    rm -f -- "${partial}"
    gpg --batch --yes --pinentry-mode loopback --passphrase-file "${BACKUP_ENCRYPTION_KEY_FILE}" \
      --symmetric --cipher-algo AES256 --compress-algo none --output "${partial}" "${wal_path}"
    chmod 600 "${partial}"
    mv -- "${partial}" "${encrypted}"
    current_partial=""
    (cd "${ENCRYPTED_WAL_DIR}" && sha256sum "${wal_name}.gpg" > "${wal_name}.gpg.sha256")
    chmod 600 "${encrypted}.sha256"
  fi
done < <(find "${WAL_DIR}" -maxdepth 1 -type f -name '0???????????????????????' -print | sort)

"${RCLONE_BIN}" copy "${ENCRYPTED_WAL_DIR}" "${RCLONE_REMOTE}/wal/" \
  --include '*.gpg' --include '*.gpg.sha256' --exclude '*'

# Download the exact segment closed above and its sidecar again. A successful
# upload command or a local timestamp is not sufficient proof of offsite RPO.
verify_dir="$(mktemp -d "${BACKUP_ROOT}/.wal-remote-verify.XXXXXX")"
"${RCLONE_BIN}" copyto "${RCLONE_REMOTE}/wal/${switched_segment}.gpg" \
  "${verify_dir}/${switched_segment}.gpg"
"${RCLONE_BIN}" copyto "${RCLONE_REMOTE}/wal/${switched_segment}.gpg.sha256" \
  "${verify_dir}/${switched_segment}.gpg.sha256"
(cd "${verify_dir}" && sha256sum --check "${switched_segment}.gpg.sha256" >/dev/null)

printf 'verified_at=%s\nsegment=%s\nremote=%s\n' \
  "$(date -u +%FT%TZ)" "${switched_segment}" "${RCLONE_REMOTE}/wal/${switched_segment}.gpg" > "${marker_partial}"
chmod 600 "${marker_partial}"
mv -- "${marker_partial}" "${BACKUP_ROOT}/wal-offsite.last"

find "${WAL_DIR}" -maxdepth 1 -type f -name '0???????????????????????' -mtime +7 -delete
find "${ENCRYPTED_WAL_DIR}" -maxdepth 1 -type f -name '0???????????????????????.gpg*' -mtime +7 -delete
"${RCLONE_BIN}" delete "${RCLONE_REMOTE}/wal/" --min-age 35d --include '*.gpg' --include '*.gpg.sha256'
printf 'WAL offsite sincronizado e revalidado em %s; segmento fechado %s\n' "$(date -u +%FT%TZ)" "${switched_segment}"
