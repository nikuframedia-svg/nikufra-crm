#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl é obrigatório." >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

upsert_secret() {
  local key="$1" value="$2"
  if grep -qE "^${key}=.+" "${ENV_FILE}"; then return; fi
  if grep -qE "^${key}=" "${ENV_FILE}"; then
    KEY_NAME="${key}" KEY_VALUE="${value}" perl -0pi -e 's/^\Q$ENV{KEY_NAME}\E=.*$/$ENV{KEY_NAME}=$ENV{KEY_VALUE}/m' "${ENV_FILE}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

upsert_default() {
  local key="$1" value="$2"
  grep -qE "^${key}=" "${ENV_FILE}" || printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
}

upsert_default OUTREACH_API_PORT 8787
upsert_default NIKUFRA_DISK_USAGE_MAX_PERCENT 80
upsert_default NIKUFRA_DISK_MIN_FREE_BYTES 21474836480
upsert_secret OUTREACH_DATABASE_PASSWORD "$(openssl rand -hex 48)"
upsert_default OUTREACH_ENCRYPTION_CURRENT_VERSION 1
upsert_secret OUTREACH_ENCRYPTION_KEY_V1 "$(openssl rand -base64 32 | tr -d '\n')"
initial_encryption_key="$(sed -n 's/^OUTREACH_ENCRYPTION_KEY_V1=//p' "${ENV_FILE}" | tail -1)"
[[ -n "${initial_encryption_key}" ]] || { echo "Não foi possível preparar a chave AES inicial." >&2; exit 1; }
upsert_secret OUTREACH_ENCRYPTION_KEYS "1:${initial_encryption_key}"
upsert_secret OUTREACH_STATE_HMAC_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
upsert_secret OUTREACH_WEBHOOK_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
upsert_secret OUTREACH_UNSUBSCRIBE_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
upsert_default OUTREACH_SEND_ENABLED false
upsert_default OUTREACH_SHADOW_MODE true
upsert_default OUTREACH_ADMIN_ONLY true
upsert_default OUTREACH_CANARY_ALLOWLIST joao@nikufra.ai,joaomilhazes71@gmail.com
upsert_default OUTREACH_GOOGLE_CLIENT_ID "${GOOGLE_CLIENT_ID:-}"
upsert_default OUTREACH_GOOGLE_CLIENT_SECRET "${GOOGLE_CLIENT_SECRET:-}"
upsert_default OUTREACH_GOOGLE_PUBSUB_VERIFICATION_TOKEN ""
upsert_default OUTREACH_SCHEDULER_INTERVAL_SECONDS 15
upsert_default OUTREACH_INBOUND_SYNC_INTERVAL_SECONDS 60

chmod 600 "${ENV_FILE}"
echo "Configuração Outreach preparada em ${ENV_FILE}; outbound permanece desligado."
