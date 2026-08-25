#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_BIN="$(command -v docker || true)"
if [[ -z "${DOCKER_BIN}" && -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
  DOCKER_BIN=/Applications/Docker.app/Contents/Resources/bin/docker
fi
if [[ -z "${DOCKER_BIN}" ]]; then
  echo "Docker não encontrado." >&2
  exit 1
fi

DOCKER_CONFIG_DIR="${TMPDIR:-/tmp}/nikufra-crm-docker-anonymous"
mkdir -p "${DOCKER_CONFIG_DIR}"
printf '%s\n' '{"auths":{}}' > "${DOCKER_CONFIG_DIR}/config.json"
mkdir -p "${DOCKER_CONFIG_DIR}/cli-plugins"
if [[ ! -e "${DOCKER_CONFIG_DIR}/cli-plugins/docker-compose" && -x /Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose ]]; then
  ln -s /Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose "${DOCKER_CONFIG_DIR}/cli-plugins/docker-compose"
fi
export DOCKER_CONFIG="${DOCKER_CONFIG_DIR}"
export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"

"${DOCKER_BIN}" compose --env-file "${SCRIPT_DIR}/.env" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.local.yml" stop
