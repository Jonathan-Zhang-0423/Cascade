import { spawn } from "child_process";
import { writeFile, mkdir, rm, readdir, cp } from "fs/promises";
import { join, resolve, relative } from "path";
import { tmpdir } from "os";
import { createHash, randomBytes } from "crypto";
import { existsSync } from "fs";

// Flutter binary — can be overridden via env var
const FLUTTER_PATH = process.env.FLUTTER_PATH || "flutter";
const COMPILE_TIMEOUT_MS = 300_000; // 5 min — flutter build web can be slow cold
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

interface CompilationResult {
  success: boolean;
  buildId: string;
  errors?: string[];
}

const artifactCache = new Map<
  string,
  { buildId: string; dir: string; createdAt: number }
>();
const BUILD_CACHE_MAX_AGE = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 20; // Flutter artifacts are large (~10MB each)
const MAX_CONCURRENT_COMPILES = 1; // Flutter builds are heavy
const MAX_FILES_PER_REQUEST = 50;
const MAX_TOTAL_SOURCE_BYTES = 1_000_000;

let activeCompiles = 0;
const inflightCompiles = new Map<string, Promise<CompilationResult>>();

// Persistent pub cache dir so packages aren't re-downloaded each compile
const PUB_CACHE_DIR = join(tmpdir(), "flutter-pub-cache");

setInterval(() => {
  const now = Date.now();
  for (const [hash, entry] of artifactCache.entries()) {
    if (now - entry.createdAt > BUILD_CACHE_MAX_AGE) {
      rm(entry.dir, { recursive: true, force: true }).catch(() => {});
      artifactCache.delete(hash);
    }
  }
}, 60_000);

function hashSources(files: Array<{ path: string; content: string }>): string {
  const h = createHash("sha256");
  for (const f of files.sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path);
    h.update(f.content);
  }
  return h.digest("hex").slice(0, 16);
}

function spawnCompile(
  cmd: string,
  args: string[],
  cwd: string,
  extraEnv?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let totalBytes = 0;

    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PUB_CACHE: PUB_CACHE_DIR,
        ...extraEnv,
      },
    });

    const accumulate = (chunks: Buffer[], d: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - totalBytes;
      if (remaining <= 0) return;
      const slice = remaining < d.length ? d.subarray(0, remaining) : d;
      chunks.push(slice);
      totalBytes += slice.length;
    };

    child.stdout?.on("data", (d: Buffer) => accumulate(outChunks, d));
    child.stderr?.on("data", (d: Buffer) => accumulate(errChunks, d));

    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        try { child.kill("SIGKILL"); } catch {}
      }
    }, COMPILE_TIMEOUT_MS);

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
        exitCode: code,
        timedOut,
      });
    };

    child.on("close", (code) => finish(code ?? 1));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: "", stderr: err.message, exitCode: 127, timedOut: false });
    });
  });
}

function extractFlutterErrors(stderr: string, stdout: string): string[] {
  const combined = stderr + "\n" + stdout;
  const lines = combined.split("\n");
  const errors: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (
      t.startsWith("Error:") ||
      t.startsWith("error:") ||
      t.includes(": error:") ||
      t.includes("Compiler message:") ||
      t.includes("FAILURE:") ||
      t.includes("Exception:") ||
      (t.startsWith("lib/") && t.includes(":"))
    ) {
      errors.push(t);
    }
  }
  if (errors.length === 0 && combined.trim().length > 0) {
    errors.push(...lines.filter((l) => l.trim().length > 0).slice(-15));
  }
  return errors.slice(0, 30);
}

async function collectDir(dir: string, base: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) results.push(...(await collectDir(full, base)));
      else results.push(relative(base, full));
    }
  } catch {}
  return results;
}

export async function compileFlutterWeb(
  sourceFiles: Array<{ path: string; content: string }>
): Promise<CompilationResult> {
  if (sourceFiles.length > MAX_FILES_PER_REQUEST) {
    return { success: false, buildId: "validation-error", errors: [`Too many files (max ${MAX_FILES_PER_REQUEST})`] };
  }
  const totalBytes = sourceFiles.reduce((s, f) => s + f.content.length, 0);
  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
    return { success: false, buildId: "validation-error", errors: [`Source too large (max ${MAX_TOTAL_SOURCE_BYTES} bytes)`] };
  }

  const sourceHash = hashSources(sourceFiles);

  const cached = artifactCache.get(sourceHash);
  if (cached) return { success: true, buildId: cached.buildId };

  const inflight = inflightCompiles.get(sourceHash);
  if (inflight) return inflight;

  if (activeCompiles >= MAX_CONCURRENT_COMPILES) {
    return { success: false, buildId: "queue-full", errors: ["Flutter compiler is busy. Please try again in a moment."] };
  }

  const compilePromise = doCompile(sourceFiles, sourceHash);
  inflightCompiles.set(sourceHash, compilePromise);
  try {
    return await compilePromise;
  } finally {
    inflightCompiles.delete(sourceHash);
  }
}

async function doCompile(
  sourceFiles: Array<{ path: string; content: string }>,
  sourceHash: string
): Promise<CompilationResult> {
  activeCompiles++;
  const buildId = `flutter-${sourceHash}-${randomBytes(4).toString("hex")}`;
  const workDir = join(tmpdir(), `flutter-build-${buildId}`);

  try {
    await mkdir(workDir, { recursive: true });
    await mkdir(PUB_CACHE_DIR, { recursive: true });

    // Write source files — strip the /project/ prefix
    for (const f of sourceFiles) {
      const relPath = f.path.replace(/^\/project\//, "");
      if (!relPath) continue;
      const dest = join(workDir, relPath);
      await mkdir(join(dest, ".."), { recursive: true });
      await writeFile(dest, f.content, "utf8");
    }

    // Ensure pubspec.yaml exists — generate a minimal one if not provided
    const pubspecPath = join(workDir, "pubspec.yaml");
    if (!existsSync(pubspecPath)) {
      await writeFile(pubspecPath, MINIMAL_PUBSPEC, "utf8");
    }

    // Ensure lib/main.dart exists
    const mainDartPath = join(workDir, "lib", "main.dart");
    if (!existsSync(mainDartPath)) {
      await mkdir(join(workDir, "lib"), { recursive: true });
      await writeFile(mainDartPath, MINIMAL_MAIN_DART, "utf8");
    }

    // flutter pub get
    const pubGet = await spawnCompile(FLUTTER_PATH, ["pub", "get", "--no-example"], workDir);
    if (pubGet.exitCode !== 0) {
      return {
        success: false,
        buildId,
        errors: extractFlutterErrors(pubGet.stderr, pubGet.stdout),
      };
    }

    // flutter build web --release
    const build = await spawnCompile(
      FLUTTER_PATH,
      ["build", "web", "--release", "--no-tree-shake-icons"],
      workDir
    );

    if (build.timedOut) {
      return { success: false, buildId, errors: ["Flutter build timed out (max 5 minutes)."] };
    }

    if (build.exitCode !== 0) {
      return {
        success: false,
        buildId,
        errors: extractFlutterErrors(build.stderr, build.stdout),
      };
    }

    const buildWebDir = join(workDir, "build", "web");
    if (!existsSync(buildWebDir)) {
      const contents = await collectDir(join(workDir, "build"), join(workDir, "build"));
      return {
        success: false,
        buildId,
        errors: ["Build succeeded but web output not found. Contents: " + contents.join(", ")],
      };
    }

    const artifactOutputDir = join(tmpdir(), `flutter-artifacts-${buildId}`);
    await cp(buildWebDir, artifactOutputDir, { recursive: true });

    // Evict oldest if at capacity
    if (artifactCache.size >= MAX_CACHE_ENTRIES) {
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [hash, entry] of artifactCache.entries()) {
        if (entry.createdAt < oldestTime) { oldestTime = entry.createdAt; oldest = hash; }
      }
      if (oldest) {
        const old = artifactCache.get(oldest);
        if (old) rm(old.dir, { recursive: true, force: true }).catch(() => {});
        artifactCache.delete(oldest);
      }
    }

    artifactCache.set(sourceHash, { buildId, dir: artifactOutputDir, createdAt: Date.now() });
    await rm(workDir, { recursive: true, force: true }).catch(() => {});

    return { success: true, buildId };
  } catch (err: any) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    return { success: false, buildId, errors: [err?.message || "Unknown compilation error"] };
  } finally {
    activeCompiles--;
  }
}

export function getFlutterArtifactPath(buildId: string): string | null {
  for (const entry of artifactCache.values()) {
    if (entry.buildId === buildId) return entry.dir;
  }
  return null;
}

let flutterAvailable: boolean | null = null;

export function isFlutterAvailable(): boolean {
  if (flutterAvailable !== null) return flutterAvailable;
  try {
    const { execFileSync } = require("child_process");
    execFileSync(FLUTTER_PATH, ["--version"], { timeout: 10_000, stdio: "ignore" });
    flutterAvailable = true;
  } catch {
    flutterAvailable = false;
  }
  return flutterAvailable;
}

export function checkFlutterOnStartup(): void {
  if (isFlutterAvailable()) {
    console.log(`[flutter] Flutter SDK available at: ${FLUTTER_PATH}`);
  } else {
    console.warn(
      `[flutter] WARNING: Flutter not found at "${FLUTTER_PATH}". ` +
        `Flutter web preview will be unavailable. Install Flutter SDK and ensure it's in PATH, ` +
        `or set FLUTTER_PATH env var.`
    );
  }
}

const MINIMAL_PUBSPEC = `name: cascade_preview
description: Cascade AI Flutter Preview
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8

flutter:
  uses-material-design: true
`;

const MINIMAL_MAIN_DART = `import 'package:flutter/material.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Center(
          child: Text('Hello, Flutter!', style: TextStyle(fontSize: 24)),
        ),
      ),
    );
  }
}
`;
