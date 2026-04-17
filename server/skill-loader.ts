import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { withFallback, type AIProvider } from "./kimi-client";

export interface SkillMeta {
  name: string;
  description: string;
  keywords: string[];
}

const SKILLS_BASE_DIR = join(process.cwd(), "server", "skills");

const BUILTIN_KEYWORDS: Record<string, string[]> = {
  react: ["react", "jsx", "tsx", "react component", "react hook", "react app", "spa", "next.js", "nextjs", "vite react"],
  "node-express": ["express", "node.js", "nodejs", "rest api", "api server", "http server", "express route", "express middleware", "node backend"],
  "python-flask": ["flask", "python flask", "flask app", "flask api", "blueprint", "jinja", "sqlalchemy", "python web", "python backend", "django"],
  "vanilla-js": ["html", "css", "vanilla javascript", "vanilla js", "plain javascript", "no framework", "dom manipulation", "webpage", "landing page", "html5 game", "snake game", "quiz app", "calculator", "html css javascript", "html and javascript"],
  "python-cli": ["python cli", "command line tool", "command-line", "python script", "argparse", "click library", "cli tool", "terminal script", "python automation"],
  "react-native-expo": ["react native", "expo", "react native app", "mobile app react", "expo app", "rn-expo", "expo router", "react navigation", "react native component", "expo sdk"],
  "flutter": ["flutter", "dart", "flutter app", "flutter widget", "material flutter", "cupertino", "pubspec", "stateful widget", "stateless widget", "flutter build"],
  "swiftui": ["swiftui", "swift ui", "swift app", "ios app", "swiftui view", "xcode", "ios development", "apple app", "uikit", "swift mobile"],
  "kotlin-compose": ["jetpack compose", "kotlin compose", "compose ui", "android app", "kotlin app", "composable", "material design android", "android development", "kotlin mobile", "android compose"],
  "mobile-common": ["mobile app", "push notification", "deep link", "mobile development", "app permissions", "mobile ux", "touch gesture", "app lifecycle", "mobile storage", "mobile camera"],
};

function wordBoundaryMatch(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
  return pattern.test(text);
}

function extractDescription(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

async function discoverSkills(): Promise<SkillMeta[]> {
  let entries: string[];
  try {
    const dirents = await readdir(SKILLS_BASE_DIR, { withFileTypes: true });
    entries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    console.warn("[SkillLoader] Could not scan skills directory:", SKILLS_BASE_DIR);
    return [];
  }

  const skills: SkillMeta[] = [];
  for (const name of entries) {
    const skillPath = join(SKILLS_BASE_DIR, name, "SKILL.md");
    try {
      const content = await readFile(skillPath, "utf-8");
      const description = extractDescription(content);
      const keywords = BUILTIN_KEYWORDS[name] ?? [name.replace(/-/g, " ")];
      skills.push({ name, description, keywords });
    } catch {
      console.warn(`[SkillLoader] Skipping skill '${name}': SKILL.md not readable at ${skillPath}`);
    }
  }
  return skills;
}

let _cachedSkills: SkillMeta[] | null = null;

export async function listSkills(): Promise<SkillMeta[]> {
  if (!_cachedSkills) {
    _cachedSkills = await discoverSkills();
  }
  return _cachedSkills;
}

export async function loadSkill(name: string): Promise<string | null> {
  const skills = await listSkills();
  const meta = skills.find((s) => s.name === name);
  if (!meta) {
    console.warn(`[SkillLoader] Unknown skill requested: '${name}'`);
    return null;
  }
  const filePath = join(SKILLS_BASE_DIR, name, "SKILL.md");
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    console.error(`[SkillLoader] Failed to load skill '${name}' from ${filePath}:`, err);
    return null;
  }
}

const FRAMEWORK_TO_SKILL: Record<string, string> = {
  "rn-expo": "react-native-expo",
  "flutter": "flutter",
  "swiftui": "swiftui",
  "kotlin": "kotlin-compose",
};

export function getSkillForFramework(framework: string): string | null {
  return FRAMEWORK_TO_SKILL[framework] ?? null;
}

/**
 * AG-12 fallback: naive keyword scoring. Used when the LLM classifier fails
 * (network error, invalid JSON, unknown skill name returned) or when no
 * provider chain is supplied. Kept silent — the LLM version is the primary.
 *
 * Returns skills in descending score order. The first entry is the best
 * keyword match (what detectSkillByKeywords used to return).
 */
async function detectSkillsByKeywords(text: string): Promise<string[]> {
  const skills = await listSkills();

  const scores: Record<string, number> = {};

  for (const skill of skills) {
    let score = 0;
    for (const keyword of skill.keywords) {
      const isPhrase = keyword.includes(" ");
      if (isPhrase ? text.toLowerCase().includes(keyword) : wordBoundaryMatch(text, keyword)) {
        score += isPhrase ? 3 : 1;
      }
    }
    if (score > 0) {
      scores[skill.name] = score;
    }
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

async function detectSkillByKeywords(text: string): Promise<string | null> {
  const names = await detectSkillsByKeywords(text);
  return names[0] ?? null;
}

/**
 * AG-12: LLM-based semantic skill detection with keyword fallback.
 *
 * Single-skill variant — preserved for callers/tests that want a scalar
 * answer. Delegates to detectSkillsFromText and returns the first result.
 */
export async function detectSkillFromText(
  text: string,
  providerChain?: AIProvider[],
): Promise<string | null> {
  const skills = await detectSkillsFromText(text, providerChain);
  return skills[0] ?? null;
}

/**
 * AG-13: Multi-skill detection. Returns up to 2 skill names ranked by
 * relevance — primary first, secondary second (or empty second slot). The
 * LLM is asked to pick a primary and optional secondary complementary
 * skill; falls through to keyword scoring on any failure.
 *
 * We cap at 2 skills to bound prompt size — full-stack projects typically
 * need one frontend + one backend skill, rarely more. If the cap needs to
 * grow, bump MAX_SKILLS.
 */
const MAX_SKILLS = 2;

export async function detectSkillsFromText(
  text: string,
  providerChain?: AIProvider[],
): Promise<string[]> {
  if (!providerChain || providerChain.length === 0) {
    return (await detectSkillsByKeywords(text)).slice(0, MAX_SKILLS);
  }

  const skills = await listSkills();
  if (skills.length === 0) return [];

  const skillList = skills
    .map((s) => `- ${s.name}: ${s.description || "(no description)"}`)
    .join("\n");

  const systemPrompt = `You are a skill classifier. Given a user's build request, pick the skill name(s) from the list below that best match the technology they want to use.

- Always pick a "primary" skill if any fits, or null if none fit.
- Pick a "secondary" skill only when the project genuinely needs two complementary skills (e.g., a full-stack project needing one frontend skill and one backend skill). Otherwise set secondary to null.
- Never pick the same skill twice.

Skills:
${skillList}

Respond with ONLY valid JSON in this shape: {"primary": "<name>" | null, "secondary": "<name>" | null}. No prose, no code fences.`;

  try {
    const completion = await withFallback(providerChain, async (client, model) =>
      client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        stream: false,
        max_tokens: 80,
      }),
    );
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as { primary: string | null; secondary: string | null };
    const knownNames = new Set(skills.map((s) => s.name));

    const picked: string[] = [];
    for (const candidate of [parsed.primary, parsed.secondary]) {
      if (candidate === null || candidate === undefined) continue;
      if (typeof candidate !== "string") continue;
      if (!knownNames.has(candidate)) {
        console.warn(`[SkillLoader] LLM returned unknown skill '${candidate}', ignoring`);
        continue;
      }
      if (picked.includes(candidate)) continue;
      picked.push(candidate);
    }

    if (picked.length === 0) {
      return (await detectSkillsByKeywords(text)).slice(0, MAX_SKILLS);
    }
    return picked;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[SkillLoader] LLM classifier failed (${message}), falling back to keywords`);
    return (await detectSkillsByKeywords(text)).slice(0, MAX_SKILLS);
  }
}

/**
 * AG-13: Load multiple skill contents and join them with clear separators so
 * the editor/verifier prompt sees each skill as its own section.
 */
export async function loadSkills(names: string[]): Promise<string | null> {
  if (names.length === 0) return null;
  const parts: string[] = [];
  for (const name of names) {
    const content = await loadSkill(name);
    if (content) {
      parts.push(`### Skill: ${name}\n\n${content}`);
    }
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n---\n\n");
}
