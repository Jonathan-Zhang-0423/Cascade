import type { Express } from "express";
import { createServer, type Server } from "http";
import https from "https";
import "express-session";
import cookieParser from "cookie-parser";
import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, basename } from "path";
import { randomBytes } from "crypto";
import { z } from "zod";
// @ts-ignore
import helmet from "helmet";
import { createSecurity } from "../middleware/security";
import { requireInviteCode, checkCaptcha, checkAdmin } from "../middleware/auth-middleware";
import { assertProjectAccess, getRequestUserId, normalizeChatSessionId } from "../project-access";
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
import type { ChatMessageInput } from "../../infra/storage";
import { users, projects, chatMessages, otpCodes, chatSessions, userFeedback, changelogEntries, notifications } from "@cascade/database";
import { db, pool } from "../../infra/db";
import { eq, and, desc, count, isNull, or, sql } from "drizzle-orm";
import { sendEmail } from "../../infra/email";
import { detectFramework, type Framework } from "../../compiler/framework-detector";
import { getMobilePromptSupplement } from "../../agent/prompts/mobile-prompt-supplements";
import {
  EDITOR_AGENT_SYSTEM_PROMPT,
  buildEditorContextMessage,
} from "../../agent/prompts/editor-prompt";
import {
  MANAGER_FIX_MODE_SYSTEM_PROMPT,
  buildManagerFixPlanMessage,
} from "../../agent/prompts/manager-prompt";
import {
  VERIFIER_AGENT_SYSTEM_PROMPT,
  buildHolisticVerifierMessage,
} from "../../agent/prompts/verifier-prompt";
import { AB_TEST_SCENARIOS } from "../ab-test-scenarios";
import { setupPreviewServer } from "../../compiler/preview-server";
import { registerAdminAuthRoutes } from "../../auth/admin-routes.js";

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
  /** Chat session this manager run belongs to (isolates concurrent sessions within same project). */
  _chatSessionId?: string;
  events: Array<{ eventId: number; data: Record<string, unknown> }>;
  nextEventId: number;
  done: boolean;
  doneAt?: number;
  startedAt: number;
  _userId?: string;
  sseWriters: Set<(line: string) => void>;
}

const managerChatSessions = new Map<string, ManagerChatSession>();

setInterval(() => {
  const now = Date.now();
  const videoRetention = 10 * 60 * 1000;
  Array.from(videoJobs.entries()).forEach(([id, job]) => {
    if ((job.status === "done" || job.status === "error") && job.finishedAt && now - job.finishedAt > videoRetention) {
      if (job.outputPath) rm(job.outputPath, { force: true }).catch(() => {});
      videoJobs.delete(id);
    }
  });
}, 60_000);

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {

  // Admin JWT cookies must be parsed before admin auth middleware/routes run.
  app.use(cookieParser());
  registerAdminAuthRoutes(app);

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

  const removedApi = (feature: string) => (_req: unknown, res: any) => {
    res.status(410).json({
      error: `${feature}_removed`,
      message: `${feature} has been removed from this product surface.`,
    });
  };

  app.use(/^\/api\/(?:build-session|review-session|manager-chat|chat)(?:\/|$)/, removedApi("agent_loop"));
  app.use(/^\/api\/aigc\/session(?:\/|$)/, removedApi("agent_loop"));
  app.use(/^\/api\/square(?:\/|$)/, removedApi("creator_square"));
  app.use(/^\/api\/admin\/square(?:\/|$)/, removedApi("creator_square"));

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

  // ── Admin: IP blocklist management ─────────────────────────────────────────

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
