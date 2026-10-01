#!/usr/bin/env bash
set -Eeuo pipefail

# Forced command for the production deploy key. The only accepted operations
# are a validated backend release, a read-only backend sentinel, a web
# publication tied to that exact backend release, and a fail-closed rollback to
# an immutable release previously created by this publisher.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_ROOT="${NIKUFRA_RELEASE_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
RELEASES_DIR="${RELEASE_ROOT}/.releases"
BACKUP_ROOT="${NIKUFRA_BACKUP_ROOT:-${RELEASE_ROOT}/backups}"
LOCK_FILE="${RELEASE_ROOT}/.release.lock"

original_command="${SSH_ORIGINAL_COMMAND:-}"
read -r action release_id extra <<< "${original_command}"
[[ -z "${extra:-}" \
  && "${release_id:-}" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ \
  && "${original_command}" == "${action} ${release_id}" ]] || {
  echo "Comando de release recusado" >&2
  exit 2
}

command -v flock >/dev/null || { echo "flock e obrigatorio." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 e obrigatorio." >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum e obrigatorio." >&2; exit 1; }
mkdir -p "${RELEASE_ROOT}" "${RELEASES_DIR}" "${BACKUP_ROOT}"
chmod 700 "${RELEASES_DIR}" "${BACKUP_ROOT}"
exec 9>"${LOCK_FILE}"
flock -n 9 || { echo "Ja existe uma release em execucao." >&2; exit 1; }

release_dir="${RELEASES_DIR}/${release_id}"
current_link="${RELEASE_ROOT}/current"
ROLLBACK_CAPABILITY="nikufra-dark-rollback-v1"
BACKEND_MANIFEST=".backend-manifest.sha256"
WEB_BUNDLE=".web-bundle.tar.gz"
WEB_CHECKSUM=".web-bundle.sha256"
OUTREACH_IMAGE_ARCHIVE=".outreach-image.tar"
OUTREACH_IMAGE_CHECKSUM=".outreach-image.sha256"
OUTREACH_IMAGE_ID=".outreach-image.id"
OUTREACH_IMAGE_REF=".outreach-image.ref"
CORE_IMAGE_MANIFEST=".core-images.manifest"
CORE_IMAGE_CHECKSUM=".core-images.sha256"

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

outreach_image_ref_for_tree() {
  local tree="$1" tree_release_id
  [[ -f "${tree}/.release-id" && ! -L "${tree}/.release-id" ]] || {
    echo "Release sem identidade para tag Outreach." >&2
    return 1
  }
  tree_release_id="$(< "${tree}/.release-id")"
  [[ "${tree_release_id}" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || {
    echo "Identidade inválida para tag Outreach." >&2
    return 1
  }
  printf 'nikufra-outreach:release-%s\n' "${tree_release_id}"
}

verify_outreach_image_release() {
  local tree="$1" archive checksum_file id_file ref_file expected_checksum expected_id expected_ref file
  archive="${tree}/${OUTREACH_IMAGE_ARCHIVE}"
  checksum_file="${tree}/${OUTREACH_IMAGE_CHECKSUM}"
  id_file="${tree}/${OUTREACH_IMAGE_ID}"
  ref_file="${tree}/${OUTREACH_IMAGE_REF}"
  for file in "${archive}" "${checksum_file}" "${id_file}" "${ref_file}"; do
    [[ -f "${file}" && ! -L "${file}" ]] || { echo "Artefacto de imagem Outreach ausente ou inseguro: ${file}" >&2; return 1; }
  done
  [[ -s "${archive}" ]] || { echo "Archive da imagem Outreach vazio." >&2; return 1; }
  expected_checksum="$(< "${checksum_file}")"
  expected_id="$(< "${id_file}")"
  expected_ref="$(< "${ref_file}")"
  [[ "${expected_checksum}" =~ ^[0-9a-f]{64}$ \
    && "$(sha256_file "${archive}")" == "${expected_checksum}" ]] || {
    echo "Checksum do archive da imagem Outreach diverge." >&2
    return 1
  }
  [[ "${expected_id}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Image ID Outreach inválido." >&2; return 1; }
  [[ "${expected_ref}" == "$(outreach_image_ref_for_tree "${tree}")" ]] || {
    echo "Referência da imagem Outreach não corresponde às fontes da release." >&2
    return 1
  }
  python3 - "${archive}" "${expected_id}" "${expected_ref}" <<'PY'
import json
import pathlib
import sys
import tarfile

archive, expected_id, expected_ref = sys.argv[1:]
with tarfile.open(archive, "r:") as bundle:
    manifest_member = bundle.getmember("manifest.json")
    if not manifest_member.isfile() or manifest_member.size > 1024 * 1024:
        raise SystemExit("Manifest OCI ausente ou inválido")
    manifest_file = bundle.extractfile(manifest_member)
    if manifest_file is None:
        raise SystemExit("Manifest OCI ilegível")
    manifest = json.load(manifest_file)
    if not isinstance(manifest, list) or len(manifest) != 1:
        raise SystemExit("Archive Outreach deve conter exatamente uma imagem")
    entry = manifest[0]
    if entry.get("RepoTags") != [expected_ref]:
        raise SystemExit("Archive Outreach contém referência inesperada")
    config = entry.get("Config")
    if not isinstance(config, str) or pathlib.PurePosixPath(config).name.removesuffix(".json") != expected_id.removeprefix("sha256:"):
        raise SystemExit("Archive Outreach não contém o Image ID declarado")
    config_member = bundle.getmember(config)
    if not config_member.isfile():
        raise SystemExit("Config da imagem Outreach não é ficheiro regular")
    layers = entry.get("Layers")
    if not isinstance(layers, list) or not layers:
        raise SystemExit("Archive Outreach não contém layers")
    for layer in layers:
        if not isinstance(layer, str) or not bundle.getmember(layer).isfile():
            raise SystemExit("Layer inválida no archive Outreach")
PY
}

export_outreach_image() {
  local tree="$1" image_ref image_id image_id_after archive_partial checksum_partial id_partial ref_partial name
  image_ref="$(outreach_image_ref_for_tree "${tree}")"
  image_id="$(docker image inspect --format '{{.Id}}' "${image_ref}")"
  [[ "${image_id}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Não foi possível obter o Image ID Outreach." >&2; return 1; }
  for name in "${OUTREACH_IMAGE_ARCHIVE}" "${OUTREACH_IMAGE_CHECKSUM}" "${OUTREACH_IMAGE_ID}" "${OUTREACH_IMAGE_REF}"; do
    [[ ! -e "${tree}/${name}" ]] || { echo "Artefacto OCI já existe: ${name}." >&2; return 1; }
  done

  archive_partial="$(mktemp "${tree}/.${OUTREACH_IMAGE_ARCHIVE}.XXXXXX.partial")"
  checksum_partial="${tree}/${OUTREACH_IMAGE_CHECKSUM}.partial"
  id_partial="${tree}/${OUTREACH_IMAGE_ID}.partial"
  ref_partial="${tree}/${OUTREACH_IMAGE_REF}.partial"
  if ! docker image save --output "${archive_partial}" "${image_ref}"; then
    rm -f -- "${archive_partial}" "${checksum_partial}" "${id_partial}" "${ref_partial}"
    return 1
  fi
  image_id_after="$(docker image inspect --format '{{.Id}}' "${image_ref}")"
  if [[ "${image_id_after}" != "${image_id}" ]]; then
    rm -f -- "${archive_partial}" "${checksum_partial}" "${id_partial}" "${ref_partial}"
    echo "A tag Outreach mudou durante a exportação (${image_id} -> ${image_id_after})." >&2
    return 1
  fi
  printf '%s\n' "$(sha256_file "${archive_partial}")" > "${checksum_partial}"
  printf '%s\n' "${image_id}" > "${id_partial}"
  printf '%s\n' "${image_ref}" > "${ref_partial}"
  chmod 400 "${archive_partial}" "${checksum_partial}" "${id_partial}" "${ref_partial}"
  mv -- "${archive_partial}" "${tree}/${OUTREACH_IMAGE_ARCHIVE}"
  mv -- "${checksum_partial}" "${tree}/${OUTREACH_IMAGE_CHECKSUM}"
  mv -- "${id_partial}" "${tree}/${OUTREACH_IMAGE_ID}"
  mv -- "${ref_partial}" "${tree}/${OUTREACH_IMAGE_REF}"
  verify_outreach_image_release "${tree}"
}

restore_outreach_image() {
  local tree="$1" expected_id image_ref loaded_id tagged_id
  verify_outreach_image_release "${tree}"
  expected_id="$(< "${tree}/${OUTREACH_IMAGE_ID}")"
  image_ref="$(< "${tree}/${OUTREACH_IMAGE_REF}")"

  # docker load consumes only the checksummed local archive. The rollback
  # activation also passes --pull never, so it cannot consult a registry.
  docker image load --input "${tree}/${OUTREACH_IMAGE_ARCHIVE}" >/dev/null
  loaded_id="$(docker image inspect --format '{{.Id}}' "${expected_id}")"
  [[ "${loaded_id}" == "${expected_id}" ]] || {
    echo "A imagem importada não corresponde ao Image ID da release." >&2
    return 1
  }
  docker image tag "${expected_id}" "${image_ref}"
  tagged_id="$(docker image inspect --format '{{.Id}}' "${image_ref}")"
  [[ "${tagged_id}" == "${expected_id}" ]] || {
    echo "A tag Outreach não aponta para o Image ID importado." >&2
    return 1
  }
}

verify_core_image_release() {
  local tree="$1" manifest checksum expected_checksum tree_release_id service compose_ref image_id release_alias extra configured_ref pin_name
  local compose=(docker compose --project-name nikufra-crm --env-file "${tree}/infra/.env" -f "${tree}/infra/docker-compose.yml" -f "${tree}/infra/docker-compose.production.yml")
  manifest="${tree}/${CORE_IMAGE_MANIFEST}"
  checksum="${tree}/${CORE_IMAGE_CHECKSUM}"
  [[ -f "${manifest}" && ! -L "${manifest}" \
    && -f "${checksum}" && ! -L "${checksum}" ]] || {
    echo "Manifest de imagens core ausente ou inseguro." >&2
    return 1
  }
  expected_checksum="$(< "${checksum}")"
  [[ "${expected_checksum}" =~ ^[0-9a-f]{64}$ \
    && "$(sha256_file "${manifest}")" == "${expected_checksum}" ]] || {
    echo "Checksum do manifest de imagens core diverge." >&2
    return 1
  }
  tree_release_id="$(< "${tree}/.release-id")"
  python3 - "${manifest}" "${tree_release_id}" <<'PY'
import pathlib
import re
import sys

manifest = pathlib.Path(sys.argv[1])
release_id = sys.argv[2]
expected_services = {"auth", "rest", "realtime", "kong", "functions"}
seen: set[str] = set()
for line in manifest.read_text(encoding="utf-8").splitlines():
    parts = line.split("|")
    if len(parts) != 4:
        raise SystemExit("Linha inválida no manifest de imagens core")
    service, compose_ref, image_id, release_alias = parts
    if service not in expected_services or service in seen:
        raise SystemExit(f"Serviço core inválido ou duplicado: {service}")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/@:-]{0,240}", compose_ref):
        raise SystemExit(f"Ref core inválida: {compose_ref}")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise SystemExit(f"Image ID core inválido: {image_id}")
    expected_alias = f"nikufra-core-{service}:release-{release_id}"
    if release_alias != expected_alias:
        raise SystemExit(f"Alias core inválido: {release_alias}")
    seen.add(service)
if seen != expected_services:
    raise SystemExit("Manifest de imagens core incompleto")
PY
  while IFS='|' read -r service compose_ref image_id release_alias extra; do
    configured_ref="$("${compose[@]}" config --format json | python3 -c '
import json
import sys
config = json.load(sys.stdin)
image = config.get("services", {}).get(sys.argv[1], {}).get("image")
if not isinstance(image, str) or not image:
    raise SystemExit(1)
print(image)
' "${service}")"
    [[ "${configured_ref}" == "${compose_ref}" \
      && "$(docker image inspect --format '{{.Id}}' "${release_alias}")" == "${image_id}" ]] || {
      echo "Imagem/alias core diverge para ${service}." >&2
      return 1
    }
    pin_name="nikufra-core-pin-${service}-${tree_release_id}"
    [[ "$(docker inspect --format '{{.Image}}' "${pin_name}")" == "${image_id}" ]] || {
      echo "Pin core diverge para ${service}." >&2
      return 1
    }
  done < "${manifest}"
}

capture_core_images() {
  local tree="$1" tree_release_id manifest_partial checksum_partial created_partial service
  local compose=(docker compose --project-name nikufra-crm --env-file "${tree}/infra/.env" -f "${tree}/infra/docker-compose.yml" -f "${tree}/infra/docker-compose.production.yml")
  tree_release_id="$(< "${tree}/.release-id")"
  [[ ! -e "${tree}/${CORE_IMAGE_MANIFEST}" && ! -e "${tree}/${CORE_IMAGE_CHECKSUM}" ]] || {
    echo "Manifest de imagens core já existe." >&2
    return 1
  }
  manifest_partial="${tree}/${CORE_IMAGE_MANIFEST}.partial"
  checksum_partial="${tree}/${CORE_IMAGE_CHECKSUM}.partial"
  created_partial="${tree}/.core-images.created.partial"
  : > "${created_partial}"
  if ! (
    set -Eeuo pipefail
    : > "${manifest_partial}"
    for service in auth rest realtime kong functions; do
      container_id="$("${compose[@]}" ps -q "${service}")"
      [[ -n "${container_id}" ]] || { echo "Não foi possível capturar ${service}: container ausente." >&2; exit 1; }
      compose_ref="$(docker inspect --format '{{.Config.Image}}' "${container_id}")"
      configured_ref="$("${compose[@]}" config --format json | python3 -c '
import json
import sys
config = json.load(sys.stdin)
image = config.get("services", {}).get(sys.argv[1], {}).get("image")
if not isinstance(image, str) or not image:
    raise SystemExit(1)
print(image)
' "${service}")"
      [[ "${compose_ref}" == "${configured_ref}" ]] || { echo "Ref runtime/Compose diverge para ${service}." >&2; exit 1; }
      image_id="$(docker inspect --format '{{.Image}}' "${container_id}")"
      [[ "${image_id}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Image ID core inválido para ${service}." >&2; exit 1; }
      release_alias="nikufra-core-${service}:release-${tree_release_id}"
      pin_name="nikufra-core-pin-${service}-${tree_release_id}"
      ! docker inspect "${pin_name}" >/dev/null 2>&1 || { echo "Pin core já existe: ${pin_name}." >&2; exit 1; }
      docker image tag "${image_id}" "${release_alias}"
      alias_id="$(docker image inspect --format '{{.Id}}' "${release_alias}")"
      [[ "${alias_id}" == "${image_id}" ]] || { echo "Alias core diverge para ${service}." >&2; exit 1; }
      printf '%s\n' "${service}" >> "${created_partial}"
      docker create --name "${pin_name}" \
        --label "nikufra.release=${tree_release_id}" \
        --label "nikufra.core-service=${service}" \
        "${release_alias}" >/dev/null
      [[ "$(docker inspect --format '{{.Image}}' "${pin_name}")" == "${image_id}" ]] || {
        echo "Pin core diverge para ${service}." >&2
        exit 1
      }
      printf '%s|%s|%s|%s\n' "${service}" "${compose_ref}" "${image_id}" "${release_alias}" >> "${manifest_partial}"
    done
  ); then
    while IFS= read -r service; do
      docker rm -f "nikufra-core-pin-${service}-${tree_release_id}" >/dev/null 2>&1 || true
      docker image rm "nikufra-core-${service}:release-${tree_release_id}" >/dev/null 2>&1 || true
    done < "${created_partial}"
    rm -f -- "${manifest_partial}" "${checksum_partial}" "${created_partial}"
    return 1
  fi
  rm -f -- "${created_partial}"
  printf '%s\n' "$(sha256_file "${manifest_partial}")" > "${checksum_partial}"
  chmod 400 "${manifest_partial}" "${checksum_partial}"
  mv -- "${manifest_partial}" "${tree}/${CORE_IMAGE_MANIFEST}"
  mv -- "${checksum_partial}" "${tree}/${CORE_IMAGE_CHECKSUM}"
  verify_core_image_release "${tree}"
}

write_backend_manifest() {
  local tree="$1"
  python3 - "${tree}" "${BACKEND_MANIFEST}" <<'PY'
import hashlib
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
manifest_name = sys.argv[2]
excluded = {
    "infra/.env",
    manifest_name,
    ".web-bundle.tar.gz",
    ".web-bundle.sha256",
    ".outreach-image.tar",
    ".outreach-image.sha256",
    ".outreach-image.id",
    ".outreach-image.ref",
    ".core-images.manifest",
    ".core-images.sha256",
}
entries: list[tuple[str, str]] = []
for item in root.rglob("*"):
    relative = item.relative_to(root).as_posix()
    if item.is_symlink():
        if relative != "backups":
            raise SystemExit(f"Symlink inesperado na release: {relative}")
        continue
    if item.is_file() and relative not in excluded:
        digest = hashlib.sha256(item.read_bytes()).hexdigest()
        entries.append((relative, digest))
if not entries:
    raise SystemExit("Release sem ficheiros para manifest")
with (root / manifest_name).open("w", encoding="utf-8", newline="\n") as output:
    for relative, digest in sorted(entries):
        output.write(f"{digest}  {relative}\n")
PY
  chmod 400 "${tree}/${BACKEND_MANIFEST}"
}

verify_manifest_tree() {
  local tree="$1"
  python3 - "${tree}" "${BACKEND_MANIFEST}" <<'PY'
import hashlib
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
manifest_name = sys.argv[2]
manifest = root / manifest_name
if not manifest.is_file() or manifest.is_symlink():
    raise SystemExit("Manifest backend ausente ou inseguro")
excluded = {
    "infra/.env",
    manifest_name,
    ".web-bundle.tar.gz",
    ".web-bundle.sha256",
    ".outreach-image.tar",
    ".outreach-image.sha256",
    ".outreach-image.id",
    ".outreach-image.ref",
    ".core-images.manifest",
    ".core-images.sha256",
}
expected: dict[str, str] = {}
for line in manifest.read_text(encoding="utf-8").splitlines():
    parts = line.split("  ", 1)
    if len(parts) != 2 or not re.fullmatch(r"[0-9a-f]{64}", parts[0]):
        raise SystemExit("Linha inválida no manifest backend")
    relative = parts[1]
    path = pathlib.PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts or relative in excluded or relative in expected:
        raise SystemExit(f"Caminho inválido no manifest: {relative}")
    expected[relative] = parts[0]
actual: set[str] = set()
for item in root.rglob("*"):
    relative = item.relative_to(root).as_posix()
    if item.is_symlink():
        if relative != "backups":
            raise SystemExit(f"Symlink inesperado na release: {relative}")
        continue
    if item.is_file() and relative not in excluded:
        actual.add(relative)
if set(expected) != actual:
    missing = sorted(set(expected) - actual)
    extra = sorted(actual - set(expected))
    raise SystemExit(f"Árvore backend diverge do manifest; missing={missing}, extra={extra}")
for relative, digest in expected.items():
    actual_digest = hashlib.sha256((root / relative).read_bytes()).hexdigest()
    if actual_digest != digest:
        raise SystemExit(f"Checksum backend diverge: {relative}")
PY
}

verify_backend_source_release() {
  local tree="$1" expected_id="$2" releases_real tree_real
  [[ -d "${tree}" && ! -L "${tree}" ]] || { echo "Release backend ausente ou insegura." >&2; return 1; }
  releases_real="$(readlink -f "${RELEASES_DIR}")"
  tree_real="$(readlink -f "${tree}")"
  [[ "$(dirname "${tree_real}")" == "${releases_real}" && "$(basename "${tree_real}")" == "${expected_id}" ]] || {
    echo "Release fora da allowlist de diretórios." >&2
    return 1
  }
  [[ -f "${tree}/.release-id" && ! -L "${tree}/.release-id" && "$(< "${tree}/.release-id")" == "${expected_id}" ]] || {
    echo "Identidade da release diverge." >&2
    return 1
  }
  [[ -f "${tree}/.rollback-capability" && ! -L "${tree}/.rollback-capability" \
    && "$(< "${tree}/.rollback-capability")" == "${ROLLBACK_CAPABILITY}" ]] || {
    echo "Release sem capability de rollback compatível." >&2
    return 1
  }
  [[ -L "${tree}/backups" && "$(readlink -f "${tree}/backups")" == "$(readlink -f "${BACKUP_ROOT}")" ]] || {
    echo "Ligação persistente de backups inválida." >&2
    return 1
  }
  verify_manifest_tree "${tree}"
}

verify_backend_release() {
  local tree="$1" expected_id="$2"
  verify_backend_source_release "${tree}" "${expected_id}"
  verify_outreach_image_release "${tree}"
  verify_core_image_release "${tree}"
}

verify_web_release() {
  local tree="$1" expected
  [[ -f "${tree}/${WEB_BUNDLE}" && ! -L "${tree}/${WEB_BUNDLE}" ]] || { echo "Bundle web imutável em falta." >&2; return 1; }
  [[ -f "${tree}/${WEB_CHECKSUM}" && ! -L "${tree}/${WEB_CHECKSUM}" ]] || { echo "Checksum web em falta." >&2; return 1; }
  expected="$(< "${tree}/${WEB_CHECKSUM}")"
  [[ "${expected}" =~ ^[0-9a-f]{64}$ && "$(sha256_file "${tree}/${WEB_BUNDLE}")" == "${expected}" ]] || {
    echo "Checksum do bundle web diverge." >&2
    return 1
  }
}

resolve_config_source() {
  local fallback current_real="" current_id="" releases_real candidate=""
  fallback="${RELEASE_ROOT}/infra/.env"
  releases_real="$(readlink -f "${RELEASES_DIR}")"

  # A broken current release is a reason to roll back, not a prerequisite that
  # may make rollback impossible. Trust current only for its canonical, private
  # env file; the target release remains subject to the complete verification.
  if [[ -L "${current_link}" ]] \
    && current_real="$(readlink -f "${current_link}" 2>/dev/null)" \
    && [[ -n "${current_real}" ]]; then
    current_id="$(basename "${current_real}")"
    candidate="${current_real}/infra/.env"
    if [[ "$(dirname "${current_real}")" == "${releases_real}" \
      && "${current_id}" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ \
      && -d "${current_real}" && ! -L "${current_real}" \
      && -f "${current_real}/.release-id" && ! -L "${current_real}/.release-id" \
      && "$(< "${current_real}/.release-id")" == "${current_id}" \
      && -f "${candidate}" && ! -L "${candidate}" \
      && "$(stat -c '%a' "${candidate}")" == 600 ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
    echo "Aviso: current não fornece um env canónico seguro; a usar o env estável." >&2
  fi

  [[ -f "${fallback}" && ! -L "${fallback}" && "$(stat -c '%a' "${fallback}")" == 600 ]] || {
    echo "Nenhum infra/.env canónico e privado está disponível." >&2
    return 1
  }
  printf '%s\n' "${fallback}"
}

validate_stored_web() {
  local tree="$1" target_id="$2" web_hash
  verify_web_release "${tree}"
  web_hash="$(< "${tree}/${WEB_CHECKSUM}")"
  SSH_ORIGINAL_COMMAND=publish-web \
  NIKUFRA_WEB_ARCHIVE_SOURCE="${tree}/${WEB_BUNDLE}" \
  NIKUFRA_WEB_VALIDATE_ONLY=true \
  NIKUFRA_WEB_RELEASE_ID="${target_id}" \
  NIKUFRA_WEB_BUNDLE_SHA256="${web_hash}" \
    "${tree}/infra/web-publish.sh" >/dev/null
}

install_dark_env() {
  local source="$1" tree="$2" env_tmp count
  [[ -f "${source}" && ! -L "${source}" && "$(stat -c '%a' "${source}")" == 600 ]] || {
    echo "infra/.env de origem em falta ou inseguro." >&2
    return 1
  }
  env_tmp="$(mktemp "${tree}/infra/.env.dark.XXXXXX")"
  if ! install -m 600 "${source}" "${env_tmp}"; then
    rm -f -- "${env_tmp}"
    return 1
  fi
  # Remove every inherited occurrence before appending the two authoritative
  # dark values. Editing just the first occurrence is unsafe because Compose
  # accepts duplicate keys and the final value wins.
  perl -0pi -e 's/^OUTREACH_(?:SEND_ENABLED|SHADOW_MODE)=.*\n?//mg' "${env_tmp}"
  printf '\nOUTREACH_SEND_ENABLED=false\nOUTREACH_SHADOW_MODE=true\n' >> "${env_tmp}"
  count="$(grep -c '^OUTREACH_SEND_ENABLED=' "${env_tmp}" || true)"
  if [[ "${count}" != 1 ]] || ! grep -qx 'OUTREACH_SEND_ENABLED=false' "${env_tmp}"; then
    rm -f -- "${env_tmp}"
    echo "Não foi possível fixar OUTREACH_SEND_ENABLED=false exatamente uma vez." >&2
    return 1
  fi
  count="$(grep -c '^OUTREACH_SHADOW_MODE=' "${env_tmp}" || true)"
  if [[ "${count}" != 1 ]] || ! grep -qx 'OUTREACH_SHADOW_MODE=true' "${env_tmp}"; then
    rm -f -- "${env_tmp}"
    echo "Não foi possível fixar OUTREACH_SHADOW_MODE=true exatamente uma vez." >&2
    return 1
  fi
  chmod 600 "${env_tmp}"
  mv -f -- "${env_tmp}" "${tree}/infra/.env"
}

verify_target_migration_ledger() {
  local tree="$1" migration name expected actual found=false
  local compose=(docker compose --project-name nikufra-crm --env-file "${tree}/infra/.env" -f "${tree}/infra/docker-compose.yml" -f "${tree}/infra/docker-compose.production.yml")
  for migration in "${tree}"/supabase/migrations/*.sql; do
    [[ -f "${migration}" ]] || continue
    found=true
    name="$(basename "${migration}")"
    [[ "${name}" =~ ^[0-9]{12}_[A-Za-z0-9_.-]+\.sql$ ]] || { echo "Migration inválida na release: ${name}" >&2; return 1; }
    expected="$(sha256_file "${migration}")"
    actual="$("${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc \
      "select checksum_sha256 from nikufra_meta.schema_migrations where name='${name}'")"
    [[ -n "${actual}" && "${actual}" == "${expected}" ]] || {
      echo "Rollback recusado: migration ${name} não consta do ledger com o checksum publicado." >&2
      return 1
    }
  done
  [[ "${found}" == true ]] || { echo "Release sem migrations." >&2; return 1; }
}

ledger_fingerprint() {
  local tree="$1"
  local compose=(docker compose --project-name nikufra-crm --env-file "${tree}/infra/.env" -f "${tree}/infra/docker-compose.yml" -f "${tree}/infra/docker-compose.production.yml")
  "${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc \
    "select count(*)::text || ':' || md5(coalesce(string_agg(name || ':' || checksum_sha256, ',' order by name), '')) from nikufra_meta.schema_migrations"
}

activate_current_release() {
  local target_id="$1" next_link
  next_link="${RELEASE_ROOT}/.current.${target_id}.tmp"
  rm -f -- "${next_link}"
  ln -s ".releases/${target_id}" "${next_link}"
  mv -Tf -- "${next_link}" "${current_link}"
}

publish_stored_web() {
  local tree="$1" target_id="$2" web_hash marker expected_marker
  verify_web_release "${tree}"
  web_hash="$(< "${tree}/${WEB_CHECKSUM}")"
  SSH_ORIGINAL_COMMAND=publish-web \
  NIKUFRA_WEB_ARCHIVE_SOURCE="${tree}/${WEB_BUNDLE}" \
  NIKUFRA_WEB_VALIDATE_ONLY=false \
  NIKUFRA_WEB_RELEASE_ID="${target_id}" \
  NIKUFRA_WEB_BUNDLE_SHA256="${web_hash}" \
    "${tree}/infra/web-publish.sh"
  marker="${NIKUFRA_WEB_PUBLISH_ROOT:-/home/luis/stacks/caddy/portal}/crm-app.release"
  expected_marker="$(printf 'release_id=%s\nbundle_sha256=%s' "${target_id}" "${web_hash}")"
  [[ -f "${marker}" && ! -L "${marker}" && "$(< "${marker}")" == "${expected_marker}" ]] || {
    echo "Marcador da aplicação web não confirmou ${target_id}." >&2
    return 1
  }
}

assert_current_release() {
  [[ -L "${current_link}" ]] || { echo "Release current em falta." >&2; return 1; }
  [[ "$(readlink -f "${current_link}")" == "$(readlink -f "${release_dir}")" ]] || {
    echo "O backend current nao corresponde a ${release_id}." >&2
    return 1
  }
  verify_backend_release "${release_dir}" "${release_id}"
}

case "${action}" in
  publish-backend)
    [[ ! -e "${release_dir}" ]] || { echo "A release ${release_id} ja existe; usa um novo run attempt." >&2; exit 1; }
    command -v python3 >/dev/null || { echo "python3 e obrigatorio." >&2; exit 1; }
    command -v timeout >/dev/null || { echo "timeout e obrigatorio." >&2; exit 1; }

    archive="$(mktemp "${RELEASE_ROOT}/.backend-release.XXXXXX.tar.gz")"
    stage="$(mktemp -d "${RELEASES_DIR}/.${release_id}.partial.XXXXXX")"
    cleanup() {
      local status=$?
      rm -f -- "${archive}"
      if [[ -n "${stage:-}" && -d "${stage}" ]]; then rm -rf -- "${stage}"; fi
      exit "${status}"
    }
    trap cleanup EXIT

    timeout 180 dd bs=1M count=256 iflag=fullblock of="${archive}" status=none
    [[ -s "${archive}" ]] || { echo "Bundle backend vazio." >&2; exit 1; }
    python3 - "${archive}" <<'PY'
import hashlib
import pathlib
import re
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
required = {
    ".dockerignore",
    "infra/apply-migrations.sh",
    "infra/backup-production.sh",
    "infra/basebackup-production.sh",
    "infra/capture-pre-unification-recovery.sh",
    "infra/configure-backups.sh",
    "infra/configure-caddy-outreach.sh",
    "infra/configure-outreach-db.sh",
    "infra/configure-outreach.sh",
    "infra/configure-wal-archive.sh",
    "infra/deploy-production.sh",
    "infra/install-backup-schedule.sh",
    "infra/outreach-readiness.sh",
    "infra/pitr-restore-drill.sh",
    "infra/predeploy-safety.sh",
    "infra/pre-unification-recovery.md",
    "infra/release-publish.sh",
    "infra/release-sentinel.sh",
    "infra/restore-drill.sh",
    "infra/wal-offsite-sync.sh",
    "infra/web-publish.sh",
    "infra/docker-compose.yml",
    "infra/docker-compose.production.yml",
    "infra/init/realtime.sql",
    "infra/init/roles.sql",
    "infra/volumes/api/kong.production.yml",
    "infra/volumes/api/kong.yml",
    "infra/volumes/functions/_shared/mime.ts",
    "infra/volumes/functions/_shared/security.ts",
    "infra/volumes/functions/billing-delete/index.ts",
    "infra/volumes/functions/chat-agent-config/index.ts",
    "infra/volumes/functions/chat-agent/index.ts",
    "infra/volumes/functions/contact-delete/index.ts",
    "infra/volumes/functions/deno.jsonc",
    "infra/volumes/functions/deno.lock",
    "infra/volumes/functions/deno.typecheck.jsonc",
    "infra/volumes/functions/vendor.sha256",
    "infra/volumes/functions/vendor/standardwebhooks.bundle.js",
    "infra/volumes/functions/vendor/supabase-js.bundle.js",
    "infra/volumes/functions/gmail-drafts/index.ts",
    "infra/volumes/functions/gmail-import-confirm/index.ts",
    "infra/volumes/functions/gmail-import-preview/index.ts",
    "infra/volumes/functions/gmail-oauth-callback/index.ts",
    "infra/volumes/functions/gmail-oauth-start/index.ts",
    "infra/volumes/functions/gmail-sync/index.ts",
    "infra/volumes/functions/import-leads/index.ts",
    "infra/volumes/functions/invite-user/index.ts",
    "infra/volumes/functions/main/edge-runtime.d.ts",
    "infra/volumes/functions/main/index.ts",
    "infra/volumes/functions/mcp/index.ts",
    "infra/volumes/functions/send-auth-email/index.ts",
    "services/outreach/Dockerfile",
    "services/outreach/package.json",
    "services/outreach/package-lock.json",
    "services/outreach/tsconfig.json",
    "services/outreach/src/api-routes.ts",
    "services/outreach/src/api.ts",
    "services/outreach/src/auth.ts",
    "services/outreach/src/batch.ts",
    "services/outreach/src/config.ts",
    "services/outreach/src/crypto.ts",
    "services/outreach/src/db.ts",
    "services/outreach/src/delivery-signals.ts",
    "services/outreach/src/delivery.ts",
    "services/outreach/src/dns.ts",
    "services/outreach/src/errors.ts",
    "services/outreach/src/heartbeat.ts",
    "services/outreach/src/http.ts",
    "services/outreach/src/inbound.ts",
    "services/outreach/src/migrate.ts",
    "services/outreach/src/migration-cli.ts",
    "services/outreach/src/migration.ts",
    "services/outreach/src/mime.ts",
    "services/outreach/src/mutations.ts",
    "services/outreach/src/oauth.ts",
    "services/outreach/src/providers.ts",
    "services/outreach/src/rate-limit.ts",
    "services/outreach/src/reply-intent.ts",
    "services/outreach/src/repository.ts",
    "services/outreach/src/rotate-keys.ts",
    "services/outreach/src/rotation.ts",
    "services/outreach/src/router.ts",
    "services/outreach/src/scheduler.ts",
    "services/outreach/src/transport-security.ts",
    "services/outreach/src/types.ts",
    "services/outreach/src/verification.ts",
    "services/outreach/src/worker.ts",
}
seen: set[str] = set()
regular_files: set[str] = set()
allowed_name = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$")
vendor_prefix = "infra/volumes/functions/vendor/"
total = 0
members = 0
with tarfile.open(archive, "r:gz") as bundle:
    regular_members: dict[str, tarfile.TarInfo] = {}
    for member in bundle.getmembers():
        members += 1
        name = member.name.removeprefix("./").rstrip("/")
        if not name:
            continue
        path = pathlib.PurePosixPath(name)
        name_allowed = (
            name == ".dockerignore"
            or bool(allowed_name.fullmatch(name))
        )
        if (path.is_absolute() or ".." in path.parts or name in seen or not name_allowed):
            raise SystemExit(f"Caminho recusado: {member.name}")
        seen.add(name)
        allowed = (
            name == ".dockerignore"
            or (member.isdir() and name in {"services", "supabase"})
            or (path.parts[0] == "infra" and name != "infra/.env" and "backups" not in path.parts)
            or (len(path.parts) >= 2 and path.parts[:2] == ("services", "outreach"))
            or (len(path.parts) >= 2 and path.parts[:2] == ("supabase", "migrations"))
        )
        if not allowed or not (member.isfile() or member.isdir()):
            raise SystemExit(f"Membro recusado: {member.name}")
        if member.isfile():
            regular_files.add(name)
            regular_members[name] = member
            total += member.size
    if members > 10_000 or total > 200 * 1024 * 1024:
        raise SystemExit("Bundle backend excede os limites.")
    missing = required - regular_files
    if missing:
        raise SystemExit("Bundle backend incompleto: " + ", ".join(sorted(missing)))
    if not any(name.startswith("supabase/migrations/") and name.endswith(".sql") for name in regular_files):
        raise SystemExit("Bundle sem migrations SQL.")

    checksum_name = "infra/volumes/functions/vendor.sha256"
    checksum_member = regular_members[checksum_name]
    if checksum_member.size > 1024 * 1024:
        raise SystemExit("Manifest vendor excede o limite.")
    checksum_file = bundle.extractfile(checksum_member)
    if checksum_file is None:
        raise SystemExit("Manifest vendor ilegível.")
    try:
        checksum_lines = checksum_file.read().decode("utf-8").splitlines()
    except UnicodeDecodeError as error:
        raise SystemExit("Manifest vendor não é UTF-8.") from error
    vendor_digests: dict[str, str] = {}
    for line_number, line in enumerate(checksum_lines, start=1):
        match = re.fullmatch(
            r"([0-9a-f]{64})  (vendor/[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.bundle\.js)",
            line,
        )
        if match is None:
            raise SystemExit(f"Linha vendor inválida: {line_number}")
        digest, relative = match.groups()
        relative_path = pathlib.PurePosixPath(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts or relative in vendor_digests:
            raise SystemExit(f"Caminho vendor inválido ou duplicado: {relative}")
        full_name = "infra/volumes/functions/" + relative
        if not full_name.startswith(vendor_prefix) or full_name not in regular_members:
            raise SystemExit(f"Ficheiro vendor ausente ou não regular: {relative}")
        vendor_file = bundle.extractfile(regular_members[full_name])
        if vendor_file is None or hashlib.sha256(vendor_file.read()).hexdigest() != digest:
            raise SystemExit(f"Checksum vendor diverge: {relative}")
        vendor_digests[relative] = digest
    actual_vendor = {
        name.removeprefix("infra/volumes/functions/")
        for name in regular_files
        if name.startswith(vendor_prefix)
    }
    if not vendor_digests or set(vendor_digests) != actual_vendor:
        raise SystemExit("Árvore vendor diverge de vendor.sha256.")
PY
    tar -xzf "${archive}" --no-same-owner --no-same-permissions -C "${stage}"
    [[ ! -e "${stage}/infra/.env" ]] || { echo "O bundle tentou fornecer infra/.env." >&2; exit 1; }
    printf '%s\n' "${release_id}" > "${stage}/.release-id"
    printf '%s\n' "${ROLLBACK_CAPABILITY}" > "${stage}/.rollback-capability"

    config_source="$(resolve_config_source)"
    # Every automated release is deliberately demoted to dark mode. A canary
    # or live promotion remains an explicit, separate operator action.
    install_dark_env "${config_source}" "${stage}"
    ln -s "${BACKUP_ROOT}" "${stage}/backups"
    chmod 755 "${stage}"/infra/*.sh
    chmod 400 "${stage}/.release-id" "${stage}/.rollback-capability"
    write_backend_manifest "${stage}"
    verify_manifest_tree "${stage}"
    mv -- "${stage}" "${release_dir}"
    stage=""
    verify_backend_source_release "${release_dir}" "${release_id}"

    # There is no immutable predecessor before the first publisher-managed
    # release. Capture the old source/web/Caddy/image identities once so an
    # operator can recover the pre-unification CRM without reverting additive
    # migrations or relying on an unverified directory.
    if [[ ! -L "${current_link}" ]]; then
      NIKUFRA_SOURCE_ROOT="${RELEASE_ROOT}" \
      NIKUFRA_BACKUP_ROOT="${BACKUP_ROOT}" \
        "${release_dir}/infra/capture-pre-unification-recovery.sh"
    fi

    COMPOSE_PROJECT_NAME=nikufra-crm NIKUFRA_BACKUP_ROOT="${BACKUP_ROOT}" "${release_dir}/infra/deploy-production.sh"
    export_outreach_image "${release_dir}"
    capture_core_images "${release_dir}"
    verify_backend_release "${release_dir}" "${release_id}"
    COMPOSE_PROJECT_NAME=nikufra-crm NIKUFRA_BACKUP_ROOT="${BACKUP_ROOT}" "${release_dir}/infra/release-sentinel.sh"

    activate_current_release "${release_id}"

    # Keep the stable forced-command bootstrap current for the next run. The
    # secret env and backup tree in RELEASE_ROOT are never replaced.
    if [[ "${SCRIPT_DIR}" != "${release_dir}/infra" ]]; then
      install -m 755 "${release_dir}/infra/release-publish.sh" "${SCRIPT_DIR}/.release-publish.sh.new"
      mv -f -- "${SCRIPT_DIR}/.release-publish.sh.new" "${SCRIPT_DIR}/release-publish.sh"
    fi
    echo "BACKEND_RELEASE_OK ${release_id} (dark mode)"
    ;;
  verify-backend)
    assert_current_release
    COMPOSE_PROJECT_NAME=nikufra-crm NIKUFRA_BACKUP_ROOT="${BACKUP_ROOT}" "${release_dir}/infra/release-sentinel.sh"
    echo "BACKEND_VERIFY_OK ${release_id}"
    ;;
  publish-web)
    assert_current_release
    [[ ! -e "${release_dir}/${WEB_BUNDLE}" && ! -e "${release_dir}/${WEB_CHECKSUM}" ]] || {
      echo "A release ${release_id} já tem um bundle web imutável." >&2
      exit 1
    }
    COMPOSE_PROJECT_NAME=nikufra-crm NIKUFRA_BACKUP_ROOT="${BACKUP_ROOT}" "${release_dir}/infra/release-sentinel.sh"
    command -v timeout >/dev/null || { echo "timeout e obrigatorio." >&2; exit 1; }
    web_partial="$(mktemp "${release_dir}/.web-bundle.XXXXXX.partial")"
    web_checksum_partial="${release_dir}/${WEB_CHECKSUM}.partial"
    cleanup_web() {
      local status=$?
      if [[ -n "${web_partial}" ]]; then rm -f -- "${web_partial}"; fi
      rm -f -- "${web_checksum_partial}"
      exit "${status}"
    }
    trap cleanup_web EXIT
    timeout 120 dd bs=1M count=256 iflag=fullblock of="${web_partial}" status=none
    [[ -s "${web_partial}" ]] || { echo "Bundle web vazio." >&2; exit 1; }
    web_hash="$(sha256_file "${web_partial}")"
    SSH_ORIGINAL_COMMAND=publish-web \
    NIKUFRA_WEB_ARCHIVE_SOURCE="${web_partial}" \
    NIKUFRA_WEB_VALIDATE_ONLY=true \
    NIKUFRA_WEB_RELEASE_ID="${release_id}" \
    NIKUFRA_WEB_BUNDLE_SHA256="${web_hash}" \
      "${release_dir}/infra/web-publish.sh"
    chmod 400 "${web_partial}"
    mv -- "${web_partial}" "${release_dir}/${WEB_BUNDLE}"
    web_partial=""
    printf '%s\n' "${web_hash}" > "${web_checksum_partial}"
    chmod 400 "${web_checksum_partial}"
    mv -- "${web_checksum_partial}" "${release_dir}/${WEB_CHECKSUM}"
    verify_web_release "${release_dir}"
    publish_stored_web "${release_dir}" "${release_id}"
    COMPOSE_PROJECT_NAME=nikufra-crm NIKUFRA_BACKUP_ROOT="${BACKUP_ROOT}" "${release_dir}/infra/release-sentinel.sh"
    echo "WEB_RELEASE_OK ${release_id}"
    ;;
  rollback-release)
    # Rollback is an activation of already-published immutable application
    # artifacts. The database ledger must already contain every target
    # migration with the exact checksum; no schema downgrade or old migration
    # application is permitted.
    verify_backend_release "${release_dir}" "${release_id}"
    verify_web_release "${release_dir}"
    # Exercise extraction and validation of the stored web bundle before any
    # image import, sender stop, or backend activation can create downtime.
    validate_stored_web "${release_dir}" "${release_id}"
    config_source="$(resolve_config_source)"
    install_dark_env "${config_source}" "${release_dir}"
    verify_target_migration_ledger "${release_dir}"
    ledger_before="$(ledger_fingerprint "${release_dir}")"

    # Prove the local archive can be checksummed, imported and tagged before
    # creating any production downtime. The unique release tag does not affect
    # the containers that are still running the current release.
    restore_outreach_image "${release_dir}"

    # The explicit preloaded mode now preflights every target image and running
    # dependency before it stops senders and forces the persistent dark gate.
    NIKUFRA_EXPECTED_OUTREACH_IMAGE_ID="$(< "${release_dir}/${OUTREACH_IMAGE_ID}")" \
    COMPOSE_PROJECT_NAME=nikufra-crm \
    NIKUFRA_BACKUP_ROOT="${BACKUP_ROOT}" \
      "${release_dir}/infra/deploy-production.sh" --rollback-preloaded
    ledger_after="$(ledger_fingerprint "${release_dir}")"
    [[ "${ledger_after}" == "${ledger_before}" ]] || {
      echo "Rollback recusado: o ledger de migrations mudou (${ledger_before} -> ${ledger_after})." >&2
      exit 1
    }
    verify_backend_release "${release_dir}" "${release_id}"
    COMPOSE_PROJECT_NAME=nikufra-crm NIKUFRA_BACKUP_ROOT="${BACKUP_ROOT}" \
      "${release_dir}/infra/release-sentinel.sh" --local-dark

    # Only after the target backend is healthy, checksummed and dark does the
    # stable current pointer move. The static publisher restores the previous
    # web directory if its atomic swap fails.
    activate_current_release "${release_id}"
    # If the web commit now fails, web-publish restores the previous document
    # root. Backend/current deliberately remain on this verified dark target;
    # that fail-closed state is safe to retry and is not auto-rolled back.
    assert_current_release
    publish_stored_web "${release_dir}" "${release_id}"
    COMPOSE_PROJECT_NAME=nikufra-crm NIKUFRA_BACKUP_ROOT="${BACKUP_ROOT}" \
      "${release_dir}/infra/release-sentinel.sh" --local-dark
    echo "ROLLBACK_RELEASE_OK ${release_id} (backend+web, dark mode; migrations preserved)"
    ;;
  *)
    echo "Operacao de release recusada." >&2
    exit 2
    ;;
esac
