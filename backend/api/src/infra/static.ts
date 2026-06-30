import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(process.cwd(), "dist", "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // sw.js 和 index.html 必须每次重新获取，否则旧 Service Worker 会缓存旧 bundle
  // 导致 CSS/JS 文件名不匹配，出现空白页
  app.get("/sw.js", (_req, res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "sw.js"));
  });
  app.get("/registerSW.js", (_req, res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "registerSW.js"));
  });

  // 静态资源（带 hash 的文件名）可以长期缓存
  app.use(express.static(distPath, {
    setHeaders(res, filePath) {
      // index.html 不缓存，始终获取最新版
      if (filePath.endsWith("index.html")) {
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
