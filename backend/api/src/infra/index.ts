import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "../api/routes/index.js";
import { serveStatic } from "./static";
import { pool } from "./db.js";
import { startFeishuSync } from "./feishu-sync.js";
import { startSheetsSync } from "./sheets-sync.js";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

// 生产部署在反代（Nginx 等）之后，开启 trust proxy 才能从 X-Forwarded-For
// 取到客户端真实外网 IP——人机验证验票（captcha）和限流都依赖它。
app.set("trust proxy", true);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({
    pool,
    // 复用现有 pg 连接池，session 落库而非进程内存——避免 MemoryStore 内存泄漏，
    // 进程重启也不丢登录态。表不存在时自动创建（单表 "session"）。
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    // OAuth 回调是跨站重定向，lax 模式下浏览器不带 cookie，导致 githubOAuthState
    // 读不到、state 校验失败。none 允许跨站携带，必须配合 secure:true。
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production",
  },
}));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
      startSheetsSync();
      startFeishuSync();
    },
  );

  // ── 优雅关闭 ────────────────────────────────────────────────────
  // pm2 reload / restart / 部署时会发 SIGTERM。先停止接收新连接，给在途的
  // AI 构建会话和 SSE 长连接留出收尾时间，再退出；超时则强制退出兜底。
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`收到 ${signal}，开始优雅关闭…`);
    const forceExit = setTimeout(() => {
      console.error("[process] 优雅关闭超时，强制退出");
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    httpServer.close(() => {
      log("HTTP server 已关闭，进程退出");
      clearTimeout(forceExit);
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // ── 进程级错误兜底 ──────────────────────────────────────────────
  // 长跑期间最大的杀手是没人 catch 的异常。两类区别对待：
  // unhandledRejection（多为漏 catch 的 async）只记日志、不退出——杀进程
  //   会牵连所有在途的 AI 会话与 SSE 长连接，得不偿失。
  // uncaughtException 后进程状态已不可信，记日志后走优雅关闭，交给 pm2 拉起。
  process.on("unhandledRejection", (reason) => {
    console.error("[process] 未处理的 Promise rejection（已忽略，进程继续）:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[process] 未捕获异常，进程状态不可信，优雅关闭后由 pm2 重启:", err);
    shutdown("uncaughtException");
  });
})();
