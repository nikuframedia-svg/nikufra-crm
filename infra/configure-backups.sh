#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

key_file="${BACKUP_ENCRYPTION_KEY_FILE:-${HOME}/.config/nikufra-crm/backup.key}"
key_dir="$(dirname "${key_file}")"
mkdir -p "${key_dir}"
chmod 700 "${key_dir}"
if [[ ! -e "${key_file}" ]]; then
  umask 077
  openssl rand -base64 48 > "${key_file}"
fi
[[ -f "${key_file}" && ! -L "${key_file}" ]] || { echo "A chave de backup tem de ser um ficheiro normal, não um symlink." >&2; exit 1; }
chmod 600 "${key_file}"

if ! grep -q '^BACKUP_ENCRYPTION_KEY_FILE=' "${ENV_FILE}"; then
  printf '\nBACKUP_ENCRYPTION_KEY_FILE=%s\n' "${key_file}" >> "${ENV_FILE}"
fi
if ! grep -qE '^WAL_ARCHIVE_PASSWORD=.+' "${ENV_FILE}"; then
  wal_password="$(openssl rand -hex 48)"
  if grep -q '^WAL_ARCHIVE_PASSWORD=' "${ENV_FILE}"; then
    KEY_NAME=WAL_ARCHIVE_PASSWORD KEY_VALUE="${wal_password}" perl -0pi -e 's/^\Q$ENV{KEY_NAME}\E=.*$/$ENV{KEY_NAME}=$ENV{KEY_VALUE}/m' "${ENV_FILE}"
  else
    printf 'WAL_ARCHIVE_PASSWORD=%s\n' "${wal_password}" >> "${ENV_FILE}"
  fi
fi
if ! grep -q '^BACKUP_CONTAINER_UID=' "${ENV_FILE}"; then
  printf 'BACKUP_CONTAINER_UID=%s\n' "$(id -u)" >> "${ENV_FILE}"
fi
if ! grep -q '^BACKUP_CONTAINER_GID=' "${ENV_FILE}"; then
  printf 'BACKUP_CONTAINER_GID=%s\n' "$(id -g)" >> "${ENV_FILE}"
fi
chmod 600 "${ENV_FILE}"
echo "Chave de backup preparada fora da árvore de backups: ${key_file}"
