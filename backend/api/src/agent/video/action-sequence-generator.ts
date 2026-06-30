// Generates a JSON DSL action sequence for a project's app by calling the fast LLM.
// Runs asynchronously after build completes — never blocks the SSE stream.

import { getFastClient } from "../providers/kimi-client";
import { storage } from "../../infra/storage";

const SYSTEM_PROMPT = `You are a Playwright test script author. Given an app's source files and a build summary, output a JSON array of actions that demonstrate the app's core functionality in 15-30 seconds of interaction.

STRICT RULES — violating any rule makes the output unusable:
1. Output ONLY a valid JSON array. No markdown fences, no explanation text.
2. Selectors: ONLY use { "by": "role" }, { "by": "text" }, { "by": "label" }, { "by": "placeholder" }. Never CSS selectors, never coordinates.
3. Timing: use "waitFor" with selector/condition/loadState. Never hardcoded sleep > 2000ms.
4. Allowed actions: waitFor, click, fill, press, hover, scroll, wait.
5. No page.evaluate(), no JS injection of any kind.
6. Keep the sequence to 8-20 steps — enough to show the app working, not exhaustive.
7. Always start with a waitFor to ensure the app is loaded before interacting.

Example output:
[
  { "action": "waitFor", "loadState": "networkidle" },
  { "action": "click", "by": "role", "role": "button", "name": "Start" },
  { "action": "waitFor", "selector": ".game-board", "state": "visible" },
  { "action": "press", "key": "ArrowLeft" },
  { "action": "press", "key": "ArrowDown" },
  { "action": "scroll", "deltaY": 300 }
]`;

const MAX_FILE_CHARS = 6000;
const ENTRY_FILES = [
  "/project/index.html",
  "/project/App.tsx",
  "/project/App.jsx",
  "/project/src/App.tsx",
  "/project/src/App.jsx",
  "/project/src/main.tsx",
  "/project/src/index.tsx",
];

function pickEntryFiles(files: { path: string; content: string }[]): string {
  // Prefer known entry files first, then take the smallest files up to char budget
  const entrySet = new Set(ENTRY_FILES);
  const sorted = [
    ...files.filter((f) => entrySet.has(f.path)),
    ...files.filter((f) => !entrySet.has(f.path)).sort((a, b) => a.content.length - b.content.length),
  ];

  let budget = MAX_FILE_CHARS;
  const chosen: string[] = [];
  for (const f of sorted) {
    if (budget <= 0) break;
    const snippet = f.content.slice(0, budget);
    chosen.push(`--- ${f.path} ---\n${snippet}`);
    budget -= snippet.length;
  }
  return chosen.join("\n\n");
}

export async function generateActionSequence(
  projectId: string,
  files: { path: string; content: string }[],
  planSummary: string,
): Promise<void> {
  try {
    const fileContext = pickEntryFiles(files);
    const userMessage = `Build summary: ${planSummary}\n\nProject files:\n${fileContext}`;

    const { client, model } = getFastClient();
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      stream: false,
      max_tokens: 1024,
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";

    // Validate: must parse as a JSON array
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try to extract JSON array from response if model added extra text
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) {
        console.warn("[action-sequence] model did not return valid JSON, skipping");
        return;
      }
      parsed = JSON.parse(match[0]);
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn("[action-sequence] empty or non-array response, skipping");
      return;
    }

    await storage.updateProjectActionSequence(projectId, JSON.stringify(parsed));
    console.log(`[action-sequence] saved ${parsed.length} actions for project ${projectId}`);
  } catch (err) {
    // Non-critical — log and continue. The video can still be recorded without actions.
    console.warn("[action-sequence] generation failed:", err instanceof Error ? err.message : err);
  }
}
