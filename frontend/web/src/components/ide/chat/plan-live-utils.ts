import type { ActionLogEntry } from "./chat-types";

export function shouldShowPlanActionLog(args: {
  isExecuting?: boolean;
  hasEntries?: boolean;
}): boolean {
  return Boolean(args.isExecuting || args.hasEntries);
}

function entryStepNumber(entry: ActionLogEntry): number | undefined {
  if (typeof entry.stepNum === "number" && Number.isFinite(entry.stepNum) && entry.stepNum > 0) {
    return entry.stepNum;
  }
  if (entry.type !== "step") return undefined;
  const match = entry.label.match(/Step\s*(\d+)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function actionLogHasStep(entries: ActionLogEntry[], stepNumber: number): boolean {
  return entries.some((entry) => entryStepNumber(entry) === stepNumber);
}

export function latestActionLogStepNumber(entries?: ActionLogEntry[]): number | undefined {
  if (!Array.isArray(entries)) return undefined;
  let latest: number | undefined;
  for (const entry of entries) {
    const stepNumber = entryStepNumber(entry);
    if (stepNumber) latest = stepNumber;
  }
  return latest;
}

export function ensureActiveStepActionLogEntry(args: {
  entries?: ActionLogEntry[];
  activeStepNumber?: number | null;
  activeStepTitle?: string;
  totalSteps?: number;
  isExecuting?: boolean;
}): ActionLogEntry[] {
  const entries = Array.isArray(args.entries) ? args.entries : [];
  const stepNumber = args.activeStepNumber;
  if (!args.isExecuting || !stepNumber || actionLogHasStep(entries, stepNumber)) {
    return entries;
  }

  return [
    ...entries,
    {
      type: "step",
      label: `Step ${stepNumber}/${args.totalSteps || stepNumber}: ${args.activeStepTitle || ""}`,
      detail: "",
      timestamp: 0,
      stepNum: stepNumber,
    },
  ];
}
