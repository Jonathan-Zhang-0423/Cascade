import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import { readdir } from "fs/promises";
import * as protocol from "vscode-languageserver-protocol";

interface LspSession {
  process: ChildProcessWithoutNullStreams;
  language: "typescript" | "dart";
  sessionDir: string;
  requestId: number;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  diagnostics: Map<string, protocol.Diagnostic[]>;
  buffer: string;
  initialized: boolean;
}

function pathToUri(absPath: string): string {
  return `file://${absPath}`;
}

function uriToPath(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

class LspManager {
  private sessions = new Map<string, LspSession[]>();

  /** Start an LSP server for the given session. Safe to call multiple times. */
  async start(
    sessionId: string,
    sessionDir: string,
    language: "typescript" | "dart",
  ): Promise<void> {
    const existing = this.sessions.get(sessionId) ?? [];
    if (existing.some(s => s.language === language)) return; // already running

    let lspProcess: ChildProcessWithoutNullStreams;
    try {
      lspProcess = this.spawnLsp(language, sessionDir);
    } catch (err) {
      console.warn(`[LspManager] Failed to spawn ${language} LSP:`, err instanceof Error ? err.message : err);
      return;
    }

    const lspSession: LspSession = {
      process: lspProcess,
      language,
      sessionDir,
      requestId: 1,
      pending: new Map(),
      diagnostics: new Map(),
      buffer: "",
      initialized: false,
    };

    existing.push(lspSession);
    this.sessions.set(sessionId, existing);

    this.attachProcessHandlers(lspSession);

    try {
      await this.initializeLsp(lspSession, sessionDir);
      await this.openAllFiles(lspSession);
      console.log(`[LspManager] started ${language} LSP for session ${sessionId}`);
    } catch (err) {
      console.warn(`[LspManager] LSP init failed for ${language}:`, err instanceof Error ? err.message : err);
    }
  }

  /** Get diagnostics for a file. Returns [] if LSP is not running. */
  async getDiagnostics(
    sessionId: string,
    filePath: string,
  ): Promise<protocol.Diagnostic[]> {
    const lspSession = this.findSession(sessionId, filePath);
    if (!lspSession) return [];
    const absPath = path.join(lspSession.sessionDir, filePath.replace(/^\/+/, ""));
    return lspSession.diagnostics.get(pathToUri(absPath)) ?? [];
  }

  /** Find all references to a symbol at (line, col) in a file. */
  async findReferences(
    sessionId: string,
    filePath: string,
    line: number,
    col: number,
  ): Promise<protocol.Location[]> {
    const lspSession = this.findSession(sessionId, filePath);
    if (!lspSession || !lspSession.initialized) return [];
    const absPath = path.join(lspSession.sessionDir, filePath.replace(/^\/+/, ""));
    const result = await this.sendRequest<protocol.Location[]>(
      lspSession,
      protocol.ReferencesRequest.type.method,
      {
        textDocument: { uri: pathToUri(absPath) },
        position: { line, character: col },
        context: { includeDeclaration: true },
      },
    );
    return result ?? [];
  }

  /** Go to definition of the symbol at (line, col) in a file. */
  async gotoDefinition(
    sessionId: string,
    filePath: string,
    line: number,
    col: number,
  ): Promise<protocol.Location | null> {
    const lspSession = this.findSession(sessionId, filePath);
    if (!lspSession || !lspSession.initialized) return null;
    const absPath = path.join(lspSession.sessionDir, filePath.replace(/^\/+/, ""));
    const result = await this.sendRequest<protocol.Location | protocol.Location[] | null>(
      lspSession,
      protocol.DefinitionRequest.type.method,
      {
        textDocument: { uri: pathToUri(absPath) },
        position: { line, character: col },
      },
    );
    if (Array.isArray(result)) return result[0] ?? null;
    return result ?? null;
  }

  /** Notify the LSP server that a file has changed. */
  async notifyFileChange(
    sessionId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const lspSession = this.findSession(sessionId, filePath);
    if (!lspSession || !lspSession.initialized) return;
    const absPath = path.join(lspSession.sessionDir, filePath.replace(/^\/+/, ""));
    this.sendNotification(lspSession, protocol.DidChangeTextDocumentNotification.type.method, {
      textDocument: { uri: pathToUri(absPath), version: Date.now() },
      contentChanges: [{ text: content }],
    });
  }

  /** Stop all LSP processes for a session. */
  async stop(sessionId: string): Promise<void> {
    const sessions = this.sessions.get(sessionId) ?? [];
    for (const s of sessions) {
      try {
        s.process.kill();
      } catch {}
    }
    this.sessions.delete(sessionId);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private spawnLsp(
    language: "typescript" | "dart",
    cwd: string,
  ): ChildProcessWithoutNullStreams {
    if (language === "typescript") {
      // Try node_modules/.bin first, fall back to PATH
      const candidates = [
        path.join(process.cwd(), "node_modules/.bin/typescript-language-server"),
        "typescript-language-server",
      ];
      for (const cmd of candidates) {
        try {
          return spawn(cmd, ["--stdio"], { cwd });
        } catch {}
      }
      throw new Error("typescript-language-server not found");
    } else {
      // dart language-server comes with Dart SDK
      return spawn("dart", ["language-server", "--protocol=lsp"], { cwd });
    }
  }

  private attachProcessHandlers(lspSession: LspSession): void {
    lspSession.process.stdout.on("data", (chunk: Buffer) => {
      lspSession.buffer += chunk.toString("utf-8");
      this.processBuffer(lspSession);
    });
    lspSession.process.stderr.on("data", (chunk: Buffer) => {
      // LSP servers often log to stderr; ignore unless debugging
    });
    lspSession.process.on("error", () => {});
    lspSession.process.on("exit", () => {
      // Reject all pending requests
      for (const [, pending] of Array.from(lspSession.pending)) {
        pending.reject(new Error("LSP process exited"));
      }
      lspSession.pending.clear();
    });
  }

  private processBuffer(lspSession: LspSession): void {
    while (true) {
      const headerEnd = lspSession.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = lspSession.buffer.slice(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) { lspSession.buffer = lspSession.buffer.slice(headerEnd + 4); break; }
      const contentLength = parseInt(lengthMatch[1], 10);
      const msgStart = headerEnd + 4;
      if (lspSession.buffer.length < msgStart + contentLength) break;
      const msgStr = lspSession.buffer.slice(msgStart, msgStart + contentLength);
      lspSession.buffer = lspSession.buffer.slice(msgStart + contentLength);
      try {
        const msg = JSON.parse(msgStr);
        this.handleMessage(lspSession, msg);
      } catch {}
    }
  }

  private handleMessage(lspSession: LspSession, msg: any): void {
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as protocol.PublishDiagnosticsParams;
      lspSession.diagnostics.set(params.uri, params.diagnostics);
      return;
    }
    if (msg.id !== undefined) {
      const pending = lspSession.pending.get(msg.id);
      if (pending) {
        lspSession.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message ?? "LSP error"));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  private sendRaw(lspSession: LspSession, msg: object): void {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
    try {
      lspSession.process.stdin.write(header + body);
    } catch {}
  }

  private sendNotification(lspSession: LspSession, method: string, params: object): void {
    this.sendRaw(lspSession, { jsonrpc: "2.0", method, params });
  }

  private sendRequest<T>(
    lspSession: LspSession,
    method: string,
    params: object,
    timeoutMs = 8000,
  ): Promise<T | null> {
    const id = lspSession.requestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        lspSession.pending.delete(id);
        resolve(null);
      }, timeoutMs);
      lspSession.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.sendRaw(lspSession, { jsonrpc: "2.0", id, method, params });
    });
  }

  private async initializeLsp(lspSession: LspSession, rootDir: string): Promise<void> {
    await this.sendRequest(lspSession, "initialize", {
      processId: process.pid,
      rootUri: pathToUri(rootDir),
      capabilities: {
        textDocument: {
          synchronization: { didChange: 1, didOpen: true, didClose: true },
          publishDiagnostics: { relatedInformation: false },
          references: {},
          definition: {},
        },
        workspace: { workspaceFolders: true },
      },
      workspaceFolders: [{ uri: pathToUri(rootDir), name: "workspace" }],
    });
    this.sendNotification(lspSession, "initialized", {});
    lspSession.initialized = true;
  }

  private async openAllFiles(lspSession: LspSession): Promise<void> {
    const ext = lspSession.language === "dart" ? [".dart"] : [".ts", ".tsx", ".js", ".jsx"];
    try {
      const allFiles = await collectFiles(lspSession.sessionDir, ext);
      for (const absPath of allFiles.slice(0, 50)) {
        // Read content from in-memory session if possible; fall back to disk
        const content = await import("fs/promises").then(fs => fs.readFile(absPath, "utf-8")).catch(() => "");
        const languageId = lspSession.language === "dart" ? "dart"
          : absPath.endsWith(".tsx") ? "typescriptreact"
          : absPath.endsWith(".jsx") ? "javascriptreact"
          : absPath.endsWith(".js") ? "javascript"
          : "typescript";
        this.sendNotification(lspSession, "textDocument/didOpen", {
          textDocument: { uri: pathToUri(absPath), languageId, version: 1, text: content },
        });
      }
    } catch {}
  }

  private findSession(sessionId: string, filePath: string): LspSession | null {
    const sessions = this.sessions.get(sessionId);
    if (!sessions || sessions.length === 0) return null;
    const ext = filePath.split(".").pop()?.toLowerCase();
    const isDart = ext === "dart";
    return sessions.find(s => (isDart ? s.language === "dart" : s.language === "typescript")) ?? sessions[0];
  }
}

async function collectFiles(dir: string, extensions: string[]): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        results.push(...await collectFiles(full, extensions));
      } else if (entry.isFile() && extensions.some(e => entry.name.endsWith(e))) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

export const lspManager = new LspManager();
