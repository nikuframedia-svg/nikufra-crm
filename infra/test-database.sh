#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
bootstrap=false

case "${1:-}" in
  "") ;;
  --bootstrap) bootstrap=true ;;
  *) echo "Uso: $0 [--bootstrap]" >&2; exit 2 ;;
esac

if [[ "${bootstrap}" == true ]]; then
  "${SCRIPT_DIR}/local-up.sh"
fi

[[ -f "${ENV_FILE}" ]] || {
  echo "Falta ${ENV_FILE}; executa com --bootstrap ou usa pnpm local:configure." >&2
  exit 1
}

DOCKER_BIN="$(command -v docker || true)"
if [[ -z "${DOCKER_BIN}" && -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
  DOCKER_BIN=/Applications/Docker.app/Contents/Resources/bin/docker
fi
[[ -n "${DOCKER_BIN}" ]] || { echo "Docker é obrigatório." >&2; exit 1; }

DOCKER_CONFIG_DIR="${TMPDIR:-/tmp}/nikufra-crm-docker-anonymous"
mkdir -p "${DOCKER_CONFIG_DIR}/cli-plugins"
printf '%s\n' '{"auths":{}}' > "${DOCKER_CONFIG_DIR}/config.json"
if [[ ! -e "${DOCKER_CONFIG_DIR}/cli-plugins/docker-compose" && -x /Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose ]]; then
  ln -s /Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose "${DOCKER_CONFIG_DIR}/cli-plugins/docker-compose"
fi
export DOCKER_CONFIG="${DOCKER_CONFIG_DIR}"
if [[ -S "${HOME}/.docker/run/docker.sock" ]]; then
  export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"
fi

COMPOSE=("${DOCKER_BIN}" compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.local.yml")
[[ "$("${COMPOSE[@]}" ps --status running --services db)" == db ]] || {
  echo "A base local não está ativa; executa com --bootstrap." >&2
  exit 1
}

for test_file in "${PROJECT_DIR}"/supabase/tests/*.sql; do
  echo "A testar $(basename "${test_file}")"
  tap_output="$(mktemp "${TMPDIR:-/tmp}/nikufra-pgtap.XXXXXX")"
  if ! "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
      < "${test_file}" 2>&1 | tee "${tap_output}"; then
    rm -f -- "${tap_output}"
    exit 1
  fi
  # pgTAP reports assertion failures as TAP diagnostics while psql itself still
  # exits successfully. Treat either form as a hard test failure so CI cannot
  # publish a release whose SQL executed but whose invariants did not hold.
  if grep -Eq '(^|[[:space:]])not ok [0-9]+|# Looks like you failed' "${tap_output}"; then
    echo "Falharam assertions pgTAP em $(basename "${test_file}")." >&2
    rm -f -- "${tap_output}"
    exit 1
  fi
  rm -f -- "${tap_output}"
done

echo "Testes SQL concluídos com RLS, roles e invariantes validados."
