import { spawn } from "child_process";
import { writeFile, mkdir, rm, readFile, readdir, cp } from "fs/promises";
import { join, resolve, relative } from "path";
import { tmpdir } from "os";
import { createHash, randomBytes } from "crypto";
import { existsSync } from "fs";

const SWIFT_WASM_PATH = process.env.SWIFT_WASM_PATH ||
  `${process.env.HOME}/.swift-wasm-sdk/swift-6.1-RELEASE-ubuntu24.04/usr/bin/swift`;
const SWIFT_WASM_SDK_ID = process.env.SWIFT_WASM_SDK_ID || "wasm32-unknown-wasi";
const TEMPLATE_DIR = resolve(process.cwd(), "server", "compile-templates", "swift-wasm");
const COMPILE_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
// Stable build dir — SPM reuses .build/ between compiles, cutting cold time significantly
const SWIFT_PERSISTENT_BUILD_DIR = join(tmpdir(), "swift-wasm-persistent-build");

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
  cwd: string,
  env?: Record<string, string>
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
      env: { ...process.env, ...env },
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

function extractSwiftErrors(stderr: string): string[] {
  const lines = stderr.split("\n");
  const errors: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.includes("error:") ||
      trimmed.includes("cannot find") ||
      trimmed.includes("has no member") ||
      trimmed.includes("expected") ||
      trimmed.includes("use of unresolved") ||
      trimmed.includes("FAILURE:") ||
      trimmed.includes("fatal error")
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

function isAppEntryFile(source: string): boolean {
  return /struct\s+\w+\s*:\s*App\s*\{/.test(source) &&
    /var\s+body\s*:\s*some\s+Scene\b/.test(source);
}

function extractContentViewFromAppEntry(source: string): string | null {
  const patterns = [
    /WindowGroup\s*\{[\s\S]*?(\w+)\s*\(\s*\)/,
    /WindowGroup\s*\(\s*[^)]*\)\s*\{[\s\S]*?(\w+)\s*\(\s*\)/,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function transformSwiftForWasm(source: string): string {
  let code = source;

  code = code.replace(/^import\s+SwiftUI\s*$/gm, "import SwiftUIWeb");
  code = code.replace(/^import\s+UIKit\s*$/gm, "");
  code = code.replace(/^import\s+Foundation\s*$/gm, "");
  code = code.replace(/^import\s+Combine\s*$/gm, "");

  code = code.replace(/#Preview\s*\{[\s\S]*?\n\}/gm, "");

  code = code.replace(/@(main|UIApplicationMain)\s*/g, "");

  if (isAppEntryFile(code)) {
    return "";
  }

  return code;
}

export async function compileSwiftWasm(
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
  const buildId = `swift-${sourceHash}-${randomBytes(4).toString("hex")}`;
  // Use a stable work dir so SPM can reuse .build/ between compiles
  const workDir = SWIFT_PERSISTENT_BUILD_DIR;

  try {
    // Only copy template if the work dir doesn't exist yet (first run)
    if (!existsSync(workDir)) {
      await cp(TEMPLATE_DIR, workDir, { recursive: true });
    } else {
      // Refresh Package.swift and index.html from template, but leave .build/ intact
      const templateFiles = ["Package.swift", "index.html", "Package.resolved"];
      for (const f of templateFiles) {
        const src = join(TEMPLATE_DIR, f);
        const dst = join(workDir, f);
        if (existsSync(src)) {
          await cp(src, dst);
        }
      }
    }

    const appSrcDir = join(workDir, "Sources", "App");
    await mkdir(appSrcDir, { recursive: true });

    const swiftFiles = sourceFiles
      .filter((f) => f.path.endsWith(".swift"))
      .map((f) => ({ ...f, content: transformSwiftForWasm(f.content) }))
      .filter((f) => f.content.trim().length > 0);

    if (swiftFiles.length === 0) {
      return {
        success: false,
        buildId,
        errors: ["No Swift source files provided"],
      };
    }

    let rootViewFromAppFile: string | null = null;
    for (const sf of sourceFiles) {
      if (isAppEntryFile(sf.content)) {
        const extracted = extractContentViewFromAppEntry(sf.content);
        if (extracted) rootViewFromAppFile = extracted;
      }
    }

    const allContent = swiftFiles.map((f) => f.content).join("\n");
    const hasAppProtocol = /struct\s+\w+\s*:\s*SwiftUIApp\b/.test(allContent);
    const hasRunApp = /runApp\s*\(/.test(allContent);
    const hasAppEntry = hasAppProtocol && hasRunApp;

    for (const file of swiftFiles) {
      const fileName = file.path.split("/").pop() || "ContentView.swift";
      const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      await writeFile(join(appSrcDir, sanitizedName), file.content, "utf8");
    }

    if (!hasAppEntry) {
      const viewMatch = allContent.match(/struct\s+(\w+)\s*:\s*View\b/);
      const rootView = rootViewFromAppFile || (viewMatch ? viewMatch[1] : "ContentView");

      await writeFile(
        join(appSrcDir, "GeneratedMain.swift"),
        `import SwiftUIWeb

struct GeneratedApp: SwiftUIApp {
    var body: some View {
        ${rootView}()
    }
}

runApp(GeneratedApp.self)
`,
        "utf8"
      );

      try {
        await rm(join(appSrcDir, "Main.swift"), { force: true });
      } catch {}
    }

    if (!isSwiftWasmAvailable()) {
      return {
        success: false,
        buildId,
        errors: [
          "Swift/WASM compiler not found. The SwiftWasm compilation environment is not set up. " +
            "Please ensure Swift 6.1+ with the SwiftWasm SDK is installed.",
        ],
      };
    }

    const result = await spawnCompile(
      SWIFT_WASM_PATH,
      [
        "build",
        "--swift-sdk", SWIFT_WASM_SDK_ID,
        "--product", "App",
        "-c", "release",
      ],
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
      const errors = extractSwiftErrors(result.stderr || result.stdout);
      return {
        success: false,
        buildId,
        errors:
          errors.length > 0
            ? errors
            : ["Compilation failed with exit code " + result.exitCode],
      };
    }

    const wasmCandidates = [
      join(workDir, ".build", "wasm32-unknown-wasi", "release", "App.wasm"),
      join(workDir, ".build", "release", "App.wasm"),
      join(workDir, ".build", "wasm32-unknown-wasi", "debug", "App.wasm"),
      join(workDir, ".build", "debug", "App.wasm"),
    ];
    let wasmPath: string | null = null;
    for (const candidate of wasmCandidates) {
      if (existsSync(candidate)) {
        wasmPath = candidate;
        break;
      }
    }
    if (!wasmPath) {
      const buildContents = await collectDir(
        join(workDir, ".build"),
        join(workDir, ".build")
      );
      return {
        success: false,
        buildId,
        errors: [
          "Build succeeded but .wasm artifact not found. Build contents: " +
            buildContents.map((f) => f.relativePath).join(", "),
        ],
      };
    }

    const artifactOutputDir = join(tmpdir(), `swift-wasm-artifacts-${buildId}`);
    await mkdir(artifactOutputDir, { recursive: true });

    await cp(wasmPath, join(artifactOutputDir, "App.wasm"));

    const indexHtml = await readFile(join(workDir, "index.html"), "utf8");
    await writeFile(join(artifactOutputDir, "index.html"), indexHtml, "utf8");

    const jsKitRuntimeCandidates = [
      join(workDir, ".build", "checkouts", "JavaScriptKit", "Runtime", "src", "index.mjs"),
      join(workDir, ".build", "checkouts", "JavaScriptKit", "Runtime", "src", "index.js"),
    ];
    let jsKitRuntimePath: string | null = null;
    for (const candidate of jsKitRuntimeCandidates) {
      if (existsSync(candidate)) {
        jsKitRuntimePath = candidate;
        break;
      }
    }
    if (jsKitRuntimePath) {
      const jsKitRuntime = await readFile(jsKitRuntimePath, "utf8");
      await writeFile(join(artifactOutputDir, "JavaScriptKit_Runtime.mjs"), jsKitRuntime, "utf8");
      await writeFile(
        join(artifactOutputDir, "App.js"),
        `import { SwiftRuntime } from './JavaScriptKit_Runtime.mjs';

const swift = new SwiftRuntime();
const wasmUrl = new URL('./App.wasm', import.meta.url);
const response = await fetch(wasmUrl);
const { instance } = await WebAssembly.instantiateStreaming(
  response,
  {
    wasi_snapshot_preview1: {
      fd_write: () => 0,
      fd_seek: () => 0,
      fd_close: () => 0,
      fd_read: () => 0,
      proc_exit: () => {},
      environ_sizes_get: () => 0,
      environ_get: () => 0,
      clock_time_get: () => 0,
      random_get: (ptr, len) => {
        const view = new Uint8Array(instance.exports.memory.buffer, ptr, len);
        crypto.getRandomValues(view);
        return 0;
      },
      args_sizes_get: () => 0,
      args_get: () => 0,
      path_open: () => 0,
      fd_prestat_get: () => 0,
      fd_prestat_dir_name: () => 0,
    },
    javascript_kit: swift.importObjects(),
  }
);

swift.setInstance(instance);
if (instance.exports._start) {
  instance.exports._start();
} else if (instance.exports.main) {
  instance.exports.main();
}
`,
        "utf8"
      );
    } else {
      return {
        success: false,
        buildId,
        errors: [
          "JavaScriptKit runtime not found in build artifacts. " +
            "The SwiftWasm build did not produce the required JavaScript bridge runtime. " +
            "Ensure JavaScriptKit is correctly declared as a dependency in Package.swift.",
        ],
      };
    }

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

    // Don't delete workDir — keep .build/ for incremental recompilation

    return {
      success: true,
      buildId,
    };
  } catch (err: any) {
    // Don't delete workDir on error either — .build/ may still be useful
    return {
      success: false,
      buildId,
      errors: [err?.message || "Unknown compilation error"],
    };
  } finally {
    activeCompiles--;
  }
}

export function getSwiftArtifactPath(buildId: string): string | null {
  for (const entry of artifactCache.values()) {
    if (entry.buildId === buildId) {
      return entry.dir;
    }
  }
  return null;
}

let sdkVerified: boolean | null = null;

export function isSwiftWasmAvailable(): boolean {
  try {
    if (!existsSync(SWIFT_WASM_PATH)) {
      return false;
    }
    if (sdkVerified === null) {
      verifySdkInstalled();
    }
    return sdkVerified === true;
  } catch {
    return false;
  }
}

function verifySdkInstalled(): void {
  if (!existsSync(SWIFT_WASM_PATH)) {
    sdkVerified = false;
    return;
  }
  try {
    const { execFileSync } = require("child_process");
    const output = execFileSync(SWIFT_WASM_PATH, ["sdk", "list"], {
      timeout: 10_000,
      encoding: "utf8",
    });
    sdkVerified = output.includes(SWIFT_WASM_SDK_ID);
  } catch {
    sdkVerified = null;
  }
}

export function checkSwiftCompilerOnStartup(): void {
  if (!existsSync(SWIFT_WASM_PATH)) {
    console.warn(
      `[swift-wasm] WARNING: Swift toolchain not found at ${SWIFT_WASM_PATH}. ` +
        `SwiftUI/WASM preview will be unavailable. Run: bash scripts/setup-swift-wasm.sh`
    );
    sdkVerified = false;
    return;
  }

  verifySdkInstalled();

  if (sdkVerified === true) {
    console.log(
      `[swift-wasm] Compiler available: Swift at ${SWIFT_WASM_PATH}, SDK "${SWIFT_WASM_SDK_ID}" verified`
    );
  } else if (sdkVerified === false) {
    console.warn(
      `[swift-wasm] WARNING: Swift binary found at ${SWIFT_WASM_PATH} but SDK "${SWIFT_WASM_SDK_ID}" not installed. ` +
        `Run: bash scripts/setup-swift-wasm.sh`
    );
  } else {
    console.log(
      `[swift-wasm] Swift binary found at ${SWIFT_WASM_PATH} (SDK verification skipped)`
    );
  }
}
