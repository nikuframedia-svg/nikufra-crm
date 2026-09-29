#!/usr/bin/env bash
set -Eeuo pipefail

# Forced command for the GitHub Actions deploy key. It accepts only a validated
# static web build on stdin and swaps it atomically into the Caddy document root.
[[ "${SSH_ORIGINAL_COMMAND:-}" == "publish-web" ]] || {
  echo "Comando recusado" >&2
  exit 1
}

PUBLISH_ROOT="${NIKUFRA_WEB_PUBLISH_ROOT:-/home/luis/stacks/caddy/portal}"
ACTIVE_DIR="${PUBLISH_ROOT}/crm-app"
PREVIOUS_DIR="${PUBLISH_ROOT}/crm-app.previous"
ARCHIVE="$(mktemp "${PUBLISH_ROOT}/.crm-web.XXXXXX.tar.gz")"
STAGE="$(mktemp -d "${PUBLISH_ROOT}/.crm-web-stage.XXXXXX")"

cleanup() {
  rm -f -- "${ARCHIVE}"
  if [[ -d "${STAGE}" ]]; then rm -rf -- "${STAGE}"; fi
}
trap cleanup EXIT

umask 022
timeout 120 dd bs=1M count=256 iflag=fullblock of="${ARCHIVE}" status=none
[[ -s "${ARCHIVE}" ]] || { echo "Build web vazia" >&2; exit 1; }

python3 - "${ARCHIVE}" <<'PY'
import pathlib
import re
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
allowed = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$")
total = 0
has_index = False
with tarfile.open(archive, "r:gz") as bundle:
    for member in bundle.getmembers():
        name = member.name.removeprefix("./").rstrip("/")
        if name in {"", "."}:
            continue
        path = pathlib.PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or not allowed.fullmatch(name):
            raise SystemExit(f"Caminho recusado: {member.name}")
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"Tipo de ficheiro recusado: {member.name}")
        if member.isfile():
            total += member.size
            has_index = has_index or name == "index.html"
    if not has_index:
        raise SystemExit("index.html em falta")
    if total > 200 * 1024 * 1024:
        raise SystemExit("Build web excede 200 MB")
PY

tar -xzf "${ARCHIVE}" --no-same-owner --no-same-permissions -C "${STAGE}"
[[ -f "${STAGE}/index.html" ]] || { echo "index.html em falta" >&2; exit 1; }
grep -q '<div id="root"></div>' "${STAGE}/index.html" || { echo "Entrada React inválida" >&2; exit 1; }
find "${STAGE}" -type d -exec chmod 755 {} +
find "${STAGE}" -type f -exec chmod 644 {} +

rm -rf -- "${PREVIOUS_DIR}"
if [[ -d "${ACTIVE_DIR}" ]]; then mv -- "${ACTIVE_DIR}" "${PREVIOUS_DIR}"; fi
if ! mv -- "${STAGE}" "${ACTIVE_DIR}"; then
  if [[ -d "${PREVIOUS_DIR}" ]]; then mv -- "${PREVIOUS_DIR}" "${ACTIVE_DIR}"; fi
  exit 1
fi

echo "Aplicação web publicada em ${ACTIVE_DIR}"
