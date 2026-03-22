import { doubaoClient, DOUBAO_MODEL } from "./doubao-client";
import { EDITOR_AGENT_SYSTEM_PROMPT, buildEditorContextMessage } from "./editor-prompt";
import { VERIFIER_AGENT_SYSTEM_PROMPT, buildHolisticVerifierMessage } from "./verifier-prompt";
import { MANAGER_FIX_MODE_SYSTEM_PROMPT, buildManagerFixPlanMessage } from "./manager-prompt";

export interface BuildFile {
  path: string;
  content: string;
}

export interface BuildStep {
  step: number;
  sub_task_id?: string;
  title: string;
  description: string;
  acceptance_criteria?: string;
  required_files?: string[];
}

export interface BuildPlan {
  summary?: string;
  steps?: BuildStep[];
  sub_tasks?: BuildStep[];
}

export interface BuildSessionState {
  id: string;
  aborted: boolean;
  files: Map<string, string>;
  plan: BuildPlan;
  userRequest: string;
  userLang: string;
  taskStatuses?: Record<string, string>;
  userConfirmation?: string;
}

export type SseEmit = (data: Record<string, unknown>) => void;

const CODE_BLOCK_REGEX = /```(\w*)\s+file="([^"]+)"\n([\s\S]*?)```/g;

function extractCodeBlocks(text: string): Array<{ filePath: string; language: string; code: string }> {
  const blocks: Array<{ filePath: string; language: string; code: string }> = [];
  const regex = new RegExp(CODE_BLOCK_REGEX.source, "g");
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: match[1] || "text",
      filePath: match[2],
      code: match[3].trimEnd(),
    });
  }
  return blocks;
}

function parseAIJson(raw: string): any {
  let text = raw
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{");
  const lastEnd = text.lastIndexOf("}");
  if (start >= 0 && lastEnd > start) {
    const extracted = text.substring(start, lastEnd + 1);
    try { return JSON.parse(extracted); } catch {}
  }
  return null;
}

function normalizeSteps(plan: BuildPlan): BuildStep[] {
  const raw = plan.steps || plan.sub_tasks || [];
  return raw.map((s, i) => ({ ...s, step: s.step ?? i + 1 }));
}

function filesMapToArray(files: Map<string, string>): BuildFile[] {
  return Array.from(files.entries()).map(([path, content]) => ({ path, content }));
}

type EditorResult = { success: true } | { success: false; reason: "no_code" | "editor_error" };

function langInstruction(userLang: string): string {
  const l = userLang.toLowerCase();
  if (l.includes("chinese") || l === "zh") return "Write your preamble in Chinese (中文).";
  if (l.includes("japanese") || l === "ja") return "Write your preamble in Japanese (日本語).";
  if (l.includes("korean") || l === "ko") return "Write your preamble in Korean (한국어).";
  if (l.includes("spanish") || l === "es") return "Write your preamble in Spanish (Español).";
  if (l.includes("french") || l === "fr") return "Write your preamble in French (Français).";
  if (l.includes("german") || l === "de") return "Write your preamble in German (Deutsch).";
  if (l.includes("portuguese") || l === "pt") return "Write your preamble in Portuguese (Português).";
  if (l.includes("russian") || l === "ru") return "Write your preamble in Russian (Русский).";
  return "";
}

function langNativeLabel(userLang: string): string {
  const l = userLang.toLowerCase();
  if (l.includes("chinese") || l === "zh") return "Chinese (中文)";
  if (l.includes("japanese") || l === "ja") return "Japanese (日本語)";
  if (l.includes("korean") || l === "ko") return "Korean (한국어)";
  if (l.includes("spanish") || l === "es") return "Spanish (Español)";
  if (l.includes("french") || l === "fr") return "French (Français)";
  if (l.includes("german") || l === "de") return "German (Deutsch)";
  if (l.includes("portuguese") || l === "pt") return "Portuguese (Português)";
  if (l.includes("russian") || l === "ru") return "Russian (Русский)";
  return userLang;
}

function stepNarrationText(stepNum: number, title: string, userLang: string, mode: "build" | "fix"): string {
  const l = userLang.toLowerCase();
  if (l.includes("chinese") || l === "zh") {
    return mode === "fix" ? `正在修复第${stepNum}步：${title}。` : `正在执行第${stepNum}步：${title}。`;
  }
  if (l.includes("japanese") || l === "ja") {
    return mode === "fix" ? `ステップ${stepNum}を修正中：${title}。` : `ステップ${stepNum}を実行中：${title}。`;
  }
  if (l.includes("korean") || l === "ko") {
    return mode === "fix" ? `${stepNum}단계 수정 중: ${title}.` : `${stepNum}단계 실행 중: ${title}.`;
  }
  if (l.includes("spanish") || l === "es") {
    return mode === "fix" ? `Corrigiendo paso ${stepNum}: ${title}.` : `Trabajando en el paso ${stepNum}: ${title}.`;
  }
  if (l.includes("french") || l === "fr") {
    return mode === "fix" ? `Correction de l'étape ${stepNum}: ${title}.` : `Travail sur l'étape ${stepNum}: ${title}.`;
  }
  return mode === "fix" ? `Fixing step ${stepNum}: ${title}.` : `Working on step ${stepNum}: ${title}.`;
}

async function callEditor(
  prompt: string,
  files: BuildFile[],
  emit: SseEmit,
  session: BuildSessionState,
): Promise<EditorResult> {
  const langHint = langInstruction(session.userLang || "English");
  const fullPrompt = langHint ? `${prompt}\n\n${langHint}` : prompt;
  const systemPrompt = langHint
    ? `IMPORTANT: Write ALL explanatory preamble text in ${langNativeLabel(session.userLang || "English")}. Code identifiers, file paths, and code comments must remain in their original language.\n\n${EDITOR_AGENT_SYSTEM_PROMPT}`
    : EDITOR_AGENT_SYSTEM_PROMPT;
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];
  if (files.length > 0) {
    messages.push({ role: "system", content: buildEditorContextMessage(files) });
  }
  messages.push({ role: "user", content: fullPrompt });

  let accumulated = "";
  let appliedCount = 0;
  let pastFirstCodeBlock = false;
  let preambleEmittedLength = 0;

  try {
    const stream = await doubaoClient.chat.completions.create({
      model: DOUBAO_MODEL,
      messages,
      stream: true,
      max_tokens: 16384,
    });

    for await (const chunk of stream) {
      if (session.aborted) break;
      const token = chunk.choices[0]?.delta?.content;
      if (token) {
        accumulated += token;

        if (!pastFirstCodeBlock) {
          const fenceIdx = accumulated.indexOf("```");
          if (fenceIdx !== -1) {
            pastFirstCodeBlock = true;
            const preamble = accumulated.slice(preambleEmittedLength, fenceIdx).trim();
            if (preamble) {
              emit({ type: "narration_token", token: preamble });
              await new Promise<void>(r => setTimeout(r, 0));
            }
          } else {
            emit({ type: "narration_token", token });
            preambleEmittedLength = accumulated.length;
            await new Promise<void>(r => setTimeout(r, 0));
          }
        }

        if (token.includes("```")) {
          const blocks = extractCodeBlocks(accumulated);
          while (appliedCount < blocks.length) {
            const block = blocks[appliedCount];
            session.files.set(block.filePath, block.code);
            emit({ type: "code_applied", filePath: block.filePath, code: block.code });
            appliedCount++;
          }
        }
      }
    }

    const finalBlocks = extractCodeBlocks(accumulated);
    while (appliedCount < finalBlocks.length) {
      const block = finalBlocks[appliedCount];
      session.files.set(block.filePath, block.code);
      emit({ type: "code_applied", filePath: block.filePath, code: block.code });
      appliedCount++;
    }

    if (finalBlocks.length === 0) {
      return { success: false, reason: "no_code" };
    }

    return { success: true };
  } catch {
    return { success: false, reason: "editor_error" };
  }
}

async function callVerifier(
  userRequest: string,
  planSteps: BuildStep[],
  filesBefore: BuildFile[],
  filesAfter: BuildFile[],
  emit: SseEmit,
  userFeedback?: string,
  userLang?: string,
): Promise<any> {
  let contextMessage = buildHolisticVerifierMessage(
    userRequest,
    planSteps.map(s => ({
      step: s.step,
      title: s.title,
      description: s.description,
      acceptance_criteria: s.acceptance_criteria,
    })),
    filesBefore,
    filesAfter,
  );
  if (userFeedback) {
    contextMessage += `\n\n--- USER FEEDBACK ---\nThe user provided the following feedback:\n${userFeedback}\nPlease take this into account.`;
  }
  if (userLang) {
    const hint = langInstruction(userLang).replace("preamble", "friendly summary");
    if (hint) contextMessage += `\n\n${hint}`;
  }
  const verifierLangHint = userLang ? langInstruction(userLang) : "";
  const verifierSystemPrompt = verifierLangHint
    ? `IMPORTANT: Write ALL explanatory text and friendly summaries in ${langNativeLabel(userLang || "English")}. Code identifiers and file paths remain in their original language.\n\n${VERIFIER_AGENT_SYSTEM_PROMPT}`
    : VERIFIER_AGENT_SYSTEM_PROMPT;
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: verifierSystemPrompt },
    { role: "user", content: contextMessage },
  ];

  let accumulated = "";
  let preambleDone = false;

  try {
    const stream = await doubaoClient.chat.completions.create({
      model: DOUBAO_MODEL,
      messages,
      stream: true,
      max_tokens: 16384,
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (!token) continue;
      accumulated += token;

      if (!preambleDone) {
        const sepIdx = accumulated.indexOf("\n---");
        if (sepIdx !== -1) {
          preambleDone = true;
        } else {
          emit({ type: "narration_token", token });
          await new Promise<void>(r => setTimeout(r, 0));
        }
      }
    }
  } catch (err) {
    console.error("[VerifierAgent] Stream error:", err);
  }

  const sepIdx = accumulated.indexOf("\n---");
  const jsonPart = sepIdx !== -1 ? accumulated.slice(sepIdx + 4).trim() : accumulated;
  return parseAIJson(jsonPart);
}

async function callFixPlan(
  review: any,
  userRequest: string,
  currentFiles: BuildFile[],
): Promise<BuildPlan | null> {
  const bugReport = {
    bugs: review.bugs || [],
    missing_features: review.missing_features || [],
    regressions: review.regressions || [],
    summary: review.summary || "",
    suggestion: review.suggestion || "",
  };
  const contextMessage = buildManagerFixPlanMessage(currentFiles, bugReport, userRequest);
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
  const raw = completion.choices[0]?.message?.content || "";
  const parsed = parseAIJson(raw);
  if (!parsed) return null;
  return parsed.plan || parsed;
}

const MAX_FIX_CYCLES = 3;

export async function runBuildSession(session: BuildSessionState, emit: SseEmit): Promise<void> {
  const { plan, userRequest } = session;
  const normalizedSteps = normalizeSteps(plan);
  const totalSteps = normalizedSteps.length;
  const initialFiles = filesMapToArray(session.files);

  for (let i = 0; i < normalizedSteps.length; i++) {
    if (session.aborted) break;

    const task = normalizedSteps[i];

    if (session.taskStatuses && session.taskStatuses[String(task.step)] === "done") {
      continue;
    }

    emit({ type: "step_starting", stepNumber: task.step, stepTitle: task.title, totalSteps });

    if (session.aborted) break;

    const stepNarration = stepNarrationText(task.step, task.title, session.userLang || "English", "build");
    emit({ type: "narration_token", token: stepNarration + " " });
    await new Promise<void>(r => setTimeout(r, 0));

    if (session.aborted) break;

    const requiredFiles = task.required_files;
    let fileContext: BuildFile[];
    if (requiredFiles && requiredFiles.length > 0) {
      const reqSet = new Set(requiredFiles);
      fileContext = filesMapToArray(session.files).filter(f => reqSet.has(f.path));
      const missing = requiredFiles.filter(p => !session.files.has(p));
      missing.forEach(p => fileContext.push({ path: p, content: "" }));
    } else {
      fileContext = filesMapToArray(session.files);
    }

    const promptLines: string[] = [
      `[Plan Mode] You are executing subtask ${task.sub_task_id || task.step}: ${task.title}`,
      `Task description: ${task.description}`,
    ];
    if (task.acceptance_criteria) {
      promptLines.push(`Acceptance criteria: ${task.acceptance_criteria}`);
    }
    promptLines.push("");
    promptLines.push("IMPORTANT: You are modifying existing project files. You MUST preserve ALL existing content. Only add, modify, or remove what is specifically described in this task. When outputting a file, include the COMPLETE file with all its original content plus your changes — never omit or rewrite existing code that is not part of this task.");
    promptLines.push("");
    promptLines.push("Please implement the above subtask. Focus only on this specific task and ensure the acceptance criteria are met.");
    const prompt = promptLines.join("\n");

    const result = await callEditor(prompt, fileContext, emit, session);

    if (session.aborted) {
      emit({ type: "step_cancelled", stepNumber: task.step });
      break;
    }

    if (result.success) {
      emit({ type: "step_completed", stepNumber: task.step });
    } else {
      emit({ type: "step_failed", stepNumber: task.step, reason: result.reason });
      break;
    }
  }

  if (session.aborted) {
    emit({ type: "done" });
    return;
  }

  let currentCycle = 0;
  let passed = false;
  let currentPlanSteps = normalizedSteps;

  while (currentCycle < MAX_FIX_CYCLES && !passed && !session.aborted) {
    currentCycle++;

    emit({ type: "reviewing" });

    const filesAfter = filesMapToArray(session.files);
    const feedback = session.userConfirmation || undefined;
    if (session.userConfirmation) session.userConfirmation = undefined;
    let review: any = null;
    try {
      review = await callVerifier(userRequest, currentPlanSteps, initialFiles, filesAfter, emit, feedback, session.userLang);
    } catch {}

    if (session.aborted) break;

    if (!review) {
      emit({
        type: "bugs_found",
        bugCount: 0,
        reviewSummary: "Review failed due to an error.",
        fixCycle: currentCycle,
        maxFixCycles: MAX_FIX_CYCLES,
      });
      break;
    }

    if (review.user_confirmation_needed?.length > 0 && review.user_confirmation_needed[0] !== "") {
      emit({ type: "needs_input", items: review.user_confirmation_needed });
      emit({ type: "done" });
      return;
    }

    if (review.overall_status === "pass") {
      passed = true;
      emit({
        type: "review_passed",
        summary: review.summary,
        requirementMatchPercent: review.requirement_match_percent,
      });
    } else {
      const issueCount = (review.bugs?.length || 0) + (review.missing_features?.length || 0) + (review.regressions?.length || 0);
      emit({
        type: "bugs_found",
        bugCount: issueCount,
        reviewSummary: review.summary,
        fixCycle: currentCycle,
        maxFixCycles: MAX_FIX_CYCLES,
        review,
      });

      if (currentCycle >= MAX_FIX_CYCLES) break;

      emit({ type: "fixing", fixCycle: currentCycle });

      const fixPlan = await callFixPlan(review, userRequest, filesMapToArray(session.files));
      if (!fixPlan) break;

      const fixSteps = normalizeSteps(fixPlan);
      currentPlanSteps = fixSteps;

      for (let i = 0; i < fixSteps.length; i++) {
        if (session.aborted) break;

        const fixTask = fixSteps[i];
        emit({ type: "step_starting", stepNumber: fixTask.step, stepTitle: fixTask.title, totalSteps: fixSteps.length });

        if (session.aborted) break;

        const fixNarration = stepNarrationText(fixTask.step, fixTask.title, session.userLang || "English", "fix");
        emit({ type: "narration_token", token: fixNarration + " " });
        await new Promise<void>(r => setTimeout(r, 0));

        if (session.aborted) break;

        const fixFiles = filesMapToArray(session.files);
        const fixPromptLines: string[] = [
          `[Fix Mode] You are executing fix subtask ${fixTask.sub_task_id || fixTask.step}: ${fixTask.title}`,
          `Task description: ${fixTask.description}`,
        ];
        if (fixTask.acceptance_criteria) {
          fixPromptLines.push(`Acceptance criteria: ${fixTask.acceptance_criteria}`);
        }
        fixPromptLines.push("");
        fixPromptLines.push("IMPORTANT: Preserve ALL existing content not related to this fix. Output the COMPLETE file with your changes applied.");
        const fixPrompt = fixPromptLines.join("\n");

        const fixResult = await callEditor(fixPrompt, fixFiles, emit, session);

        if (session.aborted) break;

        if (fixResult.success) {
          emit({ type: "step_completed", stepNumber: fixTask.step });
        } else {
          emit({ type: "step_failed", stepNumber: fixTask.step, reason: fixResult.reason });
        }
      }
    }
  }

  if (passed) {
    const beforeMap = new Map(initialFiles.map(f => [f.path, f.content]));
    const finalFiles = filesMapToArray(session.files);
    const changedFiles = finalFiles
      .filter(f => !beforeMap.has(f.path) || beforeMap.get(f.path) !== f.content)
      .map(f => f.path);

    emit({ type: "all_complete", changedFiles, summary: plan.summary || "" });
  }

  emit({ type: "done" });
}
