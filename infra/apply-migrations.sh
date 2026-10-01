#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
PROFILE="${1:-}"
DOCKER_BIN="${NIKUFRA_DOCKER_BIN:-docker}"

case "${PROFILE}" in
  local)
    COMPOSE=("${DOCKER_BIN}" compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.local.yml")
    ;;
  production)
    COMPOSE=("${DOCKER_BIN}" compose --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/docker-compose.yml" -f "${SCRIPT_DIR}/docker-compose.production.yml")
    ;;
  *)
    echo "Uso: $0 {local|production}" >&2
    exit 2
    ;;
esac

[[ -f "${ENV_FILE}" ]] || { echo "Falta ${ENV_FILE}." >&2; exit 1; }
command -v "${DOCKER_BIN}" >/dev/null 2>&1 || { echo "Docker e obrigatorio." >&2; exit 1; }

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "sha256sum ou shasum e obrigatorio." >&2
    return 1
  fi
}

db_scalar() {
  if (( $# > 0 )); then
    "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc "$1"
  else
    "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -At
  fi
}

"${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
create schema if not exists nikufra_meta;
revoke all on schema nikufra_meta from public, anon, authenticated;
create table if not exists nikufra_meta.schema_migrations (
  name text primary key,
  checksum_sha256 text,
  applied_at timestamptz not null default now()
);
alter table nikufra_meta.schema_migrations
  add column if not exists checksum_sha256 text;
revoke all on table nikufra_meta.schema_migrations from public, anon, authenticated;
SQL

# Deployments made before the ledger already contain the CRM schema.  Only the
# migrations before Outreach may be baselined, and only after cumulative,
# independent sentinels prove that the complete historical schema is present.
LEGACY_BASELINE_CUTOFF="202609300001"
LEGACY_BASELINE_MIGRATIONS=(
  202608240001_initial_schema.sql
  202608240002_metrics.sql
  202608240003_gmail_scheduler.sql
  202608240004_gmail_oauth_state.sql
  202608240005_editable_pipeline_settings.sql
  202608250001_real_data_gmail_backfill.sql
  202608250002_google_contacts_calendar.sql
  202608250003_exact_numeric_precision.sql
  202608250003_first_admin_bootstrap.sql
  202608250004_google_team_calendar.sql
  202608250005_secure_onboarding_cycles_contacts.sql
  202608250006_google_token_column_security.sql
  202608250007_profile_security_audit.sql
  202608250008_auth_email_delivery.sql
  202608250009_last_admin_guard.sql
  202608260001_commercial_record_deletion_follow_ups.sql
  202609140001_rejected_pipeline_and_follow_up_dismissals.sql
  202609290001_team_chat_agents.sql
  202609290002_billing_deletion.sql
  202609290003_atomic_billing_deletion.sql
)

legacy_schema_ready() {
  db_scalar <<'SQL'
select
  to_regtype('public.profile_role') is not null
  and to_regclass('public.profiles') is not null
  and to_regclass('public.empresas') is not null
  and to_regclass('public.contactos') is not null
  and to_regclass('public.oportunidades') is not null
  and to_regclass('public.atividades') is not null
  and to_regclass('public.faturacao') is not null
  and to_regclass('public.google_tokens') is not null
  and to_regclass('public.metricas_pipeline') is not null
  and to_regclass('public.metricas_ciclo_acordo_verbal') is not null
  and to_regprocedure('private.invoke_gmail_sync()') is not null
  and to_regclass('public.google_oauth_states') is not null
  and to_regclass('public.pipeline_settings') is not null
  and to_regclass('public.google_calendar_events') is not null
  and to_regclass('public.user_invitations') is not null
  and to_regclass('public.contact_import_suppressions') is not null
  and to_regclass('public.auth_email_deliveries') is not null
  and to_regprocedure('public.audit_profile_security_changes()') is not null
  and to_regprocedure('public.delete_commercial_records(uuid[],uuid[],uuid[],uuid)') is not null
  and to_regclass('public.follow_up_dismissals') is not null
  and to_regclass('public.follow_up_suggestions') is not null
  and to_regclass('public.chat_conversations') is not null
  and to_regclass('public.chat_messages') is not null
  and to_regclass('public.chat_agents') is not null
  and to_regprocedure('public.delete_billing_entry(uuid,uuid)') is not null
  and exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='oportunidades' and column_name='valor_proposta'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='google_tokens' and column_name='import_confirmed_at'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid=to_regclass('public.audit_log') and conname='audit_log_acao_check'
  );
SQL
}

legacy_migration_applied() {
  case "$1" in
    202608240001_initial_schema.sql) db_scalar "select to_regclass('public.profiles') is not null and to_regtype('public.profile_role') is not null" ;;
    202608240002_metrics.sql) db_scalar "select to_regclass('public.metricas_cliente') is not null and to_regclass('public.metricas_funil') is not null" ;;
    202608240003_gmail_scheduler.sql) db_scalar "select to_regprocedure('private.invoke_gmail_sync()') is not null" ;;
    202608240004_gmail_oauth_state.sql) db_scalar "select to_regclass('public.google_oauth_states') is not null" ;;
    202608240005_editable_pipeline_settings.sql) db_scalar "select to_regclass('public.pipeline_settings') is not null" ;;
    202608250001_real_data_gmail_backfill.sql) db_scalar "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='empresas' and column_name='nome_normalizado') and exists(select 1 from information_schema.columns where table_schema='public' and table_name='google_tokens' and column_name='backfill_complete')" ;;
    202608250002_google_contacts_calendar.sql) db_scalar "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='google_tokens' and column_name='people_sync_token') and exists(select 1 from information_schema.columns where table_schema='public' and table_name='contactos' and column_name='google_resource_name')" ;;
    202608250003_exact_numeric_precision.sql) db_scalar "select to_regclass('public.metricas_taxa_reuniao_coorte') is not null and to_regclass('public.metricas_ciclo_venda') is not null" ;;
    202608250003_first_admin_bootstrap.sql) db_scalar "select coalesce(pg_get_functiondef(to_regprocedure('public.handle_new_user()')) like '%nikufra:first-admin%',false)" ;;
    202608250004_google_team_calendar.sql) db_scalar "select to_regclass('public.google_calendar_events') is not null" ;;
    202608250005_secure_onboarding_cycles_contacts.sql) db_scalar "select to_regclass('public.user_invitations') is not null and to_regclass('public.contact_import_suppressions') is not null and to_regclass('public.metricas_ciclo_acordo_verbal') is not null" ;;
    202608250006_google_token_column_security.sql) db_scalar "select not has_table_privilege('authenticated','public.google_tokens','SELECT') and has_column_privilege('authenticated','public.google_tokens','import_confirmed_at','SELECT')" ;;
    202608250007_profile_security_audit.sql) db_scalar "select to_regprocedure('public.audit_profile_security_changes()') is not null and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.profiles') and tgname='audit_profile_security_changes' and not tgisinternal)" ;;
    202608250008_auth_email_delivery.sql) db_scalar "select to_regclass('public.auth_email_deliveries') is not null" ;;
    202608250009_last_admin_guard.sql) db_scalar "select coalesce(pg_get_functiondef(to_regprocedure('public.protect_profile_security_fields()')) like '%nikufra:last-active-admin%',false)" ;;
    202608260001_commercial_record_deletion_follow_ups.sql) db_scalar "select to_regprocedure('public.delete_commercial_records(uuid[],uuid[],uuid[],uuid)') is not null" ;;
    202609140001_rejected_pipeline_and_follow_up_dismissals.sql) db_scalar "select to_regclass('public.follow_up_dismissals') is not null and exists(select 1 from pg_constraint where conrelid=to_regclass('public.oportunidades') and conname='recusado_exige_valor_proposta')" ;;
    202609290001_team_chat_agents.sql) db_scalar "select to_regclass('public.chat_conversations') is not null and to_regclass('public.chat_messages') is not null and to_regclass('public.chat_agents') is not null" ;;
    202609290002_billing_deletion.sql) db_scalar "select coalesce(pg_get_constraintdef(oid) like '%''DELETE''%',false) from pg_constraint where conrelid=to_regclass('public.audit_log') and conname='audit_log_acao_check'" ;;
    202609290003_atomic_billing_deletion.sql) db_scalar "select to_regprocedure('public.delete_billing_entry(uuid,uuid)') is not null" ;;
    *) echo f ;;
  esac
}

ledger_count="$(db_scalar 'select count(*) from nikufra_meta.schema_migrations')"
core_schema_present="$(db_scalar "select to_regclass('public.profiles') is not null")"
legacy_footprint_present="$(db_scalar "select to_regclass('public.empresas') is not null or to_regclass('public.contactos') is not null or to_regclass('public.oportunidades') is not null")"

if [[ "${core_schema_present}" != t && ( "${ledger_count}" != 0 || "${legacy_footprint_present}" == t ) ]]; then
  echo "ERRO: base parcialmente inicializada: existe ledger/schema historico sem o sentinel public.profiles. Reconciliar manualmente antes de migrar." >&2
  exit 1
fi

if [[ "${core_schema_present}" == t ]]; then
  legacy_checksums=()
  for legacy_name in "${LEGACY_BASELINE_MIGRATIONS[@]}"; do
    legacy_path="${PROJECT_DIR}/supabase/migrations/${legacy_name}"
    [[ -f "${legacy_path}" && "${legacy_name}" =~ ^[0-9]{12}_[A-Za-z0-9_.-]+\.sql$ ]] || {
      echo "Migration historica esperada em falta ou com nome invalido: ${legacy_name}" >&2
      exit 1
    }
    legacy_id="${legacy_name%%_*}"
    (( 10#${legacy_id} < 10#${LEGACY_BASELINE_CUTOFF} )) || {
      echo "Recusa de seguranca: o baseline tentou incluir ${legacy_name}." >&2
      exit 1
    }
    legacy_checksum="$(sha256_file "${legacy_path}")"
    legacy_checksums+=("${legacy_checksum}")
  done

  if [[ "$(legacy_schema_ready)" == t ]]; then
    baseline_needed=false
    for index in "${!LEGACY_BASELINE_MIGRATIONS[@]}"; do
      legacy_name="${LEGACY_BASELINE_MIGRATIONS[$index]}"
      legacy_checksum="${legacy_checksums[$index]}"
      applied_checksum="$(db_scalar "select coalesce(checksum_sha256, '__legacy__') from nikufra_meta.schema_migrations where name = '${legacy_name}'")"
      if [[ -z "${applied_checksum}" || "${applied_checksum}" == __legacy__ ]]; then
        baseline_needed=true
      elif [[ "${applied_checksum}" != "${legacy_checksum}" ]]; then
        echo "ERRO: a migration historica ${legacy_name} foi alterada (${applied_checksum} != ${legacy_checksum})." >&2
        exit 1
      fi
    done

    if [[ "${baseline_needed}" == true ]]; then
      {
        printf 'begin;\ninsert into nikufra_meta.schema_migrations(name, checksum_sha256) values\n'
        separator=''
        for index in "${!LEGACY_BASELINE_MIGRATIONS[@]}"; do
          printf "%s('%s','%s')" "${separator}" "${LEGACY_BASELINE_MIGRATIONS[$index]}" "${legacy_checksums[$index]}"
          separator=$',\n'
        done
        printf '\non conflict (name) do update set checksum_sha256=excluded.checksum_sha256 where nikufra_meta.schema_migrations.checksum_sha256 is null;\ncommit;\n'
      } | "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null
      echo "Ledger historico reconciliado atomicamente com ${#LEGACY_BASELINE_MIGRATIONS[@]} migrations pre-Outreach comprovadas."
    fi
  else
    # A normal development/upgrade database may contain a valid, checksummed
    # prefix and simply not have reached the newest historical migrations yet.
    # That tail is safe to apply. A missing/null row followed by any later row
    # is a ledger gap and is never guessed without the full cumulative schema.
    (( ledger_count > 0 )) || {
      echo "ERRO: schema CRM sem ledger e sem todos os sentinels pre-Outreach; baseline automatico recusado." >&2
      exit 1
    }
    first_missing_id=""
    prefix_null_names=()
    prefix_null_checksums=()
    proven_missing_names=()
    proven_missing_checksums=()
    for index in "${!LEGACY_BASELINE_MIGRATIONS[@]}"; do
      legacy_name="${LEGACY_BASELINE_MIGRATIONS[$index]}"
      legacy_checksum="${legacy_checksums[$index]}"
      applied_checksum="$(db_scalar "select coalesce(checksum_sha256, '__legacy__') from nikufra_meta.schema_migrations where name = '${legacy_name}'")"
      if [[ "${applied_checksum}" == __legacy__ ]]; then
        [[ -z "${first_missing_id}" ]] || {
          echo "ERRO: ledger historico tem um gap antes da row legada ${legacy_name}." >&2
          exit 1
        }
        # A pre-Outreach row written by the old deploy proves that migration
        # committed; only its checksum column is new. Outreach rows never take
        # this compatibility path.
        prefix_null_names+=("${legacy_name}")
        prefix_null_checksums+=("${legacy_checksum}")
        continue
      fi
      if [[ -z "${applied_checksum}" ]]; then
        if [[ "$(legacy_migration_applied "${legacy_name}")" == t ]]; then
          [[ -z "${first_missing_id}" ]] || {
            echo "ERRO: o schema prova ${legacy_name} depois de uma migration historica realmente pendente." >&2
            exit 1
          }
          proven_missing_names+=("${legacy_name}")
          proven_missing_checksums+=("${legacy_checksum}")
          continue
        fi
        [[ -n "${first_missing_id}" ]] || first_missing_id="${legacy_name%%_*}"
        continue
      fi
      [[ -z "${first_missing_id}" ]] || {
        echo "ERRO: ledger historico tem um gap antes de ${legacy_name}; reconciliacao automatica recusada." >&2
        exit 1
      }
      [[ "${applied_checksum}" == "${legacy_checksum}" ]] || {
        echo "ERRO: a migration historica ${legacy_name} foi alterada (${applied_checksum} != ${legacy_checksum})." >&2
        exit 1
      }
    done
    if [[ -n "${first_missing_id}" ]]; then
      later_rows="$(db_scalar "select count(*) from nikufra_meta.schema_migrations where substring(name from '^[0-9]{12}')::numeric >= ${first_missing_id}")"
      (( later_rows == 0 )) || {
        echo "ERRO: ledger contem rows posteriores a primeira migration em falta (${first_missing_id}); baseline recusado." >&2
        exit 1
      }
      if (( ${#prefix_null_names[@]} > 0 || ${#proven_missing_names[@]} > 0 )); then
        {
          printf 'begin;\n'
          for index in "${!prefix_null_names[@]}"; do
            printf "update nikufra_meta.schema_migrations set checksum_sha256='%s' where name='%s' and checksum_sha256 is null;\n" \
              "${prefix_null_checksums[$index]}" "${prefix_null_names[$index]}"
          done
          for index in "${!proven_missing_names[@]}"; do
            printf "insert into nikufra_meta.schema_migrations(name,checksum_sha256) values ('%s','%s') on conflict (name) do nothing;\n" \
              "${proven_missing_names[$index]}" "${proven_missing_checksums[$index]}"
          done
          printf 'commit;\n'
        } | "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null
      fi
      echo "Ledger historico e um prefixo valido; checksums legados reconciliados e tail pendente pronto a aplicar."
    else
      echo "ERRO: ledger diz conter todas as migrations historicas, mas os sentinels do schema estao incompletos." >&2
      exit 1
    fi
  fi
fi

found_migration=false
for migration in "${PROJECT_DIR}"/supabase/migrations/*.sql; do
  [[ -f "${migration}" ]] || continue
  found_migration=true
  name="$(basename "${migration}")"
  [[ "${name}" =~ ^[0-9]{12}_[A-Za-z0-9_.-]+\.sql$ ]] || {
    echo "Nome de migration recusado: ${name}" >&2
    exit 1
  }
  checksum="$(sha256_file "${migration}")"
  applied_checksum="$(db_scalar "select coalesce(checksum_sha256, '__legacy__') from nikufra_meta.schema_migrations where name = '${name}'")"

  if [[ "${applied_checksum}" == __legacy__ ]]; then
    migration_id="${name%%_*}"
    if (( 10#${migration_id} >= 10#${LEGACY_BASELINE_CUTOFF} )); then
      echo "ERRO: a migration Outreach ${name} nao tem checksum comprovavel; baseline automatico recusado." >&2
    else
      echo "ERRO: a migration historica ${name} continua sem checksum apesar dos sentinels; reconciliacao recusada." >&2
    fi
    exit 1
  fi
  if [[ -n "${applied_checksum}" ]]; then
    if [[ "${applied_checksum}" != "${checksum}" ]]; then
      echo "ERRO: a migration ja aplicada ${name} foi alterada (${applied_checksum} != ${checksum}). Cria uma migration aditiva nova." >&2
      exit 1
    fi
    continue
  fi

  [[ "$(head -n 1 "${migration}")" == 'begin;' && "$(tail -n 1 "${migration}")" == 'commit;' ]] || {
    echo "ERRO: ${name} tem de ter exatamente o wrapper externo begin;/commit; para aplicacao atomica." >&2
    exit 1
  }
  echo "A aplicar ${name}"
  {
    printf 'begin;\n'
    sed '1d;$d' "${migration}"
    printf "\ninsert into nikufra_meta.schema_migrations(name, checksum_sha256) values (:'migration_name', :'migration_checksum');\ncommit;\n"
  } | "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
      --set=migration_name="${name}" --set=migration_checksum="${checksum}" >/dev/null
done

[[ "${found_migration}" == true ]] || { echo "Nenhuma migration encontrada." >&2; exit 1; }

null_checksum_count="$(db_scalar 'select count(*) from nikufra_meta.schema_migrations where checksum_sha256 is null')"
(( null_checksum_count == 0 )) || {
  echo "ERRO: o ledger ainda contem ${null_checksum_count} migration(s) sem checksum." >&2
  exit 1
}
"${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  'alter table nikufra_meta.schema_migrations alter column checksum_sha256 set not null' >/dev/null

echo "Ledger de migrations validado por checksum (${PROFILE})."
