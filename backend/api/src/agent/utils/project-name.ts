const DEFAULT_PROJECT_NAMES = new Set([
  "new project",
  "新建项目",
  "untitled",
  "未命名",
  "test project",
]);

export function isDefaultProjectName(name: string | null | undefined): boolean {
  const normalized = (name ?? "").trim().toLowerCase();
  return !normalized || DEFAULT_PROJECT_NAMES.has(normalized);
}

export function sanitizeProjectName(raw: string | null | undefined): string | null {
  let name = (raw ?? "").trim();
  if (!name) return null;

  name = name
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/^\s*project\s*name\s*:\s*/i, "")
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!name || name.includes("<") || name.includes("\n")) return null;
  if (name.length > 40) name = name.slice(0, 40).trim();
  return name || null;
}

export function buildProjectNamePrompt(idea: string, framework?: string): string {
  const isChinese = /[\u4e00-\u9fff]/.test(idea);
  const langInstruction = isChinese
    ? "用中文起名，2-4 个字或词，不要使用英文。"
    : "Use English, 2-4 words, title case.";
  const frameworkHint = framework && framework !== "web" ? ` (${framework} app)` : "";
  return [
    `Generate a short project name for this app idea${frameworkHint}. ${langInstruction}`,
    "",
    `"${idea.slice(0, 240)}"`,
    "",
    "Respond with ONLY the project name. No explanations, no quotes, no markdown, no thinking.",
  ].join("\n");
}
