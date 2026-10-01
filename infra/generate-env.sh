#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/.env"

if [[ -e "${TARGET}" ]]; then
  echo "${TARGET} já existe; não foi alterado." >&2
  exit 1
fi

command -v openssl >/dev/null || { echo "openssl é obrigatório" >&2; exit 1; }

# Hex evita caracteres reservados na password embebida em DATABASE_URL.
POSTGRES_SECRET="$(openssl rand -hex 48)"
JWT_SECRET_VALUE="$(openssl rand -base64 48 | tr -d '\n')"
SECRET_BASE="$(openssl rand -base64 64 | tr -d '\n')"
# Realtime usa AES-128 e exige exatamente 16 bytes/caracteres nesta variável.
REALTIME_KEY="$(openssl rand -hex 8)"
META_KEY="$(openssl rand -base64 32 | tr -d '\n')"
TOKEN_KEY="$(openssl rand -base64 32 | tr -d '\n')"
OUTREACH_DB_SECRET="$(openssl rand -hex 48)"
OUTREACH_ENCRYPTION_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
OUTREACH_STATE_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
OUTREACH_WEBHOOK_SECRET_VALUE="$(openssl rand -base64 48 | tr -d '\n')"
OUTREACH_UNSUBSCRIBE_SECRET_VALUE="$(openssl rand -base64 48 | tr -d '\n')"
WAL_ARCHIVE_SECRET="$(openssl rand -hex 48)"
DASHBOARD_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
AUTH_EMAIL_HOOK_SECRET_VALUE="v1,whsec_$(openssl rand -base64 32 | tr -d '\n')"

issue_jwt() {
  local role="$1"
  local header payload signature
  header="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
  payload="$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$role" "$(date +%s)" "$(( $(date +%s) + 315360000 ))" | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
  signature="$(printf '%s' "${header}.${payload}" | openssl dgst -sha256 -hmac "${JWT_SECRET_VALUE}" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
  printf '%s.%s.%s' "${header}" "${payload}" "${signature}"
}

cp "${SCRIPT_DIR}/.env.example" "${TARGET}"
perl -0pi -e "s|^POSTGRES_PASSWORD=.*$|POSTGRES_PASSWORD=${POSTGRES_SECRET}|m; s|^JWT_SECRET=.*$|JWT_SECRET=${JWT_SECRET_VALUE}|m; s|^ANON_KEY=.*$|ANON_KEY=$(issue_jwt anon)|m; s|^SERVICE_ROLE_KEY=.*$|SERVICE_ROLE_KEY=$(issue_jwt service_role)|m; s|^SECRET_KEY_BASE=.*$|SECRET_KEY_BASE=${SECRET_BASE}|m; s|^REALTIME_DB_ENC_KEY=.*$|REALTIME_DB_ENC_KEY=${REALTIME_KEY}|m; s|^PG_META_CRYPTO_KEY=.*$|PG_META_CRYPTO_KEY=${META_KEY}|m; s|^TOKEN_ENCRYPTION_KEY=.*$|TOKEN_ENCRYPTION_KEY=${TOKEN_KEY}|m; s|^OUTREACH_DATABASE_PASSWORD=.*$|OUTREACH_DATABASE_PASSWORD=${OUTREACH_DB_SECRET}|m; s|^OUTREACH_ENCRYPTION_KEY_V1=.*$|OUTREACH_ENCRYPTION_KEY_V1=${OUTREACH_ENCRYPTION_SECRET}|m; s|^OUTREACH_ENCRYPTION_KEYS=.*$|OUTREACH_ENCRYPTION_KEYS=1:${OUTREACH_ENCRYPTION_SECRET}|m; s|^OUTREACH_STATE_HMAC_SECRET=.*$|OUTREACH_STATE_HMAC_SECRET=${OUTREACH_STATE_SECRET}|m; s|^OUTREACH_WEBHOOK_SECRET=.*$|OUTREACH_WEBHOOK_SECRET=${OUTREACH_WEBHOOK_SECRET_VALUE}|m; s|^OUTREACH_UNSUBSCRIBE_SECRET=.*$|OUTREACH_UNSUBSCRIBE_SECRET=${OUTREACH_UNSUBSCRIBE_SECRET_VALUE}|m; s|^WAL_ARCHIVE_PASSWORD=.*$|WAL_ARCHIVE_PASSWORD=${WAL_ARCHIVE_SECRET}|m; s|^DASHBOARD_PASSWORD=.*$|DASHBOARD_PASSWORD=${DASHBOARD_SECRET}|m; s|^AUTH_EMAIL_HOOK_SECRET=.*$|AUTH_EMAIL_HOOK_SECRET=${AUTH_EMAIL_HOOK_SECRET_VALUE}|m" "${TARGET}"
chmod 600 "${TARGET}"
echo "Segredos gerados em ${TARGET} (modo 600). Preenche SMTP, rclone e Google e executa configure-pgsodium.sh antes de arrancar."
