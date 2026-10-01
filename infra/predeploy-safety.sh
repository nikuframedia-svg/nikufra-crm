#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

disk_used="$(df -P / | awk 'NR==2 {gsub("%", "", $5); print $5}')"
if (( disk_used >= 80 )); then
  echo "O disco está em ${disk_used}%; o deploy exige menos de 80%." >&2
  exit 1
fi

if [[ "${OUTREACH_SEND_ENABLED:-false}" != "false" ]]; then
  echo "O deploy inicial exige OUTREACH_SEND_ENABLED=false." >&2
  exit 1
fi

running_outreach="$("${COMPOSE[@]}" ps --status running --services outreach-api outreach-worker)"
if [[ -n "${running_outreach}" ]]; then
  echo "API/worker Outreach ainda estão ativos durante o preflight: ${running_outreach//$'\n'/, }." >&2
  exit 1
fi

# The frozen standalone sender must never coexist with the unified worker.
# Match only running Docker workloads and exclude this CRM compose project.
legacy_outreach_running="$(docker ps --format '{{.Names}}' \
  | grep -Ei '(^|[-_])nikufra[-_]outreach|outreach[-_](sender|worker|api)' \
  | grep -Ev '^nikufra-crm-outreach-(api|worker)-[0-9]+$' || true)"
if [[ -n "${legacy_outreach_running}" ]]; then
  echo "Foi encontrado um Outreach standalone ativo: ${legacy_outreach_running//$'\n'/, }. Congela-o antes do deploy." >&2
  exit 1
fi

state_table_installed="$("${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc \
  "select to_regclass('public.outreach_system_state') is not null")"
if [[ "${state_table_installed}" == t ]]; then
  persisted_state="$("${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc \
    "select mode::text || ':' || send_enabled::text from public.outreach_system_state where id=true")"
else
  persisted_state=not-installed
fi
if [[ "${persisted_state}" != "not-installed" && "${persisted_state}" != "disabled:false" ]]; then
  echo "O hard gate persistido não está desligado (${persisted_state})." >&2
  exit 1
fi

"${SCRIPT_DIR}/backup-production.sh"
"${SCRIPT_DIR}/restore-drill.sh"

echo "Preflight aprovado: disco ${disk_used}%, backup offsite e restauro integral comprovados antes das migrations."
