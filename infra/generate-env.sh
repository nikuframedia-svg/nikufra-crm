#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/.env"

if [[ -e "${TARGET}" ]]; then
  echo "${TARGET} já existe; não foi alterado." >&2
  exit 1
fi

command -v openssl >/dev/null || { echo "openssl é obrigatório" >&2; exit 1; }

POSTGRES_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
JWT_SECRET_VALUE="$(openssl rand -base64 48 | tr -d '\n')"
SECRET_BASE="$(openssl rand -base64 64 | tr -d '\n')"
REALTIME_KEY="$(openssl rand -hex 16)"
META_KEY="$(openssl rand -base64 32 | tr -d '\n')"
TOKEN_KEY="$(openssl rand -base64 32 | tr -d '\n')"
DASHBOARD_SECRET="$(openssl rand -base64 32 | tr -d '\n')"

issue_jwt() {
  local role="$1"
  local header payload signature
  header="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
  payload="$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$role" "$(date +%s)" "$(( $(date +%s) + 315360000 ))" | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
  signature="$(printf '%s' "${header}.${payload}" | openssl dgst -sha256 -hmac "${JWT_SECRET_VALUE}" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
  printf '%s.%s.%s' "${header}" "${payload}" "${signature}"
}

cp "${SCRIPT_DIR}/.env.example" "${TARGET}"
perl -0pi -e "s|^POSTGRES_PASSWORD=.*$|POSTGRES_PASSWORD=${POSTGRES_SECRET}|m; s|^JWT_SECRET=.*$|JWT_SECRET=${JWT_SECRET_VALUE}|m; s|^ANON_KEY=.*$|ANON_KEY=$(issue_jwt anon)|m; s|^SERVICE_ROLE_KEY=.*$|SERVICE_ROLE_KEY=$(issue_jwt service_role)|m; s|^SECRET_KEY_BASE=.*$|SECRET_KEY_BASE=${SECRET_BASE}|m; s|^REALTIME_DB_ENC_KEY=.*$|REALTIME_DB_ENC_KEY=${REALTIME_KEY}|m; s|^PG_META_CRYPTO_KEY=.*$|PG_META_CRYPTO_KEY=${META_KEY}|m; s|^TOKEN_ENCRYPTION_KEY=.*$|TOKEN_ENCRYPTION_KEY=${TOKEN_KEY}|m; s|^DASHBOARD_PASSWORD=.*$|DASHBOARD_PASSWORD=${DASHBOARD_SECRET}|m" "${TARGET}"
chmod 600 "${TARGET}"
echo "Segredos gerados em ${TARGET} (modo 600). Preenche SMTP, rclone e Google antes de arrancar."
