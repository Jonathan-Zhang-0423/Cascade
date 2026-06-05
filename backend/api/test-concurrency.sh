#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Multi-project isolation & concurrency smoke test
#
# Prerequisites:
#   - Backend running on localhost:5000 (or set BASE_URL)
#   - At least one AI provider key configured
#   - Two project IDs (or the script creates them)
#
# Usage:
#   chmod +x test-concurrency.sh
#   ./test-concurrency.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5000}"
COOKIE_JAR="/tmp/cascade-test-cookies.txt"

echo "═══════════════════════════════════════════════════════════"
echo "  Cascade Multi-Project Isolation & Concurrency Test"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Base URL: $BASE_URL"
echo ""

# ─── Helper functions ────────────────────────────────────────────────────────

api() {
  local method="$1" path="$2"
  shift 2
  curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -X "$method" "$BASE_URL$path" \
    -H "Content-Type: application/json" \
    "$@"
}

check_ok() {
  local label="$1" response="$2"
  if echo "$response" | grep -q '"error"'; then
    echo "  ✗ $label — FAILED: $(echo "$response" | head -c 200)"
    return 1
  else
    echo "  ✓ $label"
    return 0
  fi
}

# ─── Test 1: Concurrency endpoint ───────────────────────────────────────────

echo "─── Test 1: Concurrency metrics endpoint ───"
METRICS=$(api GET /api/concurrency)
if echo "$METRICS" | grep -q '"aiCalls"'; then
  echo "  ✓ /api/concurrency returns metrics"
  echo "    $(echo "$METRICS" | python3 -m json.tool 2>/dev/null || echo "$METRICS")"
else
  echo "  ✗ /api/concurrency failed: $METRICS"
fi
echo ""

# ─── Test 2: Create two projects ────────────────────────────────────────────

echo "─── Test 2: Create two isolated projects ───"
PROJECT_A_ID="test-proj-a-$(date +%s)"
PROJECT_B_ID="test-proj-b-$(date +%s)"

RESP_A=$(api POST /api/projects -d "{\"id\":\"$PROJECT_A_ID\",\"name\":\"Test Project A\",\"framework\":\"web\"}")
check_ok "Create project A ($PROJECT_A_ID)" "$RESP_A"

RESP_B=$(api POST /api/projects -d "{\"id\":\"$PROJECT_B_ID\",\"name\":\"Test Project B\",\"framework\":\"web\"}")
check_ok "Create project B ($PROJECT_B_ID)" "$RESP_B"
echo ""

# ─── Test 3: Messages isolation ─────────────────────────────────────────────

echo "─── Test 3: Message storage isolation ───"

# Write a message to project A
MSG_A=$(api POST "/api/projects/$PROJECT_A_ID/messages" -d '{
  "messages": [{
    "clientId": "msg-a-1",
    "kind": "manager",
    "role": "user",
    "content": "Build me a racing game",
    "seq": 1,
    "timestamp": 1700000000000
  }]
}')
check_ok "Write message to project A" "$MSG_A"

# Write a message to project B
MSG_B=$(api POST "/api/projects/$PROJECT_B_ID/messages" -d '{
  "messages": [{
    "clientId": "msg-b-1",
    "kind": "manager",
    "role": "user",
    "content": "Build me a 2048 game",
    "seq": 1,
    "timestamp": 1700000000000
  }]
}')
check_ok "Write message to project B" "$MSG_B"

# Read project A messages — should NOT contain "2048"
MSGS_A=$(api GET "/api/projects/$PROJECT_A_ID/messages?kind=manager")
if echo "$MSGS_A" | grep -q "2048"; then
  echo "  ✗ Project A messages contain '2048' — ISOLATION FAILURE"
else
  echo "  ✓ Project A messages do NOT contain project B content"
fi

# Read project B messages — should NOT contain "racing"
MSGS_B=$(api GET "/api/projects/$PROJECT_B_ID/messages?kind=manager")
if echo "$MSGS_B" | grep -q "racing"; then
  echo "  ✗ Project B messages contain 'racing' — ISOLATION FAILURE"
else
  echo "  ✓ Project B messages do NOT contain project A content"
fi
echo ""

# ─── Test 4: Per-user session limit ─────────────────────────────────────────

echo "─── Test 4: Per-user session limit (requires MAX_SESSIONS_PER_USER=2 for fast test) ───"
echo "  (Skipped in automated mode — requires real AI provider calls)"
echo "  Manual test: start 6+ build sessions with same userId, verify 429 on 6th"
echo ""

# ─── Test 5: Concurrent manager-chat sessions ───────────────────────────────

echo "─── Test 5: Concurrent manager sessions for different projects ───"

# Start two manager sessions in parallel
start_manager() {
  local project_id="$1" message="$2" label="$3"
  local resp
  resp=$(api POST /api/manager-chat -d "{
    \"messages\": [{\"role\": \"user\", \"content\": \"$message\"}],
    \"projectId\": \"$project_id\",
    \"files\": []
  }" --max-time 10 -o /dev/null -w "%{http_code}")
  if [ "$resp" = "200" ]; then
    echo "  ✓ $label — started (HTTP 200 SSE)"
  else
    echo "  ✗ $label — HTTP $resp"
  fi
}

start_manager "$PROJECT_A_ID" "Hello from A" "Manager A" &
PID_A=$!
start_manager "$PROJECT_B_ID" "Hello from B" "Manager B" &
PID_B=$!

wait $PID_A 2>/dev/null || true
wait $PID_B 2>/dev/null || true
echo ""

# ─── Test 6: Active session endpoints ───────────────────────────────────────

echo "─── Test 6: Active session endpoint isolation ───"
ACTIVE_A=$(api GET "/api/manager-chat/active/$PROJECT_A_ID")
ACTIVE_B=$(api GET "/api/manager-chat/active/$PROJECT_B_ID")

# Both should either have a session or 404 — but never the other project's session
if echo "$ACTIVE_A" | grep -q "$PROJECT_B_ID"; then
  echo "  ✗ Project A's active session references project B — ISOLATION FAILURE"
else
  echo "  ✓ Active session endpoint correctly scoped to project A"
fi
if echo "$ACTIVE_B" | grep -q "$PROJECT_A_ID"; then
  echo "  ✗ Project B's active session references project A — ISOLATION FAILURE"
else
  echo "  ✓ Active session endpoint correctly scoped to project B"
fi
echo ""

# ─── Cleanup ────────────────────────────────────────────────────────────────

echo "─── Cleanup ───"
api DELETE "/api/projects/$PROJECT_A_ID" > /dev/null 2>&1 || true
api DELETE "/api/projects/$PROJECT_B_ID" > /dev/null 2>&1 || true
rm -f "$COOKIE_JAR"
echo "  ✓ Test projects deleted"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  All tests complete"
echo "═══════════════════════════════════════════════════════════"
