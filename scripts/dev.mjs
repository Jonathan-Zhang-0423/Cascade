#!/usr/bin/env node
// scripts/dev.mjs
// Idempotent dev environment bootstrap. Runs the precondition checks the
// project actually needs (deps, .env, db schema) and optionally launches
// `npm run dev` afterwards. Safe to invoke repeatedly — work is skipped
// when nothing has changed.

import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));
const CACHE_DIR = join(ROOT, ".cache");
const DB_PUSH_MARKER = join(CACHE_DIR, "last-db-push");
const SCHEMA_DIR = join(ROOT, "database", "schema");

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => console.log(`  ${c("32", "✓")} ${s}`);
const skip = (s) => console.log(`  ${c("90", "○")} ${s}`);
const warn = (s) => console.log(`  ${c("33", "!")} ${s}`);
const fail = (s) => console.log(`  ${c("31", "✗")} ${s}`);
const step = (s) => console.log(`\n${c("36;1", `▸ ${s}`)}`);

// On Windows, npm is npm.cmd. Use the platform-specific binary so we can
// avoid `shell: true` (which Node 24 deprecates when also passing args).
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const REQUIRED_ENV = ["DATABASE_URL", "DOUBAO_API_KEY"];
const OPTIONAL_ENV = [
  "KIMI_API_KEY",
  "MINIMAX_API_KEY",
  "GLM_API_KEY",
  "DEEPSEEK_API_KEY",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "APP_BASE_URL",
  "HTTPS_PROXY",
  "PORT",
  "ENABLE_SHELL",
];

const args = new Set(process.argv.slice(2));
const SETUP_ONLY = args.has("--setup-only");
const SKIP_DB = args.has("--skip-db");
const SKIP_DEPS = args.has("--skip-deps");
const FORCE_DB = args.has("--force-db");

let hadFailure = false;

function checkNode() {
  step("Node version");
  const v = process.versions.node.split(".").map(Number);
  const major = v[0];
  if (major < 20) {
    fail(`Node ${process.versions.node} — need >= 20`);
    hadFailure = true;
    return;
  }
  ok(`Node ${process.versions.node}`);
}

function parseDotenv(content) {
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function loadEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return null;
  return parseDotenv(readFileSync(envPath, "utf8"));
}

function checkEnv() {
  step("Environment (.env)");
  const envPath = join(ROOT, ".env");
  const examplePath = join(ROOT, ".env.example");
  if (!existsSync(envPath)) {
    if (existsSync(examplePath)) {
      copyFileSync(examplePath, envPath);
      warn(`No .env found — copied .env.example → .env. Fill in values before continuing.`);
    } else {
      fail(`No .env and no .env.example to copy from. Create one with: ${REQUIRED_ENV.join(", ")}`);
    }
    hadFailure = true;
    return;
  }
  const env = parseDotenv(readFileSync(envPath, "utf8"));
  const missing = REQUIRED_ENV.filter((k) => !env[k]);
  if (missing.length > 0) {
    fail(`.env missing required keys: ${missing.join(", ")}`);
    hadFailure = true;
    return;
  }
  ok(`.env has ${REQUIRED_ENV.length} required keys`);
  const optionalSet = OPTIONAL_ENV.filter((k) => env[k]);
  if (optionalSet.length > 0) skip(`optional keys set: ${optionalSet.join(", ")}`);
}

function fileMtime(p) {
  try { return statSync(p).mtimeMs; } catch { return 0; }
}

function checkDeps() {
  step("Dependencies");
  if (SKIP_DEPS) { skip("--skip-deps passed"); return; }
  const lock = join(ROOT, "package-lock.json");
  const installedMarker = join(ROOT, "node_modules", ".package-lock.json");
  if (!existsSync(lock)) { warn("no package-lock.json"); return; }
  // Only compare lockfile vs installed marker. Edits to package.json that
  // touch only `scripts` should not force a reinstall.
  const lockMtime = fileMtime(lock);
  const installedMtime = fileMtime(installedMarker);
  if (installedMtime > 0 && installedMtime >= lockMtime) {
    skip("node_modules up to date");
    return;
  }
  console.log(`  ${c("36", "→")} running npm install...`);
  // The repo has known peer-dep conflicts (react-native expects react 19,
  // app uses react 18). Use --legacy-peer-deps to match how the lockfile
  // was generated. shell:true with a single string command avoids both
  // the Node 24 EINVAL on Windows .cmd spawning and the DEP0190 warning
  // about un-escaped args.
  const r = spawnSync(`${NPM} install --legacy-peer-deps`, { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) { fail(`npm install exited ${r.status}`); hadFailure = true; return; }
  ok("dependencies installed");
}

function latestSchemaMtime() {
  if (!existsSync(SCHEMA_DIR)) return 0;
  let max = 0;
  for (const name of readdirSync(SCHEMA_DIR)) {
    if (!name.endsWith(".ts")) continue;
    max = Math.max(max, fileMtime(join(SCHEMA_DIR, name)));
  }
  return max;
}

function checkDbSchema() {
  step("DB schema");
  if (SKIP_DB) { skip("--skip-db passed"); return; }
  const env = loadEnv();
  if (!env?.DATABASE_URL) { skip("DATABASE_URL not set, skipping db:push"); return; }
  const schemaMtime = latestSchemaMtime();
  if (schemaMtime === 0) { skip("no schema files found"); return; }
  const lastPush = fileMtime(DB_PUSH_MARKER);
  if (!FORCE_DB && lastPush > 0 && lastPush >= schemaMtime) {
    skip(`schema unchanged since last push (${new Date(lastPush).toISOString()})`);
    return;
  }
  if (FORCE_DB) console.log(`  ${c("36", "→")} --force-db passed`);
  else console.log(`  ${c("36", "→")} schema files newer than last push, running db:push...`);
  const r = spawnSync(`${NPM} run db:push`, { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) { fail(`db:push exited ${r.status}`); hadFailure = true; return; }
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(DB_PUSH_MARKER, new Date().toISOString() + "\n");
  ok("db:push complete");
}

async function main() {
  console.log(c("1", "Cascade dev bootstrap"));
  checkNode();
  checkEnv();
  checkDeps();
  checkDbSchema();
  if (hadFailure) {
    console.log(`\n${c("31;1", "Setup failed.")} Fix the issues above and re-run.`);
    process.exit(1);
  }
  console.log(`\n${c("32;1", "Setup complete.")}`);
  if (SETUP_ONLY) return;
  console.log(c("36;1", "▸ Starting dev server\n"));
  // Spawn tsx directly via node so we don't go through npm.cmd. This
  // avoids both Node 24's EINVAL on Windows .cmd files and the DEP0190
  // warning about shell:true + args. Mirrors `npm run dev`.
  const tsxEntry = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsxEntry, "backend/api/src/infra/index.ts"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });
  const forward = (sig) => () => { try { child.kill(sig); } catch {} };
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => { fail(String(e?.stack ?? e)); process.exit(1); });
