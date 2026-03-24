import type { Express } from "express";
import { createServer, type Server } from "http";
import { spawn } from "child_process";
import { writeFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { z } from "zod";
import { doubaoClient, DOUBAO_MODEL, DOUBAO_LITE_MODEL } from "./doubao-client";
import { withRetry } from "./retry";
import { compressMessages } from "./context-compressor";
import { storage } from "./storage";
import { insertProjectSchema } from "@shared/schema";
import {
  EDITOR_AGENT_SYSTEM_PROMPT,
  buildEditorContextMessage,
} from "./editor-prompt";
import {
  VIBE_AGENT_SYSTEM_PROMPT,
  buildVibeContextMessage,
} from "./vibe-prompt";
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
import {
  COMMUNICATOR_AGENT_SYSTEM_PROMPT,
  buildCommunicatorMessage,
} from "./communicator-prompt";
import type { CommunicatorEvent } from "./communicator-prompt";
import {
  MENTOR_SYSTEM_PROMPT,
  MENTOR_PATCH_PROMPT,
  MENTOR_OPTIMIZE_PROMPT,
} from "./mentor-prompt";
import { AB_TEST_SCENARIOS } from "./ab-test-scenarios";
import { runBuildSession, type BuildSessionState } from "./build-orchestrator";
import { detectSkillFromText, loadSkill } from "./skill-loader";
import { runAgentLoop } from "./agent-loop";
import { buildManagerTools, type ManagerSessionState } from "./agent-tools";
import { getAIClient, type AIProvider } from "./kimi-client";

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

function normalizeStepsList(plan: any): Array<{ step: number; title: string }> {
  const raw = plan?.steps ?? plan?.sub_tasks;
  if (!Array.isArray(raw)) return [];
  return raw.map((t: any, i: number) => ({
    step: t.step ?? i + 1,
    title: t.title ?? t.description?.slice(0, 50) ?? `Step ${i + 1}`,
  }));
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

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, session] of buildSessions.entries()) {
    if ((session as any)._startedAt && (session as any)._startedAt < cutoff) {
      session.aborted = true;
      buildSessions.delete(id);
    }
  }
}, 60_000);

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  app.get("/api/providers", (_req, res) => {
    res.json({ kimi: !!process.env.KIMI_API_KEY });
  });

  app.post("/api/build-session", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }
      const { sessionId, plan, userRequest, userLang, files, taskStatuses, userConfirmation, provider } = req.body as {
        sessionId: string;
        plan: any;
        userRequest: string;
        userLang: string;
        files: Array<{ path: string; content: string }>;
        taskStatuses?: Record<string, string>;
        userConfirmation?: string;
        provider?: AIProvider;
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
      const session: BuildSessionState & { _startedAt: number } = {
        id: sessionId,
        aborted: false,
        files: fileMap,
        plan,
        userRequest,
        userLang: userLang || "English",
        taskStatuses: taskStatuses || undefined,
        userConfirmation: userConfirmation || undefined,
        provider: provider || "doubao",
        _startedAt: Date.now(),
      };
      buildSessions.set(sessionId, session);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      res.socket?.setNoDelay(true);

      res.on("close", () => { session.aborted = true; });

      const emit = (data: Record<string, unknown>) => {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
          (res as any).flush?.();
        } catch {}
      };

      heartbeat = setInterval(() => {
        try { res.write(": heartbeat\n\n"); (res as any).flush?.(); } catch {}
      }, 2000);

      try {
        await runBuildSession(session, emit);
      } catch (err: any) {
        emit({ type: "build_error", message: err?.message || "Unknown error" });
        emit({ type: "done" });
      } finally {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        buildSessions.delete(sessionId);
        res.end();
      }
    } catch (error: any) {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      console.error("Build session error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Build session failed" });
      }
    }
  });

  app.delete("/api/build-session/:sessionId", (req, res) => {
    const session = buildSessions.get(req.params.sessionId);
    if (session) {
      session.aborted = true;
    }
    res.json({ ok: true });
  });

  app.post("/api/manager-chat", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }
      const { messages, files, provider } = req.body as {
        messages: Array<{ role: "user" | "assistant"; content: string }>;
        files?: Array<{ path: string; content: string }>;
        provider?: AIProvider;
      };
      const activeProvider: AIProvider = provider || "doubao";
      const { client: activeAIClient, model: activeAIModel } = getAIClient(activeProvider);

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      // Open the SSE stream immediately — before any async work so the browser
      // gets a connection right away rather than waiting for skill detection.
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

      heartbeat = setInterval(() => {
        try { res.write(": heartbeat\n\n"); (res as any).flush?.(); } catch {}
      }, 5000);

      // Build system prompt (async work runs after stream is open)
      const allConversationText = messages.map((m) => m.content).join(" ");
      const detectedSkill = await detectSkillFromText(allConversationText);

      let systemPrompt = MANAGER_AGENT_SYSTEM_PROMPT;
      if (files && files.length > 0) {
        const contextMsg = buildManagerContextMessage(files);
        systemPrompt = `${MANAGER_AGENT_SYSTEM_PROMPT}\n\n${contextMsg}`;
      } else {
        systemPrompt = `${MANAGER_AGENT_SYSTEM_PROMPT}\n\nThe project currently has no files.`;
      }

      if (detectedSkill) {
        const skillContent = await loadSkill(detectedSkill);
        if (skillContent) {
          systemPrompt = `${systemPrompt}\n\n## Technology Skill: ${detectedSkill}\n\nThe following skill guidance applies to this project. Use it to inform your planning and step descriptions:\n\n${skillContent}`;
        }
      }

      // Compress long conversation history before sending to the LLM
      const processedMessages = await compressMessages(messages);

      const managerState: ManagerSessionState = {};
      const managerTools = buildManagerTools(managerState);

      const emitRawToken = (data: Record<string, unknown>) => {
        if (data.type === "narration_token" && typeof data.token === "string") {
          emit({ type: "raw_token", token: data.token });
        }
      };

      try {
        const result = await runAgentLoop(
          systemPrompt,
          processedMessages,
          managerTools.schemas,
          managerTools.handlers,
          emitRawToken,
          { exitTools: ["submit_plan"], maxIterations: 10, client: activeAIClient, model: activeAIModel },
        );

        clearInterval(heartbeat);

        if (result.exitTool === "submit_plan" && managerState.plan) {
          const plan = managerState.plan;
          const projectName = typeof result.exitArgs?.project_name === "string"
            ? result.exitArgs.project_name
            : undefined;

          const userLang = detectUserLanguage(messages);
          const steps = normalizeStepsList(plan);
          const commPrompt = buildCommunicatorMessage({
            event: "plan_created",
            userLanguage: userLang,
            planSummary: typeof plan.summary === "string" ? plan.summary : "",
            totalSteps: steps.length,
            stepTitles: steps.map((s) => s.title),
            whatAndWhy: typeof plan.what_and_why === "string" ? plan.what_and_why : "",
            doneLooksLike: typeof plan.done_looks_like === "string" ? plan.done_looks_like : "",
            outOfScope: typeof plan.out_of_scope === "string" ? plan.out_of_scope : "",
            relevantFiles: Array.isArray(plan.relevant_files) ? plan.relevant_files as string[] : [],
          } as CommunicatorEvent);

          emit({ type: "communicator_narration_starting" });
          try {
            const commStream = await withRetry(
              "communicator narration stream",
              () =>
                activeAIClient.chat.completions.create(
                  {
                    model: activeAIModel,
                    messages: [
                      { role: "system", content: COMMUNICATOR_AGENT_SYSTEM_PROMPT },
                      { role: "user", content: commPrompt },
                    ],
                    stream: true,
                    max_tokens: 16384,
                  },
                  { timeout: 30_000 },
                ),
            );

            for await (const chunk of commStream) {
              const token = chunk.choices[0]?.delta?.content;
              if (token) {
                emit({ type: "communicator_token", token });
                await new Promise<void>(r => setTimeout(r, 0));
              }
            }
          } catch (commErr: unknown) {
            const commMsg = commErr instanceof Error ? commErr.message : String(commErr);
            console.error("Communicator stream error:", commMsg);
            emit({ type: "communicator_error", message: "Communicator narration unavailable" });
          }

          emit({ type: "plan_ready", plan, project_name: projectName });
          emit({ type: "manager_done" });
        } else {
          emit({ type: "manager_done" });
        }

        res.write("data: [DONE]\n\n");
        (res as any).flush?.();
        res.end();
      } catch (err: unknown) {
        clearInterval(heartbeat);
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("Manager agent loop error:", errMsg);
        emit({ type: "manager_error" });
        res.write("data: [DONE]\n\n");
        (res as any).flush?.();
        res.end();
      }
    } catch (error: any) {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      console.error("Manager chat API error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to get Manager response" });
      } else {
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
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }
      const { messages, files } = req.body as {
        messages: Array<{ role: "user" | "assistant"; content: string }>;
        files?: Array<{ path: string; content: string }>;
      };

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      const systemMessages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }> = [{ role: "system", content: VIBE_AGENT_SYSTEM_PROMPT }];

      if (files && files.length > 0) {
        const contextMsg = buildVibeContextMessage(files);
        systemMessages.push({ role: "system", content: contextMsg });
      } else {
        systemMessages.push({
          role: "system",
          content: "The project currently has no files. Start fresh!",
        });
      }

      const allMessages = [...systemMessages, ...messages];

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

      const stream = await doubaoClient.chat.completions.create({
        model: DOUBAO_MODEL,
        messages: allMessages,
        stream: true,
        max_tokens: 16384,
      });

      for await (const chunk of stream) {
        if (res.destroyed) break;
        const token = chunk.choices[0]?.delta?.content;
        if (token) {
          emit({ content: token });
        }
      }

      res.write("data: [DONE]\n\n");
      (res as any).flush?.();
      res.end();
    } catch (error: any) {
      console.error("Vibe chat API error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to get Vibe Agent response" });
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

      const messages: Array<{ role: "system" | "user"; content: string }> = [
        { role: "system", content: VERIFIER_AGENT_SYSTEM_PROMPT },
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

  app.post("/api/communicator-chat", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }

      const { event } = req.body as { event: CommunicatorEvent };

      if (!event || !event.event) {
        res
          .status(400)
          .json({ error: "event object with event type is required" });
        return;
      }

      const contextMessage = buildCommunicatorMessage(event);

      const messages: Array<{ role: "system" | "user"; content: string }> = [
        { role: "system", content: COMMUNICATOR_AGENT_SYSTEM_PROMPT },
        { role: "user", content: contextMessage },
      ];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      res.socket?.setNoDelay(true);

      const emitComm = (data: Record<string, unknown>) => {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
          (res as any).flush?.();
        } catch {}
      };

      const maxTokens = 16384;

      const stream = await doubaoClient.chat.completions.create({
        model: DOUBAO_MODEL,
        messages,
        stream: true,
        max_tokens: maxTokens,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          emitComm({ content });
        }
      }

      res.write("data: [DONE]\n\n");
      (res as any).flush?.();
      res.end();
    } catch (error: any) {
      console.error("Communicator chat API error:", error?.message || error);
      if (!res.headersSent) {
        res
          .status(500)
          .json({
            error: error?.message || "Failed to get Communicator response",
          });
      } else {
        try {
          res.write(
            `data: ${JSON.stringify({ error: error?.message || "Stream error" })}\n\n`,
          );
          (res as any).flush?.();
        } catch {}
        res.end();
      }
    }
  });

  app.post("/api/mentor-analyze", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "AI service not configured" });
        return;
      }

      const { files, lang } = req.body;

      if (!files || !Array.isArray(files) || files.length === 0) {
        res.status(400).json({ error: "No files provided" });
        return;
      }

      const fileContext = files
        .map(
          (f: { path: string; content: string }) =>
            `--- ${f.path} ---\n${f.content}`,
        )
        .join("\n\n");

      const langDirective =
        lang === "zh"
          ? "CRITICAL LANGUAGE RULE: You MUST write ALL output entirely in Simplified Chinese (简体中文). Every word in every field — project_summary, what_it_does, explanations, walkthroughs, learning_tips, mind map labels, key concepts — must be in Chinese. Do NOT use English anywhere except inside code snippets.\n\n"
          : lang === "en"
          ? "CRITICAL LANGUAGE RULE: You MUST write ALL output entirely in English. Every word in every field must be in English. Do NOT use Chinese anywhere except inside code snippets.\n\n"
          : "";

      const messages = [
        { role: "system" as const, content: MENTOR_SYSTEM_PROMPT },
        {
          role: "user" as const,
          content: `${langDirective}Please analyze the following project files and generate the Coding Notebook:\n\n${fileContext}`,
        },
      ];

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_LITE_MODEL,
        messages,
        stream: false,
        max_tokens: 16384,
      });

      const responseContent = completion.choices[0]?.message?.content || "";

      const notebook = parseAIJson(responseContent);
      if (!notebook) {
        res.json({
          raw: responseContent,
          error: "Mentor did not return valid JSON",
        });
        return;
      }

      if (notebook.file_breakdowns) {
        notebook.file_breakdowns = normalizeFeatures(notebook.file_breakdowns);
      }

      res.json({ notebook });
    } catch (error: any) {
      console.error("Mentor analyze API error:", error?.message || error);
      res
        .status(500)
        .json({ error: error?.message || "Failed to get Mentor analysis" });
    }
  });

  app.post("/api/mentor-patch", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "AI service not configured" });
        return;
      }

      const { changedFiles, notebookOutline, affectedSections, lang } = req.body;

      if (
        !changedFiles ||
        !Array.isArray(changedFiles) ||
        changedFiles.length === 0
      ) {
        res.status(400).json({ error: "No changed files provided" });
        return;
      }

      const fileContext = changedFiles
        .map(
          (f: { path: string; content: string; status: string }) =>
            `--- ${f.path} [${f.status}] ---\n${f.status === "deleted" ? "(file deleted)" : f.content}`,
        )
        .join("\n\n");

      const outlineText = notebookOutline || "No existing notebook outline.";
      const sectionsText = affectedSections
        ? `\n\nAffected existing sections:\n${JSON.stringify(affectedSections, null, 2)}`
        : "";

      const patchLangDirective =
        lang === "zh"
          ? "CRITICAL LANGUAGE RULE: You MUST write ALL output entirely in Simplified Chinese (简体中文). Every word in every field must be in Chinese. Do NOT use English anywhere except inside code snippets.\n\n"
          : lang === "en"
          ? "CRITICAL LANGUAGE RULE: You MUST write ALL output entirely in English. Every word in every field must be in English. Do NOT use Chinese anywhere except inside code snippets.\n\n"
          : "";

      const messages = [
        { role: "system" as const, content: MENTOR_PATCH_PROMPT },
        {
          role: "user" as const,
          content: `${patchLangDirective}## Existing Notebook Outline\n${outlineText}${sectionsText}\n\n## Changed Files\n${fileContext}`,
        },
      ];

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_LITE_MODEL,
        messages,
        stream: false,
        max_tokens: 16384,
      });

      const responseContent = completion.choices[0]?.message?.content || "";
      const patch = parseAIJson(responseContent);
      if (!patch) {
        res.json({
          raw: responseContent,
          error: "Mentor did not return valid JSON patch",
        });
        return;
      }

      if (patch.updated_breakdowns) {
        patch.updated_breakdowns = normalizeFeatures(patch.updated_breakdowns);
      }
      if (patch.new_breakdowns) {
        patch.new_breakdowns = normalizeFeatures(patch.new_breakdowns);
      }

      res.json({ patch });
    } catch (error: any) {
      console.error("Mentor patch API error:", error?.message || error);
      res
        .status(500)
        .json({ error: error?.message || "Failed to get Mentor patch" });
    }
  });

  app.post("/api/mentor-optimize", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "AI service not configured" });
        return;
      }

      const { notebook, files, lang } = req.body;

      if (!notebook || !files || !Array.isArray(files) || files.length === 0) {
        res.status(400).json({ error: "Notebook and files are required" });
        return;
      }

      const fileContext = files
        .map(
          (f: { path: string; content: string }) =>
            `--- ${f.path} ---\n${f.content}`,
        )
        .join("\n\n");

      const optimizeLangDirective =
        lang === "zh"
          ? "CRITICAL LANGUAGE RULE: You MUST write ALL output entirely in Simplified Chinese (简体中文). Every word in every field must be in Chinese. Do NOT use English anywhere except inside code snippets.\n\n"
          : lang === "en"
          ? "CRITICAL LANGUAGE RULE: You MUST write ALL output entirely in English. Every word in every field must be in English. Do NOT use Chinese anywhere except inside code snippets.\n\n"
          : "";

      const messages = [
        { role: "system" as const, content: MENTOR_OPTIMIZE_PROMPT },
        {
          role: "user" as const,
          content: `${optimizeLangDirective}## Existing Notebook\n${JSON.stringify(notebook, null, 2)}\n\n## All Current Project Files\n${fileContext}`,
        },
      ];

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_LITE_MODEL,
        messages,
        stream: false,
        max_tokens: 16384,
      });

      const responseContent = completion.choices[0]?.message?.content || "";
      const optimized = parseAIJson(responseContent);
      if (!optimized) {
        res.json({
          raw: responseContent,
          error: "Mentor did not return valid JSON",
        });
        return;
      }

      if (optimized.file_breakdowns) {
        optimized.file_breakdowns = normalizeFeatures(
          optimized.file_breakdowns,
        );
      }

      res.json({ notebook: optimized });
    } catch (error: any) {
      console.error("Mentor optimize API error:", error?.message || error);
      res
        .status(500)
        .json({ error: error?.message || "Failed to get Mentor optimization" });
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

  app.post("/api/generate-codestart", async (req, res) => {
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

      const systemPrompt = `You are a technical documentation writer. Generate a codestart.md file for a software project. Use both the project plan AND the actual current file tree to produce an accurate, up-to-date architecture document.

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
        const nonCodestart = currentFiles.filter(f => !f.path.endsWith("codestart.md"));
        const fileSummaries = nonCodestart.slice(0, 10).map(f => {
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

Generate the codestart.md content for this project based on both the plan and the actual current files.`;

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
      console.error("Generate codestart error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to generate codestart.md" });
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
      const { id, name, emoji } = parsed.data;
      const project = await storage.createProject({ id, name, emoji: emoji ?? null });
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
      const files = await storage.getProjectFiles(req.params.id);
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

    const tmpId = randomBytes(8).toString("hex");
    const tmpBase = join(tmpdir(), `codestart_${tmpId}`);
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
        await writeFile(join(tmpBase, "go.mod"), "module codestart_run\n\ngo 1.21\n", "utf8");
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

  return httpServer;
}
