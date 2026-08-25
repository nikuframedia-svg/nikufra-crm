#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.local.yml")

for command in curl jq node rg docker; do
  command -v "${command}" >/dev/null || { echo "${command} é obrigatório" >&2; exit 1; }
done
[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}; executa primeiro ./local-up.sh" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

test_email="nikufra.crm.qa+$(date +%s).$$@gmail.com"
[[ "${test_email}" =~ ^nikufra\.crm\.qa\+[0-9]+\.[0-9]+@gmail\.com$ ]]
test_user_id=""

cleanup() {
  if [[ -n "${test_user_id}" ]]; then
    curl -sS -o /dev/null -X DELETE "http://127.0.0.1:8000/auth/v1/admin/users/${test_user_id}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" || true
  fi
  "${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "delete from public.user_invitations where email = '${test_email}';" >/dev/null || true
}
trap cleanup EXIT

admin_email="$("${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc \
  "select email from public.profiles where role='admin' and ativo order by created_at limit 1")"
[[ -n "${admin_email}" ]] || { echo "Não existe administrador local ativo" >&2; exit 1; }

latest_message_id() {
  curl -fsS http://127.0.0.1:8025/api/v1/messages | jq -r '.messages[0].ID // ""'
}

wait_for_new_message() {
  local previous="$1" current=""
  for _ in 1 2 3 4 5; do
    current="$(latest_message_id)"
    if [[ -n "${current}" && "${current}" != "${previous}" ]]; then
      printf '%s' "${current}"
      return 0
    fi
    sleep 1
  done
  return 1
}

extract_verify_link() {
  local message_id="$1"
  curl -fsS "http://127.0.0.1:8025/api/v1/message/${message_id}" | jq -r '.HTML' | \
    rg -o 'http://localhost:8000/auth/v1/verify[^"< ]+' | head -1 | sed 's/&amp;/\&/g'
}

extract_location() {
  awk 'tolower($1) == "location:" {$1=""; sub(/^ /,""); sub(/\r$/,""); print; exit}' "$1"
}

before_magic_id="$(latest_message_id)"
pkce_verifier="nikufra-crm-e2e-verifier-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
pkce_challenge="$(PKCE_VERIFIER="${pkce_verifier}" node -e "const c=require('node:crypto'); process.stdout.write(c.createHash('sha256').update(process.env.PKCE_VERIFIER).digest('base64url'))")"
pkce_flow_id="0123456789abcdef0123456789abcdef"
pkce_redirect="nikufra-crm://auth/callback?sb_flow_id=${pkce_flow_id}"
pkce_redirect_encoded="$(printf '%s' "${pkce_redirect}" | jq -sRr @uri)"
otp_status="$(curl -sS -o /tmp/nikufra-auth-e2e-otp.json -w '%{http_code}' \
  -X POST "http://127.0.0.1:8000/auth/v1/otp?redirect_to=${pkce_redirect_encoded}" \
  -H "apikey: ${ANON_KEY}" -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg email "${admin_email}" --arg challenge "${pkce_challenge}" \
    '{email:$email,create_user:false,code_challenge:$challenge,code_challenge_method:"s256"}')")"
[[ "${otp_status}" == 200 ]] || { echo "Magic link falhou (${otp_status})" >&2; exit 1; }

magic_id="$(wait_for_new_message "${before_magic_id}")"
magic_link="$(extract_verify_link "${magic_id}")"
magic_status="$(curl -sS -o /dev/null -D /tmp/nikufra-auth-e2e-magic.headers -w '%{http_code}' "${magic_link}")"
magic_location="$(extract_location /tmp/nikufra-auth-e2e-magic.headers)"
auth_code="$(MAGIC_LOCATION="${magic_location}" node -e "const u=new URL(process.env.MAGIC_LOCATION); process.stdout.write(u.searchParams.get('code')||'')")"
returned_flow_id="$(MAGIC_LOCATION="${magic_location}" node -e "const u=new URL(process.env.MAGIC_LOCATION); process.stdout.write(u.searchParams.get('sb_flow_id')||'')")"
leaked_tokens="$(MAGIC_LOCATION="${magic_location}" node -e "const u=new URL(process.env.MAGIC_LOCATION); process.stdout.write(u.hash.includes('access_token')||u.searchParams.has('access_token')?'yes':'no')")"
[[ "${magic_status}" == 303 && -n "${auth_code}" && "${returned_flow_id}" == "${pkce_flow_id}" && "${leaked_tokens}" == no ]] || {
  echo "O magic link PKCE não devolveu o código isolado esperado" >&2
  exit 1
}

token_status="$(curl -sS -o /tmp/nikufra-auth-e2e-token.json -w '%{http_code}' \
  -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=pkce' \
  -H "apikey: ${ANON_KEY}" -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg code "${auth_code}" --arg verifier "${pkce_verifier}" \
    '{auth_code:$code,code_verifier:$verifier}')")"
access_token="$(jq -r '.access_token // ""' /tmp/nikufra-auth-e2e-token.json)"
refresh_token="$(jq -r '.refresh_token // ""' /tmp/nikufra-auth-e2e-token.json)"
[[ "${token_status}" == 200 && -n "${access_token}" && -n "${refresh_token}" ]] || {
  echo "O código PKCE não criou uma sessão persistível" >&2
  exit 1
}

user_status="$(curl -sS -o /tmp/nikufra-auth-e2e-user.json -w '%{http_code}' \
  http://127.0.0.1:8000/auth/v1/user -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${access_token}")"
[[ "${user_status}" == 200 ]] || { echo "A sessão criada não é válida" >&2; exit 1; }

before_invite_id="$(latest_message_id)"
invite_status="$(curl -sS -o /tmp/nikufra-auth-e2e-invite.json -w '%{http_code}' \
  -X POST http://127.0.0.1:8000/functions/v1/invite-user \
  -H "Authorization: Bearer ${access_token}" -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg email "${test_email}" '{nome:"QA Team",email:$email}')")"
test_user_id="$("${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc \
  "select id from auth.users where email = '${test_email}'")"
[[ "${invite_status}" == 200 && -n "${test_user_id}" ]] || { echo "Convite falhou (${invite_status})" >&2; exit 1; }

invite_id="$(wait_for_new_message "${before_invite_id}")"
invite_json="$(curl -fsS "http://127.0.0.1:8025/api/v1/message/${invite_id}")"
invite_recipient="$(jq -r '.To[0].Address // ""' <<<"${invite_json}")"
[[ "${invite_recipient}" == "${test_email}" ]] || { echo "O convite chegou ao destinatário errado" >&2; exit 1; }
invite_link="$(jq -r '.HTML' <<<"${invite_json}" | rg -o 'http://localhost:8000/auth/v1/verify[^"< ]+' | head -1 | sed 's/&amp;/\&/g')"
invite_status="$(curl -sS -o /dev/null -D /tmp/nikufra-auth-e2e-invite.headers -w '%{http_code}' "${invite_link}")"
invite_location="$(extract_location /tmp/nikufra-auth-e2e-invite.headers)"
deep_link_ok="$(INVITE_LOCATION="${invite_location}" node -e "const u=new URL(process.env.INVITE_LOCATION); process.stdout.write(u.protocol==='nikufra-crm:' && u.hostname==='auth' ? 'yes':'no')")"
member_access_token="$(INVITE_LOCATION="${invite_location}" node -e "const u=new URL(process.env.INVITE_LOCATION); const p=new URLSearchParams(u.hash.slice(1)); process.stdout.write(p.get('access_token')||'')")"
member_refresh_token="$(INVITE_LOCATION="${invite_location}" node -e "const u=new URL(process.env.INVITE_LOCATION); const p=new URLSearchParams(u.hash.slice(1)); process.stdout.write(p.get('refresh_token')||'')")"
profile_state="$("${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc \
  "select role || ':' || ativo::text from public.profiles where email = '${test_email}'")"
invitation_used="$("${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc \
  "select (used_at is not null)::text from public.user_invitations where email = '${test_email}'")"

[[ "${invite_status}" == 303 && "${deep_link_ok}" == yes && -n "${member_access_token}" && -n "${member_refresh_token}" && "${profile_state}" == member:true && "${invitation_used}" == true ]] || {
  echo "O convite não concluiu o onboarding esperado" >&2
  exit 1
}

member_user_status="$(curl -sS -o /tmp/nikufra-auth-e2e-member.json -w '%{http_code}' \
  http://127.0.0.1:8000/auth/v1/user \
  -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${member_access_token}")"
member_data_status="$(curl -sS -o /tmp/nikufra-auth-e2e-member-data.json -w '%{http_code}' \
  'http://127.0.0.1:8000/rest/v1/empresas?select=id&limit=1' \
  -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${member_access_token}")"
member_invite_status="$(curl -sS -o /tmp/nikufra-auth-e2e-member-invite.json -w '%{http_code}' \
  -X POST http://127.0.0.1:8000/functions/v1/invite-user \
  -H "Authorization: Bearer ${member_access_token}" -H 'Content-Type: application/json' \
  --data '{"nome":"Não autorizado","email":"blocked@example.com"}')"
member_promote_status="$(curl -sS -o /tmp/nikufra-auth-e2e-member-promote.json -w '%{http_code}' \
  -X PATCH "http://127.0.0.1:8000/rest/v1/profiles?id=eq.${test_user_id}" \
  -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${member_access_token}" \
  -H 'Content-Type: application/json' --data '{"role":"admin"}')"
member_role_after_attempt="$("${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc \
  "select role from public.profiles where id = '${test_user_id}'")"

[[ "${member_user_status}" == 200 && "${member_data_status}" == 200 && "${member_invite_status}" == 403 ]] || {
  echo "O membro não recebeu o acesso partilhado esperado ou conseguiu convidar utilizadores" >&2
  exit 1
}
[[ "${member_promote_status}" == 400 || "${member_promote_status}" == 403 ]] && [[ "${member_role_after_attempt}" == member ]] || {
  echo "O membro conseguiu alterar o próprio nível de acesso" >&2
  exit 1
}

cleanup
trap - EXIT
residual="$("${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc \
  "select (select count(*) from auth.users where email='${test_email}') + (select count(*) from public.user_invitations where email='${test_email}')")"
[[ "${residual}" == 0 ]] || { echo "O teste deixou dados residuais" >&2; exit 1; }

echo "OK login, sessão persistível, convite por email, callback desktop, acesso partilhado, isolamento member e limpeza"
