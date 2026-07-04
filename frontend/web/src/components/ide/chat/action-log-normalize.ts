import type { ActionLogEntry, NarrationSegment } from "./chat-types";

const ACTION_TYPES = new Set<ActionLogEntry["type"]>([
  "thinking",
  "tool_call",
  "terminal_command",
  "file_read",
  "file_write",
  "file_delete",
  "code_applied",
  "code_review",
  "capabilities",
  "plan",
  "step",
  "narration",
  "research",
]);

const PERSISTED_DETAIL_LIMIT: Partial<Record<ActionLogEntry["type"], number>> = {
  thinking: 4000,
  file_read: 2000,
  file_write: 1000,
  code_applied: 1000,
  code_review: 2000,
  plan: 2000,
  capabilities: 1000,
  research: 800,
  terminal_command: 800,
  tool_call: 800,
};

export function stringifyLogValue(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Error) return value.message || fallback;
  try {
    const json = JSON.stringify(value);
    return json == null ? fallback : json;
  } catch {
    return String(value);
  }
}

function normalizeActionType(value: unknown): ActionLogEntry["type"] {
  return typeof value === "string" && ACTION_TYPES.has(value as ActionLogEntry["type"])
    ? value as ActionLogEntry["type"]
    : "tool_call";
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

export function normalizeActionLogEntry(raw: Partial<ActionLogEntry> & Record<string, unknown>): ActionLogEntry {
  const filePath = stringifyLogValue(raw.filePath, "").trim();
  const precedingNarration = stringifyLogValue(raw.precedingNarration, "").trim();
  const stepNum = typeof raw.stepNum === "number" && Number.isFinite(raw.stepNum)
    ? raw.stepNum
    : undefined;

  return {
    type: normalizeActionType(raw.type),
    label: stringifyLogValue(raw.label, ""),
    detail: stringifyLogValue(raw.detail, ""),
    timestamp: normalizeTimestamp(raw.timestamp),
    filePath: filePath || undefined,
    precedingNarration: precedingNarration || undefined,
    stepNum,
  };
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...(truncated for history; full file content is stored in project files)`;
}

export function compactActionLogEntryForPersistence(raw: Partial<ActionLogEntry> & Record<string, unknown>): ActionLogEntry {
  const entry = normalizeActionLogEntry(raw);
  const detailLimit = PERSISTED_DETAIL_LIMIT[entry.type] ?? 800;
  return {
    ...entry,
    label: truncateText(entry.label, 240),
    detail: truncateText(entry.detail, detailLimit),
    filePath: entry.filePath ? truncateText(entry.filePath, 500) : undefined,
    precedingNarration: entry.precedingNarration
      ? truncateText(entry.precedingNarration, 800)
      : undefined,
  };
}

function parseStepNumber(label: string): number | undefined {
  const match = label.match(/Step\s*(\d+)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getEntryStepNumber(entry: ActionLogEntry): number | undefined {
  if (typeof entry.stepNum === "number" && Number.isFinite(entry.stepNum) && entry.stepNum > 0) {
    return entry.stepNum;
  }
  if (entry.type === "step") return parseStepNumber(entry.label);
  return undefined;
}

function expectedStepCount(entries: ActionLogEntry[]): number {
  const seen = new Set<number>();
  for (const entry of entries) {
    const stepNum = getEntryStepNumber(entry);
    if (stepNum) seen.add(stepNum);
  }
  return seen.size;
}

function shouldRebuildSegments(
  entries: ActionLogEntry[],
  existingSegments?: NarrationSegment[],
): boolean {
  const expected = expectedStepCount(entries);
  if (expected <= 1) return false;
  if (!existingSegments || existingSegments.length === 0) return true;
  return existingSegments.length < expected;
}

export function rebuildSegmentsFromActionLog(
  entries: ActionLogEntry[],
  existingSegments?: NarrationSegment[],
): NarrationSegment[] | undefined {
  const normalizedEntries = entries.map((entry) => normalizeActionLogEntry(entry as any));
  const normalizedSegments = Array.isArray(existingSegments)
    ? existingSegments.map((seg, index) => ({
        id: stringifyLogValue(seg.id, String(index)),
        narration: stringifyLogValue(seg.narration, ""),
        actions: Array.isArray(seg.actions)
          ? seg.actions.map((entry) => normalizeActionLogEntry(entry as any))
          : [],
        isLive: Boolean(seg.isLive),
        stepLabel: stringifyLogValue(seg.stepLabel, ""),
      }))
    : undefined;

  if (!shouldRebuildSegments(normalizedEntries, normalizedSegments)) return undefined;

  const narrationByStep = new Map<number, string>();
  const labelByStep = new Map<number, string>();
  normalizedSegments?.forEach((seg, index) => {
    const firstActionStep = seg.actions.find((entry) => getEntryStepNumber(entry))?.stepNum;
    const stepNum =
      (seg.stepLabel && parseStepNumber(seg.stepLabel)) ||
      (typeof firstActionStep === "number" && Number.isFinite(firstActionStep) ? firstActionStep : undefined) ||
      index + 1;
    if (seg.narration) narrationByStep.set(stepNum, seg.narration);
    if (seg.stepLabel) labelByStep.set(stepNum, seg.stepLabel);
  });

  const byStep = new Map<number, NarrationSegment>();
  let currentStep = 0;

  const ensureSegment = (stepNum: number): NarrationSegment => {
    const existing = byStep.get(stepNum);
    if (existing) return existing;
    const seg: NarrationSegment = {
      id: String(stepNum),
      narration: narrationByStep.get(stepNum) ?? "",
      actions: [],
      isLive: false,
      stepLabel: labelByStep.get(stepNum),
    };
    byStep.set(stepNum, seg);
    return seg;
  };

  for (const entry of normalizedEntries) {
    if (entry.type === "narration") continue;
    if (entry.type === "step") {
      const stepNum = getEntryStepNumber(entry) ?? currentStep + 1;
      currentStep = stepNum;
      const seg = ensureSegment(stepNum);
      seg.stepLabel = entry.label || seg.stepLabel;
      continue;
    }

    const stepNum = getEntryStepNumber(entry) ?? (currentStep > 0 ? currentStep : 1);
    currentStep = Math.max(currentStep, stepNum);
    ensureSegment(stepNum).actions.push(entry);
  }

  return Array.from(byStep.entries())
    .sort(([a], [b]) => a - b)
    .map(([, seg]) => seg);
}

export function compactBuildResultForPersistence<T extends Record<string, unknown>>(raw: T): T {
  if (!raw || typeof raw !== "object") return raw;
  const normalizedActionLog = Array.isArray((raw as any).actionLog)
    ? (raw as any).actionLog.map((entry: unknown) => normalizeActionLogEntry(entry as any))
    : (raw as any).actionLog;
  const normalizedSegments = Array.isArray((raw as any).segments)
    ? (raw as any).segments.map((seg: any, index: number) => ({
        id: stringifyLogValue(seg?.id, String(index)),
        narration: stringifyLogValue(seg?.narration, ""),
        actions: Array.isArray(seg?.actions)
          ? seg.actions.map((entry: unknown) => normalizeActionLogEntry(entry as any))
          : [],
        isLive: Boolean(seg?.isLive),
        stepLabel: stringifyLogValue(seg?.stepLabel, "") || undefined,
      }))
    : (raw as any).segments;
  const rebuiltSegments = Array.isArray(normalizedActionLog)
    ? rebuildSegmentsFromActionLog(normalizedActionLog, normalizedSegments)
    : undefined;
  const segmentsForPersistence = rebuiltSegments ?? normalizedSegments;

  const actionLog = Array.isArray(normalizedActionLog)
    ? normalizedActionLog.map((entry: unknown) => compactActionLogEntryForPersistence(entry as any))
    : normalizedActionLog;
  const segments = Array.isArray(segmentsForPersistence)
    ? segmentsForPersistence.map((seg: any, index: number) => ({
        id: stringifyLogValue(seg?.id, String(index)),
        narration: truncateText(stringifyLogValue(seg?.narration, ""), 800),
        actions: Array.isArray(seg?.actions)
          ? seg.actions.map((entry: unknown) => compactActionLogEntryForPersistence(entry as any))
          : [],
        isLive: Boolean(seg?.isLive),
        stepLabel: stringifyLogValue(seg?.stepLabel, "") || undefined,
      }))
    : segmentsForPersistence;

  return {
    ...raw,
    actionLog,
    segments,
  };
}
