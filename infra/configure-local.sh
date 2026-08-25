#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
INFRA_ENV="${SCRIPT_DIR}/.env"
APP_ENV="${PROJECT_DIR}/.env.local"

if [[ ! -f "${INFRA_ENV}" ]]; then
  "${SCRIPT_DIR}/generate-env.sh"
fi

CURRENT_REALTIME_KEY="$(sed -n 's/^REALTIME_DB_ENC_KEY=//p' "${INFRA_ENV}")"
if [[ ${#CURRENT_REALTIME_KEY} -ne 16 ]]; then
  NEW_REALTIME_KEY="$(openssl rand -hex 8)"
  perl -0pi -e "s|^REALTIME_DB_ENC_KEY=.*$|REALTIME_DB_ENC_KEY=${NEW_REALTIME_KEY}|m" "${INFRA_ENV}"
fi

ANON_KEY_VALUE="$(sed -n 's/^ANON_KEY=//p' "${INFRA_ENV}")"
if [[ -z "${ANON_KEY_VALUE}" ]]; then
  echo "ANON_KEY em falta em ${INFRA_ENV}" >&2
  exit 1
fi

umask 077
{
  printf '%s\n' 'VITE_SUPABASE_URL=http://127.0.0.1:8000'
  printf 'VITE_SUPABASE_ANON_KEY=%s\n' "${ANON_KEY_VALUE}"
} > "${APP_ENV}"
chmod 600 "${APP_ENV}"

echo "Configuração local criada. Os segredos permanecem apenas em ficheiros ignorados pelo Git."
