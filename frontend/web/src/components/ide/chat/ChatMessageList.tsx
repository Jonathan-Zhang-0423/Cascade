import type { ChatMessage, ManagerMessage } from "@/stores/ide-store";
import { useIDEStore } from "@/stores/ide-store";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ActionLogEntry } from "./chat-types";
import {
  MessageBubble,
  CheckpointMarker,
} from "./message-components";
import { ManagerMessageBubble, BuildResultCard } from "./plan-components";
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
  fixCycle: number;
  liveNarrationText?: string;
  completionData?: { changedFiles: string[]; summary: string } | null;
  handleExecutePlan?: () => void;
  handleRevisePlan?: (note?: string) => void;
  handleStopExecution?: () => void;
  handleContinueExecution?: (input?: string) => void;
  setUserConfirmationInput?: (v: string) => void;
}

export function shouldUseLivePlanStatuses(
  message: { id: string; plan?: unknown; frozenTaskStatuses?: unknown },
  lastPlanMsgId?: string,
): boolean {
  return Boolean(message.plan && message.id === lastPlanMsgId && !message.frozenTaskStatuses);
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
  fixCycle,
  liveNarrationText,
  completionData,
  handleExecutePlan,
  handleRevisePlan,
  handleStopExecution,
  handleContinueExecution,
  setUserConfirmationInput,
}: ChatMessageListProps) {
  // ── Subscribe to live actionLog at the list level (correct slot, single instance) ──
  const projectId = useIDEStore((st) => st.projectId);
  const currentSessionId = useIDEStore((st) => st.currentSessionId);
  const slot = projectId ? streamRegistry.get(projectId, currentSessionId) : null;
  const liveActionLog = useSyncExternalStore<ActionLogEntry[]>(
    slot ? slot.build.state.subscribe : (() => () => {}),
    slot ? () => slot.build.state.getSnapshot().actionLog : () => [],
  );

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
          ) : (msg as any).buildResult ? (
            <BuildResultCard key={`c-${msg.id}`} buildResult={(msg as any).buildResult} />
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
          // A card that already has frozen statuses is finished — always show its
          // frozen snapshot, never the live taskStatuses. Otherwise a later build
          // (especially a direct build, which adds a buildResult instead of a new
          // plan card so this stale card stays "lastPlan") would bleed its live
          // "running" status onto this completed card's step 1.
          const useLiveStatuses = shouldUseLivePlanStatuses(msg, lastPlanMsgId);
          return (
            <div key={`m-${msg.id}`} className="space-y-2">
              <ManagerMessageBubble
                message={msg}
                taskStatuses={
                  useLiveStatuses
                    ? taskStatuses
                    : (msg.frozenTaskStatuses ?? {})
                }
                taskFailureReasons={
                  useLiveStatuses
                    ? taskFailureReasons
                    : msg.frozenTaskFailureReasons
                }
                onExecute={useLiveStatuses ? handleExecutePlan : undefined}
                onRevise={useLiveStatuses ? handleRevisePlan : undefined}
                isExecuting={useLiveStatuses ? isExecuting : undefined}
                onStop={useLiveStatuses ? handleStopExecution : undefined}
                onContinueWithInput={
                  useLiveStatuses ? handleContinueExecution : undefined
                }
                pendingConfirmation={
                  useLiveStatuses ? pendingConfirmation : undefined
                }
                confirmationInput={
                  useLiveStatuses ? userConfirmationInput : undefined
                }
                onConfirmationInputChange={
                  useLiveStatuses ? setUserConfirmationInput : undefined
                }
                fixCycle={useLiveStatuses ? fixCycle : undefined}
                liveNarration={useLiveStatuses ? liveNarrationText : undefined}
                completionData={useLiveStatuses ? completionData : undefined}
                liveActionLog={useLiveStatuses ? liveActionLog : undefined}
              />
            </div>
          );
        }
      })}
    </>
  );
}
