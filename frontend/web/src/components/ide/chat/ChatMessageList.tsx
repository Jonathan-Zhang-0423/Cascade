import type { ChatMessage, ManagerMessage, HolisticReviewResult, ReviewPhase, ReviewStrictness } from "@/stores/ide-store";
import { useIDEStore } from "@/stores/ide-store";
import { useEffect, useRef, useState, useSyncExternalStore, useMemo } from "react";
import type { ActionLogEntry } from "./chat-types";
import { ActionLogCollapsed } from "./action-log";
import {
  MessageBubble,
  CheckpointMarker,
} from "./message-components";
import { ManagerMessageBubble } from "./plan-components";
import { streamRegistry } from "@/services/stream";

interface ChatMessageListProps {
  chatMessages: ChatMessage[];
  managerMessages: ManagerMessage[];
  autoAppliedMessageIds: Set<string>;
  appliedBlockIndices: Set<number>;
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "needs-input" | "bug">;
  taskFailureReasons?: Record<string, string>;
  isExecuting: boolean;
  pendingConfirmation: { stepKey: string; items: string[] } | null | undefined;
  userConfirmationInput: string;
  reviewPhase: ReviewPhase;
  holisticReview: HolisticReviewResult | null | undefined;
  fixCycle: number;
  liveNarrationText?: string;
  completionData?: { changedFiles: string[]; summary: string } | null;
  handleExecutePlan?: () => void;
  handleRevisePlan?: (note?: string) => void;
  handleStopExecution?: () => void;
  handleContinueExecution?: (input?: string) => void;
  setUserConfirmationInput?: (v: string) => void;
  handleStartReview?: () => void;
  handleStopReview?: () => void;
  reviewStrictness?: ReviewStrictness;
  onReviewStrictnessChange?: (s: ReviewStrictness) => void;
  reviewLiveNarration?: string;
  reviewRound?: number;
  reviewMaxRounds?: number;
}

export function ChatMessageList({
  chatMessages,
  managerMessages,
  autoAppliedMessageIds,
  appliedBlockIndices,
  taskStatuses,
  taskFailureReasons,
  isExecuting,
  pendingConfirmation,
  userConfirmationInput,
  reviewPhase,
  holisticReview,
  fixCycle,
  liveNarrationText,
  completionData,
  handleExecutePlan,
  handleRevisePlan,
  handleStopExecution,
  handleContinueExecution,
  setUserConfirmationInput,
  handleStartReview,
  handleStopReview,
  reviewStrictness,
  onReviewStrictnessChange,
  reviewLiveNarration,
  reviewRound,
  reviewMaxRounds,
}: ChatMessageListProps) {
  // ── Subscribe to live actionLog at the list level (correct slot, single instance) ──
  const projectId = useIDEStore((st) => st.projectId);
  const slot = projectId ? streamRegistry.get(projectId) : null;
  const liveActionLog = useSyncExternalStore<ActionLogEntry[]>(
    slot ? slot.build.state.subscribe : (() => () => {}),
    slot ? () => slot.build.state.getSnapshot().actionLog : () => [],
  );

  // Build map: stepNumber (number) → ActionLogEntry[]
  const stepActionsMap = useMemo(() => {
    const map = new Map<number, ActionLogEntry[]>();
    let currentStep = -1;
    for (const entry of liveActionLog) {
      if (entry.type === "step") {
        const m = entry.label.match(/Step\s+(\d+)/i);
        currentStep = m ? parseInt(m[1], 10) : currentStep + 1;
        if (!map.has(currentStep)) map.set(currentStep, []);
      } else if (currentStep >= 0) {
        const bucket = map.get(currentStep);
        if (bucket) bucket.push(entry);
        else map.set(currentStep, [entry]);
      }
    }
    return map;
  }, [liveActionLog]);
  const lastPlanMsgId = [...managerMessages]
    .reverse()
    .find((m) => m.plan)?.id;
  const lastChatIdx = chatMessages.length - 1;
  type MergedItem =
    | { kind: "chat"; msg: ChatMessage; idx: number }
    | { kind: "manager"; msg: ManagerMessage };
  const merged: MergedItem[] = [
    ...chatMessages.map((msg, idx) => ({
      kind: "chat" as const,
      msg,
      idx,
    })),
    ...managerMessages.map((msg) => ({
      kind: "manager" as const,
      msg,
    })),
  ].sort(
    (a, b) => a.msg.seq - b.msg.seq || a.msg.timestamp - b.msg.timestamp,
  );

  const allCheckpointSeqs = merged
    .filter(
      (item) =>
        (item.kind === "chat" && item.msg.role === "checkpoint") ||
        (item.kind === "manager" && item.msg.role === "checkpoint")
    )
    .map((item) => item.msg.seq);
  const lastCheckpointSeq = allCheckpointSeqs.length > 0 ? Math.max(...allCheckpointSeqs) : -1;

  const seenCheckpointIds = new Set<string>();

  const loadOlderMessages = useIDEStore((s) => s.loadOlderMessages);
  const messagesReady = useIDEStore((s) => s.messagesReady);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const [hasMoreChat, setHasMoreChat] = useState(true);
  const [hasMoreMgr, setHasMoreMgr] = useState(true);
  const totalMsgs = chatMessages.length + managerMessages.length;

  useEffect(() => {
    if (!sentinelRef.current) return;
    if (!hasMoreChat && !hasMoreMgr) return;
    if (totalMsgs === 0) return;
    const el = sentinelRef.current;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry?.isIntersecting) return;
      if (loadingRef.current) return;
      loadingRef.current = true;
      Promise.all([
        hasMoreChat ? loadOlderMessages("chat", 50) : Promise.resolve(0),
        hasMoreMgr ? loadOlderMessages("manager", 50) : Promise.resolve(0),
      ]).then(([chatCount, mgrCount]) => {
        if (chatCount === 0) setHasMoreChat(false);
        if (mgrCount === 0) setHasMoreMgr(false);
      }).finally(() => {
        loadingRef.current = false;
      });
    }, { rootMargin: "200px 0px 0px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMoreChat, hasMoreMgr, totalMsgs, loadOlderMessages]);

  return (
    <>
      {/* While the DB message fetch is in flight on (re)load, the store holds
          only a synchronous placeholder ([welcome] / []). Rendering it would
          flash an empty chat before real history arrives. Show a skeleton until
          messagesReady, unless the user already has real history on screen
          (e.g. mid-session) — in that case keep showing it. */}
      {!messagesReady && merged.length <= 1 && (
        <div className="px-4 py-6 space-y-3" aria-hidden data-testid="chat-loading-skeleton">
          <div className="h-3 w-2/3 rounded bg-border/20 animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-border/20 animate-pulse" />
          <div className="h-3 w-3/4 rounded bg-border/20 animate-pulse" />
        </div>
      )}
      {(messagesReady || merged.length > 1) && (hasMoreChat || hasMoreMgr) && totalMsgs > 0 && (
        <div ref={sentinelRef} aria-hidden className="h-1" data-testid="chat-load-more-sentinel" />
      )}
      {(messagesReady || merged.length > 1) && merged.map((item) => {
        if (item.kind === "chat") {
          const { msg, idx } = item;
          if (msg.hidden) return null;
          if (msg.role === "checkpoint" && msg.checkpointId) {
            if (msg.seq !== lastCheckpointSeq) return null;
            if (seenCheckpointIds.has(msg.checkpointId)) return null;
            seenCheckpointIds.add(msg.checkpointId);
          }
          const isLastAssistant =
            msg.role === "assistant" && idx === lastChatIdx;
          return msg.role === "checkpoint" ? (
            <CheckpointMarker key={`c-${msg.id}`} message={msg} />
          ) : msg.role === "user" ? (
            <MessageBubble
              key={`c-${msg.id}`}
              message={msg}
              autoApplied={autoAppliedMessageIds.has(msg.id)}
              appliedBlockIndices={
                isLastAssistant ? appliedBlockIndices : undefined
              }
            />
          ) : (
            <MessageBubble
              key={`c-${msg.id}`}
              message={msg}
              autoApplied={autoAppliedMessageIds.has(msg.id)}
              appliedBlockIndices={
                isLastAssistant ? appliedBlockIndices : undefined
              }
            />
          );
        } else {
          const { msg } = item;
          if (msg.role === "checkpoint" && msg.checkpointId) {
            if (msg.seq !== lastCheckpointSeq) return null;
            if (seenCheckpointIds.has(msg.checkpointId)) return null;
            seenCheckpointIds.add(msg.checkpointId);
            return (
              <CheckpointMarker
                key={`m-${msg.id}`}
                message={{
                  id: msg.id,
                  role: "checkpoint",
                  content: msg.content,
                  timestamp: msg.timestamp,
                  seq: msg.seq,
                  checkpointId: msg.checkpointId,
                }}
              />
            );
          }
          const isLastPlan = msg.plan && msg.id === lastPlanMsgId;
          return (
            <div key={`m-${msg.id}`} className="space-y-2">
              <ManagerMessageBubble
                message={msg}
                taskStatuses={
                  isLastPlan
                    ? taskStatuses
                    : (msg.frozenTaskStatuses ?? {})
                }
                taskFailureReasons={
                  isLastPlan
                    ? taskFailureReasons
                    : msg.frozenTaskFailureReasons
                }
                onExecute={isLastPlan ? handleExecutePlan : undefined}
                onRevise={isLastPlan ? handleRevisePlan : undefined}
                isExecuting={isLastPlan ? isExecuting : undefined}
                onStop={isLastPlan ? handleStopExecution : undefined}
                onContinueWithInput={
                  isLastPlan ? handleContinueExecution : undefined
                }
                pendingConfirmation={
                  isLastPlan ? pendingConfirmation : undefined
                }
                confirmationInput={
                  isLastPlan ? userConfirmationInput : undefined
                }
                onConfirmationInputChange={
                  isLastPlan ? setUserConfirmationInput : undefined
                }
                reviewPhase={isLastPlan ? reviewPhase : msg.frozenReviewPhase}
                holisticReview={isLastPlan ? holisticReview : undefined}
                fixCycle={isLastPlan ? fixCycle : undefined}
                liveNarration={isLastPlan ? liveNarrationText : undefined}
                completionData={isLastPlan ? completionData : undefined}
                onStartReview={isLastPlan ? handleStartReview : undefined}
                onStopReview={isLastPlan ? handleStopReview : undefined}
                reviewStrictness={isLastPlan ? reviewStrictness : undefined}
                onReviewStrictnessChange={isLastPlan ? onReviewStrictnessChange : undefined}
                reviewLiveNarration={isLastPlan ? reviewLiveNarration : undefined}
                reviewRound={isLastPlan ? reviewRound : undefined}
                reviewMaxRounds={isLastPlan ? reviewMaxRounds : undefined}
                stepActionsMap={isLastPlan ? stepActionsMap : undefined}
              />
            </div>
          );
        }
      })}
    </>
  );
}
