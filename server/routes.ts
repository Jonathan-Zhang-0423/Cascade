import type { Express } from "express";
import { createServer, type Server } from "http";
import { doubaoClient, DOUBAO_MODEL, DOUBAO_LITE_MODEL } from "./doubao-client";
import { VIBE_AGENT_SYSTEM_PROMPT, buildContextMessage } from "./vibe-prompt";
import { EDITOR_AGENT_SYSTEM_PROMPT, buildEditorContextMessage } from "./editor-prompt";
import { MANAGER_AGENT_SYSTEM_PROMPT, MANAGER_FIX_MODE_SYSTEM_PROMPT, buildManagerContextMessage, buildManagerFixPlanMessage } from "./manager-prompt";
import { VERIFIER_AGENT_SYSTEM_PROMPT, buildHolisticVerifierMessage } from "./verifier-prompt";
import { COMMUNICATOR_AGENT_SYSTEM_PROMPT, buildCommunicatorMessage } from "./communicator-prompt";
import type { CommunicatorEvent } from "./communicator-prompt";
import { MENTOR_SYSTEM_PROMPT, MENTOR_PATCH_PROMPT, MENTOR_OPTIMIZE_PROMPT } from "./mentor-prompt";

function parseMarkdownCodeBlock(raw: string): { code: string; language: string } {
  const fenceMatch = raw.match(/^```(\w*)\s*\n?([\s\S]*?)```\s*$/);
  if (fenceMatch) {
    return { code: fenceMatch[2].trim(), language: fenceMatch[1] || "text" };
  }
  const partialMatch = raw.match(/^```(\w*)\s*\n?([\s\S]*)$/);
  if (partialMatch) {
    return { code: partialMatch[2].trim(), language: partialMatch[1] || "text" };
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
        feat.explanation = feat.label ? `This section covers the "${feat.label}" feature of the project.` : "";
      }

      if (!Array.isArray(feat.code_blocks) || feat.code_blocks.length === 0) {
        if (typeof feat.code_block === "string" && feat.code_block.trim().length > 0) {
          const { code, language } = parseMarkdownCodeBlock(feat.code_block);
          feat.code_blocks = [{
            code,
            language,
            walkthrough: typeof feat.walkthrough === "string" ? feat.walkthrough : "",
          }];
        } else if (typeof feat.code === "string" && feat.code.trim().length > 0) {
          feat.code_blocks = [{
            code: feat.code.trim(),
            language: typeof feat.language === "string" ? feat.language : "text",
            walkthrough: typeof feat.walkthrough === "string" ? feat.walkthrough : "",
          }];
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
          if ((!block.walkthrough || (typeof block.walkthrough === "string" && block.walkthrough.trim().length === 0)) && typeof feat.walkthrough === "string" && feat.walkthrough.trim().length > 0) {
            block.walkthrough = feat.walkthrough;
          }
          return block;
        });
      }

      if (!feat.prompt_tip || typeof feat.prompt_tip !== "string" || feat.prompt_tip.trim().length === 0) {
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
  let text = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();

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
            if (rest[0] === ":" || rest[0] === "," || rest[0] === "}" || rest[0] === "]" || rest.length === 0) {
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.post("/api/chat", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }
      const { messages, files, mode } = req.body as {
        messages: Array<{ role: "user" | "assistant"; content: string }>;
        files?: Array<{ path: string; content: string }>;
        mode?: "vibe" | "manager";
      };

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      const isManagerMode = mode === "manager";
      const systemPrompt = isManagerMode ? EDITOR_AGENT_SYSTEM_PROMPT : VIBE_AGENT_SYSTEM_PROMPT;
      const systemMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
      ];

      if (files && files.length > 0) {
        const contextMsg = isManagerMode ? buildEditorContextMessage(files) : buildContextMessage(files);
        systemMessages.push({ role: "system", content: contextMsg });
      }

      const allMessages = [...systemMessages, ...messages];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const stream = await doubaoClient.chat.completions.create({
        model: DOUBAO_MODEL,
        messages: allMessages,
        stream: true,
        max_tokens: 4096,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Chat API error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to get AI response" });
      } else {
        res.write(`data: ${JSON.stringify({ error: error?.message || "Stream error" })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/manager-chat", async (req, res) => {
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

      const systemMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: MANAGER_AGENT_SYSTEM_PROMPT },
      ];

      if (files && files.length > 0) {
        const contextMsg = buildManagerContextMessage(files);
        systemMessages.push({ role: "system", content: contextMsg });
      } else {
        systemMessages.push({ role: "system", content: "The project currently has no files." });
      }

      const allMessages = [...systemMessages, ...messages];

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_MODEL,
        messages: allMessages,
        stream: false,
        max_tokens: 4096,
      });

      const responseContent = completion.choices[0]?.message?.content || "";

      const parsed = parseAIJson(responseContent);
      if (!parsed) {
        res.json({ message: responseContent });
        return;
      }

      if (parsed.type === "message" && parsed.content) {
        res.json({ message: parsed.content });
      } else if (parsed.type === "plan" || parsed.steps) {
        const plan = { ...parsed };
        delete plan.type;
        res.json({ plan });
      } else if (parsed.summary && parsed.steps) {
        res.json({ plan: parsed });
      } else {
        res.json({ message: parsed.content || responseContent });
      }
    } catch (error: any) {
      console.error("Manager chat API error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to get Manager response" });
    }
  });

  app.post("/api/verifier-holistic", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "DOUBAO_API_KEY is not configured" });
        return;
      }

      const { user_request, plan_steps, files_before, files_after, user_feedback } = req.body as {
        user_request: string;
        plan_steps: Array<{ step: number; title: string; description: string; acceptance_criteria?: string }>;
        files_before: Array<{ path: string; content: string }>;
        files_after: Array<{ path: string; content: string }>;
        user_feedback?: string;
      };

      if (!user_request || !plan_steps || !files_after) {
        res.status(400).json({ error: "user_request, plan_steps, and files_after are required" });
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
        max_tokens: 500,
      });

      const responseContent = completion.choices[0]?.message?.content || "";

      const review = parseAIJson(responseContent);
      if (!review) {
        res.json({ raw: responseContent, error: "Verifier did not return valid JSON" });
        return;
      }

      res.json({ review });
    } catch (error: any) {
      console.error("Holistic verifier API error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to get holistic review" });
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
          bugs: Array<{ id: string; severity: string; file: string; description: string; expected: string; actual: string }>;
          missing_features: Array<{ id: string; description: string; related_step: number }>;
          regressions: Array<{ id: string; file: string; description: string }>;
          summary: string;
          suggestion: string;
        };
        original_request: string;
      };

      if (!bug_report || !original_request) {
        res.status(400).json({ error: "bug_report and original_request are required" });
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
        max_tokens: 500,
      });

      const responseContent = completion.choices[0]?.message?.content || "";

      const plan = parseAIJson(responseContent);
      if (!plan) {
        res.json({ raw: responseContent, error: "Manager did not return valid fix plan JSON" });
        return;
      }

      res.json({ plan });
    } catch (error: any) {
      console.error("Manager fix plan API error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to get fix plan" });
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
        res.status(400).json({ error: "event object with event type is required" });
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
      res.flushHeaders();

      const maxTokens = event.event === "plan_created" ? 500 : 150;

      const stream = await doubaoClient.chat.completions.create({
        model: DOUBAO_MODEL,
        messages,
        stream: true,
        max_tokens: maxTokens,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      console.error("Communicator chat API error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to get Communicator response" });
      } else {
        res.write(`data: ${JSON.stringify({ error: error?.message || "Stream error" })}\n\n`);
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

      const { files } = req.body;

      if (!files || !Array.isArray(files) || files.length === 0) {
        res.status(400).json({ error: "No files provided" });
        return;
      }

      const fileContext = files
        .map((f: { path: string; content: string }) => `--- ${f.path} ---\n${f.content}`)
        .join("\n\n");

      const messages = [
        { role: "system" as const, content: MENTOR_SYSTEM_PROMPT },
        {
          role: "user" as const,
          content: `Please analyze the following project files and generate the Coding Notebook:\n\n${fileContext}`,
        },
      ];

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_LITE_MODEL,
        messages,
        stream: false,
        max_tokens: 8192,
      });

      const responseContent = completion.choices[0]?.message?.content || "";

      const notebook = parseAIJson(responseContent);
      if (!notebook) {
        res.json({ raw: responseContent, error: "Mentor did not return valid JSON" });
        return;
      }

      if (notebook.file_breakdowns) {
        notebook.file_breakdowns = normalizeFeatures(notebook.file_breakdowns);
      }

      res.json({ notebook });
    } catch (error: any) {
      console.error("Mentor analyze API error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to get Mentor analysis" });
    }
  });

  app.post("/api/mentor-patch", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "AI service not configured" });
        return;
      }

      const { changedFiles, notebookOutline, affectedSections } = req.body;

      if (!changedFiles || !Array.isArray(changedFiles) || changedFiles.length === 0) {
        res.status(400).json({ error: "No changed files provided" });
        return;
      }

      const fileContext = changedFiles
        .map((f: { path: string; content: string; status: string }) =>
          `--- ${f.path} [${f.status}] ---\n${f.status === "deleted" ? "(file deleted)" : f.content}`)
        .join("\n\n");

      const outlineText = notebookOutline || "No existing notebook outline.";
      const sectionsText = affectedSections
        ? `\n\nAffected existing sections:\n${JSON.stringify(affectedSections, null, 2)}`
        : "";

      const messages = [
        { role: "system" as const, content: MENTOR_PATCH_PROMPT },
        {
          role: "user" as const,
          content: `## Existing Notebook Outline\n${outlineText}${sectionsText}\n\n## Changed Files\n${fileContext}`,
        },
      ];

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_LITE_MODEL,
        messages,
        stream: false,
        max_tokens: 8192,
      });

      const responseContent = completion.choices[0]?.message?.content || "";
      const patch = parseAIJson(responseContent);
      if (!patch) {
        res.json({ raw: responseContent, error: "Mentor did not return valid JSON patch" });
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
      res.status(500).json({ error: error?.message || "Failed to get Mentor patch" });
    }
  });

  app.post("/api/mentor-optimize", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "AI service not configured" });
        return;
      }

      const { notebook, files } = req.body;

      if (!notebook || !files || !Array.isArray(files) || files.length === 0) {
        res.status(400).json({ error: "Notebook and files are required" });
        return;
      }

      const fileContext = files
        .map((f: { path: string; content: string }) => `--- ${f.path} ---\n${f.content}`)
        .join("\n\n");

      const messages = [
        { role: "system" as const, content: MENTOR_OPTIMIZE_PROMPT },
        {
          role: "user" as const,
          content: `## Existing Notebook\n${JSON.stringify(notebook, null, 2)}\n\n## All Current Project Files\n${fileContext}`,
        },
      ];

      const completion = await doubaoClient.chat.completions.create({
        model: DOUBAO_LITE_MODEL,
        messages,
        stream: false,
        max_tokens: 8192,
      });

      const responseContent = completion.choices[0]?.message?.content || "";
      const optimized = parseAIJson(responseContent);
      if (!optimized) {
        res.json({ raw: responseContent, error: "Mentor did not return valid JSON" });
        return;
      }

      if (optimized.file_breakdowns) {
        optimized.file_breakdowns = normalizeFeatures(optimized.file_breakdowns);
      }

      res.json({ notebook: optimized });
    } catch (error: any) {
      console.error("Mentor optimize API error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to get Mentor optimization" });
    }
  });

  app.post("/api/smart-response", async (req, res) => {
    try {
      if (!process.env.DOUBAO_API_KEY) {
        res.status(500).json({ error: "AI service not configured" });
        return;
      }

      const { messages, mode } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages are required" });
        return;
      }

      const systemPrompt = `You are a smart response generator for a beginner-friendly coding assistant app.

Given a conversation between a user and an AI coding assistant, your job is to generate the most helpful and natural response that the USER would likely want to send next.

Rules:
- Output ONLY the user's response text — no explanations, no quotes, no meta-commentary
- Keep it concise and direct (1–4 sentences)
- Match the language of the conversation (write in Chinese if the conversation is in Chinese, English if English)
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
            content: "[Generate a suggested response for me to send to the assistant. Output only the response text itself.]",
          },
        ],
        stream: false,
        max_tokens: 256,
      });

      const suggestion = completion.choices[0]?.message?.content?.trim() || "";
      res.json({ suggestion });
    } catch (error: any) {
      console.error("Smart response API error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to generate smart response" });
    }
  });

  return httpServer;
}
