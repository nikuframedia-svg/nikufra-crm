#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_BIN="$(command -v docker || true)"
if [[ -z "${DOCKER_BIN}" && -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
  DOCKER_BIN=/Applications/Docker.app/Contents/Resources/bin/docker
fi
if [[ -z "${DOCKER_BIN}" ]]; then
  echo "Docker não encontrado. Abre o Docker Desktop e conclui a primeira configuração." >&2
  exit 1
fi

# O helper de credenciais do Docker Desktop pode bloquear a primeira leitura de
# imagens públicas. Este perfil anónimo é isolado e não altera logins do utilizador.
DOCKER_CONFIG_DIR="${TMPDIR:-/tmp}/nikufra-crm-docker-anonymous"
mkdir -p "${DOCKER_CONFIG_DIR}"
printf '%s\n' '{"auths":{}}' > "${DOCKER_CONFIG_DIR}/config.json"
mkdir -p "${DOCKER_CONFIG_DIR}/cli-plugins"
if [[ ! -e "${DOCKER_CONFIG_DIR}/cli-plugins/docker-compose" && -x /Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose ]]; then
  ln -s /Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose "${DOCKER_CONFIG_DIR}/cli-plugins/docker-compose"
fi
export DOCKER_CONFIG="${DOCKER_CONFIG_DIR}"
export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"

if ! "${DOCKER_BIN}" info >/dev/null 2>&1; then
  echo "Docker Desktop ainda não está pronto. Abre-o e aguarda até indicar que o motor arrancou." >&2
  exit 1
fi

"${SCRIPT_DIR}/configure-local.sh"

COMPOSE=("${DOCKER_BIN}" compose --env-file "${SCRIPT_DIR}/.env" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.local.yml")
SERVICES=(db auth rest realtime meta studio kong functions mailpit)
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

set -a
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/.env"
set +a
"${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  --set=service_key="${SERVICE_ROLE_KEY}" <<'SQL'
select vault.create_secret('http://kong:8000/functions/v1/gmail-sync', 'gmail_sync_url')
where not exists (select 1 from vault.secrets where name = 'gmail_sync_url');
select vault.create_secret(:'service_key', 'gmail_sync_service_key')
where not exists (select 1 from vault.secrets where name = 'gmail_sync_service_key');
notify pgrst, 'reload schema';
SQL

echo "Nikufra CRM local pronto:"
echo "  API:       http://127.0.0.1:8000"
echo "  Magic link local: http://127.0.0.1:8025"
echo "  App web:   http://127.0.0.1:1420"
