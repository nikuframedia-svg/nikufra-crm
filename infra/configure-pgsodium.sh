#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
POSTGRES_IMAGE="supabase/postgres:15.8.1.085"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nikufra-crm}"

[[ -f "${ENV_FILE}" && ! -L "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
DOCKER_BIN="${NIKUFRA_DOCKER_BIN:-$(command -v docker || true)}"
[[ -n "${DOCKER_BIN}" && -x "${DOCKER_BIN}" ]] || { echo "Docker é obrigatório para preparar a chave pgsodium." >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl é obrigatório para preparar a chave pgsodium." >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

key_file="${PGSODIUM_ROOT_KEY_FILE:-${HOME}/.config/nikufra-crm/pgsodium_root.key}"
[[ "${key_file}" == /* ]] || { echo "PGSODIUM_ROOT_KEY_FILE tem de ser absoluto." >&2; exit 1; }
key_dir="$(dirname "${key_file}")"
key_name="$(basename "${key_file}")"
[[ "${key_name}" == pgsodium_root.key ]] || { echo "PGSODIUM_ROOT_KEY_FILE tem de terminar em pgsodium_root.key." >&2; exit 1; }

mkdir -p "${key_dir}"
[[ -d "${key_dir}" && ! -L "${key_dir}" ]] || { echo "Diretório da chave pgsodium inválido." >&2; exit 1; }
chmod 700 "${key_dir}"

validate_key_file() {
  "${DOCKER_BIN}" run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true \
    -v "${key_file}:/key:ro" --entrypoint sh "${POSTGRES_IMAGE}" -ceu '
      key="$(cat /key)"
      [ "${#key}" -eq 64 ]
      case "${key}" in *[!0-9a-f]*) exit 1 ;; esac
    '
}

db_container="$(
  "${DOCKER_BIN}" ps \
    --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
    --filter 'label=com.docker.compose.service=db' \
    --format '{{.ID}}' | head -1
)"

db_volume="$(
  "${DOCKER_BIN}" volume ls -q \
    --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
    --filter 'label=com.docker.compose.volume=db-data' | head -1
)"
if [[ -z "${db_volume}" ]] && "${DOCKER_BIN}" volume inspect "${PROJECT_NAME}_db-data" >/dev/null 2>&1; then
  db_volume="${PROJECT_NAME}_db-data"
fi

if [[ ! -e "${key_file}" ]]; then
  tmp="$(mktemp "${key_dir}/.pgsodium_root.key.XXXXXX")"
  cleanup() { rm -f -- "${tmp}"; }
  trap cleanup EXIT
  chmod 600 "${tmp}"

  if [[ -n "${db_container}" ]] \
    && "${DOCKER_BIN}" exec "${db_container}" sh -ceu '
      key="$(cat /etc/postgresql-custom/pgsodium_root.key)"
      [ "${#key}" -eq 64 ]
      case "${key}" in *[!0-9a-f]*) exit 1 ;; esac
    '; then
    # Preserve the key already capable of decrypting the running database.
    # Redirecting stdout to a private file avoids exposing it in logs.
    "${DOCKER_BIN}" exec "${db_container}" cat /etc/postgresql-custom/pgsodium_root.key > "${tmp}"
  else
    if [[ -n "${db_volume}" ]]; then
      volume_state="$(
        "${DOCKER_BIN}" run --rm --network none --read-only \
          --cap-drop ALL --security-opt no-new-privileges:true \
          -v "${db_volume}:/data:ro" --entrypoint sh "${POSTGRES_IMAGE}" -ceu \
          'if [ -s /data/PG_VERSION ]; then
             printf initialized
           elif find /data -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
             printf nonempty
           else
             printf empty
           fi'
      )" || { echo "Não foi possível inspecionar com segurança o volume PostgreSQL existente." >&2; exit 1; }
      case "${volume_state}" in
        empty) ;;
        initialized|nonempty)
          echo "O volume PostgreSQL já contém dados, mas não existe um DB em execução cuja chave pgsodium possa ser adotada. Recusado gerar uma chave nova." >&2
          exit 1
          ;;
        *) echo "Estado inesperado do volume PostgreSQL." >&2; exit 1 ;;
      esac
    fi
    openssl rand -hex 32 > "${tmp}"
    # openssl includes a newline; the Supabase getkey script emits 64 hex
    # characters, so normalize to that exact representation.
    tr -d '\n' < "${tmp}" > "${tmp}.normalized"
    mv -f -- "${tmp}.normalized" "${tmp}"
  fi

  key="$(< "${tmp}")"
  [[ "${#key}" == 64 && "${key}" != *[!0-9a-f]* ]] || { echo "Chave pgsodium gerada ou copiada inválida." >&2; exit 1; }
  mv -f -- "${tmp}" "${key_file}"
  tmp=""
  trap - EXIT
fi

[[ -f "${key_file}" && ! -L "${key_file}" ]] || { echo "A chave pgsodium tem de ser um ficheiro normal." >&2; exit 1; }
validate_key_file || { echo "A chave pgsodium persistida é inválida." >&2; exit 1; }

# If both exist, never silently replace either authority. A mismatch means a
# container was recreated without the persisted bind and needs an explicit
# recovery decision before touching Vault ciphertext.
if [[ -n "${db_container}" ]] && "${DOCKER_BIN}" exec "${db_container}" test -f /etc/postgresql-custom/pgsodium_root.key; then
  running_hash="$("${DOCKER_BIN}" exec "${db_container}" sha256sum /etc/postgresql-custom/pgsodium_root.key | awk '{print $1}')"
  persisted_hash="$(
    "${DOCKER_BIN}" run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges:true -v "${key_file}:/key:ro" \
      --entrypoint sha256sum "${POSTGRES_IMAGE}" /key | awk '{print $1}'
  )"
  [[ "${running_hash}" == "${persisted_hash}" ]] || {
    echo "A chave pgsodium persistida diverge da chave do DB em execução; recuperação manual obrigatória." >&2
    exit 1
  }
fi

# PostgreSQL runs as 105:106 in the pinned Supabase image. Keep the host file
# unreadable to ordinary users while making it available through the one exact
# read-only bind mount used by the database container.
"${DOCKER_BIN}" run --rm --network none --read-only --cap-drop ALL \
  --cap-add CHOWN --cap-add FOWNER --security-opt no-new-privileges:true \
  -v "${key_file}:/key" --entrypoint sh "${POSTGRES_IMAGE}" -ceu \
  'chown 105:106 /key; chmod 0400 /key'

env_count="$(grep -c '^PGSODIUM_ROOT_KEY_FILE=' "${ENV_FILE}" || true)"
if [[ "${env_count}" == 0 ]]; then
  printf '\nPGSODIUM_ROOT_KEY_FILE=%s\n' "${key_file}" >> "${ENV_FILE}"
elif [[ "${env_count}" == 1 ]]; then
  configured_path="$(sed -n 's/^PGSODIUM_ROOT_KEY_FILE=//p' "${ENV_FILE}")"
  [[ "${configured_path}" == "${key_file}" ]] || {
    echo "PGSODIUM_ROOT_KEY_FILE no env diverge do ficheiro validado." >&2
    exit 1
  }
else
  echo "PGSODIUM_ROOT_KEY_FILE aparece mais de uma vez no env." >&2
  exit 1
fi
chmod 600 "${ENV_FILE}"

echo "Chave pgsodium persistida fora do overlay do container e pronta para bind read-only."
