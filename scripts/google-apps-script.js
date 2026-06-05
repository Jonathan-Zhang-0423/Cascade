/**
 * CascadeAI Waitlist — Google Apps Script
 *
 * 安装步骤：
 *   1. 打开 Google Sheet → 顶部菜单 Extensions → Apps Script
 *   2. 把这整段代码粘贴进去，替换默认内容
 *   3. 修改下面两个常量：ADMIN_SECRET 和 BASE_URL
 *   4. 点 Save，然后点 Run → onOpen（第一次需要授权）
 *   5. 回到 Sheet，顶部会出现 "CascadeAI Admin" 菜单
 *   6. 点菜单 → "写回数据库" 即可将当前 Sheet 改动同步到数据库
 */

// ── 配置（必填）──────────────────────────────────────────────
var ADMIN_SECRET = "CascadeAdmin2026";
var BASE_URL = "https://cascadeai.co";
// ─────────────────────────────────────────────────────────────

// 列索引（0-based），需与服务器同步的列顺序一致
var COL_ID = 0;
var COL_STATUS_CONFIRM = 3;  // 是否发送确认邮件
var COL_STATUS_INVITE = 4;   // 是否发送邀请码

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("CascadeAI Admin")
    .addItem("写回数据库", "pushToDatabase")
    .addItem("立即从数据库刷新", "triggerServerSync")
    .addToUi();
}

/**
 * 读取 Sheet 当前所有行，把 id、是否发送确认邮件、是否发送邀请码
 * 打包发送到 /api/admin/sheet-update，写回数据库。
 */
function pushToDatabase() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Waitlist");
  if (!sheet) {
    SpreadsheetApp.getUi().alert("找不到名为 "Waitlist" 的 Sheet，请检查标签名。");
    return;
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    SpreadsheetApp.getUi().alert("Sheet 里没有数据行。");
    return;
  }

  var updates = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = parseInt(row[COL_ID], 10);
    if (!id || isNaN(id)) continue;

    updates.push({
      id: id,
      status: row[COL_STATUS_INVITE] === "是" ? "invited" : "pending",
      confirmationEmailSentAt: row[COL_STATUS_CONFIRM] === "是"
        ? new Date().toISOString()
        : null,
    });
  }

  if (updates.length === 0) {
    SpreadsheetApp.getUi().alert("没有找到有效的数据行（id 列为空？）");
    return;
  }

  var options = {
    method: "post",
    contentType: "application/json",
    headers: { "x-admin-secret": ADMIN_SECRET },
    payload: JSON.stringify({ updates: updates }),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(BASE_URL + "/api/admin/sheet-update", options);
  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code === 200) {
    var result = JSON.parse(body);
    SpreadsheetApp.getUi().alert("✅ 成功写回 " + result.changed + " 条记录到数据库。");
  } else {
    SpreadsheetApp.getUi().alert("❌ 写回失败（HTTP " + code + "）：" + body);
  }
}

/**
 * 触发服务器立即执行一次同步（强制刷新 Sheet 数据）。
 * 正常情况下服务器每分钟自动同步，这个函数用于手动触发。
 */
function triggerServerSync() {
  var options = {
    method: "post",
    contentType: "application/json",
    headers: { "x-admin-secret": ADMIN_SECRET },
    payload: "{}",
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(BASE_URL + "/api/admin/sync-sheets-now", options);
  var code = response.getResponseCode();

  if (code === 200) {
    SpreadsheetApp.getUi().alert("✅ 已触发服务器同步，稍等几秒刷新 Sheet 即可看到最新数据。");
  } else {
    SpreadsheetApp.getUi().alert("❌ 触发失败（HTTP " + code + "）");
  }
}
