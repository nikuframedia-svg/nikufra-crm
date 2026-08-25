#!/usr/bin/env bash
set -Eeuo pipefail

# Forced command used by the GitHub Actions deploy key. It accepts a small,
# validated tar.gz on stdin and atomically publishes only desktop release
# files. The key cannot execute arbitrary commands on the server.
PUBLISH_ROOT="${NIKUFRA_RELEASE_PUBLISH_ROOT:-/home/luis/stacks/caddy/portal}"
ACTIVE_DIR="${PUBLISH_ROOT}/crm-updates"
ARCHIVE="$(mktemp "${PUBLISH_ROOT}/.crm-release.XXXXXX.tar.gz")"
STAGE="$(mktemp -d "${PUBLISH_ROOT}/.crm-release-stage.XXXXXX")"

cleanup() {
  rm -f -- "${ARCHIVE}"
  if [[ -d "${STAGE}" ]]; then rm -rf -- "${STAGE}"; fi
}
trap cleanup EXIT

umask 022
timeout 120 dd bs=1M count=2048 iflag=fullblock of="${ARCHIVE}" status=none
[[ -s "${ARCHIVE}" ]] || { echo "Release vazia" >&2; exit 1; }

while IFS= read -r entry; do
  entry="${entry%/}"
  [[ "${entry}" == "latest.json" || "${entry}" == "assets" || "${entry}" =~ ^assets/[A-Za-z0-9][A-Za-z0-9._+\ -]{0,180}$ ]] || {
    echo "Caminho de release recusado: ${entry}" >&2
    exit 1
  }
done < <(tar -tzf "${ARCHIVE}")

if tar -tvzf "${ARCHIVE}" | awk '{ print substr($1, 1, 1) }' | grep -qvE '^[-d]$'; then
  echo "A release contém links ou tipos de ficheiro não permitidos" >&2
  exit 1
fi

tar -xzf "${ARCHIVE}" --no-same-owner --no-same-permissions -C "${STAGE}"
[[ -f "${STAGE}/latest.json" && -d "${STAGE}/assets" ]] || {
  echo "latest.json ou assets em falta" >&2
  exit 1
}

manifest_version="$(python3 - "${STAGE}" <<'PY'
import json
import pathlib
import sys
import urllib.parse

stage = pathlib.Path(sys.argv[1])
manifest = json.loads((stage / "latest.json").read_text(encoding="utf-8"))
if not isinstance(manifest.get("version"), str) or not manifest["version"]:
    raise SystemExit("Versão inválida no manifesto")
platforms = manifest.get("platforms")
if not isinstance(platforms, dict) or not platforms:
    raise SystemExit("Plataformas em falta no manifesto")
prefix = "https://crm.nikufra.ai/updates/assets/"
for platform, release in platforms.items():
    if not isinstance(release, dict) or not release.get("signature"):
        raise SystemExit(f"Assinatura em falta para {platform}")
    url = release.get("url", "")
    if not isinstance(url, str) or not url.startswith(prefix):
        raise SystemExit(f"URL inválido para {platform}")
    filename = urllib.parse.unquote(url.removeprefix(prefix))
    if pathlib.Path(filename).name != filename or not (stage / "assets" / filename).is_file():
        raise SystemExit(f"Artefacto em falta para {platform}")
print(manifest["version"])
PY
)"

find "${STAGE}" -type d -exec chmod 755 {} +
find "${STAGE}" -type f -exec chmod 644 {} +

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
previous="${PUBLISH_ROOT}/crm-updates.previous.${timestamp}"
if [[ -d "${ACTIVE_DIR}" ]]; then mv -- "${ACTIVE_DIR}" "${previous}"; fi
if ! mv -- "${STAGE}" "${ACTIVE_DIR}"; then
  if [[ -d "${previous}" ]]; then mv -- "${previous}" "${ACTIVE_DIR}"; fi
  exit 1
fi

echo "Release ${manifest_version} publicada em ${ACTIVE_DIR}"
