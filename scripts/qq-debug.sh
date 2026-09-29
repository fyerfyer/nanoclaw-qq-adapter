#!/usr/bin/env bash
#
# Robust QQ debug script for the NanoClaw OneBot Napcat adapter.
#
# This script checks the full test stack before running real tests:
#   1. Docker containers are running
#   2. OneBot HTTP/WS ports are listening
#   3. QQ accounts are online
#   4. No stale health-check processes are left
#   5. Health check can echo a private and a group message
#
# Usage:
#   scripts/qq-debug.sh
#
# Exit codes:
#   0 - all checks passed
#   1 - environment issue (containers, ports, login)
#   2 - message roundtrip failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.test.yml"

# Read only the keys this script consumes; do not source/execute a dotenv file.
if [ -f "$PROJECT_DIR/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      NAPCAT_ACCESS_TOKEN=*) NAPCAT_ACCESS_TOKEN="${line#*=}" ;;
      NAPCAT_BOT_ACCOUNT=*) NAPCAT_BOT_ACCOUNT="${line#*=}" ;;
      NAPCAT_USER_A_ACCOUNT=*) NAPCAT_USER_A_ACCOUNT="${line#*=}" ;;
      NAPCAT_USER_B_ACCOUNT=*) NAPCAT_USER_B_ACCOUNT="${line#*=}" ;;
      NAPCAT_BOT_HTTP_PORT=*) NAPCAT_BOT_HTTP_PORT="${line#*=}" ;;
      NAPCAT_USER_A_HTTP_PORT=*) NAPCAT_USER_A_HTTP_PORT="${line#*=}" ;;
      NAPCAT_USER_B_HTTP_PORT=*) NAPCAT_USER_B_HTTP_PORT="${line#*=}" ;;
      NAPCAT_TEST_GROUP_ID=*) NAPCAT_TEST_GROUP_ID="${line#*=}" ;;
    esac
  done < "$PROJECT_DIR/.env"
fi

TOKEN="${NAPCAT_ACCESS_TOKEN:-}"
BOT_HTTP="http://127.0.0.1:${NAPCAT_BOT_HTTP_PORT:-3100}"
USER_A_HTTP="http://127.0.0.1:${NAPCAT_USER_A_HTTP_PORT:-3000}"
USER_B_HTTP="http://127.0.0.1:${NAPCAT_USER_B_HTTP_PORT:-3003}"
BOT_QQ="${NAPCAT_BOT_ACCOUNT:?Set NAPCAT_BOT_ACCOUNT in .env}"
USER_A_QQ="${NAPCAT_USER_A_ACCOUNT:?Set NAPCAT_USER_A_ACCOUNT in .env}"
USER_B_QQ="${NAPCAT_USER_B_ACCOUNT:?Set NAPCAT_USER_B_ACCOUNT in .env}"
GROUP_ID="${NAPCAT_TEST_GROUP_ID:?Set NAPCAT_TEST_GROUP_ID in .env}"
HEALTH_LOG="/tmp/nanoclaw-health.log"
HEALTH_PID_FILE="/tmp/nanoclaw-health.pid"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---------------------------------------------------------------------------
# 1. Containers
# ---------------------------------------------------------------------------
check_containers() {
  log_info "Checking Docker containers..."
  local missing=()
  for c in napcat-bot napcat-user-a napcat-user-b; do
    if ! docker ps --format '{{.Names}}' | grep -qx "$c"; then
      missing+=("$c")
    fi
  done

  if [ ${#missing[@]} -ne 0 ]; then
    log_err "Missing containers: ${missing[*]}"
    log_info "Start them with: docker compose -f $COMPOSE_FILE up -d"
    return 1
  fi
  log_info "All containers are running."
}

# ---------------------------------------------------------------------------
# 2. Ports
# ---------------------------------------------------------------------------
check_ports() {
  log_info "Checking OneBot ports..."
  local ports=(3000 3001 3002 3003 3004 3100)
  local missing=()
  for p in "${ports[@]}"; do
    if ! ss -tln 2>/dev/null | grep -q ":$p\b"; then
      missing+=("$p")
    fi
  done

  if [ ${#missing[@]} -ne 0 ]; then
    log_err "Ports not listening: ${missing[*]}"
    return 1
  fi
  log_info "All OneBot ports are listening."
}

# ---------------------------------------------------------------------------
# 3. QQ online status
# ---------------------------------------------------------------------------
call_onebot() {
  local url="$1"
  local action="$2"
  local payload="${3:-{}}"
  curl -s -X POST "$url/$action" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$payload"
}

check_single_account() {
  local url="$1"
  local expected_qq="$2"
  local resp
  resp=$(call_onebot "$url" "get_login_info" || true)

  if [ -z "$resp" ]; then
    echo "offline:no-response"
    return
  fi

  local retcode
  retcode=$(echo "$resp" | grep -oP '"retcode":\s*\K[0-9]+' || echo "unknown")
  local actual_qq
  actual_qq=$(echo "$resp" | grep -oP '"user_id":\s*\K[0-9]+' || echo "unknown")

  if [ "$retcode" != "0" ]; then
    echo "offline:$resp"
    return
  fi

  if [ "$actual_qq" != "$expected_qq" ]; then
    echo "mismatch:$actual_qq"
    return
  fi

  echo "online"
}

check_online() {
  while true; do
    log_info "Checking QQ login status..."
    local failed=()

    for pair in "$BOT_HTTP:$BOT_QQ" "$USER_A_HTTP:$USER_A_QQ" "$USER_B_HTTP:$USER_B_QQ"; do
      local url="${pair%%:*}"
      local expected_qq="${pair##*:}"
      local status
      status=$(check_single_account "$url" "$expected_qq")

      case "$status" in
        online)
          log_info "Account $expected_qq is online."
          ;;
        mismatch:*)
          local actual_qq="${status#mismatch:}"
          log_warn "Account mismatch on $url: expected $expected_qq, got $actual_qq"
          ;;
        offline:*)
          local detail="${status#offline:}"
          if [ "$detail" = "no-response" ]; then
            log_err "Account $expected_qq: no response (offline or NapCat not ready)"
          else
            log_err "Account $expected_qq not logged in. Response: $detail"
          fi
          failed+=("$expected_qq")
          ;;
      esac
    done

    if [ ${#failed[@]} -eq 0 ]; then
      log_info "All accounts are online."
      return 0
    fi

    log_warn "Some accounts are offline: ${failed[*]}"
    log_info "Please open the WebUIs and scan the QR code to log in:"
    log_info "  Bot ($BOT_QQ):     http://127.0.0.1:6099/webui"
    log_info "  User-A ($USER_A_QQ):  http://127.0.0.1:6100/webui"
    log_info "  User-B ($USER_B_QQ):  http://127.0.0.1:6101/webui"
    log_info "Press Enter after you have logged in (or Ctrl+C to cancel)..."
    read -r
    log_info "Re-checking login status..."
  done
}

# ---------------------------------------------------------------------------
# 4. Cleanup stale health-check processes
# ---------------------------------------------------------------------------
cleanup_health_check() {
  log_info "Cleaning up stale health-check processes..."
  pkill -f "scripts/qq-health-check.ts" 2>/dev/null || true
  pkill -f "scripts/manual-e2e.ts" 2>/dev/null || true
  rm -f "$HEALTH_LOG" "$HEALTH_PID_FILE"
  sleep 1

  local leftover
  leftover=$(ps aux | grep -E 'qq-health-check|manual-e2e' | grep -v grep || true)
  if [ -n "$leftover" ]; then
    log_warn "Leftover processes still present:\n$leftover"
  else
    log_info "Cleanup done."
  fi
}

# ---------------------------------------------------------------------------
# 5. Start health check
# ---------------------------------------------------------------------------
start_health_check() {
  log_info "Starting health-check adapter..."
  cd "$PROJECT_DIR"
  pnpm e2e:health > "$HEALTH_LOG" 2>&1 &
  echo $! > "$HEALTH_PID_FILE"
  sleep 4

  if ! grep -q "OneBot WS connected" "$HEALTH_LOG" 2>/dev/null; then
    log_err "Health-check adapter did not connect. Last log lines:"
    tail -20 "$HEALTH_LOG" || true
    return 1
  fi
  log_info "Health-check adapter connected."
}

# ---------------------------------------------------------------------------
# 6. Send test messages and verify echo
# ---------------------------------------------------------------------------
send_private_ping() {
  log_info "Sending private ping from $USER_B_QQ to $BOT_QQ..."
  local resp
  resp=$(call_onebot "$USER_B_HTTP" "send_private_msg" "{\"user_id\":$BOT_QQ,\"message\":[{\"type\":\"text\",\"data\":{\"text\":\"ping\"}}]}")
  echo "  response: $resp"

  local retcode
  retcode=$(echo "$resp" | grep -oP '"retcode":\s*\K[0-9]+' || echo "unknown")
  if [ "$retcode" != "0" ]; then
    log_err "Private ping failed."
    return 1
  fi

  sleep 2
  if grep -q "Echo: ping" "$HEALTH_LOG" 2>/dev/null; then
    log_info "Private echo received."
    return 0
  fi
  log_err "Private echo not found in health log."
  tail -10 "$HEALTH_LOG" || true
  return 1
}

send_group_ping() {
  log_info "Sending group ping from $USER_B_QQ in group $GROUP_ID..."
  local resp
  resp=$(call_onebot "$USER_B_HTTP" "send_group_msg" "{\"group_id\":$GROUP_ID,\"message\":[{\"type\":\"at\",\"data\":{\"qq\":$BOT_QQ}},{\"type\":\"text\",\"data\":{\"text\":\" ping\"}}]}")
  echo "  response: $resp"

  local retcode
  retcode=$(echo "$resp" | grep -oP '"retcode":\s*\K[0-9]+' || echo "unknown")
  if [ "$retcode" != "0" ]; then
    log_err "Group ping failed."
    return 1
  fi

  sleep 2
  if grep -q "Echo:.*ping" "$HEALTH_LOG" 2>/dev/null; then
    log_info "Group echo received."
    return 0
  fi
  log_err "Group echo not found in health log."
  tail -10 "$HEALTH_LOG" || true
  return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  log_info "NanoClaw QQ debug check started."

  if ! check_containers; then exit 1; fi
  if ! check_ports; then exit 1; fi
  if ! check_online; then exit 1; fi

  cleanup_health_check
  if ! start_health_check; then exit 1; fi

  local roundtrip_ok=true
  send_private_ping || roundtrip_ok=false
  send_group_ping || roundtrip_ok=false

  if [ "$roundtrip_ok" = true ]; then
    log_info "All checks passed. You can now use qq-agent MCP or curl for functional tests."
    exit 0
  else
    log_err "Message roundtrip failed."
    exit 2
  fi
}

main "$@"
