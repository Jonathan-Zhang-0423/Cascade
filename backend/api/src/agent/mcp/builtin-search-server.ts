#!/usr/bin/env node
/**
 * Built-in MCP server for Cascade that provides free web search via DuckDuckGo.
 * No API key required. Runs as a stdio MCP server.
 *
 * Tools provided:
 * - search_web: Search the web via DuckDuckGo (using ddg-search)
 * - fetch_url: Fetch and extract text content from a URL
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { search as ddgSearch } from "ddg-search";

const server = new McpServer({
  name: "cascade-web-search",
  version: "1.0.0",
});

// Tool: search_web
server.tool(
  "search_web",
  "Search the web using DuckDuckGo. Returns titles, URLs, and snippets for each result.",
  {
    query: z.string().describe("The search query"),
    maxResults: z.number().min(1).max(20).default(8).describe("Maximum number of results to return"),
  },
  async ({ query, maxResults }) => {
    try {
      const response = await ddgSearch(query, { maxPages: 1 });
      const items = (response.results || []).slice(0, maxResults);

      if (items.length === 0) {
        return { content: [{ type: "text", text: "No results found." }] };
      }

      const formatted = items.map((r: any, i: number) =>
        `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.description || ""}`
      ).join("\n\n");

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
