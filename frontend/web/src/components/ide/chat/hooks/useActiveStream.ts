import { useSyncExternalStore, useCallback, useMemo, useEffect, useRef } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { streamRegistry, type ManagerStreamState, type BuildStreamState } from "@/services/stream";

/**
 * useActiveStream — thin React bridge that subscribes to the stream
 * instances for the currently active project + session.
 *
 * Each (projectId, sessionId) pair gets its own isolated slot. The slot's
 * StoreActions guard prevents AI responses from writing into the wrong session.
 */
export function useActiveStream() {
  const projectId = useIDEStore((s) => s.projectId);
  const currentSessionId = useIDEStore((s) => s.currentSessionId);
  const slot = useMemo(
    () => streamRegistry.get(projectId || "", currentSessionId),
    [projectId, currentSessionId],
  );

  // ─── Auto-reconnect on project / session switch ──────────────────────
  const prevKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const key = `${projectId}:${currentSessionId ?? "__main__"}`;
    if (prevKeyRef.current === key) return;
    prevKeyRef.current = key;

    const timer = setTimeout(() => {
      if (!slot.manager.isActive) {
        slot.manager.attemptReconnect().catch(() => {});
      }
      if (slot.build.isActive) {
        // Build still running for this project — restore its per-session task
        // statuses into the global store (they were lost on loadProject reset).
        slot.build.restoreTaskStatuses();
      } else {
        slot.build.attemptReconnect().catch(() => {});
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [projectId, currentSessionId, slot]);

  // ─── Manager stream state ────────────────────────────────────────────
  const mgrState = useSyncExternalStore<ManagerStreamState>(
    slot.manager.state.subscribe,
    slot.manager.state.getSnapshot,
  );

  // ─── Build stream state ──────────────────────────────────────────────
  const buildState = useSyncExternalStore<BuildStreamState>(
    slot.build.state.subscribe,
    slot.build.state.getSnapshot,
  );

  // ─── Commands (bound to current slot) ────────────────────────────────
  const handleManagerSend = useCallback(
    async (overrideMessage?: string, input?: string): Promise<boolean> => {
      const trimmed = overrideMessage?.trim() || input?.trim() || "";
      if (!trimmed) return false;
      return slot.manager.send(trimmed);
    },
    [slot],
  );

  const handleExecutePlan = useCallback(
    async (directOpts?: { userMessage: string }) => {
      if (directOpts?.userMessage) {
        await slot.build.execute({ userMessage: directOpts.userMessage });
      } else {
        await slot.build.execute();
      }
    },
    [slot],
  );

  const handleDirectBuild = useCallback(
    (userMessage: string) => handleExecutePlan({ userMessage }),
    [handleExecutePlan],
  );

  const handleStopExecution = useCallback(() => {
    slot.build.stop();
  }, [slot]);

  const resetManagerLiveState = useCallback(() => {
    slot.manager.resetLive();
  }, [slot]);

  const clearManagerLiveState = useCallback(() => {
    slot.manager.state.set({
      thinkingText: "",
      narrationText: "",
      actionLog: [],
      preparingPlan: false,
    });
  }, [slot]);

  const resetBuildLiveState = useCallback(() => {
    slot.build.state.set({
      thinkingText: "",
      narrationText: "",
      actionLog: [],
      buildPhase: null,
      thinkingElapsedSec: null,
    });
  }, [slot]);

  return {
    // Manager stream
    manager: {
      handleManagerSend,
      mgrPreparingPlan: mgrState.preparingPlan,
      mgrLiveThinkingText: mgrState.thinkingText,
      mgrLiveNarrationText: mgrState.narrationText,
      mgrLiveActionLog: mgrState.actionLog,
      isMgrReconnecting: mgrState.isReconnecting,
      autoExecutePlanRef: { current: slot.manager.autoExecutePlan },
      resetLiveState: resetManagerLiveState,
      clearLiveState: clearManagerLiveState,
    },
    // Build stream
    build: {
      buildPhase: buildState.buildPhase,
      liveActionLog: buildState.actionLog,
      liveThinkingText: buildState.thinkingText,
      liveNarrationText: buildState.narrationText,
      liveStepNarrations: buildState.stepNarrations,
      isReconnecting: buildState.isReconnecting,
      thinkingElapsedSec: buildState.thinkingElapsedSec,
      handleExecutePlan,
      handleDirectBuild,
      handleStopExecution,
      resetLiveState: resetBuildLiveState,
    },
    // Shared
    slot,
    projectId,
  };
}
