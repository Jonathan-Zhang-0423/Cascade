#!/usr/bin/env npx tsx
/**
 * 创建初始管理员账户
 *
 * 用法: npx tsx scripts/create-admin.ts --username <用户名> --password <密码>
 *
 * 安全限制: 仅当 admin_users 表为空时允许创建（防止被滥用）
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { adminUsers } from "../database/schema/admin-users";
import { count } from "drizzle-orm";

const { Pool } = pg;

function parseArgs(): { username: string; password: string } {
  const args = process.argv.slice(2);
  let username = "";
  let password = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--username" && args[i + 1]) {
      username = args[++i];
    } else if (args[i] === "--password" && args[i + 1]) {
      password = args[++i];
    }
  }

  if (!username || !password) {
    console.error("用法: npx tsx scripts/create-admin.ts --username <用户名> --password <密码>");
    console.error("");
    console.error("选项:");
    console.error("  --username  管理员用户名 (必填)");
    console.error("  --password  管理员密码 (必填, 建议12位以上)");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("❌ 密码至少需要 8 位");
    process.exit(1);
  }

  if (username.length < 3 || username.length > 64) {
    console.error("❌ 用户名长度需要在 3-64 位之间");
    process.exit(1);
  }

  return { username, password };
}

async function main() {
  const { username, password } = parseArgs();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const db = drizzle(pool);

  try {
    // Safety check: only allow creation if no admin users exist
    const [result] = await db.select({ total: count() }).from(adminUsers);
    if (result && result.total > 0) {
      console.error("❌ admin_users 表中已存在管理员账户");
      console.error("   如需添加新管理员，请使用现有管理员账户操作");
      process.exit(1);
    }

    // Hash password with bcrypt (salt rounds = 12, higher than user passwords)
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert admin user
    const [newAdmin] = await db.insert(adminUsers).values({
      username,
      passwordHash,
      role: "super_admin",
      isActive: true,
    }).returning({ id: adminUsers.id, username: adminUsers.username });

    console.log("");
    console.log("✅ 管理员账户创建成功!");
    console.log("");
    console.log(`   ID:       ${newAdmin.id}`);
    console.log(`   用户名:   ${newAdmin.username}`);
    console.log(`   角色:     super_admin`);
    console.log(`   TOTP:     未启用 (首次登录后设置)`);
    console.log("");
    console.log("📋 下一步:");
    console.log("   1. 重启服务器使新的认证系统生效");
    console.log("   2. 访问 admin.cascadeai.cn/admin/login 登录");
    console.log("   3. 首次登录后会自动进入 TOTP 绑定页面");
    console.log("   4. 使用 Google Authenticator 扫描二维码完成绑定");
    console.log("");
  } catch (err: any) {
    if (err.code === "23505") {
      console.error(`❌ 用户名 "${username}" 已存在`);
    } else {
      console.error("❌ 创建失败:", err.message);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
