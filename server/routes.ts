import type { Express } from "express";
import { createServer, type Server } from "http";
import { doubaoClient, DOUBAO_MODEL, DOUBAO_LITE_MODEL } from "./doubao-client";
import { VIBE_AGENT_SYSTEM_PROMPT, buildContextMessage } from "./vibe-prompt";
import { EDITOR_AGENT_SYSTEM_PROMPT, buildEditorContextMessage } from "./editor-prompt";
import { MANAGER_AGENT_SYSTEM_PROMPT, MANAGER_FIX_MODE_SYSTEM_PROMPT, buildManagerContextMessage, buildManagerFixPlanMessage } from "./manager-prompt";
import { VERIFIER_AGENT_SYSTEM_PROMPT, buildHolisticVerifierMessage } from "./verifier-prompt";
import { COMMUNICATOR_AGENT_SYSTEM_PROMPT, buildCommunicatorMessage } from "./communicator-prompt";
import type { CommunicatorEvent } from "./communicator-prompt";
import { MENTOR_SYSTEM_PROMPT } from "./mentor-prompt";

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

      const stream = await doubaoClient.chat.completions.create({
        model: DOUBAO_MODEL,
        messages,
        stream: true,
        max_tokens: 150,
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
        max_tokens: 4096,
      });

      const responseContent = completion.choices[0]?.message?.content || "";

      const notebook = parseAIJson(responseContent);
      if (!notebook) {
        res.json({ raw: responseContent, error: "Mentor did not return valid JSON" });
        return;
      }

      res.json({ notebook });
    } catch (error: any) {
      console.error("Mentor analyze API error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to get Mentor analysis" });
    }
  });

  return httpServer;
}
