#!/usr/bin/env node
/**
 * Built-in MCP server for Cascade that provides web search via
 * 豆包搜索 Custom API (火山引擎联网搜索).
 *
 * Tools provided:
 * - search_web: Search the web via Doubao Search API
 * - fetch_url: Fetch and extract text content from a URL
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SEARCH_API_URL = "https://open.feedcoopapi.com/search_api/web_search";
const SEARCH_API_KEY = process.env.DOUBAO_SEARCH_API_KEY || "";

const server = new McpServer({
  name: "cascade-web-search",
  version: "2.0.0",
});

// Tool: search_web
server.tool(
  "search_web",
  "Search the web using Doubao Search API. Returns titles, URLs, snippets and content for each result.",
  {
    query: z.string().describe("The search query"),
    maxResults: z.number().min(1).max(20).default(8).describe("Maximum number of results to return"),
  },
  async ({ query, maxResults }) => {
    if (!SEARCH_API_KEY) {
      return { content: [{ type: "text", text: "Search error: DOUBAO_SEARCH_API_KEY not configured" }], isError: true };
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(SEARCH_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SEARCH_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Query: query,
          SearchType: "web",
          Count: maxResults,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        return { content: [{ type: "text", text: `Search API error: HTTP ${resp.status}` }], isError: true };
      }

      const json = await resp.json() as any;
      const results = json?.Result?.WebResults || [];

      if (results.length === 0) {
        return { content: [{ type: "text", text: "No results found." }] };
      }

      const formatted = results.map((r: any, i: number) => {
        const snippet = r.Snippet || r.Summary || "";
        const content = r.Content ? r.Content.slice(0, 500) : "";
        const body = content || snippet;
        return `${i + 1}. ${r.Title}\n   URL: ${r.Url}\n   ${body}`;
      }).join("\n\n");

      return { content: [{ type: "text", text: formatted }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Search error: ${err.message}` }], isError: true };
    }
  },
);

// Tool: fetch_url
server.tool(
  "fetch_url",
  "Fetch a URL and extract its text content (HTML tags stripped). Useful for reading documentation pages, blog posts, or API references found via search.",
  {
    url: z.string().url().describe("The URL to fetch"),
    maxLength: z.number().min(100).max(50000).default(8000).describe("Maximum characters to return from the page"),
  },
  async ({ url, maxLength }) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; CascadeBot/1.0)",
          "Accept": "text/html,application/xhtml+xml,text/plain,application/json",
        },
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        return { content: [{ type: "text", text: `HTTP ${resp.status}: ${resp.statusText}` }], isError: true };
      }

      const html = await resp.text();
      // Strip HTML tags, scripts, styles; collapse whitespace
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();

      const truncated = text.slice(0, maxLength);
      const suffix = text.length > maxLength ? `\n\n[...truncated at ${maxLength} chars, full page is ${text.length} chars]` : "";

      return { content: [{ type: "text", text: truncated + suffix }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Fetch error: ${err.message}` }], isError: true };
    }
  },
);

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
