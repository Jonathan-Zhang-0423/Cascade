// scripts/db/backup.mjs
//
// 升级前快照：调用 pg_dump 生成带时间戳的自定义格式备份到 backups/。
// 自定义格式（-Fc）便于用 pg_restore 选择性恢复。
//
// 依赖：部署机已安装 PostgreSQL 客户端（pg_dump 在 PATH 中），版本应 >= 服务端。
// 运行：cd Cascade && node --env-file=.env scripts/db/backup.mjs
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL 未设置");
  process.exit(1);
}

// backups/ 位于 Cascade 根目录（scripts/db 的上两级）
const here = path.dirname(fileURLToPath(import.meta.url));
const backupDir = path.resolve(here, "../../backups");
if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true });
}

// 文件名：cascade-YYYYMMDD-HHMMSS.dump
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const outFile = path.join(backupDir, `cascade-${stamp}.dump`);

console.log(`正在备份到 ${outFile} ...`);

// 用 --dbname 传连接串，避免把密码暴露在单独参数里。
const args = ["--dbname", DATABASE_URL, "-Fc", "--no-owner", "--no-acl", "-f", outFile];

const child = spawn("pg_dump", args, { stdio: ["ignore", "inherit", "inherit"] });

child.on("error", (e) => {
  if (e.code === "ENOENT") {
    console.error(
      "✗ 找不到 pg_dump。请安装 PostgreSQL 客户端（如 apt-get install postgresql-client）。",
    );
  } else {
    console.error(`✗ 备份失败：${e.message}`);
  }
  process.exit(1);
});

child.on("exit", (code) => {
  if (code === 0) {
    console.log(`✓ 备份完成：${outFile}`);
    console.log("  恢复示例：pg_restore --clean --if-exists --no-owner -d \"$DATABASE_URL\" " + outFile);
  } else {
    console.error(`✗ pg_dump 退出码 ${code}`);
    process.exit(code ?? 1);
  }
});
