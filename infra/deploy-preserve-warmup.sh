#!/usr/bin/env bash
set -Eeuo pipefail

# Code-only canary release. The worker remains the same process, so its
# heartbeat continuity and the mailbox ramps are never reset by a deploy.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
[[ -f "${PROJECT_DIR}/.release-id" && -f "${ENV_FILE}" ]] || { echo "Release/env ausente." >&2; exit 1; }
[[ "$(stat -c '%a' "${ENV_FILE}")" == 600 ]] || { echo "Env inseguro." >&2; exit 1; }
release_id="$(< "${PROJECT_DIR}/.release-id")"
[[ "${release_id}" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || { echo "Release ID inválido." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
export OUTREACH_IMAGE_TAG="release-${release_id}"
[[ "${OUTREACH_SEND_ENABLED:-}" == true && "${OUTREACH_SHADOW_MODE:-}" == false \
  && "${OUTREACH_WORKER_IMAGE_TAG:-}" =~ ^release-[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || {
  echo "Release preserve recusada: gates ou imagem do worker inválidos." >&2; exit 1;
}
COMPOSE=(docker compose --project-name nikufra-crm --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
"${COMPOSE[@]}" config --quiet
db_scalar() { "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc "$1"; }
[[ "$(db_scalar "select mode || ':' || send_enabled::text from public.outreach_system_state where id")" == canary:true ]] || {
  echo "Release preserve recusada: DB não está canary:true." >&2; exit 1;
}
worker_id="$("${COMPOSE[@]}" ps -q outreach-worker)"
[[ -n "${worker_id}" \
  && "$(docker inspect --format '{{.State.Health.Status}}' "${worker_id}")" == healthy \
  && "$(docker inspect --format '{{.Config.Image}}' "${worker_id}")" == "$(< "${PROJECT_DIR}/.preserved-worker-image.ref")" \
  && "$(docker inspect --format '{{.Image}}' "${worker_id}")" == "$(< "${PROJECT_DIR}/.preserved-worker-image.id")" ]] || {
  echo "Release preserve recusada: worker atual não corresponde à imagem guardada." >&2; exit 1;
}
state_before="$(db_scalar "select canary_started_at::text || '|' || worker_continuous_since::text from public.outreach_system_state where id")"
mailboxes_before="$(db_scalar "select coalesce(jsonb_agg(jsonb_build_object('id',id,'ramp',ramp_daily_limit,'started',ramp_started_at) order by id),'[]'::jsonb)::text from public.outreach_mailboxes where send_enabled")"
[[ -n "${state_before}" && -n "${mailboxes_before}" ]] || { echo "Snapshot de aquecimento vazio." >&2; exit 1; }

# Build fully before touching any live process. Only the API and Edge Functions
# change in this release; Compose is forbidden from recreating dependencies.
"${COMPOSE[@]}" build outreach-api
"${COMPOSE[@]}" up -d --no-deps --no-build --pull never --force-recreate --wait functions
"${COMPOSE[@]}" up -d --no-deps --no-build --pull never --force-recreate --wait outreach-api

[[ "$("${COMPOSE[@]}" ps -q outreach-worker)" == "${worker_id}" \
  && "$(docker inspect --format '{{.State.Health.Status}}' "${worker_id}")" == healthy ]] || {
  echo "Release preserve falhou: o worker foi substituído ou perdeu saúde." >&2; exit 1;
}
[[ "$(db_scalar "select mode || ':' || send_enabled::text from public.outreach_system_state where id")" == canary:true \
  && "$(db_scalar "select canary_started_at::text || '|' || worker_continuous_since::text from public.outreach_system_state where id")" == "${state_before}" ]] || {
  echo "Release preserve falhou: estado/continuidade do canary mudou." >&2; exit 1;
}
mailboxes_after="$(db_scalar "select coalesce(jsonb_agg(jsonb_build_object('id',id,'ramp',ramp_daily_limit,'started',ramp_started_at) order by id),'[]'::jsonb)::text from public.outreach_mailboxes where send_enabled")"
python3 - "${mailboxes_before}" "${mailboxes_after}" <<'PY'
import json
import sys

before = {row["id"]: row for row in json.loads(sys.argv[1])}
after = {row["id"]: row for row in json.loads(sys.argv[2])}
if before.keys() != after.keys():
    raise SystemExit("Release preserve falhou: conjunto de mailboxes mudou.")
for mailbox_id, previous in before.items():
    current = after[mailbox_id]
    if current["ramp"] < previous["ramp"] or (current["ramp"] == previous["ramp"] and current["started"] != previous["started"]):
        raise SystemExit(f"Release preserve falhou: ramp reiniciou para {mailbox_id}.")
PY

curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${OUTREACH_API_PORT:-8787}/healthz" >/dev/null
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \
  "https://${CRM_DOMAIN}/api/outreach/v1/overview")" == 401 ]] || {
  echo "Release preserve falhou: rota pública Outreach não exige sessão." >&2; exit 1;
}
echo "PRESERVE_WARMUP_DEPLOY_OK ${release_id}"
