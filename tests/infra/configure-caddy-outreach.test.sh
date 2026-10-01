#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nikufra-caddy-test.XXXXXX")"
cleanup() { rm -rf -- "${WORK}"; }
trap cleanup EXIT

mkdir -p "${WORK}/bin"
cp "${ROOT}/tests/infra/fixtures/Caddyfile.before-outreach" "${WORK}/Caddyfile"
original_inode="$(stat -f '%i' "${WORK}/Caddyfile" 2>/dev/null || stat -c '%i' "${WORK}/Caddyfile")"

cat > "${WORK}/bin/docker" <<'SH'
#!/usr/bin/env bash
set -eu
if [[ "${1:-}" == exec && "${2:-}" == -i ]]; then
  while IFS= read -r _line; do :; done
fi
exit 0
SH
cat > "${WORK}/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' '{"status":"ok","service":"outreach-api"}'
SH
chmod 755 "${WORK}/bin/docker" "${WORK}/bin/curl"

PATH="${WORK}/bin:${PATH}" \
NIKUFRA_CADDY_FILE="${WORK}/Caddyfile" \
CRM_DOMAIN="crm.nikufra.ai" \
OUTREACH_API_PORT=8787 \
  "${ROOT}/infra/configure-caddy-outreach.sh"

test "$(grep -c 'BEGIN NIKUFRA CRM OUTREACH MANAGED' "${WORK}/Caddyfile")" = 1
test "$(grep -c 'END NIKUFRA CRM OUTREACH MANAGED' "${WORK}/Caddyfile")" = 1
test "$(grep -c 'reverse_proxy 127.0.0.1:8787' "${WORK}/Caddyfile")" = 1
test "$(stat -f '%i' "${WORK}/Caddyfile" 2>/dev/null || stat -c '%i' "${WORK}/Caddyfile")" = "${original_inode}"
first_hash="$(sha256sum "${WORK}/Caddyfile" | awk '{print $1}')"

PATH="${WORK}/bin:${PATH}" \
NIKUFRA_CADDY_FILE="${WORK}/Caddyfile" \
CRM_DOMAIN="crm.nikufra.ai" \
OUTREACH_API_PORT=8787 \
  "${ROOT}/infra/configure-caddy-outreach.sh"

test "$(sha256sum "${WORK}/Caddyfile" | awk '{print $1}')" = "${first_hash}"
test "$(grep -c 'BEGIN NIKUFRA CRM OUTREACH MANAGED' "${WORK}/Caddyfile")" = 1
echo "Caddy Outreach route test: ok"
