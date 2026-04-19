import type { ChatMessage, ManagerMessage, HolisticReviewResult, ReviewPhase } from "@/stores/ide-store";
import type { ActionLogEntry } from "./chat-types";
import { ActionLogCollapsed } from "./action-log";
import {
  MessageBubble,
  CheckpointMarker,
  BuildCompletionCard,
} from "./message-components";
import { ManagerMessageBubble } from "./plan-components";

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
  handleExecutePlan?: () => void;
  handleRevisePlan?: () => void;
  handleStopExecution?: () => void;
  handleContinueExecution?: (input?: string) => void;
  setUserConfirmationInput?: (v: string) => void;
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
  handleExecutePlan,
  handleRevisePlan,
  handleStopExecution,
  handleContinueExecution,
  setUserConfirmationInput,
}: ChatMessageListProps) {
  const lastPlanMsgId = [...managerMessages]
    .reverse()
    .find((m) => m.plan)?.id;
  const lastChatIdx = chatMessages.length - 1;
  type MergedItem =
    | { kind: "chat"; msg: ChatMessage; idx: number; order: number }
    | { kind: "manager"; msg: ManagerMessage; order: number };
  const merged: MergedItem[] = [
    ...chatMessages.map((msg, idx) => ({
      kind: "chat" as const,
      msg,
      idx,
      order: idx,
    })),
    ...managerMessages.map((msg, idx) => ({
      kind: "manager" as const,
      msg,
      order: idx,
    })),
  ].sort(
    (a, b) => a.msg.seq - b.msg.seq || a.order - b.order,
  );

  const seenCheckpointIds = new Set<string>();

  return (
    <>
      {merged.map((item) => {
        if (item.kind === "chat") {
          const { msg, idx } = item;
          if (msg.hidden) return null;
          if (msg.role === "checkpoint" && msg.checkpointId) {
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
            <div
              key={`c-${msg.id}`}
              className="mx-2 px-3 py-2 rounded-lg border-l-4 border-l-[#4f82ff] bg-[rgba(79,130,255,0.02)] border border-[rgba(79,130,255,0.1)]"
            >
              <MessageBubble
                message={msg}
                autoApplied={autoAppliedMessageIds.has(msg.id)}
                appliedBlockIndices={
                  isLastAssistant ? appliedBlockIndices : undefined
                }
              />
            </div>
          );
        } else {
          const { msg } = item;
          if (msg.role === "checkpoint" && msg.checkpointId) {
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
          if (msg.buildResult && !msg.plan) {
            return (
              <div key={`m-${msg.id}`} className="space-y-2">
                {msg.buildResult.actionLog.length > 0 && (
                  <div className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden">
                    <ActionLogCollapsed
                      entries={
                        msg.buildResult.actionLog as ActionLogEntry[]
                      }
                    />
                  </div>
                )}
                <BuildCompletionCard
                  changedFiles={
                    msg.buildResult.completionData.changedFiles
                  }
                  userLang={msg.buildResult.completionData.userLang || "English"}
                  summary={msg.buildResult.completionData.summary}
                />
              </div>
            );
          }
          const isLastPlan = msg.plan && msg.id === lastPlanMsgId;
          return (
            <div key={`m-${msg.id}`} className="space-y-2">
              <div className="mx-2 px-3 py-2 rounded-lg border-l-4 border-l-[#4f82ff] bg-[rgba(79,130,255,0.02)] border border-[rgba(79,130,255,0.1)]">
                <ManagerMessageBubble
                  message={msg}
                  taskStatuses={isLastPlan ? taskStatuses : {}}
                  taskFailureReasons={
                    isLastPlan ? taskFailureReasons : undefined
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
                  reviewPhase={isLastPlan ? reviewPhase : undefined}
                  holisticReview={isLastPlan ? holisticReview : undefined}
                  fixCycle={isLastPlan ? fixCycle : undefined}
                />
              </div>
              {msg.buildResult && (
                <>
                  {msg.buildResult.actionLog.length > 0 && (
                    <div className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden">
                      <ActionLogCollapsed
                        entries={
                          msg.buildResult.actionLog as ActionLogEntry[]
                        }
                      />
                    </div>
                  )}
                  <BuildCompletionCard
                    changedFiles={
                      msg.buildResult.completionData.changedFiles
                    }
                    userLang={msg.buildResult.completionData.userLang || "English"}
                    summary={msg.buildResult.completionData.summary}
                  />
                </>
              )}
            </div>
          );
        }
      })}
    </>
  );
}
