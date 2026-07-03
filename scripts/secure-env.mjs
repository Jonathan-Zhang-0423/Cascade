// scripts/secure-env.mjs
//
// 用口令加密/解密任意文件（纯 Node crypto，无外部依赖，跨平台）。
// 算法：AES-256-CBC，密钥由 PBKDF2(SHA-256, 600000 轮) 从口令派生，
// 文件格式 = base64( salt(16) | iv(16) | ciphertext )。
//
// 用途：把 gen-dev-env.mjs 生成的 .env.dev.local 加密成 .env.dev.local.enc，
// 密文可走任意渠道（Slack/邮件），解密口令必须走带外（电话/Signal/当面）。
//
// 运行：
//   node scripts/secure-env.mjs encrypt .env.dev.local           # → .env.dev.local.enc
//   node scripts/secure-env.mjs decrypt .env.dev.local.enc       # → .env.dev.local
//   node scripts/secure-env.mjs decrypt .env.dev.local.enc -o .env   # 队友直接落到 .env
//
// 口令输入：优先环境变量 ENV_PASSPHRASE；否则在 TTY 下隐藏输入提示。
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import readline from "node:readline";
import { Writable } from "node:stream";

const ALGO = "aes-256-cbc";
const ITER = 600_000;
const SALT_LEN = 16;
const IV_LEN = 16;
const KEY_LEN = 32;

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      return reject(new Error("非交互终端：请用 ENV_PASSPHRASE=... 传口令"));
    }
    const muted = new Writable({ write(_d, _e, cb) { cb(); } });
    const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
    process.stdout.write(prompt);
    rl.question("", (ans) => { process.stdout.write("\n"); rl.close(); resolve(ans); });
  });
}

async function getPassphrase(confirm) {
  let pass = process.env.ENV_PASSPHRASE;
  if (pass) return pass;
  pass = await readHidden("口令: ");
  if (confirm) {
    const pass2 = await readHidden("再输一次: ");
    if (pass !== pass2) { console.error("✗ 两次口令不一致"); process.exit(1); }
  }
  if (pass.length < 8) { console.error("✗ 口令至少 8 位"); process.exit(1); }
  return pass;
}

function deriveKey(pass, salt) {
  return pbkdf2Sync(pass, salt, ITER, KEY_LEN, "sha256");
}

async function encrypt(inFile, outFile) {
  if (!existsSync(inFile)) { console.error(`✗ 找不到 ${inFile}`); process.exit(1); }
  outFile = outFile || (inFile + ".enc");
  const pass = await getPassphrase(true);
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(pass, salt);
  const cipher = createCipheriv(ALGO, key, iv);
  const plain = readFileSync(inFile);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const out = Buffer.concat([salt, iv, enc]).toString("base64");
  writeFileSync(outFile, out + "\n");
  console.log(`✓ 已加密 → ${outFile}`);
  console.log(`  解密命令（队友侧）：node scripts/secure-env.mjs decrypt ${outFile} -o .env`);
  console.log(`  口令请走带外渠道（电话/Signal/当面），勿与密文同渠道发送。`);
}

async function decrypt(inFile, outFile) {
  if (!existsSync(inFile)) { console.error(`✗ 找不到 ${inFile}`); process.exit(1); }
  outFile = outFile || inFile.replace(/\.enc$/, "");
  const pass = await getPassphrase(false);
  const blob = Buffer.from(readFileSync(inFile, "utf8").trim(), "base64");
  if (blob.length < SALT_LEN + IV_LEN) { console.error("✗ 密文格式不正确"); process.exit(1); }
  const salt = blob.subarray(0, SALT_LEN);
  const iv = blob.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const enc = blob.subarray(SALT_LEN + IV_LEN);
  const key = deriveKey(pass, salt);
  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
    writeFileSync(outFile, plain);
    console.log(`✓ 已解密 → ${outFile}`);
    console.log("  注意：.env 含真实凭据，按密钥处理，勿提交 Git、勿明文转发。");
  } catch {
    console.error("✗ 解密失败：口令错误或文件已损坏");
    process.exit(1);
  }
}

async function main() {
  const [mode, inFile, ...rest] = process.argv.slice(2);
  const oIdx = rest.indexOf("-o");
  // 仅在显式 -o 时覆盖输出名；否则交给 encrypt/decrypt 各自的默认值。
  const outFile = oIdx >= 0 ? rest[oIdx + 1] : undefined;

  if (mode === "encrypt") return encrypt(inFile, outFile);
  if (mode === "decrypt") return decrypt(inFile, outFile);
  console.error("用法：\n  node scripts/secure-env.mjs encrypt <file> [-o out]\n  node scripts/secure-env.mjs decrypt <file.enc> [-o out]");
  process.exit(2);
}

main();
