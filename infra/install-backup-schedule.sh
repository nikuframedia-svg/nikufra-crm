#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT="${NIKUFRA_BACKUP_ROOT:-/home/luis/services/nikufra-crm/backups}"
LOG_DIR="${BACKUP_ROOT}/logs"
BEGIN_MARKER="# BEGIN NIKUFRA MANAGED BACKUPS"
END_MARKER="# END NIKUFRA MANAGED BACKUPS"

command -v crontab >/dev/null || { echo "crontab é obrigatório." >&2; exit 1; }
mkdir -p "${LOG_DIR}"
chmod 700 "${BACKUP_ROOT}" "${LOG_DIR}"

current="$(mktemp "${TMPDIR:-/tmp}/nikufra-crontab.XXXXXX")"
updated="$(mktemp "${TMPDIR:-/tmp}/nikufra-crontab.XXXXXX")"
cleanup() { rm -f -- "${current}" "${updated}"; }
trap cleanup EXIT

crontab -l > "${current}" 2>/dev/null || true
awk -v begin="${BEGIN_MARKER}" -v end="${END_MARKER}" '
  $0 == begin { managed=1; next }
  $0 == end { managed=0; next }
  !managed { print }
' "${current}" > "${updated}"

cat >> "${updated}" <<EOF
${BEGIN_MARKER}
*/10 * * * * ${SCRIPT_DIR}/wal-offsite-sync.sh >> ${LOG_DIR}/wal-offsite.log 2>&1
25 2 * * * ${SCRIPT_DIR}/backup-production.sh >> ${LOG_DIR}/logical-backup.log 2>&1
25 3 * * 0 ${SCRIPT_DIR}/basebackup-production.sh >> ${LOG_DIR}/base-backup.log 2>&1
25 4 2 * * ${SCRIPT_DIR}/restore-drill.sh >> ${LOG_DIR}/restore-drill.log 2>&1
25 5 3 * * ${SCRIPT_DIR}/pitr-restore-drill.sh >> ${LOG_DIR}/pitr-restore-drill.log 2>&1
${END_MARKER}
EOF

crontab "${updated}"
echo "Agenda instalada: WAL/10 min, lógico diário, base semanal e drills lógico/PITR mensais."
