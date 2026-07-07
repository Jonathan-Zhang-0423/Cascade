import type { ActionLogEntry } from "./chat-types";

export function shouldShowBuildCostSummary(
  isCompleted: boolean | undefined,
  entries: ActionLogEntry[],
): boolean {
  return Boolean(isCompleted) && entries.some(
    (e) =>
      e.type !== "step" && e.type !== "narration" && e.type !== "thinking",
  );
}
