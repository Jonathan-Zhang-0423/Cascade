import type { Server as HTTPServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";

interface FileEntry {
  path: string;
  content: string;
}

interface PreviewSession {
  token: string;
  files: FileEntry[];
  active: boolean;
  createdAt: number;
  lastAccessedAt: number;
}

const sessions = new Map<string, PreviewSession>();
let wss: WebSocketServer | null = null;
const wsClients = new Map<string, Set<WebSocket>>();

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

function generateToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      sessions.delete(token);
      wsClients.delete(token);
    }
  }
}

function resolveFilePath(src: string, basePath: string): string {
  if (src.startsWith("/project/")) return src;
  let resolved: string;
  if (src.startsWith("/")) {
    resolved = `/project${src}`;
  } else {
    const baseDir = basePath.substring(0, basePath.lastIndexOf("/"));
    resolved = `${baseDir}/${src}`;
  }
  const parts = resolved.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === "" && normalized.length > 0) continue;
    if (part === ".") continue;
    if (part === ".." && normalized.length > 1) {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join("/");
}

function isExternalUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//");
}

function findContent(files: FileEntry[], filePath: string): string | undefined {
  const normalized = filePath.startsWith("/project/") ? filePath : `/project${filePath.startsWith("/") ? "" : "/"}${filePath}`;
  const entry = files.find((f) => f.path === normalized || f.path === filePath);
  return entry?.content;
}

function inlineExternalFiles(html: string, files: FileEntry[], entryPath: string): string {
  let result = html;

  result = result.replace(
    /<link\s+([^>]*?)(?:rel=["']stylesheet["'][^>]*?href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*?rel=["']stylesheet["'])[^>]*\/?>/gi,
    (match, _attrs, href1, href2) => {
      const href = href1 || href2;
      if (!href || isExternalUrl(href)) return match;
      const resolved = resolveFilePath(href, entryPath);
      const content = findContent(files, resolved);
      if (content !== undefined) {
        return `<style>/* ${href} */\n${content}\n</style>`;
      }
      return match;
    }
  );

  result = result.replace(
    /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (match, src) => {
      if (isExternalUrl(src)) return match;
      const resolved = resolveFilePath(src, entryPath);
      const content = findContent(files, resolved);
      if (content !== undefined) {
        return `<script>/* ${src} */\n${content}\n</script>`;
      }
      return match;
    }
  );

  return result;
}

const LIVE_RELOAD_SCRIPT = `
<script>
(function() {
  var wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var wsUrl = wsProto + '//' + location.host + '/preview-ws';
  function connect() {
    var ws = new WebSocket(wsUrl);
    ws.onmessage = function(e) {
      if (e.data === 'reload') {
        location.reload();
      }
    };
    ws.onclose = function() {
      setTimeout(connect, 2000);
    };
    ws.onerror = function() {
      ws.close();
    };
  }
  connect();
})();
</script>`;

function serveFile(files: FileEntry[], requestPath: string): { html: string; found: boolean } {
  let filePath = requestPath;
  if (filePath === "/" || filePath === "") {
    filePath = "/index.html";
  }

  const projectPath = `/project${filePath}`;
  let content = findContent(files, projectPath);

  if (content === undefined && !filePath.endsWith(".html")) {
    content = findContent(files, projectPath + ".html");
    if (content !== undefined) {
      filePath = filePath + ".html";
    }
  }

  if (content === undefined && !filePath.endsWith("/")) {
    content = findContent(files, projectPath + "/index.html");
    if (content !== undefined) {
      filePath = filePath + "/index.html";
    }
  }

  if (content === undefined) {
    return {
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404</title><style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;color:#333}div{text-align:center}h1{font-size:72px;margin:0;color:#ccc}p{margin:8px 0 0;font-size:14px;color:#999}</style></head><body><div><h1>404</h1><p>${filePath} not found</p></div>${LIVE_RELOAD_SCRIPT}</body></html>`,
      found: false,
    };
  }

  const entryPath = `/project${filePath}`;
  let html = inlineExternalFiles(content, files, entryPath);

  if (html.includes("<head>")) {
    html = html.replace("<head>", "<head>" + LIVE_RELOAD_SCRIPT);
  } else if (html.includes("<html")) {
    html = html.replace(/<html[^>]*>/, (m) => m + LIVE_RELOAD_SCRIPT);
  } else {
    html = LIVE_RELOAD_SCRIPT + html;
  }

  return { html, found: true };
}

function broadcastReload(token: string) {
  const clients = wsClients.get(token);
  if (!clients) return;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send("reload");
    }
  }
}

export function setupPreviewServer(httpServer: HTTPServer, app: Express) {
  wss = new WebSocketServer({ noServer: true });

  setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname === "/preview-ws") {
      const token = url.searchParams.get("token");
      if (!token || !sessions.has(token)) {
        socket.destroy();
        return;
      }
      wss!.handleUpgrade(request, socket, head, (ws) => {
        if (!wsClients.has(token)) {
          wsClients.set(token, new Set());
        }
        wsClients.get(token)!.add(ws);
        ws.on("close", () => {
          wsClients.get(token)?.delete(ws);
        });
        wss!.emit("connection", ws, request);
      });
    }
  });

  app.post("/api/preview-server/start", (req: Request, res: Response) => {
    cleanupExpiredSessions();
    const { files } = req.body as { files?: FileEntry[] };
    const token = generateToken();
    const session: PreviewSession = {
      token,
      files: files && Array.isArray(files) ? files : [],
      active: true,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
    sessions.set(token, session);

    const host = req.headers.host || "localhost:5000";
    const protocol = req.protocol || "https";
    const previewUrl = `${protocol}://${host}/preview-serve/${token}/`;

    res.json({ url: previewUrl, token, active: true });
  });

  app.post("/api/preview-server/update", (req: Request, res: Response) => {
    const { files, token } = req.body as { files?: FileEntry[]; token?: string };
    if (!token || !sessions.has(token)) {
      res.status(404).json({ error: "Preview session not found" });
      return;
    }
    const session = sessions.get(token)!;
    if (files && Array.isArray(files)) {
      session.files = files;
    }
    session.lastAccessedAt = Date.now();
    broadcastReload(token);
    const clients = wsClients.get(token);
    res.json({ ok: true, clients: clients?.size || 0 });
  });

  app.post("/api/preview-server/notify", (req: Request, res: Response) => {
    const { token } = req.body as { token?: string };
    if (!token || !sessions.has(token)) {
      res.status(404).json({ error: "Preview session not found" });
      return;
    }
    sessions.get(token)!.lastAccessedAt = Date.now();
    broadcastReload(token);
    const clients = wsClients.get(token);
    res.json({ ok: true, clients: clients?.size || 0 });
  });

  app.post("/api/preview-server/stop", (req: Request, res: Response) => {
    const { token } = req.body as { token?: string };
    if (token && sessions.has(token)) {
      sessions.delete(token);
      const clients = wsClients.get(token);
      if (clients) {
        for (const ws of clients) ws.close();
        wsClients.delete(token);
      }
    }
    res.json({ ok: true });
  });

  app.get("/api/preview-server/status", (req: Request, res: Response) => {
    const token = req.query.token as string | undefined;
    if (!token || !sessions.has(token)) {
      res.json({ active: false, fileCount: 0, clients: 0 });
      return;
    }
    const session = sessions.get(token)!;
    const clients = wsClients.get(token);
    res.json({
      active: session.active,
      fileCount: session.files.length,
      clients: clients?.size || 0,
    });
  });

  app.use("/preview-serve", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();

    const pathParts = req.path.split("/").filter(Boolean);
    const token = pathParts[0];

    if (!token || !sessions.has(token)) {
      res.status(403).send("Invalid or expired preview link.");
      return;
    }

    const session = sessions.get(token)!;
    session.lastAccessedAt = Date.now();

    const requestPath = "/" + pathParts.slice(1).join("/") || "/";
    const { html, found } = serveFile(session.files, requestPath);

    let finalHtml = html.replace(
      "/preview-ws'",
      `/preview-ws?token=${token}'`
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    if (!found) {
      res.status(404);
    }
    res.send(finalHtml);
  });
}
