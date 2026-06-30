import type { Express } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import { writeFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getOptimalClient } from "../../agent/providers/kimi-client";
import { DOUBAO_LITE_MODEL } from "../../agent/providers/doubao-client";
import { spawnProcess, EXEC_TIMEOUT_MS } from "../../infra/process-exec";

/**
 * Code-exec utility routes (Step C): AI-generated project naming and the
 * multi-language sandboxed code runner. Self-contained — AI client + the
 * shared process-exec sandbox. Behavior unchanged.
 */
export function registerCodeExecRoutes(app: Express): void {
  app.post("/api/generate-project-name", async (req, res) => {
    try {
      const { idea, framework } = req.body as { idea?: string; framework?: string };
      if (!idea) {
        res.status(400).json({ error: "idea is required" });
        return;
      }
      console.log(`[generate-project-name] idea="${idea.slice(0, 50)}" framework=${framework || "web"}`);
      const { client: nameClient } = getOptimalClient("planning", "doubao");
      const frameworkHint = framework && framework !== "web" ? ` (${framework} app)` : "";
      // Name the project in the same language as the idea (Chinese vs English),
      // so a Chinese prompt yields a Chinese name instead of defaulting to English.
      const isChinese = /[一-鿿]/.test(idea);
      const langInstruction = isChinese
        ? "用中文起名（2-4 个字或词），不要使用英文。"
        : "Use English (2-4 words, title case).";
      const completion = await nameClient.chat.completions.create({
        model: DOUBAO_LITE_MODEL,
        messages: [
          {
            role: "user",
            content: `Generate a short project name for this app idea${frameworkHint}. ${langInstruction}\n\n"${idea}"\n\nRespond with ONLY the project name, nothing else.`,
          },
        ],
        max_tokens: 20,
      });
      const name = (completion.choices[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
      res.json({ name: name || "New Project" });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to generate name" });
    }
  });

  app.post("/api/run-file", async (req, res) => {
    const { content, extension: extRaw } = req.body as {
      content?: string;
      extension?: string;
    };

    if (typeof content !== "string" || typeof extRaw !== "string") {
      res.status(400).json({ error: "content and extension are required" });
      return;
    }

    if (content.length > 200_000) {
      res.status(413).json({ error: "File too large to execute (max 200 KB)" });
      return;
    }

    const ext = extRaw.toLowerCase().replace(/^\./, "");

    // File types that cannot meaningfully be "run"
    const NON_RUNNABLE = new Set([
      "html", "css", "scss", "sass", "less", "svg",
      "json", "yaml", "yml", "toml", "ini", "cfg",
      "xml", "md", "markdown", "sql", "graphql", "proto",
      "dockerfile", "vue", "svelte",
      "h", "hpp", "hxx",
    ]);
    if (NON_RUNNABLE.has(ext)) {
      res.json({ cannotRun: true });
      return;
    }

    // Interpreted languages: [command, ...prependArgs]
    const INTERPRET: Record<string, [string, ...string[]]> = {
      py:   ["python3"],
      pyw:  ["python3"],
      js:   ["node"],
      mjs:  ["node"],
      cjs:  ["node"],
      ts:   ["./node_modules/.bin/tsx"],
      tsx:  ["./node_modules/.bin/tsx"],
      rb:   ["ruby"],
      php:  ["php"],
      pl:   ["perl"],
      pm:   ["perl"],
      lua:  ["lua"],
      r:    ["Rscript"],
      sh:   ["bash"],
      bash: ["bash"],
      zsh:  ["bash"],
      ex:   ["elixir"],
      exs:  ["elixir"],
    };

    // TSX/JSX files that import React are browser code — can't run in Node.js
    if ((ext === "tsx" || ext === "jsx") && /from\s+['"]react['"]|require\(['"]react['"]\)/.test(content)) {
      res.json({ cannotRun: true, reason: "react" });
      return;
    }

    const tmpId = randomBytes(8).toString("hex");
    const tmpBase = join(tmpdir(), `cascade_${tmpId}`);
    await mkdir(tmpBase, { recursive: true });

    try {
      let result: { stdout: string; stderr: string; exitCode: number; timedOut: boolean };

      if (INTERPRET[ext]) {
        // ── Interpreted ──────────────────────────────────────────────────────
        const [cmd, ...pre] = INTERPRET[ext];
        const srcFile = join(tmpBase, `main.${ext}`);
        await writeFile(srcFile, content, "utf8");
        result = await spawnProcess(cmd, [...pre, srcFile], { timeout: EXEC_TIMEOUT_MS });

      } else if (ext === "go") {
        // ── Go: build to binary (compile ≤30s), then run binary (≤EXEC_TIMEOUT_MS) ──
        const srcFile = join(tmpBase, "main.go");
        const binFile = join(tmpBase, "main");
        await writeFile(srcFile, content, "utf8");
        await writeFile(join(tmpBase, "go.mod"), "module cascade_run\n\ngo 1.21\n", "utf8");
        const compileRes = await spawnProcess(
          "go", ["build", "-o", binFile, "."], { cwd: tmpBase, timeout: 30_000 }
        );
        result = compileRes.exitCode !== 0
          ? compileRes
          : await spawnProcess(binFile, [], { timeout: EXEC_TIMEOUT_MS });

      } else if (ext === "java") {
        // ── Java: compile (≤30s), then run class (≤EXEC_TIMEOUT_MS) ──────────
        const classMatch = content.match(/public\s+class\s+(\w+)/);
        const className = classMatch ? classMatch[1] : "Main";
        const srcFile = join(tmpBase, `${className}.java`);
        await writeFile(srcFile, content, "utf8");
        const compileRes = await spawnProcess("javac", [srcFile], { cwd: tmpBase, timeout: 30_000 });
        result = compileRes.exitCode !== 0
          ? compileRes
          : await spawnProcess("java", ["-cp", tmpBase, className], { timeout: EXEC_TIMEOUT_MS });

      } else if (ext === "c") {
        // ── C: compile (≤20s), then run binary (≤EXEC_TIMEOUT_MS) ───────────
        const srcFile = join(tmpBase, "main.c");
        const binFile = join(tmpBase, "a.out");
        await writeFile(srcFile, content, "utf8");
        const compileRes = await spawnProcess("gcc", [srcFile, "-o", binFile, "-lm"], { timeout: 20_000 });
        result = compileRes.exitCode !== 0
          ? compileRes
          : await spawnProcess(binFile, [], { timeout: EXEC_TIMEOUT_MS });

      } else if (["cpp", "cc", "cxx"].includes(ext)) {
        // ── C++: compile (≤20s), then run binary (≤EXEC_TIMEOUT_MS) ─────────
        const srcFile = join(tmpBase, `main.${ext}`);
        const binFile = join(tmpBase, "a.out");
        await writeFile(srcFile, content, "utf8");
        const compileRes = await spawnProcess("g++", [srcFile, "-o", binFile, "-lm"], { timeout: 20_000 });
        result = compileRes.exitCode !== 0
          ? compileRes
          : await spawnProcess(binFile, [], { timeout: EXEC_TIMEOUT_MS });

      } else if (ext === "rs") {
        // ── Rust: compile (≤60s), then run binary (≤EXEC_TIMEOUT_MS) ─────────
        const srcFile = join(tmpBase, "main.rs");
        const binFile = join(tmpBase, "main");
        await writeFile(srcFile, content, "utf8");
        const compileRes = await spawnProcess("rustc", [srcFile, "-o", binFile], { timeout: 60_000 });
        result = compileRes.exitCode !== 0
          ? compileRes
          : await spawnProcess(binFile, [], { timeout: EXEC_TIMEOUT_MS });

      } else if (["kt", "kts"].includes(ext)) {
        // ── Kotlin: compile to jar (≤90s), then run jar (≤EXEC_TIMEOUT_MS) ───
        const srcFile = join(tmpBase, `main.${ext}`);
        const jarFile = join(tmpBase, "main.jar");
        await writeFile(srcFile, content, "utf8");
        const compileRes = await spawnProcess(
          "kotlinc", [srcFile, "-include-runtime", "-d", jarFile],
          { timeout: 90_000 }
        );
        result = compileRes.exitCode !== 0
          ? compileRes
          : await spawnProcess("java", ["-jar", jarFile], { timeout: EXEC_TIMEOUT_MS });

      } else if (ext === "scala") {
        // ── Scala: compile to classes (≤60s), then run (≤EXEC_TIMEOUT_MS) ────
        const srcFile = join(tmpBase, "main.scala");
        await writeFile(srcFile, content, "utf8");
        const compileRes = await spawnProcess(
          "scalac", [srcFile, "-d", tmpBase], { cwd: tmpBase, timeout: 60_000 }
        );
        if (compileRes.exitCode !== 0) {
          result = compileRes;
        } else {
          // Detect top-level object name for entry point
          const objMatch = content.match(/object\s+(\w+)/);
          const entryPoint = objMatch ? objMatch[1] : "Main";
          result = await spawnProcess(
            "scala", ["-cp", tmpBase, entryPoint], { timeout: EXEC_TIMEOUT_MS }
          );
        }

      } else if (ext === "dart") {
        // ── Dart: JIT compile+run via dart (≤30s total for warmup + execution) ──
        const srcFile = join(tmpBase, "main.dart");
        await writeFile(srcFile, content, "utf8");
        result = await spawnProcess("dart", ["run", srcFile], { timeout: 30_000 });

      } else {
        res.json({ cannotRun: true });
        return;
      }

      res.json({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      });
    } catch (error: any) {
      console.error("run-file error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Execution failed" });
    } finally {
      try { await rm(tmpBase, { recursive: true, force: true }); } catch {}
    }
  });
}
