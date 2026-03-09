import type { Express } from "express";
import { createServer, type Server } from "http";
import { doubaoClient, DOUBAO_MODEL } from "./doubao-client";
import { VIBE_AGENT_SYSTEM_PROMPT, buildContextMessage } from "./vibe-prompt";
import { MANAGER_AGENT_SYSTEM_PROMPT, buildManagerContextMessage } from "./manager-prompt";

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
      const { messages, files } = req.body as {
        messages: Array<{ role: "user" | "assistant"; content: string }>;
        files?: Array<{ path: string; content: string }>;
      };

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      const systemMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: VIBE_AGENT_SYSTEM_PROMPT },
      ];

      if (files && files.length > 0) {
        const contextMsg = buildContextMessage(files);
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
      });

      const responseContent = completion.choices[0]?.message?.content || "";

      let plan;
      try {
        const cleaned = responseContent.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
        plan = JSON.parse(cleaned);
      } catch {
        res.json({ raw: responseContent, error: "Manager did not return valid JSON" });
        return;
      }

      res.json({ plan });
    } catch (error: any) {
      console.error("Manager chat API error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to get Manager response" });
    }
  });

  return httpServer;
}
