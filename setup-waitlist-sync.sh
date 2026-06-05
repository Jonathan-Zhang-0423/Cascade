#!/bin/bash
# ============================================================
#  CascadeAI Waitlist 自动同步脚本
#  作者：CascadeAI 工程团队
#  用途：将线上数据库 waitlist 数据每 5 分钟自动同步到本地 CSV
#
#  使用方法（只需执行一次）：
#    1. 打开终端 (Terminal)
#    2. cd 到本文件所在目录（桌面）：
#         cd ~/Desktop
#    3. 给脚本添加执行权限：
#         chmod +x setup-waitlist-sync.sh
#    4. 运行安装：
#         ./setup-waitlist-sync.sh
#
#  安装完成后，~/Desktop/waitlist.csv 每 5 分钟自动更新。
#  用 Excel 或 Numbers 打开该文件即可查看最新数据。
#  如需停止同步：crontab -e  然后删除含 waitlist 的那一行。
# ============================================================

# ── 配置区（根据实际情况修改这两项）──────────────────────────
ADMIN_SECRET="YOUR_ADMIN_SECRET_HERE"
BASE_URL="https://cascadeai.co"
# ─────────────────────────────────────────────────────────────

CSV_PATH="$HOME/Desktop/waitlist.csv"
LOG_PATH="$HOME/Desktop/waitlist-sync.log"
CRON_CMD="*/5 * * * * curl -sf -H 'x-admin-secret: ${ADMIN_SECRET}' '${BASE_URL}/api/admin/export-csv' -o '${CSV_PATH}' >> '${LOG_PATH}' 2>&1"

echo ""
echo "======================================"
echo "  CascadeAI Waitlist 同步配置"
echo "======================================"
echo ""

# 检查 curl 是否可用（Mac 自带，理论上一定有）
if ! command -v curl &> /dev/null; then
  echo "❌ 错误：未找到 curl，请先安装 Xcode Command Line Tools："
  echo "   xcode-select --install"
  exit 1
fi

# 检查配置是否已填写
if [ "$ADMIN_SECRET" = "YOUR_ADMIN_SECRET_HERE" ]; then
  echo "⚠️  请先用文本编辑器打开本脚本，把 ADMIN_SECRET 替换成实际的 Admin 密码，然后再运行。"
  exit 1
fi

# 立即执行一次，验证连接
echo "▶  正在测试连接 ${BASE_URL} ..."
HTTP_STATUS=$(curl -s -o "$CSV_PATH" -w "%{http_code}" \
  -H "x-admin-secret: ${ADMIN_SECRET}" \
  "${BASE_URL}/api/admin/export-csv")

if [ "$HTTP_STATUS" = "200" ]; then
  LINE_COUNT=$(wc -l < "$CSV_PATH" | tr -d ' ')
  echo "✅ 连接成功！已下载 waitlist.csv（共 $((LINE_COUNT - 1)) 条记录）"
  echo "   文件位置：$CSV_PATH"
elif [ "$HTTP_STATUS" = "401" ]; then
  echo "❌ 认证失败（401）：ADMIN_SECRET 不正确，请检查后重试。"
  exit 1
elif [ "$HTTP_STATUS" = "000" ]; then
  echo "❌ 无法连接到服务器，请检查网络或域名是否正确。"
  exit 1
else
  echo "❌ 服务器返回 HTTP $HTTP_STATUS，请联系工程团队。"
  exit 1
fi

# 注册 cron 任务（先去重，避免重复添加）
echo ""
echo "▶  正在注册定时任务（每 5 分钟同步一次）..."
(crontab -l 2>/dev/null | grep -v "export-csv"; echo "$CRON_CMD") | crontab -

echo "✅ 定时任务已注册！"
echo ""
echo "======================================"
echo "  配置完成 🎉"
echo "======================================"
echo ""
echo "  • CSV 文件：~/Desktop/waitlist.csv"
echo "  • 同步频率：每 5 分钟自动更新"
echo "  • 同步日志：~/Desktop/waitlist-sync.log"
echo ""
echo "  用 Excel 或 Numbers 打开 waitlist.csv 即可查看最新数据。"
echo "  Numbers 提示「文件已在外部修改」时点「好」即可刷新。"
echo ""
echo "  如需停止同步，运行："
echo "  crontab -e  →  删除含 export-csv 的那一行"
echo ""
