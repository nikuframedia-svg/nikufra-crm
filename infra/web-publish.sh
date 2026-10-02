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
RELEASE_MARKER="${PUBLISH_ROOT}/crm-app.release"
ARCHIVE_SOURCE="${NIKUFRA_WEB_ARCHIVE_SOURCE:-}"
VALIDATE_ONLY="${NIKUFRA_WEB_VALIDATE_ONLY:-false}"
RELEASE_ID="${NIKUFRA_WEB_RELEASE_ID:-}"
EXPECTED_ARCHIVE_SHA256="${NIKUFRA_WEB_BUNDLE_SHA256:-}"
archive_owned=false
if [[ -n "${ARCHIVE_SOURCE}" ]]; then
  [[ "${ARCHIVE_SOURCE}" == /* && -f "${ARCHIVE_SOURCE}" && ! -L "${ARCHIVE_SOURCE}" ]] || {
    echo "Arquivo web interno inválido" >&2
    exit 1
  }
  ARCHIVE="${ARCHIVE_SOURCE}"
else
  ARCHIVE="$(mktemp "${PUBLISH_ROOT}/.crm-web.XXXXXX.tar.gz")"
  archive_owned=true
fi
STAGE="$(mktemp -d "${PUBLISH_ROOT}/.crm-web-stage.XXXXXX")"
marker_partial=""

cleanup() {
  if [[ "${archive_owned}" == true ]]; then rm -f -- "${ARCHIVE}"; fi
  if [[ -n "${marker_partial}" ]]; then rm -f -- "${marker_partial}"; fi
  if [[ -d "${STAGE}" ]]; then rm -rf -- "${STAGE}"; fi
}
trap cleanup EXIT

umask 022
if [[ "${archive_owned}" == true ]]; then
  timeout 120 dd bs=1M count=256 iflag=fullblock of="${ARCHIVE}" status=none
fi
[[ -s "${ARCHIVE}" ]] || { echo "Build web vazia" >&2; exit 1; }
archive_sha256="$(sha256sum "${ARCHIVE}" | awk '{print $1}')"
if [[ -n "${EXPECTED_ARCHIVE_SHA256}" ]]; then
  [[ "${EXPECTED_ARCHIVE_SHA256}" =~ ^[0-9a-f]{64}$ && "${archive_sha256}" == "${EXPECTED_ARCHIVE_SHA256}" ]] || {
    echo "Checksum do build web diverge" >&2
    exit 1
  }
fi
if [[ -n "${RELEASE_ID}" ]]; then
  [[ "${RELEASE_ID}" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || { echo "Release web inválida" >&2; exit 1; }
fi
[[ "${VALIDATE_ONLY}" == false || "${VALIDATE_ONLY}" == true ]] || { echo "Modo de validação inválido" >&2; exit 1; }

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
python3 - "${STAGE}/index.html" <<'PY'
from html.parser import HTMLParser
import pathlib
import sys

expected = "https://crm.nikufra.ai"

class SupabaseUrlMarker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.urls = []

    def handle_starttag(self, tag, attrs):
        if tag.casefold() != "meta":
            return
        values = {key.casefold(): value or "" for key, value in attrs}
        if values.get("name", "").casefold() == "nikufra-supabase-url":
            self.urls.append(values.get("content", ""))

marker = SupabaseUrlMarker()
marker.feed(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
if marker.urls != [expected]:
    raise SystemExit(
        "Build web recusado: VITE_SUPABASE_URL tem de ser exatamente "
        f"{expected}; marcadores encontrados={marker.urls!r}"
    )
PY
find "${STAGE}" -type d -exec chmod 755 {} +
find "${STAGE}" -type f -exec chmod 644 {} +

if [[ "${VALIDATE_ONLY}" == true ]]; then
  echo "Build web validada (${archive_sha256})"
  exit 0
fi

if [[ -n "${RELEASE_ID}" ]]; then
  marker_partial="$(mktemp "${PUBLISH_ROOT}/.crm-app.release.XXXXXX")"
  printf 'release_id=%s\nbundle_sha256=%s\n' "${RELEASE_ID}" "${archive_sha256}" > "${marker_partial}"
  chmod 644 "${marker_partial}"
fi

rm -rf -- "${PREVIOUS_DIR}"
if [[ -d "${ACTIVE_DIR}" ]]; then mv -- "${ACTIVE_DIR}" "${PREVIOUS_DIR}"; fi
if ! mv -- "${STAGE}" "${ACTIVE_DIR}"; then
  if [[ -d "${PREVIOUS_DIR}" ]]; then mv -- "${PREVIOUS_DIR}" "${ACTIVE_DIR}"; fi
  exit 1
fi

if [[ -n "${RELEASE_ID}" ]]; then
  if ! mv -f -- "${marker_partial}" "${RELEASE_MARKER}"; then
    # The marker is part of the atomic publication proof. If it cannot move,
    # restore the previous document root before reporting failure.
    if mv -- "${ACTIVE_DIR}" "${STAGE}"; then
      if [[ -d "${PREVIOUS_DIR}" ]]; then mv -- "${PREVIOUS_DIR}" "${ACTIVE_DIR}"; fi
    fi
    exit 1
  fi
  marker_partial=""
fi

echo "Aplicação web publicada em ${ACTIVE_DIR}"
