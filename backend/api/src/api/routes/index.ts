import type { Express } from "express";
import { createServer, type Server } from "http";
import https from "https";
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
// @ts-ignore
import helmet from "helmet";
// @ts-ignore
import rateLimit from "express-rate-limit";
import { doubaoClient, DOUBAO_MODEL, DOUBAO_LITE_MODEL } from "../../agent/providers/doubao-client";
import { withRetry } from "../../agent/providers/retry";
import { compressMessages } from "../../infra/context-compressor";
import { storage } from "../../infra/storage";
import { srcDir } from "../../infra/paths";
import { userSessions, getConcurrencyMetrics } from "../../infra/concurrency";
import type { ChatMessageInput } from "../../infra/storage";
import { insertProjectSchema, userSkills, projectSkills, insertUserSkillSchema, insertProjectSkillSchema, users, waitlistSubscribers, inviteCodes, subscriptionGrants, projects, chatMessages, otpCodes, chatSessions, userFeedback, notifications } from "@cascade/database";
import { db, pool } from "../../infra/db";
import { eq, and, desc, count, isNull, or, sql } from "drizzle-orm";
import { sendEmail, NOTIFICATION_EMAIL } from "../../infra/email";
import { sendOtp, verifyOtp, normalizeTarget, type OtpChannel } from "../../auth/otp";
import { verifyCaptcha, isCaptchaEnabled, getCaptchaAppId } from "../../infra/captcha";
import { getTemplateFiles } from "../../compiler/templates/index";
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
import { compileKotlinWasm, getArtifactPath, isCompilerAvailable, checkCompilerOnStartup } from "../../compiler/kotlin-wasm/kotlin-wasm-compiler";
import { compileSwiftWasm, getSwiftArtifactPath, isSwiftWasmAvailable, checkSwiftCompilerOnStartup } from "../../compiler/kotlin-wasm/swift-wasm-compiler";
import { compileRnWeb, getRnArtifactPath, getVendorPath, ensureVendorBundle } from "../../compiler/rn-web/rn-web-compiler";
import { compileFlutterWeb, getFlutterArtifactPath, isFlutterAvailable, checkFlutterOnStartup } from "../../compiler/flutter/flutter-compiler";
import { compileWeChatWeb, getWxArtifactDir, ensureWxVendorBundle } from "../../compiler/wechat/wechat-web-compiler";
import { runExploreAgent } from "../../agent/orchestrator/explore-agent";
import { McpManager } from "../../agent/mcp/mcp-client";
import { loadMcpConfig, getBuiltinMcpConfig, type McpConfig } from "../../agent/mcp/mcp-config";
import { buildMcpTools, getMcpToolNames } from "../../agent/mcp/mcp-tools";
import { runResearchAgent, sanitizeResearchResult } from "../../agent/mcp/research-agent";

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
  checkCompilerOnStartup();
  checkSwiftCompilerOnStartup();
  checkFlutterOnStartup();

  // ── Security: Helmet ────────────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }));

  // ── Security: IP blocklist (in-memory) ──────────────────────────────────────
  // Map<ip, { blockedUntil: number, reason: string, blockedAt: number }>
  const ipBlocklist = new Map<string, { blockedUntil: number; reason: string; blockedAt: number }>();
  // Track 429 hits per IP to auto-block after 3 strikes
  const ipStrikeCount = new Map<string, { count: number; windowStart: number }>();

  function getClientIp(req: any): string {
    return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  }

  function isIpBlocked(ip: string): boolean {
    const entry = ipBlocklist.get(ip);
    if (!entry) return false;
    if (entry.blockedUntil > Date.now()) return true;
    ipBlocklist.delete(ip);
    return false;
  }

  // IPs that are never auto-blocked (owner / admin access)
  const IP_WHITELIST = new Set(["36.142.94.105", "127.0.0.1", "::1"]);

  function recordIpStrike(ip: string) {
    if (IP_WHITELIST.has(ip)) return; // 白名单 IP 不计 strike
    const now = Date.now();
    const WINDOW = 10 * 60 * 1000; // 10 min window
    const entry = ipStrikeCount.get(ip) ?? { count: 0, windowStart: now };
    if (now - entry.windowStart > WINDOW) {
      entry.count = 1; entry.windowStart = now;
    } else {
      entry.count++;
    }
    ipStrikeCount.set(ip, entry);
    if (entry.count >= 3) {
      ipBlocklist.set(ip, { blockedUntil: now + 60 * 60 * 1000, reason: "Auto: 3x rate-limit violations", blockedAt: now });
      ipStrikeCount.delete(ip);
    }
  }

  // Expose blocklist controls on app locals for admin routes
  (app as any)._ipBlocklist = ipBlocklist;

  // Middleware: reject blocked IPs (whitelist always passes)
  app.use((req: any, res: any, next: any) => {
    const ip = getClientIp(req);
    if (IP_WHITELIST.has(ip)) { next(); return; }
    if (isIpBlocked(ip)) {
      return res.status(403).json({ error: "Your IP has been blocked. Contact support." });
    }
    next();
  });

  // ── Security: Account lockout (in-memory) ───────────────────────────────────
  // Map<userId, { failCount: number; lockedUntil: number | null }>
  const accountLockout = new Map<string, { failCount: number; lockedUntil: number | null; lockedAt: number | null }>();
  const MAX_FAIL = 5;
  const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

  function recordLoginFail(userId: string) {
    const entry = accountLockout.get(userId) ?? { failCount: 0, lockedUntil: null, lockedAt: null };
    entry.failCount++;
    if (entry.failCount >= MAX_FAIL) {
      entry.lockedUntil = Date.now() + LOCKOUT_MS;
      entry.lockedAt = Date.now();
    }
    accountLockout.set(userId, entry);
  }

  function isAccountLocked(userId: string): boolean {
    const entry = accountLockout.get(userId);
    if (!entry || !entry.lockedUntil) return false;
    if (entry.lockedUntil > Date.now()) return true;
    // Auto-unlock
    accountLockout.delete(userId);
    return false;
  }

  function clearAccountLockout(userId: string) {
    accountLockout.delete(userId);
  }

  (app as any)._accountLockout = accountLockout;
  (app as any)._clearAccountLockout = clearAccountLockout;

  // ── Security: Rate limiters ─────────────────────────────────────────────────
  function makeRateLimiter(max: number, windowMinutes: number, message: string) {
    return rateLimit({
      windowMs: windowMinutes * 60 * 1000,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: any) => getClientIp(req),
      message: { error: message },
      handler: (req: any, res: any, next: any, options: any) => {
        recordIpStrike(getClientIp(req));
        res.status(options.statusCode).json(options.message);
      },
      skip: (req: any) => {
        // Never rate-limit already-blocked IPs (they get 403 earlier)
        return false;
      },
    });
  }

  // All auth endpoints: 30 req / 15 min per IP
  const authLimiter = makeRateLimiter(30, 15, "Too many requests. Please try again later.");
  const loginLimiter = makeRateLimiter(10, 15, "Too many login attempts. Please wait 15 minutes.");
  const otpSendLimiter = makeRateLimiter(10, 60, "Too many code requests. Please wait before trying again.");
  app.use("/api/auth", authLimiter);
  // Login specifically: 10 req / 15 min per IP
  app.use("/api/auth/login", loginLimiter);
  // OTP send: 10 req / 60 min per IP
  app.use("/api/auth/otp/send", otpSendLimiter);

  // Test-only seam: reset the in-memory rate-limiter windows so serialized
  // integration tests don't accumulate strikes across cases (the limiter store
  // lives on the module-level app, shared across every test in a file).
  (app as any)._resetRateLimiters = () => {
    for (const lim of [authLimiter, loginLimiter, otpSendLimiter]) {
      try { (lim as any).resetKey?.("::ffff:127.0.0.1"); (lim as any).resetKey?.("127.0.0.1"); } catch {}
      // express-rate-limit v7 exposes the store on the middleware; clear it wholesale.
      try { (lim as any).store?.resetAll?.(); } catch {}
    }
  };

  app.get("/api/providers", (_req, res) => {
    res.json({
      doubao: !!process.env.DOUBAO_API_KEY,
      kimi: !!process.env.KIMI_API_KEY,
      minimax: !!process.env.MINIMAX_API_KEY,
      glm: !!process.env.GLM_API_KEY,
      "deepseek-pro": !!process.env.DEEPSEEK_API_KEY,
      "deepseek-flash": !!process.env.DEEPSEEK_API_KEY,
    });
  });

  app.get("/api/concurrency", (_req, res) => {
    res.json(getConcurrencyMetrics());
  });

  // ── Security: invite-code gate ──────────────────────────────────────────────
  // Front-end guards the invite gate, but the core endpoints (project creation,
  // planning, building) must independently enforce it: the session must be
  // authenticated AND the user must have redeemed an invite code. Without this,
  // a logged-in but un-gated user (e.g. a brand-new GitHub-only signup) could hit
  // these APIs directly. Returns 401 if unauthenticated, 403 if no invite code.
  const requireInviteCode = async (req: any, res: any, next: any) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const user = await storage.getUser(userId);
      if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
      // 手机号注册用户（phone_verified=true）直接放行，无需邀请码
      if ((user as any).phoneVerified) { next(); return; }
      if (!(user as any).inviteCode) {
        res.status(403).json({ error: "Invite code required" });
        return;
      }
      next();
    } catch (err) {
      console.error("[requireInviteCode]", err);
      res.status(500).json({ error: "Authorization check failed" });
    }
  };

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

  app.post("/api/generate-project-name", async (req, res) => {
    try {
      const { idea, framework } = req.body as { idea?: string; framework?: string };
      if (!idea) {
        res.status(400).json({ error: "idea is required" });
        return;
      }
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
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const allProjects = await storage.getProjects(userId);
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

  app.post("/api/projects", requireInviteCode, async (req, res) => {
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
      const userId = (req.session as any)?.userId as string | undefined;

      const project = await storage.createProject({
        id,
        name,
        emoji: emoji ?? null,
        framework,
        language,
        targetPlatform,
        userId: userId ?? undefined,
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

  app.get("/api/projects/:id/messages", async (req, res) => {
    try {
      const projectId = req.params.id;
      const project = await storage.getProject(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const kindParam = String(req.query.kind ?? "");
      const kind = kindParam === "chat" || kindParam === "manager" ? kindParam : undefined;
      const beforeRaw = req.query.before;
      const before = typeof beforeRaw === "string" && beforeRaw.length > 0 ? Number(beforeRaw) : undefined;
      const limitRaw = req.query.limit;
      const limit = typeof limitRaw === "string" && limitRaw.length > 0 ? Number(limitRaw) : 100;
      // sessionId: 传了就过滤；"null" 字符串 = 主会话（sessionId IS NULL）；不传 = 全部
      const sessionIdRaw = req.query.sessionId;
      const sessionId = typeof sessionIdRaw === "string"
        ? (sessionIdRaw === "null" ? null : sessionIdRaw)
        : undefined;
      const rows = await storage.listChatMessages(projectId, {
        kind,
        before: Number.isFinite(before) ? (before as number) : undefined,
        limit: Number.isFinite(limit) ? limit : 100,
        sessionId,
      });
      res.json({ messages: rows });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to list messages" });
    }
  });

  app.post("/api/projects/:id/messages", async (req, res) => {
    try {
      const projectId = req.params.id;
      const project = await storage.getProject(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const body = req.body as { messages?: unknown };
      if (!Array.isArray(body?.messages)) {
        res.status(400).json({ error: "messages must be an array" });
        return;
      }
      const allowedKinds = new Set(["chat", "manager"]);
      const sanitized: ChatMessageInput[] = [];
      for (const raw of body.messages) {
        if (!raw || typeof raw !== "object") continue;
        const m = raw as Record<string, unknown>;
        if (typeof m.clientId !== "string" || !m.clientId) continue;
        if (typeof m.kind !== "string" || !allowedKinds.has(m.kind)) continue;
        if (typeof m.role !== "string") continue;
        if (typeof m.seq !== "number" || !Number.isFinite(m.seq)) continue;
        if (typeof m.timestamp !== "number" || !Number.isFinite(m.timestamp)) continue;
        sanitized.push({
          clientId: m.clientId,
          kind: m.kind as "chat" | "manager",
          role: m.role,
          content: typeof m.content === "string" ? m.content : "",
          thinking: typeof m.thinking === "string" ? m.thinking : null,
          source: typeof m.source === "string" ? m.source : null,
          seq: m.seq,
          timestamp: m.timestamp,
          metadata: typeof m.metadata === "string" ? m.metadata : null,
          sessionId: typeof m.sessionId === "string" ? m.sessionId : null,
        });
      }
      await storage.upsertChatMessages(projectId, sanitized);
      res.json({ ok: true, count: sanitized.length });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to save messages" });
    }
  });

  app.delete("/api/projects/:id/messages", async (req, res) => {
    try {
      const projectId = req.params.id;
      const project = await storage.getProject(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const afterSeqRaw = req.query.afterSeq;
      const afterSeq = typeof afterSeqRaw === "string" ? Number(afterSeqRaw) : NaN;
      if (!Number.isFinite(afterSeq)) {
        res.status(400).json({ error: "afterSeq query param required" });
        return;
      }
      // sessionId：传了就按 session 删，不传默认删 "main"
      const sessionIdRaw = req.query.sessionId;
      const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : null;
      await storage.deleteChatMessagesAfter(projectId, afterSeq, sessionId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to delete messages" });
    }
  });

  // ── Chat Sessions ─────────────────────────────────────────────────────────
  // GET  /api/projects/:id/sessions       — list sessions (newest first)
  // POST /api/projects/:id/sessions       — create new session
  // DELETE /api/projects/:id/sessions/:sid — delete session + its messages

  app.get("/api/projects/:id/sessions", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const projectId = req.params.id;
      const rows = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.projectId, projectId))
        .orderBy(desc(chatSessions.createdAt));
      res.json({ sessions: rows });
    } catch (err) {
      console.error("[sessions/list]", err);
      res.status(500).json({ error: "Failed to list sessions" });
    }
  });

  app.post("/api/projects/:id/sessions", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const projectId = req.params.id;
      const name = (req.body as any)?.name ?? "新对话";
      const id = randomBytes(8).toString("hex");
      const [row] = await db.insert(chatSessions).values({
        id,
        projectId,
        name: String(name).slice(0, 80),
      }).returning();
      res.status(201).json({ session: row });
    } catch (err) {
      console.error("[sessions/create]", err);
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  app.delete("/api/projects/:id/sessions/:sid", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { sid } = req.params;
      // cascade delete removes messages via FK
      await db.delete(chatSessions).where(eq(chatSessions.id, sid));
      res.json({ ok: true });
    } catch (err) {
      console.error("[sessions/delete]", err);
      res.status(500).json({ error: "Failed to delete session" });
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

  // WeChat project export — downloads the source tree as a ZIP that can be
  // opened directly in Tencent WeChat Developer Tools for 100%-faithful preview.
  app.get("/api/projects/:id/export-wechat", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      const files = await storage.getProjectFiles(req.params.id);
      if (!files || files.length === 0) { res.status(404).json({ error: "No files found" }); return; }

      const safeName = (project.name ?? "miniprogram").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_").slice(0, 40);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", (err: Error) => {
        console.error("[wx-export] archive error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to create archive" });
      });
      archive.pipe(res);

      for (const file of files) {
        // Strip /project/ prefix — the ZIP root IS the mini-program root.
        let rel = file.path.replace(/^\/project\//, "");
        if (!rel) continue;
        // Sanitise path segments.
        rel = rel.split("/").filter((s) => s && s !== ".." && s !== ".").join("/");
        if (!rel) continue;
        archive.append(file.content, { name: rel });
      }

      await archive.finalize();
    } catch (err: any) {
      console.error("[wx-export]", err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: err?.message || "Export failed" });
    }
  });

  // === REFERRAL ===

  const REFERRAL_GRANT_DAYS = 30;
  // Anti-abuse: cap how many referrals earn the *inviter* a reward. Without this,
  // someone can register N throwaway accounts, have each redeem the inviter's
  // code, and stack unlimited free trial days. Invitees still always get their
  // one-time reward; only the inviter's payout is bounded.
  const REFERRAL_MAX_REWARDED = 10;

  // 6-character random suffix from an unambiguous charset, drawn from a CSPRNG.
  // crypto.randomBytes (not Math.random) so issued codes are unpredictable and
  // cannot be enumerated/guessed — Math.random is seeded PRNG output and is a
  // real abuse vector for codes that gate paid trials.
  // Space: 32^6 = ~1 billion combinations. charset length 32 divides 256, so
  // `byte % 32` is bias-free.
  function randomSuffix(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(6);
    let s = "";
    for (let i = 0; i < 6; i++) s += chars[bytes[i] % chars.length];
    return s;
  }

  // Determine the referral code prefix for a user based on their email.
  // CASCQJ = 奇迹创坛, CASCEDU = edu, CASC = standard
  // Format matches admin-issued invite codes: prefix + 6 random chars, no separator.
  async function referralCodePrefix(userId: string): Promise<string> {
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    const email = row?.email ?? "";
    if (isQizhiEmail(email)) return "CASCQJ";
    if (isEduEmail(email)) return "CASCEDU";
    return "CASC";
  }

  // Ensure the user has a referral code, generating one if absent.
  // Retries up to 20 times on unique-constraint collision (probability negligible at scale).
  async function ensureReferralCode(userId: string): Promise<string> {
    const [row] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId));
    if (row?.referralCode) return row.referralCode;
    const prefix = await referralCodePrefix(userId);
    for (let i = 0; i < 20; i++) {
      const code = `${prefix}${randomSuffix()}`;
      try {
        await db.update(users).set({ referralCode: code }).where(eq(users.id, userId));
        return code;
      } catch {
        // unique constraint violation — retry with a new suffix
      }
    }
    throw new Error("Failed to generate referral code after 20 attempts");
  }

  // Extend trialExpiresAt by N days (from now or from current expiry, whichever is later)
  async function extendTrial(userId: string, days: number, reason: string, relatedUserId?: string): Promise<void> {
    const [row] = await db.select({ trialExpiresAt: users.trialExpiresAt }).from(users).where(eq(users.id, userId));
    const base = row?.trialExpiresAt && row.trialExpiresAt > new Date() ? row.trialExpiresAt : new Date();
    const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    await db.update(users).set({ trialExpiresAt: newExpiry }).where(eq(users.id, userId));
    await db.insert(subscriptionGrants).values({ userId, grantedDays: days, reason, relatedUserId: relatedUserId ?? null });
  }

  // GET /api/referral/my-code — return the current user's referral code and stats
  app.get("/api/referral/my-code", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const code = await ensureReferralCode(userId);

      // Count how many users this person has successfully referred
      const [{ referralCount }] = await db
        .select({ referralCount: count() })
        .from(users)
        .where(eq(users.referredBy, userId));

      const baseUrl = process.env.APP_BASE_URL || "http://localhost:5000";
      res.json({
        referralCode: code,
        referralLink: `${baseUrl}/register?ref=${code}`,
        referralCount: Number(referralCount),
        grantDays: REFERRAL_GRANT_DAYS,
      });
    } catch (err) {
      console.error("[referral/my-code]", err);
      res.status(500).json({ error: "Failed to get referral code" });
    }
  });

  // POST /api/referral/redeem — new user redeems a referral code after registration
  // Body: { referralCode: string }
  app.post("/api/referral/redeem", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { referralCode: code } = req.body as { referralCode?: string };
      if (!code?.trim()) return res.status(400).json({ error: "Referral code required" });

      // Check the invitee hasn't already used a referral code
      const [me] = await db.select({ referredBy: users.referredBy }).from(users).where(eq(users.id, userId));
      if (me?.referredBy) return res.status(400).json({ error: "You have already used a referral code" });

      // Look up the referrer
      const [referrer] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code.trim().toUpperCase()));
      if (!referrer) return res.status(400).json({ error: "Invalid referral code" });
      if (referrer.id === userId) return res.status(400).json({ error: "You cannot use your own referral code" });

      // Record the referral. The invitee always gets their one-time reward, but
      // the inviter's reward is capped (anti-abuse: stops mass throwaway-account
      // referral farming). Count existing successful referrals BEFORE recording
      // this one to decide whether the inviter is still within the reward cap.
      const [{ priorReferrals }] = await db
        .select({ priorReferrals: count() })
        .from(users)
        .where(eq(users.referredBy, referrer.id));

      await db.update(users).set({ referredBy: referrer.id }).where(eq(users.id, userId));
      await extendTrial(userId, REFERRAL_GRANT_DAYS, "referral_invitee", referrer.id);

      const inviterRewarded = Number(priorReferrals) < REFERRAL_MAX_REWARDED;
      if (inviterRewarded) {
        await extendTrial(referrer.id, REFERRAL_GRANT_DAYS, "referral_inviter", userId);
      }

      res.json({ ok: true, grantedDays: REFERRAL_GRANT_DAYS, inviterRewarded });
    } catch (err) {
      console.error("[referral/redeem]", err);
      res.status(500).json({ error: "Failed to redeem referral code" });
    }
  });

  // ── User Feedback ─────────────────────────────────────────────────────────
  // POST /api/feedback — submit user suggestion
  app.post("/api/feedback", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { content, source } = req.body as { content?: string; source?: string };
      if (!content?.trim()) return res.status(400).json({ error: "Content required" });
      await db.insert(userFeedback).values({
        userId,
        content: content.trim().slice(0, 2000),
        source: (source === "mobile" ? "mobile" : "pc"),
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("[feedback]", err);
      res.status(500).json({ error: "Failed to submit feedback" });
    }
  });

  // GET /api/admin/feedback — list all feedback (admin only)
  app.get("/api/admin/feedback", async (req, res) => {
    try {
      const secret = req.headers["x-admin-secret"] as string | undefined;
      if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
      const rows = await db
        .select({
          id: userFeedback.id,
          content: userFeedback.content,
          source: userFeedback.source,
          createdAt: userFeedback.createdAt,
          repliedAt: userFeedback.repliedAt,
          replyContent: userFeedback.replyContent,
          username: users.username,
          email: users.email,
          phone: users.phone,
        })
        .from(userFeedback)
        .leftJoin(users, eq(userFeedback.userId, users.id))
        .orderBy(desc(userFeedback.createdAt))
        .limit(500);
      res.json({ feedback: rows });
    } catch (err) {
      console.error("[admin/feedback]", err);
      res.status(500).json({ error: "Failed to fetch feedback" });
    }
  });

  // POST /api/admin/feedback/:id/reply — 管理员回复用户建议，写入 notifications 表并标记已回复
  app.post("/api/admin/feedback/:id/reply", async (req, res) => {
    try {
      const secret = req.headers["x-admin-secret"] as string | undefined;
      if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
      const feedbackId = parseInt(req.params.id);
      const { message } = req.body as { message?: string };
      if (!message?.trim()) return res.status(400).json({ error: "Message required" });
      const [fb] = await db.select({ userId: userFeedback.userId, content: userFeedback.content })
        .from(userFeedback).where(eq(userFeedback.id, feedbackId));
      if (!fb) return res.status(404).json({ error: "Feedback not found" });
      // 写入 notifications
      await db.insert(notifications).values({
        userId: fb.userId,
        type: "admin_reply",
        title: "管理员回复了你的建议",
        body: message.trim(),
      });
      // 标记 feedback 已回复
      await db.update(userFeedback)
        .set({ repliedAt: new Date(), replyContent: message.trim() })
        .where(eq(userFeedback.id, feedbackId));
      res.json({ ok: true });
    } catch (err) {
      console.error("[admin/feedback/reply]", err);
      res.status(500).json({ error: "Failed to send reply" });
    }
  });

  // GET /api/notifications — 拉取当前用户通知列表
  app.get("/api/notifications", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(50);
      res.json({ notifications: rows });
    } catch (err) {
      console.error("[notifications]", err);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // PATCH /api/notifications/:id/read — 标记单条已读
  app.patch("/api/notifications/:id/read", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = parseInt(req.params.id);
      await db.update(notifications).set({ isRead: true })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark read" });
    }
  });

  // PATCH /api/notifications/read-all — 全部标记已读
  app.patch("/api/notifications/read-all", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark all read" });
    }
  });

  // === AUTH ===

  // Validate an invite code and atomically mark it redeemed by the given user.
  // Returns the trial expiry to write to users.trialExpiresAt, or an error
  // string for the caller to map to an HTTP 400 response.
  async function redeemInviteCode(code: string, userId: string): Promise<
    | { ok: true; trialExpiresAt: Date; code: string }
    | { ok: false; error: "Invalid invite code" | "Invite code already used" | "Invite code expired" }
  > {
    const trimmed = code.trim();
    if (!trimmed) return { ok: false, error: "Invalid invite code" };
    const [invite] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, trimmed));
    if (!invite) return { ok: false, error: "Invalid invite code" };
    if (invite.redeemedByUserId) return { ok: false, error: "Invite code already used" };
    if (new Date(invite.expiresAt).getTime() < Date.now()) return { ok: false, error: "Invite code expired" };
    const now = new Date();
    // Trial starts from registration time (now).
    // For 奇绩创坛 codes: look up the subscriber's email to apply the fixed deadline.
    let trialExpiresAt = new Date(now.getTime() + invite.trialDays * 24 * 60 * 60 * 1000);
    if (invite.waitlistSubscriberId) {
      const [sub] = await db.select({ email: waitlistSubscribers.email })
        .from(waitlistSubscribers)
        .where(eq(waitlistSubscribers.id, invite.waitlistSubscriberId));
      if (sub && isQizhiEmail(sub.email)) {
        trialExpiresAt = QIZHI_FREE_UNTIL < trialExpiresAt ? QIZHI_FREE_UNTIL : trialExpiresAt;
      }
    }
    const updated = await db.update(inviteCodes)
      .set({ redeemedByUserId: userId, redeemedAt: now })
      .where(and(eq(inviteCodes.id, invite.id), isNull(inviteCodes.redeemedByUserId)))
      .returning({ id: inviteCodes.id });
    if (updated.length === 0) {
      // Lost the race against another redemption.
      return { ok: false, error: "Invite code already used" };
    }
    return { ok: true, trialExpiresAt, code: trimmed };
  }

  app.post("/api/auth/register", async (req, res) => {
    // Username-based registration is closed. New users must register via
    // email OTP, phone OTP, or GitHub OAuth.
    return res.status(403).json({ error: "Registration via username is not available. Please sign up with email, phone, or GitHub." });
  });

  app.post("/api/auth/invite-gate", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { inviteCode } = req.body as { inviteCode?: string };
      if (!inviteCode?.trim()) return res.status(400).json({ error: "Invite code required" });

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if ((user as any).inviteCode) {
        // Idempotent — already redeemed.
        return res.json({ ok: true, alreadyRedeemed: true });
      }

      const redeem = await redeemInviteCode(inviteCode, userId);
      if (!redeem.ok) return res.status(400).json({ error: redeem.error });

      await db.update(users)
        .set({ inviteCode: redeem.code, trialExpiresAt: redeem.trialExpiresAt })
        .where(eq(users.id, userId));

      res.json({ ok: true, inviteCode: redeem.code, trialExpiresAt: redeem.trialExpiresAt.toISOString() });
    } catch (err) {
      console.error("[auth/invite-gate]", err);
      res.status(500).json({ error: "Failed to redeem invite code" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      if (!(await checkCaptcha(req, res))) return;
      const { username, password } = req.body as { username: string; password: string };
      if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
        return res.status(400).json({ error: "username and password required" });
      }
      const identifier = username.trim();

      // Resolve user by email, phone, or username — whichever matches first.
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.toLowerCase());
      const isPhone = /^\+\d{8,15}$/.test(identifier);
      let user =
        isEmail ? await storage.getUserByEmail(identifier.toLowerCase())
        : isPhone ? await storage.getUserByPhone(identifier)
        : await storage.getUserByUsername(identifier);

      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      if (!user.password) return res.status(401).json({ error: "Invalid credentials" });

      // Account lockout check
      if (isAccountLocked(user.id)) {
        const entry = accountLockout.get(user.id);
        const remainingSec = entry?.lockedUntil ? Math.ceil((entry.lockedUntil - Date.now()) / 1000) : 900;
        return res.status(403).json({ error: "Account temporarily locked due to too many failed attempts.", remainingSec });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        recordLoginFail(user.id);
        const entry = accountLockout.get(user.id);
        const remaining = MAX_FAIL - (entry?.failCount ?? 0);
        const msg = remaining <= 0
          ? "Account temporarily locked due to too many failed attempts."
          : `Invalid credentials. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`;
        return res.status(401).json({ error: msg });
      }

      // Success — clear any lockout
      clearAccountLockout(user.id);
      (req.session as any).userId = user.id;
      await new Promise<void>((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
      res.json({
        id: user.id,
        username: user.username,
        experienceLevel: (user as any).experienceLevel,
        hasSetExperienceLevel: (user as any).hasSetExperienceLevel ?? false,
        inviteCode: (user as any).inviteCode ?? null,
        trialExpiresAt: (user as any).trialExpiresAt
          ? ((user as any).trialExpiresAt as Date).toISOString()
          : null,
      });
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
    res.json({
      id: user.id,
      username: user.username,
      experienceLevel: (user as any).experienceLevel,
      hasSetExperienceLevel: (user as any).hasSetExperienceLevel ?? false,
      hasPassword: !!(user as any).password,
      inviteCode: (user as any).inviteCode ?? null,
      phoneVerified: !!(user as any).phoneVerified,
      email: (user as any).email ?? null,
      phone: (user as any).phone ?? null,
      githubId: (user as any).githubId ?? null,
      trialExpiresAt: (user as any).trialExpiresAt
        ? ((user as any).trialExpiresAt as Date).toISOString()
        : null,
    });
  });

  app.put("/api/auth/me/username", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { username } = req.body as { username?: string };
      if (!username || typeof username !== "string" || !username.trim()) {
        return res.status(400).json({ error: "Username required" });
      }
      const trimmed = username.trim();
      if (trimmed.length < 2 || trimmed.length > 32) {
        return res.status(400).json({ error: "Username must be 2–32 characters" });
      }
      if (!/^[a-zA-Z0-9_\-一-龥]+$/.test(trimmed)) {
        return res.status(400).json({ error: "Username contains invalid characters" });
      }
      const existing = await storage.getUserByUsername(trimmed);
      if (existing && existing.id !== userId) {
        return res.status(409).json({ error: "Username already taken" });
      }
      await db.update(users).set({ username: trimmed }).where(eq(users.id, userId));
      res.json({ ok: true, username: trimmed });
    } catch (err) {
      console.error("[auth/me/username]", err);
      res.status(500).json({ error: "Failed to update username" });
    }
  });

  app.put("/api/auth/me/experience", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { experienceLevel } = req.body as { experienceLevel?: string };
      const safeLevel = ["beginner", "intermediate", "advanced"].includes(experienceLevel ?? "")
        ? (experienceLevel as string) : "intermediate";

      await db.update(users)
        .set({ experienceLevel: safeLevel, hasSetExperienceLevel: true })
        .where(eq(users.id, userId));

      // Seed starter skill
      const starterPath = join(srcDir("skills", "builtin", "starters"), `${safeLevel}.md`);
      if (existsSync(starterPath)) {
        const content = readFileSync(starterPath, "utf-8");
        await db.insert(userSkills).values({
          userId,
          name: `starter-${safeLevel}`,
          description: `Starter guidance for ${safeLevel} developers`,
          type: "knowledge",
          content,
          enabled: true,
        }).onConflictDoNothing();
      }

      const user = await storage.getUser(userId);
      res.json({ id: user!.id, username: user!.username, experienceLevel: safeLevel, hasSetExperienceLevel: true });
    } catch (err) {
      console.error("[auth/experience]", err);
      res.status(500).json({ error: "Failed to set experience level" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) console.error("[auth/logout]", err);
      res.status(204).end();
    });
  });

  // Set or change the current user's password. OTP-registered users (password
  // === null) can set one without a current password. Users who already have a
  // password must prove it (currentPassword) so a hijacked session can't lock
  // out the owner. On success the session is destroyed — the user must log in
  // again with the new credential.
  app.post("/api/auth/set-password", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { password, currentPassword } = req.body as {
        password?: string; currentPassword?: string;
      };
      if (typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      if ((user as any).password) {
        // Already has a password — require the current one to change it.
        if (typeof currentPassword !== "string" || !currentPassword) {
          return res.status(403).json({ error: "Current password required" });
        }
        const match = await bcrypt.compare(currentPassword, (user as any).password);
        if (!match) return res.status(403).json({ error: "Current password incorrect" });
      }

      const hashed = await bcrypt.hash(password, 10);
      await db.update(users).set({ password: hashed }).where(eq(users.id, userId));

      // Force re-login with the new credential.
      req.session.destroy((err) => {
        if (err) console.error("[auth/set-password] session destroy", err);
        res.json({ ok: true, reauth: true });
      });
    } catch (err) {
      console.error("[auth/set-password]", err);
      res.status(500).json({ error: "Failed to set password" });
    }
  });

  // Send a password-reset code to an email/phone. Anti-enumeration: always
  // returns 200 regardless of whether an account exists; only sends a code when
  // a matching user is found. Uses a distinct OTP purpose so a reset code can't
  // be replayed against the login endpoint (and vice versa).
  app.post("/api/auth/reset-password/send", async (req, res) => {
    try {
      if (!(await checkCaptcha(req, res))) return;
      const { channel, target } = req.body as { channel?: string; target?: string };
      if (channel !== "email" && channel !== "sms") {
        return res.status(400).json({ error: "Invalid channel" });
      }
      const normalized = normalizeTarget(channel, target ?? "");
      if (!normalized) {
        return res.status(400).json({ error: channel === "email" ? "Invalid email" : "Invalid phone" });
      }

      const existing = channel === "email"
        ? await storage.getUserByEmail(normalized)
        : await storage.getUserByPhone(normalized);

      if (existing) {
        const result = await sendOtp({ channel, target: normalized, purpose: "reset_password" });
        if (!result.ok) {
          return res.status(429).json({ error: "Send rate-limited", retryAfterSec: result.retryAfterSec });
        }
        // Identical response whether or not the account exists — anti-enumeration.
        return res.json({ ok: true, retryAfterSec: result.retryAfterSec });
      }
      // Account not found — return identical shape so callers can't enumerate.
      res.json({ ok: true, retryAfterSec: 60 });
    } catch (err) {
      console.error("[auth/reset-password/send]", err);
      res.status(500).json({ error: "Failed to send code" });
    }
  });

  // Verify a reset code and set a new password. Does NOT log the user in — they
  // sign in afterwards with the new credential. Receiving the code proves
  // ownership of the email/phone, so the matching verified flag is also set.
  app.post("/api/auth/reset-password/verify", async (req, res) => {
    try {
      const { channel, target, code, password } = req.body as {
        channel?: string; target?: string; code?: string; password?: string;
      };
      if (channel !== "email" && channel !== "sms") {
        return res.status(400).json({ error: "Invalid channel" });
      }
      const normalized = normalizeTarget(channel, target ?? "");
      if (!normalized) {
        return res.status(400).json({ error: channel === "email" ? "Invalid email" : "Invalid phone" });
      }
      if (!code || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: "Invalid or expired code" });
      }
      if (typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const verify = await verifyOtp({ channel, target: normalized, code, purpose: "reset_password" });
      if (!verify.ok) {
        const errMsg = verify.error === "locked" ? "Code locked - request a new one" : "Invalid or expired code";
        return res.status(401).json({ error: errMsg });
      }

      const existing = channel === "email"
        ? await storage.getUserByEmail(normalized)
        : await storage.getUserByPhone(normalized);
      // Generic 401 — don't reveal whether the account exists at this stage.
      if (!existing) return res.status(401).json({ error: "Invalid or expired code" });

      const hashed = await bcrypt.hash(password, 10);
      const verifiedPatch = channel === "email"
        ? { emailVerified: true }
        : { phoneVerified: true };
      await db.update(users)
        .set({ password: hashed, ...verifiedPatch })
        .where(eq(users.id, existing.id));

      res.json({ ok: true });
    } catch (err) {
      console.error("[auth/reset-password/verify]", err);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // 人机验证（腾讯云天御）：从请求体取 ticket/randstr，结合真实 IP 验票。
  // 验证失败返回 403。未配置凭证时 verifyCaptcha 内部降级放行。
  // 注意：这不替代 OTP 发送频率限制 / 验证码锁，两者叠加才完整。
  const checkCaptcha = async (req: any, res: any): Promise<boolean> => {
    const { ticket, randstr } = req.body as { ticket?: string; randstr?: string };
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
    const ok = await verifyCaptcha(ticket ?? "", randstr ?? "", ip);
    if (!ok) res.status(403).json({ error: "Captcha verification failed" });
    return ok;
  };

  // 前端 TCaptcha 初始化所需的公开 CaptchaAppId。enabled=false 时前端跳过取票。
  app.get("/api/config/captcha", (_req, res) => {
    res.json({ enabled: isCaptchaEnabled(), appId: getCaptchaAppId() });
  });

  // === OTP (email + phone) ===

  app.post("/api/auth/otp/send", async (req, res) => {
    try {
      if (!(await checkCaptcha(req, res))) return;
      const { channel, target, purpose: rawPurpose } = req.body as { channel?: string; target?: string; purpose?: string };
      if (channel !== "email" && channel !== "sms") {
        return res.status(400).json({ error: "Invalid channel" });
      }
      const normalized = normalizeTarget(channel, target ?? "");
      if (!normalized) {
        return res.status(400).json({ error: channel === "email" ? "Invalid email" : "Invalid phone" });
      }
      const purpose = rawPurpose === "bind_email" ? "bind_email" : "login";
      const result = await sendOtp({ channel, target: normalized, purpose });
      if (!result.ok) {
        return res.status(429).json({ error: "Send rate-limited", retryAfterSec: result.retryAfterSec });
      }
      res.json({ ok: true, retryAfterSec: result.retryAfterSec });
    } catch (err) {
      console.error("[auth/otp/send]", err);
      res.status(500).json({ error: "Failed to send code" });
    }
  });

  app.post("/api/auth/otp/verify-login", async (req, res) => {
    try {
      if (!(await checkCaptcha(req, res))) return;
      const { channel, target, code, inviteCode, referralCode } = req.body as {
        channel?: string; target?: string; code?: string; inviteCode?: string; referralCode?: string;
      };
      if (channel !== "email" && channel !== "sms") {
        return res.status(400).json({ error: "Invalid channel" });
      }
      const normalized = normalizeTarget(channel, target ?? "");
      if (!normalized) {
        return res.status(400).json({ error: channel === "email" ? "Invalid email" : "Invalid phone" });
      }
      if (!code || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: "Invalid or expired code" });
      }

      const verify = await verifyOtp({ channel, target: normalized, code, purpose: "login" });
      if (!verify.ok) {
        const errMsg = verify.error === "locked" ? "Code locked - request a new one" : "Invalid or expired code";
        return res.status(401).json({ error: errMsg });
      }

      // Look up existing user by email or phone
      const existing = channel === "email"
        ? await storage.getUserByEmail(normalized)
        : await storage.getUserByPhone(normalized);

      if (existing) {
        const verifiedPatch = channel === "email"
          ? { emailVerified: true }
          : { phoneVerified: true };
        await db.update(users).set(verifiedPatch).where(eq(users.id, existing.id));
        (req.session as any).userId = existing.id;
        await new Promise<void>((resolve, reject) =>
          req.session.save((err) => (err ? reject(err) : resolve()))
        );
        return res.json({
          id: existing.id,
          username: existing.username,
          experienceLevel: (existing as any).experienceLevel,
          hasSetExperienceLevel: (existing as any).hasSetExperienceLevel ?? false,
          inviteCode: (existing as any).inviteCode ?? null,
          trialExpiresAt: (existing as any).trialExpiresAt
            ? ((existing as any).trialExpiresAt as Date).toISOString()
            : null,
        });
      }

      // Auto-register: phone (SMS) users bypass invite code and get 30-day free trial.
      // Email users require a manual invite code or a valid referral code.
      if (channel === "sms") {
        // Create phone user directly — no invite code needed
        let username = "";
        let createdUserId = "";
        for (let i = 0; i < 5; i++) {
          const candidate = `user_${randomBytes(4).toString("hex")}`;
          try {
            const id = randomBytes(16).toString("hex");
            const trialExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            const [row] = await db.insert(users).values({
              id,
              username: candidate,
              password: null,
              phone: normalized,
              phoneVerified: true,
              trialExpiresAt,
            }).returning({ id: users.id, username: users.username });
            createdUserId = row.id;
            username = row.username;
            break;
          } catch (err: any) {
            if (!String(err?.message ?? "").includes("users_username")) throw err;
          }
        }
        if (!createdUserId) {
          return res.status(500).json({ error: "Failed to create account" });
        }
        let newReferralCode: string | null = null;
        try { newReferralCode = await ensureReferralCode(createdUserId); } catch {}
        (req.session as any).userId = createdUserId;
        await new Promise<void>((resolve, reject) =>
          req.session.save((err) => (err ? reject(err) : resolve()))
        );
        return res.status(201).json({
          id: createdUserId,
          username,
          experienceLevel: "intermediate",
          hasSetExperienceLevel: false,
          inviteCode: null,
          trialExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          referralCode: newReferralCode,
        });
      }

      // Email registration: either a manual invite code or a valid referral code is required.
      let resolvedInviteCode = inviteCode;
      let referrerId: string | null = null;
      if (!resolvedInviteCode?.trim() && referralCode?.trim()) {
        const ref = referralCode.trim().toUpperCase();
        const [referrer] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.referralCode, ref));
        if (!referrer) {
          return res.status(400).json({ error: "Invalid invite code" });
        }
        referrerId = referrer.id;
        // Generate a fresh single-use invite code tied to this registration.
        const autoCode = `REFAUTO${randomSuffix()}`;
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        await db.insert(inviteCodes).values({
          code: autoCode,
          trialDays: 14,
          expiresAt,
        });
        resolvedInviteCode = autoCode;
      }
      if (!resolvedInviteCode?.trim()) {
        return res.status(400).json({ error: "Invite code required" });
      }

      // Create the user first (no password, OTP is the credential)
      let username = "";
      let createdUserId = "";
      for (let i = 0; i < 5; i++) {
        const candidate = `user_${randomBytes(4).toString("hex")}`;
        try {
          const id = randomBytes(16).toString("hex");
          const [row] = await db.insert(users).values({
            id,
            username: candidate,
            password: null,
            email: channel === "email" ? normalized : null,
            phone: channel === "sms" ? normalized : null,
            emailVerified: channel === "email",
            phoneVerified: channel === "sms",
          }).returning({ id: users.id, username: users.username });
          createdUserId = row.id;
          username = row.username;
          break;
        } catch (err: any) {
          // Username collision — retry. Anything else: bail.
          if (!String(err?.message ?? "").includes("users_username")) throw err;
        }
      }
      if (!createdUserId) {
        return res.status(500).json({ error: "Failed to create account" });
      }

      const redeem = await redeemInviteCode(resolvedInviteCode, createdUserId);
      if (!redeem.ok) {
        // Roll back the user so target isn't burned on a bad invite code.
        await db.delete(users).where(eq(users.id, createdUserId));
        return res.status(400).json({ error: redeem.error });
      }

      // Generate a unique referral code for the new user
      let newReferralCode: string | null = null;
      try { newReferralCode = await ensureReferralCode(createdUserId); } catch {}

      await db.update(users)
        .set({
          inviteCode: redeem.code,
          trialExpiresAt: redeem.trialExpiresAt,
          ...(referrerId ? { referredBy: referrerId } : {}),
        })
        .where(eq(users.id, createdUserId));

      (req.session as any).userId = createdUserId;
      await new Promise<void>((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
      res.status(201).json({
        id: createdUserId,
        username,
        experienceLevel: "intermediate",
        hasSetExperienceLevel: false,
        inviteCode: redeem.code,
        trialExpiresAt: redeem.trialExpiresAt.toISOString(),
        referralCode: newReferralCode,
      });
    } catch (err) {
      console.error("[auth/otp/verify-login]", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Bind email to an existing logged-in account via OTP verification
  app.post("/api/auth/bind-email", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "not_logged_in" });

      const { target, code } = req.body as { target?: string; code?: string };
      const normalized = normalizeTarget("email", target ?? "");
      if (!normalized) return res.status(400).json({ error: "Invalid email" });
      if (!code || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Invalid or expired code" });

      // check email not already taken by another account
      const existing = await storage.getUserByEmail(normalized);
      if (existing && existing.id !== userId) {
        return res.status(409).json({ error: "Email already in use" });
      }

      const verify = await verifyOtp({ channel: "email", target: normalized, code, purpose: "bind_email" });
      if (!verify.ok) {
        const errMsg = verify.error === "locked" ? "Code locked - request a new one" : "Invalid or expired code";
        return res.status(401).json({ error: errMsg });
      }

      await db.update(users)
        .set({ email: normalized, emailVerified: true })
        .where(eq(users.id, userId));

      res.json({ ok: true });
    } catch (err) {
      console.error("[auth/bind-email]", err);
      res.status(500).json({ error: "Bind failed" });
    }
  });

  // === GitHub OAuth ===

  // Node's built-in fetch (an internal undici copy) ignores HTTPS_PROXY by
  // default, which makes github.com unreachable behind a local proxy. We
  // import undici's own fetch + ProxyAgent so the dispatcher and fetch come
  // from the same undici version (mixing the npm package's ProxyAgent with
  // the built-in fetch causes "invalid onRequestStart method" errors).
  // Built lazily so prod, where HTTPS_PROXY is unset, pays no cost.
  let githubFetch: typeof fetch = fetch;
  let githubFetchInited = false;
  const getGithubFetch = async (): Promise<typeof fetch> => {
    if (githubFetchInited) return githubFetch;
    githubFetchInited = true;
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
      || process.env.HTTP_PROXY || process.env.http_proxy;
    if (proxyUrl) {
      try {
        const undici = await import("undici");
        const dispatcher = new undici.ProxyAgent(proxyUrl);
        githubFetch = ((url: any, init: any = {}) =>
          (undici.fetch as any)(url, { ...init, dispatcher })) as unknown as typeof fetch;
        console.log(`[auth/github] routing GitHub fetches via proxy ${proxyUrl}`);
      } catch (err) {
        console.warn("[auth/github] failed to init undici proxy fetch:", err instanceof Error ? err.message : err);
      }
    }
    return githubFetch;
  };

  // 1) Kick off the OAuth dance: store a state token in the session and
  //    redirect the browser to GitHub's authorize URL.
  app.get("/api/auth/github", async (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) { res.status(500).json({ error: "GitHub OAuth not configured" }); return; }
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const state = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await pool.query(
      `INSERT INTO session (sid, sess, expire) VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = $2, expire = $3`,
      [`github_state:${state}`, JSON.stringify({ githubOAuthState: state }), expiresAt]
    );
    const redirectUri = `${baseUrl}/api/auth/github/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${baseUrl}/api/auth/github/callback`,
      scope: "read:user user:email",
      state,
      allow_signup: "true",
    });
    const authorizeUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    // ?mode=url — 前端 fetch 模式，返回 JSON 避免 302 被 SPA 路由拦截
    if (req.query.mode === "url") {
      res.json({ url: authorizeUrl });
      return;
    }
    res.redirect(authorizeUrl);
  });

  // 2) Callback: exchange the code for an access token, fetch the user,
  //    then either link to an existing local user (matched by verified
  //    primary email) or create a new GitHub-only user. Finally seat the
  //    session and send the browser back to the SPA.
  // callback：验证 state 后跳前端页面，token 交换由浏览器完成（服务器访问 github.com 被墙）
  app.get("/api/auth/github/callback", async (req, res) => {
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) {
      res.redirect(`${baseUrl}/login?github_error=missing_params`);
      return;
    }
    // 验证 state 有效（防 CSRF），验完保留，让 exchange 接口再验一次后删除
    const row = await pool.query(
      `SELECT sess FROM session WHERE sid = $1 AND expire > NOW()`,
      [`github_state:${state}`]
    );
    if (row.rows.length === 0) {
      res.redirect(`${baseUrl}/login?github_error=bad_state`);
      return;
    }
    // 跳前端 callback 页面，由浏览器完成 token 交换
    res.redirect(`${baseUrl}/github-callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
  });

  // exchange：前端发来 code+state，后端用固定 IP 换 token，建立 session
  app.post("/api/auth/github/exchange", async (req, res) => {
    try {
      const { code, state } = req.body as { code?: string; state?: string };
      if (!code || !state) { res.status(400).json({ error: "missing_params" }); return; }
      const row = await pool.query(
        `SELECT sess FROM session WHERE sid = $1 AND expire > NOW()`,
        [`github_state:${state}`]
      );
      if (row.rows.length === 0) { res.status(400).json({ error: "bad_state" }); return; }
      await pool.query(`DELETE FROM session WHERE sid = $1`, [`github_state:${state}`]);

      const clientId = process.env.GITHUB_CLIENT_ID!;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET!;
      const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

      // github.com:443 在墙内不稳定，并发尝试多个已知 IP，取第一个成功的
      const GITHUB_IPS = ["20.205.243.166", "20.27.177.113", "140.82.112.4", "140.82.113.4", "140.82.114.4"];

      function tryTokenExchange(ghIp: string, body: string): Promise<any> {
        return new Promise((resolve, reject) => {
          const req2 = https.request({
            hostname: ghIp,
            port: 443,
            path: "/login/oauth/access_token",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Host: "github.com",
              "Content-Length": Buffer.byteLength(body),
            },
            rejectUnauthorized: false,
            timeout: 8000,
          }, (r) => {
            let data = "";
            r.on("data", (c) => data += c);
            r.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("parse error")); } });
          });
          req2.on("error", reject);
          req2.on("timeout", () => { req2.destroy(); reject(new Error("timeout")); });
          req2.write(body);
          req2.end();
        });
      }

      const tokenBody = JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${baseUrl}/api/auth/github/callback`,
      });

      const tokenData: any = await Promise.any(
        GITHUB_IPS.map(ip => tryTokenExchange(ip, tokenBody))
      ).catch(() => { throw new Error("all_ips_failed"); });

      if (!tokenData.access_token) {
        console.error("[github/exchange] token error:", tokenData);
        res.status(400).json({ error: tokenData.error || "no_access_token" });
        return;
      }
      const accessToken = tokenData.access_token;

      const ghFetch = await getGithubFetch();
      const userRes = await ghFetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
      });
      if (!userRes.ok) {
        const errBody = await userRes.text().catch(() => "");
        console.error("[github/exchange] user fetch failed:", userRes.status, errBody);
        res.status(400).json({ error: "user_fetch_failed" }); return;
      }
      const ghUser = await userRes.json() as {
        id: number; login: string; email: string | null; avatar_url: string | null;
      };

      let primaryEmail: string | null = ghUser.email ? ghUser.email.trim().toLowerCase() : null;
      if (!primaryEmail) {
        const emailsRes = await ghFetch("https://api.github.com/user/emails", {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
        });
        if (emailsRes.ok) {
          const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
          const picked = emails.find(e => e.primary && e.verified)?.email
            ?? emails.find(e => e.verified)?.email ?? null;
          primaryEmail = picked ? picked.trim().toLowerCase() : null;
        }
      }

      const githubId = String(ghUser.id);
      let user = await storage.getUserByGithubId(githubId);
      if (!user && primaryEmail) {
        const matched = await storage.getUserByEmail(primaryEmail);
        if (matched) {
          user = await storage.linkGithubToUser(matched.id, { githubId, avatarUrl: ghUser.avatar_url });
        }
      }
      if (!user) {
        let candidate = ghUser.login;
        let suffix = 0;
        while (await storage.getUserByUsername(candidate)) {
          suffix++;
          candidate = `${ghUser.login}-${suffix}`;
        }
        user = await storage.createGithubUser({
          username: candidate,
          githubId,
          email: primaryEmail,
          avatarUrl: ghUser.avatar_url,
        });
      }

      (req.session as any).userId = user.id;
      await new Promise<void>((resolve, reject) =>
        req.session.save((err) => err ? reject(err) : resolve())
      );
      res.json({
        id: user.id,
        username: user.username,
        inviteCode: (user as any).inviteCode ?? null,
      });
    } catch (err) {
      console.error("[auth/github/exchange]", err);
      res.status(500).json({ error: "server_error" });
    }
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
      const skillsDir = srcDir("skills", "builtin");
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

  // === WAITLIST / ADMIN INVITES ===

  const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";
  const BATCH_SIZE = 50;
  const TRIAL_DAYS_NORMAL = 30;
  const TRIAL_DAYS_EDU = 60;
  const QIZHI_FREE_UNTIL = new Date("2026-09-30T23:59:59+08:00");
  const WAITLIST_BASE_URL = process.env.BASE_URL ?? process.env.APP_BASE_URL ?? "https://cascadeai.co";

  function isEduEmail(email: string): boolean {
    const lower = email.toLowerCase();
    return lower.endsWith(".edu.cn") || lower.endsWith(".edu");
  }

  function isQizhiEmail(email: string): boolean {
    return email.toLowerCase().endsWith("@miracleplus.com");
  }

  // CODE_EXPIRY_DAYS: how long the invite code itself remains claimable after
  // being issued. Once the user registers, trial starts from registration time.
  const CODE_EXPIRY_DAYS = 90;

  function getTrialInfo(email: string, isEdu: boolean): { trialDays: number; codeExpiresAt: Date; label: string } {
    const codeExpiresAt = new Date(Date.now() + CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    if (isQizhiEmail(email)) {
      // trialDays calculated at redemption time relative to QIZHI_FREE_UNTIL,
      // so we store a sentinel value here; redeemInviteCode will recompute.
      const daysUntilDeadline = Math.ceil((QIZHI_FREE_UNTIL.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      return {
        trialDays: daysUntilDeadline,
        codeExpiresAt,
        label: "奇绩创坛专属免费期至 2026 年 9 月 30 日（自注册之日起计算）",
      };
    }
    if (isEdu) {
      return {
        trialDays: TRIAL_DAYS_EDU,
        codeExpiresAt,
        label: `教育优惠免费期 ${TRIAL_DAYS_EDU} 天（自注册之日起计算）`,
      };
    }
    return {
      trialDays: TRIAL_DAYS_NORMAL,
      codeExpiresAt,
      label: `免费试用期 ${TRIAL_DAYS_NORMAL} 天（自注册之日起计算）`,
    };
  }
  // Prefix encodes the user tier; suffix is a 6-char CSPRNG random string.
  // CASC = standard (30d), CASCEDU = edu (60d), CASCQJ = 奇绩创坛 (until 2026-09-30).
  // Random (not sequential) so codes can't be guessed/enumerated to claim trials.
  function inviteCodePrefix(email: string): string {
    if (isQizhiEmail(email)) return "CASCQJ";
    if (isEduEmail(email)) return "CASCEDU";
    return "CASC";
  }
  function formatInviteCode(email: string): string {
    return `${inviteCodePrefix(email)}${randomSuffix()}`;
  }
  function checkAdmin(req: any, res: any): boolean {
    if (!ADMIN_SECRET) {
      res.status(503).json({ error: "Admin access not configured" });
      return false;
    }
    if (req.headers["x-admin-secret"] !== ADMIN_SECRET) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  // POST /api/waitlist — public submit
  app.post("/api/waitlist", async (req, res) => {
    try {
      const schema = z.object({ email: z.string().email() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Valid email required" });
      const email = parsed.data.email.trim().toLowerCase();
      const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
      const isEdu = isEduEmail(email);

      const existing = await db.select().from(waitlistSubscribers).where(eq(waitlistSubscribers.email, email));
      if (existing.length > 0) {
        return res.json({ queued: true, alreadyOnList: true });
      }

      const [sub] = await db.insert(waitlistSubscribers).values({ email, ipAddress, isEdu }).returning();

      // Immediately allocate an invite code and send the invite email.
      (async () => {
        try {
          const { trialDays, codeExpiresAt, label: trialLabel } = getTrialInfo(email, isEdu);
          let code = "";
          let allocated = false;
          for (let attempt = 0; attempt < 5 && !allocated; attempt++) {
            try {
              await db.transaction(async (tx) => {
                code = formatInviteCode(email);
                await tx.insert(inviteCodes).values({
                  code,
                  isEdu,
                  trialDays,
                  expiresAt: codeExpiresAt,
                  waitlistSubscriberId: sub.id,
                });
              });
              allocated = true;
            } catch (err: any) {
              const msg: string = err?.message ?? "";
              if (!msg.includes("unique") && !msg.includes("duplicate")) throw err;
            }
          }
          if (!allocated) {
            console.error(`[waitlist/invite] failed to allocate code for ${email}`);
            return;
          }
          const codeExpiryStr = codeExpiresAt.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
          const html = `
            <div style="font-family:'Helvetica Neue',sans-serif;max-width:560px;margin:0 auto;padding:48px 24px;color:#111827">
              <p style="margin-bottom:24px">您好！</p>
              <p style="margin-bottom:24px">感谢申请使用 Cascade AI，您的专属邀请码如下：</p>
              <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px">
                <span style="font-size:28px;font-weight:800;letter-spacing:4px;color:#111827">${code}</span>
              </div>
              <p style="margin-bottom:24px">请前往 <a href="${WAITLIST_BASE_URL}" style="color:#2563eb">http://cascadeai.cn/</a> 注册时填写邀请码。</p>
              <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:24px">
                <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#92400e">${trialLabel}</p>
                <p style="margin:0;font-size:13px;color:#b45309">免费期从您<strong>完成注册之日</strong>起开始计算。邀请码领取截止日期：<strong>${codeExpiryStr}</strong>，请在此日期前完成注册，逾期邀请码将失效。</p>
              </div>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0"/>
              <p style="color:#9ca3af;font-size:12px">CascadeAI · ${WAITLIST_BASE_URL.replace(/^https?:\/\//, "")}</p>
            </div>
          `;
          await sendEmail({
            to: email,
            subject: `您的 Cascade AI 邀请码`,
            html,
            text: `您好！\n\n感谢申请使用 Cascade AI，您的专属邀请码如下：\n\n${code}\n\n请前往 http://cascadeai.cn/ 注册时填写邀请码。\n\n${trialLabel}\n免费期从您完成注册之日起开始计算。邀请码领取截止日期：${codeExpiryStr}，请在此日期前完成注册，逾期邀请码将失效。`,
          });
          await db.update(waitlistSubscribers).set({ status: "invited" }).where(eq(waitlistSubscribers.id, sub.id));
        } catch (err) {
          console.error("[waitlist/invite]", err);
          await db.update(waitlistSubscribers).set({ status: "email_failed" }).where(eq(waitlistSubscribers.id, sub.id));
        }
      })();

      res.json({ queued: true });
    } catch (err) {
      console.error("[waitlist/submit]", err);
      res.status(500).json({ error: "Failed to join waitlist" });
    }
  });

  // GET /api/waitlist — admin list
  app.get("/api/waitlist", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const [subs, [totalRow]] = await Promise.all([
        db.select().from(waitlistSubscribers).orderBy(desc(waitlistSubscribers.createdAt)),
        db.select({ total: count() }).from(waitlistSubscribers),
      ]);
      // Pull the most recent invite code per subscriber for the admin view.
      const issuedCodes = await db.select().from(inviteCodes);
      const codeBySubId = new Map<number, typeof issuedCodes[number]>();
      for (const c of issuedCodes) {
        if (c.waitlistSubscriberId) codeBySubId.set(c.waitlistSubscriberId, c);
      }
      res.json({
        total: totalRow?.total ?? 0,
        subscribers: subs.map((s) => {
          const c = codeBySubId.get(s.id);
          return {
            id: s.id,
            email: s.email,
            createdAt: s.createdAt,
            isEdu: s.isEdu,
            status: s.status,
            batchId: s.batchId,
            inviteCode: c?.code ?? null,
            invitedAt: c?.createdAt ?? null,
            expiresAt: c?.expiresAt ?? null,
            seqNum: c?.id ?? null,
            registeredAt: c?.redeemedAt ?? null,
          };
        }),
      });
    } catch (err) {
      console.error("[waitlist/list]", err);
      res.status(500).json({ error: "Failed to fetch waitlist" });
    }
  });

  // ── Admin: IP blocklist management ─────────────────────────────────────────

  // GET /api/admin/blocklist/ip — list all blocked IPs
  app.get("/api/admin/blocklist/ip", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const now = Date.now();
    const list = Array.from((app as any)._ipBlocklist.entries())
      .filter(([, v]: [string, any]) => v.blockedUntil > now)
      .map(([ip, v]: [string, any]) => ({
        ip,
        reason: v.reason,
        blockedAt: new Date(v.blockedAt).toISOString(),
        blockedUntil: new Date(v.blockedUntil).toISOString(),
        remainingSec: Math.ceil((v.blockedUntil - now) / 1000),
      }));
    res.json({ total: list.length, items: list });
  });

  // DELETE /api/admin/blocklist/ip/:ip — unblock an IP
  app.delete("/api/admin/blocklist/ip/:ip", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const ip = decodeURIComponent(req.params.ip);
    const existed = (app as any)._ipBlocklist.has(ip);
    (app as any)._ipBlocklist.delete(ip);
    res.json({ ok: true, ip, unblocked: existed });
  });

  // POST /api/admin/blocklist/ip — manually block an IP
  app.post("/api/admin/blocklist/ip", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const { ip, durationHours = 1, reason = "Manual block" } = req.body as {
      ip?: string; durationHours?: number; reason?: string;
    };
    if (!ip || typeof ip !== "string") return res.status(400).json({ error: "ip required" });
    const now = Date.now();
    (app as any)._ipBlocklist.set(ip.trim(), {
      blockedUntil: now + durationHours * 60 * 60 * 1000,
      reason,
      blockedAt: now,
    });
    res.json({ ok: true, ip: ip.trim(), durationHours });
  });

  // ── Admin: Account lockout management ──────────────────────────────────────

  // GET /api/admin/blocklist/users — list locked accounts
  app.get("/api/admin/blocklist/users", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    const now = Date.now();
    const locked: any[] = [];
    for (const [userId, entry] of (app as any)._accountLockout.entries()) {
      if (entry.lockedUntil && entry.lockedUntil > now) {
        // fetch username
        const user = await storage.getUser(userId).catch(() => null);
        locked.push({
          userId,
          username: (user as any)?.username ?? "unknown",
          email: (user as any)?.email ?? null,
          failCount: entry.failCount,
          lockedAt: entry.lockedAt ? new Date(entry.lockedAt).toISOString() : null,
          lockedUntil: new Date(entry.lockedUntil).toISOString(),
          remainingSec: Math.ceil((entry.lockedUntil - now) / 1000),
        });
      }
    }
    res.json({ total: locked.length, items: locked });
  });

  // DELETE /api/admin/blocklist/users/:userId — unlock an account
  app.delete("/api/admin/blocklist/users/:userId", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const { userId } = req.params;
    const existed = (app as any)._accountLockout.has(userId);
    (app as any)._clearAccountLockout(userId);
    res.json({ ok: true, userId, unlocked: existed });
  });

  // GET /api/admin/blocklist/users/:userId — check a specific user's lockout
  app.get("/api/admin/blocklist/users/:userId", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    const { userId } = req.params;
    const entry = (app as any)._accountLockout.get(userId);
    const now = Date.now();
    if (!entry || !entry.lockedUntil || entry.lockedUntil <= now) {
      return res.json({ locked: false, userId });
    }
    const user = await storage.getUser(userId).catch(() => null);
    res.json({
      locked: true,
      userId,
      username: (user as any)?.username ?? "unknown",
      failCount: entry.failCount,
      lockedUntil: new Date(entry.lockedUntil).toISOString(),
      remainingSec: Math.ceil((entry.lockedUntil - now) / 1000),
    });
  });

  // POST /api/admin/send-invites — manual bulk send by IDs
  app.post("/api/admin/send-invites", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const ids = (req.body as { ids?: number[] })?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "No subscriber IDs provided" });
      }
      const sent = await sendInvitesForSubscribers(ids);
      res.json({ success: true, sent });
    } catch (err) {
      console.error("[admin/send-invites]", err);
      res.status(500).json({ error: "Failed to send invites" });
    }
  });

  // GET /api/admin/confirm-batch?token=... — link target from notification email
  app.get("/api/admin/confirm-batch", async (req, res) => {
    const token = req.query.token as string | undefined;
    if (!token || !ADMIN_SECRET) return res.status(400).send("Invalid token");
    let batchId: number;
    try {
      const decoded = Buffer.from(token, "base64url").toString();
      const [batchStr, secret] = decoded.split(":");
      if (secret !== ADMIN_SECRET) return res.status(401).send("Invalid token");
      batchId = parseInt(batchStr, 10);
      if (isNaN(batchId)) throw new Error("bad batchId");
    } catch {
      return res.status(400).send("Invalid token");
    }
    try {
      const subsInBatch = await db.select({ id: waitlistSubscribers.id })
        .from(waitlistSubscribers)
        .where(and(
          eq(waitlistSubscribers.batchId, batchId),
          eq(waitlistSubscribers.status, "pending"),
        ));
      const sent = await sendInvitesForSubscribers(subsInBatch.map((s) => s.id));
      res.send(`<html><body style="font-family:sans-serif;padding:40px;max-width:500px;margin:auto">
        <h2>邀请码已发送</h2>
        <p>成功向 <strong>${sent}</strong> 位用户发送了邀请码。</p>
        <a href="/admin" style="color:#2563eb">返回后台</a>
      </body></html>`);
    } catch (err) {
      console.error("[admin/confirm-batch]", err);
      res.status(500).send("发送失败，请在后台手动重试。");
    }
  });

  // ── Helpers (waitlist) ──────────────────────────────────────────────────
  async function notifyAdminOfBatch(pending: number): Promise<void> {
    const nextBatchId = Math.floor(pending / BATCH_SIZE);
    // Tag the BATCH_SIZE most recent untagged pending subscribers.
    const untagged = await db.select().from(waitlistSubscribers)
      .where(and(eq(waitlistSubscribers.status, "pending"), isNull(waitlistSubscribers.batchId)))
      .orderBy(waitlistSubscribers.createdAt);
    const slice = untagged.slice(0, BATCH_SIZE);
    if (slice.length === 0) return;
    await Promise.all(slice.map((u) =>
      db.update(waitlistSubscribers)
        .set({ batchId: nextBatchId })
        .where(eq(waitlistSubscribers.id, u.id))
    ));

    if (!ADMIN_SECRET) return;
    const token = Buffer.from(`${nextBatchId}:${ADMIN_SECRET}`).toString("base64url");
    const confirmUrl = `${WAITLIST_BASE_URL}/api/admin/confirm-batch?token=${token}`;
    const listHtml = slice
      .map((u, i) => `<tr><td style="padding:4px 12px">${i + 1}</td><td style="padding:4px 12px">${u.email}</td><td style="padding:4px 12px">${u.isEdu ? "EDU" : "普通"}</td></tr>`)
      .join("");
    const html = `
      <h2>Waitlist Batch #${nextBatchId} — ${slice.length} 位新用户</h2>
      <table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
        <thead><tr><th style="padding:4px 12px">#</th><th style="padding:4px 12px">Email</th><th style="padding:4px 12px">类型</th></tr></thead>
        <tbody>${listHtml}</tbody>
      </table>
      <br/>
      <a href="${confirmUrl}" style="display:inline-block;padding:12px 24px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">
        确认并发送邀请码给这 ${slice.length} 位用户
      </a>
    `;
    await sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: `[CascadeAI] Waitlist Batch #${nextBatchId} — ${slice.length} 位用户待确认`,
      html,
      text: `Waitlist Batch #${nextBatchId}，共 ${slice.length} 位用户。确认链接：${confirmUrl}`,
    });
  }

  async function sendInvitesForSubscribers(subscriberIds: number[]): Promise<number> {
    if (subscriberIds.length === 0) return 0;

    // Pull the target subscribers (pending or email_failed — the latter need a retry).
    const allTargets = await db.select().from(waitlistSubscribers)
      .where(or(
        eq(waitlistSubscribers.status, "pending"),
        eq(waitlistSubscribers.status, "email_failed"),
      ));
    const targets = allTargets.filter((s) => subscriberIds.includes(s.id));
    if (targets.length === 0) return 0;

    // Codes are random (prefix + CSPRNG suffix). Each subscriber's INSERT runs in
    // its own short transaction so a unique-constraint collision (negligibly rare)
    // rolls back only that subscriber and is retried with a fresh suffix, never
    // aborting the whole batch.
    let sent = 0;

    for (const sub of targets) {
      const { trialDays, codeExpiresAt, label: trialLabel } = getTrialInfo(sub.email, sub.isEdu);

      // For email_failed retries: a code was already allocated — reuse it.
      // For pending: allocate a new code inside a transaction to avoid races.
      let code: string;
      const [existing] = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.waitlistSubscriberId, sub.id));

      if (existing) {
        code = existing.code;
      } else {
        // Codes are now random (prefix + CSPRNG suffix), so no COUNT/sequence is
        // needed. Insert inside a transaction and retry on the (negligible, ~1 in
        // 1e9) unique-constraint collision with a freshly-drawn suffix; a collision
        // rolls back only this subscriber, not the whole batch.
        let allocated = false;
        let allocatedCode = "";
        for (let attempt = 0; attempt < 5 && !allocated; attempt++) {
          try {
            await db.transaction(async (tx) => {
              allocatedCode = formatInviteCode(sub.email);
              await tx.insert(inviteCodes).values({
                code: allocatedCode,
                isEdu: sub.isEdu,
                trialDays,
                expiresAt: codeExpiresAt,
                waitlistSubscriberId: sub.id,
              });
            });
            allocated = true;
          } catch (err: any) {
            const msg: string = err?.message ?? "";
            if (!msg.includes("unique") && !msg.includes("duplicate")) throw err;
            console.warn(`[invite-code] unique collision for subscriber ${sub.id}, attempt ${attempt + 1}`);
          }
        }
        if (!allocated) {
          console.error(`[invite-code] failed to allocate unique code for subscriber ${sub.id} after 5 attempts`);
          continue;
        }
        code = allocatedCode;
      }

      const codeExpiryStr = codeExpiresAt.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
      const html = `
        <div style="font-family:'Helvetica Neue',sans-serif;max-width:560px;margin:0 auto;padding:48px 24px;color:#111827">
          <p style="margin-bottom:24px">您好！</p>
          <p style="margin-bottom:24px">感谢申请使用 Cascade AI，您的专属邀请码如下：</p>
          <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px">
            <span style="font-size:28px;font-weight:800;letter-spacing:4px;color:#111827">${code}</span>
          </div>
          <p style="margin-bottom:24px">请前往 <a href="${WAITLIST_BASE_URL}" style="color:#2563eb">http://cascadeai.cn/</a> 注册时填写邀请码。</p>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:24px">
            <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#92400e">${trialLabel}</p>
            <p style="margin:0;font-size:13px;color:#b45309">免费期从您<strong>完成注册之日</strong>起开始计算。邀请码领取截止日期：<strong>${codeExpiryStr}</strong>，请在此日期前完成注册，逾期邀请码将失效。</p>
          </div>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0"/>
          <p style="color:#9ca3af;font-size:12px">CascadeAI · ${WAITLIST_BASE_URL.replace(/^https?:\/\//, "")}</p>
        </div>
      `;

      // --- Fix #2: send the email FIRST; only mark the subscriber as
      // "invited" if the send succeeds.  On failure, mark "email_failed" so
      // the next manual re-run (which also selects email_failed) can retry.
      try {
        await sendEmail({
          to: sub.email,
          subject: `您的 Cascade AI 邀请码`,
          html,
          text: `您好！\n\n感谢申请使用 Cascade AI，您的专属邀请码如下：\n\n${code}\n\n请前往 http://cascadeai.cn/ 注册时填写邀请码。\n\n${trialLabel}\n免费期从您完成注册之日起开始计算。邀请码领取截止日期：${codeExpiryStr}，请在此日期前完成注册，逾期邀请码将失效。`,
        });
        await db.update(waitlistSubscribers)
          .set({ status: "invited" })
          .where(eq(waitlistSubscribers.id, sub.id));
        sent++;
        // 限速：Resend 免费套餐 2 req/s，每封间隔 600ms 留余量
        await new Promise(r => setTimeout(r, 600));
      } catch (err) {
        console.error("[invite-email] send failed, marking email_failed", err, sub.email);
        await db.update(waitlistSubscribers)
          .set({ status: "email_failed" })
          .where(eq(waitlistSubscribers.id, sub.id));
        // 失败后也等一下再继续，避免连续触发限速
        await new Promise(r => setTimeout(r, 600));
      }
    }
    return sent;
  }

  // GET /api/admin/export-csv — download waitlist as CSV
  // DELETE /api/admin/otp-limit/:target — clear OTP rate-limit records for an
  // email or phone so the user can request a new code immediately.
  app.delete("/api/admin/otp-limit/:target", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const target = decodeURIComponent(req.params.target).trim().toLowerCase();
      if (!target) return res.status(400).json({ error: "target required" });
      const deleted = await db.delete(otpCodes).where(eq(otpCodes.target, target)).returning({ id: otpCodes.id });
      res.json({ ok: true, deleted: deleted.length });
    } catch (err) {
      console.error("[admin/otp-limit]", err);
      res.status(500).json({ error: "Failed to clear OTP limit" });
    }
  });

  // GET /api/admin/otp-limit/:target — show OTP records for a target
  app.get("/api/admin/otp-limit/:target", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const target = decodeURIComponent(req.params.target).trim().toLowerCase();
      if (!target) return res.status(400).json({ error: "target required" });
      const rows = await db.select({
        id: otpCodes.id, channel: otpCodes.channel, purpose: otpCodes.purpose,
        attempts: otpCodes.attempts, expiresAt: otpCodes.expiresAt,
        consumedAt: otpCodes.consumedAt, createdAt: otpCodes.createdAt,
      }).from(otpCodes).where(eq(otpCodes.target, target))
        .orderBy(desc(otpCodes.createdAt));
      res.json({ items: rows });
    } catch (err) {
      console.error("[admin/otp-limit]", err);
      res.status(500).json({ error: "Failed to fetch OTP records" });
    }
  });

  app.get("/api/admin/export-csv", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const subs = await db.select().from(waitlistSubscribers).orderBy(waitlistSubscribers.createdAt);
      const codes = await db.select().from(inviteCodes);
      const codeBySubId = new Map(codes.filter((c) => c.waitlistSubscriberId != null).map((c) => [c.waitlistSubscriberId!, c]));

      function emailType(email: string, isEdu: boolean): string {
        if (isQizhiEmail(email)) return "奇绩创坛";
        if (isEdu || email.match(/\.edu(\.cn)?(\.|\b)/i)) return "教育";
        return "其他";
      }

      function csvField(v: string | null | undefined): string {
        if (v == null || v === "") return "";
        return `"${v.replace(/"/g, '""')}"`;
      }

      const header = "id,email,邮箱类型,是否发送确认邮件,是否发送邀请码,邀请码,IP地址,注册时间\n";
      const rows = subs.map((s) => {
        const code = codeBySubId.get(s.id);
        return [
          s.id,
          csvField(s.email),
          emailType(s.email, s.isEdu),
          s.confirmationEmailSentAt ? "是" : "否",
          s.status === "invited" ? "是" : "否",
          csvField(code?.code ?? null),
          csvField(s.ipAddress ?? null),
          s.createdAt.toISOString(),
        ].join(",");
      }).join("\n");

      const csv = "﻿" + header + rows; // BOM for Excel UTF-8
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="waitlist.csv"');
      res.send(csv);
    } catch (err) {
      console.error("[admin/export-csv]", err);
      res.status(500).json({ error: "Failed to export CSV" });
    }
  });

  // POST /api/admin/sheet-update — write-back from Google Sheet to DB
  app.post("/api/admin/sheet-update", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const { applySheetUpdate } = await import("../../infra/sheets-sync.js");
      const updates = req.body.updates;
      if (!Array.isArray(updates)) return res.status(400).json({ error: "updates must be an array" });
      const changed = await applySheetUpdate(updates);
      res.json({ ok: true, changed });
    } catch (err) {
      console.error("[admin/sheet-update]", err);
      res.status(500).json({ error: "Failed to apply updates" });
    }
  });

  // POST /api/admin/sync-sheets-now — manually trigger immediate sync
  app.post("/api/admin/sync-sheets-now", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const { syncToSheets } = await import("../../infra/sheets-sync.js");
      await syncToSheets();
      res.json({ ok: true });
    } catch (err) {
      console.error("[admin/sync-sheets-now]", err);
      res.status(500).json({ error: "Sync failed" });
    }
  });

  // GET /api/admin/users — 用户总览：注册状态、最后活跃、项目数、剩余免费期。
  // 活跃时间 = 该用户名下所有项目最新一条 chat_messages 的时间戳（最贴近真实使用）。
  app.get("/api/admin/users", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      // 每用户项目数。
      const projectCounts = await db
        .select({ userId: projects.userId, n: count() })
        .from(projects)
        .groupBy(projects.userId);
      const projectCountMap = new Map<string, number>();
      for (const row of projectCounts) {
        if (row.userId) projectCountMap.set(row.userId, Number(row.n));
      }

      // 每用户最后活跃时间：关联 projects → chat_messages 取最大时间戳（bigint 毫秒）。
      const activity = await db
        .select({ userId: projects.userId, lastTs: sql<string>`max(${chatMessages.timestamp})` })
        .from(chatMessages)
        .innerJoin(projects, eq(chatMessages.projectId, projects.id))
        .groupBy(projects.userId);
      const lastActiveMap = new Map<string, number>();
      for (const row of activity) {
        if (row.userId && row.lastTs != null) lastActiveMap.set(row.userId, Number(row.lastTs));
      }

      const allUsers = await db.select().from(users);
      const now = Date.now();
      const items = allUsers.map((u) => {
        const trialMs = u.trialExpiresAt ? new Date(u.trialExpiresAt).getTime() : null;
        const lastActiveTs = lastActiveMap.get(u.id) ?? null;
        return {
          id: u.id,
          username: u.username,
          email: u.email,
          phone: u.phone,
          // 已激活 = 已兑换邀请码（通过邀请码门）。
          activated: !!u.inviteCode,
          authMethod: u.githubId ? "github" : u.email ? "email" : u.phone ? "phone" : "other",
          projectCount: projectCountMap.get(u.id) ?? 0,
          lastActiveAt: lastActiveTs ? new Date(lastActiveTs).toISOString() : null,
          trialExpiresAt: u.trialExpiresAt ? new Date(u.trialExpiresAt).toISOString() : null,
          // 剩余免费期（秒）；已过期为 0，无试用期为 null。
          trialRemainingSec: trialMs != null ? Math.max(0, Math.floor((trialMs - now) / 1000)) : null,
        };
      });
      // 最近活跃优先（无活跃记录的排末尾）。
      items.sort((a, b) => {
        const ta = a.lastActiveAt ? Date.parse(a.lastActiveAt) : 0;
        const tb = b.lastActiveAt ? Date.parse(b.lastActiveAt) : 0;
        return tb - ta;
      });

      res.json({
        total: items.length,
        activated: items.filter((i) => i.activated).length,
        items,
      });
    } catch (err) {
      console.error("[admin/users]", err);
      res.status(500).json({ error: "Failed to load users" });
    }
  });

  // ── Helpers (waitlist) — confirmation email ─────────────────────────────
  async function sendWaitlistConfirmationEmail(email: string, markSent = true): Promise<void> {
    const logoSvg = `data:image/svg+xml;base64,${Buffer.from('<svg viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="175" y="155" width="56" height="260" fill="#111111"/><rect x="355" y="275" width="56" height="245" fill="#111111"/><rect x="540" y="380" width="65" height="255" fill="#111111"/></svg>').toString("base64")}`;
    const html = `
      <div style="font-family:'Helvetica Neue',sans-serif;max-width:560px;margin:0 auto;padding:48px 24px;color:#111827">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px">
          <img src="${logoSvg}" alt="Cascade AI" width="28" height="28" style="display:inline-block;vertical-align:middle"/>
          <span style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#111827;vertical-align:middle">Cascade AI</span>
        </div>
        <h2 style="font-size:22px;font-weight:700;margin-bottom:16px;color:#111827">Thanks for signing up!</h2>
        <p style="color:#374151;font-size:15px;line-height:1.7;margin-bottom:16px">Hi there,</p>
        <p style="color:#374151;font-size:15px;line-height:1.7;margin-bottom:16px">
          Thanks for checking out Cascade AI! We're stoked to invite you to our founding user cohort — your first month is on us.
        </p>
        <p style="color:#374151;font-size:15px;line-height:1.7;margin-bottom:16px">
          Our engineering team is shipping non&#8209;stop to build an AI Agent that redefines how developers build with AI. We'll drop full launch details as we inch closer to the big day. Stay tuned for updates :)
        </p>
        <p style="color:#374151;font-size:15px;line-height:1.7;margin-bottom:4px">Jonathan</p>
        <p style="color:#6b7280;font-size:14px;line-height:1.6;margin-bottom:32px">Founder, Cascade AI</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0"/>
        <p style="color:#9ca3af;font-size:12px">Cascade AI · ${WAITLIST_BASE_URL.replace(/^https?:\/\//, "")}</p>
      </div>
    `;
    await sendEmail({
      to: email,
      subject: "Thanks for signing up!",
      html,
      text: `Hi there,\n\nThanks for checking out Cascade AI! We're stoked to invite you to our founding user cohort — your first month is on us.\n\nOur engineering team is shipping non‑stop to build an AI Agent that redefines how developers build with AI. We'll drop full launch details as we inch closer to the big day. Stay tuned for updates :)\n\nJonathan\nFounder, Cascade AI\n\nCascade AI · ${WAITLIST_BASE_URL.replace(/^https?:\/\//, "")}`,
    });
    if (markSent) {
      await db.update(waitlistSubscribers)
        .set({ confirmationEmailSentAt: new Date() })
        .where(eq(waitlistSubscribers.email, email));
    }
  }

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
  ): Promise<void> {
    const job = videoJobs.get(jobId)!;
    const tmpDir = join(tmpdir(), `cascade-video-${jobId}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let browser: any = null;
    let ffmpegAbort: (() => void) | null = null;
    let aborted = false;

    const timeout = setTimeout(() => {
      aborted = true;
      try { browser?.close(); } catch {}
      if (ffmpegAbort) ffmpegAbort();
      job.status = "error";
      job.error = "timeout";
      job.finishedAt = Date.now();
      activeVideoJobs = Math.max(0, activeVideoJobs - 1);
    }, VIDEO_TIMEOUT_MS);

    try {
      await mkdir(tmpDir, { recursive: true });

      // dynamic import via variable so tsc does not resolve the module at compile time
      const pwModule = "playwright";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { chromium } = await import(/* @vite-ignore */ pwModule) as any;
      browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      const page = await browser.newPage();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`http://localhost:${PORT}/preview/${projectId}`, { waitUntil: "networkidle", timeout: 30_000 });

      job.status = "running";
      const totalFrames = duration * 10;
      const intervalMs = 100;

      for (let i = 0; i < totalFrames; i++) {
        if (aborted) return;
        const framePath = join(tmpDir, `frame_${String(i).padStart(4, "0")}.png`);
        await page.screenshot({ path: framePath });
        const pct = Math.floor(((i + 1) / totalFrames) * 90);
        job.progress = pct;
        await new Promise<void>((r) => setTimeout(r, intervalMs));
      }

      await browser.close();
      browser = null;

      if (aborted) return;

      const outputPath = join(tmpDir, "output.mp4");
      const ffResult = await new Promise<{ exitCode: number; timedOut: boolean }>((resolve) => {
        const child = spawn("ffmpeg", [
          "-framerate", "10",
          "-i", join(tmpDir, "frame_%04d.png"),
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-y",
          outputPath,
        ], { cwd: tmpDir });

        ffmpegAbort = () => { try { child.kill("SIGKILL"); } catch {} };

        let settled = false;
        const ffTimer = setTimeout(() => {
          if (!settled) { settled = true; try { child.kill("SIGKILL"); } catch {} resolve({ exitCode: 1, timedOut: true }); }
        }, 60_000);

        child.on("close", (code) => {
          if (!settled) { settled = true; clearTimeout(ffTimer); resolve({ exitCode: code ?? 1, timedOut: false }); }
        });
        child.on("error", () => {
          if (!settled) { settled = true; clearTimeout(ffTimer); resolve({ exitCode: 1, timedOut: false }); }
        });
      });

      // delete frame PNGs, keep only MP4
      const frames = readdirSync(tmpDir).filter((f) => f.endsWith(".png"));
      await Promise.all(frames.map((f) => rm(join(tmpDir, f), { force: true })));

      if (aborted) return;

      if (ffResult.exitCode !== 0 || !existsSync(outputPath)) {
        throw new Error("ffmpeg failed");
      }

      job.outputPath = outputPath;
      job.progress = 100;
      job.status = "done";
      job.finishedAt = Date.now();
    } catch (err: unknown) {
      if (!aborted) {
        job.status = "error";
        job.error = err instanceof Error ? err.message : "unknown";
        job.finishedAt = Date.now();
      }
    } finally {
      clearTimeout(timeout);
      if (!aborted) activeVideoJobs = Math.max(0, activeVideoJobs - 1);
      try { browser?.close(); } catch {}
    }
  }

  app.post("/api/video/generate", async (req, res) => {
    const { projectId, duration } = req.body as { projectId?: string; duration?: number };
    if (!projectId || !duration || !ALLOWED_DURATIONS.has(duration)) {
      res.status(400).json({ error: "invalid_duration" });
      return;
    }
    if (activeVideoJobs >= MAX_VIDEO_JOBS) {
      res.status(429).json({ error: "too_many_jobs" });
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

    recordPreview(jobId, projectId, duration as 10 | 20 | 30).catch(() => {});
    res.json({ jobId });
  });

  app.get("/api/video/status/:jobId", (req, res) => {
    const job = videoJobs.get(req.params.jobId);
    if (!job) { res.status(404).end(); return; }
    res.json({ status: job.status, progress: job.progress, error: job.error ?? undefined });
  });

  app.get("/api/video/download/:jobId", (req, res) => {
    const job = videoJobs.get(req.params.jobId);
    if (!job || job.status !== "done" || !job.outputPath || !existsSync(job.outputPath)) {
      res.status(404).end();
      return;
    }
    const filePath = job.outputPath;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="preview-${job.duration}s.mp4"`);

    // clean up after response finishes
    res.on("finish", () => {
      rm(filePath, { force: true }).catch(() => {});
      videoJobs.delete(req.params.jobId);
    });

    res.sendFile(filePath);
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

  // ─────────────────────────────────────────────────────────────────────────────

  return httpServer;
}
