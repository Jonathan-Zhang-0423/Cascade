import type { Express } from "express";
import { createServer, type Server } from "http";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import "express-session";
import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, basename } from "path";
import { randomBytes } from "crypto";
import archiver from "archiver";
import { z } from "zod";
import { doubaoClient, DOUBAO_MODEL, DOUBAO_LITE_MODEL } from "./doubao-client";
import { withRetry } from "./retry";
import { compressMessages } from "./context-compressor";
import { storage } from "./storage";
import { insertProjectSchema, userSkills, projectSkills, insertUserSkillSchema, insertProjectSkillSchema } from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { getTemplateFiles } from "./templates";
import { detectFramework, getLanguageForFramework, getTargetPlatformForFramework, type Framework } from "./framework-detector";
import { getMobilePromptSupplement } from "./mobile-prompt-supplements";
import {
  EDITOR_AGENT_SYSTEM_PROMPT,
  EDITOR_CHAT_SYSTEM_PROMPT,
  buildEditorContextMessage,
  buildEditorChatContextMessage,
} from "./editor-prompt";
import {
  MANAGER_AGENT_SYSTEM_PROMPT,
  MANAGER_FIX_MODE_SYSTEM_PROMPT,
  buildManagerContextMessage,
  buildManagerFixPlanMessage,
} from "./manager-prompt";
import {
  VERIFIER_AGENT_SYSTEM_PROMPT,
  buildHolisticVerifierMessage,
} from "./verifier-prompt";
import { AB_TEST_SCENARIOS } from "./ab-test-scenarios";
import { runBuildSession, type BuildSessionState, type BufferedEvent } from "./build-orchestrator";
import { lspManager } from "./lsp-manager";
import { shellManager } from "./shell-manager";
import { detectSkillFromText, loadSkill, getSkillForFramework } from "./skill-loader";
import { runAgentLoop } from "./agent-loop";
import { buildManagerTools, type ManagerSessionState } from "./agent-tools";
import { getAIClient, getOptimalClient, type AIProvider } from "./kimi-client";
import { setupPreviewServer } from "./preview-server";
import { compileKotlinWasm, getArtifactPath, isCompilerAvailable, checkCompilerOnStartup } from "./kotlin-wasm-compiler";
import { compileSwiftWasm, getSwiftArtifactPath, isSwiftWasmAvailable, checkSwiftCompilerOnStartup } from "./swift-wasm-compiler";
import { compileRnWeb, getRnArtifactPath, getVendorPath, ensureVendorBundle } from "./rn-web-compiler";
import { compileFlutterWeb, getFlutterArtifactPath, isFlutterAvailable, checkFlutterOnStartup } from "./flutter-compiler";
import { runExploreAgent } from "./explore-agent";

function parseMarkdownCodeBlock(raw: string): {
  code: string;
  language: string;
} {
  const fenceMatch = raw.match(/^```(\w*)\s*\n?([\s\S]*?)```\s*$/);
  if (fenceMatch) {
    return { code: fenceMatch[2].trim(), language: fenceMatch[1] || "text" };
  }
  const partialMatch = raw.match(/^```(\w*)\s*\n?([\s\S]*)$/);
  if (partialMatch) {
    return {
      code: partialMatch[2].trim(),
      language: partialMatch[1] || "text",
    };
  }
  return { code: raw.trim(), language: "text" };
}

function normalizeFeatures(breakdowns: any[]): any[] {
  if (!Array.isArray(breakdowns)) return breakdowns;
  return breakdowns.map((fb: any) => {
    if (!fb || !Array.isArray(fb.features)) return fb;
    fb.features = fb.features.map((feat: any) => {
      if (!feat) return feat;

      if (!feat.explanation && feat.walkthrough) {
        feat.explanation = feat.walkthrough;
      }
      if (!feat.explanation) {
        feat.explanation = feat.label
          ? `This section covers the "${feat.label}" feature of the project.`
          : "";
      }

      if (!Array.isArray(feat.code_blocks) || feat.code_blocks.length === 0) {
        if (
          typeof feat.code_block === "string" &&
          feat.code_block.trim().length > 0
        ) {
          const { code, language } = parseMarkdownCodeBlock(feat.code_block);
          feat.code_blocks = [
            {
              code,
              language,
              walkthrough:
                typeof feat.walkthrough === "string" ? feat.walkthrough : "",
            },
          ];
        } else if (
          typeof feat.code === "string" &&
          feat.code.trim().length > 0
        ) {
          feat.code_blocks = [
            {
              code: feat.code.trim(),
              language:
                typeof feat.language === "string" ? feat.language : "text",
              walkthrough:
                typeof feat.walkthrough === "string" ? feat.walkthrough : "",
            },
          ];
        } else {
          feat.code_blocks = [];
        }
      } else {
        feat.code_blocks = feat.code_blocks.map((block: any) => {
          if (!block) return block;
          if (typeof block.code === "string" && block.code.includes("```")) {
            const { code, language } = parseMarkdownCodeBlock(block.code);
            block.code = code;
            if (!block.language || block.language === "text") {
              block.language = language;
            }
          }
          if (
            (!block.walkthrough ||
              (typeof block.walkthrough === "string" &&
                block.walkthrough.trim().length === 0)) &&
            typeof feat.walkthrough === "string" &&
            feat.walkthrough.trim().length > 0
          ) {
            block.walkthrough = feat.walkthrough;
          }
          return block;
        });
      }

      if (
        !feat.prompt_tip ||
        typeof feat.prompt_tip !== "string" ||
        feat.prompt_tip.trim().length === 0
      ) {
        feat.prompt_tip = "";
      }

      delete feat.code_block;
      delete feat.walkthrough;

      return feat;
    });
    return fb;
  });
}

function parseAIJson(raw: string): any {
  let text = raw
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();

  try {
    return JSON.parse(text);
  } catch {}

  const start = text.indexOf("{");
  const lastEnd = text.lastIndexOf("}");
  if (start >= 0 && lastEnd > start) {
    const extracted = text.substring(start, lastEnd + 1);
    try {
      return JSON.parse(extracted);
    } catch {}

    try {
      const sanitized = extracted
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
        .replace(/(?<=:\s*"(?:[^"\\]|\\.)*)(?<!\\)\\(?!["\\/bfnrtu])/g, "\\\\");
      return JSON.parse(sanitized);
    } catch {}

    try {
      let result = "";
      let inStr = false;
      let escape = false;
      for (let i = 0; i < extracted.length; i++) {
        const c = extracted[i];
        if (escape) {
          if ('"\\bfnrtu/'.includes(c)) {
            result += c;
          } else {
            result += "\\" + c;
          }
          escape = false;
          continue;
        }
        if (c === "\\") {
          result += c;
          escape = true;
          continue;
        }
        if (c === '"') {
          if (inStr) {
            const rest = extracted.substring(i + 1).trimStart();
            if (
              rest[0] === ":" ||
              rest[0] === "," ||
              rest[0] === "}" ||
              rest[0] === "]" ||
              rest.length === 0
            ) {
              inStr = false;
              result += c;
              continue;
            }
            result += '\\"';
            continue;
          }
          inStr = true;
          result += c;
          continue;
        }
        if (inStr && (c === "\n" || c === "\r")) {
          result += "\\n";
          continue;
        }
        result += c;
      }
      return JSON.parse(result);
    } catch {}
  }

  return null;
}

async function runEditorNonStreaming(
  userMessage: string,
  files: Array<{ path: string; content: string }>,
): Promise<{ output: string; latencyMs: number; charsInContext: number }> {
  const systemMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: EDITOR_AGENT_SYSTEM_PROMPT }];
  if (files.length > 0) {
    const contextMsg = buildEditorContextMessage(files);
    systemMessages.push({ role: "system", content: contextMsg });
    const charsInContext = contextMsg.length;
    const t0 = Date.now();
    const completion = await doubaoClient.chat.completions.create({
      model: DOUBAO_MODEL,
      messages: [...systemMessages, { role: "user", content: userMessage }],
      stream: false,
      max_tokens: 16384,
    });
    return {
      output: completion.choices[0]?.message?.content || "",
      latencyMs: Date.now() - t0,
      charsInContext,
    };
  }
  const t0 = Date.now();
  const completion = await doubaoClient.chat.completions.create({
    model: DOUBAO_MODEL,
    messages: [...systemMessages, { role: "user", content: userMessage }],
    stream: false,
    max_tokens: 16384,
  });
  return {
    output: completion.choices[0]?.message?.content || "",
    latencyMs: Date.now() - t0,
    charsInContext: 0,
  };
}

function detectUserLanguage(
  messages: Array<{ role: string; content: string }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].content) {
      const chineseRe = /[\u4e00-\u9fff]/;
      return chineseRe.test(messages[i].content) ? "Chinese" : "English";
    }
  }
  return "English";
}

// Run execution timeout (10 s) applied to every script/binary execution phase.
// Compiled languages use an additional compile-phase timeout before this.
// Output is capped at MAX_OUTPUT_BYTES; processes exceeding either limit are killed.
const EXEC_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

function spawnProcess(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let totalBytes = 0;

    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const accumulate = (chunks: Buffer[], d: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - totalBytes;
      if (remaining <= 0) return;
      const slice = remaining < d.length ? d.subarray(0, remaining) : d;
      chunks.push(slice);
      totalBytes += slice.length;
      if (totalBytes >= MAX_OUTPUT_BYTES) {
        try { child.kill("SIGKILL"); } catch {}
      }
    };

    child.stdout?.on("data", (d: Buffer) => accumulate(outChunks, d));
    child.stderr?.on("data", (d: Buffer) => accumulate(errChunks, d));

    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        try { child.kill("SIGKILL"); } catch {}
      }
    }, opts.timeout ?? EXEC_TIMEOUT_MS);

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

const buildSessions = new Map<string, BuildSessionState>();

interface ManagerChatSession {
  id: string;
  projectId?: string;
  events: Array<{ eventId: number; data: Record<string, unknown> }>;
  nextEventId: number;
  done: boolean;
  doneAt?: number;
  startedAt: number;
  sseWriters: Set<(line: string) => void>;
}

const managerChatSessions = new Map<string, ManagerChatSession>();

setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;
  const doneRetention = 30 * 60 * 1000;
  Array.from(buildSessions.entries()).forEach(([id, session]) => {
    if (session.done) {
      if (session.doneAt && now - session.doneAt > doneRetention) {
        buildSessions.delete(id);
      }
      return;
    }
    if ((session as any)._startedAt && now - (session as any)._startedAt > maxAge) {
      session.aborted = true;
      buildSessions.delete(id);
    }
  });
  Array.from(managerChatSessions.entries()).forEach(([id, session]) => {
    if (session.done) {
      if (session.doneAt && now - session.doneAt > doneRetention) {
        managerChatSessions.delete(id);
      }
      return;
    }
    if (now - session.startedAt > maxAge) {
      managerChatSessions.delete(id);
    }
  });
}, 60_000);

function createSessionEmit(session: BuildSessionState): SseEmit {
  return (data: Record<string, unknown>) => {
    const eventId = session.nextEventId++;
    const event: BufferedEvent = { eventId, data: { ...data, eventId } };
    session.events.push(event);
    const line = `data: ${JSON.stringify(event.data)}\n\n`;
    Array.from(session.sseWriters).forEach(writer => {
      try { writer(line); } catch {}
    });
  };
}

function attachSseWriter(session: BuildSessionState, res: any, lastEventId: number) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.socket?.setNoDelay?.(true);

  const replayHighWater = session.nextEventId;
  const sentEventIds = new Set<number>();

  const writer = (line: string) => {
    try {
      const match = line.match(/^data: (.+)$/);
      if (match) {
        const parsed = JSON.parse(match[1]);
        if (typeof parsed.eventId === "number" && parsed.eventId < replayHighWater) {
          return;
        }
        if (typeof parsed.eventId === "number") {
          if (sentEventIds.has(parsed.eventId)) return;
          sentEventIds.add(parsed.eventId);
        }
      }
      res.write(line); (res as any).flush?.();
    } catch {}
  };

  session.sseWriters.add(writer);

  const replayEvents = session.events.filter(e => e.eventId > lastEventId && e.eventId < replayHighWater);
  for (const event of replayEvents) {
    sentEventIds.add(event.eventId);
    try { res.write(`data: ${JSON.stringify({ ...event.data, replay: true })}\n\n`); (res as any).flush?.(); } catch {}
  }
  if (replayEvents.length > 0) {
    try { res.write(`data: ${JSON.stringify({ type: "replay_boundary" })}\n\n`); (res as any).flush?.(); } catch {}
  }

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); (res as any).flush?.(); } catch {}
  }, 2000);

  res.on("close", () => {
    session.sseWriters.delete(writer);
    clearInterval(heartbeat);
  });

  if (session.done) {
    setTimeout(() => {
      try { res.end(); } catch {}
    }, 100);
  }
}

type SseEmit = (data: Record<string, unknown>) => void;

type UserIntent = "build" | "question" | "fix" | "refine";

async function classifyIntent(
  messages: Array<{ role: string; content: string }>,
  client: OpenAI,
  model: string,
): Promise<UserIntent> {
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content ?? "";
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are an intent classifier. Classify the user's message into exactly one category:
- "build": user wants to create, add, change, or fix code/features
- "question": user is asking a question about code, concepts, or what something does
- "fix": user reports a bug or asks to fix a specific error
- "refine": user wants to modify or improve a previously described plan

Respond with ONLY valid JSON: {"intent": "build"|"question"|"fix"|"refine"}`,
        },
        { role: "user", content: lastUserMsg },
      ],
      stream: false,
      max_tokens: 20,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as { intent: UserIntent };
    if (["build", "question", "fix", "refine"].includes(parsed.intent)) {
      return parsed.intent;
    }
  } catch {}
  return "build"; // safe default
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  checkCompilerOnStartup();
  checkSwiftCompilerOnStartup();
  checkFlutterOnStartup();

  app.get("/api/providers", (_req, res) => {
    res.json({
      doubao: !!process.env.DOUBAO_API_KEY,
      kimi: !!process.env.KIMI_API_KEY,
      minimax: !!process.env.MINIMAX_API_KEY,
      glm: !!process.env.GLM_API_KEY,
    });
  });

  app.post("/api/build-session", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }
      const { sessionId, plan, userRequest, userLang, files, taskStatuses, userConfirmation, provider, framework: buildFramework, projectId: reqProjectId, userId: reqUserId } = req.body as {
        sessionId: string;
        plan: any;
        userRequest: string;
        userLang: string;
        files: Array<{ path: string; content: string }>;
        taskStatuses?: Record<string, string>;
        userConfirmation?: string;
        provider?: AIProvider;
        framework?: Framework;
        projectId?: string;
        userId?: string;
      };
      if (!sessionId || !plan || !userRequest) {
        res.status(400).json({ error: "sessionId, plan, and userRequest are required" });
        return;
      }
      const fileMap = new Map<string, string>();
      if (files && Array.isArray(files)) {
        for (const f of files) {
          fileMap.set(f.path, f.content);
        }
      }
      let resolvedFramework: Framework | undefined = buildFramework;
      if (!resolvedFramework && reqProjectId) {
        try {
          const projectRecord = await storage.getProject(reqProjectId);
          if (projectRecord?.framework) {
            resolvedFramework = projectRecord.framework as Framework;
          }
        } catch {}
      }

      const session: BuildSessionState & { _startedAt: number } = {
        id: sessionId,
        projectId: reqProjectId || undefined,
        userId: reqUserId || undefined,
        aborted: false,
        files: fileMap,
        plan,
        userRequest,
        userLang: userLang || "English",
        taskStatuses: taskStatuses || undefined,
        userConfirmation: userConfirmation || undefined,
        provider: provider || "doubao",
        framework: resolvedFramework,
        _startedAt: Date.now(),
        events: [],
        nextEventId: 0,
        done: false,
        sseWriters: new Set(),
        parts: [],
        status: { type: "idle" },
      };
      buildSessions.set(sessionId, session);

      const emit = createSessionEmit(session);

      attachSseWriter(session, res, -1);

      const buildPromise = runBuildSession(session, emit)
        .catch((err: any) => {
          emit({ type: "build_error", message: err?.message || "Unknown error" });
          emit({ type: "done" });
        })
        .finally(() => {
          session.done = true;
          session.doneAt = Date.now();
          // Clean up session directory
          if (session.sessionDir) {
            rm(session.sessionDir, { recursive: true, force: true }).catch(() => {});
          }
          // Stop LSP servers and shell session
          lspManager.stop(session.id).catch(() => {});
          shellManager.destroyShell(session.id).catch(() => {});
        });

      buildPromise.catch(() => {});

    } catch (error: any) {
      console.error("Build session error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Build session failed" });
      }
    }
  });

  app.get("/api/build-session/:sessionId/status", (req, res) => {
    const session = buildSessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({
      active: !session.done && !session.aborted,
      eventCount: session.events.length,
      done: session.done,
    });
  });

  app.get("/api/build-session/active/:projectId", (req, res) => {
    const projectId = req.params.projectId;
    const entries = Array.from(buildSessions.entries());
    const active = entries.find(([, s]) => s.projectId === projectId && !s.done && !s.aborted);
    if (active) {
      res.json({ sessionId: active[0], active: true, eventCount: active[1].events.length });
      return;
    }
    const done = entries.find(([, s]) => s.projectId === projectId && s.done && !s.aborted);
    if (done) {
      res.json({ sessionId: done[0], active: false, eventCount: done[1].events.length, done: true });
      return;
    }
    res.status(404).json({ error: "No active build session for this project" });
  });

  app.get("/api/build-session/:sessionId/stream", (req, res) => {
    const session = buildSessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const lastEventId = parseInt(req.query.lastEventId as string) ?? -1;
    attachSseWriter(session, res, isNaN(lastEventId) ? -1 : lastEventId);
  });

  app.delete("/api/build-session/:sessionId", (req, res) => {
    const session = buildSessions.get(req.params.sessionId);
    if (session) {
      session.aborted = true;
    }
    res.json({ ok: true });
  });

  app.get("/api/manager-chat/:sessionId/status", (req, res) => {
    const session = managerChatSessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({
      active: !session.done,
      done: session.done,
      eventCount: session.events.length,
      projectId: session.projectId || null,
    });
  });

  app.get("/api/manager-chat/active/:projectId", (req, res) => {
    const projectId = req.params.projectId;
    const entries = Array.from(managerChatSessions.entries());
    const active = entries.find(([, s]) => s.projectId === projectId && !s.done);
    if (active) {
      res.json({ sessionId: active[0], active: true, eventCount: active[1].events.length });
      return;
    }
    const done = entries.find(([, s]) => s.projectId === projectId && s.done);
    if (done) {
      res.json({ sessionId: done[0], active: false, eventCount: done[1].events.length, done: true });
      return;
    }
    res.status(404).json({ error: "No active manager session for this project" });
  });

  app.get("/api/manager-chat/:sessionId/stream", (req, res) => {
    const session = managerChatSessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const lastEventId = parseInt(req.query.lastEventId as string) ?? -1;
    const parsedLast = isNaN(lastEventId) ? -1 : lastEventId;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.socket?.setNoDelay?.(true);

    const writer = (line: string) => {
      try { res.write(line); (res as any).flush?.(); } catch {}
    };
    session.sseWriters.add(writer);

    for (const ev of session.events) {
      if (ev.eventId > parsedLast) {
        writer(`data: ${JSON.stringify(ev.data)}\n\n`);
      }
    }

    if (session.done) {
      writer("data: [DONE]\n\n");
      res.end();
      session.sseWriters.delete(writer);
      return;
    }

    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); (res as any).flush?.(); } catch {}
    }, 5000);

    res.on("close", () => {
      clearInterval(heartbeat);
      session.sseWriters.delete(writer);
    });
  });

  app.post("/api/manager-chat", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let mgrSessionId: string | undefined;
    let clientDisconnected = false;
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }
      const { messages, files, provider, framework: reqFramework, projectId: reqProjectId } = req.body as {
        messages: Array<{ role: "user" | "assistant"; content: string }>;
        files?: Array<{ path: string; content: string }>;
        provider?: AIProvider;
        framework?: Framework;
        projectId?: string;
      };
      const activeProvider: AIProvider = provider || "doubao";
      const { client: activeAIClient, model: activeAIModel } = getOptimalClient("planning", activeProvider);

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      mgrSessionId = `mgr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const mgrSession: ManagerChatSession = {
        id: mgrSessionId,
        projectId: reqProjectId,
        events: [],
        nextEventId: 0,
        done: false,
        startedAt: Date.now(),
        sseWriters: new Set(),
      };
      managerChatSessions.set(mgrSessionId, mgrSession);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      res.socket?.setNoDelay(true);

      const mgrWriter = (line: string) => {
        try { res.write(line); (res as any).flush?.(); } catch {}
      };
      mgrSession.sseWriters.add(mgrWriter);

      const emit = (data: Record<string, unknown>) => {
        const eventId = mgrSession.nextEventId++;
        const eventData = { ...data, eventId };
        mgrSession.events.push({ eventId, data: eventData });
        const line = `data: ${JSON.stringify(eventData)}\n\n`;
        Array.from(mgrSession.sseWriters).forEach(w => {
          try { w(line); } catch {}
        });
      };

      emit({ type: "session_id", sessionId: mgrSessionId });

      heartbeat = setInterval(() => {
        try { res.write(": heartbeat\n\n"); (res as any).flush?.(); } catch {}
      }, 5000);

      res.on("close", () => {
        clientDisconnected = true;
        mgrSession.sseWriters.delete(mgrWriter);
        if (heartbeat) { clearInterval(heartbeat); heartbeat = undefined; }
      });

      // Build system prompt — run independent async work in parallel
      const allConversationText = messages.map((m) => m.content).join(" ");

      const frameworkPromise = (async (): Promise<Framework | undefined> => {
        if (reqFramework) return reqFramework;
        if (!reqProjectId) return undefined;
        try {
          const projectRecord = await storage.getProject(reqProjectId);
          return projectRecord?.framework as Framework | undefined;
        } catch { return undefined; }
      })();

      const skillDetectionPromise = (async (): Promise<string | null> => {
        const fw = reqFramework;
        if (fw) {
          const fwSkill = getSkillForFramework(fw);
          if (fwSkill) return fwSkill;
        }
        return detectSkillFromText(allConversationText);
      })();

      const compressionPromise = compressMessages(messages);

      const [resolvedFramework, detectedSkillRaw, processedMessages] = await Promise.all([
        frameworkPromise,
        skillDetectionPromise,
        compressionPromise,
      ]);

      const detectedSkill = (resolvedFramework ? getSkillForFramework(resolvedFramework) : null) || detectedSkillRaw;

      // Detect user language and inject a strong language prefix so Chinese
      // LLMs respond in the user's language instead of defaulting to English.
      const detectedLang = detectUserLanguage(messages);
      const langLabel = detectedLang === "Chinese" ? "Chinese (中文)" : detectedLang;
      const isEnglish = detectedLang === "English";
      const langPrefix = isEnglish
        ? ""
        : `IMPORTANT: Write ALL narration, explanations, plan descriptions, and conversational text in ${langLabel}. Code identifiers, file paths, and code comments must remain in their original language.\n\n`;

      let systemPrompt = `${langPrefix}${MANAGER_AGENT_SYSTEM_PROMPT}`;
      if (files && files.length > 0) {
        const contextMsg = buildManagerContextMessage(files);
        systemPrompt = `${systemPrompt}\n\n${contextMsg}`;
      } else {
        systemPrompt = `${systemPrompt}\n\nThe project currently has no files.`;
      }

      if (detectedSkill) {
        const skillContent = await loadSkill(detectedSkill);
        if (skillContent) {
          systemPrompt = `${systemPrompt}\n\n## Technology Skill: ${detectedSkill}\n\nThe following skill guidance applies to this project. Use it to inform your planning and step descriptions:\n\n${skillContent}`;
        }
      }

      const resolvedManagerFramework = resolvedFramework || (files && files.length > 0 ? detectFramework(files) : "web");
      if (resolvedManagerFramework && resolvedManagerFramework !== "web") {
        const mobileSupplement = getMobilePromptSupplement("manager", resolvedManagerFramework);
        if (mobileSupplement) {
          systemPrompt = `${systemPrompt}\n${mobileSupplement}`;
        }
      }

      // Explore agent: parallel codebase scan — only for sessions with existing files
      // Fires concurrently; result injected into system prompt before planning.
      // Non-blocking: if it doesn't complete within 8s, planning proceeds without it.
      let exploreContext = "";
      if (files && files.length > 0) {
        const lastUserMsg = messages.filter(m => m.role === "user").slice(-1)[0]?.content ?? "";
        const explorePromise = runExploreAgent(files, lastUserMsg);
        const timeoutPromise = new Promise<string>(r => setTimeout(() => r(""), 8000));
        exploreContext = await Promise.race([explorePromise, timeoutPromise]);
      }

      if (exploreContext) {
        systemPrompt = `${systemPrompt}\n\n## Existing Codebase Context (from fast scan)\n${exploreContext}`;
      }

      const managerState: ManagerSessionState = {};
      const managerTools = buildManagerTools(managerState);

      // Fast intent classification — use MiniMax if available (fastest), else active provider
      const fastClientForIntent = process.env.MINIMAX_API_KEY
        ? getAIClient("minimax")
        : { client: activeAIClient, model: activeAIModel };
      const intent = await classifyIntent(processedMessages, fastClientForIntent.client, fastClientForIntent.model);

      // Question intent: answer directly without the full manager agent loop
      if (intent === "question") {
        try {
          const questionSystemPrompt = `${langPrefix}You are a helpful coding assistant. Answer the user's question clearly and concisely. Do not generate a plan or suggest building anything unless explicitly asked.`;
          const stream = await activeAIClient.chat.completions.create({
            model: activeAIModel,
            messages: [
              { role: "system", content: questionSystemPrompt },
              ...processedMessages,
            ],
            stream: true,
            max_tokens: 1024,
          });
          for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content;
            if (token) emit({ type: "raw_token", token });
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error("[Manager] Question answer error:", errMsg);
        }
        clearInterval(heartbeat);
        emit({ type: "manager_done" });
        mgrSession.done = true;
        mgrSession.doneAt = Date.now();
        const doneLine = "data: [DONE]\n\n";
        Array.from(mgrSession.sseWriters).forEach(w => { try { w(doneLine); } catch {} });
        if (!clientDisconnected) { try { res.end(); } catch {} }
        return;
      }

      const userMsgCount = processedMessages.filter(m => m.role === "user").length;
      // The manager prompt has its own 3-stage flow (Explore → Confirm → Plan)
      // that controls when the model uses tools. The model natively understands
      // whether the user is confirming, asking questions, or making a new request
      // — no hardcoded keyword list needed. We only use message count as a light
      // heuristic to save tokens on the very first turn (disable extended thinking,
      // limit to 1 iteration) since the first turn is almost always exploratory.
      const isFirstTurn = userMsgCount <= 1;

      const activeTools = managerTools.schemas;
      const activeHandlers = managerTools.handlers;
      const activeExitTools = ["submit_plan"];

      const emitRawToken = (data: Record<string, unknown>) => {
        if (data.type === "narration_token" && typeof data.token === "string") {
          emit({ type: "raw_token", token: data.token });
        } else if (data.type === "thinking_token" && typeof data.token === "string") {
          emit({ type: "thinking_token", token: data.token });
        } else if (data.type === "action_log") {
          emit({ type: "action_log", actionType: data.actionType, label: data.label, detail: data.detail });
        }
      };

      try {
        const result = await runAgentLoop(
          systemPrompt,
          processedMessages,
          activeTools,
          activeHandlers,
          emitRawToken,
          {
            exitTools: activeExitTools,
            maxIterations: isFirstTurn ? 1 : 10,
            client: activeAIClient,
            model: activeAIModel,
            disableThinking: isFirstTurn,
          },
        );

        clearInterval(heartbeat);

        if (result.exitTool === "submit_plan" && managerState.plan) {
          const plan = managerState.plan;
          const projectName = typeof result.exitArgs?.project_name === "string"
            ? result.exitArgs.project_name
            : undefined;

          emit({ type: "plan_preparing" });

          // Build narration from plan fields directly — no extra LLM call needed.
          // The manager already produces what_and_why/done_looks_like/out_of_scope in the user's language.
          emit({ type: "communicator_narration_starting" });
          const narratedLines: string[] = [];
          if (plan.what_and_why) narratedLines.push(String(plan.what_and_why));
          if (plan.done_looks_like) narratedLines.push(String(plan.done_looks_like));
          if (plan.out_of_scope) narratedLines.push(String(plan.out_of_scope));
          const narratedText = narratedLines.filter(Boolean).join("\n\n");
          if (narratedText) {
            emit({ type: "communicator_token", token: narratedText });
          }

          emit({ type: "plan_ready", plan, project_name: projectName, autoExecute: false });

          if (mgrSession.projectId) {
            storage.updateProjectPlan(mgrSession.projectId, plan).catch(() => {});
          }

          emit({ type: "manager_done" });
        } else {
          emit({ type: "manager_done" });
        }

        mgrSession.done = true;
        mgrSession.doneAt = Date.now();
        const doneLine = "data: [DONE]\n\n";
        Array.from(mgrSession.sseWriters).forEach(w => { try { w(doneLine); } catch {} });
        if (!clientDisconnected) { try { res.end(); } catch {} }
      } catch (err: unknown) {
        clearInterval(heartbeat);
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!clientDisconnected) {
          console.error("Manager agent loop error:", errMsg);
        }
        emit({ type: "manager_error" });
        mgrSession.done = true;
        mgrSession.doneAt = Date.now();
        const doneLine = "data: [DONE]\n\n";
        Array.from(mgrSession.sseWriters).forEach(w => { try { w(doneLine); } catch {} });
        if (!clientDisconnected) { try { res.end(); } catch {} }
      }
    } catch (error: any) {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      console.error("Manager chat API error:", error?.message || error);
      if (mgrSessionId && managerChatSessions.has(mgrSessionId)) {
        const s = managerChatSessions.get(mgrSessionId)!;
        s.done = true;
        s.doneAt = Date.now();
      }
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to get Manager response" });
      } else if (!clientDisconnected) {
        try {
          res.write(`data: ${JSON.stringify({ type: "manager_error" })}\n\n`);
          (res as any).flush?.();
          res.write("data: [DONE]\n\n");
          (res as any).flush?.();
          res.end();
        } catch {}
      }
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, files, provider } = req.body as {
        messages: Array<{ role: "user" | "assistant"; content: string }>;
        files?: Array<{ path: string; content: string }>;
        provider?: AIProvider;
      };

      const selectedProvider = provider ?? "doubao";
      const providerKeyMap: Record<string, string | undefined> = {
        doubao: process.env.DOUBAO_API_KEY,
        kimi: process.env.KIMI_API_KEY || process.env.DOUBAO_API_KEY,
        minimax: process.env.MINIMAX_API_KEY || process.env.DOUBAO_API_KEY,
        glm: process.env.GLM_API_KEY || process.env.DOUBAO_API_KEY,
      };
      if (!providerKeyMap[selectedProvider]) {
        res.status(500).json({ error: "AI service not configured" });
        return;
      }

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      const fileMap = new Map<string, string>();
      if (files) {
        for (const f of files) fileMap.set(f.path, f.content);
      }

      const contextMsg = buildEditorChatContextMessage(files || []);

      const systemPrompt = `${EDITOR_CHAT_SYSTEM_PROMPT}\n\n${contextMsg}`;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      res.socket?.setNoDelay(true);

      const emit = (data: Record<string, unknown>) => {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
          (res as any).flush?.();
        } catch {}
      };

      const chatToolSchemas: import("./agent-loop").ToolSchema[] = [
        {
          type: "function",
          function: {
            name: "write_file",
            description: "Write or overwrite a file in the project with the given content.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "The file path, e.g. /project/index.html" },
                content: { type: "string", description: "The complete file content to write" },
              },
              required: ["path", "content"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read the current content of a file from the project.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "The file path to read, e.g. /project/index.html" },
              },
              required: ["path"],
            },
          },
        },
      ];

      const chatToolHandlers: Record<string, import("./agent-loop").ToolHandler> = {
        write_file: async (args, toolEmit) => {
          const path = args.path as string;
          const content = args.content as string;
          if (!path || typeof content !== "string") return "Error: path and content are required";
          const fileName = path.split("/").pop() || path;
          fileMap.set(path, content);
          toolEmit({ type: "action_log", actionType: "file_write", label: fileName, detail: content, filePath: path });
          toolEmit({ type: "code_applied", filePath: path, code: content });
          return `File written successfully: ${path} (${content.length} chars)`;
        },
        read_file: async (args, toolEmit) => {
          const path = args.path as string;
          if (!path) return "Error: path is required";
          const fileName = path.split("/").pop() || path;
          const content = fileMap.get(path);
          toolEmit({ type: "action_log", actionType: "file_read", label: fileName, detail: content ?? "", filePath: path });
          if (content === undefined) {
            return `File not found: ${path}. Available files: ${Array.from(fileMap.keys()).join(", ") || "(none)"}`;
          }
          return `File: ${path}\n\n${content}`;
        },
      };

      const { client: aiClient, model: aiModel } = getAIClient(selectedProvider);

      await runAgentLoop(
        systemPrompt,
        messages,
        chatToolSchemas,
        chatToolHandlers,
        emit,
        { maxIterations: 10, client: aiClient, model: aiModel },
      );

      res.write("data: [DONE]\n\n");
      (res as any).flush?.();
      res.end();
    } catch (error: any) {
      console.error("Chat API error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to get chat response" });
      } else {
        try {
          res.write("data: [DONE]\n\n");
          (res as any).flush?.();
          res.end();
        } catch {}
      }
    }
  });

  app.post("/api/verifier-holistic", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }

      const {
        user_request,
        plan_steps,
        files_before,
        files_after,
        user_feedback,
        framework: verifierFramework,
      } = req.body as {
        user_request: string;
        plan_steps: Array<{
          step: number;
          title: string;
          description: string;
          acceptance_criteria?: string;
        }>;
        files_before: Array<{ path: string; content: string }>;
        files_after: Array<{ path: string; content: string }>;
        user_feedback?: string;
        framework?: Framework;
      };

      if (!user_request || !plan_steps || !files_after) {
        res
          .status(400)
          .json({
            error: "user_request, plan_steps, and files_after are required",
          });
        return;
      }

      let contextMessage = buildHolisticVerifierMessage(
        user_request,
        plan_steps,
        files_before || [],
        files_after,
      );

      if (user_feedback) {
        contextMessage += `\n\n--- USER FEEDBACK ---\nThe user provided the following feedback on a previous review:\n${user_feedback}\nPlease take this into account in your review.`;
      }

      const resolvedVerifierFramework = verifierFramework || (files_after && files_after.length > 0 ? detectFramework(files_after) : "web");
      let verifierSystemPrompt = VERIFIER_AGENT_SYSTEM_PROMPT;
      if (resolvedVerifierFramework && resolvedVerifierFramework !== "web") {
        const mobileSupplement = getMobilePromptSupplement("verifier", resolvedVerifierFramework);
        if (mobileSupplement) {
          verifierSystemPrompt = `${verifierSystemPrompt}\n${mobileSupplement}`;
        }
      }

      const messages: Array<{ role: "system" | "user"; content: string }> = [
        { role: "system", content: verifierSystemPrompt },
        { role: "user", content: contextMessage },
      ];

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_MODEL,
        messages,
        stream: false,
        max_tokens: 16384,
      });

      const responseContent = completion.choices[0]?.message?.content || "";

      const review = parseAIJson(responseContent);
      if (!review) {
        res.json({
          raw: responseContent,
          error: "Verifier did not return valid JSON",
        });
        return;
      }

      res.json({ review });
    } catch (error: any) {
      console.error("Holistic verifier API error:", error?.message || error);
      res
        .status(500)
        .json({ error: error?.message || "Failed to get holistic review" });
    }
  });

  app.post("/api/manager-fix-plan", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }

      const { files, bug_report, original_request } = req.body as {
        files: Array<{ path: string; content: string }>;
        bug_report: {
          bugs: Array<{
            id: string;
            severity: string;
            file: string;
            description: string;
            expected: string;
            actual: string;
          }>;
          missing_features: Array<{
            id: string;
            description: string;
            related_step: number;
          }>;
          regressions: Array<{ id: string; file: string; description: string }>;
          summary: string;
          suggestion: string;
        };
        original_request: string;
      };

      if (!bug_report || !original_request) {
        res
          .status(400)
          .json({ error: "bug_report and original_request are required" });
        return;
      }

      const contextMessage = buildManagerFixPlanMessage(
        files || [],
        bug_report,
        original_request,
      );

      const messages: Array<{ role: "system" | "user"; content: string }> = [
        { role: "system", content: MANAGER_FIX_MODE_SYSTEM_PROMPT },
        { role: "user", content: contextMessage },
      ];

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_MODEL,
        messages,
        stream: false,
        max_tokens: 16384,
      });

      const responseContent = completion.choices[0]?.message?.content || "";

      const plan = parseAIJson(responseContent);
      if (!plan) {
        res.json({
          raw: responseContent,
          error: "Manager did not return valid fix plan JSON",
        });
        return;
      }

      res.json({ plan });
    } catch (error: any) {
      console.error("Manager fix plan API error:", error?.message || error);
      res
        .status(500)
        .json({ error: error?.message || "Failed to get fix plan" });
    }
  });


  app.post("/api/smart-response", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "AI service not configured" });
        return;
      }

      const { messages, mode, language = "English" } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages are required" });
        return;
      }

      const systemPrompt = `You MUST respond only in ${language}.

You are a smart response generator for a beginner-friendly coding assistant app.

Given a conversation between a user and an AI coding assistant, your job is to generate the most helpful and natural response that the USER would likely want to send next.

Rules:
- Output ONLY the user's response text — no explanations, no quotes, no meta-commentary
- Keep it concise and direct (1–4 sentences)
- You MUST write your response in ${language} only
- Address exactly what the AI assistant just asked, proposed, or explained
- Write in first person as the user (e.g. "I want...", "Yes, please...", "Let's go with...")
- For choices or yes/no questions, pick the most sensible option and briefly explain why
- Sound like a real beginner who is enthusiastic and wants to move forward
${mode === "manager" ? "- This is a planning conversation, so the response should be about confirming direction, adding requirements, or asking for clarification" : "- This is a building conversation, so the response should be about what to build or change"}`;

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_LITE_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          {
            role: "user",
            content: language === "Chinese"
              ? "[请为我生成一条发送给助手的建议回复。只输出回复文本本身。]"
              : "[Generate a suggested response for me to send to the assistant. Output only the response text itself.]",
          },
        ],
        stream: false,
        max_tokens: 400,
      });

      const suggestion = completion.choices[0]?.message?.content?.trim() || "";
      res.json({ suggestion });
    } catch (error: any) {
      console.error("Smart response API error:", error?.message || error);
      res
        .status(500)
        .json({ error: error?.message || "Failed to generate smart response" });
    }
  });

  app.post("/api/ab-test", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }

      function buildEditorPrompt(step: {
        sub_task_id: string;
        title: string;
        description: string;
        acceptance_criteria: string;
      }): string {
        return [
          `[Plan Mode] You are executing subtask ${step.sub_task_id}: ${step.title}`,
          `Task description: ${step.description}`,
          `Acceptance criteria: ${step.acceptance_criteria}`,
          ``,
          `IMPORTANT: You are modifying existing project files. You MUST preserve ALL existing content. Only add, modify, or remove what is specifically described in this task. When outputting a file, include the COMPLETE file with all its original content plus your changes — never omit or rewrite existing code that is not part of this task.`,
          ``,
          `Please implement the above subtask. Focus only on this specific task and ensure the acceptance criteria are met.`,
        ].join("\n");
      }

      function applyEditorOutput(
        output: string,
        initialFiles: { path: string; content: string }[],
      ): { path: string; content: string }[] {
        const regex = /```(\w*)\s+file="([^"]+)"\n([\s\S]*?)```/g;
        const updates = new Map<string, string>();
        let match;
        while ((match = regex.exec(output)) !== null) {
          updates.set(match[2], match[3].trimEnd());
        }
        const result = initialFiles.map((f) => ({
          path: f.path,
          content: updates.get(f.path) ?? f.content,
        }));
        for (const [path, content] of updates) {
          if (!result.find((f) => f.path === path)) {
            result.push({ path, content });
          }
        }
        return result;
      }

      async function runVerifierOnOutput(
        userRequest: string,
        step: {
          step: number;
          title: string;
          description: string;
          acceptance_criteria: string;
        },
        filesBefore: { path: string; content: string }[],
        filesAfter: { path: string; content: string }[],
        expectedOutput?: string,
      ): Promise<{
        status: "pass" | "fail";
        matchPercent: number;
        summary: string;
      }> {
        let contextMsg = buildHolisticVerifierMessage(
          userRequest,
          [
            {
              step: step.step,
              title: step.title,
              description: step.description,
              acceptance_criteria: step.acceptance_criteria,
            },
          ],
          filesBefore,
          filesAfter,
        );
        if (expectedOutput) {
          contextMsg += `\n\n--- EXPECTED OUTPUT NOTES ---\n${expectedOutput}`;
        }
        const completion = await doubaoClient.chat.completions.create({
          model: DOUBAO_MODEL,
          messages: [
            { role: "system", content: VERIFIER_AGENT_SYSTEM_PROMPT },
            { role: "user", content: contextMsg },
          ],
          stream: false,
          max_tokens: 16384,
        });
        const review = parseAIJson(
          completion.choices[0]?.message?.content || "",
        );
        if (!review)
          return {
            status: "fail",
            matchPercent: 0,
            summary: "Verifier returned invalid JSON",
          };
        return {
          status: review.overall_status === "pass" ? "pass" : "fail",
          matchPercent:
            typeof review.requirement_match_percent === "number"
              ? review.requirement_match_percent
              : 0,
          summary: typeof review.summary === "string" ? review.summary : "",
        };
      }

      const scenarioResults = await Promise.all(
        AB_TEST_SCENARIOS.map(async (scenario) => {
          const step = scenario.plan.steps[0];
          const prompt = buildEditorPrompt(step);

          const variantBFiles = scenario.initialFiles.filter((f) =>
            step.required_files.includes(f.path),
          );

          const [variantA, variantB] = await Promise.all([
            runEditorNonStreaming(prompt, scenario.initialFiles),
            runEditorNonStreaming(
              prompt,
              variantBFiles.length > 0 ? variantBFiles : scenario.initialFiles,
            ),
          ]);

          const filesAfterA = applyEditorOutput(
            variantA.output,
            scenario.initialFiles,
          );
          const filesAfterB = applyEditorOutput(
            variantB.output,
            scenario.initialFiles,
          );

          const [reviewA, reviewB] = await Promise.all([
            runVerifierOnOutput(
              scenario.userRequest,
              step,
              scenario.initialFiles,
              filesAfterA,
              scenario.expectedOutput,
            ),
            runVerifierOnOutput(
              scenario.userRequest,
              step,
              scenario.initialFiles,
              filesAfterB,
              scenario.expectedOutput,
            ),
          ]);

          return {
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            scenarioDescription: scenario.description,
            variantA: {
              filesCount: scenario.initialFiles.length,
              charsInContext: variantA.charsInContext,
              latencyMs: variantA.latencyMs,
              verifierStatus: reviewA.status,
              matchPercent: reviewA.matchPercent,
              summary: reviewA.summary,
              rawOutput: variantA.output,
            },
            variantB: {
              filesCount:
                variantBFiles.length > 0
                  ? variantBFiles.length
                  : scenario.initialFiles.length,
              charsInContext: variantB.charsInContext,
              latencyMs: variantB.latencyMs,
              verifierStatus: reviewB.status,
              matchPercent: reviewB.matchPercent,
              summary: reviewB.summary,
              rawOutput: variantB.output,
            },
          };
        }),
      );

      res.json({ results: scenarioResults });
    } catch (error: any) {
      console.error("A/B test API error:", error?.message || error);
      res
        .status(500)
        .json({ error: error?.message || "Failed to run A/B test" });
    }
  });

  app.post("/api/generate-project-name", async (req, res) => {
    try {
      const { idea, framework } = req.body as { idea?: string; framework?: string };
      if (!idea) {
        res.status(400).json({ error: "idea is required" });
        return;
      }
      const { client: nameClient } = getOptimalClient("planning", "doubao");
      const frameworkHint = framework && framework !== "web" ? ` (${framework} app)` : "";
      const completion = await nameClient.chat.completions.create({
        model: DOUBAO_LITE_MODEL,
        messages: [
          {
            role: "user",
            content: `Generate a short project name (2-4 words, title case) for this app idea${frameworkHint}:\n\n"${idea}"\n\nRespond with ONLY the project name, nothing else.`,
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

  app.post("/api/generate-cascade", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }

      const { plan, userPrompt, projectName, currentFiles } = req.body as {
        plan: any;
        userPrompt: string;
        projectName?: string;
        currentFiles?: { path: string; content: string }[];
      };

      if (!plan || !userPrompt) {
        res.status(400).json({ error: "plan and userPrompt are required" });
        return;
      }

      const systemPrompt = `You are a technical documentation writer. Generate a cascade.md file for a software project. Use both the project plan AND the actual current file tree to produce an accurate, up-to-date architecture document.

Output ONLY valid markdown — no JSON, no extra text, no code fences wrapping the whole document.

The document MUST have exactly these four fixed sections, plus additional project-specific sections:

## Overview
3-5 sentences describing what this project is and what it does.

## User Preferences
List any preferences or constraints expressed in the user prompt: language, framework, style, color scheme, design constraints, etc. Use bullet points.

## System Architecture
Describe the actual frontend approach, file structure, core design patterns, and how key parts connect — based on the real files if provided. Use bullet points or sub-sections.

## External Dependencies
List all libraries, frameworks, APIs, or browser APIs used. Derive from actual file contents when available (e.g. <script src="...">, import statements). Use a markdown list.

Then add 1-4 additional sections with meaningful names specific to this project. Good examples:
- ## Authentication Model (if auth is involved)
- ## Data Flow (for interactive apps)
- ## Game Loop (for games)
- ## Scoring System (for games with scores)
- ## State Management (for complex state)
- ## Animation Strategy (for visual effects)

Do NOT use a generic catch-all like "## Additional Notes". Each section name must be specific and meaningful.

Keep the document concise but informative. Use technical language appropriate for a developer.
If current files are provided, prioritize them over the plan for describing actual architecture and dependencies.`;

      const stepsText = Array.isArray(plan.steps)
        ? plan.steps.map((s: any) => `- Step ${s.step}: ${s.title}: ${s.description}`).join("\n")
        : "";

      let filesContext = "";
      if (currentFiles && currentFiles.length > 0) {
        const nonCascade = currentFiles.filter(f => !f.path.endsWith("cascade.md"));
        const fileSummaries = nonCascade.slice(0, 10).map(f => {
          const preview = f.content.slice(0, 400).replace(/\n+/g, " ").trim();
          return `### ${f.path}\n${preview}${f.content.length > 400 ? "..." : ""}`;
        }).join("\n\n");
        if (fileSummaries) {
          filesContext = `\n\nCurrent Project Files (actual implementation):\n${fileSummaries}`;
        }
      }

      const userMessage = `Project: ${projectName || "Untitled"}
      
User Request: ${userPrompt}

Plan Overview: ${plan.overview || plan.summary || ""}

What & Why: ${plan.what_and_why || ""}

Done Looks Like: ${plan.done_looks_like || ""}

Plan Steps:
${stepsText}

Relevant Files from Plan: ${(plan.relevant_files || []).join(", ")}
${filesContext}

Generate the cascade.md content for this project based on both the plan and the actual current files.`;

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream: false,
        max_tokens: 4096,
      });

      const content = completion.choices[0]?.message?.content || "";
      res.json({ content });
    } catch (error: any) {
      console.error("Generate cascade error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to generate cascade.md" });
    }
  });

  app.get("/api/projects", async (req, res) => {
    try {
      const allProjects = await storage.getProjects();
      res.json({ projects: allProjects });
    } catch (error: any) {
      console.error("Get projects error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to get projects" });
    }
  });

  const createProjectSchema = insertProjectSchema;

  const updateProjectSchema = z.object({ name: z.string().min(1) });

  const projectFilesSchema = z.object({
    files: z.array(z.object({ path: z.string().min(1), content: z.string() })),
  });

  const singleFileSchema = z.object({ path: z.string().min(1), content: z.string() });

  const deleteFileSchema = z.object({ path: z.string().min(1) });

  app.post("/api/projects", async (req, res) => {
    try {
      const parsed = createProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const { id, name, emoji, framework: rawFramework } = parsed.data;
      const framework = (rawFramework || "web") as Framework;
      const language = getLanguageForFramework(framework);
      const targetPlatform = getTargetPlatformForFramework(framework);

      const project = await storage.createProject({
        id,
        name,
        emoji: emoji ?? null,
        framework,
        language,
        targetPlatform,
      });

      // Initialize files from template
      const templateFiles = getTemplateFiles(framework);
      if (templateFiles.length > 0) {
        await storage.upsertProjectFiles(
          id,
          templateFiles.map((f) => ({ path: f.path, content: f.content }))
        );
      }

      res.json({ project });
    } catch (error: any) {
      console.error("Create project error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to create project" });
    }
  });

  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const parsed = updateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await storage.updateProjectName(req.params.id, parsed.data.name);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Update project error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to update project" });
    }
  });

  app.get("/api/projects/:id/plan", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (!project.lastPlan) {
        res.json({ plan: null });
        return;
      }
      res.json({ plan: JSON.parse(project.lastPlan) });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to get plan" });
    }
  });

  app.get("/api/projects/:id/build-result", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (!project.lastBuildResult) {
        res.json({ result: null });
        return;
      }
      res.json({ result: JSON.parse(project.lastBuildResult) });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to get build result" });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      await storage.deleteProject(req.params.id);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Delete project error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to delete project" });
    }
  });

  app.get("/api/projects/:id/files", async (req, res) => {
    try {
      const projectId = req.params.id;
      let files = await storage.getProjectFiles(projectId);

      const project = await storage.getProject(projectId);
      if (project && project.framework && project.framework !== "web") {
        const paths = files.map((f: { path: string }) => f.path);
        const webSignatures = new Set([
          "/project/index.html", "/project/style.css", "/project/app.js",
          "/project/script.js", "/project/cascade.md",
        ]);
        const hasOnlyWebFiles = paths.length > 0 && paths.every((p: string) => webSignatures.has(p));
        if (hasOnlyWebFiles) {
          const templateFiles = getTemplateFiles(project.framework as Framework);
          if (templateFiles.length > 0) {
            await storage.upsertProjectFiles(
              projectId,
              templateFiles.map((f) => ({ path: f.path, content: f.content }))
            );
            const templatePaths = new Set(templateFiles.map((t) => t.path));
            for (const wp of paths) {
              if (!templatePaths.has(wp)) {
                await storage.deleteProjectFile(projectId, wp);
              }
            }
            files = await storage.getProjectFiles(projectId);
            console.log(`Repaired corrupted ${project.framework} project ${projectId}: replaced web files with framework templates`);
          }
        }
      }

      res.json({ files });
    } catch (error: any) {
      console.error("Get project files error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to get project files" });
    }
  });

  app.put("/api/projects/:id/files", async (req, res) => {
    try {
      const parsed = projectFilesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await storage.upsertProjectFiles(req.params.id, parsed.data.files);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Upsert project files error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to save files" });
    }
  });

  app.put("/api/projects/:id/files/single", async (req, res) => {
    try {
      const parsed = singleFileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await storage.upsertProjectFile(req.params.id, parsed.data.path, parsed.data.content);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Upsert project file error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to save file" });
    }
  });

  app.delete("/api/projects/:id/files", async (req, res) => {
    try {
      const parsed = deleteFileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await storage.deleteProjectFile(req.params.id, parsed.data.path);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Delete project file error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to delete file" });
    }
  });

  app.get("/api/projects/:id/export", async (req, res) => {
    try {
      const files = await storage.getProjectFiles(req.params.id);
      if (!files || files.length === 0) {
        res.status(404).json({ error: "No files found for this project" });
        return;
      }

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="project-${req.params.id}.zip"`);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err: Error) => {
        console.error("Archive error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to create archive" });
        }
      });
      archive.pipe(res);

      for (const file of files) {
        let relativePath = file.path.replace(/^\/project\//, "");
        if (!relativePath) continue;
        relativePath = relativePath.split("/").filter((seg) => seg !== ".." && seg !== "." && seg !== "").join("/");
        if (!relativePath || relativePath.startsWith("/")) continue;
        archive.append(file.content, { name: relativePath });
      }

      await archive.finalize();
    } catch (error: any) {
      console.error("Export project error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to export project" });
      }
    }
  });

  // ── Multi-language code execution ──────────────────────────────────────────
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

      const artifactDir = getArtifactPath(buildId) || getSwiftArtifactPath(buildId) || getRnArtifactPath(buildId) || getFlutterArtifactPath(buildId);
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

  // === AUTH ===

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { username, password, experienceLevel = "intermediate" } = req.body as {
        username: string; password: string; experienceLevel?: string;
      };
      if (!username?.trim() || !password) return res.status(400).json({ error: "username and password required" });
      const existing = await storage.getUserByUsername(username.trim());
      if (existing) return res.status(409).json({ error: "Username already taken" });

      const hashed = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username: username.trim(), password: hashed, experienceLevel: experienceLevel as "beginner" | "intermediate" | "advanced" });

      // Seed starter skill based on experience level
      const safeLevel = ["beginner", "intermediate", "advanced"].includes(experienceLevel)
        ? experienceLevel
        : "intermediate";
      const starterPath = join(process.cwd(), "server", "skills", "starters", `${safeLevel}.md`);
      if (existsSync(starterPath)) {
        const content = readFileSync(starterPath, "utf-8");
        await db.insert(userSkills).values({
          userId: user.id,
          name: `starter-${safeLevel}`,
          description: `Starter guidance for ${safeLevel} developers`,
          type: "knowledge",
          content,
          enabled: true,
        }).onConflictDoNothing();
      }

      (req.session as any).userId = user.id;
      res.status(201).json({ id: user.id, username: user.username, experienceLevel: (user as any).experienceLevel });
    } catch (err) {
      console.error("[auth/register]", err);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body as { username: string; password: string };
      if (!username || !password) return res.status(400).json({ error: "username and password required" });
      const user = await storage.getUserByUsername(username.trim());
      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(401).json({ error: "Invalid credentials" });
      (req.session as any).userId = user.id;
      res.json({ id: user.id, username: user.username, experienceLevel: (user as any).experienceLevel });
    } catch (err) {
      console.error("[auth/login]", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ id: user.id, username: user.username, experienceLevel: (user as any).experienceLevel });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) console.error("[auth/logout]", err);
      res.status(204).end();
    });
  });

  // === SKILLS API ===

  // User Skills
  app.get("/api/skills/user", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const skills = await db.select().from(userSkills).where(eq(userSkills.userId, userId));
      res.json(skills);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/skills/user", async (req, res) => {
    try {
      const userId = req.body?.userId as string;
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const { name, description, type, content, enabled } = req.body;
      const parsed = insertUserSkillSchema.safeParse({ userId, name, description, type, content, enabled });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
      const [created] = await db.insert(userSkills).values(parsed.data).returning();
      res.status(201).json(created);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put("/api/skills/user/:id", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const { name, description, type, content, enabled } = req.body;
      const updateData = { name, description, type, content, enabled };
      const cleanUpdate = Object.fromEntries(Object.entries(updateData).filter(([, v]) => v !== undefined));
      if (Object.keys(cleanUpdate).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }
      const [updated] = await db
        .update(userSkills)
        .set(cleanUpdate)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/skills/user/:id", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const [deleted] = await db
        .delete(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .returning();
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.status(204).end();
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Project Skills
  app.get("/api/skills/project/:projectId", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const skills = await db
        .select()
        .from(projectSkills)
        .where(and(eq(projectSkills.projectId, req.params.projectId), eq(projectSkills.userId, userId)));
      res.json(skills);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/skills/project/:projectId", async (req, res) => {
    try {
      const userId = req.body?.userId as string;
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const { name, description, type, content, enabled } = req.body;
      const parsed = insertProjectSkillSchema.safeParse({
        projectId: req.params.projectId,
        userId,
        name,
        description,
        type,
        content,
        enabled,
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
      const [created] = await db.insert(projectSkills).values(parsed.data).returning();
      res.status(201).json(created);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put("/api/skills/project/:projectId/:id", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const { name, description, type, content, enabled } = req.body;
      const updateData = { name, description, type, content, enabled };
      const cleanUpdate = Object.fromEntries(Object.entries(updateData).filter(([, v]) => v !== undefined));
      if (Object.keys(cleanUpdate).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }
      const [updated] = await db
        .update(projectSkills)
        .set(cleanUpdate)
        .where(
          and(
            eq(projectSkills.id, id),
            eq(projectSkills.projectId, req.params.projectId),
            eq(projectSkills.userId, userId),
          ),
        )
        .returning();
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/skills/project/:projectId/:id", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const [deleted] = await db
        .delete(projectSkills)
        .where(
          and(
            eq(projectSkills.id, id),
            eq(projectSkills.projectId, req.params.projectId),
            eq(projectSkills.userId, userId),
          ),
        )
        .returning();
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.status(204).end();
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // === BUILTIN SKILLS ===

  app.get("/api/skills/builtin", (_req, res) => {
    try {
      const skillsDir = join(process.cwd(), "server", "skills");
      const entries: Array<{ name: string; description: string; type: "knowledge" }> = [];

      const scanDir = (dir: string) => {
        if (!existsSync(dir)) return;
        for (const file of readdirSync(dir)) {
          const full = join(dir, file);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            if (file === "starters") continue; // skip internal seeding files
            scanDir(full);
            continue;
          }
          if (!file.endsWith(".md")) continue;
          const stem = file.replace(/\.md$/, "");
          // Use parent directory name when filename is a generic placeholder like "SKILL"
          const name = stem === "SKILL" ? basename(dir) : stem;
          // Read only first 200 bytes to find the heading — avoids loading full file
          const fd = openSync(full, "r");
          const buf = Buffer.alloc(200);
          const bytesRead = readSync(fd, buf, 0, 200, 0);
          closeSync(fd);
          const firstLine = buf.subarray(0, bytesRead).toString("utf-8").split("\n").find((l) => l.startsWith("# "));
          const description = firstLine ? firstLine.replace(/^#\s*/, "") : name;
          entries.push({ name, description, type: "knowledge" });
        }
      };

      scanDir(skillsDir);
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  setupPreviewServer(httpServer, app);

  return httpServer;
}
