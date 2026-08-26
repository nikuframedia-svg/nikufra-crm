#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
ACTION="${1:-prepare}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Falta ${ENV_FILE}" >&2
  exit 1
fi
if [[ "${ACTION}" != "prepare" && "${ACTION}" != "enable" && "${ACTION}" != "enable-local" && "${ACTION}" != "disable" ]]; then
  echo "Uso: $0 [prepare|enable|enable-local|disable]" >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl é obrigatório" >&2; exit 1; }

secret="$(sed -n 's/^AUTH_EMAIL_HOOK_SECRET=//p' "${ENV_FILE}" | tail -1)"
if [[ ! "${secret}" =~ ^v1,whsec_[A-Za-z0-9+/]+={0,2}$ ]]; then
  secret="v1,whsec_$(openssl rand -base64 32 | tr -d '\n')"
fi

enabled=false
if [[ "${ACTION}" == "enable" || "${ACTION}" == "enable-local" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
  if [[ -z "${ANON_KEY:-}" ]]; then
    echo "ANON_KEY é obrigatória" >&2
    exit 1
  fi
  if [[ "${ACTION}" == "enable" && -z "${CRM_DOMAIN:-}" ]]; then
    echo "CRM_DOMAIN é obrigatório" >&2
    exit 1
  fi
  health_url="http://127.0.0.1:8000/auth/v1/health"
  if [[ "${ACTION}" == "enable" ]]; then
    health_url="https://${CRM_DOMAIN}/auth/v1/health"
  fi
  curl --fail --silent --show-error --max-time 15 \
    -H "apikey: ${ANON_KEY}" "${health_url}" >/dev/null
  enabled=true
fi

temporary="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
trap 'rm -f "${temporary}"' EXIT
awk -v enabled="${enabled}" -v secret="${secret}" '
  BEGIN { enabled_seen = 0; secret_seen = 0 }
  /^AUTH_EMAIL_HOOK_ENABLED=/ { print "AUTH_EMAIL_HOOK_ENABLED=" enabled; enabled_seen = 1; next }
  /^AUTH_EMAIL_HOOK_SECRET=/ { print "AUTH_EMAIL_HOOK_SECRET=" secret; secret_seen = 1; next }
  { print }
  END {
    if (!enabled_seen) print "AUTH_EMAIL_HOOK_ENABLED=" enabled
    if (!secret_seen) print "AUTH_EMAIL_HOOK_SECRET=" secret
  }
' "${ENV_FILE}" > "${temporary}"
chmod 600 "${temporary}"
mv "${temporary}" "${ENV_FILE}"
trap - EXIT

echo "Hook de email preparado (enabled=${enabled}); o segredo não foi mostrado."
