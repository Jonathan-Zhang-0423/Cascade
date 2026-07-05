#!/usr/bin/env node
// Conservative production deployment helper for Cascade.
//
// Default behavior is intentionally non-destructive:
//   - validate Node/env/database connectivity
//   - install dependencies unless skipped
//   - build the app unless skipped
//
// Schema changes require --apply-schema. Existing databases are backed up
// before db:push unless --fresh-db or --skip-backup is provided.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..", "..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NODE = process.execPath;

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((a) => a.startsWith("--") && !a.includes("=")));
const kv = new Map(
  rawArgs
    .filter((a) => a.startsWith("--") && a.includes("="))
    .map((a) => {
      const eq = a.indexOf("=");
      return [a.slice(2, eq), a.slice(eq + 1)];
    }),
);

function has(flag) {
  return flags.has(`--${flag}`);
}

function value(name, fallback) {
  return kv.get(name) ?? fallback;
}

function usage() {
  console.log(`Cascade server deployment

Usage:
  npm run deploy:server -- [options]

Common:
  --apply-schema       Run backup + npm run db:push + verify.
  --fresh-db           Skip backup before schema push for an empty/new database.
  --skip-backup        Skip backup before schema push for a known-safe deployment.
  --verify             Run schema verification even without --apply-schema.
  --pm2=FILE           Start or reload PM2 with FILE after successful checks.

Skip steps:
  --skip-install       Do not run npm ci.
  --skip-build         Do not run npm run build.
  --skip-db            Skip database preflight and verification.
  --dry-run            Print the deployment plan without executing commands.

Environment:
  --env-file=.env      Load an env file before checks. Defaults to .env.
`);
}

if (has("help") || has("h")) {
  usage();
  process.exit(0);
}

const envFile = value("env-file", ".env");
const dryRun = has("dry-run");
const applySchema = has("apply-schema");
const skipDb = has("skip-db");
const runVerify = has("verify") || applySchema;
const pm2Config = value("pm2", "");

function parseDotenv(content) {
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function loadEnv() {
  const path = resolve(ROOT, envFile);
  if (!existsSync(path)) {
    console.error(`✗ Env file not found: ${path}`);
    process.exit(1);
  }
  const parsed = parseDotenv(readFileSync(path, "utf8"));
  for (const [key, val] of Object.entries(parsed)) {
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
  console.log(`✓ Loaded ${envFile}`);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`✓ ${message}`);
}

function warn(message) {
  console.warn(`! ${message}`);
}

function run(label, command, args) {
  console.log(`\n▸ ${label}`);
  console.log(`  $ ${[command, ...args].join(" ")}`);
  if (dryRun) return;
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  if (result.error) {
    console.error(`✗ ${label} failed: ${result.error.message}`);
    process.exit(result.status ?? 1);
  }
  if (result.status !== 0) {
    console.error(`✗ ${label} exited with ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function checkNode() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 20) fail(`Node ${process.versions.node} is too old; require Node 20+`);
  else ok(`Node ${process.versions.node}`);
}

function checkEnv() {
  let envFailed = false;
  const required = ["DATABASE_URL", "SESSION_SECRET", "DOUBAO_API_KEY"];
  for (const key of required) {
    if (!process.env[key]) {
      fail(`${key} is required for production deployment`);
      envFailed = true;
    }
  }

  const secret = process.env.SESSION_SECRET ?? "";
  if (secret === "dev-secret-change-me" || secret.length < 32) {
    fail("SESSION_SECRET must be a production-grade random string with at least 32 characters");
    envFailed = true;
  }

  if (process.env.NODE_ENV && process.env.NODE_ENV !== "production") {
    warn(`NODE_ENV is ${process.env.NODE_ENV}; PM2/start should run with NODE_ENV=production`);
  }

  if (process.env.GITHUB_CLIENT_ID && !process.env.GITHUB_CLIENT_SECRET) {
    warn("GITHUB_CLIENT_ID is set but GITHUB_CLIENT_SECRET is missing; GitHub OAuth will be disabled");
  }
  if (process.env.GITHUB_CLIENT_SECRET && !process.env.GITHUB_CLIENT_ID) {
    warn("GITHUB_CLIENT_SECRET is set but GITHUB_CLIENT_ID is missing; GitHub OAuth will be disabled");
  }
  if ((process.env.GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_SECRET) && !process.env.APP_BASE_URL) {
    warn("GitHub OAuth is configured without APP_BASE_URL; callback URL may be wrong behind a reverse proxy");
  }

  if (!process.env.ADMIN_JWT_SECRET || process.env.ADMIN_JWT_SECRET === "dev-admin-jwt-secret-change-me") {
    warn("ADMIN_JWT_SECRET is not set; admin auth will use an unsafe default");
  }
  if (!process.env.ADMIN_TOTP_ENCRYPTION_KEY || process.env.ADMIN_TOTP_ENCRYPTION_KEY.length < 64) {
    warn("ADMIN_TOTP_ENCRYPTION_KEY should be a 64-char hex AES key before enabling admin TOTP");
  }

  if (!envFailed) {
    ok("Required production env vars are present");
  }
}

function printPlan() {
  console.log("\nCascade deployment plan");
  console.log(`  env file:       ${envFile}`);
  console.log(`  install deps:   ${has("skip-install") ? "no" : "yes"}`);
  console.log(`  db preflight:   ${skipDb ? "no" : "yes"}`);
  console.log(`  apply schema:   ${applySchema ? "yes" : "no"}`);
  console.log(`  backup:         ${applySchema && !has("fresh-db") && !has("skip-backup") ? "yes" : "no"}`);
  console.log(`  verify schema:  ${!skipDb && runVerify ? "yes" : "no"}`);
  console.log(`  build:          ${has("skip-build") ? "no" : "yes"}`);
  console.log(`  pm2 reload:     ${pm2Config || "no"}`);
  if (!applySchema) {
    warn("Schema will not be changed. Add --apply-schema for first deploys or DB upgrades.");
  }
}

loadEnv();
checkNode();
checkEnv();
printPlan();

if (process.exitCode) {
  console.error("\nDeployment checks failed. Fix the issues above and rerun.");
  process.exit(process.exitCode);
}

if (!has("skip-install")) {
  run("Install dependencies", NPM, ["ci", "--legacy-peer-deps"]);
}

if (!skipDb) {
  run("Database preflight", NODE, ["scripts/db/preflight.mjs"]);
}

if (!skipDb && applySchema) {
  if (!has("fresh-db") && !has("skip-backup")) {
    run("Database backup", NODE, ["scripts/db/backup.mjs"]);
  }
  run("Apply database schema", NPM, ["run", "db:push"]);
}

if (!skipDb && runVerify) {
  run("Verify database schema", NODE, ["scripts/db/verify.mjs"]);
}

if (!has("skip-build")) {
  run("Build application", NPM, ["run", "build"]);
}

if (pm2Config) {
  run("PM2 start/reload", "pm2", ["startOrReload", pm2Config]);
}

console.log("\n✓ Deployment script completed.");
