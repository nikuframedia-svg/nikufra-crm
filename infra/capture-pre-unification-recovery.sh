#!/usr/bin/env bash
set -Eeuo pipefail

# One-time recovery artifact for the first immutable Outreach release. Later
# releases can use rollback-release; before that first release there is no
# publisher-created predecessor, so preserve the exact old source, static web
# root, Caddyfile and running image identities without copying infra/.env.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="${NIKUFRA_SOURCE_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
BACKUP_ROOT="${NIKUFRA_BACKUP_ROOT:-${SOURCE_ROOT}/backups}"
WEB_ROOT="${NIKUFRA_WEB_ACTIVE_DIR:-/home/luis/stacks/caddy/portal/crm-app}"
CADDY_FILE="${NIKUFRA_CADDY_FILE:-/home/luis/stacks/caddy/Caddyfile}"
RECOVERY_ROOT="${BACKUP_ROOT}/pre-unification"
LATEST_FILE="${RECOVERY_ROOT}/LATEST"

command -v tar >/dev/null || { echo "tar é obrigatório." >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum é obrigatório." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker é obrigatório." >&2; exit 1; }
[[ -d "${SOURCE_ROOT}" && ! -L "${SOURCE_ROOT}" ]] || { echo "Checkout antigo inválido." >&2; exit 1; }
[[ -d "${WEB_ROOT}" && ! -L "${WEB_ROOT}" ]] || { echo "Web root antigo inválido." >&2; exit 1; }
[[ -f "${CADDY_FILE}" && ! -L "${CADDY_FILE}" ]] || { echo "Caddyfile antigo inválido." >&2; exit 1; }

mkdir -p "${RECOVERY_ROOT}"
chmod 700 "${RECOVERY_ROOT}"

verify_capture() {
  local directory="$1"
  [[ -d "${directory}" && ! -L "${directory}" \
    && -f "${directory}/source.tar.gz" \
    && -f "${directory}/web.tar.gz" \
    && -f "${directory}/Caddyfile" \
    && -f "${directory}/container-images.txt" \
    && -f "${directory}/SHA256SUMS" \
    && -f "${directory}/RECOVERY.md" ]] || return 1
  (cd "${directory}" && sha256sum --check SHA256SUMS >/dev/null)
  tar -tzf "${directory}/source.tar.gz" >/dev/null
  tar -tzf "${directory}/web.tar.gz" >/dev/null
}

if [[ -f "${LATEST_FILE}" && ! -L "${LATEST_FILE}" ]]; then
  existing_id="$(< "${LATEST_FILE}")"
  [[ "${existing_id}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "Marcador recovery inválido." >&2; exit 1; }
  existing="${RECOVERY_ROOT}/${existing_id}"
  verify_capture "${existing}" || { echo "Recovery pré-unificação existente não é íntegro." >&2; exit 1; }
  echo "Recovery pré-unificação já verificado em ${existing}."
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d "${RECOVERY_ROOT}/.${stamp}.partial.XXXXXX")"
target="${RECOVERY_ROOT}/${stamp}"
cleanup() {
  if [[ -d "${stage}" ]]; then rm -rf -- "${stage}"; fi
}
trap cleanup EXIT

tar \
  --exclude='./backups' \
  --exclude='./.releases' \
  --exclude='./current' \
  --exclude='./.current.*' \
  --exclude='./.backend-release.*' \
  --exclude='./.release.lock' \
  --exclude='./infra/.env' \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./.git' \
  -C "${SOURCE_ROOT}" -czf "${stage}/source.tar.gz" .
tar -C "${WEB_ROOT}" -czf "${stage}/web.tar.gz" .
cp -- "${CADDY_FILE}" "${stage}/Caddyfile"
cp -- "${SCRIPT_DIR}/pre-unification-recovery.md" "${stage}/RECOVERY.md"

{
  printf 'captured_at=%s\n' "$(date -u +%FT%TZ)"
  printf 'source_root=%s\nweb_root=%s\ncaddy_file=%s\n' "${SOURCE_ROOT}" "${WEB_ROOT}" "${CADDY_FILE}"
  while IFS= read -r container_id; do
    [[ -n "${container_id}" ]] || continue
    docker inspect --format \
      '{{.Name}}|image={{.Config.Image}}|image_id={{.Image}}|created={{.Created}}' \
      "${container_id}"
  done < <(docker ps -aq --filter label=com.docker.compose.project=nikufra-crm | sort)
} > "${stage}/container-images.txt"

chmod 600 "${stage}"/*
(cd "${stage}" && sha256sum Caddyfile RECOVERY.md container-images.txt source.tar.gz web.tar.gz > SHA256SUMS)
chmod 600 "${stage}/SHA256SUMS"
verify_capture "${stage}"
mv -- "${stage}" "${target}"
stage=""
latest_partial="$(mktemp "${RECOVERY_ROOT}/.LATEST.XXXXXX")"
printf '%s\n' "${stamp}" > "${latest_partial}"
chmod 600 "${latest_partial}"
mv -- "${latest_partial}" "${LATEST_FILE}"

echo "Recovery pré-unificação criado e verificado em ${target}."
