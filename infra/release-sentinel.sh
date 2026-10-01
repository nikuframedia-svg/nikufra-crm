#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
SENTINEL_MODE="${1:---full}"
(( $# <= 1 )) || { echo "Uso: $0 [--full|--local-dark]" >&2; exit 2; }
case "${SENTINEL_MODE}" in
  --full|--local-dark) ;;
  *) echo "Modo de sentinel inválido: ${SENTINEL_MODE}" >&2; exit 2 ;;
esac
OUTREACH_IMAGE_ARCHIVE="${PROJECT_DIR}/.outreach-image.tar"
OUTREACH_IMAGE_CHECKSUM="${PROJECT_DIR}/.outreach-image.sha256"
OUTREACH_IMAGE_ID="${PROJECT_DIR}/.outreach-image.id"
OUTREACH_IMAGE_REF="${PROJECT_DIR}/.outreach-image.ref"
CORE_IMAGE_MANIFEST="${PROJECT_DIR}/.core-images.manifest"
CORE_IMAGE_CHECKSUM="${PROJECT_DIR}/.core-images.sha256"

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
[[ "$(stat -c '%a' "${ENV_FILE}")" == 600 ]] || { echo "${ENV_FILE} tem de estar em modo 600." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker e obrigatorio." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 e obrigatorio." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

db_scalar() {
  if (( $# > 0 )); then
    "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc "$1"
  else
    "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -At
  fi
}

compose_image_ref() {
  local service="$1"
  "${COMPOSE[@]}" config --format json | python3 -c '
import json
import sys
config = json.load(sys.stdin)
image = config.get("services", {}).get(sys.argv[1], {}).get("image")
if not isinstance(image, str) or not image:
    raise SystemExit(f"Imagem Compose em falta para {sys.argv[1]}")
print(image)
' "${service}"
}

# The running API and worker must both come from the content-addressed image of
# this exact release. Schema compatibility alone is not enough to prove a
# backend rollback selected the requested code.
[[ -f "${PROJECT_DIR}/.release-id" && ! -L "${PROJECT_DIR}/.release-id" ]] || {
  echo "Sentinel recusado: identidade da release ausente ou insegura." >&2
  exit 1
}
outreach_release_id="$(< "${PROJECT_DIR}/.release-id")"
[[ "${outreach_release_id}" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || {
  echo "Sentinel recusado: identidade da release inválida." >&2
  exit 1
}
export OUTREACH_IMAGE_TAG="release-${outreach_release_id}"
expected_outreach_image="nikufra-outreach:${OUTREACH_IMAGE_TAG}"

for artifact in "${OUTREACH_IMAGE_ARCHIVE}" "${OUTREACH_IMAGE_CHECKSUM}" "${OUTREACH_IMAGE_ID}" "${OUTREACH_IMAGE_REF}"; do
  [[ -f "${artifact}" && ! -L "${artifact}" ]] || {
    echo "Sentinel recusado: artefacto de imagem ausente ou inseguro: ${artifact}." >&2
    exit 1
  }
done
expected_archive_checksum="$(< "${OUTREACH_IMAGE_CHECKSUM}")"
expected_outreach_image_id="$(< "${OUTREACH_IMAGE_ID}")"
stored_outreach_image_ref="$(< "${OUTREACH_IMAGE_REF}")"
[[ "${expected_archive_checksum}" =~ ^[0-9a-f]{64}$ \
  && "$(sha256_file "${OUTREACH_IMAGE_ARCHIVE}")" == "${expected_archive_checksum}" ]] || {
  echo "Sentinel recusado: checksum do archive Outreach diverge." >&2
  exit 1
}
[[ "${expected_outreach_image_id}" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "Sentinel recusado: Image ID Outreach inválido." >&2
  exit 1
}
[[ "${stored_outreach_image_ref}" == "${expected_outreach_image}" ]] || {
  echo "Sentinel recusado: referência Outreach não corresponde às fontes da release." >&2
  exit 1
}
tagged_outreach_image_id="$(docker image inspect --format '{{.Id}}' "${expected_outreach_image}")"
[[ "${tagged_outreach_image_id}" == "${expected_outreach_image_id}" ]] || {
  echo "Sentinel recusado: ${expected_outreach_image} aponta para ${tagged_outreach_image_id}, esperado ${expected_outreach_image_id}." >&2
  exit 1
}

"${COMPOSE[@]}" config --quiet

[[ -f "${CORE_IMAGE_MANIFEST}" && ! -L "${CORE_IMAGE_MANIFEST}" \
  && -f "${CORE_IMAGE_CHECKSUM}" && ! -L "${CORE_IMAGE_CHECKSUM}" ]] || {
  echo "Sentinel recusado: manifest de imagens core ausente ou inseguro." >&2
  exit 1
}
core_expected_checksum="$(< "${CORE_IMAGE_CHECKSUM}")"
[[ "${core_expected_checksum}" =~ ^[0-9a-f]{64}$ \
  && "$(sha256_file "${CORE_IMAGE_MANIFEST}")" == "${core_expected_checksum}" ]] || {
  echo "Sentinel recusado: checksum do manifest de imagens core diverge." >&2
  exit 1
}
core_seen=" "
core_count=0
while IFS='|' read -r service compose_ref image_id release_alias extra; do
  [[ -z "${extra}" && "${service}" =~ ^(auth|rest|realtime|kong|functions)$ \
    && "${compose_ref}" =~ ^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,240}$ \
    && "${image_id}" =~ ^sha256:[0-9a-f]{64}$ \
    && "${release_alias}" == "nikufra-core-${service}:release-${outreach_release_id}" \
    && "${core_seen}" != *" ${service} "* ]] || {
    echo "Sentinel recusado: linha core inválida para ${service:-missing}." >&2
    exit 1
  }
  [[ "$(compose_image_ref "${service}")" == "${compose_ref}" ]] || {
    echo "Sentinel recusado: ref Compose de ${service} diverge do manifest." >&2
    exit 1
  }
  alias_image_id="$(docker image inspect --format '{{.Id}}' "${release_alias}")"
  [[ "${alias_image_id}" == "${image_id}" ]] || {
    echo "Sentinel recusado: alias core de ${service} diverge." >&2
    exit 1
  }
  pin_name="nikufra-core-pin-${service}-${outreach_release_id}"
  [[ "$(docker inspect --format '{{.Image}}' "${pin_name}")" == "${image_id}" ]] || {
    echo "Sentinel recusado: pin core de ${service} diverge." >&2
    exit 1
  }
  container_id="$("${COMPOSE[@]}" ps -q "${service}")"
  [[ -n "${container_id}" \
    && "$(docker inspect --format '{{.State.Running}}' "${container_id}")" == true \
    && "$(docker inspect --format '{{.Config.Image}}' "${container_id}")" == "${compose_ref}" \
    && "$(docker inspect --format '{{.Image}}' "${container_id}")" == "${image_id}" ]] || {
    echo "Sentinel recusado: runtime core de ${service} não corresponde à release." >&2
    exit 1
  }
  if [[ "${service}" =~ ^(auth|realtime|kong)$ \
    && "$(docker inspect --format '{{.State.Health.Status}}' "${container_id}")" != healthy ]]; then
    echo "Sentinel recusado: health core de ${service} não está healthy." >&2
    exit 1
  fi
  core_seen+="${service} "
  (( core_count += 1 ))
done < "${CORE_IMAGE_MANIFEST}"
[[ "${core_count}" == 5 ]] || { echo "Sentinel recusado: manifest core incompleto." >&2; exit 1; }

for service in outreach-api outreach-worker; do
  container_id="$("${COMPOSE[@]}" ps -q "${service}")"
  [[ -n "${container_id}" ]] || { echo "Sentinel recusado: ${service} não está em execução." >&2; exit 1; }
  configured_image="$(docker inspect --format '{{.Config.Image}}' "${container_id}")"
  running_image_id="$(docker inspect --format '{{.Image}}' "${container_id}")"
  [[ "${configured_image}" == "${expected_outreach_image}" \
    && "${running_image_id}" == "${expected_outreach_image_id}" ]] || {
    echo "Sentinel recusado: ${service} usa ${configured_image}/${running_image_id}, esperado ${expected_outreach_image}/${expected_outreach_image_id}." >&2
    exit 1
  }
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
  [[ "${health}" == healthy ]] || { echo "Sentinel recusado: ${service} não está healthy (${health})." >&2; exit 1; }
  send_enabled="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${container_id}" | sed -n 's/^OUTREACH_SEND_ENABLED=//p')"
  shadow_mode="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${container_id}" | sed -n 's/^OUTREACH_SHADOW_MODE=//p')"
  [[ "${send_enabled}" == false && "${shadow_mode}" == true ]] || {
    echo "Sentinel recusado: gates runtime de ${service} não estão false/true." >&2
    exit 1
  }
done

found_migration=false
for migration in "${PROJECT_DIR}"/supabase/migrations/*.sql; do
  [[ -f "${migration}" ]] || continue
  found_migration=true
  name="$(basename "${migration}")"
  [[ "${name}" =~ ^[0-9]{12}_[A-Za-z0-9_.-]+\.sql$ ]] || { echo "Nome de migration recusado: ${name}" >&2; exit 1; }
  expected="$(sha256_file "${migration}")"
  actual="$(db_scalar "select checksum_sha256 from nikufra_meta.schema_migrations where name='${name}'")"
  [[ -n "${actual}" && "${actual}" == "${expected}" ]] || {
    echo "Sentinel recusado: ledger/checksum diverge para ${name}." >&2
    exit 1
  }
done
[[ "${found_migration}" == true ]] || { echo "Nenhuma migration encontrada." >&2; exit 1; }
[[ "$(db_scalar 'select count(*) from nikufra_meta.schema_migrations where checksum_sha256 is null')" == 0 ]] || {
  echo "Sentinel recusado: existem migrations sem checksum." >&2
  exit 1
}

schema_sentinel="$(db_scalar <<'SQL'
select
  to_regclass('public.profiles') is not null
  and to_regclass('public.empresas') is not null
  and to_regclass('public.contactos') is not null
  and to_regclass('public.outreach_campaigns') is not null
  and to_regclass('public.communication_suppressions') is not null
  and to_regclass('private.outreach_credentials') is not null
  and to_regprocedure('public.has_outreach_capability(text)') is not null
  and to_regprocedure('public.claim_google_provider_message(text,text)') is not null
  and to_regprocedure('private.outreach_mailbox_live_ready(uuid,timestamp with time zone)') is not null
  and to_regprocedure('private.outreach_transition_system(public.outreach_system_mode,uuid,boolean,text)') is not null;
SQL
)"
[[ "${schema_sentinel}" == t ]] || { echo "Sentinel recusado: schema de producao incompleto." >&2; exit 1; }

roles_hardened="$(db_scalar <<'SQL'
select
  exists (
    select 1 from pg_roles role
    where role.rolname='outreach_service'
      and role.rolcanlogin and not role.rolsuper and not role.rolinherit
      and not role.rolbypassrls and not role.rolcreatedb
      and not role.rolcreaterole and not role.rolreplication
      and not exists (select 1 from pg_auth_members membership where membership.member=role.oid)
  )
  and exists (
    select 1 from pg_roles role
    where role.rolname='nikufra_wal'
      and role.rolcanlogin and role.rolreplication and not role.rolsuper
      and not role.rolinherit and not role.rolbypassrls
      and not role.rolcreatedb and not role.rolcreaterole
      and not exists (select 1 from pg_auth_members membership where membership.member=role.oid)
  );
SQL
)"
[[ "${roles_hardened}" == t ]] || { echo "Sentinel recusado: roles operacionais nao estao endurecidas." >&2; exit 1; }

if [[ "${SENTINEL_MODE}" == --local-dark ]]; then
  curl --fail --silent --show-error --max-time 10 \
    "http://127.0.0.1:${OUTREACH_API_PORT:-8787}/healthz" >/dev/null
  unauthenticated="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \
    "http://127.0.0.1:${OUTREACH_API_PORT:-8787}/api/outreach/v1/overview")"
  [[ "${unauthenticated}" == 401 ]] || {
    echo "Sentinel recusado: API local sem auth devolveu ${unauthenticated}, esperado 401." >&2
    exit 1
  }
  [[ "$(db_scalar "select mode || ':' || send_enabled::text from public.outreach_system_state where id")" == disabled:false ]] || {
    echo "Sentinel recusado: DB não está disabled:false." >&2
    exit 1
  }
  echo "RELEASE_SENTINEL_LOCAL_DARK_OK"
  exit 0
fi

# The full publish gate is deliberately read-only with respect to production:
# public health, exact allowlist and the real offsite backup are observed again
# before a newly published frontend can be selected.
NIKUFRA_BACKUP_ROOT="${NIKUFRA_BACKUP_ROOT:-/home/luis/services/nikufra-crm/backups}" \
  "${SCRIPT_DIR}/outreach-readiness.sh" --dark

echo "RELEASE_SENTINEL_OK"
