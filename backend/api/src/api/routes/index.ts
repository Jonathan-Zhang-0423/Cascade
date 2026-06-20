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
import { doubaoClient, DOUBAO_MODEL, DOUBAO_LITE_MODEL } from "../../agent/providers/doubao-client";
import { withRetry } from "../../agent/providers/retry";
import { compressMessages } from "../../infra/context-compressor";
import { storage } from "../../infra/storage";
import { srcDir } from "../../infra/paths";
import { userSessions, getConcurrencyMetrics } from "../../infra/concurrency";
import type { ChatMessageInput } from "../../infra/storage";
import { insertProjectSchema, userSkills, projectSkills, insertUserSkillSchema, insertProjectSkillSchema, users, waitlistSubscribers, inviteCodes } from "@cascade/database";
import { db } from "../../infra/db";
import { eq, and, desc, count, isNull, or } from "drizzle-orm";
import { sendEmail, NOTIFICATION_EMAIL } from "../../infra/email";
import { sendOtp, verifyOtp, normalizeTarget, type OtpChannel } from "../../auth/otp";
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
import { detectCapabilitiesDetailed, loadCapabilities } from "../../skills/capability-loader";
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
  Array.from(reviewSessions.entries()).forEach(([id, session]) => {
    if (session.done) {
      if (session.doneAt && now - session.doneAt > doneRetention) {
        reviewSessions.delete(id);
      }
      return;
    }
    if (session._startedAt && now - session._startedAt > maxAge) {
      session.aborted = true;
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

  app.post("/api/build-session", async (req, res) => {
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

  app.post("/api/manager-chat", async (req, res) => {
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
      const { messages, files, provider, framework: reqFramework, projectId: reqProjectId } = req.body as {
        messages: Array<{ role: "user" | "assistant"; content: string }>;
        files?: Array<{ path: string; content: string }>;
        provider?: AIProvider;
        framework?: Framework;
        projectId?: string;
      };
      const activeProvider: AIProvider = provider || "glm";
      const { client: activeAIClient, model: activeAIModel } = getOptimalClient("planning", activeProvider);

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
            .map((m) => `${m.name}(score=${m.score} via ${m.matched.slice(0, 3).join(",")})`)
            .join("; ")}`,
        );
        const capContent = await loadCapabilities(detectedCapMatches.map((m) => m.name));
        if (capContent) {
          systemPrompt = `${systemPrompt}\n\n## Capability Skills (MANDATORY)\n\nThe following capability guidance is in scope for this request. You MUST apply these patterns in your plan and step descriptions — treat them as hard requirements, not suggestions. If a capability's checklist applies, every item must be addressed:\n\n${capContent}`;
          // Surface which capabilities were activated so the client can show it.
          emit({ type: "capabilities_active", capabilities: detectedCapMatches.map((m) => ({ name: m.name, score: m.score })) });
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
        if (reqUserId && mgrSessionId) userSessions.unregister(reqUserId, mgrSessionId);
        const doneLine = "data: [DONE]\n\n";
        Array.from(mgrSession.sseWriters).forEach(w => { try { w(doneLine); } catch {} });
        if (!clientDisconnected) { try { res.end(); } catch {} }
        return;
      }



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
        } else {
          emit({ type: "manager_done" });
        }

        mgrSession.done = true;
        mgrSession.doneAt = Date.now();
        if (reqUserId && mgrSessionId) userSessions.unregister(reqUserId, mgrSessionId);
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
      const rows = await storage.listChatMessages(projectId, {
        kind,
        before: Number.isFinite(before) ? (before as number) : undefined,
        limit: Number.isFinite(limit) ? limit : 100,
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
      await storage.deleteChatMessagesAfter(projectId, afterSeq);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to delete messages" });
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
    try {
      const { username, password, inviteCode } = req.body as {
        username: string; password: string; inviteCode?: string;
      };
      if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
        return res.status(400).json({ error: "username and password required" });
      }
      if (typeof inviteCode !== "string" || !inviteCode.trim()) {
        return res.status(400).json({ error: "Invite code required" });
      }
      const existing = await storage.getUserByUsername(username.trim());
      if (existing) return res.status(409).json({ error: "Username already taken" });

      const hashed = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username: username.trim(), password: hashed });

      const redeem = await redeemInviteCode(inviteCode, user.id);
      if (!redeem.ok) {
        // Roll back the user we just created so the username doesn't get
        // burned on a bad invite code.
        await db.delete(users).where(eq(users.id, user.id));
        return res.status(400).json({ error: redeem.error });
      }
      await db.update(users)
        .set({ inviteCode: redeem.code, trialExpiresAt: redeem.trialExpiresAt })
        .where(eq(users.id, user.id));

      (req.session as any).userId = user.id;
      res.status(201).json({
        id: user.id,
        username: user.username,
        experienceLevel: (user as any).experienceLevel,
        hasSetExperienceLevel: (user as any).hasSetExperienceLevel ?? false,
        inviteCode: redeem.code,
        trialExpiresAt: redeem.trialExpiresAt.toISOString(),
      });
    } catch (err) {
      console.error("[auth/register]", err);
      res.status(500).json({ error: "Registration failed" });
    }
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
      const { username, password } = req.body as { username: string; password: string };
      if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
        return res.status(400).json({ error: "username and password required" });
      }
      const user = await storage.getUserByUsername(username.trim());
      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      // GitHub-only users (created via OAuth) have no password — reject the
      // password-based login path with the same generic error so we don't
      // leak which accounts are GitHub-only.
      if (!user.password) return res.status(401).json({ error: "Invalid credentials" });
      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(401).json({ error: "Invalid credentials" });
      (req.session as any).userId = user.id;
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
      inviteCode: (user as any).inviteCode ?? null,
      trialExpiresAt: (user as any).trialExpiresAt
        ? ((user as any).trialExpiresAt as Date).toISOString()
        : null,
    });
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

  // === OTP (email + phone) ===

  app.post("/api/auth/otp/send", async (req, res) => {
    try {
      const { channel, target } = req.body as { channel?: string; target?: string };
      if (channel !== "email" && channel !== "sms") {
        return res.status(400).json({ error: "Invalid channel" });
      }
      const normalized = normalizeTarget(channel, target ?? "");
      if (!normalized) {
        return res.status(400).json({ error: channel === "email" ? "Invalid email" : "Invalid phone" });
      }
      const result = await sendOtp({ channel, target: normalized, purpose: "login" });
      if (!result.ok) {
        return res.status(429).json({ error: "Send rate-limited", retryAfterSec: result.retryAfterSec });
      }
      res.json({ ok: true, retryAfterSec: 60 });
    } catch (err) {
      console.error("[auth/otp/send]", err);
      res.status(500).json({ error: "Failed to send code" });
    }
  });

  app.post("/api/auth/otp/verify-login", async (req, res) => {
    try {
      const { channel, target, code, inviteCode } = req.body as {
        channel?: string; target?: string; code?: string; inviteCode?: string;
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

      // Auto-register: invite code required
      if (!inviteCode?.trim()) {
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

      const redeem = await redeemInviteCode(inviteCode, createdUserId);
      if (!redeem.ok) {
        // Roll back the user so target isn't burned on a bad invite code.
        await db.delete(users).where(eq(users.id, createdUserId));
        return res.status(400).json({ error: redeem.error });
      }
      await db.update(users)
        .set({ inviteCode: redeem.code, trialExpiresAt: redeem.trialExpiresAt })
        .where(eq(users.id, createdUserId));

      (req.session as any).userId = createdUserId;
      res.status(201).json({
        id: createdUserId,
        username,
        experienceLevel: "intermediate",
        hasSetExperienceLevel: false,
        inviteCode: redeem.code,
        trialExpiresAt: redeem.trialExpiresAt.toISOString(),
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

      const verify = await verifyOtp({ channel: "email", target: normalized, code, purpose: "login" });
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
  app.get("/api/auth/github", (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      res.status(500).json({ error: "GitHub OAuth not configured" });
      return;
    }
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const state = randomBytes(16).toString("hex");
    (req.session as any).githubOAuthState = state;
    const redirectUri = `${baseUrl}/api/auth/github/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "read:user user:email",
      state,
      allow_signup: "true",
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  });

  // 2) Callback: exchange the code for an access token, fetch the user,
  //    then either link to an existing local user (matched by verified
  //    primary email) or create a new GitHub-only user. Finally seat the
  //    session and send the browser back to the SPA.
  app.get("/api/auth/github/callback", async (req, res) => {
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const failRedirect = (reason: string) => {
      res.redirect(`${baseUrl}/auth?github_error=${encodeURIComponent(reason)}`);
    };
    try {
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        failRedirect("not_configured");
        return;
      }
      const { code, state } = req.query as { code?: string; state?: string };
      const expectedState = (req.session as any)?.githubOAuthState;
      (req.session as any).githubOAuthState = undefined;
      if (!code || !state || !expectedState || state !== expectedState) {
        failRedirect("bad_state");
        return;
      }

      // Exchange the temporary code for an access token.
      const ghFetch = await getGithubFetch();
      const tokenRes = await ghFetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: `${baseUrl}/api/auth/github/callback`,
        }),
      });
      if (!tokenRes.ok) {
        failRedirect("token_exchange_failed");
        return;
      }
      const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
      if (!tokenData.access_token) {
        failRedirect(tokenData.error || "no_access_token");
        return;
      }
      const accessToken = tokenData.access_token;

      // Fetch the GitHub user profile.
      const userRes = await ghFetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
      });
      if (!userRes.ok) {
        failRedirect("user_fetch_failed");
        return;
      }
      const ghUser = await userRes.json() as {
        id: number; login: string; email: string | null; avatar_url: string | null;
      };

      // The /user endpoint returns email = null when the user marks it
      // private. Fetch /user/emails (which the user:email scope grants)
      // to find the verified primary email for account merging.
      let primaryEmail: string | null = ghUser.email;
      if (!primaryEmail) {
        const emailsRes = await ghFetch("https://api.github.com/user/emails", {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
        });
        if (emailsRes.ok) {
          const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
          primaryEmail = emails.find(e => e.primary && e.verified)?.email
            ?? emails.find(e => e.verified)?.email
            ?? null;
        }
      }

      const githubId = String(ghUser.id);

      // Resolve to a local user. Lookup priority:
      //   1. existing user already linked to this GitHub id
      //   2. existing user with matching verified email -> link the github id
      //   3. otherwise create a new GitHub-only user with a unique username
      let user = await storage.getUserByGithubId(githubId);
      if (!user && primaryEmail) {
        const matched = await storage.getUserByEmail(primaryEmail);
        if (matched) {
          user = await storage.linkGithubToUser(matched.id, {
            githubId,
            avatarUrl: ghUser.avatar_url,
          });
        }
      }
      if (!user) {
        // Pick a username that doesn't collide with an existing local user.
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
      // Users without a redeemed invite code (new GitHub-only signups, or any
      // pre-existing user that was created before invite gating) must visit
      // the invite gate before reaching the app.
      const dest = (user as any).inviteCode ? "/app" : "/invite-gate?next=/app";
      res.redirect(`${baseUrl}${dest}`);
    } catch (err) {
      console.error("[auth/github/callback]", err);
      failRedirect("server_error");
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
  function formatInviteCode(isEdu: boolean, seq: number): string {
    return isEdu
      ? `CASC-EDU-${String(seq).padStart(4, "0")}`
      : `CASC-${String(seq).padStart(3, "0")}`;
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

      await db.insert(waitlistSubscribers).values({ email, ipAddress, isEdu });

      // Fire-and-forget: send confirmation email to the subscriber.
      sendWaitlistConfirmationEmail(email).catch((err) => console.error("[waitlist/confirm-email]", err));

      // Send batch alert when pending count crosses a multiple of BATCH_SIZE.
      const [{ pending }] = await db
        .select({ pending: count() })
        .from(waitlistSubscribers)
        .where(eq(waitlistSubscribers.status, "pending"));
      if (pending > 0 && pending % BATCH_SIZE === 0) {
        // Fire-and-forget; don't block the request on the email send.
        notifyAdminOfBatch(pending).catch((err) => console.error("[waitlist/notify]", err));
      }

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
          };
        }),
      });
    } catch (err) {
      console.error("[waitlist/list]", err);
      res.status(500).json({ error: "Failed to fetch waitlist" });
    }
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

    // --- Fix #1: allocate sequence numbers inside a transaction with a
    // lock-then-count pattern so concurrent calls cannot read the same count
    // and produce duplicate codes (which would then collide on the unique
    // constraint and abort the second batch mid-loop).
    //
    // Strategy: for each subscriber we open a short transaction that (a) reads
    // MAX(id) of existing codes in that bucket — MAX is index-friendly and
    // immune to concurrent inserts reading the same count — and (b) inserts
    // the new row.  Because the INSERT itself is inside the transaction, a
    // unique-constraint collision will only roll back that single subscriber,
    // not the whole batch; we retry with seq+1 in that case.
    const now = new Date();
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
        // --- Fix #1: allocate inside a transaction so COUNT is stable under
        // concurrent inserts.  Retry up to 5 times on unique-constraint collision.
        let allocated = false;
        let allocatedCode = "";
        for (let attempt = 0; attempt < 5 && !allocated; attempt++) {
          try {
            await db.transaction(async (tx) => {
              const [{ total }] = await tx
                .select({ total: count() })
                .from(inviteCodes)
                .where(eq(inviteCodes.isEdu, sub.isEdu));
              const seq = total + 1 + attempt;
              allocatedCode = formatInviteCode(sub.isEdu, seq);
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
          <h2 style="font-size:22px;font-weight:700;margin-bottom:8px">您的 CascadeAI 邀请码</h2>
          <p style="color:#6b7280;margin-bottom:32px">感谢您申请 CascadeAI，您的专属邀请码如下：</p>
          <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px">
            <span style="font-size:28px;font-weight:800;letter-spacing:4px;color:#111827">${code}</span>
          </div>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:24px">
            <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#92400e">${trialLabel}</p>
            <p style="margin:0;font-size:13px;color:#b45309">免费期从您<strong>完成注册之日</strong>起开始计算。邀请码领取截止日期：<strong>${codeExpiryStr}</strong>，请在此日期前完成注册，逾期邀请码将失效。</p>
          </div>
          <p style="color:#6b7280;font-size:14px">请前往 <a href="${WAITLIST_BASE_URL}" style="color:#2563eb">${WAITLIST_BASE_URL.replace(/^https?:\/\//, "")}</a> 注册时填写邀请码。</p>
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
          subject: `您的 CascadeAI 邀请码：${code}`,
          html,
          text: `您的 CascadeAI 邀请码：${code}\n\n${trialLabel}\n免费期从您完成注册之日起开始计算。\n邀请码领取截止日期：${codeExpiryStr}，请在此日期前完成注册，逾期邀请码将失效。\n\n请前往 ${WAITLIST_BASE_URL} 注册时填写。`,
        });
        await db.update(waitlistSubscribers)
          .set({ status: "invited" })
          .where(eq(waitlistSubscribers.id, sub.id));
        sent++;
      } catch (err) {
        console.error("[invite-email] send failed, marking email_failed", err, sub.email);
        await db.update(waitlistSubscribers)
          .set({ status: "email_failed" })
          .where(eq(waitlistSubscribers.id, sub.id));
      }
    }
    return sent;
  }

  // GET /api/admin/export-csv — download waitlist as CSV
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


  // ─── Creator Square ───────────────────────────────────────────────────────────

  app.get("/api/square", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const offset = Number(req.query.offset) || 0;
    const framework = typeof req.query.framework === "string" ? req.query.framework : undefined;
    const apps = await storage.listPublishedApps({ limit, offset, framework });
    res.json({ apps });
  });

  app.get("/api/square/my", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "not_logged_in" }); return; }
    const apps = await storage.listUserPublishedApps(userId);
    res.json({ apps });
  });

  app.get("/api/square/:id", async (req, res) => {
    const app = await storage.getPublishedApp(req.params.id);
    if (!app) { res.status(404).json({ error: "not_found" }); return; }
    if (app.visibility === "private") {
      const userId = (req.session as any)?.userId as string | undefined;
      if (app.userId !== userId) { res.status(403).json({ error: "forbidden" }); return; }
    }
    const author = await storage.getUser(app.userId);
    res.json({ app: { ...app, authorUsername: author?.username ?? "anonymous" } });
  });

  app.post("/api/square", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "not_logged_in" }); return; }
    const bodySchema = z.object({
      projectId: z.string(),
      title: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      isOpenSource: z.boolean().default(false),
      visibility: z.enum(["public", "link_only", "private"]).default("public"),
      previewScreenshot: z.string().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const { projectId, title, description, isOpenSource, visibility, previewScreenshot } = parsed.data;
    const project = await storage.getProject(projectId);
    if (!project || project.userId !== userId) { res.status(403).json({ error: "forbidden" }); return; }
    const existing = await storage.getPublishedAppByProject(projectId);
    const { randomUUID } = await import("crypto");
    const id = existing?.id ?? randomUUID();
    const saved = await storage.upsertPublishedApp({
      id, projectId, userId, title,
      description: description ?? null,
      isOpenSource, visibility,
      previewScreenshot: previewScreenshot ?? null,
      framework: project.framework ?? "web",
    });
    res.json({ app: saved });
  });

  app.delete("/api/square/:id", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "not_logged_in" }); return; }
    await storage.deletePublishedApp(req.params.id, userId);
    res.json({ ok: true });
  });

  app.post("/api/square/:id/fork", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "not_logged_in" }); return; }
    const published = await storage.getPublishedApp(req.params.id);
    if (!published) { res.status(404).json({ error: "not_found" }); return; }
    if (!published.isOpenSource) { res.status(403).json({ error: "not_open_source" }); return; }
    if (published.visibility === "private") { res.status(403).json({ error: "forbidden" }); return; }
    const sourceProject = await storage.getProject(published.projectId);
    if (!sourceProject) { res.status(404).json({ error: "source_project_not_found" }); return; }
    const { randomUUID } = await import("crypto");
    const newId = randomUUID();
    const forkedProject = await storage.createProject({
      id: newId, userId,
      name: `${published.title} (Fork)`,
      emoji: sourceProject.emoji ?? undefined,
      framework: (sourceProject.framework ?? "web") as any,
      language: (sourceProject.language ?? "html") as any,
      targetPlatform: (sourceProject.targetPlatform ?? undefined) as any,
    });
    const sourceFiles = await storage.getProjectFiles(published.projectId);
    if (sourceFiles.length > 0) {
      await storage.upsertProjectFiles(newId, sourceFiles.map((f) => ({ path: f.path, content: f.content })));
    }
    res.json({ project: forkedProject });
  });

  app.get("/api/square/:id/files", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "not_logged_in" }); return; }
    const published = await storage.getPublishedApp(req.params.id);
    if (!published) { res.status(404).json({ error: "not_found" }); return; }
    if (!published.isOpenSource) { res.status(403).json({ error: "not_open_source" }); return; }
    if (published.visibility === "private") { res.status(403).json({ error: "forbidden" }); return; }
    const files = await storage.getProjectFiles(published.projectId);
    res.json({ files });
  });

  // ─────────────────────────────────────────────────────────────────────────────

  return httpServer;
}
