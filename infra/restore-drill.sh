#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
BACKUP_ROOT="${NIKUFRA_BACKUP_ROOT:-/home/luis/services/nikufra-crm/backups}"
REPORT_DIR="${BACKUP_ROOT}/restore-drills"
POSTGRES_IMAGE="supabase/postgres:15.8.1.085"

classify_outreach_schema() {
  local ledger_present="$1"
  local base_recorded="$2"
  local invariants_recorded="$3"
  local base_all="$4"
  local base_any="$5"
  local invariants_all="$6"
  local invariants_any="$7"
  local flag

  for flag in "$@"; do
    [[ "${flag}" =~ ^[tf]$ ]] || return 2
  done
  [[ "${base_all}" == f || "${base_any}" == t ]] || return 1
  [[ "${invariants_all}" == f || "${invariants_any}" == t ]] || return 1

  # Before the first unified deploy there may be no migration ledger at all,
  # or a ledger containing only historical CRM migrations. Both are coherent
  # only while every Outreach sentinel is absent.
  if [[ "${ledger_present}" == f ]]; then
    if [[ "${base_recorded}" == f && "${invariants_recorded}" == f \
      && "${base_any}" == f && "${invariants_any}" == f ]]; then
      printf '%s\n' absent
      return 0
    fi
    return 1
  fi
  if [[ "${base_recorded}" == f && "${invariants_recorded}" == f ]]; then
    if [[ "${base_any}" == f && "${invariants_any}" == f ]]; then
      printf '%s\n' absent
      return 0
    fi
    return 1
  fi

  # 202609300001 and its ledger row commit atomically. A partial rollout is
  # therefore valid only when all base objects exist and no 300002 sentinel or
  # ledger row exists yet.
  if [[ "${base_recorded}" == t && "${invariants_recorded}" == f \
    && "${base_all}" == t && "${invariants_any}" == f ]]; then
    printf '%s\n' partial
    return 0
  fi

  # Likewise, a completed rollout requires both atomic ledger rows and every
  # selected sentinel from both migrations. Anything else is schema drift or
  # an incomplete restore and must not produce a successful recovery report.
  if [[ "${base_recorded}" == t && "${invariants_recorded}" == t \
    && "${base_all}" == t && "${invariants_all}" == t ]]; then
    printf '%s\n' complete
    return 0
  fi

  return 1
}

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

remote_name="$("${RCLONE_BIN}" lsf "${RCLONE_REMOTE}/daily/" --files-only --include '*.dump.gpg' | sort | tail -1)"
[[ -n "${remote_name}" && "${remote_name}" =~ ^nikufra-[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{6}Z)?\.dump\.gpg$ ]] || {
  echo "Não existe um backup offsite reconhecido para testar." >&2
  exit 1
}
globals_name="${remote_name%.dump.gpg}.globals.sql.gpg"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/nikufra-restore.XXXXXX")"
container_name="nikufra-logical-drill-$(date -u +%Y%m%d%H%M%S)-$$"
volume_name="nikufra_logical_drill_$(date -u +%Y%m%d%H%M%S)_$$"
test_db="qa_restore"
container_started=false
volume_created=false
started_at="$(date +%s)"
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "${container_started}" == true && "${container_name}" =~ ^nikufra-logical-drill-[0-9]+-[0-9]+$ ]]; then
    docker rm -f "${container_name}" >/dev/null 2>&1 || status=1
  fi
  if [[ "${volume_created}" == true && "${volume_name}" =~ ^nikufra_logical_drill_[0-9]+_[0-9]+$ ]]; then
    docker volume rm "${volume_name}" >/dev/null 2>&1 || status=1
  fi
  rm -rf -- "${work_dir}"
  exit "${status}"
}
trap cleanup EXIT

archive="${work_dir}/${remote_name}"
archive_plain="${work_dir}/${remote_name%.gpg}"
globals_archive="${work_dir}/${globals_name}"
globals_plain="${work_dir}/${globals_name%.gpg}"
"${RCLONE_BIN}" copyto "${RCLONE_REMOTE}/daily/${remote_name}" "${archive}"
"${RCLONE_BIN}" copyto "${RCLONE_REMOTE}/daily/${remote_name}.sha256" "${archive}.sha256"
"${RCLONE_BIN}" copyto "${RCLONE_REMOTE}/daily/${globals_name}" "${globals_archive}"
"${RCLONE_BIN}" copyto "${RCLONE_REMOTE}/daily/${globals_name}.sha256" "${globals_archive}.sha256"
(cd "${work_dir}" && sha256sum --check "${remote_name}.sha256")
(cd "${work_dir}" && sha256sum --check "${globals_name}.sha256")
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "${BACKUP_ENCRYPTION_KEY_FILE}" \
  --output "${globals_plain}" --decrypt "${globals_archive}"
chmod 600 "${globals_plain}"
grep -q '^CREATE ROLE authenticated;' "${globals_plain}"
grep -q '^CREATE ROLE service_role;' "${globals_plain}"

# ACL entries must be present in the logical archive; otherwise a successful
# data restore would silently lose the authorization model.
# Decipher to the private, automatically cleaned work directory first. Listing
# a custom archive directly from a pipe lets pg_restore close stdin after the
# TOC and makes gpg fail with SIGPIPE even when the archive is valid.
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "${BACKUP_ENCRYPTION_KEY_FILE}" \
  --output "${archive_plain}" --decrypt "${archive}"
chmod 600 "${archive_plain}"
archive_list="${work_dir}/archive.list"
docker run --rm -i --network none --read-only \
    --cap-drop ALL --security-opt no-new-privileges:true --entrypoint pg_restore \
    "${POSTGRES_IMAGE}" --list < "${archive_plain}" > "${archive_list}"
grep -Eq ' (ACL|DEFAULT ACL) ' "${archive_list}" || {
  echo "O dump offsite não contém ACLs/default ACLs." >&2
  exit 1
}

# Use the Supabase PostgreSQL binaries/extensions but initialize a clean,
# disposable cluster. Replaying globals here proves role recovery rather than
# accidentally borrowing roles from the live production cluster.
docker volume create "${volume_name}" >/dev/null
volume_created=true
docker run --rm --network none -v "${volume_name}:/data" --entrypoint chown \
  "${POSTGRES_IMAGE}" 105:106 /data
docker run -d --name "${container_name}" --network none --user 105:106 \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:size=64m,noexec,nosuid,nodev \
  --tmpfs /run/pgsodium:rw,exec,size=64k,mode=0700,uid=105,gid=106,nosuid,nodev \
  --tmpfs /var/run/postgresql:size=8m,noexec,nosuid,nodev \
  -v "${volume_name}:/var/lib/postgresql/data" --entrypoint bash \
  "${POSTGRES_IMAGE}" -ceu \
  "umask 077; head -c 32 /dev/urandom | od -A n -t x1 | tr -d ' \\n' > /run/pgsodium/root.key; printf '%s\\n' '#!/bin/sh' 'exec cat /run/pgsodium/root.key' > /run/pgsodium/getkey.sh; chmod 0400 /run/pgsodium/root.key; chmod 0500 /run/pgsodium/getkey.sh /run/pgsodium; initdb -D /var/lib/postgresql/data --auth-local=trust --auth-host=reject >/tmp/initdb.log && exec postgres -D /var/lib/postgresql/data -c config_file=/etc/postgresql/postgresql.conf -c hba_file=/var/lib/postgresql/data/pg_hba.conf -c ident_file=/var/lib/postgresql/data/pg_ident.conf -c listen_addresses='' -c unix_socket_directories=/tmp -c cron.database_name=${test_db} -c pgsodium.getkey_script=/run/pgsodium/getkey.sh -c vault.getkey_script=/run/pgsodium/getkey.sh" >/dev/null
container_started=true

ready=false
for _ in $(seq 1 120); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "${container_name}" 2>/dev/null || true)" != true ]]; then
    docker logs "${container_name}" >&2 || true
    echo "O PostgreSQL isolado terminou antes de ficar pronto." >&2
    exit 1
  fi
  if docker exec "${container_name}" pg_isready -h /tmp -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "${ready}" == true ]] || { docker logs "${container_name}" >&2 || true; echo "Timeout a iniciar o PostgreSQL isolado." >&2; exit 1; }

# initdb necessarily creates postgres; pg_dumpall emits CREATE ROLE postgres as
# well. Drop only that one duplicate statement, then replay every other role,
# attribute, setting and membership from the encrypted globals artifact.
sed -e '/^CREATE ROLE postgres;$/d' -e '/^ALTER ROLE postgres WITH /d' "${globals_plain}" \
  | docker exec -i "${container_name}" psql -v ON_ERROR_STOP=1 -h /tmp -U postgres -d postgres >/dev/null
docker exec "${container_name}" createdb -h /tmp -U postgres "${test_db}"
docker exec -i "${container_name}" pg_restore -h /tmp -U postgres --exit-on-error --no-owner -d "${test_db}" \
  < "${archive_plain}"

psql_test() {
  docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -h /tmp -U postgres -d "${test_db}" "$@"
}

# Core CRM proof always runs, including service role and a negative RLS/ACL
# assertion. This also makes a pre-migration backup drill valid on the first
# Outreach deployment.
psql_test -Atc "set role service_role; select count(*) >= 0 from public.profiles" | grep -qx t
if psql_test -c "set role authenticated; select 1 from auth.users limit 1" >/dev/null 2>&1; then
  echo "Falha no drill: authenticated acede diretamente a auth.users." >&2
  exit 1
fi

# Migration 202609300001 creates the normalized base and 202609300002 installs
# the operational invariants. The ledger is the authority for which atomic
# phase committed; multiple independent objects prove that the corresponding
# phase was restored in full. Probe ledger existence separately because SQL
# resolves a missing relation even from an unselected CASE branch.
migration_ledger_present="$(psql_test -Atc \
  "select to_regclass('nikufra_meta.schema_migrations') is not null")"
outreach_base_recorded=f
outreach_invariants_recorded=f
if [[ "${migration_ledger_present}" == t ]]; then
  outreach_ledger_flags="$(psql_test -Atc "select
    count(*) filter (where name='202609300001_outreach_normalized_schema.sql') = 1,
    count(*) filter (where name='202609300002_outreach_invariants_and_migration.sql') = 1
    from nikufra_meta.schema_migrations")"
  IFS='|' read -r outreach_base_recorded outreach_invariants_recorded <<<"${outreach_ledger_flags}"
fi

outreach_object_flags="$(psql_test -Atc "select
  (
    to_regtype('public.outreach_system_mode') is not null
    and to_regclass('public.outreach_system_state') is not null
    and to_regclass('public.outreach_campaigns') is not null
    and to_regclass('public.communication_suppressions') is not null
    and to_regclass('private.outreach_credentials') is not null
    and exists (
      select 1 from pg_attribute
      where attrelid=to_regclass('public.profiles')
        and attname='outreach_role' and not attisdropped
    )
  ),
  (
    to_regtype('public.outreach_system_mode') is not null
    or to_regclass('public.outreach_system_state') is not null
    or to_regclass('public.outreach_campaigns') is not null
    or to_regclass('public.communication_suppressions') is not null
    or to_regclass('private.outreach_credentials') is not null
    or exists (
      select 1 from pg_attribute
      where attrelid=to_regclass('public.profiles')
        and attname='outreach_role' and not attisdropped
    )
  ),
  (
    to_regprocedure('public.claim_google_provider_message(text,text)') is not null
    and to_regprocedure('private.import_outreach_legacy_snapshot(jsonb,boolean)') is not null
    and to_regprocedure('private.outreach_assert_provider_permit(uuid,text)') is not null
  ),
  (
    to_regprocedure('public.claim_google_provider_message(text,text)') is not null
    or to_regprocedure('private.import_outreach_legacy_snapshot(jsonb,boolean)') is not null
    or to_regprocedure('private.outreach_assert_provider_permit(uuid,text)') is not null
  )")"
IFS='|' read -r outreach_base_all outreach_base_any \
  outreach_invariants_all outreach_invariants_any <<<"${outreach_object_flags}"

if ! outreach_schema="$(classify_outreach_schema \
  "${migration_ledger_present}" \
  "${outreach_base_recorded}" \
  "${outreach_invariants_recorded}" \
  "${outreach_base_all}" \
  "${outreach_base_any}" \
  "${outreach_invariants_all}" \
  "${outreach_invariants_any}")"; then
  echo "Falha no drill: ledger e objetos Outreach estão incoerentes (ledger=${migration_ledger_present}, base_row=${outreach_base_recorded}, invariants_row=${outreach_invariants_recorded}, base_all=${outreach_base_all}, base_any=${outreach_base_any}, invariants_all=${outreach_invariants_all}, invariants_any=${outreach_invariants_any})." >&2
  exit 1
fi
acl_smoke="service_role,authenticated-auth-negative"
if [[ "${outreach_schema}" == complete ]]; then
  grep -q '^CREATE ROLE outreach_service;' "${globals_plain}"
  grep -q '^CREATE ROLE nikufra_wal;' "${globals_plain}"
  psql_test -Atc "select exists (select 1 from pg_roles role where role.rolname='outreach_service' and role.rolcanlogin and not role.rolsuper and not role.rolinherit and not role.rolbypassrls and not role.rolcreatedb and not role.rolcreaterole and not role.rolreplication and not exists (select 1 from pg_auth_members membership where membership.member=role.oid)) and exists (select 1 from pg_roles role where role.rolname='nikufra_wal' and role.rolcanlogin and role.rolreplication and not role.rolsuper and not role.rolinherit and not role.rolbypassrls and not role.rolcreatedb and not role.rolcreaterole and not exists (select 1 from pg_auth_members membership where membership.member=role.oid))" | grep -qx t
  psql_test -Atc "set role service_role; select count(*) >= 0 from private.outreach_credentials" | grep -qx t
  psql_test -Atc "set role outreach_service; select count(*) >= 0 from public.outreach_campaigns" | grep -qx t
  psql_test -Atc "select to_regprocedure('public.has_outreach_capability(text)') is not null and to_regprocedure('public.claim_google_provider_message(text,text)') is not null" | grep -qx t

  # Browser roles stay behind the HTTP API and never reach Outreach/private
  # storage directly after restore.
  if psql_test -c "set role authenticated; select 1 from private.outreach_credentials limit 1" >/dev/null 2>&1; then
    echo "Falha no drill: authenticated acede ao schema private." >&2
    exit 1
  fi
  if psql_test -c "set role authenticated; select 1 from public.outreach_recipients limit 1" >/dev/null 2>&1; then
    echo "Falha no drill: authenticated acede diretamente aos destinatários Outreach." >&2
    exit 1
  fi
  if psql_test -c "set role outreach_service; update public.contactos set nome=nome where false" >/dev/null 2>&1; then
    echo "Falha no drill: outreach_service pode alterar contactos CRM diretamente." >&2
    exit 1
  fi
  acl_smoke="${acl_smoke},outreach_service,role-hardening,authenticated-outreach-negative,private-negative"
  counts="$(psql_test -Atc \
    "select json_build_object('profiles',(select count(*) from public.profiles),'empresas',(select count(*) from public.empresas),'contactos',(select count(*) from public.contactos),'oportunidades',(select count(*) from public.oportunidades),'outreach_campaigns',(select count(*) from public.outreach_campaigns),'outreach_mailboxes',(select count(*) from public.outreach_mailboxes),'suppressions',(select count(*) from public.communication_suppressions),'private_ledger',(select count(*) from private.outreach_delivery_ledger))")"
else
  counts="$(psql_test -Atc \
    "select json_build_object('profiles',(select count(*) from public.profiles),'empresas',(select count(*) from public.empresas),'contactos',(select count(*) from public.contactos),'oportunidades',(select count(*) from public.oportunidades))")"
fi
elapsed="$(( $(date +%s) - started_at ))"
mkdir -p "${REPORT_DIR}"
chmod 700 "${REPORT_DIR}"
report="${REPORT_DIR}/$(date -u +%Y-%m-%dT%H%M%SZ).txt"
printf 'backup=%s\nglobals=%s\nrestored_at=%s\nelapsed_seconds=%s\ncluster=isolated\nglobals_replayed=true\noutreach_schema=%s\nacl_smoke=%s\ncounts=%s\nresult=ok\n' \
  "${remote_name}" "${globals_name}" "$(date -u +%FT%TZ)" "${elapsed}" "${outreach_schema}" "${acl_smoke}" "${counts}" > "${report}"
chmod 600 "${report}"
echo "Restauro integral comprovado em ${elapsed}s: ${counts}. Relatório: ${report}"
