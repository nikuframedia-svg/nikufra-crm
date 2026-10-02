#!/usr/bin/env bash

# Shared, fail-closed disk policy for deployment and production readiness.
# The percentage ceiling can be raised explicitly, but never above 90%. The
# absolute free-space floor can be raised, but never below 20 GiB.
NIKUFRA_DISK_DEFAULT_MAX_PERCENT=80
NIKUFRA_DISK_HARD_MAX_PERCENT=90
NIKUFRA_DISK_DEFAULT_MIN_FREE_BYTES=21474836480
NIKUFRA_DISK_HARD_MIN_FREE_BYTES=21474836480

nikufra_disk_max_percent() {
  local value="${NIKUFRA_DISK_USAGE_MAX_PERCENT:-${NIKUFRA_DISK_DEFAULT_MAX_PERCENT}}"
  if [[ ! "${value}" =~ ^([1-9]|[1-8][0-9]|90)$ ]]; then
    printf 'NIKUFRA_DISK_USAGE_MAX_PERCENT tem de ser um inteiro canónico entre 1 e %s (recebido: %s).\n' \
      "${NIKUFRA_DISK_HARD_MAX_PERCENT}" "${value:-vazio}" >&2
    return 1
  fi
  printf '%s\n' "${value}"
}

nikufra_disk_min_free_kib() {
  local value="${NIKUFRA_DISK_MIN_FREE_BYTES:-${NIKUFRA_DISK_DEFAULT_MIN_FREE_BYTES}}"
  if [[ ! "${value}" =~ ^[1-9][0-9]*$ ]] \
    || (( ${#value} > 19 )) \
    || (( value < NIKUFRA_DISK_HARD_MIN_FREE_BYTES )) \
    || (( value > 9223372036854775807 )); then
    printf 'NIKUFRA_DISK_MIN_FREE_BYTES tem de ser um inteiro canónico >= %s (recebido: %s).\n' \
      "${NIKUFRA_DISK_HARD_MIN_FREE_BYTES}" "${value:-vazio}" >&2
    return 1
  fi
  printf '%s\n' "$((value / 1024 + (value % 1024 != 0)))"
}

nikufra_disk_is_safe() {
  local used_percent="${1:-}" available_kib="${2:-}" max_percent="${3:-}" min_free_kib="${4:-}"
  [[ "${used_percent}" =~ ^[0-9]+$ \
    && "${available_kib}" =~ ^[0-9]+$ \
    && "${max_percent}" =~ ^[0-9]+$ \
    && "${min_free_kib}" =~ ^[0-9]+$ ]] || return 2
  (( 10#${used_percent} < 10#${max_percent} \
    && 10#${available_kib} >= 10#${min_free_kib} ))
}

nikufra_disk_free_gib() {
  local available_kib="${1:-}"
  [[ "${available_kib}" =~ ^[0-9]+$ ]] || { printf 'desconhecido'; return; }
  awk -v kib="${available_kib}" 'BEGIN { printf "%.1f", kib / 1048576 }'
}
