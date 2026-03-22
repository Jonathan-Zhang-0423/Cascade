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

async function callEditor(
  prompt: string,
  files: BuildFile[],
  emit: SseEmit,
  session: BuildSessionState,
): Promise<EditorResult> {
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: EDITOR_AGENT_SYSTEM_PROMPT },
  ];
  if (files.length > 0) {
    messages.push({ role: "system", content: buildEditorContextMessage(files) });
  }
  messages.push({ role: "user", content: prompt });

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
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: VERIFIER_AGENT_SYSTEM_PROMPT },
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

    const stepNarrationWords = `Working on step ${task.step}: ${task.title}.`.split(" ");
    for (const word of stepNarrationWords) {
      if (session.aborted) break;
      emit({ type: "narration_token", token: word + " " });
      await new Promise<void>(r => setTimeout(r, 0));
    }

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
      review = await callVerifier(userRequest, currentPlanSteps, initialFiles, filesAfter, emit, feedback);
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

        const fixNarrationWords = `Fixing step ${fixTask.step}: ${fixTask.title}.`.split(" ");
        for (const word of fixNarrationWords) {
          if (session.aborted) break;
          emit({ type: "narration_token", token: word + " " });
          await new Promise<void>(r => setTimeout(r, 0));
        }

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
