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
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/disk-safety.sh"

disk_max_percent="$(nikufra_disk_max_percent)"
disk_min_free_kib="$(nikufra_disk_min_free_kib)"
disk_min_free_gib="$(nikufra_disk_free_gib "${disk_min_free_kib}")"
read -r disk_available_kib disk_used < <(df -Pk / | awk 'NR==2 {gsub("%", "", $5); print $4, $5}')
disk_free_gib="$(nikufra_disk_free_gib "${disk_available_kib:-}")"
if ! nikufra_disk_is_safe "${disk_used:-}" "${disk_available_kib:-}" "${disk_max_percent}" "${disk_min_free_kib}"; then
  echo "Disco inseguro: ${disk_used:-desconhecido}% usado, ${disk_free_gib} GiB livres; exige <${disk_max_percent}% e >=${disk_min_free_gib} GiB livres." >&2
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

echo "Preflight aprovado: disco ${disk_used}% usado, ${disk_free_gib} GiB livres (limite <${disk_max_percent}% e mínimo ${disk_min_free_gib} GiB); backup offsite e restauro integral comprovados antes das migrations."
