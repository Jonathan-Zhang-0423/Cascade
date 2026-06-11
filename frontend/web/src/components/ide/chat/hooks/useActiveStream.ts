import { useSyncExternalStore, useCallback, useMemo, useEffect, useRef } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { streamRegistry, type ManagerStreamState, type BuildStreamState, type ReviewStreamState } from "@/services/stream";

/**
 * useActiveStream — thin React bridge that subscribes to the stream
 * instances for the currently active project. Replaces the old
 * useManagerStream + useBuildStream combination for UI consumption.
 *
 * The underlying ManagerStreamInstance / BuildStreamInstance live in the
 * registry and are NOT tied to React lifecycle — they survive project
 * switches and component unmounts.
 */
export function useActiveStream() {
  const projectId = useIDEStore((s) => s.projectId);
  const slot = useMemo(() => streamRegistry.get(projectId || ""), [projectId]);

  // ─── Auto-reconnect on project switch ────────────────────────────────
  // When the active project changes, attempt to reconnect to any existing
  // manager/build sessions for that project. This restores live state
  // without aborting background streams from other projects.
  const prevProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    // Skip on first mount if same project — the old hooks handle initial connect
    if (prevProjectRef.current === projectId) return;
    prevProjectRef.current = projectId;

    // Give a small delay to avoid racing with loadProject's async state setup
    const timer = setTimeout(() => {
      if (!slot.manager.isActive) {
        slot.manager.attemptReconnect().catch(() => {});
      }
      if (!slot.build.isActive) {
        slot.build.attemptReconnect().catch(() => {});
      }
      if (!slot.review.isActive) {
        slot.review.attemptReconnect().catch(() => {});
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [projectId, slot]);

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

  // ─── Review stream state ─────────────────────────────────────────────
  const reviewState = useSyncExternalStore<ReviewStreamState>(
    slot.review.state.subscribe,
    slot.review.state.getSnapshot,
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

  const handleStartReview = useCallback(async () => {
    await slot.review.execute();
  }, [slot]);

  const handleStopReview = useCallback(() => {
    slot.review.stop();
  }, [slot]);

  const resetManagerLiveState = useCallback(() => {
    slot.manager.resetLive();
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
    },
    // Build stream
    build: {
      buildPhase: buildState.buildPhase,
      liveActionLog: buildState.actionLog,
      liveThinkingText: buildState.thinkingText,
      liveNarrationText: buildState.narrationText,
      isReconnecting: buildState.isReconnecting,
      thinkingElapsedSec: buildState.thinkingElapsedSec,
      handleExecutePlan,
      handleDirectBuild,
      handleStopExecution,
      resetLiveState: resetBuildLiveState,
    },
    // Review stream
    review: {
      phase: reviewState.phase,
      round: reviewState.round,
      maxRounds: reviewState.maxRounds,
      liveThinkingText: reviewState.thinkingText,
      liveNarrationText: reviewState.narrationText,
      isReconnecting: reviewState.isReconnecting,
      isActive: slot.review.isActive,
      handleStartReview,
      handleStopReview,
    },
    // Shared
    slot,
    projectId,
  };
}
