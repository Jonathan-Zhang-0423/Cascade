import { spawn } from "child_process";
import { writeFile, mkdir, rm, readFile, readdir, stat, cp } from "fs/promises";
import { join, resolve, relative } from "path";
import { tmpdir } from "os";
import { createHash, randomBytes } from "crypto";
import { existsSync } from "fs";

const GRADLE_PATH = join(
  process.env.HOME || "/home/runner",
  ".gradle-sdk",
  "gradle-8.10",
  "bin",
  "gradle"
);
const TEMPLATE_DIR = resolve(process.cwd(), "server", "compile-templates", "kotlin-wasm");
const COMPILE_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

interface CompilationResult {
  success: boolean;
  buildId: string;
  errors?: string[];
  artifactPaths?: string[];
}

const artifactCache = new Map<
  string,
  { buildId: string; dir: string; createdAt: number }
>();
const BUILD_CACHE_MAX_AGE = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;
const MAX_CONCURRENT_COMPILES = 2;
const MAX_FILES_PER_REQUEST = 20;
const MAX_TOTAL_SOURCE_BYTES = 500_000;

let activeCompiles = 0;
const inflightCompiles = new Map<string, Promise<CompilationResult>>();

setInterval(() => {
  const now = Date.now();
  for (const [hash, entry] of artifactCache.entries()) {
    if (now - entry.createdAt > BUILD_CACHE_MAX_AGE) {
      rm(entry.dir, { recursive: true, force: true }).catch(() => {});
      artifactCache.delete(hash);
    }
  }
}, 60_000);

function hashSources(
  files: Array<{ path: string; content: string }>
): string {
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
  cwd: string
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
        JAVA_HOME:
          process.env.JAVA_HOME ||
          "/nix/store/zmj3m7wrgqf340vqd4v90w8dw371vhjg-openjdk-17.0.7+7",
        GRADLE_USER_HOME: join(
          process.env.HOME || "/home/runner",
          ".gradle"
        ),
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
        try {
          child.kill("SIGKILL");
        } catch {}
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
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 127,
        timedOut: false,
      });
    });
  });
}

function extractKotlinErrors(stderr: string): string[] {
  const lines = stderr.split("\n");
  const errors: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.includes("e: ") ||
      trimmed.includes("error:") ||
      trimmed.includes("Unresolved reference") ||
      trimmed.includes("FAILURE:")
    ) {
      errors.push(trimmed);
    }
  }
  if (errors.length === 0 && stderr.trim().length > 0) {
    const meaningful = lines
      .filter((l) => l.trim().length > 0)
      .slice(-10);
    errors.push(...meaningful);
  }
  return errors;
}

async function collectDir(
  dir: string,
  base: string
): Promise<Array<{ relativePath: string; absolutePath: string }>> {
  const results: Array<{ relativePath: string; absolutePath: string }> = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await collectDir(fullPath, base)));
      } else {
        results.push({
          relativePath: relative(base, fullPath),
          absolutePath: fullPath,
        });
      }
    }
  } catch {}
  return results;
}

export async function compileKotlinWasm(
  sourceFiles: Array<{ path: string; content: string }>
): Promise<CompilationResult> {
  if (sourceFiles.length > MAX_FILES_PER_REQUEST) {
    return {
      success: false,
      buildId: "validation-error",
      errors: [`Too many files (max ${MAX_FILES_PER_REQUEST})`],
    };
  }

  const totalBytes = sourceFiles.reduce((sum, f) => sum + f.content.length, 0);
  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
    return {
      success: false,
      buildId: "validation-error",
      errors: [`Total source size too large (max ${MAX_TOTAL_SOURCE_BYTES} bytes)`],
    };
  }

  const sourceHash = hashSources(sourceFiles);

  const cached = artifactCache.get(sourceHash);
  if (cached) {
    return {
      success: true,
      buildId: cached.buildId,
    };
  }

  const inflight = inflightCompiles.get(sourceHash);
  if (inflight) {
    return inflight;
  }

  if (activeCompiles >= MAX_CONCURRENT_COMPILES) {
    return {
      success: false,
      buildId: "queue-full",
      errors: ["Compiler is busy. Please try again in a moment."],
    };
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
  const buildId = `${sourceHash}-${randomBytes(4).toString("hex")}`;
  const workDir = join(tmpdir(), `kotlin-wasm-${buildId}`);

  try {
    await cp(TEMPLATE_DIR, workDir, { recursive: true });

    const kotlinSrcDir = join(workDir, "src", "wasmJsMain", "kotlin");
    await mkdir(kotlinSrcDir, { recursive: true });

    await writeFile(
      join(kotlinSrcDir, "Main.kt"),
      `import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.CanvasBasedWindow

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    CanvasBasedWindow(canvasElementId = "ComposeTarget") {
        App()
    }
}
`,
      "utf8"
    );

    for (const file of sourceFiles) {
      const fileName = file.path.split("/").pop() || "App.kt";
      const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      await writeFile(join(kotlinSrcDir, sanitizedName), file.content, "utf8");
    }

    if (!existsSync(GRADLE_PATH)) {
      return {
        success: false,
        buildId,
        errors: [
          "Gradle SDK not found. The Kotlin/Wasm compilation environment is not set up. Please ensure Gradle 8.10+ is installed.",
        ],
      };
    }

    const result = await spawnCompile(
      GRADLE_PATH,
      ["wasmJsBrowserDistribution", "--no-daemon", "--no-build-cache", "-q"],
      workDir
    );

    if (result.timedOut) {
      return {
        success: false,
        buildId,
        errors: ["Compilation timed out (max 3 minutes). Try simplifying your code."],
      };
    }

    if (result.exitCode !== 0) {
      const errors = extractKotlinErrors(result.stderr || result.stdout);
      return {
        success: false,
        buildId,
        errors:
          errors.length > 0
            ? errors
            : ["Compilation failed with exit code " + result.exitCode],
      };
    }

    const distDir = join(
      workDir,
      "build",
      "dist",
      "wasmJs",
      "productionExecutable"
    );
    const devDistDir = join(
      workDir,
      "build",
      "dist",
      "wasmJs",
      "developmentExecutable"
    );

    let artifactDir = distDir;
    if (!existsSync(distDir)) {
      if (existsSync(devDistDir)) {
        artifactDir = devDistDir;
      } else {
        const buildContents = await collectDir(
          join(workDir, "build"),
          join(workDir, "build")
        );
        return {
          success: false,
          buildId,
          errors: [
            "Build succeeded but output artifacts not found. Build contents: " +
              buildContents.map((f) => f.relativePath).join(", "),
          ],
        };
      }
    }

    const artifactOutputDir = join(tmpdir(), `kotlin-wasm-artifacts-${buildId}`);
    await cp(artifactDir, artifactOutputDir, { recursive: true });

    if (artifactCache.size >= MAX_CACHE_ENTRIES) {
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [hash, entry] of artifactCache.entries()) {
        if (entry.createdAt < oldestTime) {
          oldestTime = entry.createdAt;
          oldest = hash;
        }
      }
      if (oldest) {
        const old = artifactCache.get(oldest);
        if (old) rm(old.dir, { recursive: true, force: true }).catch(() => {});
        artifactCache.delete(oldest);
      }
    }

    artifactCache.set(sourceHash, {
      buildId,
      dir: artifactOutputDir,
      createdAt: Date.now(),
    });

    await rm(workDir, { recursive: true, force: true }).catch(() => {});

    return {
      success: true,
      buildId,
    };
  } catch (err: any) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    return {
      success: false,
      buildId,
      errors: [err?.message || "Unknown compilation error"],
    };
  } finally {
    activeCompiles--;
  }
}

export function getArtifactPath(buildId: string): string | null {
  for (const entry of artifactCache.values()) {
    if (entry.buildId === buildId) {
      return entry.dir;
    }
  }
  return null;
}

export function isCompilerAvailable(): boolean {
  return existsSync(GRADLE_PATH);
}
