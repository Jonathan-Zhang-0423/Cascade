import { useState } from "react";
import {
  type ManagerPlan,
  type ManagerSubTask,
  type HolisticReviewResult,
  type ReviewPhase,
  type BuildResultData,
} from "@/stores/ide-store";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Send,
  Check,
  ChevronRight,
  ChevronDown,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  FileText,
  Hammer,
  PenLine,
  Search,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanCardLang } from "./chat-types";
import { t, usePlanCardLang, normalizeSteps } from "./chat-utils";

function StepItem({
  task,
  status,
  failureReason,
  isCompleted,
  isLast: _isLast,
  liveNarration,
}: {
  task: ManagerSubTask;
  status?: "pending" | "running" | "done" | "failed" | "needs-input" | "bug";
  failureReason?: string;
  isCompleted?: boolean;
  showNumber?: boolean;
  isLast?: boolean;
  liveNarration?: string;
}) {
  const s = status || "pending";
  const tStep = useT();
  const isRunning = s === "running";

  const statusSymbol = (() => {
    switch (s) {
      case "done": return <span className="text-[#34d68a]">✓</span>;
      case "running": return <span className="text-[#4f82ff] animate-pulse">●</span>;
      case "failed": return <span className="text-[#ef4444]">✗</span>;
      case "needs-input": return <span className="text-[#f59e0b]">?</span>;
      case "bug": return <span className="text-[#f97316]">!</span>;
      default: return <span className="text-[rgba(238,238,246,0.2)]">○</span>;
    }
  })();

  const failureReasonLabel =
    s === "failed"
      ? failureReason === "no_code"
        ? tStep("chat.noCodeOutput")
        : failureReason === "editor_error"
          ? tStep("chat.editorError")
          : null
      : null;

  return (
    <div
      className={cn(
        "flex items-start gap-2 py-[3px] font-mono text-[11.5px] leading-[1.4]",
        isRunning && "bg-[rgba(79,130,255,0.04)]",
      )}
      data-testid={`step-${task.step}`}
    >
      <span className="w-[14px] text-right text-[10px] text-[rgba(238,238,246,0.2)] shrink-0 pt-px">
        {task.step}
      </span>
      <span className="w-[14px] text-center shrink-0">{statusSymbol}</span>
      <div className="flex-1 min-w-0">
        <span
          className={cn(
            isCompleted ? "text-[rgba(238,238,246,0.3)]"
              : s === "done" ? "text-[rgba(238,238,246,0.35)]"
              : s === "failed" ? "text-[#ef4444]"
              : isRunning ? "text-[#e0e0f0] font-medium"
              : s === "needs-input" ? "text-[#f59e0b]"
              : s === "bug" ? "text-[#f97316]"
              : "text-[rgba(238,238,246,0.4)]",
          )}
        >
          {task.title}
        </span>
        {failureReasonLabel && (
          <span className="ml-2 text-[9px] text-[#ef4444]/70">
            ({failureReasonLabel})
          </span>
        )}
        {isRunning && liveNarration && (
          <div className="text-[10px] text-[rgba(238,238,246,0.35)] mt-0.5 truncate">
            {liveNarration}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReviewStatusBadge({
  phase,
  fixCycle,
  review,
  lang,
}: {
  phase: ReviewPhase;
  fixCycle: number;
  review: HolisticReviewResult | null;
  lang: PlanCardLang;
}) {
  if (phase === "idle" || phase === "building") return null;

  const issueCount = review
    ? (review.bugs?.length || 0) +
      (review.missing_features?.length || 0) +
      (review.regressions?.length || 0)
    : 0;

  const configs: Record<
    string,
    { icon: JSX.Element; text: string; color: string }
  > = {
    reviewing: {
      icon: <Search className="w-2.5 h-2.5 animate-pulse" />,
      text: t(lang, "reviewing"),
      color: "text-amber-400",
    },
    review_passed: {
      icon: <ShieldCheck className="w-2.5 h-2.5" />,
      text: review
        ? t(lang, "reviewPassedPct", { pct: review.requirement_match_percent })
        : t(lang, "reviewPassed"),
      color: "text-[#34d68a]",
    },
    review_failed: {
      icon: <AlertTriangle className="w-2.5 h-2.5" />,
      text: review
        ? t(lang, "issuesFound", { n: issueCount })
        : t(lang, "issuesFoundGeneric"),
      color: "text-[#ef4444]",
    },
    fixing: {
      icon: <Loader2 className="w-2.5 h-2.5 animate-spin" />,
      text: t(lang, "fixingIssues", { n: fixCycle }),
      color: "text-[#f97316]",
    },
  };

  const config = configs[phase];
  if (!config) return null;

  return (
    <div
      className={cn("flex items-center gap-1.5 font-mono text-[10px]", config.color)}
      data-testid="review-status-badge"
    >
      {config.icon}
      <span>{config.text}</span>
    </div>
  );
}

export function ThinkingToggle({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1">
      <button
        className="flex items-center gap-1 font-mono text-[10px] text-[rgba(238,238,246,0.3)] hover:text-[rgba(238,238,246,0.5)] transition-colors"
        onClick={() => setOpen((o) => !o)}
        data-testid="button-toggle-thinking"
      >
        {open ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
        <span className="italic">thinking</span>
      </button>
      {open && (
        <p className="mt-1 font-mono text-[10px] text-[rgba(238,238,246,0.25)] italic whitespace-pre-wrap pl-4 max-h-[150px] overflow-y-auto">
          {thinking}
        </p>
      )}
    </div>
  );
}

export function TaskPlanCard({
  plan,
  taskStatuses,
  taskFailureReasons,
  onExecute,
  onRevise,
  isExecuting,
  onStop,
  onContinueWithInput,
  pendingConfirmation,
  confirmationInput,
  onConfirmationInputChange,
  reviewPhase,
  holisticReview,
  fixCycle,
  thinking,
  liveNarration,
  completionSummary,
  changedFiles,
}: {
  plan: ManagerPlan;
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "needs-input" | "bug">;
  taskFailureReasons?: Record<string, string>;
  onExecute?: () => void;
  onRevise?: () => void;
  isExecuting?: boolean;
  onStop?: () => void;
  onContinueWithInput?: (userInput?: string) => void;
  pendingConfirmation?: { stepKey: string; items: string[] } | null;
  confirmationInput?: string;
  onConfirmationInputChange?: (value: string) => void;
  reviewPhase?: ReviewPhase;
  holisticReview?: HolisticReviewResult | null;
  fixCycle?: number;
  thinking?: string;
  liveNarration?: string;
  completionSummary?: string;
  changedFiles?: string[];
}) {
  const lang = usePlanCardLang();
  const tCard = useT();
  const steps = normalizeSteps(plan);
  const doneCount = steps.filter((s) => taskStatuses[String(s.step)] === "done").length;
  const total = steps.length;
  const allDone = doneCount === total && total > 0;
  const hasNeedsInput = steps.some((s) => taskStatuses[String(s.step)] === "needs-input");
  const phase = reviewPhase || "idle";
  const hasReviewConfirmation = !!(pendingConfirmation?.stepKey === "review" && phase === "review_failed");
  const showConfirmation = hasNeedsInput || hasReviewConfirmation;
  const isFullyComplete = phase === "review_passed" && allDone;
  const isPreExecution = doneCount === 0 && !isExecuting && !isFullyComplete && onExecute;

  const [modalOpen, setModalOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const whatAndWhy = plan.narrated_what_and_why || plan.what_and_why;
  const doneLooksLike = plan.narrated_done_looks_like || plan.done_looks_like;
  const outOfScope = plan.narrated_out_of_scope || plan.out_of_scope;
  const overview = plan.overview;

  return (
    <>
      {thinking && (
        <div className="px-3 mb-0.5">
          <ThinkingToggle thinking={thinking} />
        </div>
      )}
      <div
        className={cn(
          "mx-2.5 my-1 rounded-md border overflow-hidden",
          isFullyComplete
            ? "border-[rgba(52,214,138,0.15)] bg-[rgba(255,255,255,0.015)]"
            : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]",
        )}
        data-testid="task-plan-card"
      >
        {/* Header */}
        <div className="px-3 pt-2.5 pb-1.5">
          <div className="flex items-center gap-1.5">
            <button
              className="text-[rgba(238,238,246,0.3)] hover:text-[rgba(238,238,246,0.6)] transition-colors"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            <span className="font-mono text-[12px] font-medium text-[#e0e0f0] flex-1 min-w-0 truncate">
              {plan.summary}
            </span>
            <button
              onClick={() => setModalOpen(true)}
              className="text-[rgba(238,238,246,0.25)] hover:text-[rgba(238,238,246,0.6)] transition-colors shrink-0"
              title={t(lang, "viewPlanDoc")}
              data-testid="button-view-plan-doc"
            >
              <FileText className="w-3 h-3" />
            </button>
          </div>
          <div className="font-mono text-[10px] text-[rgba(238,238,246,0.25)] mt-0.5 pl-[18px]">
            {t(lang, "stepsDone", { done: doneCount, total })}
            {isFullyComplete && ` · ${tCard("chat.allDone")}`}
          </div>
        </div>

        {/* Steps */}
        {expanded && (
          <div className="px-3 pb-2">
            {steps.map((task: ManagerSubTask, idx: number) => {
              const isActive = taskStatuses[String(task.step)] === "running";
              return (
                <StepItem
                  key={task.step}
                  task={task}
                  status={taskStatuses[String(task.step)]}
                  failureReason={taskFailureReasons?.[String(task.step)]}
                  isCompleted={isFullyComplete}
                  showNumber
                  isLast={idx === steps.length - 1}
                  liveNarration={isActive ? liveNarration : undefined}
                />
              );
            })}
          </div>
        )}

        {/* Review status */}
        {phase !== "idle" && phase !== "building" && (
          <div className="px-3 pb-2">
            <ReviewStatusBadge
              phase={phase}
              fixCycle={fixCycle || 0}
              review={holisticReview || null}
              lang={lang}
            />
            {holisticReview && phase === "review_failed" && (
              <div className="mt-1 space-y-0.5 pl-4">
                {holisticReview.bugs?.map((bug, i) => (
                  <div key={bug.id || i} className="flex items-start gap-1">
                    <XCircle className="w-2 h-2 text-[#ef4444] mt-0.5 shrink-0" />
                    <span className="font-mono text-[9px] text-[#ef4444]/70 leading-snug">
                      [{bug.severity}] {bug.description}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Completion line */}
        {isFullyComplete && (
          <div className="px-3 pb-2">
            <div className="font-mono text-[11px] text-[#34d68a] flex items-center gap-1.5">
              <span>{tCard("chat.doneCheck")}</span>
              {changedFiles && changedFiles.length > 0 && (
                <span className="text-[rgba(238,238,246,0.35)] text-[10px]">
                  · {changedFiles.length === 1
                      ? tCard("chat.fileChanged")
                      : tCard("chat.filesChanged", { n: String(changedFiles.length) })}
                </span>
              )}
            </div>
            {completionSummary && (
              <p className="font-mono text-[10px] text-[rgba(238,238,246,0.4)] mt-1 pl-0 leading-relaxed">
                {completionSummary}
              </p>
            )}
          </div>
        )}

        {/* Confirmation input */}
        {showConfirmation && pendingConfirmation && onContinueWithInput && (
          <div className="px-3 pb-2 space-y-1.5">
            <Textarea
              placeholder={
                pendingConfirmation.stepKey === "review"
                  ? t(lang, "confirmationPlaceholder")
                  : pendingConfirmation.items[0]
              }
              value={confirmationInput || ""}
              onChange={(e) => onConfirmationInputChange?.(e.target.value)}
              className="resize-none font-mono text-[11px] min-h-[28px] max-h-[60px] bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.06)]"
              rows={1}
              data-testid="input-confirmation"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-5 text-[9px] font-mono border-[rgba(255,255,255,0.08)]"
                onClick={() => onContinueWithInput(tCard("chat.looksGood"))}
                data-testid="button-approve-all"
              >
                <Check className="w-2 h-2 mr-0.5" />
                {t(lang, "approve")}
              </Button>
              <Button
                size="sm"
                className="flex-1 h-5 text-[9px] font-mono"
                onClick={() => onContinueWithInput(confirmationInput || "")}
                disabled={!confirmationInput?.trim()}
                data-testid="button-submit-confirmation"
              >
                <Send className="w-2 h-2 mr-0.5" />
                {t(lang, "submitContinue")}
              </Button>
            </div>
          </div>
        )}

        {/* Footer: needs-input notice */}
        {(() => {
          const inputs: string[] =
            plan.needs_input || (plan as unknown as Record<string, string[]>).user_confirmation_needed || [];
          return inputs.length > 0 && inputs[0] !== "" ? (
            <div className="px-3 pb-2">
              <div className="flex items-center gap-1 font-mono text-[10px] text-[#f59e0b]">
                <AlertTriangle className="w-2.5 h-2.5" />
                <span>{t(lang, "needsInput")}</span>
              </div>
              {inputs.map((item, i) => (
                <p key={i} className="font-mono text-[10px] text-[rgba(238,238,246,0.5)] pl-4 leading-snug">
                  • {item}
                </p>
              ))}
            </div>
          ) : null;
        })()}

        {/* Footer: action buttons */}
        {!showConfirmation && (
          <div className="px-3 pb-2.5 pt-1 border-t border-[rgba(255,255,255,0.04)]">
            {isFullyComplete ? null : isExecuting ? (
              <button
                className="font-mono text-[10px] text-[#ef4444]/70 hover:text-[#ef4444] border border-[rgba(239,68,68,0.2)] rounded px-2.5 py-1 transition-colors"
                onClick={onStop}
                data-testid="button-stop-execution"
              >
                {t(lang, "stop")}
              </button>
            ) : isPreExecution ? (
              <div className="flex items-center gap-2">
                <button
                  className="font-mono text-[10px] text-[rgba(238,238,246,0.5)] hover:text-[rgba(238,238,246,0.8)] border border-[rgba(255,255,255,0.08)] rounded px-2.5 py-1 transition-colors"
                  onClick={onRevise}
                  data-testid="button-revise-plan"
                >
                  <span className="flex items-center gap-1">
                    <PenLine className="w-2.5 h-2.5" />
                    {t(lang, "revisePlan")}
                  </span>
                </button>
                <div className="flex-1" />
                <button
                  className="font-mono text-[10px] text-white bg-[#4f82ff] hover:bg-[#3a6ee8] rounded px-3 py-1 transition-colors"
                  onClick={onExecute}
                  data-testid="button-execute-plan"
                >
                  <span className="flex items-center gap-1">
                    <Hammer className="w-2.5 h-2.5" />
                    {t(lang, "buildNow")}
                  </span>
                </button>
              </div>
            ) : (
              <button
                className="font-mono text-[10px] text-white bg-[#4f82ff] hover:bg-[#3a6ee8] rounded px-3 py-1 transition-colors"
                onClick={onExecute}
                data-testid="button-execute-plan"
              >
                {t(lang, "buildNow")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Full plan modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent
          className="!fixed !inset-0 !translate-x-0 !translate-y-0 !max-w-none !w-full !h-full !rounded-none flex flex-col p-0 overflow-hidden"
          data-testid="dialog-full-plan"
        >
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-[rgba(255,255,255,0.06)] shrink-0">
            <DialogTitle className="text-sm font-mono font-medium leading-snug pr-8">
              {plan.summary}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {overview && (
              <div>
                <p className="font-mono text-[9px] text-[rgba(238,238,246,0.35)] uppercase tracking-wider mb-1">
                  {t(lang, "overview")}
                </p>
                <p className="text-[12px] text-[rgba(238,238,246,0.7)] leading-relaxed">
                  {overview}
                </p>
              </div>
            )}
            {whatAndWhy && (
              <div>
                <p className="font-mono text-[9px] text-[#4f82ff]/60 uppercase tracking-wider mb-1">
                  {t(lang, "whatAndWhy")}
                </p>
                <p className="text-[12px] text-[rgba(238,238,246,0.7)] leading-relaxed">
                  {whatAndWhy}
                </p>
              </div>
            )}
            {doneLooksLike && (
              <div>
                <p className="font-mono text-[9px] text-[#34d68a]/60 uppercase tracking-wider mb-1">
                  {t(lang, "doneLooksLike")}
                </p>
                <p className="text-[12px] text-[rgba(238,238,246,0.7)] leading-relaxed">
                  {doneLooksLike}
                </p>
              </div>
            )}
            {outOfScope && (
              <div>
                <p className="font-mono text-[9px] text-[rgba(238,238,246,0.25)] uppercase tracking-wider mb-1">
                  {t(lang, "outOfScope")}
                </p>
                <p className="text-[12px] text-[rgba(238,238,246,0.5)] leading-relaxed">
                  {outOfScope}
                </p>
              </div>
            )}
            <div className={cn((overview || whatAndWhy || doneLooksLike || outOfScope) && "border-t border-[rgba(255,255,255,0.04)] pt-4")}>
              <p className="font-mono text-[9px] text-[rgba(238,238,246,0.35)] uppercase tracking-wider mb-2">
                {t(lang, "tasks")}
              </p>
              <div className="space-y-2">
                {steps.map((step) => (
                  <div key={step.step} className="flex items-start gap-2">
                    <span className="font-mono text-[10px] text-[rgba(238,238,246,0.3)] w-4 text-right shrink-0 pt-0.5">
                      {step.step}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-[#e0e0f0]">
                        {step.title}
                      </p>
                      {step.description && (
                        <p className="text-[11px] text-[rgba(238,238,246,0.5)] mt-0.5 leading-relaxed">
                          {step.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="px-6 py-3 border-t border-[rgba(255,255,255,0.04)] shrink-0 flex gap-2">
            <button
              className="font-mono text-[10px] text-[rgba(238,238,246,0.5)] hover:text-[rgba(238,238,246,0.8)] border border-[rgba(255,255,255,0.08)] rounded px-3 py-1.5 transition-colors flex items-center gap-1"
              onClick={() => { setModalOpen(false); onRevise?.(); }}
              data-testid="button-revise-plan-modal"
            >
              <PenLine className="w-2.5 h-2.5" />
              {t(lang, "revisePlan")}
            </button>
            <div className="flex-1" />
            <button
              className="font-mono text-[10px] text-white bg-[#4f82ff] hover:bg-[#3a6ee8] rounded px-3 py-1.5 transition-colors flex items-center gap-1"
              onClick={() => { setModalOpen(false); onExecute?.(); }}
              data-testid="button-build-now-modal"
            >
              <Hammer className="w-2.5 h-2.5" />
              {t(lang, "buildNow")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BuildResultCard({
  buildResult,
}: {
  buildResult: BuildResultData;
}) {
  const { changedFiles, summary } = buildResult.completionData;
  const lang = usePlanCardLang();
  const fileCount = changedFiles.length;

  return (
    <div className="px-3.5 py-1.5 font-mono text-[11px] space-y-1" data-testid="build-result-card">
      <div className="flex items-center gap-1.5 text-[#34d68a]">
        <Check className="w-3 h-3 shrink-0" />
        <span>
          {t(lang, "completed")}
          {fileCount > 0 && (
            <span className="text-[rgba(238,238,246,0.35)] ml-1.5">
              · {fileCount} {fileCount === 1 ? "file" : "files"} changed
            </span>
          )}
        </span>
      </div>
      {summary && (
        <div className="pl-4 text-[rgba(238,238,246,0.55)] leading-relaxed whitespace-pre-wrap">
          {summary}
        </div>
      )}
    </div>
  );
}

export function ManagerMessageBubble({
  message,
  taskStatuses,
  taskFailureReasons,
  onExecute,
  onRevise,
  isExecuting,
  onStop,
  onContinueWithInput,
  pendingConfirmation,
  confirmationInput,
  onConfirmationInputChange,
  reviewPhase,
  holisticReview,
  fixCycle,
  liveNarration,
  completionData,
}: {
  message: {
    role: string;
    content: string;
    plan?: ManagerPlan;
    source?: "communicator" | "manager_raw" | "manager";
    typing?: boolean;
    thinking?: string;
    buildResult?: BuildResultData;
  };
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "needs-input" | "bug">;
  taskFailureReasons?: Record<string, string>;
  onExecute?: () => void;
  onRevise?: () => void;
  isExecuting?: boolean;
  onStop?: () => void;
  onContinueWithInput?: (userInput?: string) => void;
  pendingConfirmation?: { stepKey: string; items: string[] } | null;
  confirmationInput?: string;
  onConfirmationInputChange?: (value: string) => void;
  reviewPhase?: ReviewPhase;
  holisticReview?: HolisticReviewResult | null;
  fixCycle?: number;
  liveNarration?: string;
  completionData?: { changedFiles: string[]; summary: string } | null;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end px-3">
        <div className="rounded-md px-3 py-1.5 text-[13px] leading-relaxed bg-[rgba(79,130,255,0.08)] text-[#c8d8f0] max-w-[80%]">
          {message.content}
        </div>
      </div>
    );
  }

  if ((message as any).buildResult) {
    return <BuildResultCard buildResult={(message as any).buildResult} />;
  }

  if (message.plan) {
    return (
      <TaskPlanCard
        plan={message.plan}
        taskStatuses={taskStatuses}
        taskFailureReasons={taskFailureReasons}
        onExecute={onExecute}
        onRevise={onRevise}
        isExecuting={isExecuting}
        onStop={onStop}
        onContinueWithInput={onContinueWithInput}
        pendingConfirmation={pendingConfirmation}
        confirmationInput={confirmationInput}
        onConfirmationInputChange={onConfirmationInputChange}
        reviewPhase={reviewPhase}
        holisticReview={holisticReview}
        fixCycle={fixCycle}
        thinking={message.thinking}
        liveNarration={liveNarration}
        completionSummary={completionData?.summary}
        changedFiles={completionData?.changedFiles}
      />
    );
  }

  if (message.source === "manager_raw") {
    return null;
  }

  if (!message.content) return null;

  return (
    <div
      className="px-3.5 py-1 font-mono text-[12px] leading-[1.6] text-[rgba(238,238,246,0.65)]"
      data-testid="manager-narration-bubble"
    >
      {message.content}
    </div>
  );
}
