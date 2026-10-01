#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
BACKUP_ROOT="${NIKUFRA_BACKUP_ROOT:-/home/luis/services/nikufra-crm/backups}"
REPORT_DIR="${BACKUP_ROOT}/pitr-drills"
POSTGRES_IMAGE="supabase/postgres:15.8.1.085"

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
[[ -n "${RCLONE_REMOTE:-}" ]] || { echo "RCLONE_REMOTE em falta." >&2; exit 1; }
[[ -f "${BACKUP_ENCRYPTION_KEY_FILE:-}" && ! -L "${BACKUP_ENCRYPTION_KEY_FILE}" ]] || { echo "Chave de backup inválida." >&2; exit 1; }
RCLONE_BIN="${RCLONE_BIN:-$(command -v rclone || true)}"
[[ -n "${RCLONE_BIN}" ]] || RCLONE_BIN="${HOME}/.local/bin/rclone"
[[ -x "${RCLONE_BIN}" ]] || { echo "rclone em falta." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker em falta." >&2; exit 1; }

base_name="$("${RCLONE_BIN}" lsf "${RCLONE_REMOTE}/base/" --files-only --include 'base-*.tar.gpg' | sort | tail -1)"
[[ "${base_name}" =~ ^base-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.tar\.gpg$ ]] || {
  echo "Não existe um base backup offsite reconhecido." >&2
  exit 1
}

work_dir="$(mktemp -d "${BACKUP_ROOT}/.pitr-drill.XXXXXX")"
container_name="nikufra-pitr-drill-$(date -u +%Y%m%d%H%M%S)-$$"
started_at="$(date +%s)"
container_started=false
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "${container_started}" == true && "${container_name}" =~ ^nikufra-pitr-drill-[0-9]+-[0-9]+$ ]]; then
    docker rm -f "${container_name}" >/dev/null 2>&1 || status=1
  fi
  rm -rf -- "${work_dir}"
  exit "${status}"
}
trap cleanup EXIT

base_archive="${work_dir}/${base_name}"
"${RCLONE_BIN}" copyto "${RCLONE_REMOTE}/base/${base_name}" "${base_archive}"
"${RCLONE_BIN}" copyto "${RCLONE_REMOTE}/base/${base_name}.sha256" "${base_archive}.sha256"
(cd "${work_dir}" && sha256sum --check "${base_name}.sha256")
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "${BACKUP_ENCRYPTION_KEY_FILE}" \
  --decrypt "${base_archive}" | tar -C "${work_dir}" -xf -

plain_name="${base_name%.tar.gpg}"
data_dir="${work_dir}/${plain_name}"
[[ -f "${data_dir}/backup_manifest" && -f "${data_dir}/PG_VERSION" ]] || {
  echo "Base backup extraído sem manifest/PG_VERSION." >&2
  exit 1
}

data_uid="$(stat -c '%u' "${data_dir}")"
data_gid="$(stat -c '%g' "${data_dir}")"
docker run --rm --network none --user "${data_uid}:${data_gid}" \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  -v "${data_dir}:/restore-data:ro" --entrypoint pg_verifybackup \
  "${POSTGRES_IMAGE}" /restore-data

# Capture a production WAL point, force its segment closed and prove the exact
# encrypted segment exists offsite before attempting recovery.
target_lsn="$("${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc 'select pg_current_wal_lsn()')"
[[ "${target_lsn}" =~ ^[0-9A-F]+/[0-9A-F]+$ ]] || { echo "LSN de origem inválido." >&2; exit 1; }
"${SCRIPT_DIR}/wal-offsite-sync.sh"

wal_encrypted="${work_dir}/wal-encrypted"
wal_plain="${work_dir}/wal"
mkdir -p "${wal_encrypted}" "${wal_plain}"
chmod 700 "${wal_encrypted}" "${wal_plain}"
"${RCLONE_BIN}" copy "${RCLONE_REMOTE}/wal/" "${wal_encrypted}" \
  --include '*.gpg' --include '*.gpg.sha256' --exclude '*'
compgen -G "${wal_encrypted}/0???????????????????????.gpg" >/dev/null || {
  echo "Nenhum WAL cifrado foi descarregado do offsite." >&2
  exit 1
}

while IFS= read -r checksum_path; do
  (cd "${wal_encrypted}" && sha256sum --check "$(basename "${checksum_path}")")
done < <(find "${wal_encrypted}" -maxdepth 1 -type f -name '0???????????????????????.gpg.sha256' -print | sort)
while IFS= read -r encrypted_path; do
  wal_name="$(basename "${encrypted_path}" .gpg)"
  [[ -f "${encrypted_path}.sha256" ]] || {
    echo "Checksum offsite em falta para o segmento ${wal_name}." >&2
    exit 1
  }
  gpg --batch --quiet --pinentry-mode loopback --passphrase-file "${BACKUP_ENCRYPTION_KEY_FILE}" \
    --output "${wal_plain}/${wal_name}" --decrypt "${encrypted_path}"
  chmod 600 "${wal_plain}/${wal_name}"
done < <(find "${wal_encrypted}" -maxdepth 1 -type f -name '0???????????????????????.gpg' -print | sort)

rm -f -- "${data_dir}/standby.signal"
touch "${data_dir}/recovery.signal"
cat >> "${data_dir}/postgresql.auto.conf" <<RECOVERY
restore_command = 'cp /restore-wal/%f %p'
recovery_target_lsn = '${target_lsn}'
recovery_target_inclusive = true
recovery_target_action = 'promote'
RECOVERY
chmod 600 "${data_dir}/postgresql.auto.conf" "${data_dir}/recovery.signal"

docker run -d --name "${container_name}" --network none --user "${data_uid}:${data_gid}" \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:size=64m,noexec,nosuid,nodev \
  -v "${data_dir}:/restore-data" -v "${wal_plain}:/restore-wal:ro" \
  --entrypoint postgres "${POSTGRES_IMAGE}" -D /restore-data \
  -c listen_addresses='' -c unix_socket_directories=/tmp -c ssl=off \
  -c archive_mode=off -c shared_preload_libraries='' >/dev/null
container_started=true

ready=false
for _ in $(seq 1 240); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "${container_name}" 2>/dev/null || true)" != true ]]; then
    docker logs "${container_name}" >&2 || true
    echo "O PostgreSQL restaurado terminou antes de ficar pronto." >&2
    exit 1
  fi
  recovery_state="$(docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${container_name}" \
    psql -h /tmp -U postgres -d postgres -Atc 'select pg_is_in_recovery()' 2>/dev/null || true)"
  if [[ "${recovery_state}" == f ]]; then ready=true; break; fi
  sleep 1
done
[[ "${ready}" == true ]] || {
  docker logs "${container_name}" >&2 || true
  echo "O ensaio PITR não terminou a recovery em 240 segundos." >&2
  exit 1
}

restored_lsn="$(docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${container_name}" \
  psql -h /tmp -U postgres -d postgres -Atc 'select pg_current_wal_lsn()')"
lsn_reached="$(docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${container_name}" \
  psql -h /tmp -U postgres -d postgres -Atc "select '${restored_lsn}'::pg_lsn >= '${target_lsn}'::pg_lsn")"
[[ "${lsn_reached}" == t ]] || {
  echo "PITR ficou em ${restored_lsn}, antes do ponto comprovado ${target_lsn}." >&2
  exit 1
}

counts="$(docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${container_name}" \
  psql -h /tmp -U postgres -d postgres -Atc \
  "select json_build_object('profiles',(select count(*) from public.profiles),'empresas',(select count(*) from public.empresas),'contactos',(select count(*) from public.contactos),'oportunidades',(select count(*) from public.oportunidades))")"
elapsed="$(( $(date +%s) - started_at ))"
(( elapsed <= 14400 )) || { echo "RTO excedido: ${elapsed}s > 14400s." >&2; exit 1; }

mkdir -p "${REPORT_DIR}"
chmod 700 "${REPORT_DIR}"
report="${REPORT_DIR}/$(date -u +%Y-%m-%dT%H%M%SZ).txt"
printf 'base=%s\nrestored_at=%s\nelapsed_seconds=%s\ntarget_lsn=%s\nrestored_lsn=%s\ncounts=%s\nrpo_max_seconds=900\nrto_max_seconds=14400\nresult=ok\n' \
  "${base_name}" "$(date -u +%FT%TZ)" "${elapsed}" "${target_lsn}" "${restored_lsn}" "${counts}" > "${report}"
chmod 600 "${report}"
echo "PITR físico comprovado até ${restored_lsn} em ${elapsed}s. Relatório: ${report}"
