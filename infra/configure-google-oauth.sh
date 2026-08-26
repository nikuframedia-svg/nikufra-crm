#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OAUTH_FILE="${1:-}"
INFRA_ENV="${SCRIPT_DIR}/.env"

if [[ -z "${OAUTH_FILE}" || ! -f "${OAUTH_FILE}" ]]; then
  echo "Indica o JSON OAuth descarregado da Google." >&2
  exit 1
fi
if [[ ! -f "${INFRA_ENV}" ]]; then
  echo "Executa primeiro ./infra/configure-local.sh." >&2
  exit 1
fi

CLIENT_ID_VALUE="$(jq -er '.web.client_id' "${OAUTH_FILE}")"
CLIENT_SECRET_VALUE="$(jq -er '.web.client_secret' "${OAUTH_FILE}")"
jq -e '.web.redirect_uris | index("http://localhost:8000/functions/v1/gmail-oauth-callback") != null' "${OAUTH_FILE}" >/dev/null
jq -e '.web.redirect_uris | index("https://crm.nikufra.ai/functions/v1/gmail-oauth-callback") != null' "${OAUTH_FILE}" >/dev/null

TEMP_ENV="$(mktemp "${SCRIPT_DIR}/.env.oauth.XXXXXX")"
cleanup() { [[ -f "${TEMP_ENV}" ]] && unlink "${TEMP_ENV}"; }
trap cleanup EXIT

GOOGLE_ID="${CLIENT_ID_VALUE}" GOOGLE_SECRET="${CLIENT_SECRET_VALUE}" awk '
  /^GOOGLE_CLIENT_ID=/ { print "GOOGLE_CLIENT_ID=" ENVIRON["GOOGLE_ID"]; id = 1; next }
  /^GOOGLE_CLIENT_SECRET=/ { print "GOOGLE_CLIENT_SECRET=" ENVIRON["GOOGLE_SECRET"]; secret = 1; next }
  { print }
  END {
    if (!id) print "GOOGLE_CLIENT_ID=" ENVIRON["GOOGLE_ID"]
    if (!secret) print "GOOGLE_CLIENT_SECRET=" ENVIRON["GOOGLE_SECRET"]
  }
' "${INFRA_ENV}" > "${TEMP_ENV}"

chmod 600 "${TEMP_ENV}" "${OAUTH_FILE}"
mv "${TEMP_ENV}" "${INFRA_ENV}"
trap - EXIT
echo "Credenciais OAuth instaladas no ambiente local; os valores não foram apresentados."
