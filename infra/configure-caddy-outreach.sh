#!/usr/bin/env bash
set -Eeuo pipefail

# Installs the one managed Outreach route in the external Caddyfile. The file
# is bind-mounted into the running container, so it must be updated in place:
# replacing its inode would leave Caddy reading the old mount until restart.
CADDY_FILE="${NIKUFRA_CADDY_FILE:-/home/luis/stacks/caddy/Caddyfile}"
CADDY_CONTAINER="${NIKUFRA_CADDY_CONTAINER:-caddy}"
CADDY_CONTAINER_CONFIG="${NIKUFRA_CADDY_CONTAINER_CONFIG:-/etc/caddy/Caddyfile}"
OUTREACH_PORT="${OUTREACH_API_PORT:-8787}"
CRM_HOST="${CRM_DOMAIN:-crm.nikufra.ai}"

[[ "${OUTREACH_PORT}" =~ ^[0-9]{1,5}$ ]] && (( 10#${OUTREACH_PORT} <= 65535 )) || {
  echo "OUTREACH_API_PORT inválida: ${OUTREACH_PORT}" >&2
  exit 1
}
[[ "${CRM_HOST}" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "CRM_DOMAIN inválido." >&2; exit 1; }
[[ -f "${CADDY_FILE}" && ! -L "${CADDY_FILE}" ]] || { echo "Caddyfile externo inválido: ${CADDY_FILE}" >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker é obrigatório." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 é obrigatório." >&2; exit 1; }

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

file_inode() {
  stat -c '%i' "$1" 2>/dev/null || stat -f '%i' "$1"
}

file_dir="$(dirname "${CADDY_FILE}")"
candidate="$(mktemp "${file_dir}/.Caddyfile.outreach.XXXXXX")"
backup="${CADDY_FILE}.pre-outreach.$(date -u +%Y%m%dT%H%M%SZ)"
changed_file=false
cleanup() {
  rm -f -- "${candidate}"
}
trap cleanup EXIT

python3 - "${CADDY_FILE}" "${candidate}" "${CRM_HOST}" "${OUTREACH_PORT}" <<'PY'
import pathlib
import re
import sys

source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
host = sys.argv[3]
port = sys.argv[4]
text = source.read_text(encoding="utf-8")
lines = text.splitlines(keepends=True)

starts = [index for index, line in enumerate(lines) if line.strip() == f"{host} {{"]
if len(starts) != 1:
    raise SystemExit(f"Esperava um único bloco Caddy para {host}; encontrei {len(starts)}")

start = starts[0]
depth = 0
end = None
for index in range(start, len(lines)):
    # The managed host block contains no quoted braces. Rejecting an unusual
    # structure is safer than guessing and editing another virtual host.
    depth += lines[index].count("{") - lines[index].count("}")
    if depth == 0:
        end = index
        break
if end is None:
    raise SystemExit(f"Bloco Caddy de {host} não termina corretamente")

begin = "# BEGIN NIKUFRA CRM OUTREACH MANAGED"
finish = "# END NIKUFRA CRM OUTREACH MANAGED"
block = "".join(lines[start : end + 1])
if (begin in block) != (finish in block):
    raise SystemExit("Marcadores Outreach incompletos no Caddyfile")

managed = (
    "    # BEGIN NIKUFRA CRM OUTREACH MANAGED\n"
    "    @outreach path /api/outreach/*\n"
    "    handle @outreach {\n"
    f"        reverse_proxy 127.0.0.1:{port}\n"
    "    }\n"
    "    # END NIKUFRA CRM OUTREACH MANAGED\n\n"
)

if begin in block:
    pattern = re.compile(
        r"^[ \t]*# BEGIN NIKUFRA CRM OUTREACH MANAGED\n.*?"
        r"^[ \t]*# END NIKUFRA CRM OUTREACH MANAGED\n(?:\n)?",
        re.MULTILINE | re.DOTALL,
    )
    updated_block, replacements = pattern.subn(managed, block, count=1)
    if replacements != 1:
        raise SystemExit("Não foi possível atualizar o bloco Outreach gerido")
else:
    if re.search(r"(?m)^\s*@outreach\b|^\s*handle\s+@outreach\b", block):
        raise SystemExit("Existe uma rota @outreach não gerida; revisão manual necessária")
    relative_assets = next(
        (index for index, line in enumerate(lines[start : end + 1]) if line.strip().startswith("@assets path ")),
        None,
    )
    if relative_assets is None:
        raise SystemExit("Âncora @assets não encontrada no bloco CRM")
    insert_at = start + relative_assets
    lines.insert(insert_at, managed)
    updated = "".join(lines)
    target.write_text(updated, encoding="utf-8")
    raise SystemExit(0)

lines[start : end + 1] = [updated_block]
target.write_text("".join(lines), encoding="utf-8")
PY

chmod "$(file_mode "${CADDY_FILE}")" "${candidate}"
docker exec -i "${CADDY_CONTAINER}" caddy validate --config /dev/stdin --adapter caddyfile < "${candidate}" >/dev/null

if ! cmp -s "${candidate}" "${CADDY_FILE}"; then
  cp -p "${CADDY_FILE}" "${backup}"
  chmod 600 "${backup}"
  original_inode="$(file_inode "${CADDY_FILE}")"
  cp "${candidate}" "${CADDY_FILE}"
  [[ "$(file_inode "${CADDY_FILE}")" == "${original_inode}" ]] || {
    echo "O inode do Caddyfile mudou; o bind mount deixou de ser seguro." >&2
    exit 1
  }
  changed_file=true
fi

if ! docker exec "${CADDY_CONTAINER}" caddy reload --config "${CADDY_CONTAINER_CONFIG}" --adapter caddyfile >/dev/null; then
  if [[ "${changed_file}" == true ]]; then
    cp "${backup}" "${CADDY_FILE}"
    docker exec "${CADDY_CONTAINER}" caddy reload --config "${CADDY_CONTAINER_CONFIG}" --adapter caddyfile >/dev/null || true
  fi
  echo "Falhou o reload do Caddy; a configuração anterior foi restaurada." >&2
  exit 1
fi

public_health="https://${CRM_HOST}/api/outreach/v1/healthz"
healthy=false
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error --max-time 10 "${public_health}" \
    | grep -q '"service":"outreach-api"'; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ "${healthy}" != true ]]; then
  if [[ "${changed_file}" == true ]]; then
    cp "${backup}" "${CADDY_FILE}"
    docker exec "${CADDY_CONTAINER}" caddy reload --config "${CADDY_CONTAINER_CONFIG}" --adapter caddyfile >/dev/null || true
  fi
  echo "A rota pública Outreach não ficou saudável; a configuração anterior foi restaurada." >&2
  exit 1
fi

echo "Rota Outreach validada em ${public_health}."
