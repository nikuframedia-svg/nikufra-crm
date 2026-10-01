#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_LOCK="${NIKUFRA_LOCAL_DEPLOY_LOCK:-/tmp/nikufra-crm-local-deploy.lock.d}"
acquire_deploy_lock() {
  if mkdir "${DEPLOY_LOCK}" 2>/dev/null; then
    printf '%s\n' "$$" > "${DEPLOY_LOCK}/pid"
    return
  fi
  local holder=""
  holder="$(cat "${DEPLOY_LOCK}/pid" 2>/dev/null || true)"
  if [[ "${holder}" =~ ^[0-9]+$ ]] && kill -0 "${holder}" 2>/dev/null; then
    echo "Já existe um arranque/migração local do Nikufra CRM em execução (PID ${holder})." >&2
    exit 1
  fi
  rm -f -- "${DEPLOY_LOCK}/pid"
  rmdir -- "${DEPLOY_LOCK}" 2>/dev/null || { echo "Lock local inválido: ${DEPLOY_LOCK}" >&2; exit 1; }
  mkdir "${DEPLOY_LOCK}"
  printf '%s\n' "$$" > "${DEPLOY_LOCK}/pid"
}
release_deploy_lock() {
  rm -f -- "${DEPLOY_LOCK}/pid"
  rmdir -- "${DEPLOY_LOCK}" 2>/dev/null || true
}
acquire_deploy_lock
trap release_deploy_lock EXIT
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
if [[ -S "${HOME}/.docker/run/docker.sock" ]]; then
  export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"
fi

if ! "${DOCKER_BIN}" info >/dev/null 2>&1; then
  echo "Docker Desktop ainda não está pronto. Abre-o e aguarda até indicar que o motor arrancou." >&2
  exit 1
fi

"${SCRIPT_DIR}/configure-local.sh"
"${SCRIPT_DIR}/configure-outreach.sh"
NIKUFRA_DOCKER_BIN="${DOCKER_BIN}" "${SCRIPT_DIR}/configure-pgsodium.sh"

COMPOSE=("${DOCKER_BIN}" compose --env-file "${SCRIPT_DIR}/.env" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.local.yml")
# Studio and Postgres Meta are administrative development tools, not required
# by the CRM itself. Keeping them out saves roughly 2.2 GB on each Mac.
SERVICES=(db auth rest realtime kong functions mailpit)
"${COMPOSE[@]}" up -d --wait "${SERVICES[@]}"
"${SCRIPT_DIR}/configure-outreach-db.sh" local

NIKUFRA_DOCKER_BIN="${DOCKER_BIN}" "${SCRIPT_DIR}/apply-migrations.sh" local

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

"${COMPOSE[@]}" up -d --build --wait outreach-api
"${COMPOSE[@]}" up -d --wait outreach-worker

echo "Nikufra CRM local pronto:"
echo "  API:       http://127.0.0.1:8000"
echo "  Magic link local: http://127.0.0.1:8025"
echo "  App web:   http://127.0.0.1:1420"
echo "  Outreach:  http://127.0.0.1:8787 (outbound desligado)"
