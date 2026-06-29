import type { Express } from "express";
import { z } from "zod";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { compileKotlinWasm, getArtifactPath, isCompilerAvailable, checkCompilerOnStartup } from "../../compiler/kotlin-wasm/kotlin-wasm-compiler";
import { compileSwiftWasm, getSwiftArtifactPath, isSwiftWasmAvailable, checkSwiftCompilerOnStartup } from "../../compiler/kotlin-wasm/swift-wasm-compiler";
import { compileRnWeb, getRnArtifactPath, getVendorPath, ensureVendorBundle } from "../../compiler/rn-web/rn-web-compiler";
import { compileFlutterWeb, getFlutterArtifactPath, isFlutterAvailable, checkFlutterOnStartup } from "../../compiler/flutter/flutter-compiler";
import { compileWeChatWeb, getWxArtifactDir, ensureWxVendorBundle } from "../../compiler/wechat/wechat-web-compiler";

/**
 * Compile routes (Step C). Kotlin/Swift WASM, RN Web, Flutter Web, WeChat Web
 * compilation endpoints plus the status check. All depend on the compiler
 * modules (already separate packages); no closure state.
 */
export function registerCompileRoutes(app: Express): void {
  // Run compiler availability checks at startup (non-blocking).
  checkCompilerOnStartup();
  checkSwiftCompilerOnStartup();
  checkFlutterOnStartup();
  app.post("/api/compile/kotlin-wasm", async (req, res) => {
    try {
      if (!isCompilerAvailable()) {
        res.status(503).json({
          success: false,
          error: "Kotlin/Wasm compiler not available",
          errors: ["Gradle SDK not found. The compilation environment is not configured."],
        });
        return;
      }

      const { files } = req.body as {
        files: Array<{ path: string; content: string }>;
      };

      if (!files || !Array.isArray(files) || files.length === 0) {
        res.status(400).json({
          success: false,
          error: "At least one Kotlin source file is required",
          errors: ["No source files provided"],
        });
        return;
      }

      for (const f of files) {
        if (f.path.includes("..") || f.path.includes("\0")) {
          res.status(400).json({
            success: false,
            error: "Invalid file path",
            errors: [`Invalid file path: ${f.path}`],
          });
          return;
        }
      }

      const result = await compileKotlinWasm(files);
      res.json(result);
    } catch (error: any) {
      console.error("Kotlin/Wasm compile error:", error?.message || error);
      res.status(500).json({
        success: false,
        error: error?.message || "Compilation failed",
        errors: [error?.message || "Unknown compilation error"],
      });
    }
  });

  app.post("/api/compile/swift-wasm", async (req, res) => {
    try {
      if (!isSwiftWasmAvailable()) {
        res.status(503).json({
          success: false,
          error: "Swift/Wasm compiler not available",
          errors: ["Swift toolchain not found. The SwiftWasm compilation environment is not configured."],
        });
        return;
      }

      const { files } = req.body as {
        files: Array<{ path: string; content: string }>;
      };

      if (!files || !Array.isArray(files) || files.length === 0) {
        res.status(400).json({
          success: false,
          error: "At least one Swift source file is required",
          errors: ["No source files provided"],
        });
        return;
      }

      for (const f of files) {
        if (f.path.includes("..") || f.path.includes("\0")) {
          res.status(400).json({
            success: false,
            error: "Invalid file path",
            errors: [`Invalid file path: ${f.path}`],
          });
          return;
        }
      }

      const result = await compileSwiftWasm(files);
      res.json(result);
    } catch (error: any) {
      console.error("Swift/Wasm compile error:", error?.message || error);
      res.status(500).json({
        success: false,
        error: error?.message || "Compilation failed",
        errors: [error?.message || "Unknown compilation error"],
      });
    }
  });

  app.use("/api/compile/artifacts", (req, res, next) => {
    if (req.method !== "GET") { next(); return; }
    try {
      const subPath = req.path.replace(/^\//, "");
      const slashIdx = subPath.indexOf("/");
      if (slashIdx < 0) {
        res.status(400).json({ error: "Missing file path" });
        return;
      }

      const buildId = subPath.slice(0, slashIdx);
      const requestedFile = subPath.slice(slashIdx + 1);

      const artifactDir = getArtifactPath(buildId) || getSwiftArtifactPath(buildId) || getRnArtifactPath(buildId) || getFlutterArtifactPath(buildId) || getWxArtifactDir(buildId);
      if (!artifactDir) {
        res.status(404).json({ error: "Build artifacts not found or expired" });
        return;
      }

      if (!requestedFile || requestedFile.includes("..") || requestedFile.includes("\0")) {
        res.status(400).json({ error: "Invalid file path" });
        return;
      }

      const filePath = resolve(join(artifactDir, requestedFile));

      if (!filePath.startsWith(artifactDir)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const ext = requestedFile.split(".").pop()?.toLowerCase() || "";
      const mimeTypes: Record<string, string> = {
        html: "text/html",
        js: "application/javascript",
        mjs: "application/javascript",
        wasm: "application/wasm",
        css: "text/css",
        json: "application/json",
        map: "application/json",
      };

      res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=3600");

      // COEP/COOP are required for WASM builds (SharedArrayBuffer).
      // Do NOT set them for RN/Flutter artifacts — COEP on the embedded document
      // blocks the iframe from loading when the parent page lacks COEP.
      const isWasmBuild = !!getArtifactPath(buildId) || !!getSwiftArtifactPath(buildId);
      if (isWasmBuild) {
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      } else {
        res.setHeader("Cross-Origin-Resource-Policy", "same-site");
      }

      res.sendFile(filePath);
    } catch (error: any) {
      console.error("Artifact serve error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to serve artifact" });
      }
    }
  });

  app.get("/api/compile/status", (_req, res) => {
    res.json({
      kotlinWasm: isCompilerAvailable(),
      swiftWasm: isSwiftWasmAvailable(),
      flutterWeb: isFlutterAvailable(),
    });
  });

  // -------------------------------------------------------------------------
  // React Native Web compile
  // -------------------------------------------------------------------------

  const rnWebFilesSchema = z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(30),
    name: z.string().optional(),
  });

  app.post("/api/compile/rn-web", async (req, res) => {
    try {
      const parsed = rnWebFilesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const result = await compileRnWeb(parsed.data.files, parsed.data.name);
      res.json(result);
    } catch (error: any) {
      console.error("RN/Web compile error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Compilation failed" });
    }
  });

  // Serve the pre-built react-native-web vendor bundle
  app.get("/api/compile/rn-vendor/rn-vendor.js", (_req, res) => {
    const vendorPath = getVendorPath();
    if (!existsSync(vendorPath)) {
      res.status(503).json({ error: "Vendor bundle not ready yet" });
      return;
    }
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(vendorPath);
  });

  // Kick off vendor bundle build at startup (non-blocking)
  ensureVendorBundle().catch((err) => {
    console.warn("[rn-web] Vendor bundle build failed at startup:", err?.message);
  });

  // -------------------------------------------------------------------------
  // Flutter Web compile
  // -------------------------------------------------------------------------

  const flutterFilesSchema = z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(50),
  });

  app.post("/api/compile/flutter-web", async (req, res) => {
    try {
      if (!isFlutterAvailable()) {
        res.status(503).json({
          success: false,
          error: "Flutter SDK not available on this server. Install Flutter and set FLUTTER_PATH.",
        });
        return;
      }
      const parsed = flutterFilesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const result = await compileFlutterWeb(parsed.data.files);
      res.json(result);
    } catch (error: any) {
      console.error("Flutter/Web compile error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Compilation failed" });
    }
  });

  // -------------------------------------------------------------------------
  // WeChat Mini Program Web compile
  // -------------------------------------------------------------------------

  const wxFilesSchema = z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(60),
    projectId: z.string().optional(),
  });

  app.post("/api/compile/wechat-web", async (req, res) => {
    try {
      const parsed = wxFilesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const result = await compileWeChatWeb(parsed.data.files, parsed.data.projectId);
      res.json(result);
    } catch (error: any) {
      console.error("WeChat/Web compile error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Compilation failed" });
    }
  });

  // Kick off wx vendor bundle build at startup (non-blocking)
  ensureWxVendorBundle().catch((err) => {
    console.warn("[wx-web] Vendor bundle build failed at startup:", err?.message);
  });

}
