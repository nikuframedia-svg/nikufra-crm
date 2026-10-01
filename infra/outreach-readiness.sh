#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
BACKUP_ROOT="${NIKUFRA_BACKUP_ROOT:-/home/luis/services/nikufra-crm/backups}"
target="${1:---dark}"
[[ "${target}" =~ ^--(dark|for-canary|for-live)$ ]] || { echo "Uso: $0 [--dark|--for-canary|--for-live]" >&2; exit 2; }

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
RCLONE_BIN="${RCLONE_BIN:-$(command -v rclone || true)}"
[[ -n "${RCLONE_BIN}" ]] || RCLONE_BIN="${HOME}/.local/bin/rclone"

failures=0
pass() { printf 'OK   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }
db_value() { "${COMPOSE[@]}" exec -T db psql -U postgres -d postgres -Atc "$1"; }

remote_record() {
  local remote_dir="$1" include="$2"
  "${RCLONE_BIN}" lsf "${remote_dir}" --files-only --include "${include}" \
    --format 'tp' --separator '|' 2>/dev/null | sort | tail -1
}

record_is_recent() {
  local record="$1" max_age="$2" modified_at now_epoch modified_epoch age
  [[ "${record}" == *'|'* ]] || return 1
  modified_at="${record%%|*}"
  now_epoch="$(date -u +%s)"
  modified_epoch="$(date -u -d "${modified_at}" +%s 2>/dev/null)" || return 1
  age=$((now_epoch - modified_epoch))
  # Permit five minutes of clock skew, but never accept a materially future
  # timestamp as proof of a fresh offsite copy.
  (( age >= -300 && age <= max_age ))
}

remote_named_record() {
  local remote_dir="$1" name="$2"
  "${RCLONE_BIN}" lsf "${remote_dir}" --files-only --include "${name}" \
    --format 'tp' --separator '|' 2>/dev/null | awk -F'|' -v expected="${name}" '$2 == expected { print; exit }'
}

verify_remote_checksum_pair() {
  local remote_dir="$1" name="$2" work_dir
  work_dir="$(mktemp -d "${TMPDIR:-/tmp}/nikufra-readiness.XXXXXX")"
  if ! "${RCLONE_BIN}" copyto "${remote_dir}/${name}" "${work_dir}/${name}" >/dev/null 2>&1 \
    || ! "${RCLONE_BIN}" copyto "${remote_dir}/${name}.sha256" "${work_dir}/${name}.sha256" >/dev/null 2>&1 \
    || ! (cd "${work_dir}" && sha256sum --check "${name}.sha256" >/dev/null 2>&1); then
    rm -rf -- "${work_dir}"
    return 1
  fi
  rm -rf -- "${work_dir}"
}

valid_recent_pitr_report() {
  local report base elapsed target_lsn restored_lsn
  while IFS= read -r report; do
    base="$(sed -n 's/^base=//p' "${report}" | tail -1)"
    elapsed="$(sed -n 's/^elapsed_seconds=//p' "${report}" | tail -1)"
    target_lsn="$(sed -n 's/^target_lsn=//p' "${report}" | tail -1)"
    restored_lsn="$(sed -n 's/^restored_lsn=//p' "${report}" | tail -1)"
    if [[ "${base}" =~ ^base-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.tar\.gpg$ \
      && "${elapsed}" =~ ^[0-9]+$ && "${elapsed}" -le 14400 \
      && "${target_lsn}" =~ ^[0-9A-F]+/[0-9A-F]+$ \
      && "${restored_lsn}" =~ ^[0-9A-F]+/[0-9A-F]+$ \
      && "$(grep -c '^result=ok$' "${report}" || true)" == 1 \
      && "$(grep -c '^rpo_max_seconds=900$' "${report}" || true)" == 1 \
      && "$(grep -c '^rto_max_seconds=14400$' "${report}" || true)" == 1 ]]; then
      printf '%s\n' "${report}"
      return 0
    fi
  done < <(find "${BACKUP_ROOT}/pitr-drills" -maxdepth 1 -type f -name '*.txt' -mtime -35 -print 2>/dev/null | sort -r)
  return 1
}

if curl --fail --silent --max-time 10 "http://127.0.0.1:${OUTREACH_API_PORT:-8787}/healthz" >/dev/null; then pass "Outreach API saudável"; else fail "Outreach API indisponível"; fi
if curl --fail --silent --show-error --max-time 10 "https://${CRM_DOMAIN}/api/outreach/v1/healthz" \
  | grep -q '"service":"outreach-api"'; then
  pass "rota pública Outreach encaminhada para a API"
else
  fail "rota pública Outreach não encaminha para a API"
fi
api_id="$("${COMPOSE[@]}" ps -q outreach-api 2>/dev/null || true)"
api_send_enabled=""
api_shadow_mode=""
if [[ -n "${api_id}" ]]; then
  api_send_enabled="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${api_id}" 2>/dev/null | sed -n 's/^OUTREACH_SEND_ENABLED=//p' | tail -1)"
  api_shadow_mode="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${api_id}" 2>/dev/null | sed -n 's/^OUTREACH_SHADOW_MODE=//p' | tail -1)"
fi
worker_id="$("${COMPOSE[@]}" ps -q outreach-worker 2>/dev/null || true)"
worker_health=""
worker_send_enabled=""
worker_shadow_mode=""
if [[ -n "${worker_id}" ]]; then
  worker_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${worker_id}" 2>/dev/null || true)"
  worker_send_enabled="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${worker_id}" 2>/dev/null | sed -n 's/^OUTREACH_SEND_ENABLED=//p' | tail -1)"
  worker_shadow_mode="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${worker_id}" 2>/dev/null | sed -n 's/^OUTREACH_SHADOW_MODE=//p' | tail -1)"
fi
[[ "${worker_health}" == healthy ]] && pass "Outreach worker saudável" || fail "Outreach worker sem healthcheck saudável (${worker_health:-ausente})"
unauthenticated="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "http://127.0.0.1:${OUTREACH_API_PORT:-8787}/api/outreach/v1/overview")"
[[ "${unauthenticated}" == 401 ]] && pass "API privada exige sessão CRM" || fail "API privada devolveu HTTP ${unauthenticated} sem sessão"

schema_ready="$(db_value "select to_regclass('public.outreach_campaigns') is not null and to_regclass('public.communication_suppressions') is not null and to_regclass('private.outreach_credentials') is not null")"
[[ "${schema_ready}" == t ]] && pass "schema normalizado aplicado" || fail "schema Outreach incompleto"
rls_ready="$(db_value "select coalesce(bool_and(relrowsecurity and relforcerowsecurity),false) from pg_class where relnamespace='public'::regnamespace and relname like 'outreach_%'")"
[[ "${rls_ready}" == t ]] && pass "RLS e FORCE RLS ativos" || fail "RLS Outreach incompleto"
private_web_grants="$(db_value "select count(*) from information_schema.table_privileges where table_schema='private' and grantee in ('anon','authenticated','PUBLIC')")"
[[ "${private_web_grants}" == 0 ]] && pass "schema private sem grants de browser" || fail "foram encontrados ${private_web_grants} grants de browser em private"

state="$(db_value "select mode || ':' || send_enabled::text from public.outreach_system_state where id=true")"
if [[ "${target}" == --dark || "${target}" == --for-canary ]]; then
  [[ "${OUTREACH_SEND_ENABLED:-false}" == false \
    && "${OUTREACH_SHADOW_MODE:-true}" == true \
    && "${api_send_enabled}" == false && "${api_shadow_mode}" == true \
    && "${worker_send_enabled}" == false && "${worker_shadow_mode}" == true \
    && "${state}" == disabled:false ]] \
    && pass "hard gate outbound desligado e shadow read-only no ficheiro, API, worker e base" \
    || fail "dark deploy não está fail-closed (send_env=${OUTREACH_SEND_ENABLED:-unset}; shadow_env=${OUTREACH_SHADOW_MODE:-unset}; api_send=${api_send_enabled:-unset}; api_shadow=${api_shadow_mode:-unset}; worker_send=${worker_send_enabled:-unset}; worker_shadow=${worker_shadow_mode:-unset}; db=${state})"
else
  [[ "${OUTREACH_SEND_ENABLED:-false}" == true \
    && "${OUTREACH_SHADOW_MODE:-true}" == false \
    && "${api_send_enabled}" == true && "${api_shadow_mode}" == false \
    && "${worker_send_enabled}" == true && "${worker_shadow_mode}" == false \
    && "${state}" == canary:true ]] \
    && pass "promoção parte de canary:true com shadow desligado no ficheiro, API, worker e base" \
    || fail "live só pode partir de canary:true e shadow=false (send_env=${OUTREACH_SEND_ENABLED:-unset}; shadow_env=${OUTREACH_SHADOW_MODE:-unset}; api_send=${api_send_enabled:-unset}; api_shadow=${api_shadow_mode:-unset}; worker_send=${worker_send_enabled:-unset}; worker_shadow=${worker_shadow_mode:-unset}; db=${state})"
fi

expected_allowlist="$(printf '%s' "${OUTREACH_CANARY_ALLOWLIST:-}" | tr ',' '\n' | sed '/^[[:space:]]*$/d; s/^[[:space:]]*//; s/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]' | sort -u)"
actual_allowlist="$(db_value "select lower(email::text) from private.outreach_canary_allowlist order by lower(email::text)")"
[[ -n "${expected_allowlist}" && "${actual_allowlist}" == "${expected_allowlist}" ]] \
  && pass "allowlist canary coincide exatamente com a configuração" \
  || fail "allowlist canary diverge da configuração (não é permitido manter destinatários extra)"

disk_used="$(df -P / | awk 'NR==2 {gsub("%", "", $5); print $5}')"
if (( disk_used < 80 )); then pass "disco abaixo de 80% (${disk_used}%)"; else fail "disco está em ${disk_used}%"; fi

# A permanent physical slot protects PITR continuity, but it must be bounded
# and observed: an abandoned unlimited slot can retain WAL until PostgreSQL
# runs out of disk. `safe_wal_size` is NULL for an unlimited slot and reaches
# zero before PostgreSQL marks a capped slot lost.
slot_snapshot="$(db_value "select active, wal_status, coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn), 0)::bigint, safe_wal_size, current_setting('max_slot_wal_keep_size') from pg_replication_slots where slot_name='nikufra_offsite' and slot_type='physical'" 2>/dev/null || true)"
IFS='|' read -r slot_active slot_status slot_lag slot_safe slot_limit <<<"${slot_snapshot}"
min_slot_safe="${WAL_SLOT_MIN_SAFE_BYTES:-536870912}"
if [[ "${slot_active:-}" == t \
  && "${slot_status:-}" =~ ^(reserved|extended)$ \
  && "${slot_lag:-}" =~ ^[0-9]+$ \
  && "${slot_safe:-}" =~ ^[0-9]+$ \
  && "${min_slot_safe}" =~ ^[0-9]+$ \
  && "${slot_safe}" -ge "${min_slot_safe}" \
  && "${slot_limit:-}" != -1 ]]; then
  pass "slot WAL ativo e limitado (${slot_status}, retained=${slot_lag}B, safe=${slot_safe}B, limit=${slot_limit})"
else
  fail "slot WAL inseguro (active=${slot_active:-missing}, status=${slot_status:-missing}, retained=${slot_lag:-missing}B, safe=${slot_safe:-missing}B, limit=${slot_limit:-missing})"
fi
db_disk_used="$("${COMPOSE[@]}" exec -T db df -P /var/lib/postgresql/data 2>/dev/null | awk 'NR==2 {gsub("%", "", $5); print $5}' || true)"
if [[ "${db_disk_used}" =~ ^[0-9]+$ ]] && (( db_disk_used < 80 )); then
  pass "volume PostgreSQL abaixo de 80% (${db_disk_used}%)"
else
  fail "volume PostgreSQL sem margem segura (${db_disk_used:-desconhecido}%)"
fi

if find "${BACKUP_ROOT}/daily" -maxdepth 1 -type f -name 'nikufra-*.dump' -mtime -2 -size +100k -print -quit 2>/dev/null | grep -q .; then pass "backup lógico local recente"; else fail "backup lógico local recente em falta"; fi
dump_record=""
dump_checksum_record=""
globals_record=""
globals_checksum_record=""
if [[ -x "${RCLONE_BIN}" && -n "${RCLONE_REMOTE:-}" ]]; then
  dump_record="$(remote_record "${RCLONE_REMOTE}/daily/" '*.dump.gpg' || true)"
  dump_name="${dump_record#*|}"
  if [[ "${dump_name}" =~ ^nikufra-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.dump\.gpg$ ]]; then
    dump_checksum_record="$(remote_named_record "${RCLONE_REMOTE}/daily/" "${dump_name}.sha256" || true)"
    globals_name="${dump_name%.dump.gpg}.globals.sql.gpg"
    globals_record="$(remote_named_record "${RCLONE_REMOTE}/daily/" "${globals_name}" || true)"
    globals_checksum_record="$(remote_named_record "${RCLONE_REMOTE}/daily/" "${globals_name}.sha256" || true)"
  fi
fi
if record_is_recent "${dump_record}" 172800 \
  && record_is_recent "${dump_checksum_record}" 172800 \
  && record_is_recent "${globals_record}" 172800 \
  && record_is_recent "${globals_checksum_record}" 172800; then
  pass "backup cifrado, roles e checksums offsite com menos de 48 horas"
else
  fail "backup offsite completo (dump, roles e checksums <=48h) não comprovado"
fi

# A weekly physical base is the bounded starting point for WAL replay. Merely
# finding a local tarball is not enough: readiness authenticates the encrypted
# object and its checksum directly against the offsite remote.
base_record=""
base_checksum_record=""
if [[ -x "${RCLONE_BIN}" && -n "${RCLONE_REMOTE:-}" ]]; then
  base_record="$(remote_record "${RCLONE_REMOTE}/base/" 'base-*.tar.gpg' || true)"
fi
base_name="${base_record#*|}"
if [[ "${base_name}" =~ ^base-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.tar\.gpg$ ]]; then
  base_checksum_record="$(remote_named_record "${RCLONE_REMOTE}/base/" "${base_name}.sha256" || true)"
fi
if record_is_recent "${base_record}" 691200 \
  && record_is_recent "${base_checksum_record}" 691200 \
  && verify_remote_checksum_pair "${RCLONE_REMOTE}/base" "${base_name}"; then
  pass "base backup físico e checksum offsite autenticados com menos de 8 dias"
else
  fail "base backup físico offsite recente e íntegro (<=8 dias) não comprovado"
fi

pitr_report="$(valid_recent_pitr_report || true)"
if [[ -n "${pitr_report}" ]]; then
  pass "ensaio físico PITR recente, íntegro e dentro de RPO/RTO"
else
  fail "ensaio físico PITR válido nos últimos 35 dias não comprovado"
fi

# The same 15 minute RPO applies while outbound is dark: a first deployment is
# not ready until the base can be advanced with a current authenticated WAL.
if find "${BACKUP_ROOT}/wal" -maxdepth 1 -type f -name '0???????????????????????' -mmin -15 -print -quit 2>/dev/null | grep -q .; then pass "WAL local dentro do RPO de 15 minutos"; else fail "WAL recente em falta"; fi

wal_record=""
if [[ -x "${RCLONE_BIN}" && -n "${RCLONE_REMOTE:-}" ]]; then
  wal_record="$(remote_record "${RCLONE_REMOTE}/wal/" '0???????????????????????.gpg' || true)"
fi
wal_name="${wal_record#*|}"
wal_checksum_record=""
if [[ "${wal_name}" =~ ^0[0-9A-F]{23}\.gpg$ ]]; then
  wal_checksum_record="$(remote_named_record "${RCLONE_REMOTE}/wal/" "${wal_name}.sha256" || true)"
fi
if record_is_recent "${wal_record}" 900 \
  && record_is_recent "${wal_checksum_record}" 900 \
  && verify_remote_checksum_pair "${RCLONE_REMOTE}/wal" "${wal_name}"; then
  pass "WAL e checksum offsite autenticados dentro do RPO de 15 minutos"
else
  fail "WAL offsite recente e íntegro (<=15 min) não comprovado diretamente no remote"
fi

if [[ "${target}" != --dark ]]; then
  if [[ "${target}" == --for-canary ]]; then
    canary_mailboxes="$(db_value "select count(*), count(*) filter (where m.provider='google' and m.status='active' and m.daily_limit between 1 and 10 and m.ramp_daily_limit=1 and least(m.daily_limit,m.ramp_daily_limit)=1 and exists (select 1 from public.outreach_dns_checks d where d.mailbox_id=m.id and d.spf_status='pass' and d.dkim_status='pass' and d.dmarc_status='pass' and d.mx_status='pass' and d.checked_at > now()-interval '24 hours')) from public.outreach_mailboxes m where m.send_enabled")"
    IFS='|' read -r canary_total canary_ready <<<"${canary_mailboxes}"
    if [[ "${canary_total:-0}" =~ ^[0-9]+$ \
      && "${canary_ready:-0}" =~ ^[0-9]+$ \
      && "${canary_total}" -gt 0 \
      && "${canary_ready}" -eq "${canary_total}" ]]; then
      pass "todas as ${canary_total} mailboxes destinadas ao canary estão em ramp=1 e com DNS fresco"
    else
      fail "mailboxes de canary incompletas (${canary_ready:-0}/${canary_total:-0} em ramp=1, ativas e com DNS <=24h)"
    fi
  fi
  if find "${BACKUP_ROOT}/restore-drills" -maxdepth 1 -type f -name '*.txt' -mtime -35 -exec grep -l '^result=ok$' {} + 2>/dev/null | grep -q .; then pass "ensaio de restauro integral recente"; else fail "ensaio de restauro integral não comprovado"; fi
fi

if [[ "${target}" == --for-live ]]; then
  # Use the same durable predicate enforced by the database transition trigger;
  # the shell is an operator-facing explanation, not a weaker second policy.
  live_mailboxes="$(db_value "select count(*), count(*) filter (where private.outreach_mailbox_live_ready(m.id, s.canary_started_at)) from public.outreach_mailboxes m cross join public.outreach_system_state s where s.id and m.send_enabled")"
  IFS='|' read -r live_total live_ready <<<"${live_mailboxes}"
  if [[ "${live_total:-0}" =~ ^[0-9]+$ \
    && "${live_ready:-0}" =~ ^[0-9]+$ \
    && "${live_total}" -gt 0 \
    && "${live_ready}" -eq "${live_total}" ]]; then
    pass "todas as ${live_total} mailboxes têm ramp 1→3→5→10 comprovado, amostra enviada em cada nível, DNS fresco e 48h estáveis em 10"
  else
    fail "prova live incompleta (${live_ready:-0}/${live_total:-0} mailboxes com sequência, envios por patamar, DNS <=24h e ramp=10 estável >=48h)"
  fi
  nonterminal_deliveries="$(db_value "select count(*) from private.outreach_delivery_ledger where status in ('sending','accepted','ambiguous')")"
  [[ "${nonterminal_deliveries}" == 0 ]] \
    && pass "nenhum delivery não terminal por reconciliar" \
    || fail "existem ${nonterminal_deliveries:-desconhecidos} ledgers não terminais por reconciliar"
  rollout_clock="$(db_value "select canary_started_at <= now()-interval '48 hours' and worker_continuous_since <= now()-interval '24 hours' and worker_last_heartbeat_at > now()-interval '5 minutes' from public.outreach_system_state where id=true")"
  [[ "${rollout_clock}" == t ]] && pass "janelas mínimas de canary (48h) e worker estável (24h) comprovadas" || fail "janelas de estabilidade ainda não cumpridas"
  incident_count="$(db_value "select (select count(*) from public.outreach_messages where kind in ('complaint','hard_bounce') and occurred_at > now()-interval '48 hours') + (select count(*) from public.outreach_jobs where status in ('failed','reconciliation_required') and updated_at > now()-interval '48 hours')")"
  [[ "${incident_count}" == 0 ]] && pass "48 horas sem incidentes bloqueantes" || fail "existem ${incident_count} incidentes nas últimas 48 horas"
fi

if (( failures == 0 )); then
  echo "READY Outreach ${target#--}"
  exit 0
fi
echo "NOT READY ${failures} gate(s) pendente(s)"
exit 1
