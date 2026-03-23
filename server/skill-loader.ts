import { readFile, readdir } from "fs/promises";
import { join } from "path";

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

export async function detectSkillFromText(text: string): Promise<string | null> {
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

  if (Object.keys(scores).length === 0) return null;

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[0];
}
