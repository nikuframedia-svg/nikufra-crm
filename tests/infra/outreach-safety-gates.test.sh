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
  'pgsodium_key=base-2026-10-01T115900Z.pgsodium-root.key.gpg' \
  'vault_smoke=true' \
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

# PostgreSQL resolves every relation in a CASE expression before evaluating
# the chosen branch. The first production deploy must therefore prove table
# existence in a separate statement before it can query the Outreach row.
predeploy="${ROOT}/infra/predeploy-safety.sh"
state_probe_line="$(grep -Fn "select to_regclass('public.outreach_system_state') is not null" "${predeploy}" | cut -d: -f1)"
state_query_line="$(grep -Fn "select mode::text || ':' || send_enabled::text from public.outreach_system_state" "${predeploy}" | cut -d: -f1)"
[[ -n "${state_probe_line}" && -n "${state_query_line}" && "${state_probe_line}" -lt "${state_query_line}" ]] \
  || fail "preflight não separa a descoberta da tabela da consulta ao estado Outreach"
if grep -Eq "case when to_regclass\('public\.outreach_system_state'\).*from public\.outreach_system_state" "${predeploy}"; then
  fail "preflight volta a referenciar a tabela inexistente dentro de CASE"
fi

# A failed first rollout may have committed the normalized schema migration but
# not the following invariants/functions migration. The deploy gate must handle
# that partial state without statically resolving an absent function.
deploy="${ROOT}/infra/deploy-production.sh"
configure_pgsodium_line="$(grep -Fn '"${SCRIPT_DIR}/configure-pgsodium.sh"' "${deploy}" | head -1 | cut -d: -f1)"
first_compose_up_line="$(grep -Fn '"${COMPOSE[@]}" up -d --wait "${SERVICES[@]}"' "${deploy}" | head -1 | cut -d: -f1)"
[[ -n "${configure_pgsodium_line}" && -n "${first_compose_up_line}" \
  && "${configure_pgsodium_line}" -lt "${first_compose_up_line}" ]] \
  || fail "deploy não persiste a chave pgsodium antes de poder recriar o DB"
grep -Fq '${PGSODIUM_ROOT_KEY_FILE}:/etc/postgresql-custom/pgsodium_root.key:ro' \
  "${ROOT}/infra/docker-compose.yml" \
  || fail "Compose não monta apenas a root key pgsodium em read-only"
grep -Fq '/data/PG_VERSION' "${ROOT}/infra/configure-pgsodium.sh" \
  || fail "configuração pgsodium não recusa gerar nova key sobre PGDATA existente"
grep -Fq 'Recusado gerar uma chave nova.' "${ROOT}/infra/configure-pgsodium.sh" \
  || fail "configuração pgsodium não falha fechada sem key recuperável"
[[ "$(grep -c -- '--cap-add DAC_READ_SEARCH' "${ROOT}/infra/configure-pgsodium.sh")" -ge 2 ]] \
  || fail "validadores pgsodium não leem a chave host restrita com a capability mínima"
if grep -Fq -- ':/etc/postgresql-custom:ro' "${ROOT}/infra/docker-compose.yml"; then
  fail "Compose sobrepõe todo o diretório postgresql-custom"
fi

# `host all all` does not authorize a physical replication connection. Keep
# the receiver's HBA access limited to its dedicated role, SCRAM and a network
# directly attached to PostgreSQL; the startup patch must also be idempotent
# and preserve the pinned image's entrypoint initialization.
production_compose="${ROOT}/infra/docker-compose.production.yml"
base_compose="${ROOT}/infra/docker-compose.yml"
configure_wal="${ROOT}/infra/configure-wal-archive.sh"
wal_sync="${ROOT}/infra/wal-offsite-sync.sh"
basebackup_production="${ROOT}/infra/basebackup-production.sh"
pitr_drill="${ROOT}/infra/pitr-restore-drill.sh"
hba_rule='host replication nikufra_wal samenet scram-sha-256'
[[ "$(grep -Fxc "        hba_rule='${hba_rule}'" "${production_compose}")" == 1 ]] \
  || fail "Compose não instala exatamente uma regra HBA restrita para o receiver WAL"
grep -Fq 'grep -Fqx -- "$${hba_rule}" "$${hba_file}"' "${production_compose}" \
  || fail "regra HBA do receiver WAL não é instalada de forma idempotente"
grep -Fq 'exec docker-entrypoint.sh "$$@"' "${production_compose}" \
  || fail "wrapper HBA não devolve controlo ao entrypoint PostgreSQL"
if grep -Eq "hba_rule='host[[:space:]]+replication[[:space:]]+(all|nikufra_wal)[[:space:]]+(all|0\\.0\\.0\\.0/0|::0/0)[[:space:]]+(trust|md5|scram-sha-256)'" "${production_compose}"; then
  fail "regra HBA do receiver WAL permite origem ou role demasiado ampla"
fi
db_compose_block="$(sed -n '/^  db:$/,/^  auth:$/p' "${base_compose}")"
production_db_compose_block="$(sed -n '/^  db:$/,/^  kong:$/p' "${production_compose}")"
grep -Fxq '    networks: [backend]' <<< "${db_compose_block}" \
  || fail "DB não está limitado à rede backend assumida pela regra HBA samenet"
if grep -Eq '^[[:space:]]+(ports|network_mode):' <<< "${db_compose_block}"; then
  fail "DB expõe rede fora do backend assumido pela regra HBA samenet"
fi
if grep -Eq '^[[:space:]]+(ports|network_mode|networks):' <<< "${production_db_compose_block}"; then
  fail "override de produção alarga a rede backend assumida pela regra HBA samenet"
fi
grep -Fq 'from pg_hba_file_rules' "${configure_wal}" \
  || fail "configuração WAL não valida a regra através do parser PostgreSQL"
grep -Fq 'if exists (select 1 from pg_hba_file_rules where error is not null)' "${configure_wal}" \
  || fail "configuração WAL não falha perante erros globais de parsing HBA"
grep -Fq "database = array['replication']::text[]" "${configure_wal}" \
  || fail "validação HBA não compara exatamente o array database"
grep -Fq "user_name = array['nikufra_wal']::text[]" "${configure_wal}" \
  || fail "validação HBA não compara exatamente o array user_name"
for hba_predicate in \
  "type = 'host'" \
  "address = 'samenet'" \
  'netmask is null' \
  "auth_method = 'scram-sha-256'" \
  'coalesce(cardinality(options), 0) = 0' \
  'error is null' \
  'matching_hba_rules <> 1'; do
  grep -Fq "${hba_predicate}" "${configure_wal}" \
    || fail "validação HBA omite predicado: ${hba_predicate}"
done
role_hardening_line="$(grep -Fn 'role hardening verification failed' "${configure_wal}" | cut -d: -f1)"
hba_verification_line="$(grep -Fn 'nikufra_wal HBA verification failed' "${configure_wal}" | cut -d: -f1)"
[[ -n "${role_hardening_line}" && -n "${hba_verification_line}" \
  && "${role_hardening_line}" -lt "${hba_verification_line}" ]] \
  || fail "validação HBA não ocorre depois do hardening da role WAL"

# Supabase revokes pg_switch_wal() from the non-superuser `postgres` role.
# Use the existing administrative credential only for the WAL operations; the
# network-facing replication role must not gain a GRANT or pg_checkpoint.
if grep -Eiq 'grant[[:space:]].*[[:space:]]to[[:space:]]+nikufra_wal|pg_checkpoint' "${configure_wal}"; then
  fail "correção do switch WAL alarga persistentemente a role nikufra_wal"
fi
if grep -ERiq --include='*.sh' \
  'grant[[:space:]].*(pg_switch_wal|pg_checkpoint)' "${ROOT}/infra"; then
  fail "infraestrutura concede persistentemente pg_switch_wal ou pg_checkpoint"
fi
wal_switch_block="$(sed -n '/# Fecha um segmento/,/^archived=false$/p' "${wal_sync}")"
grep -Fq 'WAL_ADMIN_PSQL=(' <<< "${wal_switch_block}" \
  || fail "sincronização WAL não isola a ligação administrativa"
grep -Fq 'exec -T db sh -ceu' <<< "${wal_switch_block}" \
  || fail "sincronização WAL não resolve a credencial dentro do contentor"
grep -Fq 'export PGPASSWORD="${POSTGRES_PASSWORD:?}"' <<< "${wal_switch_block}" \
  || fail "sincronização WAL não autentica o administrador pela env do contentor"
if grep -Fq -- '-e PGPASSWORD=' <<< "${wal_switch_block}"; then
  fail "sincronização WAL expõe a password expandida nos argumentos Docker do host"
fi
grep -Fq 'exec psql -X -w -v ON_ERROR_STOP=1 -h /var/run/postgresql' <<< "${wal_switch_block}" \
  || fail "ligação WAL não fixa socket, psqlrc, non-interactive e fail-fast"
grep -Fq -- '-U supabase_admin' <<< "${wal_switch_block}" \
  || fail "sincronização WAL não usa a role autorizada pela imagem Supabase"
if grep -Eq -- '-U (postgres|nikufra_wal)' <<< "${wal_switch_block}"; then
  fail "sincronização WAL executa o switch com uma role sem permissão mínima"
fi
grep -Fq "show wal_level" <<< "${wal_switch_block}" \
  || fail "sincronização WAL não valida wal_level antes do marcador lógico"
grep -Fq '[[ "${wal_level}" == logical ]]' <<< "${wal_switch_block}" \
  || fail "sincronização WAL aceita wal_level incompatível com o marcador"
wal_marker_line="$(grep -Fn "pg_logical_emit_message(false,'nikufra_wal_sync_v1','')" "${wal_sync}" | cut -d: -f1)"
wal_capture_line="$(grep -n '^switched_segment=' "${wal_sync}" | cut -d: -f1)"
wal_switch_line="$(grep -Fn 'select pg_switch_wal()' "${wal_sync}" | cut -d: -f1)"
[[ -n "${wal_marker_line}" && -n "${wal_capture_line}" && -n "${wal_switch_line}" \
  && "${wal_marker_line}" -lt "${wal_capture_line}" && "${wal_capture_line}" -lt "${wal_switch_line}" ]] \
  || fail "sincronização WAL não garante a ordem marcador não transacional, captura e switch"
grep -Fq 'pg_basebackup -h db -U nikufra_wal' "${basebackup_production}" \
  || fail "base backup deixou de usar a role de replicação dedicada"
pitr_target_line="$(grep -Fn 'target_lsn=' "${pitr_drill}" | head -1 | cut -d: -f1)"
pitr_sync_line="$(grep -Fn '"${SCRIPT_DIR}/wal-offsite-sync.sh"' "${pitr_drill}" | cut -d: -f1)"
[[ -n "${pitr_target_line}" && -n "${pitr_sync_line}" && "${pitr_target_line}" -lt "${pitr_sync_line}" ]] \
  || fail "drill PITR não fecha e envia WAL depois de capturar o LSN alvo"
vault_rebuild_line="$(grep -Fn "delete from vault.secrets" "${deploy}" | head -1 | cut -d: -f1)"
preflight_line="$(grep -Fn '"${SCRIPT_DIR}/predeploy-safety.sh"' "${deploy}" | head -1 | cut -d: -f1)"
[[ -n "${vault_rebuild_line}" && -n "${preflight_line}" \
  && "${vault_rebuild_line}" -lt "${preflight_line}" ]] \
  || fail "Vault não é reparado transacionalmente antes do primeiro backup"
grep -Fq "begin;" "${deploy}" || fail "rebuild Vault não abre transação"
grep -Fq "commit;" "${deploy}" || fail "rebuild Vault não fecha transação"
resume_gate="$(sed -n '/# Force the persisted switch/,/^[[:space:]]*SQL$/p' "${deploy}")"
grep -Fq "to_regprocedure(" <<< "${resume_gate}" \
  || fail "deploy não testa a existência da função de transição"
grep -Fq 'execute $transition$' <<< "${resume_gate}" \
  || fail "deploy resolve estaticamente uma função ausente no estado parcial"
grep -Fq 'update public.outreach_system_state' <<< "${resume_gate}" \
  || fail "deploy não tem fallback para a migration base já aplicada"
grep -Fq "mode = 'disabled'" <<< "${resume_gate}" \
  || fail "fallback parcial não força mode=disabled"
grep -Fq 'send_enabled = false' <<< "${resume_gate}" \
  || fail "fallback parcial não força send_enabled=false"
transition_probe_line="$(grep -Fn 'to_regprocedure(' <<< "${resume_gate}" | head -1 | cut -d: -f1)"
dynamic_transition_line="$(grep -Fn 'execute $transition$' <<< "${resume_gate}" | cut -d: -f1)"
fallback_disable_line="$(grep -Fn 'update public.outreach_system_state' <<< "${resume_gate}" | cut -d: -f1)"
[[ -n "${transition_probe_line}" && -n "${dynamic_transition_line}" && -n "${fallback_disable_line}" \
  && "${transition_probe_line}" -lt "${dynamic_transition_line}" \
  && "${dynamic_transition_line}" -lt "${fallback_disable_line}" ]] \
  || fail "ordem do gate de retoma first-deploy não é fail-closed"

# A logical backup may legitimately capture the database after migration
# 202609300001 committed and before 202609300002 did. The restore drill must
# cross-check the atomic migration ledger with independent object sentinels:
# coherent absent/partial/complete phases pass, while every drift combination
# fails instead of being downgraded to a successful core-only restore.
restore_drill="${ROOT}/infra/restore-drill.sh"
ledger_probe_line="$(grep -Fn "select to_regclass('nikufra_meta.schema_migrations') is not null" "${restore_drill}" | cut -d: -f1)"
ledger_query_line="$(grep -Fn "name='202609300001_outreach_normalized_schema.sql'" "${restore_drill}" | cut -d: -f1)"
base_probe_line="$(grep -Fn "to_regclass('public.outreach_campaigns') is not null" "${restore_drill}" | head -1 | cut -d: -f1)"
provider_sentinel_line="$(grep -Fn "to_regprocedure('public.claim_google_provider_message(text,text)') is not null" "${restore_drill}" | head -1 | cut -d: -f1)"
import_sentinel_line="$(grep -Fn "to_regprocedure('private.import_outreach_legacy_snapshot(jsonb,boolean)') is not null" "${restore_drill}" | head -1 | cut -d: -f1)"
complete_gate_line="$(grep -Fn 'if [[ "${outreach_schema}" == complete ]]; then' "${restore_drill}" | cut -d: -f1)"
[[ -n "${ledger_probe_line}" && -n "${ledger_query_line}" \
  && "${ledger_probe_line}" -lt "${ledger_query_line}" \
  && -n "${base_probe_line}" && -n "${provider_sentinel_line}" \
  && -n "${import_sentinel_line}" && -n "${complete_gate_line}" \
  && "${ledger_query_line}" -lt "${base_probe_line}" \
  && "${base_probe_line}" -lt "${provider_sentinel_line}" \
  && "${provider_sentinel_line}" -lt "${complete_gate_line}" \
  && "${import_sentinel_line}" -lt "${complete_gate_line}" ]] \
  || fail "restore drill não distingue o schema base 300001 do schema completo 300002"
if grep -Eq "case when to_regclass\('nikufra_meta\.schema_migrations'\).*from nikufra_meta\.schema_migrations" "${restore_drill}"; then
  fail "restore drill referencia o ledger inexistente dentro de CASE"
fi
grep -Fq "name='202609300002_outreach_invariants_and_migration.sql'" "${restore_drill}" \
  || fail "restore drill não cruza a segunda migration com os sentinels operacionais"
grep -Fq "to_regprocedure('private.outreach_assert_provider_permit(uuid,text)') is not null" "${restore_drill}" \
  || fail "restore drill não usa sentinels independentes suficientes para 300002"

# Listing a custom pg_dump archive is allowed to stop after its TOC. Piping
# gpg directly into that command turns the expected early close into SIGPIPE
# under pipefail, so backup verification must consume the complete plaintext
# and the restore drill must list a private temporary file.
backup_production="${ROOT}/infra/backup-production.sh"
if grep -Eq -- '--decrypt .*\| .*pg_restore --list' "${backup_production}" "${restore_drill}"; then
  fail "validação de backup ainda pode gerar falso SIGPIPE do gpg"
fi
grep -Fq 'daily_plain_hash="$(' "${backup_production}" \
  || fail "backup não valida integralmente o plaintext cifrado"
grep -Fq 'archive_plain="${work_dir}/${remote_name%.gpg}"' "${restore_drill}" \
  || fail "restore drill não materializa o dump decifrado no workdir privado"
grep -Fq '< "${archive_plain}" > "${archive_list}"' "${restore_drill}" \
  || fail "restore drill não lista o ficheiro decifrado sem pipeline prematuro"
if grep -Fq -- '--tmpfs /etc/postgresql-custom:' "${restore_drill}"; then
  fail "restore drill esconde os includes Supabase ao sobrepor /etc/postgresql-custom"
fi
grep -Fq -- '-v "${pgsodium_plain}:/etc/postgresql-custom/pgsodium_root.key:ro"' "${restore_drill}" \
  || fail "restore drill não monta o companion pgsodium exato em read-only"
grep -Fq 'vault.decrypted_secrets' "${restore_drill}" \
  || fail "restore drill não força um smoke real de desencriptação Vault"
grep -Fq 'vault_smoke=true' "${restore_drill}" \
  || fail "relatório lógico não regista o smoke Vault"
grep -Fq 'pgsodium-root.key.gpg' "${backup_production}" \
  || fail "backup lógico não cria companion pgsodium cifrado"
grep -Fq 'exec -T -u 105:106 db cat /etc/postgresql-custom/pgsodium_root.key' "${backup_production}" \
  || fail "backup lógico não lê a key 0400 como o utilizador PostgreSQL"
grep -Fq 'pgsodium-root.key.gpg' "${ROOT}/infra/basebackup-production.sh" \
  || fail "base backup não cria companion pgsodium cifrado"
grep -Fq 'exec -T -u 105:106 db cat /etc/postgresql-custom/pgsodium_root.key' "${ROOT}/infra/basebackup-production.sh" \
  || fail "base backup não lê a key 0400 como o utilizador PostgreSQL"
grep -Fq 'pgsodium-root.key.gpg' "${ROOT}/infra/pitr-restore-drill.sh" \
  || fail "drill PITR não exige o companion pgsodium"
grep -Fq -- '-c archive_mode=off -c shared_preload_libraries=pgsodium' "${ROOT}/infra/pitr-restore-drill.sh" \
  || fail "drill PITR não carrega pgsodium com a key restaurada"
grep -Fq 'vault_smoke=true' "${ROOT}/infra/pitr-restore-drill.sh" \
  || fail "relatório PITR não regista o smoke Vault"

# Supabase's pg_graphql wrapper is generated by an event trigger and its body
# is absent from pg_dump even though its ACL is retained. The drill must repair
# only that exact, evidenced archive inconsistency between pre/post-data; all
# archive sections and ACLs must still fail closed under pg_restore.
predata_restore_line="$(grep -Fn -- '--section=pre-data' "${restore_drill}" | head -1 | cut -d: -f1)"
graphql_acl_line="$(grep -Fn "graphql_acl_expected=false" "${restore_drill}" | cut -d: -f1)"
graphql_repair_line="$(grep -Fn 'CREATE FUNCTION graphql_public.graphql(' "${restore_drill}" | cut -d: -f1)"
data_restore_line="$(grep -Fn -- '--section=data' "${restore_drill}" | cut -d: -f1)"
postdata_restore_line="$(grep -Fn -- '--section=post-data' "${restore_drill}" | cut -d: -f1)"
graphql_acl_smoke_line="$(grep -Fn "has_function_privilege('anon', 'graphql_public.graphql(text,text,jsonb,jsonb)', 'EXECUTE')" "${restore_drill}" | cut -d: -f1)"
[[ -n "${graphql_acl_line}" && -n "${predata_restore_line}" && -n "${graphql_repair_line}" \
  && -n "${data_restore_line}" && -n "${postdata_restore_line}" && -n "${graphql_acl_smoke_line}" \
  && "${graphql_acl_line}" -lt "${predata_restore_line}" \
  && "${predata_restore_line}" -lt "${graphql_repair_line}" \
  && "${graphql_repair_line}" -lt "${data_restore_line}" \
  && "${data_restore_line}" -lt "${postdata_restore_line}" \
  && "${postdata_restore_line}" -lt "${graphql_acl_smoke_line}" ]] \
  || fail "restore drill não repara o wrapper pg_graphql entre pre/post-data mantendo a validação integral"
grep -Fq "to_regprocedure('graphql.resolve(text,jsonb,text,jsonb)') is not null" "${restore_drill}" \
  || fail "reparação pg_graphql não valida a função base da extensão"
grep -Fq "ALTER FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) OWNER TO supabase_admin" "${restore_drill}" \
  || fail "reparação pg_graphql não preserva o owner original"
grep -Fq '[[ "${graphql_acl_count}" =~ ^[0-9]+$ && "${graphql_acl_count}" -le 1 ]]' "${restore_drill}" \
  || fail "reparação pg_graphql não exige um único ACL inequívoco"
grep -Fq -- '--section=pre-data --use-list=/tmp/predata.list' "${restore_drill}" \
  || fail "restore pre-data não adia apenas o ACL pg_graphql gerado"
grep -Fq -- '--use-list=/tmp/graphql-acl.list' "${restore_drill}" \
  || fail "ACL pg_graphql original não é reaplicado por pg_restore"
grep -Fq 'ALTER EXTENSION pg_graphql ADD FUNCTION graphql_public.graphql(text, text, jsonb, jsonb)' "${restore_drill}" \
  || fail "wrapper reconstruído não regressa à membership da extensão pg_graphql"
if grep -Eq 'pg_restore .*graphql|pg_restore.*\|\| true|GRANT .*\|\| true' "${restore_drill}"; then
  fail "reparação pg_graphql relaxa falhas globais do restore/ACL"
fi
grep -Fq 'pg_graphql_wrapper_repaired=%s' "${restore_drill}" \
  || fail "relatório de restauro não regista a reparação pg_graphql"

classifier_definition="$(awk '/^classify_outreach_schema\(\) \{/{copy=1} copy{print} copy && /^}/{exit}' "${restore_drill}")"
[[ -n "${classifier_definition}" ]] || fail "classificador de fase Outreach ausente"
eval "${classifier_definition}"
[[ "$(classify_outreach_schema f f f f f f f)" == absent ]] \
  || fail "classificador rejeita first-deploy sem ledger"
[[ "$(classify_outreach_schema t f f f f f f)" == absent ]] \
  || fail "classificador rejeita ledger apenas com migrations CRM"
[[ "$(classify_outreach_schema t t f t t f f)" == partial ]] \
  || fail "classificador rejeita a janela atómica 300001→300002"
[[ "$(classify_outreach_schema t t t t t t t)" == complete ]] \
  || fail "classificador rejeita o schema Outreach completo"

drift_cases=(
  'f f f t t f f'
  'f t f f f f f'
  't f f t t f f'
  't f f t f f f'
  't t f f t f f'
  't t f t t f t'
  't t f t t t t'
  't f t t t t t'
  't t t t t f t'
  't t t t t f f'
  't t t t t t f'
)
for drift_case in "${drift_cases[@]}"; do
  # shellcheck disable=SC2086
  if classify_outreach_schema ${drift_case} >/dev/null; then
    fail "classificador aceitou drift ledger↔objetos: ${drift_case}"
  fi
done
if classify_outreach_schema x f f f f f f >/dev/null; then
  fail "classificador aceitou uma leitura de estado inválida"
fi

role_smoke_line="$(grep -Fn "grep -q '^CREATE ROLE outreach_service;'" "${restore_drill}" | cut -d: -f1)"
[[ -n "${role_smoke_line}" && "${complete_gate_line}" -lt "${role_smoke_line}" ]] \
  || fail "restore drill exige roles Outreach antes de provar o schema completo"
grep -Fq 'outreach_schema=%s' "${restore_drill}" \
  || fail "relatório de restauro não regista absent/partial/complete"

# A rollback must prove/import the immutable image before downtime, then take
# only the explicit offline activation path. It must never fall through to the
# normal deploy branch that builds, migrates, backs up, or probes the Internet.
publisher="${ROOT}/infra/release-publish.sh"
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
grep -Fq "to_regprocedure(" <<< "${rollback_mode_block}" \
  || fail "rollback não testa a função de transição no schema parcial"
grep -Fq 'execute $transition$' <<< "${rollback_mode_block}" \
  || fail "rollback resolve estaticamente a função de transição ausente"
grep -Fq 'update public.outreach_system_state' <<< "${rollback_mode_block}" \
  || fail "rollback não força disabled:false quando só a migration base existe"
grep -Fq "select to_regclass('public.outreach_system_state') is not null" <<< "${rollback_mode_block}" \
  || fail "rollback consulta o estado sem provar primeiro a tabela"
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
  infra/configure-pgsodium.sh
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
