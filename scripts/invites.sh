#!/usr/bin/env bash
# Cascade 邀请码管理脚本
#
# 用法:
#   ./scripts/invites.sh list               # 全部 waitlist + 已发邀请码
#   ./scripts/invites.sh pending            # 只看待邀请
#   ./scripts/invites.sh invited            # 只看已邀请
#   ./scripts/invites.sh send 12 13 14      # 给指定 subscriber id 发邀请码
#   ./scripts/invites.sh send-pending       # 给所有 pending 用户发（带确认）
#   ./scripts/invites.sh codes              # 列出所有已生成的邀请码（直连 DB）
#   ./scripts/invites.sh add-email <email>  # 把一个邮箱塞进 waitlist
#   ./scripts/invites.sh create <code> [days] [edu]
#                                           # 手工建一个绑定不到 subscriber 的码
#   ./scripts/invites.sh revoke <code>      # 删掉一个邀请码
#   ./scripts/invites.sh lookup <code>      # 查一个邀请码的状态
#
# 环境变量（按需，通常从项目根 .env 自动加载）:
#   ADMIN_SECRET   admin API 密钥（必填）
#   DATABASE_URL   Postgres 连接串（codes/create/revoke/lookup 子命令需要）
#   CASCADE_HOST   API 主机，默认 127.0.0.1
#   CASCADE_PORT   API 端口，默认 5000

set -euo pipefail

# 自动加载项目根 .env
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a; source "$PROJECT_ROOT/.env"; set +a
fi

HOST="${CASCADE_HOST:-127.0.0.1}"
PORT="${CASCADE_PORT:-5000}"
BASE="http://${HOST}:${PORT}"

# 颜色
if [[ -t 1 ]]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; B=$'\033[1m'; N=$'\033[0m'
else
  R=""; G=""; Y=""; C=""; B=""; N=""
fi

die() { echo "${R}error: $*${N}" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "需要 $1 但没装"; }
need_secret() {
  [[ -n "${ADMIN_SECRET:-}" ]] || die "ADMIN_SECRET 没设。在 .env 里加一行 ADMIN_SECRET=xxx"
}
need_db() {
  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL 没设。这个子命令要直连 DB"
  need psql
}

api_get() {
  need_secret; need curl
  curl -fsS -H "x-admin-secret: $ADMIN_SECRET" "$BASE$1" \
    || die "API 请求失败：$BASE$1（确认服务在 $HOST:$PORT 上跑着）"
}
api_post() {
  need_secret; need curl
  curl -fsS -X POST -H "x-admin-secret: $ADMIN_SECRET" \
    -H "Content-Type: application/json" \
    -d "$2" "$BASE$1" \
    || die "API 请求失败：$BASE$1"
}

# 用 jq 美化；没装就退化成原始 JSON
fmt_json() {
  if command -v jq >/dev/null 2>&1; then jq "$@"; else cat; fi
}

# 表格输出（用 jq + column）
print_table() {
  local filter="$1"
  if ! command -v jq >/dev/null 2>&1; then
    echo "${Y}建议安装 jq 以获得更好显示（scoop install jq）。当前输出原始 JSON：${N}" >&2
    api_get "/api/waitlist"
    echo
    return
  fi
  api_get "/api/waitlist" | jq -r "
    .subscribers $filter
    | (\"ID\tEMAIL\tTYPE\tSTATUS\tCODE\tEXPIRES\tCREATED\"),
      (.[] | [.id, .email, (if .isEdu then \"EDU\" else \"普通\" end),
              .status, (.inviteCode // \"-\"),
              (if .expiresAt then (.expiresAt | sub(\"T.*\";\"\")) else \"-\" end),
              (.createdAt | sub(\"T.*\";\"\"))]
            | @tsv)
  " | column -t -s $'\t'
}

cmd_list() {
  print_table ""
}
cmd_pending() {
  print_table "| map(select(.status == \"pending\"))"
}
cmd_invited() {
  print_table "| map(select(.status == \"invited\"))"
}

cmd_send() {
  [[ $# -gt 0 ]] || die "用法: send <id> [id ...]"
  # 校验都是数字，然后拼成 [1,2,3]
  local ids_json="["
  local first=1
  for id in "$@"; do
    [[ "$id" =~ ^[0-9]+$ ]] || die "ID 必须是数字: $id"
    if [[ $first -eq 1 ]]; then ids_json+="$id"; first=0
    else ids_json+=",$id"; fi
  done
  ids_json+="]"
  echo "${C}向 subscriber ID $* 发送邀请码...${N}"
  api_post "/api/admin/send-invites" "{\"ids\":$ids_json}" | fmt_json
}

cmd_send_pending() {
  need_secret; need curl
  echo "${C}拉取 pending 用户列表...${N}"
  local pending_json
  pending_json=$(api_get "/api/waitlist")
  local count
  count=$(echo "$pending_json" | jq '[.subscribers[] | select(.status == "pending")] | length')
  if [[ "$count" -eq 0 ]]; then
    echo "${G}没有 pending 用户${N}"; return
  fi
  echo "${Y}将向 $count 位 pending 用户发送邀请码：${N}"
  echo "$pending_json" | jq -r '.subscribers[] | select(.status == "pending") | "  - \(.id)\t\(.email)\t\(if .isEdu then "EDU" else "普通" end)"'
  read -rp "确认发送？[y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "已取消"; exit 0; }
  local ids
  ids=$(echo "$pending_json" | jq '[.subscribers[] | select(.status == "pending") | .id]')
  api_post "/api/admin/send-invites" "{\"ids\":$ids}" | fmt_json
}

cmd_add_email() {
  [[ $# -eq 1 ]] || die "用法: add-email <email>"
  need curl
  curl -fsS -X POST -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\"}" "$BASE/api/waitlist" | fmt_json
  echo
  echo "${G}已加入 waitlist。下一步可以 send-pending 或 list 找到这个 ID 单独发送${N}"
}

# === 直接操作 DB 的子命令 ===
cmd_codes() {
  need_db
  psql "$DATABASE_URL" -c "
    SELECT id, code, is_edu, trial_days,
           expires_at::date AS expires,
           CASE WHEN redeemed_by_user_id IS NULL THEN '未使用'
                ELSE '已使用 (' || redeemed_at::date || ')' END AS status,
           waitlist_subscriber_id AS sub_id
    FROM invite_codes
    ORDER BY id DESC;
  "
}

cmd_create() {
  [[ $# -ge 1 ]] || die "用法: create <code> [days=30] [edu=0]"
  need_db
  local code="$1"
  local days="${2:-30}"
  local edu="${3:-0}"
  local is_edu="false"
  [[ "$edu" == "1" || "$edu" == "edu" || "$edu" == "true" ]] && is_edu="true"

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
    INSERT INTO invite_codes (code, is_edu, trial_days, expires_at)
    VALUES ('$code', $is_edu, $days, NOW() + INTERVAL '$days days')
    RETURNING id, code, is_edu, trial_days, expires_at::date;
  "
  echo "${G}创建成功${N}"
}

cmd_revoke() {
  [[ $# -eq 1 ]] || die "用法: revoke <code>"
  need_db
  read -rp "确认删除邀请码 '$1'？[y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "已取消"; exit 0; }
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "DELETE FROM invite_codes WHERE code = '$1' RETURNING id, code;"
}

cmd_lookup() {
  [[ $# -eq 1 ]] || die "用法: lookup <code>"
  need_db
  psql "$DATABASE_URL" -c "
    SELECT id, code, is_edu, trial_days,
           created_at::timestamp(0) AS created,
           expires_at::timestamp(0) AS expires,
           redeemed_by_user_id AS redeemed_by,
           redeemed_at::timestamp(0) AS redeemed_at,
           waitlist_subscriber_id AS sub_id
    FROM invite_codes WHERE code = '$1';
  "
}

usage() {
  sed -n '2,21p' "$0" | sed 's|^# \?||'
  exit "${1:-0}"
}

CMD="${1:-help}"; shift || true
case "$CMD" in
  list)         cmd_list ;;
  pending)      cmd_pending ;;
  invited)      cmd_invited ;;
  send)         cmd_send "$@" ;;
  send-pending) cmd_send_pending ;;
  add-email)    cmd_add_email "$@" ;;
  codes)        cmd_codes ;;
  create)       cmd_create "$@" ;;
  revoke)       cmd_revoke "$@" ;;
  lookup)       cmd_lookup "$@" ;;
  help|-h|--help) usage 0 ;;
  *) echo "${R}未知命令: $CMD${N}"; usage 1 ;;
esac
