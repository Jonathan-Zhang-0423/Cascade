import type { Express } from "express";
import { createServer, type Server } from "http";
import https from "https";
import OpenAI from "openai";
import "express-session";
import cookieParser from "cookie-parser";
import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, basename } from "path";
import { randomBytes } from "crypto";
import multer from "multer";
import { z } from "zod";
// @ts-ignore
import helmet from "helmet";
import { createSecurity } from "../middleware/security";
import { requireInviteCode, checkCaptcha, checkAdmin } from "../middleware/auth-middleware";
import { registerNotificationRoutes } from "./notifications";
import { registerReferralRoutes } from "./referral";
import { registerWaitlistRoutes } from "./waitlist";
import { registerSkillsRoutes } from "./skills";
import { registerCompileRoutes } from "./compile";
import { registerProjectsRoutes } from "./projects";
import { registerCodeExecRoutes } from "./code-exec";
import { registerMiscRoutes } from "./misc";
import { registerAuthRoutes } from "./auth";
import { registerAdminRoutes } from "./admin";
import {
  isEduEmail, isQizhiEmail, getTrialInfo, inviteCodePrefix,
  formatInviteCode,
} from "../services/invite-service";
import { doubaoClient, DOUBAO_MODEL, DOUBAO_LITE_MODEL } from "../../agent/providers/doubao-client";
import { withRetry } from "../../agent/providers/retry";
import { compressMessages } from "../../infra/context-compressor";
import { storage } from "../../infra/storage";
import { srcDir } from "../../infra/paths";
import { spawnProcess } from "../../infra/process-exec";
import { userSessions } from "../../infra/concurrency";
import type { ChatMessageInput } from "../../infra/storage";
import { users, projects, chatMessages, otpCodes, chatSessions, userFeedback, changelogEntries, notifications, publishedApps, appLikes, appComments } from "@cascade/database";
import { aigcSessions, runAigcAgent, type AigcSession } from "../../agent/aigc/aigc-agent";
import { db, pool } from "../../infra/db";
import { eq, and, desc, count, isNull, or, sql } from "drizzle-orm";
import { sendEmail } from "../../infra/email";
import { detectFramework, getLanguageForFramework, getTargetPlatformForFramework, type Framework } from "../../compiler/framework-detector";
import { getMobilePromptSupplement } from "../../agent/prompts/mobile-prompt-supplements";
import {
  EDITOR_AGENT_SYSTEM_PROMPT,
  EDITOR_CHAT_SYSTEM_PROMPT,
  buildEditorContextMessage,
  buildEditorChatContextMessage,
} from "../../agent/prompts/editor-prompt";
import {
  MANAGER_AGENT_SYSTEM_PROMPT,
  MANAGER_FIX_MODE_SYSTEM_PROMPT,
  buildManagerContextMessage,
  buildManagerFixPlanMessage,
} from "../../agent/prompts/manager-prompt";
import {
  VERIFIER_AGENT_SYSTEM_PROMPT,
  buildHolisticVerifierMessage,
} from "../../agent/prompts/verifier-prompt";
import { AB_TEST_SCENARIOS } from "../ab-test-scenarios";
import { runBuildSession, type BuildSessionState, type BufferedEvent, type BuildStep } from "../../agent/orchestrator/build-orchestrator";
import { runReviewSession, type ReviewSessionState } from "../../agent/orchestrator/review-orchestrator";
import type { ReviewStrictness } from "../../agent/prompts/verifier-prompt";
import { lspManager } from "../../agent/tools/lsp-manager";
import { shellManager } from "../../agent/tools/shell-manager";
import { detectSkillFromText, loadSkill, getSkillForFramework } from "../../skills/loader";
import { detectCapabilitiesDetailed, loadCapabilitiesTiered } from "../../skills/capability-loader";
import { runAgentLoop, type ToolSchema, type ToolHandler } from "../../agent/loop/agent-loop";
import { buildManagerTools, type ManagerSessionState } from "../../agent/tools/agent-tools";
import { getAIClient, getOptimalClient, type AIProvider } from "../../agent/providers/kimi-client";
import { setupPreviewServer } from "../../compiler/preview-server";
import { runExploreAgent } from "../../agent/orchestrator/explore-agent";
import { videoStorage } from "../../infra/video-storage";
import { addVideoWatermark } from "../../infra/watermark";
import { executeDslSequence, validateDslSequence } from "../video/dsl-executor";
import { McpManager } from "../../agent/mcp/mcp-client";
import { loadMcpConfig, getBuiltinMcpConfig, type McpConfig } from "../../agent/mcp/mcp-config";
import { buildMcpTools, getMcpToolNames } from "../../agent/mcp/mcp-tools";
import { runResearchAgent, sanitizeResearchResult } from "../../agent/mcp/research-agent";
import { registerAdminAuthRoutes } from "../../auth/admin-routes.js";
import { adminAuthMiddleware } from "../../auth/admin-auth.js";

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


const buildSessions = new Map<string, BuildSessionState>();

interface VideoJobState {
  status: "pending" | "running" | "done" | "error";
  progress: number;
  outputPath: string | null;
  error: string | null;
  finishedAt: number | null;
  duration: 10 | 20 | 30;
}
const videoJobs = new Map<string, VideoJobState>();

interface ManagerChatSession {
  id: string;
  projectId?: string;
  events: Array<{ eventId: number; data: Record<string, unknown> }>;
  nextEventId: number;
  done: boolean;
  doneAt?: number;
  startedAt: number;
  _userId?: string;
  sseWriters: Set<(line: string) => void>;
}

const managerChatSessions = new Map<string, ManagerChatSession>();

const reviewSessions = new Map<string, ReviewSessionState>();

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
      // Force-release session slot for stuck sessions
      if ((session as any)._userId) userSessions.unregister((session as any)._userId, id);
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
      // Force-release session slot for stuck manager sessions
      if ((session as any)._userId) userSessions.unregister((session as any)._userId, id);
      managerChatSessions.delete(id);
    }
  });
  Array.from(reviewSessions.entries()).forEach(([id, session]) => {
    if (session.done) {
      if (session.doneAt && now - session.doneAt > doneRetention) {
        reviewSessions.delete(id);
      }
      return;
    }
    if (session._startedAt && now - session._startedAt > maxAge) {
      session.aborted = true;
      // Force-release session slot for stuck review sessions
      if ((session as any)._userId) userSessions.unregister((session as any)._userId, id);
      reviewSessions.delete(id);
    }
  });
  // Also clean old sessions from DB
  storage.deleteOldManagerSessions(maxAge).catch(() => {});
  // Clean completed video jobs older than 10 minutes
  const videoRetention = 10 * 60 * 1000;
  Array.from(videoJobs.entries()).forEach(([id, job]) => {
    if ((job.status === "done" || job.status === "error") && job.finishedAt && now - job.finishedAt > videoRetention) {
      if (job.outputPath) rm(job.outputPath, { force: true }).catch(() => {});
      videoJobs.delete(id);
    }
  });
}, 60_000);

interface SseCapableSession {
  nextEventId: number;
  events: BufferedEvent[];
  sseWriters: Set<(data: string) => void>;
  done: boolean;
}

function createSessionEmit(session: SseCapableSession): SseEmit {
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

function attachSseWriter(session: SseCapableSession, res: any, lastEventId: number) {
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

  // ── Cookie parser (needed for JWT admin cookies) ────────────────────────────
  app.use(cookieParser());

  // ── Admin JWT auth routes + middleware ──────────────────────────────────────
  registerAdminAuthRoutes(app);
  app.use("/api/admin", adminAuthMiddleware);
  app.use("/api/waitlist", adminAuthMiddleware);

  // ── Security: Helmet ────────────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }));

  // Security: IP blocklist, account lockout, and rate limiters. Extracted to
  // middleware/security.ts — createSecurity mounts the IP-block middleware +
  // /api/auth rate limiters and exposes admin controls on app locals.
  const security = createSecurity(app);
  const { recordLoginFail, isAccountLocked, clearAccountLockout, getLockout, MAX_FAIL } = security;

  // Misc structural routes: /api/providers, /api/concurrency, /api/config/captcha,
  // POST /api/feedback — see routes/misc.ts.
  registerMiscRoutes(app);

  // ── Security: invite-code gate ──────────────────────────────────────────────
  // Front-end guards the invite gate, but the core endpoints (project creation,
  // planning, building) must independently enforce it: the session must be
  // authenticated AND the user must have redeemed an invite code. Without this,
  // a logged-in but un-gated user (e.g. a brand-new GitHub-only signup) could hit
  // these APIs directly. Returns 401 if unauthenticated, 403 if no invite code.
  // Temporary debug endpoint — receives client-side trace from BuildStreamInstance
  app.post("/api/_dbg", (req, res) => {
    const msg = req.body?.msg || "";
    console.log("[client-dbg]", msg);
    res.status(204).end();
  });

  app.post("/api/build-session", requireInviteCode, async (req, res) => {
    let _userId: string | undefined;
    let _sessionId: string | undefined;
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }
      const {
        sessionId, plan, userRequest, userLang, files, taskStatuses, userConfirmation,
        provider, framework: buildFramework, projectId: reqProjectId, userId: reqUserId,
        mode: reqMode, userMessage,
      } = req.body as {
        sessionId: string;
        plan?: any;
        userRequest?: string;
        userLang: string;
        files: Array<{ path: string; content: string }>;
        taskStatuses?: Record<string, string>;
        userConfirmation?: string;
        provider?: AIProvider;
        framework?: Framework;
        projectId?: string;
        userId?: string;
        mode?: "plan" | "direct";
        userMessage?: string;
      };

      // Per-user session cap
      _userId = reqUserId;
      _sessionId = sessionId;
      if (reqUserId && !userSessions.register(reqUserId, sessionId)) {
        res.status(429).json({ error: "Too many active sessions. Please wait for a running build to finish." });
        return;
      }

      const resolvedMode: "plan" | "direct" = reqMode || (plan ? "plan" : "direct");

      if (resolvedMode === "plan") {
        if (!sessionId || !plan || !userRequest) {
          res.status(400).json({ error: "sessionId, plan, and userRequest are required" });
          return;
        }
      } else {
        if (!sessionId || !userMessage) {
          res.status(400).json({ error: "sessionId and userMessage are required for direct mode" });
          return;
        }
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

      let resolvedPlan: any = plan;
      let resolvedUserRequest = userRequest ?? "";

      if (resolvedMode === "direct") {
        // Run ExploreAgent (same as plan mode) with 8s timeout to gather codebase context
        let exploreContext = "";
        if (files && files.length > 0) {
          const explorePromise = runExploreAgent(files, userMessage!);
          const timeoutPromise = new Promise<string>(r => setTimeout(() => r(""), 8000));
          exploreContext = await Promise.race([explorePromise, timeoutPromise]);
        }
        // Synthesize a single-step plan so we can reuse the entire builder pipeline
        resolvedPlan = {
          mode: "direct",
          summary: userMessage!,
          steps: [{
            step: 1,
            title: userMessage!.length > 80 ? userMessage!.slice(0, 80) + "…" : userMessage!,
            description: exploreContext
              ? `${userMessage}\n\n## Codebase context (fast scan)\n${exploreContext}`
              : userMessage!,
          }],
        };
        resolvedUserRequest = userMessage!;
      }

      const session: BuildSessionState & { _startedAt: number } = {
        id: sessionId,
        projectId: reqProjectId || undefined,
        userId: reqUserId || undefined,
        aborted: false,
        files: fileMap,
        plan: resolvedPlan,
        userRequest: resolvedUserRequest,
        userLang: userLang || "English",
        taskStatuses: taskStatuses || undefined,
        userConfirmation: userConfirmation || undefined,
        provider: provider || "glm",
        framework: resolvedFramework,
        mode: resolvedMode,
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
          // Send [DONE] frame and close all connected SSE writers so clients
          // detect end-of-stream cleanly (matching what manager-chat does).
          const doneLine = "data: [DONE]\n\n";
          Array.from(session.sseWriters).forEach(w => { try { w(doneLine); } catch {} });
          // Unregister from per-user session tracker
          if (reqUserId) userSessions.unregister(reqUserId, sessionId);
          // Clean up session directory
          if (session.sessionDir) {
            rm(session.sessionDir, { recursive: true, force: true }).catch(() => {});
          }
          // Stop LSP servers and shell session
          lspManager.stop(session.id).catch(() => {});
          shellManager.destroyShell(session.id).catch(() => {});
          // Evict session from memory after 30 minutes to prevent unbounded growth
          setTimeout(() => {
            buildSessions.delete(session.id);
          }, 30 * 60 * 1000);
        });

      buildPromise.catch(() => {});

    } catch (error: any) {
      console.error("Build session error:", error?.message || error);
      // Release session slot on setup errors — prevents permanent slot leak
      if (_userId && _sessionId) userSessions.unregister(_userId, _sessionId);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Build session failed" });
      }
    }
  });

  app.get("/api/build-session/:sessionId/status", (req, res) => {
    const session = buildSessions.get(req.params.sessionId);
    console.log(`[build-status] sessionId=${req.params.sessionId} found=${!!session} done=${session?.done} aborted=${(session as any)?.aborted} mapSize=${buildSessions.size}`);
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

  // Pre-register a build session ID so that a page refresh during the main
  // POST (which carries the full file payload) can still find the session via
  // the status endpoint. The main POST will overwrite this placeholder with the
  // real session data.
  app.post("/api/build-session/pre-register", (req, res) => {
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }
    if (!buildSessions.has(sessionId)) {
      buildSessions.set(sessionId, {
        id: sessionId,
        aborted: false,
        files: new Map(),
        plan: { steps: [] },
        userRequest: "",
        userLang: "English",
        mode: "direct",
        _startedAt: Date.now(),
        events: [],
        nextEventId: 0,
        done: false,
        sseWriters: new Set(),
        parts: [],
        status: { type: "idle" },
      } as any);
    }
    res.json({ ok: true });
  });

  app.post("/api/build-session/:sessionId/console-event", (req, res) => {
    const session = buildSessions.get(req.params.sessionId);
    if (!session || session.done || session.aborted) {
      res.status(404).json({ error: "Session not found or already done" });
      return;
    }
    const { level, message } = req.body as { level?: string; message?: string };
    if (!level || !message) {
      res.status(400).json({ error: "level and message are required" });
      return;
    }
    if (!session.consoleEvents) session.consoleEvents = [];
    // Only capture errors and warnings — ignore log/info noise
    if (level === "error" || level === "warn") {
      session.consoleEvents.push({ level, message, timestamp: Date.now() });
    }
    res.json({ ok: true });
  });

  app.get("/api/build-session/active/:projectId", (req, res) => {
    const projectId = req.params.projectId;
    const entries = Array.from(buildSessions.entries());
    const active = entries.find(([, s]) => s.projectId === projectId && !s.done && !s.aborted);
    if (active) {
      res.json({ sessionId: active[0], active: true, eventCount: active[1].events.length });
      return;
    }
    // No active session — do NOT fall back to a done session here. The caller
    // (mount-time auto-reconnect) treats any 200 as "reconnect this", which
    // would re-enter executing state for an already-finished build and lock
    // the Build button. Done-session reconnects use the explicit per-session
    // status endpoint instead.
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

  app.post("/api/build-session/:sessionId/input", (req, res) => {
    const session = buildSessions.get(req.params.sessionId);
    if (!session || session.done || session.aborted) {
      res.status(404).json({ error: "Session not found or already done" });
      return;
    }
    const { userInput } = req.body as { userInput?: string };
    session.userConfirmation = userInput || "";
    session.pendingUserInputResolve?.();
    session.pendingUserInputResolve = undefined;
    res.json({ ok: true });
  });

  // ─── Standalone review step (plan + build + REVIEW) ──────────────────────
  // Mirrors /api/build-session but runs the verify→fix→re-verify loop quietly
  // (no needs_input) and reports once. See review-orchestrator.ts.
  app.post("/api/review-session", async (req, res) => {
    let _reviewUserId: string | undefined;
    let _reviewSessionId: string | undefined;
    try {
      const hasAnyProvider = !!(process.env.GLM_API_KEY || process.env.DOUBAO_API_KEY || process.env.KIMI_API_KEY || process.env.MINIMAX_API_KEY);
      if (!hasAnyProvider) {
        res.status(500).json({ error: "No AI provider is configured" });
        return;
      }
      const {
        sessionId, files, userRequest, planSteps, userLang,
        provider, framework: reqFramework, projectId: reqProjectId, strictness,
      } = req.body as {
        sessionId: string;
        files: Array<{ path: string; content: string }>;
        userRequest?: string;
        planSteps?: BuildStep[];
        userLang?: string;
        provider?: AIProvider;
        framework?: Framework;
        projectId?: string;
        strictness?: ReviewStrictness;
      };

      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }

      const reqUserId = (req.session as any)?.userId as string | undefined;
      _reviewUserId = reqUserId;
      _reviewSessionId = sessionId;
      if (reqUserId && !userSessions.register(reqUserId, sessionId)) {
        res.status(429).json({ error: "Too many active sessions. Please wait for a running session to finish." });
        return;
      }

      const fileMap = new Map<string, string>();
      if (Array.isArray(files)) {
        for (const f of files) fileMap.set(f.path, f.content);
      }

      let resolvedFramework: Framework | undefined = reqFramework;
      if (!resolvedFramework && reqProjectId) {
        try {
          const projectRecord = await storage.getProject(reqProjectId);
          if (projectRecord?.framework) resolvedFramework = projectRecord.framework as Framework;
        } catch {}
      }

      const resolvedStrictness: ReviewStrictness =
        strictness === "lenient" || strictness === "strict" ? strictness : "balanced";

      const session: ReviewSessionState = {
        id: sessionId,
        projectId: reqProjectId || undefined,
        userId: reqUserId || undefined,
        aborted: false,
        files: fileMap,
        userRequest: userRequest || "",
        planSteps: Array.isArray(planSteps) && planSteps.length > 0 ? planSteps : undefined,
        userLang: userLang || "English",
        provider: provider || "glm",
        framework: resolvedFramework,
        strictness: resolvedStrictness,
        events: [],
        nextEventId: 0,
        done: false,
        sseWriters: new Set(),
        parts: [],
        status: { type: "idle" },
        _startedAt: Date.now(),
      };
      reviewSessions.set(sessionId, session);

      const emit = createSessionEmit(session);
      attachSseWriter(session, res, -1);

      runReviewSession(session, emit)
        .catch((err: any) => {
          emit({ type: "review_error", message: err?.message || "Unknown error" });
          emit({ type: "done" });
        })
        .finally(() => {
          session.done = true;
          session.doneAt = Date.now();
          if (reqUserId) userSessions.unregister(reqUserId, sessionId);
          if (session.sessionDir) {
            rm(session.sessionDir, { recursive: true, force: true }).catch(() => {});
          }
          lspManager.stop(session.id).catch(() => {});
          shellManager.destroyShell(session.id).catch(() => {});
        });
    } catch (error: any) {
      // Release session slot on setup errors — prevents permanent slot leak
      if (_reviewUserId && _reviewSessionId) userSessions.unregister(_reviewUserId, _reviewSessionId);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Review session failed" });
      }
    }
  });

  app.get("/api/review-session/:sessionId/status", (req, res) => {
    const session = reviewSessions.get(req.params.sessionId);
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

  app.get("/api/review-session/active/:projectId", (req, res) => {
    const projectId = req.params.projectId;
    const active = Array.from(reviewSessions.entries())
      .find(([, s]) => s.projectId === projectId && !s.done && !s.aborted);
    if (active) {
      res.json({ sessionId: active[0], active: true, eventCount: active[1].events.length });
      return;
    }
    res.status(404).json({ error: "No active review session for this project" });
  });

  app.get("/api/review-session/:sessionId/stream", (req, res) => {
    const session = reviewSessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const lastEventId = parseInt(req.query.lastEventId as string);
    attachSseWriter(session, res, isNaN(lastEventId) ? -1 : lastEventId);
  });

  app.delete("/api/review-session/:sessionId", (req, res) => {
    const session = reviewSessions.get(req.params.sessionId);
    if (session) session.aborted = true;
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

  app.get("/api/manager-chat/active/:projectId", async (req, res) => {
    const projectId = req.params.projectId;
    // Check in-memory first (fast path)
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
    // Fallback: check DB for sessions that survived a restart
    try {
      const dbSession = await storage.getActiveManagerSessionForProject(projectId);
      if (dbSession) {
        // Rehydrate into memory so /stream endpoint can serve it
        const events = JSON.parse(dbSession.events || "[]");
        const rehydrated: ManagerChatSession = {
          id: dbSession.id,
          projectId: dbSession.projectId ?? undefined,
          events,
          nextEventId: dbSession.nextEventId,
          done: dbSession.done,
          doneAt: dbSession.doneAt ?? undefined,
          startedAt: dbSession.startedAt,
          sseWriters: new Set(),
        };
        managerChatSessions.set(dbSession.id, rehydrated);
        res.json({ sessionId: dbSession.id, active: !dbSession.done, eventCount: events.length, done: dbSession.done });
        return;
      }
    } catch {}
    res.status(404).json({ error: "No active manager session for this project" });
  });

  app.get("/api/manager-chat/:sessionId/stream", async (req, res) => {
    let session = managerChatSessions.get(req.params.sessionId);
    // If not in memory, try rehydrating from DB (post-restart scenario)
    if (!session) {
      try {
        const dbRow = await storage.getManagerSession(req.params.sessionId);
        if (dbRow) {
          const events = JSON.parse(dbRow.events || "[]");
          session = {
            id: dbRow.id,
            projectId: dbRow.projectId ?? undefined,
            events,
            nextEventId: dbRow.nextEventId,
            done: dbRow.done,
            doneAt: dbRow.doneAt ?? undefined,
            startedAt: dbRow.startedAt,
            sseWriters: new Set(),
          };
          managerChatSessions.set(dbRow.id, session);
        }
      } catch {}
    }
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

  app.post("/api/manager-chat", requireInviteCode, async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let mgrSessionId: string | undefined;
    let clientDisconnected = false;
    const reqUserId = (req.session as any)?.userId as string | undefined;
    try {
      const hasAnyProvider = !!(process.env.GLM_API_KEY || process.env.DOUBAO_API_KEY || process.env.KIMI_API_KEY || process.env.MINIMAX_API_KEY);
      if (!hasAnyProvider) {
        res.status(500).json({ error: "No AI provider is configured (set GLM_API_KEY, DOUBAO_API_KEY, KIMI_API_KEY, or MINIMAX_API_KEY)" });
        return;
      }
      const { messages, files, provider, framework: reqFramework, projectId: reqProjectId, chatSessionId: reqChatSessionId } = req.body as {
        messages: Array<{ role: "user" | "assistant"; content: string }>;
        files?: Array<{ path: string; content: string }>;
        provider?: AIProvider;
        framework?: Framework;
        projectId?: string;
        chatSessionId?: string;
      };
      // chatSessionId: 前端传的当前 chat 会话 id，null/undefined/"" 均归 "main"
      const reqChatSession = (reqChatSessionId && reqChatSessionId !== "") ? reqChatSessionId : "main";
      const activeProvider: AIProvider = provider || "glm";
      // Planning uses Kimi for stable task decomposition; fallback via getOptimalClient
      const { client: activeAIClient, model: activeAIModel } = getOptimalClient("planning", "kimi");

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      mgrSessionId = `mgr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Per-user session cap for manager chat
      if (reqUserId && !userSessions.register(reqUserId, mgrSessionId)) {
        res.status(429).json({ error: "Too many active sessions. Please wait for a running session to finish." });
        return;
      }

      const mgrSession: ManagerChatSession = {
        id: mgrSessionId,
        projectId: reqProjectId,
        events: [],
        nextEventId: 0,
        done: false,
        startedAt: Date.now(),
        _userId: reqUserId || undefined,
        sseWriters: new Set(),
      };
      managerChatSessions.set(mgrSessionId, mgrSession);

      // Persist session to DB so it survives server restarts
      storage.upsertManagerSession({
        id: mgrSession.id,
        projectId: mgrSession.projectId,
        done: false,
        startedAt: mgrSession.startedAt,
        nextEventId: 0,
        events: [],
      }).catch((err) => console.warn("[manager-chat] failed to persist session start:", err));

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

      // Inject current date so the model has accurate time awareness
      const now = new Date();
      systemPrompt += `\n\n## Current Date\n\nToday is ${now.toISOString().split("T")[0]} (${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}). Use this when making decisions about library versions, API compatibility, or anything time-sensitive.`;

      // Per-project self-evolving memory — authoritative context from past sessions.
      if (reqProjectId) {
        try {
          const memory = await storage.getProjectMemory(reqProjectId);
          if (memory.trim()) {
            systemPrompt = `${systemPrompt}\n\n## Project Memory (learned from past sessions)\n\nAccumulated project-specific knowledge from previous sessions — past bugs and fixes, the architecture/tools in use, gotchas. Use it to plan better and avoid repeating mistakes. If you learn something durable, call update_project_memory.\n\n${memory.trim()}`;
          }
        } catch (err) {
          console.warn("[manager-chat] getProjectMemory failed:", err instanceof Error ? err.message : err);
        }
      }

      const isNewProject = !files || files.length === 0;
      if (files && files.length > 0) {
        const contextMsg = buildManagerContextMessage(files);
        systemPrompt = `${systemPrompt}\n\n${contextMsg}`;
      } else {
        systemPrompt = `${systemPrompt}\n\nThe project currently has no files.

## SESSION OVERRIDE — ONE-SHOT MODE (new empty project)
This is a brand-new empty project. The user's first message IS the spec. Skip Stage 2 and go directly to Stage 3:
- Do NOT produce a confirmation summary asking "does this match what you want?".
- Pick the most reasonable interpretation of the request and call submit_plan immediately.
- Fall back to Stage 1 (ask 1–2 clarifying questions) ONLY if the message is completely uninterpretable (e.g., "做个东西", "help me").
This override applies to THIS message only — it does not change behavior for projects that already have files.`;
      }

      if (detectedSkill) {
        const skillContent = await loadSkill(detectedSkill);
        if (skillContent) {
          systemPrompt = `${systemPrompt}\n\n## Technology Skill: ${detectedSkill}\n\nThe following skill guidance applies to this project. Use it to inform your planning and step descriptions:\n\n${skillContent}`;
        }
      }

      // Capability skills (game/frontend design, feature completion, completeness
      // checks, ...) — keyword-detected, no LLM call, appended additively so they
      // never compete with the tech-stack skill above.
      const detectedCapMatches = await detectCapabilitiesDetailed(allConversationText);
      if (detectedCapMatches.length > 0) {
        console.log(
          `[manager-chat] capability skills active: ${detectedCapMatches
            .map((m) => `${m.name}[${m.tier}](score=${m.score} via ${m.matched.slice(0, 3).join(",")})`)
            .join("; ")}`,
        );
        const capContent = await loadCapabilitiesTiered(detectedCapMatches);
        if (capContent) {
          systemPrompt = `${systemPrompt}\n\n## Capability Skills (MANDATORY)\n\nThe following capability guidance is in scope for this request. You MUST apply these patterns in your plan and step descriptions — treat them as hard requirements, not suggestions. Full entries give complete guidance; "(digest)" entries are supporting concerns — apply their checklist. If a capability's checklist applies, every item must be addressed:\n\n${capContent}`;
          // Surface which capabilities were activated so the client can show it.
          emit({ type: "capabilities_active", capabilities: detectedCapMatches.map((m) => ({ name: m.name, score: m.score, tier: m.tier })) });
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
      const managerTools = buildManagerTools(managerState, { projectId: reqProjectId, userId: reqUserId });

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
        if (reqUserId && mgrSessionId) userSessions.unregister(reqUserId, mgrSessionId);
        const doneLine = "data: [DONE]\n\n";
        Array.from(mgrSession.sseWriters).forEach(w => { try { w(doneLine); } catch {} });
        if (!clientDisconnected) { try { res.end(); } catch {} }
        return;
      }



      const activeTools = managerTools.schemas;
      const activeHandlers = managerTools.handlers;
      const activeExitTools = ["submit_plan"];

      // MCP: Always start built-in search; merge user config on top.
      // Gives the planner access to web search and research capabilities.
      let mgrMcpManager: McpManager | null = null;
      try {
        const builtinConfig = getBuiltinMcpConfig();
        let userConfig: McpConfig | null = null;
        if (files && files.length > 0) {
          const filesMap = new Map(files.map(f => [f.path.replace(/^\/project\//, ""), f.content]));
          userConfig = loadMcpConfig({ files: filesMap });
        }
        const mergedConfig: McpConfig = {
          servers: { ...builtinConfig.servers, ...(userConfig?.servers ?? {}) },
        };

        mgrMcpManager = new McpManager();
        await mgrMcpManager.connect(mergedConfig);
        if (mgrMcpManager.getAvailableTools().length > 0) {
          const mcpTools = buildMcpTools(mgrMcpManager, emit);
          activeTools.push(...mcpTools.schemas);
          Object.assign(activeHandlers, mcpTools.handlers);

          // Register research tool for the manager
          activeTools.push({
            type: "function",
            function: {
              name: "research",
              description: "Search the web for current information to inform your planning. Use when you need to look up latest APIs, library versions, best practices, or technical details before creating the plan.",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The research question — be specific.",
                  },
                },
                required: ["query"],
              },
            },
          });
          const capturedMgr = mgrMcpManager;
          activeHandlers["research"] = async (args, emitFn) => {
            const query = args.query as string;
            if (!query) return "Error: query is required";
            emitFn({ type: "action_log", actionType: "research", label: "Research", detail: query.slice(0, 100) });
            const result = await runResearchAgent(query, capturedMgr, emitFn);
            // Emit research result summary so the UI shows completion
            const wordCount = result ? result.split(/\s+/).length : 0;
            const sourceCount = (result?.match(/https?:\/\//g) || []).length;
            const summaryLine = sourceCount > 0
              ? `Found ${sourceCount} source(s), ${wordCount} words`
              : `${wordCount} words`;
            emitFn({ type: "action_log", actionType: "research", label: "Research complete", detail: summaryLine });
            const sanitized = sanitizeResearchResult(result);
            return sanitized || "(No findings)";
          };

          // Add MCP guidance to system prompt
          const mcpToolNames = getMcpToolNames(mgrMcpManager);
          systemPrompt += `\n\n## External Research Tools (MCP)

You have access to web research tools. **Use them proactively** — do NOT rely solely on your training data for version-specific or time-sensitive information.

Available tools: ${mcpToolNames.join(", ")}, research

### When to call research(query):
- The user mentions a specific library/framework version (e.g. "Tailwind v4", "Next.js 15")
- The user asks for "latest" or "newest" anything
- You need to reference current API syntax, config formats, or install commands
- You are unsure whether a package/API has changed since your training cutoff

### CRITICAL: Research results are INTERNAL context only
The output from research() is raw reference material for YOUR use only. NEVER paste, quote, or dump research results into your reply to the user. Instead, digest the findings silently and use them to produce a better plan. If you need to mention what you learned, summarize it in 1-2 sentences naturally within your response.

**Your training data has a knowledge cutoff. Today is ${new Date().toISOString().split("T")[0]}.** If the user is asking about recent technology, ALWAYS research first before planning. A wrong plan based on outdated knowledge wastes the entire build cycle.`;
        }
      } catch (err) {
        console.warn("[manager-chat] MCP setup failed:", err instanceof Error ? err.message : err);
        mgrMcpManager = null;
      }

      const emitRawToken = (data: Record<string, unknown>) => {
        if (data.type === "narration_token" && typeof data.token === "string") {
          emit({ type: "raw_token", token: data.token });
        } else if (data.type === "thinking_token" && typeof data.token === "string") {
          emit({ type: "thinking_token", token: data.token });
        } else if (data.type === "action_log") {
          emit({ type: "action_log", actionType: data.actionType, label: data.label, detail: data.detail, filePath: data.filePath });
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
            maxIterations: 10,
            client: activeAIClient,
            model: activeAIModel,
          },
        );

        clearInterval(heartbeat);

        if (result.exitTool === "submit_plan" && managerState.plan) {
          const plan = managerState.plan;
          // Defense in depth: even though submit_plan's handler rejects empty
          // steps, an older code path / different tool wiring could still
          // produce a plan with no steps. If we shipped that to the client,
          // the plan card would render as "0/0 done" with no way to retry.
          // Surface a manager_error instead so the user knows to re-send.
          const planSteps = (plan as { steps?: unknown }).steps;
          if (!Array.isArray(planSteps) || planSteps.length === 0) {
            console.warn("[manager-chat] submit_plan produced empty steps; surfacing as manager_error");
            emit({ type: "manager_error", reason: "empty_plan" });
          } else {
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
          }

          emit({ type: "manager_done" });
        } else if (result.exitTool === "submit_plan" && !managerState.plan) {
          // submit_plan was called but the handler refused (e.g. empty steps).
          // Tell the client so the UI can prompt the user to retry instead of
          // silently ending the chat with no plan card and no error.
          console.warn("[manager-chat] submit_plan exit but plan was rejected by handler");
          emit({ type: "manager_error", reason: "empty_plan" });
          // manager_done must still be emitted so the client's parseSseStream
          // receives [DONE] and the loading state is released.
          emit({ type: "manager_done" });
        } else {
          emit({ type: "manager_done" });
        }

        mgrSession.done = true;
        mgrSession.doneAt = Date.now();
        if (reqUserId && mgrSessionId) userSessions.unregister(reqUserId, mgrSessionId);
        // Clean up MCP connections
        if (mgrMcpManager) mgrMcpManager.disconnect().catch(() => {});
        // Persist final state to DB (events + done flag)
        storage.upsertManagerSession({
          id: mgrSession.id,
          projectId: mgrSession.projectId,
          done: true,
          startedAt: mgrSession.startedAt,
          doneAt: mgrSession.doneAt,
          nextEventId: mgrSession.nextEventId,
          events: mgrSession.events,
        }).catch((err) => console.warn("[manager-chat] failed to persist session done:", err));
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
        if (reqUserId && mgrSessionId) userSessions.unregister(reqUserId, mgrSessionId);
        // Clean up MCP connections on error
        if (mgrMcpManager) mgrMcpManager.disconnect().catch(() => {});
        // Persist error state to DB
        storage.upsertManagerSession({
          id: mgrSession.id,
          projectId: mgrSession.projectId,
          done: true,
          startedAt: mgrSession.startedAt,
          doneAt: mgrSession.doneAt,
          nextEventId: mgrSession.nextEventId,
          events: mgrSession.events,
        }).catch((err2) => console.warn("[manager-chat] failed to persist session error:", err2));
        const doneLine = "data: [DONE]\n\n";
        Array.from(mgrSession.sseWriters).forEach(w => { try { w(doneLine); } catch {} });
        if (!clientDisconnected) { try { res.end(); } catch {} }
      }
    } catch (error: any) {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      console.error("Manager chat API error:", error?.message || error);
      // Release session slot on error — prevents permanent slot leak
      if (reqUserId && mgrSessionId) userSessions.unregister(reqUserId, mgrSessionId);
      if (mgrSessionId && managerChatSessions.has(mgrSessionId)) {
        const s = managerChatSessions.get(mgrSessionId)!;
        s.done = true;
        s.doneAt = Date.now();
      }
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to get Manager response" });
      } else {
        // Headers already sent — always write [DONE] so the client's parseSseStream
        // terminates regardless of whether the browser connection is still open.
        try {
          res.write(`data: ${JSON.stringify({ type: "manager_error" })}\n\n`);
          (res as any).flush?.();
          res.write("data: [DONE]\n\n");
          (res as any).flush?.();
          if (!clientDisconnected) res.end();
        } catch {}
      }
    }
  });

  // DEPRECATED: superseded by /api/build-session direct mode. Retained for rollback
  // safety; no frontend caller as of the build-mode redesign. Schedule for removal
  // once direct-mode has been stable in production.
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, files, provider } = req.body as {
        messages: Array<{ role: "user" | "assistant"; content: string }>;
        files?: Array<{ path: string; content: string }>;
        provider?: AIProvider;
      };

      const selectedProvider = provider ?? "glm";
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

      const chatToolSchemas: ToolSchema[] = [
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

      const chatToolHandlers: Record<string, ToolHandler> = {
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

You are a smart response generator for a professional coding assistant app.

Given a conversation between a user and an AI coding assistant, generate the most appropriate response the USER would likely want to send next.

Rules:
- Output ONLY the user's response text — no explanations, no quotes, no meta-commentary
- Keep it concise and direct (1–3 sentences)
- You MUST write your response in ${language} only
- Address exactly what the AI assistant just asked, proposed, or explained
- Write in first person as the user (e.g. "I'd like to...", "Yes, proceed with...", "Let's use...")
- For choices or yes/no questions, pick the most sensible option with a brief rationale
- Maintain a professional, precise tone — clear intent, no filler phrases
${mode === "manager" ? "- This is a planning conversation: confirm direction, add requirements, or ask for clarification" : "- This is a building conversation: specify what to build or change"}`;

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

  app.post("/api/polish-prompt", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "AI service not configured" });
        return;
      }

      const { prompt, messages, mode, framework, language = "English" } = req.body;

      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }

      const contextBlock = Array.isArray(messages) && messages.length > 0
        ? `\n\nRecent conversation context:\n${messages.map((m: { role: string; content: string }) => `[${m.role}]: ${m.content}`).join("\n")}`
        : "";

      const frameworkHint = framework ? `\nThe project uses the "${framework}" framework.` : "";

      const systemPrompt = `You MUST respond only in ${language}.

You are a prompt structuring assistant for a coding AI agent (mode: ${mode || "manager"}).${frameworkHint}

Given a user's raw requirement description, rewrite it into a clear, structured format:

## Goal
[1-2 sentences: what the user wants to achieve]

## Requirements
- [bullet list of specific functional requirements extracted/inferred]

## Constraints
- [any technical constraints, framework preferences, or limitations mentioned or implied]

## Acceptance Criteria
- [how to verify the feature works correctly]

Rules:
- Preserve the user's original intent completely
- Add structure and clarity, don't invent new features the user didn't ask for
- If the input mentions a framework/language, include it in constraints
- If context messages reveal project details (framework, existing patterns), reference them
- Keep it concise — no filler
- You MUST write in ${language} only
- Output ONLY the structured prompt — no meta-commentary, no wrapping quotes${contextBlock}`;

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_LITE_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        stream: false,
        max_tokens: 800,
      });

      const polished = completion.choices[0]?.message?.content?.trim() || "";
      res.json({ polished });
    } catch (error: any) {
      console.error("Polish prompt API error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to polish prompt" });
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

  registerCodeExecRoutes(app);

  registerProjectsRoutes(app);

  // ── Multi-language code execution ──────────────────────────────────────────

  registerCompileRoutes(app);

  // WeChat project export — downloads the source tree as a ZIP that can be
  // opened directly in Tencent WeChat Developer Tools for 100%-faithful preview.

  // === REFERRAL ===
  registerReferralRoutes(app);

  registerAdminRoutes(app);

  registerNotificationRoutes(app);

  registerAuthRoutes(app, security);

  registerSkillsRoutes(app);

  // === WAITLIST / ADMIN INVITES ===

  const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";
  const BATCH_SIZE = 50;
  const WAITLIST_BASE_URL = process.env.BASE_URL ?? process.env.APP_BASE_URL ?? "https://cascadeai.co";

  // Trial/email/invite-code helpers (isEduEmail / isQizhiEmail / getTrialInfo /
  // inviteCodePrefix / formatInviteCode) live in services/invite-service.ts.
  // checkAdmin lives in middleware/auth-middleware.ts.

  registerWaitlistRoutes(app);

  setupPreviewServer(httpServer, app);

  // ─── Video generation ────────────────────────────────────────────────────────

  // Declared outside registerRoutes so the setInterval cleanup above can see it.

  let activeVideoJobs = 0;
  const MAX_VIDEO_JOBS = 2;
  const VIDEO_TIMEOUT_MS = 90_000;
  const PORT = parseInt(process.env.PORT || "5000", 10);
  const ALLOWED_DURATIONS = new Set([10, 20, 30]);

  // ffmpeg availability check on startup
  spawnProcess("ffmpeg", ["-version"], { timeout: 5000 }).then((r) => {
    if (r.exitCode !== 0) console.warn("[video] ffmpeg not found — video generation will fail");
  });

  async function recordPreview(
    jobId: string,
    projectId: string,
    duration: 10 | 20 | 30,
    videoDbId?: string,
  ): Promise<void> {
    const job = videoJobs.get(jobId)!;
    const tmpDir = join(tmpdir(), `cascade-video-${jobId}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let browser: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let context: any = null;
    let previewToken: string | null = null;
    let aborted = false;

    const updateDb = (patch: Parameters<typeof storage.updateProjectVideo>[1]) => {
      if (videoDbId) storage.updateProjectVideo(videoDbId, patch).catch(() => {});
    };

    const stopPreview = () => {
      if (previewToken) {
        fetch(`http://localhost:${PORT}/api/preview-server/stop`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: previewToken }),
        }).catch(() => {});
        previewToken = null;
      }
    };

    const timeout = setTimeout(() => {
      aborted = true;
      try { context?.close(); } catch {}
      try { browser?.close(); } catch {}
      job.status = "error";
      job.error = "timeout";
      job.finishedAt = Date.now();
      activeVideoJobs = Math.max(0, activeVideoJobs - 1);
      updateDb({ status: "error", errorMessage: "timeout", finishedAt: new Date() });
      stopPreview();
    }, VIDEO_TIMEOUT_MS);

    try {
      await mkdir(tmpDir, { recursive: true });

      // ── Step 1: Start preview-serve (NO login required, 100% reliable) ──
      const projectFiles = await storage.getProjectFiles(projectId).catch(() => []);
      if (projectFiles.length === 0) {
        throw new Error("Project has no files to preview");
      }
      const startRes = await fetch(`http://localhost:${PORT}/api/preview-server/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: projectFiles.map(f => ({ path: f.path, content: f.content })) }),
      });
      if (!startRes.ok) throw new Error(`preview-server/start failed: ${startRes.status}`);
      const startData = await startRes.json() as { token: string; url: string };
      previewToken = startData.token;
      const previewUrl = startData.url.replace(/^https?:\/\/[^/]+/, `http://localhost:${PORT}`);

      // ── Step 2: Launch Playwright ──
      const pwModule = "playwright";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { chromium } = await import(/* @vite-ignore */ pwModule) as any;
      browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        recordVideo: { dir: tmpDir, size: { width: 390, height: 844 } },
      });
      const page = await context.newPage();
      job.status = "running";
      job.progress = 5;

      // ── Step 3: Load App — use "load" not "networkidle" for reliability ──
      await page.goto(previewUrl, { waitUntil: "load", timeout: 30_000 });
      // Extra wait for JS frameworks to finish rendering
      await new Promise<void>((r) => setTimeout(r, 3000));
      job.progress = 15;

      // ── Step 4: Interactions ──
      const projectRow = await storage.getProject(projectId).catch(() => null);
      const rawSequence = projectRow?.actionSequence;

      if (rawSequence) {
        // Use Builder-generated DSL script (precise, app-specific)
        try {
          const parsed = JSON.parse(rawSequence);
          const validation = validateDslSequence(parsed);
          if (validation.valid && validation.actions) {
            job.progress = 20;
            const result = await executeDslSequence(page, validation.actions);
            if (result.failed > 0) console.warn(`[video] ${result.failed} DSL steps failed`);
          }
        } catch (e) {
          console.warn("[video] DSL error:", e instanceof Error ? e.message : e);
        }
      } else {
        // Generic fallback: scroll + click visible buttons
        try {
          await page.mouse.wheel(0, 300);
          await new Promise<void>((r) => setTimeout(r, 1000));
          await page.mouse.wheel(0, 300);
          await new Promise<void>((r) => setTimeout(r, 1000));
          const buttons = await page.$$("button, [role=\'button\'], input[type=\'button\'], input[type=\'submit\']");
          for (const btn of buttons.slice(0, 3)) {
            try { await btn.click({ timeout: 2000 }); await new Promise<void>((r) => setTimeout(r, 1500)); } catch {}
          }
          await page.mouse.wheel(0, -600);
          await new Promise<void>((r) => setTimeout(r, 1000));
        } catch (e) {
          console.warn("[video] generic interactions failed:", e instanceof Error ? e.message : e);
        }
      }

      job.progress = 60;

      // ── Step 5: Fill remaining time precisely ──
      const usedMs = 3000 + (rawSequence ? 15000 : 8000);
      const remainingMs = Math.max(2000, duration * 1000 - usedMs);
      await new Promise<void>((r) => setTimeout(r, remainingMs));
      job.progress = 80;

      // ── Step 6: Flush video file ──
      const videoHandle = await page.video();
      await context.close(); context = null;
      await browser.close(); browser = null;
      stopPreview();

      if (aborted) return;

      const rawVideoPath = await videoHandle?.path();
      if (!rawVideoPath || !existsSync(rawVideoPath)) throw new Error("Playwright produced no video file");

      // ── Step 7: Watermark ──
      const watermarkedPath = rawVideoPath.replace(/\.\w+$/, "-wm.mp4");
      try {
        await addVideoWatermark(rawVideoPath, watermarkedPath);
        rm(rawVideoPath, { force: true }).catch(() => {});
      } catch (wmErr) {
        console.warn("[video] watermark failed:", wmErr instanceof Error ? wmErr.message : wmErr);
        const { rename } = await import("fs/promises");
        await rename(rawVideoPath, watermarkedPath);
      }

      // ── Step 8: Persist ──
      const storagePath = await videoStorage.save(jobId, watermarkedPath);
      job.outputPath = storagePath;
      job.progress = 100;
      job.status = "done";
      job.finishedAt = Date.now();
      updateDb({ status: "done", localPath: storagePath, finishedAt: new Date() });

    } catch (err: unknown) {
      if (!aborted) {
        const msg = err instanceof Error ? err.message : "unknown";
        job.status = "error";
        job.error = msg;
        job.finishedAt = Date.now();
        updateDb({ status: "error", errorMessage: msg, finishedAt: new Date() });
      }
    } finally {
      clearTimeout(timeout);
      if (!aborted) activeVideoJobs = Math.max(0, activeVideoJobs - 1);
      try { context?.close(); } catch {}
      try { browser?.close(); } catch {}
      stopPreview();
      rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  app.post("/api/video/generate", async (req, res) => {
    const { projectId, duration: rawDuration } = req.body as { projectId?: string; duration?: number };
    // Default to 30s if not specified or invalid
    const duration = (!rawDuration || !ALLOWED_DURATIONS.has(rawDuration)) ? 30 : rawDuration;
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }
    if (activeVideoJobs >= MAX_VIDEO_JOBS) {
      res.status(429).json({ error: "too_many_jobs" });
      return;
    }

    // Only Web framework previews are stable enough for recording
    const project = await storage.getProject(projectId).catch(() => null);
    if (project && project.framework && project.framework !== "web") {
      res.status(422).json({ error: "unsupported_framework", framework: project.framework });
      return;
    }

    const jobId = randomBytes(8).toString("hex");
    videoJobs.set(jobId, {
      status: "pending",
      progress: 0,
      outputPath: null,
      error: null,
      finishedAt: null,
      duration: duration as 10 | 20 | 30,
    });
    activeVideoJobs++;

    // Create persistent DB record
    const userId = (req.session as any)?.userId as string | undefined;
    let videoDbId: string | undefined;
    try {
      const { randomUUID } = await import("crypto");
      const dbRecord = await storage.createProjectVideo({
        id: randomUUID(),
        projectId,
        userId: userId ?? null,
        status: "pending",
        duration: duration as number,
        style: "raw",
      });
      videoDbId = dbRecord.id;
    } catch (e) {
      console.warn("[video/generate] DB record failed:", e);
    }

    recordPreview(jobId, projectId, duration as 10 | 20 | 30, videoDbId).catch(() => {});
    res.json({ jobId, videoId: videoDbId });
  });

  app.get("/api/video/status/:jobId", (req, res) => {
    const job = videoJobs.get(req.params.jobId);
    if (!job) { res.status(404).end(); return; }
    res.json({ status: job.status, progress: job.progress, error: job.error ?? undefined });
  });

  // Persistent file download by DB videoId
  app.get("/api/video/file/:videoId", async (req, res) => {
    const record = await storage.getProjectVideo(req.params.videoId).catch(() => null);
    if (!record || record.status !== "done") { res.status(404).end(); return; }
    if (record.cosUrl) { res.redirect(302, record.cosUrl); return; }
    const localPath = record.localPath;
    if (!localPath || !existsSync(localPath)) { res.status(404).end(); return; }
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="demo.mp4"`);
    res.sendFile(localPath);
  });

  // Legacy download by in-memory jobId (kept for compatibility)
  app.get("/api/video/download/:jobId", (req, res) => {
    const job = videoJobs.get(req.params.jobId);
    if (!job || job.status !== "done" || !job.outputPath) { res.status(404).end(); return; }
    const localPath = videoStorage.getLocalPath(job.outputPath);
    if (!localPath || !existsSync(localPath)) { res.status(404).end(); return; }
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="preview-${job.duration}s.mp4"`);
    res.sendFile(localPath);
  });

  app.post("/api/video/send-email/:jobId", async (req, res) => {
    const job = videoJobs.get(req.params.jobId);
    if (!job || job.status !== "done" || !job.outputPath || !existsSync(job.outputPath)) {
      res.status(404).end();
      return;
    }

    // resolve user email from session
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) {
      res.status(401).json({ error: "not_logged_in" });
      return;
    }
    const user = await storage.getUser(userId);
    if (!user?.email) {
      res.status(422).json({ error: "no_email" });
      return;
    }

    const filePath = job.outputPath;
    const filename = `preview-${job.duration}s.mp4`;

    try {
      const fileBuffer = readFileSync(filePath);
      const base64 = fileBuffer.toString("base64");

      await sendEmail({
        to: user.email,
        subject: `你的 ${job.duration}s 预览视频已生成`,
        html: `<p>你好，</p><p>你的 App 预览视频（${job.duration} 秒）已生成，附件即为 MP4 文件，可直接下载保存。</p><p>— Cascade AI</p>`,
        text: `你的 App 预览视频（${job.duration} 秒）已生成，请查收附件。`,
        attachments: [{ filename, content: base64, type: "video/mp4", disposition: "attachment" }],
      });

      // clean up after sending
      rm(filePath, { force: true }).catch(() => {});
      videoJobs.delete(req.params.jobId);

      res.json({ ok: true });
    } catch (err: unknown) {
      console.error("[video/send-email] failed:", err);
      res.status(500).json({ error: "send_failed" });
    }
  });

  // ── Creator Square ────────────────────────────────────────────────────────────

  // GET /api/square — list published apps
  app.get("/api/square", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = parseInt(req.query.offset as string) || 0;
      const framework = req.query.framework as string | undefined;
      const category = req.query.category as string | undefined;
      const sort = (req.query.sort as string) || "latest";
      const q = (req.query.q as string | undefined)?.trim() || "";
      const author = (req.query.author as string | undefined)?.trim() || "";
      const currentUserId = (req.session as any)?.userId as string | undefined;

      // Visibility rule:
      //   - public: visible to everyone
      //   - link_only: NOT listed publicly, BUT always visible to the owner regardless of filter
      //   - private: never listed
      const visibilityWhere = currentUserId
        ? sql`(${publishedApps.visibility} = 'public' OR (${publishedApps.userId} = ${currentUserId} AND ${publishedApps.visibility} = 'link_only'))`
        : eq(publishedApps.visibility, "public");

      const baseWhere = and(
        visibilityWhere,
        eq(publishedApps.adminTakenDown, false),
        ...(framework ? [eq(publishedApps.framework, framework)] : []),
        ...(category ? [eq(publishedApps.category, category)] : []),
        ...(author ? [sql`lower(${users.username}) = ${author.toLowerCase()}`] : []),
      );

      const fullWhere = q
        ? and(baseWhere, or(
            sql`lower(${publishedApps.title}) like ${"%" + q.toLowerCase() + "%"}`,
            sql`lower(${publishedApps.description}) like ${"%" + q.toLowerCase() + "%"}`,
            sql`lower(${users.username}) like ${"%" + q.toLowerCase() + "%"}`,
          ))
        : baseWhere;

      const orderBy = sort === "hottest"
        ? desc(publishedApps.viewCount)
        : desc(publishedApps.publishedAt);

      const rows = await db
        .select({
          id: publishedApps.id,
          projectId: publishedApps.projectId,
          userId: publishedApps.userId,
          title: publishedApps.title,
          description: publishedApps.description,
          isOpenSource: publishedApps.isOpenSource,
          visibility: publishedApps.visibility,
          previewScreenshot: publishedApps.previewScreenshot,
          framework: publishedApps.framework,
          category: publishedApps.category,
          viewCount: publishedApps.viewCount,
          forkCount: publishedApps.forkCount,
          likeCount: publishedApps.likeCount,
          publishedAt: publishedApps.publishedAt,
          updatedAt: publishedApps.updatedAt,
          authorUsername: users.username,
        })
        .from(publishedApps)
        .innerJoin(users, eq(publishedApps.userId, users.id))
        .where(fullWhere)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: count() })
        .from(publishedApps)
        .innerJoin(users, eq(publishedApps.userId, users.id))
        .where(fullWhere);

      res.json({ apps: rows, total });
    } catch (err) {
      console.error("[square/list]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // GET /api/square/:id — get single app (public or link_only allows direct access, private = owner only)
  app.get("/api/square/:id", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      const [row] = await db
        .select({
          id: publishedApps.id,
          projectId: publishedApps.projectId,
          userId: publishedApps.userId,
          title: publishedApps.title,
          description: publishedApps.description,
          isOpenSource: publishedApps.isOpenSource,
          visibility: publishedApps.visibility,
          previewScreenshot: publishedApps.previewScreenshot,
          framework: publishedApps.framework,
          viewCount: publishedApps.viewCount,
          forkCount: publishedApps.forkCount,
          likeCount: publishedApps.likeCount,
          publishedAt: publishedApps.publishedAt,
          updatedAt: publishedApps.updatedAt,
          authorUsername: users.username,
        })
        .from(publishedApps)
        .innerJoin(users, eq(publishedApps.userId, users.id))
        .where(eq(publishedApps.id, req.params.id));

      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      // private: only owner can view
      // link_only: anyone with the link can view (not listed in square, but direct access allowed)
      // public: anyone can view
      if (row.visibility === "private" && row.userId !== userId) {
        res.status(403).json({ error: "forbidden" }); return;
      }
      // Increment view count asynchronously (non-blocking, fire-and-forget)
      db.update(publishedApps)
        .set({ viewCount: sql`${publishedApps.viewCount} + 1` })
        .where(eq(publishedApps.id, req.params.id))
        .catch(() => {});
      res.json({ app: row });
    } catch (err) {
      console.error("[square/get]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // POST /api/square — publish or update (auth required)
  app.post("/api/square", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) { res.status(401).json({ error: "not_authenticated" }); return; }

      const { projectId, title, description, isOpenSource, visibility, previewScreenshot, framework: fw } = req.body as {
        projectId?: string; title?: string; description?: string;
        isOpenSource?: boolean; visibility?: string; previewScreenshot?: string; framework?: string;
      };
      if (!projectId || !title?.trim()) { res.status(400).json({ error: "missing_fields" }); return; }

      const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
      if (!project) { res.status(403).json({ error: "forbidden" }); return; }

      // Auto-classify app category based on title + description
      const classifyCategory = (t: string, d: string): string => {
        const text = (t + " " + d).toLowerCase();
        if (/游戏|game|play|棋|snake|tetris|puzzle|quiz/.test(text)) return "games";
        if (/学习|learn|教|study|单词|quiz|课|exam|test|知识/.test(text)) return "education";
        if (/图表|chart|dashboard|可视化|visual|数据|data|统计|report/.test(text)) return "data-viz";
        if (/画|draw|write|写作|生成|create|art|design|音乐|video/.test(text)) return "creative";
        if (/聊天|chat|社交|social|message|留言|论坛|community/.test(text)) return "social";
        if (/商|shop|finance|金融|支付|pay|电商|订单|invoice/.test(text)) return "business";
        if (/天气|weather|食谱|cook|健康|health|生活|日历|calendar|todo|habit/.test(text)) return "lifestyle";
        if (/工具|tool|util|convert|计算|calc|timer|clock|效率|productivity/.test(text)) return "tools";
        return "other";
      };
      const autoCategory = classifyCategory(title.trim(), description?.trim() ?? "");

      // Scope lookup to (projectId + userId) — prevents cross-user collisions
      const [existing] = await db.select().from(publishedApps)
        .where(and(eq(publishedApps.projectId, projectId), eq(publishedApps.userId, userId)));

      const appId = existing?.id ?? randomBytes(8).toString("hex");
      const detectedFramework = fw ?? (project as any).framework ?? "web";

      if (existing) {
        await db.update(publishedApps).set({
          title: title.trim(),
          description: description?.trim() ?? null,
          isOpenSource: isOpenSource ?? false,
          visibility: (visibility ?? "public") as any,
          previewScreenshot: previewScreenshot ?? null,
          framework: detectedFramework,
          category: autoCategory,
          updatedAt: new Date(),
        }).where(and(eq(publishedApps.id, appId), eq(publishedApps.userId, userId)));
      } else {
        await db.insert(publishedApps).values({
          id: appId,
          projectId,
          userId,
          title: title.trim(),
          description: description?.trim() ?? null,
          isOpenSource: isOpenSource ?? false,
          visibility: (visibility ?? "public") as any,
          previewScreenshot: previewScreenshot ?? null,
          framework: detectedFramework,
          category: autoCategory,
        });
      }

      const [app] = await db.select().from(publishedApps).where(eq(publishedApps.id, appId));
      res.json({ app });
    } catch (err) {
      console.error("[square/publish]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // DELETE /api/square/:id — unpublish (auth required, owner only)
  app.delete("/api/square/:id", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) { res.status(401).json({ error: "not_authenticated" }); return; }
      const [row] = await db.select().from(publishedApps).where(eq(publishedApps.id, req.params.id));
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      if (row.userId !== userId) { res.status(403).json({ error: "forbidden" }); return; }
      await db.delete(publishedApps).where(eq(publishedApps.id, req.params.id));
      res.json({ ok: true });
    } catch (err) {
      console.error("[square/delete]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // POST /api/square/:id/fork — fork open-source app into user's projects (auth required)
  app.post("/api/square/:id/fork", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) { res.status(401).json({ error: "not_authenticated" }); return; }
      const [sourceApp] = await db.select().from(publishedApps).where(eq(publishedApps.id, req.params.id));
      if (!sourceApp) { res.status(404).json({ error: "not_found" }); return; }
      if (!sourceApp.isOpenSource) { res.status(403).json({ error: "not_open_source" }); return; }

      const sourceFiles = await storage.getProjectFiles(sourceApp.projectId);
      const newProjectId = randomBytes(8).toString("hex");
      await storage.createProject({ id: newProjectId, userId, name: `Fork of ${sourceApp.title}`, framework: sourceApp.framework as any });
      if (sourceFiles.length > 0) {
        await storage.upsertProjectFiles(newProjectId, sourceFiles.map((f) => ({ path: f.path, content: f.content })));
      }
      // Increment fork count asynchronously
      db.update(publishedApps)
        .set({ forkCount: sql`${publishedApps.forkCount} + 1` })
        .where(eq(publishedApps.id, req.params.id))
        .catch(() => {});
      res.json({ projectId: newProjectId });
    } catch (err) {
      console.error("[square/fork]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // GET /api/square/:id/files — get app source files (open-source only)
  app.get("/api/square/:id/files", async (req, res) => {
    try {
      const [sourceApp] = await db.select().from(publishedApps).where(eq(publishedApps.id, req.params.id));
      if (!sourceApp) { res.status(404).json({ error: "not_found" }); return; }
      if (!sourceApp.isOpenSource) { res.status(403).json({ error: "not_open_source" }); return; }
      const files = await storage.getProjectFiles(sourceApp.projectId);
      res.json({ files: files.map((f) => ({ path: f.path, content: f.content })) });
    } catch (err) {
      console.error("[square/files]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // GET /api/square/:id/preview-session — start a preview session for the app's files (web only)
  // Returns a short-lived token; the client loads /preview-serve/:token/ in an iframe.
  app.get("/api/square/:id/preview-session", async (req, res) => {
    try {
      const [app] = await db
        .select({ id: publishedApps.id, projectId: publishedApps.projectId, framework: publishedApps.framework, adminTakenDown: publishedApps.adminTakenDown, visibility: publishedApps.visibility, userId: publishedApps.userId })
        .from(publishedApps)
        .where(eq(publishedApps.id, req.params.id));
      if (!app) { res.status(404).json({ error: "not_found" }); return; }
      if (app.adminTakenDown) { res.status(403).json({ error: "taken_down" }); return; }
      // Only private apps restrict access (link_only is fine for direct link)
      const sessionUserId = (req.session as any)?.userId as string | undefined;
      if (app.visibility === "private" && app.userId !== sessionUserId) {
        res.status(403).json({ error: "forbidden" }); return;
      }
      // Only web apps can be previewed in an iframe
      if (app.framework !== "web") {
        res.status(422).json({ error: "not_web", framework: app.framework }); return;
      }

      const files = await storage.getProjectFiles(app.projectId);
      if (!files || files.length === 0) {
        res.status(422).json({ error: "no_files" }); return;
      }

      const startResp = await fetch(`http://localhost:${PORT}/api/preview-server/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: files.map((f) => ({ path: f.path, content: f.content })) }),
      });
      if (!startResp.ok) { res.status(500).json({ error: "preview_start_failed" }); return; }
      const { token } = await startResp.json() as { token: string };
      res.json({ token, previewUrl: `/preview-serve/${token}/` });
    } catch (err) {
      console.error("[square/preview-session]", err);
      res.status(500).json({ error: "failed" });
    }
  });


  // GET /api/square/authors — list all users who have public published apps
  app.get("/api/square/authors", async (req, res) => {
    try {
      const rows = await db
        .selectDistinct({
          username: users.username,
          appCount: count(),
        })
        .from(publishedApps)
        .innerJoin(users, eq(publishedApps.userId, users.id))
        .where(and(eq(publishedApps.visibility, "public"), eq(publishedApps.adminTakenDown, false)))
        .groupBy(users.username)
        .orderBy(desc(count()));
      res.json({ authors: rows });
    } catch (err) {
      console.error("[square/authors]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // GET /api/square/my/apps — list current user's published apps
  app.get("/api/square/my/apps", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) { res.status(401).json({ error: "not_authenticated" }); return; }
      const rows = await db.select().from(publishedApps).where(eq(publishedApps.userId, userId)).orderBy(desc(publishedApps.publishedAt));
      res.json({ apps: rows });
    } catch (err) {
      console.error("[square/my]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // POST /api/square/screenshot — take a screenshot of the project preview (auth required)
  app.post("/api/square/screenshot", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) { res.status(401).json({ error: "not_authenticated" }); return; }

      const { projectId } = req.body as { projectId?: string };
      if (!projectId) { res.status(400).json({ error: "missing_projectId" }); return; }

      const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
      if (!project) { res.status(403).json({ error: "forbidden" }); return; }

      const files = await storage.getProjectFiles(projectId);
      if (!files || files.length === 0) {
        res.status(422).json({ error: "no_files" }); return;
      }

      const startResp = await fetch(`http://localhost:${PORT}/api/preview-server/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: files.map((f) => ({ path: f.path, content: f.content })) }),
      });
      if (!startResp.ok) { res.status(500).json({ error: "preview_session_failed" }); return; }
      const { token } = await startResp.json() as { token: string };

      const previewUrl = `http://localhost:${PORT}/preview-serve/${token}/`;
      const pwModule = "playwright";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { chromium } = await import(/* @vite-ignore */ pwModule) as any;
      const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      try {
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(previewUrl, { waitUntil: "networkidle", timeout: 20_000 });
        await new Promise<void>((r) => setTimeout(r, 1500));
        const buffer: Buffer = await page.screenshot({ type: "jpeg", quality: 85 });
        const base64 = buffer.toString("base64");
        res.json({ screenshot: `data:image/jpeg;base64,${base64}` });
      } finally {
        await browser.close();
        fetch(`http://localhost:${PORT}/api/preview-server/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error("[square/screenshot]", err);
      res.status(500).json({ error: "screenshot_failed" });
    }
  });

  // ── Likes ────────────────────────────────────────────────────────────────

  // POST /api/square/:id/like — toggle like (auth required)
  app.post("/api/square/:id/like", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "not_logged_in" }); return; }
    const appId = req.params.id;
    try {
      const { randomUUID } = await import("crypto");
      const existing = await db
        .select({ id: appLikes.id })
        .from(appLikes)
        .where(and(eq(appLikes.appId, appId), eq(appLikes.userId, userId)))
        .limit(1);

      if (existing.length > 0) {
        // already liked — unlike
        await db.delete(appLikes).where(and(eq(appLikes.appId, appId), eq(appLikes.userId, userId)));
        await db.update(publishedApps)
          .set({ likeCount: sql`greatest(${publishedApps.likeCount} - 1, 0)` })
          .where(eq(publishedApps.id, appId));
        res.json({ liked: false });
      } else {
        // not liked — like
        await db.insert(appLikes).values({ id: randomUUID(), appId, userId });
        await db.update(publishedApps)
          .set({ likeCount: sql`${publishedApps.likeCount} + 1` })
          .where(eq(publishedApps.id, appId));
        res.json({ liked: true });

        // Send notification to app owner (fire-and-forget, don't block response)
        db.select({
          appTitle: publishedApps.title,
          ownerId: publishedApps.userId,
          likerUsername: users.username,
        })
          .from(publishedApps)
          .innerJoin(users, eq(users.id, userId))
          .where(eq(publishedApps.id, appId))
          .limit(1)
          .then(([row]) => {
            if (!row || row.ownerId === userId) return; // don't notify self-like
            return db.insert(notifications).values({
              userId: row.ownerId,
              type: "app_like",
              title: "有人点赞了你的应用",
              body: `@${row.likerUsername} 点赞了你分享的「${row.appTitle}」`,
              isRead: false,
            });
          })
          .catch((err) => { console.error("[square/like/notif]", err); });
      }
    } catch (err) {
      console.error("[square/like]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // GET /api/square/:id/like — check if current user liked this app
  app.get("/api/square/:id/like", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.json({ liked: false }); return; }
    try {
      const rows = await db
        .select({ id: appLikes.id })
        .from(appLikes)
        .where(and(eq(appLikes.appId, req.params.id), eq(appLikes.userId, userId)))
        .limit(1);
      res.json({ liked: rows.length > 0 });
    } catch (err) {
      console.error("[square/like/get]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // ── Comments ─────────────────────────────────────────────────────────────

  // GET /api/square/:id/comments — list comments (public)
  app.get("/api/square/:id/comments", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = parseInt(req.query.offset as string) || 0;
    try {
      const rows = await db
        .select({
          id: appComments.id,
          content: appComments.content,
          createdAt: appComments.createdAt,
          userId: appComments.userId,
          authorUsername: users.username,
        })
        .from(appComments)
        .innerJoin(users, eq(appComments.userId, users.id))
        .where(eq(appComments.appId, req.params.id))
        .orderBy(desc(appComments.createdAt))
        .limit(limit)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: count() })
        .from(appComments)
        .where(eq(appComments.appId, req.params.id));

      res.json({ comments: rows, total });
    } catch (err) {
      console.error("[square/comments/get]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // POST /api/square/:id/comments — add a comment (auth required)
  app.post("/api/square/:id/comments", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "not_logged_in" }); return; }
    const content = ((req.body as any)?.content ?? "").trim();
    if (!content || content.length > 500) {
      res.status(400).json({ error: "invalid_content" }); return;
    }
    try {
      const { randomUUID } = await import("crypto");
      const id = randomUUID();
      const now = new Date();
      await db.insert(appComments).values({
        id,
        appId: req.params.id,
        userId,
        content,
        createdAt: now,
        updatedAt: now,
      });

      // Fetch author username and app owner in one join
      const [notifRow] = await db.select({
        appTitle: publishedApps.title,
        ownerId: publishedApps.userId,
        authorUsername: users.username,
      })
        .from(publishedApps)
        .innerJoin(users, eq(users.id, userId))
        .where(eq(publishedApps.id, req.params.id))
        .limit(1);

      const authorUsername = notifRow?.authorUsername ?? "unknown";

      res.json({
        comment: { id, content, createdAt: now, userId, authorUsername }
      });

      // Send notification to app owner (fire-and-forget, after response)
      if (notifRow && notifRow.ownerId !== userId) {
        db.insert(notifications).values({
          userId: notifRow.ownerId,
          type: "app_comment",
          title: "有人评论了你的应用",
          body: `@${authorUsername} 评论了你分享的「${notifRow.appTitle}」：${content.slice(0, 50)}${content.length > 50 ? "…" : ""}`,
          isRead: false,
        }).catch((err) => { console.error("[square/comment/notif]", err); });
      }
    } catch (err) {
      console.error("[square/comments/post]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // DELETE /api/square/:id/comments/:commentId — delete comment (owner or admin)
  app.delete("/api/square/:id/comments/:commentId", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "not_logged_in" }); return; }
    try {
      const [comment] = await db
        .select({ userId: appComments.userId })
        .from(appComments)
        .where(eq(appComments.id, req.params.commentId))
        .limit(1);
      if (!comment) { res.status(404).json({ error: "not_found" }); return; }
      if (comment.userId !== userId) { res.status(403).json({ error: "forbidden" }); return; }
      await db.delete(appComments).where(eq(appComments.id, req.params.commentId));
      res.json({ ok: true });
    } catch (err) {
      console.error("[square/comments/delete]", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // POST /api/aigc/classify-intent — LLM-based media intent classification (level-2 fallback)
  app.post("/api/aigc/classify-intent", async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) { res.json({ intent: "none" }); return; }
    try {
      const { getFastClient } = await import("../agent/providers/kimi-client");
      const { client, model } = getFastClient();
      const completion = await client.chat.completions.create({
        model,
        max_tokens: 20,
        messages: [
          {
            role: "system",
            content: `你是意图分类器。判断用户输入属于哪种意图：
- "poster"：想生成海报/宣传图/封面/分享图/做图
- "video"：想录制/生成演示视频/分享视频
- "none"：其他

只返回 JSON，格式：{"intent":"poster"} 或 {"intent":"video"} 或 {"intent":"none"}`,
          },
          { role: "user", content: text.trim() },
        ],
        temperature: 0,
      });
      const raw = completion.choices[0]?.message?.content?.trim() ?? '{"intent":"none"}';
      const parsed = JSON.parse(raw.match(/\{[^}]+\}/)?.[0] ?? '{"intent":"none"}') as { intent: string };
      const intent = ["poster", "video"].includes(parsed.intent) ? parsed.intent : "none";
      res.json({ intent });
    } catch (err) {
      console.warn("[aigc/classify-intent]", err instanceof Error ? err.message : err);
      res.json({ intent: "none" });
    }
  });

  // POST /api/aigc/session — create a new AIGC session
  app.post("/api/aigc/session", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "not_logged_in" }); return; }
    const { projectId } = req.body as { projectId?: string };
    if (!projectId) { res.status(400).json({ error: "projectId_required" }); return; }

    // Daily quota check
    const { checkDailyQuota } = await import("../../infra/aigc-evaluator");
    const quota = checkDailyQuota(userId);
    if (!quota.allowed) {
      res.status(429).json({ error: "daily_quota_exceeded", remaining: 0 });
      return;
    }

    const { randomUUID } = await import("crypto");
    const sessionId = randomUUID();
    const session: AigcSession = {
      id: sessionId,
      projectId,
      userId,
      messages: [],
      events: [],
      nextEventId: 0,
      done: false,
      sseWriters: new Set(),
    };
    aigcSessions.set(sessionId, session);
    res.json({ sessionId, quotaRemaining: quota.remaining });
  });

  // POST /api/aigc/session/:id/message — send a message to the AIGC agent
  app.post("/api/aigc/session/:id/message", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "not_logged_in" }); return; }
    const session = aigcSessions.get(req.params.id);
    if (!session) { res.status(404).json({ error: "session_not_found" }); return; }
    const { message } = req.body as { message?: string };
    if (!message?.trim()) { res.status(400).json({ error: "message_required" }); return; }

    // Fire-and-forget — client polls via SSE
    runAigcAgent(session, message.trim()).catch((err) => {
      console.error("[aigc/session] agent error:", err);
    });
    res.json({ ok: true });
  });

  // GET /api/aigc/session/:id/stream — SSE stream of AIGC events
  app.get("/api/aigc/session/:id/stream", (req, res) => {
    const session = aigcSessions.get(req.params.id);
    if (!session) { res.status(404).end(); return; }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Replay missed events
    const lastId = parseInt(req.headers["last-event-id"] as string ?? "-1", 10);
    for (const ev of session.events) {
      if ((ev.eventId as number) > lastId) {
        res.write(`id:${ev.eventId}\ndata:${JSON.stringify(ev)}\n\n`);
      }
    }

    const writer = (line: string) => { try { res.write(line); } catch {} };
    session.sseWriters.add(writer);
    req.on("close", () => session.sseWriters.delete(writer));
  });

  // GET /api/aigc/session/:id — get session state
  app.get("/api/aigc/session/:id", (req, res) => {
    const session = aigcSessions.get(req.params.id);
    if (!session) { res.status(404).json({ error: "not_found" }); return; }
    res.json({
      id: session.id,
      projectId: session.projectId,
      done: session.done,
      messageCount: session.messages.length,
    });
  });

  // GET /api/aigc/preferences — get current user's style preferences
  app.get("/api/aigc/preferences", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "not_logged_in" }); return; }
    try {
      const prefs = await storage.getAigcPreferences(userId);
      res.json(prefs ?? { styleHistory: [], colorTone: null, lastStyle: null, generationCount: 0 });
    } catch {
      res.json({ styleHistory: [], colorTone: null, lastStyle: null, generationCount: 0 });
    }
  });


  // ─────────────────────────────────────────────────────────────────────────────

  return httpServer;
}
