#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
action="${1:-status}"

pin_release_image() {
  local release_file="${SCRIPT_DIR}/../.release-id" release_id
  [[ -f "${release_file}" && ! -L "${release_file}" ]] || return 0
  release_id="$(< "${release_file}")"
  [[ "${release_id}" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || {
    echo "Identidade da release inválida para tag Outreach." >&2
    return 1
  }
  export OUTREACH_IMAGE_TAG="release-${release_id}"
}

pin_release_image

set_env() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "${ENV_FILE}"; then
    KEY_NAME="${key}" KEY_VALUE="${value}" perl -0pi -e 's/^\Q$ENV{KEY_NAME}\E=.*$/$ENV{KEY_NAME}=$ENV{KEY_VALUE}/m' "${ENV_FILE}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
  chmod 600 "${ENV_FILE}"
  [[ "$(sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -1)" == "${value}" ]] || {
    echo "ERRO: não foi possível persistir ${key}." >&2
    return 1
  }
}

db_mode() {
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc \
    "select mode || ':' || send_enabled::text from public.outreach_system_state where id = true"
}

case "${action}" in
  status)
    set -a; source "${ENV_FILE}"; set +a
    pin_release_image
    printf 'env_send_enabled=%s\nenv_shadow_mode=%s\ndb_mode=%s\n' \
      "${OUTREACH_SEND_ENABLED:-false}" "${OUTREACH_SHADOW_MODE:-true}" "$(db_mode)"
    "${COMPOSE[@]}" ps outreach-api outreach-worker
    ;;
  disable)
    # Both the worker and API can deliver mail (scheduled jobs and manual
    # replies). Cut both execution paths before touching either persistent gate.
    if ! "${COMPOSE[@]}" stop outreach-worker outreach-api; then
      "${COMPOSE[@]}" kill outreach-worker outreach-api >/dev/null 2>&1 || true
    fi
    running_senders="$("${COMPOSE[@]}" ps --status running --services outreach-api outreach-worker)"
    [[ -z "${running_senders}" ]] || {
      echo "ERRO: o kill switch não conseguiu parar: ${running_senders//$'\n'/, }. Bloqueia estes contentores no host; não é seguro reportar disable concluído." >&2
      exit 1
    }
    set_env OUTREACH_SEND_ENABLED false
    set_env OUTREACH_SHADOW_MODE true
    if ! "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
      "select mode, send_enabled from private.outreach_transition_system('disabled', null, false, 'kill_switch_operacional')"; then
      # Recreate only the API with the process-level gate off. The worker stays
      # stopped until the persisted DB state can also be made fail-closed.
      "${COMPOSE[@]}" up -d --no-deps --force-recreate --wait outreach-api || true
      echo "ERRO: o worker ficou PARADO e a API só pode arrancar com OUTREACH_SEND_ENABLED=false, mas a base não confirmou disabled. Recupera PostgreSQL e repete '$0 disable'; não reinicies o worker manualmente." >&2
      exit 1
    fi
    "${COMPOSE[@]}" up -d --no-deps --force-recreate --wait outreach-api outreach-worker
    [[ "$(db_mode)" == "disabled:false" ]] || { echo "ERRO: o hard gate persistido deixou de estar disabled:false." >&2; exit 1; }
    "${SCRIPT_DIR}/outreach-readiness.sh" --dark
    echo "Kill switch aplicado: outbound desligado; inbound e unsubscribe permanecem ativos."
    ;;
  canary)
    echo "O canary só pode ser promovido depois do readiness e da validação manual. Usa: $0 canary --approve-canary <profile-uuid>" >&2
    [[ "${2:-}" == "--approve-canary" && "${3:-}" =~ ^[0-9a-fA-F-]{36}$ ]] || exit 2
    "${SCRIPT_DIR}/outreach-readiness.sh" --for-canary
    "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
      --set=approver="${3}" <<'SQL'
select mode, send_enabled, canary_started_at
from private.outreach_transition_system('canary', :'approver'::uuid, false, 'canary manual aprovado');
SQL
    set_env OUTREACH_SEND_ENABLED true
    set_env OUTREACH_SHADOW_MODE false
    "${COMPOSE[@]}" up -d --no-deps --force-recreate --wait outreach-api outreach-worker
    echo "Canary ativo apenas para a allowlist configurada."
    ;;
  live)
    echo "A promoção live exige aprovação administrativa explícita: $0 live --approve-live <profile-uuid>" >&2
    [[ "${2:-}" == "--approve-live" && "${3:-}" =~ ^[0-9a-fA-F-]{36}$ ]] || exit 2
    "${SCRIPT_DIR}/outreach-readiness.sh" --for-live
    "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres --set=approver="${3}" <<'SQL'
select mode, send_enabled, approved_at
from private.outreach_transition_system('live', :'approver'::uuid, true, 'ativação live aprovada');
SQL
    [[ "$(db_mode)" == "live:true" ]] || { echo "A promoção foi recusada: o perfil não é um administrador CRM ativo." >&2; exit 1; }
    set_env OUTREACH_SEND_ENABLED true
    set_env OUTREACH_SHADOW_MODE false
    "${COMPOSE[@]}" up -d --no-deps --force-recreate --wait outreach-api outreach-worker
    echo "Outreach promovido para live."
    ;;
  *)
    echo "Uso: $0 {status|disable|canary --approve-canary <profile-uuid>|live --approve-live <profile-uuid>}" >&2
    exit 2
    ;;
esac
