#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nikufra-outreach-gates.XXXXXX")"
cleanup() { rm -rf -- "${WORK}"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# Exercise the publisher's actual function against a live/duplicated input.
# The immutable release env must contain one authoritative value for each gate.
eval "$(awk '/^install_dark_env\(\) \{/{copy=1} copy{print} copy && /^}$/{exit}' "${ROOT}/infra/release-publish.sh")"
# Production is GNU/Linux; adapt only the test's extracted GNU `stat -c` call
# when this suite is run by a developer on macOS.
if ! stat -c '%a' "${WORK}" >/dev/null 2>&1; then
  stat() {
    if [[ "${1:-}" == -c && "${2:-}" == '%a' ]]; then
      command stat -f '%Lp' "$3"
    else
      command stat "$@"
    fi
  }
fi
mkdir -p "${WORK}/release/infra"
printf '%s\n' \
  'NODE_ENV=production' \
  'OUTREACH_SEND_ENABLED=true' \
  'OUTREACH_SHADOW_MODE=false' \
  'OUTREACH_SEND_ENABLED=true' \
  'OUTREACH_SHADOW_MODE=false' > "${WORK}/source.env"
chmod 600 "${WORK}/source.env"
install_dark_env "${WORK}/source.env" "${WORK}/release"
unset -f stat 2>/dev/null || true
dark_env="${WORK}/release/infra/.env"
[[ "$(grep -c '^OUTREACH_SEND_ENABLED=' "${dark_env}")" == 1 ]] || fail "SEND gate duplicado"
[[ "$(grep -c '^OUTREACH_SHADOW_MODE=' "${dark_env}")" == 1 ]] || fail "shadow gate duplicado"
grep -qx 'OUTREACH_SEND_ENABLED=false' "${dark_env}" || fail "SEND gate não ficou false"
grep -qx 'OUTREACH_SHADOW_MODE=true' "${dark_env}" || fail "shadow gate não ficou true"

# A bare result=ok is not a recovery proof. Validate the exact function used
# by deploy and ensure it accepts only a complete, bounded report.
unset -f valid_recent_pitr_report
eval "$(awk '/^valid_recent_pitr_report\(\) \{/{copy=1} copy{print} copy && /^}$/{exit}' "${ROOT}/infra/deploy-production.sh")"
export NIKUFRA_BACKUP_ROOT="${WORK}/backups"
mkdir -p "${NIKUFRA_BACKUP_ROOT}/pitr-drills"
report="${NIKUFRA_BACKUP_ROOT}/pitr-drills/2026-10-01T120000Z.txt"
printf 'result=ok\n' > "${report}"
if valid_recent_pitr_report >/dev/null; then fail "relatório PITR incompleto foi aceite"; fi
printf '%s\n' \
  'base=base-2026-10-01T115900Z.tar.gpg' \
  'restored_at=2026-10-01T12:00:00Z' \
  'elapsed_seconds=120' \
  'target_lsn=0/ABCDEF' \
  'restored_lsn=0/ABCE00' \
  'counts={"profiles":1}' \
  'rpo_max_seconds=900' \
  'rto_max_seconds=14400' \
  'result=ok' > "${report}"
[[ "$(valid_recent_pitr_report)" == "${report}" ]] || fail "relatório PITR completo foi recusado"

# Keep the first-deploy bootstrap and all dark readiness proofs structurally
# ahead of the target-specific canary/live block.
base_line="$(grep -Fn '"${SCRIPT_DIR}/basebackup-production.sh"' "${ROOT}/infra/deploy-production.sh" | tail -1 | cut -d: -f1)"
pitr_line="$(grep -Fn '"${SCRIPT_DIR}/pitr-restore-drill.sh"' "${ROOT}/infra/deploy-production.sh" | tail -1 | cut -d: -f1)"
ready_line="$(grep -Fn '"${SCRIPT_DIR}/outreach-readiness.sh" --dark' "${ROOT}/infra/deploy-production.sh" | tail -1 | cut -d: -f1)"
[[ -n "${base_line}" && -n "${pitr_line}" && -n "${ready_line}" \
  && "${base_line}" -lt "${pitr_line}" && "${pitr_line}" -lt "${ready_line}" ]] \
  || fail "deploy não executa base+PITR antes da prontidão dark"

target_line="$(grep -Fn 'if [[ "${target}" != --dark ]]; then' "${ROOT}/infra/outreach-readiness.sh" | cut -d: -f1)"
base_gate_line="$(grep -n '^base_record=' "${ROOT}/infra/outreach-readiness.sh" | cut -d: -f1)"
pitr_gate_line="$(grep -n '^pitr_report=' "${ROOT}/infra/outreach-readiness.sh" | cut -d: -f1)"
wal_gate_line="$(grep -n '^wal_record=' "${ROOT}/infra/outreach-readiness.sh" | cut -d: -f1)"
[[ -n "${target_line}" && -n "${base_gate_line}" && -n "${pitr_gate_line}" && -n "${wal_gate_line}" \
  && "${base_gate_line}" -lt "${target_line}" \
  && "${pitr_gate_line}" -lt "${target_line}" \
  && "${wal_gate_line}" -lt "${target_line}" ]] \
  || fail "base/PITR/WAL não são gates do modo dark"

grep -Fq "private.outreach_delivery_ledger where status in ('sending','accepted','ambiguous')" \
  "${ROOT}/infra/outreach-readiness.sh" \
  || fail "readiness live não bloqueia ledgers de entrega não terminais"

# A rollback must prove/import the immutable image before downtime, then take
# only the explicit offline activation path. It must never fall through to the
# normal deploy branch that builds, migrates, backs up, or probes the Internet.
publisher="${ROOT}/infra/release-publish.sh"
deploy="${ROOT}/infra/deploy-production.sh"
sentinel="${ROOT}/infra/release-sentinel.sh"
rollback_block="$(awk '/^  rollback-release\)/{copy=1} copy{print} copy && /^    ;;$/{exit}' "${publisher}")"
web_validate_line="$(grep -Fn 'validate_stored_web "${release_dir}" "${release_id}"' <<< "${rollback_block}" | cut -d: -f1)"
restore_line="$(grep -Fn 'restore_outreach_image "${release_dir}"' <<< "${rollback_block}" | cut -d: -f1)"
activation_line="$(grep -Fn 'deploy-production.sh" --rollback-preloaded' <<< "${rollback_block}" | cut -d: -f1)"
current_assert_line="$(grep -Fn 'assert_current_release' <<< "${rollback_block}" | cut -d: -f1)"
web_publish_line="$(grep -Fn 'publish_stored_web "${release_dir}" "${release_id}"' <<< "${rollback_block}" | cut -d: -f1)"
[[ -n "${web_validate_line}" && -n "${restore_line}" && -n "${activation_line}" \
  && "${web_validate_line}" -lt "${restore_line}" && "${restore_line}" -lt "${activation_line}" ]] \
  || fail "rollback não valida/importa a imagem antes da ativação"
[[ -n "${current_assert_line}" && -n "${web_publish_line}" \
  && "${current_assert_line}" -lt "${web_publish_line}" ]] \
  || fail "rollback não confirma backend/current antes do swap web"
grep -Fq 'deploy-production.sh" --rollback-preloaded' <<< "${rollback_block}" \
  || fail "rollback não usa o modo preloaded explícito"
grep -Fq 'release-sentinel.sh" --local-dark' <<< "${rollback_block}" \
  || fail "rollback não usa sentinel local antes da ativação"

rollback_mode_block="$(awk '/^if \[\[ "\$\{DEPLOY_MODE\}" == --rollback-preloaded \]\]; then/{copy=1} copy{print} copy && /^  exit 0$/{exit}' "${deploy}")"
preflight_line="$(grep -Fn 'core_manifest="${PROJECT_DIR}/.core-images.manifest"' <<< "${rollback_mode_block}" | cut -d: -f1)"
mode_stop_line="$(grep -Fn 'stop outreach-worker outreach-api' <<< "${rollback_mode_block}" | cut -d: -f1)"
[[ -n "${preflight_line}" && -n "${mode_stop_line}" && "${preflight_line}" -lt "${mode_stop_line}" ]] \
  || fail "rollback não faz preflight de imagens/dependências antes do downtime"
grep -Fq -- '--no-build --pull never --no-deps --force-recreate --wait outreach-api' <<< "${rollback_mode_block}" \
  || fail "rollback API pode construir ou consultar registry"
grep -Fq -- '--no-build --pull never --no-deps --force-recreate --wait outreach-worker' <<< "${rollback_mode_block}" \
  || fail "rollback worker pode construir ou consultar registry"
grep -Fq -- '--no-build --pull never --no-deps --force-recreate --wait auth rest realtime' <<< "${rollback_mode_block}" \
  || fail "rollback não seleciona os serviços core da release alvo offline"
grep -Fq 'docker image tag "${image_id}" "${compose_ref}"' <<< "${rollback_mode_block}" \
  || fail "rollback não restaura refs core exatas antes de parar senders"
if grep -Eq 'apply-migrations|configure-caddy|backup-production|restore-drill|pitr-restore|https://' <<< "${rollback_mode_block}"; then
  fail "modo rollback contém migrations/configuração/backups/probes remotos"
fi
grep -Fq 'if [[ "${DEPLOY_MODE}" == --release ]]; then' "${deploy}" \
  || fail "configuração mutável não está isolada ao deploy normal"

# Every release has a unique tag and an independently checksummed image archive;
# the runtime sentinel compares Docker's real container Image ID, not just the
# user-controlled Config.Image string.
grep -Fq "printf 'nikufra-outreach:release-%s" "${publisher}" \
  || fail "publisher não cria ref única por release"
grep -Fq 'OUTREACH_IMAGE_TAG="release-${outreach_release_id}"' "${deploy}" \
  || fail "deploy normal não usa a tag única da release"
grep -Fq 'OUTREACH_IMAGE_TAG="release-${outreach_release_id}"' "${sentinel}" \
  || fail "sentinel não resolve a tag única da release"
grep -Fq 'docker image save --output' "${publisher}" \
  || fail "publisher não exporta a imagem da release"
grep -Fq 'docker image load --input' "${publisher}" \
  || fail "rollback não importa o archive local"
grep -Fq 'docker image tag "${expected_id}" "${image_ref}"' "${publisher}" \
  || fail "rollback não retaggeia o Image ID importado"
grep -Fq "docker inspect --format '{{.Image}}'" "${sentinel}" \
  || fail "sentinel não valida o Image ID real do container"
grep -Fq 'sha256_file "${OUTREACH_IMAGE_ARCHIVE}"' "${sentinel}" \
  || fail "sentinel não autentica o archive OCI por checksum"
grep -Fq 'capture_core_images "${release_dir}"' "${publisher}" \
  || fail "publisher não captura refs e Image IDs core"
grep -Fq 'docker create --name "${pin_name}"' "${publisher}" \
  || fail "publisher não cria pin container por imagem core"
grep -Fq 'CORE_IMAGE_MANIFEST="${PROJECT_DIR}/.core-images.manifest"' "${sentinel}" \
  || fail "sentinel não valida o manifest core"
grep -Fq 'runtime core de ${service} não corresponde à release' "${sentinel}" \
  || fail "sentinel não compara Image IDs core em runtime"
resolver_block="$(awk '/^resolve_config_source\(\) \{/{copy=1} copy{print} copy && /^}$/{exit}' "${publisher}")"
[[ -n "${resolver_block}" ]] || fail "resolver de env canónico ausente"
if grep -Fq 'verify_backend_release' <<< "${resolver_block}"; then
  fail "rollback ainda exige artefactos/pins íntegros da release current"
fi
grep -Fq 'fallback="${RELEASE_ROOT}/infra/.env"' <<< "${resolver_block}" \
  || fail "resolver não tem fallback para o env estável"

# The archive validator must fail before deployment if any script reachable
# from deploy/rollback (including cron-installed scripts) is absent from Git.
required_block="$(sed -n '/^required = {$/,/^}$/p' "${publisher}")"
required_runtime=(
  infra/apply-migrations.sh
  infra/backup-production.sh
  infra/basebackup-production.sh
  infra/capture-pre-unification-recovery.sh
  infra/configure-backups.sh
  infra/configure-caddy-outreach.sh
  infra/configure-outreach-db.sh
  infra/configure-outreach.sh
  infra/configure-wal-archive.sh
  infra/deploy-production.sh
  infra/install-backup-schedule.sh
  infra/outreach-readiness.sh
  infra/pitr-restore-drill.sh
  infra/predeploy-safety.sh
  infra/release-publish.sh
  infra/release-sentinel.sh
  infra/restore-drill.sh
  infra/wal-offsite-sync.sh
  infra/web-publish.sh
)
required_runtime_assets=(
  infra/init/realtime.sql
  infra/init/roles.sql
  infra/volumes/api/kong.production.yml
  infra/volumes/api/kong.yml
  infra/volumes/functions/_shared/mime.ts
  infra/volumes/functions/_shared/security.ts
  infra/volumes/functions/billing-delete/index.ts
  infra/volumes/functions/chat-agent-config/index.ts
  infra/volumes/functions/chat-agent/index.ts
  infra/volumes/functions/contact-delete/index.ts
  infra/volumes/functions/deno.jsonc
  infra/volumes/functions/deno.lock
  infra/volumes/functions/deno.typecheck.jsonc
  infra/volumes/functions/vendor.sha256
  infra/volumes/functions/vendor/standardwebhooks.bundle.js
  infra/volumes/functions/vendor/supabase-js.bundle.js
  infra/volumes/functions/gmail-drafts/index.ts
  infra/volumes/functions/gmail-import-confirm/index.ts
  infra/volumes/functions/gmail-import-preview/index.ts
  infra/volumes/functions/gmail-oauth-callback/index.ts
  infra/volumes/functions/gmail-oauth-start/index.ts
  infra/volumes/functions/gmail-sync/index.ts
  infra/volumes/functions/import-leads/index.ts
  infra/volumes/functions/invite-user/index.ts
  infra/volumes/functions/main/edge-runtime.d.ts
  infra/volumes/functions/main/index.ts
  infra/volumes/functions/mcp/index.ts
  infra/volumes/functions/send-auth-email/index.ts
)
for required_path in "${required_runtime[@]}" "${required_runtime_assets[@]}"; do
  grep -Fq "\"${required_path}\"" <<< "${required_block}" \
    || fail "manifest obrigatório omite ${required_path}"
done
while IFS= read -r required_path; do
  grep -Fq "\"${required_path}\"" <<< "${required_block}" \
    || fail "manifest obrigatório omite input de build/runtime ${required_path}"
done < <(
  cd "${ROOT}"
  find .dockerignore \
    services/outreach/Dockerfile \
    services/outreach/package.json \
    services/outreach/package-lock.json \
    services/outreach/tsconfig.json \
    services/outreach/src \
    infra/init infra/volumes/api infra/volumes/functions \
    -type f ! -path '*/node_modules/*' -print | sed 's#^\./##' | sort
)

if command -v sha256sum >/dev/null 2>&1; then
  (cd "${ROOT}/infra/volumes/functions" && sha256sum --check vendor.sha256 >/dev/null) \
    || fail "vendor.sha256 diverge da árvore local"
else
  (cd "${ROOT}/infra/volumes/functions" && shasum -a 256 --check vendor.sha256 >/dev/null) \
    || fail "vendor.sha256 diverge da árvore local"
fi
grep -Fq 'deno check --frozen=true --config=infra/volumes/functions/deno.typecheck.jsonc' \
  "${ROOT}/.github/workflows/ci.yml" \
  || fail "CI não type-checka Edge Functions com lock congelado"
grep -Fq 'DENO_DIR="$runtime_cache" HTTPS_PROXY=http://127.0.0.1:9' \
  "${ROOT}/.github/workflows/ci.yml" \
  || fail "CI não prova os bundles runtime com cache frio e rede bloqueada"
grep -Fq -- '--config=infra/volumes/functions/deno.jsonc' "${ROOT}/.github/workflows/ci.yml" \
  || fail "CI não usa o import map local no smoke runtime"

# Exercise the publisher's real tar validator with git-archive-compatible
# names, including the only permitted leading-dot member. This catches the
# historical mismatch where `.dockerignore` was required but rejected by the
# generic pathname regex.
archive_fixture="${WORK}/archive-fixture"
mkdir -p "${archive_fixture}/supabase/migrations"
while IFS= read -r required_path; do
  mkdir -p "${archive_fixture}/$(dirname "${required_path}")"
  : > "${archive_fixture}/${required_path}"
done < <(sed -n '/^required = {$/,/^}$/s/^    "\([^"]*\)",$/\1/p' "${publisher}")
: > "${archive_fixture}/supabase/migrations/202610010001_fixture.sql"
cp "${ROOT}/infra/volumes/functions/vendor.sha256" \
  "${archive_fixture}/infra/volumes/functions/vendor.sha256"
cp "${ROOT}/infra/volumes/functions/vendor/"*.bundle.js \
  "${archive_fixture}/infra/volumes/functions/vendor/"
archive_bundle="${WORK}/backend-release.tar.gz"
git -C "${archive_fixture}" init -q
git -C "${archive_fixture}" add .dockerignore infra services supabase
git -C "${archive_fixture}" -c user.name=fixture -c user.email=fixture@example.invalid \
  commit -qm fixture
git -C "${archive_fixture}" archive --format=tar HEAD \
  .dockerignore infra services/outreach supabase/migrations \
  | gzip -n > "${archive_bundle}"
validator_program="$(awk '
  index($0, "python3 - \"${archive}\" <<") { capture=1; next }
  capture && $0 == "PY" { exit }
  capture { print }
' "${publisher}")"
[[ -n "${validator_program}" ]] || fail "não foi possível extrair o validador de archive"
python3 - "${archive_bundle}" <<< "${validator_program}" \
  || fail "validador recusou bundle com shape real e .dockerignore"

vendor_tamper="$(awk 'NR == 1 { print $2 }' "${archive_fixture}/infra/volumes/functions/vendor.sha256")"
printf '\n// tampered\n' >> "${archive_fixture}/infra/volumes/functions/${vendor_tamper}"
tampered_vendor_bundle="${WORK}/backend-release-vendor-tampered.tar.gz"
COPYFILE_DISABLE=1 tar -C "${archive_fixture}" -czf "${tampered_vendor_bundle}" \
  .dockerignore infra services supabase
if python3 - "${tampered_vendor_bundle}" <<< "${validator_program}" >/dev/null 2>&1; then
  fail "validador aceitou bundle vendor com checksum divergente"
fi
cp "${ROOT}/infra/volumes/functions/${vendor_tamper}" \
  "${archive_fixture}/infra/volumes/functions/${vendor_tamper}"

mv "${archive_fixture}/infra/release-sentinel.sh" "${archive_fixture}/infra/release-sentinel.saved"
mkdir "${archive_fixture}/infra/release-sentinel.sh"
invalid_archive_bundle="${WORK}/backend-release-directory-substitution.tar.gz"
COPYFILE_DISABLE=1 tar -C "${archive_fixture}" -czf "${invalid_archive_bundle}" \
  .dockerignore infra services supabase
if python3 - "${invalid_archive_bundle}" <<< "${validator_program}" >/dev/null 2>&1; then
  fail "validador aceitou diretório no lugar de ficheiro obrigatório"
fi

echo "OK: gates de shadow, recuperação e rollback OCI validados"
