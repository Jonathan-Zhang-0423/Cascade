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
const TEMPLATE_DIR = resolve(process.cwd(), "backend", "api", "src", "compiler", "compile-templates", "kotlin-wasm");
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

const ANDROID_IMPORT_RE = /^import\s+(android\.|androidx\.activity|androidx\.appcompat|androidx\.core\.os|com\.google\.android).*$/gm;
const ANDROID_CLASS_RE = /class\s+\w+\s*:\s*(ComponentActivity|AppCompatActivity|Activity|Fragment|Service|BroadcastReceiver)\s*\(\s*\)\s*\{/;

function transformForWasm(source: string): string {
  let code = source;
  code = code.replace(/^package\s+[\w.]+\s*$/gm, "");
  code = code.replace(ANDROID_IMPORT_RE, "");

  if (ANDROID_CLASS_RE.test(code)) {
    const composableBlocks: string[] = [];
    const composableRe = /@Composable\s+(?:fun\s+\w+\s*\([^)]*\)\s*\{)/g;
    let match;
    while ((match = composableRe.exec(code)) !== null) {
      const start = match.index;
      let depth = 0;
      let end = start;
      let foundBrace = false;
      for (let i = start; i < code.length; i++) {
        if (code[i] === "{") { depth++; foundBrace = true; }
        if (code[i] === "}") { depth--; }
        if (foundBrace && depth === 0) { end = i + 1; break; }
      }
      composableBlocks.push(code.slice(start, end));
    }

    if (composableBlocks.length === 0) {
      const setContentRe = /setContent\s*\{/;
      const setContentMatch = setContentRe.exec(code);
      if (setContentMatch) {
        const start = setContentMatch.index + setContentMatch[0].length;
        let depth = 1;
        let end = start;
        for (let i = start; i < code.length && depth > 0; i++) {
          if (code[i] === "{") depth++;
          if (code[i] === "}") depth--;
          if (depth === 0) { end = i; break; }
        }
        const body = code.slice(start, end).trim();
        composableBlocks.push(`@Composable\nfun App() {\n    ${body}\n}`);
      }
    }

    if (composableBlocks.length === 0) return "";

    const hasApp = composableBlocks.some((b) => /fun\s+App\s*\(/.test(b));
    if (!hasApp) {
      const firstName = composableBlocks[0].match(/fun\s+(\w+)/)?.[1];
      if (firstName) {
        composableBlocks.push(`@Composable\nfun App() {\n    ${firstName}()\n}`);
      }
    }

    const wasmImports = [
      "import androidx.compose.material3.*",
      "import androidx.compose.foundation.layout.*",
      "import androidx.compose.runtime.*",
      "import androidx.compose.ui.Alignment",
      "import androidx.compose.ui.Modifier",
      "import androidx.compose.ui.unit.dp",
      "import androidx.compose.ui.unit.sp",
    ];
    return wasmImports.join("\n") + "\n\n" + composableBlocks.join("\n\n") + "\n";
  }

  code = code.replace(/^import\s+androidx\.compose\.ui\.tooling\.preview\..*$/gm, "");
  code = code.replace(/@Preview\b[^@]*(?=@|fun\s|$)/g, "");

  if (!/fun\s+App\s*\(/.test(code)) {
    const composableFns = code.match(/@Composable\s+fun\s+(\w+)/g);
    if (composableFns && composableFns.length > 0) {
      const firstName = composableFns[0].match(/fun\s+(\w+)/)?.[1];
      if (firstName && firstName !== "App") {
        code += `\n\n@Composable\nfun App() {\n    ${firstName}()\n}\n`;
      }
    }
  }

  return code;
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

    const transformedFiles = sourceFiles
      .filter((f) => f.path.endsWith(".kt"))
      .map((f) => ({ ...f, content: transformForWasm(f.content) }))
      .filter((f) => f.content.trim().length > 0);

    if (transformedFiles.length === 0) {
      const defaultApp = `import androidx.compose.material3.*\nimport androidx.compose.foundation.layout.*\nimport androidx.compose.runtime.*\nimport androidx.compose.ui.Alignment\nimport androidx.compose.ui.Modifier\nimport androidx.compose.ui.unit.dp\nimport androidx.compose.ui.unit.sp\n\n@Composable\nfun App() {\n    MaterialTheme {\n        Column(\n            modifier = Modifier.fillMaxSize().padding(16.dp),\n            horizontalAlignment = Alignment.CenterHorizontally,\n            verticalArrangement = Arrangement.Center\n        ) {\n            Text("Hello, Compose!", fontSize = 28.sp)\n        }\n    }\n}\n`;
      await writeFile(join(kotlinSrcDir, "App.kt"), defaultApp, "utf8");
    } else {
      for (const file of transformedFiles) {
        const fileName = file.path.split("/").pop() || "App.kt";
        const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        await writeFile(join(kotlinSrcDir, sanitizedName), file.content, "utf8");
      }
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
      ["wasmJsBrowserDistribution", "--daemon", "--build-cache", "-q"],
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

export function checkCompilerOnStartup(): void {
  if (existsSync(GRADLE_PATH)) {
    console.log(`[kotlin-wasm] Compiler available: Gradle at ${GRADLE_PATH}`);
  } else {
    console.warn(
      `[kotlin-wasm] WARNING: Gradle not found at ${GRADLE_PATH}. ` +
        `Kotlin/Wasm preview will be unavailable. Run: bash scripts/setup-gradle.sh`
    );
  }
}
