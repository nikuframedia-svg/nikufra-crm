#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
SERVICES=(db auth rest realtime kong functions)
DEPLOY_MODE="${1:---release}"
(( $# <= 1 )) || { echo "Uso: $0 [--release|--rollback-preloaded]" >&2; exit 2; }
case "${DEPLOY_MODE}" in
  --release|--rollback-preloaded) ;;
  *) echo "Modo de deploy inválido: ${DEPLOY_MODE}" >&2; exit 2 ;;
esac
DEPLOY_LOCK="${NIKUFRA_DEPLOY_LOCK:-/tmp/nikufra-crm-production-deploy.lock.d}"
acquire_deploy_lock() {
  if mkdir "${DEPLOY_LOCK}" 2>/dev/null; then
    printf '%s\n' "$$" > "${DEPLOY_LOCK}/pid"
    return
  fi
  local holder=""
  holder="$(cat "${DEPLOY_LOCK}/pid" 2>/dev/null || true)"
  if [[ "${holder}" =~ ^[0-9]+$ ]] && kill -0 "${holder}" 2>/dev/null; then
    echo "Já existe um deploy Nikufra em execução neste host (PID ${holder})." >&2
    exit 1
  fi
  rm -f -- "${DEPLOY_LOCK}/pid"
  rmdir -- "${DEPLOY_LOCK}" 2>/dev/null || { echo "Lock de deploy inválido: ${DEPLOY_LOCK}" >&2; exit 1; }
  mkdir "${DEPLOY_LOCK}"
  printf '%s\n' "$$" > "${DEPLOY_LOCK}/pid"
}
release_deploy_lock() {
  rm -f -- "${DEPLOY_LOCK}/pid"
  rmdir -- "${DEPLOY_LOCK}" 2>/dev/null || true
}
acquire_deploy_lock
trap release_deploy_lock EXIT

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Falta ${ENV_FILE}. Executa ./generate-env.sh e configura SMTP e Google OAuth." >&2
  exit 1
fi

mode="$(stat -c '%a' "${ENV_FILE}")"
if [[ "${mode}" != "600" ]]; then
  echo "${ENV_FILE} tem permissões ${mode}; são obrigatórias permissões 600." >&2
  exit 1
fi

if [[ "${DEPLOY_MODE}" == --release ]]; then
  "${SCRIPT_DIR}/configure-outreach.sh"
  "${SCRIPT_DIR}/configure-backups.sh"
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

valid_recent_pitr_report() {
  local report base elapsed target_lsn restored_lsn
  while IFS= read -r report; do
    base="$(sed -n 's/^base=//p' "${report}" | tail -1)"
    elapsed="$(sed -n 's/^elapsed_seconds=//p' "${report}" | tail -1)"
    target_lsn="$(sed -n 's/^target_lsn=//p' "${report}" | tail -1)"
    restored_lsn="$(sed -n 's/^restored_lsn=//p' "${report}" | tail -1)"
    if [[ "${base}" =~ ^base-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.tar\.gpg$ \
      && "${elapsed}" =~ ^[0-9]+$ && "${elapsed}" -le 14400 \
      && "${target_lsn}" =~ ^[0-9A-F]+/[0-9A-F]+$ \
      && "${restored_lsn}" =~ ^[0-9A-F]+/[0-9A-F]+$ \
      && "$(grep -c '^result=ok$' "${report}" || true)" == 1 \
      && "$(grep -c '^rpo_max_seconds=900$' "${report}" || true)" == 1 \
      && "$(grep -c '^rto_max_seconds=14400$' "${report}" || true)" == 1 ]]; then
      printf '%s\n' "${report}"
      return 0
    fi
  done < <(find "${NIKUFRA_BACKUP_ROOT:-/home/luis/services/nikufra-crm/backups}/pitr-drills" \
    -maxdepth 1 -type f -name '*.txt' -mtime -35 -print 2>/dev/null | sort -r)
  return 1
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

# Publisher-managed production releases get a unique tag even when identical
# sources are rebuilt after a mutable base image changes. The saved Image ID is
# still the authority; the source hash is only a direct/operator-run fallback.
if [[ -f "${PROJECT_DIR}/.release-id" && ! -L "${PROJECT_DIR}/.release-id" ]]; then
  outreach_release_id="$(< "${PROJECT_DIR}/.release-id")"
  [[ "${outreach_release_id}" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || {
    echo "Identidade da release inválida para tag Outreach." >&2
    exit 1
  }
  export OUTREACH_IMAGE_TAG="release-${outreach_release_id}"
else
  outreach_source_hash="$(
    {
      cd "${PROJECT_DIR}"
      find .dockerignore \
        services/outreach/Dockerfile \
        services/outreach/package.json \
        services/outreach/package-lock.json \
        services/outreach/tsconfig.json \
        services/outreach/src \
        -type f -print0 | sort -z | xargs -0 sha256sum
    } | sha256sum | cut -c1-16
  )"
  export OUTREACH_IMAGE_TAG="sha-${outreach_source_hash}"
fi

CRM_API_PORT="${CRM_API_PORT:-8800}"
if [[ "${DEPLOY_MODE}" == --rollback-preloaded ]]; then
  required=(CRM_DOMAIN POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY SECRET_KEY_BASE REALTIME_DB_ENC_KEY TOKEN_ENCRYPTION_KEY OUTREACH_DATABASE_PASSWORD OUTREACH_ENCRYPTION_KEYS OUTREACH_ENCRYPTION_CURRENT_VERSION OUTREACH_STATE_HMAC_SECRET OUTREACH_WEBHOOK_SECRET OUTREACH_UNSUBSCRIBE_SECRET OUTREACH_GOOGLE_CLIENT_ID OUTREACH_GOOGLE_CLIENT_SECRET OUTREACH_CANARY_ALLOWLIST)
else
  required=(CRM_DOMAIN POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY SECRET_KEY_BASE REALTIME_DB_ENC_KEY TOKEN_ENCRYPTION_KEY SMTP_ADMIN_EMAIL SMTP_HOST SMTP_PORT GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET OUTREACH_DATABASE_PASSWORD OUTREACH_ENCRYPTION_KEYS OUTREACH_ENCRYPTION_CURRENT_VERSION OUTREACH_STATE_HMAC_SECRET OUTREACH_WEBHOOK_SECRET OUTREACH_UNSUBSCRIBE_SECRET OUTREACH_GOOGLE_CLIENT_ID OUTREACH_GOOGLE_CLIENT_SECRET OUTREACH_CANARY_ALLOWLIST WAL_ARCHIVE_PASSWORD BACKUP_ENCRYPTION_KEY_FILE RCLONE_REMOTE)
fi
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Configuração obrigatória em falta: ${key}" >&2
    exit 1
  fi
done

if [[ "${AUTH_EMAIL_HOOK_ENABLED:-false}" == "true" && -z "${AUTH_EMAIL_HOOK_SECRET:-}" ]]; then
  echo "AUTH_EMAIL_HOOK_SECRET é obrigatório quando AUTH_EMAIL_HOOK_ENABLED=true" >&2
  exit 1
fi

if [[ "${CRM_DOMAIN}" == "localhost" || "${CRM_DOMAIN}" == 127.* ]]; then
  echo "CRM_DOMAIN tem de ser um domínio público de produção." >&2
  exit 1
fi

command -v docker >/dev/null || { echo "Docker é obrigatório." >&2; exit 1; }
command -v curl >/dev/null || { echo "curl é obrigatório." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 é obrigatório." >&2; exit 1; }
docker info >/dev/null
"${COMPOSE[@]}" config --quiet

if [[ "${DEPLOY_MODE}" == --rollback-preloaded ]]; then
  expected_image_id="${NIKUFRA_EXPECTED_OUTREACH_IMAGE_ID:-}"
  expected_image_ref="nikufra-outreach:${OUTREACH_IMAGE_TAG}"
  [[ "${expected_image_id}" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "Rollback recusado: NIKUFRA_EXPECTED_OUTREACH_IMAGE_ID inválido." >&2
    exit 1
  }
  local_image_id="$(docker image inspect --format '{{.Id}}' "${expected_image_ref}")"
  [[ "${local_image_id}" == "${expected_image_id}" ]] || {
    echo "Rollback recusado: ${expected_image_ref} aponta para ${local_image_id}, esperado ${expected_image_id}." >&2
    exit 1
  }

  for service in outreach-api outreach-worker; do
    target_image_ref="$(compose_image_ref "${service}")"
    [[ "${target_image_ref}" == "${expected_image_ref}" ]] || {
      echo "Rollback recusado: ${service} resolve ${target_image_ref}, esperado ${expected_image_ref}." >&2
      exit 1
    }
  done

  # Core images are not duplicated into large archives. Publishing creates a
  # unique per-release alias plus a stopped pin container. The pin protects the
  # exact ID from image-prune while present; this preflight remains the
  # authority and fails safely if broader cleanup removed it. Retag Compose
  # refs before downtime; running containers remain pinned to their old IDs.
  core_manifest="${PROJECT_DIR}/.core-images.manifest"
  core_checksum="${PROJECT_DIR}/.core-images.sha256"
  [[ -f "${core_manifest}" && ! -L "${core_manifest}" \
    && -f "${core_checksum}" && ! -L "${core_checksum}" ]] || {
    echo "Rollback recusado: manifest de imagens core ausente ou inseguro." >&2
    exit 1
  }
  core_expected_checksum="$(< "${core_checksum}")"
  [[ "${core_expected_checksum}" =~ ^[0-9a-f]{64}$ \
    && "$(sha256sum "${core_manifest}" | awk '{print $1}')" == "${core_expected_checksum}" ]] || {
    echo "Rollback recusado: checksum do manifest de imagens core diverge." >&2
    exit 1
  }
  core_seen=" "
  core_count=0
  while IFS='|' read -r service compose_ref image_id release_alias extra; do
    [[ -z "${extra}" && "${service}" =~ ^(auth|rest|realtime|kong|functions)$ \
      && "${image_id}" =~ ^sha256:[0-9a-f]{64}$ \
      && "${release_alias}" == "nikufra-core-${service}:release-${outreach_release_id}" \
      && "${core_seen}" != *" ${service} "* ]] || {
      echo "Rollback recusado: linha core inválida para ${service:-missing}." >&2
      exit 1
    }
    target_image_ref="$(compose_image_ref "${service}")"
    [[ "${target_image_ref}" == "${compose_ref}" ]] || {
      echo "Rollback recusado: ref Compose de ${service} diverge do manifest." >&2
      exit 1
    }
    if ! alias_image_id="$(docker image inspect --format '{{.Id}}' "${release_alias}" 2>/dev/null)"; then
      echo "Rollback recusado: alias local de ${service} ausente." >&2
      exit 1
    fi
    [[ "${alias_image_id}" == "${image_id}" ]] || {
      echo "Rollback recusado: alias de ${service} não preserva ${image_id}." >&2
      exit 1
    }
    pin_name="nikufra-core-pin-${service}-${outreach_release_id}"
    if ! pin_image_id="$(docker inspect --format '{{.Image}}' "${pin_name}" 2>/dev/null)"; then
      echo "Rollback recusado: pin container de ${service} ausente." >&2
      exit 1
    fi
    [[ "${pin_image_id}" == "${image_id}" ]] || {
      echo "Rollback recusado: pin container de ${service} diverge de ${image_id}." >&2
      exit 1
    }
    core_seen+="${service} "
    (( core_count += 1 ))
  done < "${core_manifest}"
  [[ "${core_count}" == 5 ]] || { echo "Rollback recusado: manifest core incompleto." >&2; exit 1; }

  # Only the database is an in-place dependency. Core application services may
  # be broken or absent because rollback recreates them from pinned local IDs.
  dependency_id="$("${COMPOSE[@]}" ps -q db)"
  [[ -n "${dependency_id}" \
    && "$(docker inspect --format '{{.State.Running}}' "${dependency_id}")" == true \
    && "$(docker inspect --format '{{.State.Health.Status}}' "${dependency_id}")" == healthy ]] || {
    echo "Rollback offline recusado: dependência db não está healthy." >&2
    exit 1
  }
  while IFS='|' read -r service compose_ref image_id release_alias extra; do
    docker image tag "${image_id}" "${compose_ref}"
    [[ "$(docker image inspect --format '{{.Id}}' "${compose_ref}")" == "${image_id}" ]] || {
      echo "Rollback recusado: não foi possível restaurar a ref de ${service}." >&2
      exit 1
    }
  done < "${core_manifest}"

  # This path is intentionally self-contained and offline: no configuration,
  # migrations, backups, schedules, public probes, builds, or registry pulls.
  if ! "${COMPOSE[@]}" stop outreach-worker outreach-api >/dev/null 2>&1; then
    "${COMPOSE[@]}" kill outreach-worker outreach-api >/dev/null 2>&1 || true
  fi
  running_senders="$("${COMPOSE[@]}" ps --status running --services outreach-api outreach-worker)"
  [[ -z "${running_senders}" ]] || {
    echo "Rollback recusado: senders ainda ativos: ${running_senders//$'\n'/, }." >&2
    exit 1
  }
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
do $$
begin
  if to_regclass('public.outreach_system_state') is not null then
    perform private.outreach_transition_system(
      'disabled', null, false, 'rollback_preloaded_safety_gate'
    );
  end if;
end $$;
SQL
  rollback_state="$("${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc \
    "select mode || ':' || send_enabled::text from public.outreach_system_state where id")"
  [[ "${rollback_state}" == disabled:false ]] || {
    echo "Rollback não confirmou DB disabled:false (${rollback_state:-missing})." >&2
    exit 1
  }
  # Recreate target core services so their image versions and bind-mounted
  # Kong/functions trees come from the selected release, not the newer one.
  "${COMPOSE[@]}" up -d --no-build --pull never --no-deps --force-recreate --wait auth rest realtime
  "${COMPOSE[@]}" up -d --no-build --pull never --no-deps --force-recreate --wait kong
  "${COMPOSE[@]}" up -d --no-build --pull never --no-deps --force-recreate --wait functions
  "${COMPOSE[@]}" up -d --no-build --pull never --no-deps --force-recreate --wait outreach-api
  "${COMPOSE[@]}" up -d --no-build --pull never --no-deps --force-recreate --wait outreach-worker
  for service in outreach-api outreach-worker; do
    container_id="$("${COMPOSE[@]}" ps -q "${service}")"
    running_image_id="$(docker inspect --format '{{.Image}}' "${container_id}")"
    [[ "${running_image_id}" == "${expected_image_id}" ]] || {
      echo "Rollback iniciou ${service} com ${running_image_id}, esperado ${expected_image_id}." >&2
      exit 1
    }
  done
  curl --fail --silent --show-error --max-time 10 \
    "http://127.0.0.1:${OUTREACH_API_PORT:-8787}/healthz" >/dev/null
  "${COMPOSE[@]}" ps outreach-api outreach-worker
  echo "Outreach rollback ativado offline com ${expected_image_id}, em dark mode."
  exit 0
fi

# A release must first remove every process capable of outbound delivery. This
# protects a redeploy made after canary/live: changing the .env file alone does
# not change the environment of an already-running worker or API container.
if ! "${COMPOSE[@]}" stop outreach-worker outreach-api >/dev/null 2>&1; then
  "${COMPOSE[@]}" kill outreach-worker outreach-api >/dev/null 2>&1 || true
fi
running_senders="$("${COMPOSE[@]}" ps --status running --services outreach-api outreach-worker)"
[[ -z "${running_senders}" ]] || {
  echo "ERRO: o deploy nao conseguiu parar todos os senders Outreach: ${running_senders//$'\n'/, }. Abortado antes de tocar na base." >&2
  exit 1
}
"${COMPOSE[@]}" up -d --wait "${SERVICES[@]}"

# Force the persisted switch to the same fail-closed state before backup,
# restore rehearsal or migrations. The table does not exist on the first
# installation, hence the guarded dynamic statement.
"${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
do $$
begin
  if to_regclass('public.outreach_system_state') is not null then
    perform private.outreach_transition_system(
      'disabled', null, false, 'deployment_safety_gate'
    );
  end if;
end $$;
SQL
"${SCRIPT_DIR}/predeploy-safety.sh"
"${SCRIPT_DIR}/configure-outreach-db.sh" production
"${SCRIPT_DIR}/configure-wal-archive.sh"

"${SCRIPT_DIR}/apply-migrations.sh" production

# The scheduler runs inside Postgres on the private Compose network. Keeping
# this call internal avoids a DNS/TLS round trip and never exposes the service
# role credential outside the host.
sync_url="http://kong:8000/functions/v1/gmail-sync"
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

"${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  --set=allowlist="${OUTREACH_CANARY_ALLOWLIST}" <<'SQL'
begin;
create temp table desired_canary_allowlist(email citext primary key) on commit drop;
insert into desired_canary_allowlist(email)
select distinct lower(trim(value))::citext
from unnest(string_to_array(:'allowlist', ',')) as value
where trim(value) <> '';

delete from private.outreach_canary_allowlist current
where not exists (
  select 1 from desired_canary_allowlist desired where desired.email = current.email
);
insert into private.outreach_canary_allowlist(email)
select email from desired_canary_allowlist
on conflict (email) do nothing;
commit;
SQL

"${COMPOSE[@]}" up -d --build --wait outreach-api
"${COMPOSE[@]}" up -d --wait outreach-worker
"${COMPOSE[@]}" up -d --wait wal-archive
"${SCRIPT_DIR}/install-backup-schedule.sh"

curl --fail --silent --show-error \
  -H "apikey: ${ANON_KEY}" \
  "http://127.0.0.1:${CRM_API_PORT}/auth/v1/health" >/dev/null
curl --fail --silent --show-error \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  "http://127.0.0.1:${CRM_API_PORT}/rest/v1/profiles?select=id&limit=0" >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${OUTREACH_API_PORT:-8787}/healthz" >/dev/null

# The public route is part of the backend release contract. Publishing the web
# app while Caddy still serves index.html for /api/outreach/* would leave the
# module installed but unusable, so install, validate and probe it first.
"${SCRIPT_DIR}/configure-caddy-outreach.sh"

# A fresh installation has no scheduled physical recovery proof yet. Do not
# call it ready and wait until Sunday/month-end: create a new offsite base and
# prove that its WAL chain reaches a current production LSN. Existing valid
# monthly proof is reused; readiness below independently authenticates a
# weekly offsite base/checksum and the <=15 minute WAL RPO on every release.
if ! valid_recent_pitr_report >/dev/null; then
  "${SCRIPT_DIR}/basebackup-production.sh"
  "${SCRIPT_DIR}/pitr-restore-drill.sh"
fi

# Prove that the post-migration state (including Outreach grants/RLS) is also
# recoverable. The timestamped preflight backup remains intact as the rollback
# point; this second artifact is the first unified-system recovery point.
"${SCRIPT_DIR}/backup-production.sh"
"${SCRIPT_DIR}/restore-drill.sh"
"${SCRIPT_DIR}/outreach-readiness.sh" --dark

"${COMPOSE[@]}" ps
echo "Backend Nikufra CRM pronto em 127.0.0.1:${CRM_API_PORT}; Outreach privado em 127.0.0.1:${OUTREACH_API_PORT:-8787}, com outbound desligado por defeito."
