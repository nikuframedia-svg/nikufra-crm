#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")

[[ -f "${ENV_FILE}" ]] || { echo "FAIL configuração: falta ${ENV_FILE}"; exit 1; }
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

failures=0
pass() { printf 'OK   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }
db_value() { "${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc "$1"; }

if "${SCRIPT_DIR}/production-healthcheck.sh" >/dev/null; then pass "serviços internos"; else fail "serviços internos"; fi

expected_ip="${CRM_PUBLIC_IP:-188.40.230.28}"
resolved_ips="$(getent ahostsv4 "${CRM_DOMAIN}" 2>/dev/null | awk '{print $1}' | sort -u || true)"
if [[ -n "${expected_ip}" && " ${resolved_ips//$'\n'/ } " == *" ${expected_ip} "* ]]; then
  pass "DNS ${CRM_DOMAIN} -> ${expected_ip}"
else
  fail "DNS ${CRM_DOMAIN} ainda não aponta para ${expected_ip:-o IP configurado}"
fi

if curl --fail --silent --show-error --max-time 15 -H "apikey: ${ANON_KEY}" \
  "https://${CRM_DOMAIN}/auth/v1/health" >/dev/null 2>&1; then
  pass "HTTPS público e Auth"
else
  fail "HTTPS público e Auth"
fi

hook_enabled="$(docker inspect nikufra-crm-auth-1 --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n 's/^GOTRUE_HOOK_SEND_EMAIL_ENABLED=//p')"
if [[ "${hook_enabled}" == true ]]; then pass "hook de emails ativo"; else fail "hook de emails ainda está desligado"; fi

email_delivery="$(db_value "select exists(select 1 from public.auth_email_deliveries where status='sent' and provider_message_id is not null);")"
if [[ "${email_delivery}" == t ]]; then pass "envio Gmail API verificado"; else fail "envio Gmail API sem prova de entrega"; fi

google_ready="$(db_value "select exists(select 1 from public.google_tokens gt join public.profiles p on p.id=gt.user_id where p.ativo and gt.import_confirmed_at is not null and 'gmail.compose'=any(gt.scopes));")"
if [[ "${google_ready}" == t ]]; then pass "OAuth Google e importação confirmados"; else fail "OAuth Google/importação incompletos"; fi

sync_recent="$(db_value "select exists(select 1 from public.google_tokens where last_sync_at > now() - interval '30 minutes' and sync_error is null);")"
if [[ "${sync_recent}" == t ]]; then pass "sync Google recente"; else fail "sync Google não correu nos últimos 30 minutos"; fi

real_data="$(db_value "select (select count(*) from public.empresas) > 0 and (select count(*) from public.contactos) > 0 and (select count(*) from public.oportunidades) > 0;")"
if [[ "${real_data}" == t ]]; then pass "dados CRM reais presentes"; else fail "base CRM vazia"; fi

chat_ready="$(db_value "select to_regclass('public.chat_conversations') is not null and to_regclass('public.chat_messages') is not null and to_regclass('public.chat_agents') is not null and (select relrowsecurity from pg_class where oid='public.chat_messages'::regclass);")"
if [[ "${chat_ready}" == t ]]; then pass "chat de equipa com RLS ativo"; else fail "chat de equipa incompleto"; fi

realtime_tenant="$(db_value "select exists(select 1 from _realtime.tenants where external_id='realtime-dev');")"
if [[ "${realtime_tenant}" == t ]] && "${COMPOSE[@]}" exec -T realtime \
  curl --fail --silent --show-error --max-time 15 -H "Authorization: Bearer ${ANON_KEY}" \
  "http://localhost:4000/api/tenants/realtime-dev/health" >/dev/null 2>&1; then
  pass "Realtime com tenant correto"
else
  fail "Realtime sem tenant ou rota saudável"
fi

chat_functions_ready=true
for function_name in chat-agent chat-agent-config billing-delete; do
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 -X POST -H "apikey: ${ANON_KEY}" "https://${CRM_DOMAIN}/functions/v1/${function_name}")"
  if [[ "${status}" != 401 ]]; then chat_functions_ready=false; fi
done
if [[ "${chat_functions_ready}" == true ]]; then pass "funções de chat e faturação protegidas"; else fail "funções de chat/faturação indisponíveis ou sem proteção"; fi

oauth_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 "https://${CRM_DOMAIN}/.well-known/oauth-authorization-server/auth/v1")"
mcp_headers="$(curl --silent --include --output - --max-time 15 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' "https://${CRM_DOMAIN}/functions/v1/mcp")"
if [[ "${oauth_status}" == 200 ]] && grep -qi '^www-authenticate: Bearer .*oauth-protected-resource' <<<"${mcp_headers}"; then
  pass "Claude MCP com OAuth discovery e proteção Bearer"
else
  fail "Claude MCP/OAuth indisponível"
fi

if find "${PROJECT_DIR}/backups/daily" -maxdepth 1 -type f -name '*.dump' -mtime -2 -size +100k -print -quit 2>/dev/null | grep -q .; then
  pass "backup diário recente"
else
  fail "backup diário recente"
fi

web_html="$(curl --fail --silent --show-error --max-time 15 "https://${CRM_DOMAIN}/" 2>/dev/null || true)"
if grep -q '<div id="root"></div>' <<<"${web_html}"; then
  pass "aplicação web pública"
else
  fail "aplicação web pública"
fi

asset_path="$(grep -oE '/assets/[^" ]+\.js' <<<"${web_html}" | head -1 || true)"
if [[ -n "${asset_path}" ]] && curl --fail --silent --show-error --head --max-time 15 \
  "https://${CRM_DOMAIN}${asset_path}" >/dev/null 2>&1; then
  pass "assets web versionados"
else
  fail "assets web versionados"
fi

if [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 "https://${CRM_DOMAIN}/rota-inexistente-do-spa")" == 200 ]]; then
  pass "fallback de navegação SPA"
else
  fail "fallback de navegação SPA"
fi

if [[ "${failures}" -eq 0 ]]; then
  echo "READY produção pronta para a equipa"
  exit 0
fi

echo "NOT READY ${failures} verificação(ões) pendente(s)"
exit 1
