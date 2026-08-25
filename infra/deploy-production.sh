#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
SERVICES=(db auth rest realtime kong functions)

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Falta ${ENV_FILE}. Executa ./generate-env.sh e configura SMTP e Google OAuth." >&2
  exit 1
fi

mode="$(stat -c '%a' "${ENV_FILE}")"
if [[ "${mode}" != "600" ]]; then
  echo "${ENV_FILE} tem permissões ${mode}; são obrigatórias permissões 600." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

required=(CRM_DOMAIN CRM_API_PORT POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY SECRET_KEY_BASE REALTIME_DB_ENC_KEY TOKEN_ENCRYPTION_KEY SMTP_ADMIN_EMAIL SMTP_HOST SMTP_PORT GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET)
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Configuração obrigatória em falta: ${key}" >&2
    exit 1
  fi
done

if [[ "${CRM_DOMAIN}" == "localhost" || "${CRM_DOMAIN}" == 127.* ]]; then
  echo "CRM_DOMAIN tem de ser um domínio público de produção." >&2
  exit 1
fi

command -v docker >/dev/null || { echo "Docker é obrigatório." >&2; exit 1; }
command -v curl >/dev/null || { echo "curl é obrigatório." >&2; exit 1; }
docker info >/dev/null
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up -d --wait "${SERVICES[@]}"

"${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
create schema if not exists nikufra_meta;
revoke all on schema nikufra_meta from public, anon, authenticated;
create table if not exists nikufra_meta.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
SQL

for migration in "${PROJECT_DIR}"/supabase/migrations/*.sql; do
  name="$(basename "${migration}")"
  applied="$("${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc "select 1 from nikufra_meta.schema_migrations where name = '${name}'")"
  if [[ "${applied}" == "1" ]]; then
    continue
  fi
  echo "A aplicar ${name}"
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "${migration}"
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "insert into nikufra_meta.schema_migrations(name) values ('${name}')" >/dev/null
done

sync_url="https://${CRM_DOMAIN}/functions/v1/gmail-sync"
"${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  --set=sync_url="${sync_url}" --set=service_key="${SERVICE_ROLE_KEY}" <<'SQL'
select vault.create_secret(:'sync_url', 'gmail_sync_url')
where not exists (select 1 from vault.secrets where name = 'gmail_sync_url');
select vault.update_secret(id, :'sync_url') from vault.secrets where name = 'gmail_sync_url';
select vault.create_secret(:'service_key', 'gmail_sync_service_key')
where not exists (select 1 from vault.secrets where name = 'gmail_sync_service_key');
select vault.update_secret(id, :'service_key') from vault.secrets where name = 'gmail_sync_service_key';
notify pgrst, 'reload schema';
SQL

curl --fail --silent --show-error \
  -H "apikey: ${ANON_KEY}" \
  "http://127.0.0.1:${CRM_API_PORT}/auth/v1/health" >/dev/null
curl --fail --silent --show-error \
  -H "apikey: ${ANON_KEY}" \
  "http://127.0.0.1:${CRM_API_PORT}/rest/v1/profiles?select=id&limit=0" >/dev/null

"${COMPOSE[@]}" ps
echo "Backend Nikufra CRM pronto em 127.0.0.1:${CRM_API_PORT}; publica-o apenas através de HTTPS no proxy existente."

