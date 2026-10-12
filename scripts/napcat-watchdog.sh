#!/usr/bin/env bash
# NapCat watchdog: keep the test-stack QQ accounts online.
#
# Polls each NapCat instance's get_login_info. When an account drops offline:
#   1. restart the container (NapCat fast-login often recovers a transient kick
#      without a fresh QR scan),
#   2. re-check after a grace period; if still offline, log ERROR — a human
#      must scan the QR code in the WebUI / container logs.
# Restart attempts are rate-limited (once per instance per RESTART_COOLDOWN)
# so a hard-offline account cannot cause a restart loop.
#
# Usage:
#   scripts/napcat-watchdog.sh           # loop forever (systemd service mode)
#   scripts/napcat-watchdog.sh --once    # single check, exit 0 if all online
#
# Env overrides: WATCHDOG_INTERVAL, RESTART_COOLDOWN, NAPCAT_ACCESS_TOKEN,
# WATCHDOG_LOG, plus per-instance NapCat HTTP ports (BOT_HTTP_PORT etc.).
set -u

ONCE=0
[ "${1:-}" = "--once" ] && ONCE=1

TOKEN="${NAPCAT_ACCESS_TOKEN:-nanoclaw-test-token}"
INTERVAL="${WATCHDOG_INTERVAL:-300}"
COOLDOWN="${RESTART_COOLDOWN:-3600}"
LOG="${WATCHDOG_LOG:-/tmp/napcat-watchdog.log}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(dirname "$SCRIPT_DIR")"

# name:container:http_port
INSTANCES="bot:napcat-bot:${BOT_HTTP_PORT:-3100}"
INSTANCES="$INSTANCES user-a:napcat-user-a:${USER_A_HTTP_PORT:-3000}"
INSTANCES="$INSTANCES user-b:napcat-user-b:${USER_B_HTTP_PORT:-3003}"

log() {
  local level="$1"; shift
  local line="[$(date '+%F %T')] [$level] $*"
  echo "$line" >>"$LOG"
  echo "$line"
}

is_online() {
  local port="$1"
  curl -s -m 5 -X POST "http://127.0.0.1:${port}/get_login_info" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{}' | grep -q '"nickname"'
}

last_restart() { cat "/tmp/napcat-watchdog-${1}.ts" 2>/dev/null || echo 0; }
mark_restart() { date +%s >"/tmp/napcat-watchdog-${1}.ts"; }

check_one() {
  local name="$1" container="$2" port="$3"
  if is_online "$port"; then
    log INFO "$name online"
    return 0
  fi
  log WARN "$name offline — restarting $container"
  local now prev
  now=$(date +%s); prev=$(last_restart "$name")
  if [ $((now - prev)) -ge "$COOLDOWN" ]; then
    mark_restart "$name"
    docker restart "$container" >>"$LOG" 2>&1
    sleep 20
    if is_online "$port"; then
      log INFO "$name recovered after container restart"
      return 0
    fi
  fi
  log ERROR "$name still offline — scan the QR code: http://127.0.0.1:${port}/ (WebUI port is 6099/6100/6101 for bot/user-a/user-b)"
  return 1
}

while true; do
  rc=0
  for inst in $INSTANCES; do
    IFS=: read -r name container port <<<"$inst"
    check_one "$name" "$container" "$port" || rc=1
  done
  [ "$ONCE" = 1 ] && exit $rc
  sleep "$INTERVAL"
done
