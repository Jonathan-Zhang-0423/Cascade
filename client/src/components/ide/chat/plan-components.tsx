import { useState, useRef, useEffect } from "react";
import {
  type ManagerPlan,
  type ManagerSubTask,
  type HolisticReviewResult,
  type ReviewPhase,
  type BuildResultData,
} from "@/stores/ide-store";
import { useT } from "@/lib/i18n";
import { ActionLogCollapsed } from "./action-log";
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
  Loader2,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  StopCircle,
  HelpCircle,
  ShieldCheck,
  FileText,
  Hammer,
  PenLine,
  Play,
  Search,
  Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanCardLang } from "./chat-types";
import { t, usePlanCardLang, normalizeSteps } from "./chat-utils";

function StepItem({
  task,
  status,
  failureReason,
  isCompleted,
  showNumber,
  isLast,
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
  const isDone = s === "done";
  const statusDotEl = (() => {
    switch (s) {
      case "done":
        return (
          <div
            className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
            style={{
              background: "#2d6a4a",
              border: "1px solid rgba(52,214,138,0.35)",
              boxShadow: !isCompleted ? "0 0 8px rgba(52,214,138,0.25)" : "none",
              ...((!isCompleted) ? { animation: "step-complete 200ms var(--transition-spring)" } : {}),
            }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <polyline points="1.5,4.5 3.5,6.5 7.5,2.5" stroke="#34d68a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        );
      case "running":
        return (
          <div
            className="w-4 h-4 rounded-full border-2 border-[#4f82ff] bg-[#0d1422] flex items-center justify-center shrink-0"
            style={isRunning ? { animation: "step-pulse 1.5s ease-in-out infinite" } : {}}
          >
            <div className="w-[6px] h-[6px] rounded-full bg-[#4f82ff]" />
          </div>
        );
      case "failed":
        return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
      case "needs-input":
        return <HelpCircle className="w-4 h-4 text-yellow-500 shrink-0" />;
      case "bug":
        return <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />;
      default: // pending
        return (
          <div className="w-4 h-4 rounded-full border border-[rgba(255,255,255,0.07)] bg-transparent shrink-0" />
        );
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
        "flex gap-[10px] items-start py-[6px] px-[6px] rounded-md -mx-1.5",
        "transition-all",
        isRunning && "bg-[rgba(79,130,255,0.08)] border-l-2 border-l-[#4f82ff] pl-[8px]",
      )}
      style={isRunning ? { boxShadow: "0 2px 8px rgba(0,0,0,0.3)" } : {}}
      data-testid={`step-${task.step}`}
    >
      {/* Dot + connector column */}
      <div className="flex flex-col items-center shrink-0" style={{ marginTop: 2 }}>
        {statusDotEl}
        {!isLast && (
          <div className="w-px bg-[rgba(255,255,255,0.07)] mt-[3px]" style={{ height: 18 }} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center flex-wrap gap-x-2">
          {showNumber && (
            <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0 w-4 text-right leading-none">
              {task.step}.
            </span>
          )}
          <span
            className={cn(
              "text-[12px] leading-snug flex-1",
              isCompleted
                ? "text-[#2e2e42]"
                : isDone
                  ? "text-[#484860]"
                  : s === "failed"
                    ? "text-red-400"
                    : isRunning
                      ? "text-[#eeeef6] font-medium"
                      : s === "needs-input"
                        ? "text-yellow-500"
                        : s === "bug"
                          ? "text-orange-500"
                          : "text-[#2e2e42]",
            )}
          >
            {task.title}
          </span>
          {failureReasonLabel && (
            <span
              className="text-[10px] bg-red-500/15 text-red-400 border border-red-500/30 rounded px-1.5 py-0.5 shrink-0"
              data-testid={`step-failure-reason-${task.step}`}
            >
              {failureReasonLabel}
            </span>
          )}
        </div>
        {isRunning && liveNarration && (
          <div className="text-[11px] text-[#6868a0] mt-0.5 font-mono truncate">
            {liveNarration}<span className="inline-block w-[1ch] animate-pulse">▋</span>
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
      icon: <Search className="w-3 h-3 animate-pulse" />,
      text: t(lang, "reviewing"),
      color: "text-amber-400",
    },
    review_passed: {
      icon: <ShieldCheck className="w-3 h-3" />,
      text: review
        ? t(lang, "reviewPassedPct", { pct: review.requirement_match_percent })
        : t(lang, "reviewPassed"),
      color: "text-green-500",
    },
    review_failed: {
      icon: <AlertTriangle className="w-3 h-3" />,
      text: review
        ? t(lang, "issuesFound", { n: issueCount })
        : t(lang, "issuesFoundGeneric"),
      color: "text-red-400",
    },
    fixing: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      text: t(lang, "fixingIssues", { n: fixCycle }),
      color: "text-orange-400",
    },
  };

  const config = configs[phase];
  if (!config) return null;

  return (
    <div
      className={cn("px-3 pb-2 flex items-center gap-1.5", config.color)}
      data-testid="review-status-badge"
    >
      {config.icon}
      <span className="text-[10px] font-medium">{config.text}</span>
    </div>
  );
}

export function ThinkingToggle({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5">
      <button
        className="flex items-center gap-1 text-[12px] text-[#6868a0]/70 hover:text-[#6868a0] transition-colors"
        onClick={() => setOpen((o) => !o)}
        data-testid="button-toggle-thinking"
      >
        {open ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span className="italic">思考过程</span>
      </button>
      {open && (
        <p
          className="mt-1 text-muted-foreground/50 italic whitespace-pre-wrap text-[11px] border-l-2 border-muted/30 pl-2"
          data-testid="text-thinking-content"
        >
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
  taskStatuses: Record<
    string,
    "pending" | "running" | "done" | "failed" | "needs-input" | "bug"
  >;
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
  const doneCount = steps.filter(
    (s) => taskStatuses[String(s.step)] === "done",
  ).length;
  const total = steps.length;
  const allDone = doneCount === total && total > 0;
  const hasNeedsInput = steps.some(
    (s) => taskStatuses[String(s.step)] === "needs-input",
  );
  const phase = reviewPhase || "idle";
  const hasReviewConfirmation = !!(
    pendingConfirmation?.stepKey === "review" && phase === "review_failed"
  );
  const showConfirmation = hasNeedsInput || hasReviewConfirmation;
  const isFullyComplete = phase === "review_passed" && allDone;
  const isPreExecution =
    doneCount === 0 && !isExecuting && !isFullyComplete && onExecute;

  const [modalOpen, setModalOpen] = useState(false);

  // Track execution elapsed time (for future use)
  const executionStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (isExecuting && executionStartRef.current === null) {
      executionStartRef.current = Date.now();
    }
    if (!isExecuting && executionStartRef.current !== null && isFullyComplete) {
      executionStartRef.current = null;
    }
  }, [isExecuting, isFullyComplete]);

  const whatAndWhy = plan.narrated_what_and_why || plan.what_and_why;
  const doneLooksLike = plan.narrated_done_looks_like || plan.done_looks_like;
  const outOfScope = plan.narrated_out_of_scope || plan.out_of_scope;
  const overview = plan.overview;
  const hasRichSections = !!(
    overview ||
    whatAndWhy ||
    doneLooksLike ||
    outOfScope
  );

  // Determine phase states
  const buildingPhaseStatus = isExecuting ? "active" : isFullyComplete ? "done" : "pending";
  const verifyingPhaseStatus = phase === "reviewing" || phase === "fixing" ? "active" : phase === "review_passed" ? "done" : phase === "review_failed" ? "failed" : "pending";
  const showVerifyPhase = phase !== "idle" && phase !== "building";

  // Helper to render phase dot
  const renderPhaseDot = (status: "active" | "done" | "pending" | "failed") => {
    switch (status) {
      case "done":
        return (
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: "#34d68a" }}
          />
        );
      case "active":
        return (
          <div
            className="w-2 h-2 rounded-full shrink-0 animate-pulse"
            style={{ background: "#4f82ff" }}
          />
        );
      case "failed":
        return (
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: "#ef4444" }}
          />
        );
      default: // pending
        return (
          <div
            className="w-2 h-2 rounded-full shrink-0 border border-[rgba(255,255,255,0.1)]"
            style={{ background: "transparent" }}
          />
        );
    }
  };

  // Helper to render connecting line
  const renderLine = (show: boolean) => show ? (
    <div className="w-px flex-1 min-h-[8px] bg-[rgba(255,255,255,0.05)]" />
  ) : null;

  return (
    <>
      {thinking && (
        <div className="px-3 mb-0.5">
          <ThinkingToggle thinking={thinking} />
        </div>
      )}
      <div
        className={cn(
          "mx-3 my-1 rounded-lg border overflow-hidden",
          isFullyComplete
            ? "border-green-500/30 bg-card/30"
            : "border-border/40 bg-card/50",
        )}
        data-testid="task-plan-card"
      >
        {/* Spine timeline */}
        <div className="flex gap-3 px-3 py-3">
          {/* Left rail with dots and lines */}
          <div className="flex flex-col items-center shrink-0" style={{ marginTop: 2 }}>
            {/* Planning phase dot */}
            {renderPhaseDot("done")}
            {renderLine(true)}

            {/* Building phase dot */}
            {renderPhaseDot(buildingPhaseStatus)}
            {renderLine(showVerifyPhase)}

            {/* Verifying phase dot (hidden if not applicable) */}
            {showVerifyPhase && (
              <>
                {renderPhaseDot(verifyingPhaseStatus)}
                {renderLine(isFullyComplete)}
              </>
            )}

            {/* Done phase dot */}
            {isFullyComplete && renderPhaseDot("done")}
          </div>

          {/* Right content column */}
          <div className="flex-1 min-w-0">
            {/* ─── Planning phase ─── */}
            <div className="mb-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-[9.5px] font-mono text-[#484860] uppercase tracking-wider">
                  Planning
                </p>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12.5px] font-medium text-[#b0b0c8] leading-snug">
                  {plan.summary}
                </p>
                <button
                  onClick={() => setModalOpen(true)}
                  className="p-0.5 rounded hover:bg-[rgba(255,255,255,0.06)] transition-colors text-[#8888a8] hover:text-foreground shrink-0"
                  title={t(lang, "viewPlanDoc")}
                  data-testid="button-view-plan-doc"
                >
                  <FileText className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[9.5px] text-[#484860] mt-1">
                {total} steps
              </p>

              {/* Collapsed rich sections (What & Why, Done Looks Like) */}
              {hasRichSections && (
                <div className="mt-2 space-y-1 text-[11px] text-foreground/70">
                  {whatAndWhy && (
                    <div className="flex items-start gap-1">
                      <Lightbulb className="w-2.5 h-2.5 text-[#4f82ff] mt-0.5 shrink-0" />
                      <span className="line-clamp-1">{whatAndWhy}</span>
                    </div>
                  )}
                  {doneLooksLike && (
                    <div className="flex items-start gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5 text-[#34d68a] mt-0.5 shrink-0" />
                      <span className="line-clamp-1">{doneLooksLike}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ─── Building phase ─── */}
            <div className="mb-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-[9.5px] font-mono text-[buildingPhaseStatus === 'active' ? '#4f82ff' : isFullyComplete ? '#34d68a' : '#3a3a58'] uppercase tracking-wider">
                  Building
                </p>
              </div>

              {/* Steps box */}
              <div className="bg-[#0e0e1a] border border-[rgba(255,255,255,0.07)] rounded-lg overflow-hidden">
                <div className="space-y-0">
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
              </div>

              {/* Confirmation input (if needed, inside Building phase) */}
              {showConfirmation && pendingConfirmation && onContinueWithInput && (
                <div className="mt-2 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-2">
                  <Textarea
                    placeholder={
                      pendingConfirmation.stepKey === "review"
                        ? t(lang, "confirmationPlaceholder")
                        : pendingConfirmation.items[0]
                    }
                    value={confirmationInput || ""}
                    onChange={(e) => onConfirmationInputChange?.(e.target.value)}
                    className="resize-none text-[12px] min-h-[60px]"
                  />
                  <div className="flex gap-2 mt-1.5">
                    <Button
                      size="sm"
                      onClick={() =>
                        onContinueWithInput?.(confirmationInput)
                      }
                      className="h-7 text-[11px]"
                      data-testid="button-submit-confirmation"
                    >
                      {t(lang, "submitInput")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        onContinueWithInput?.("")
                      }
                      className="h-7 text-[11px]"
                    >
                      {t(lang, "skip")}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* ─── Verifying phase ─── */}
            {showVerifyPhase && (
              <div className="mb-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className={cn(
                    "text-[9.5px] font-mono uppercase tracking-wider",
                    verifyingPhaseStatus === "active" ? "text-[#4f82ff]" : verifyingPhaseStatus === "done" ? "text-[#34d68a]" : verifyingPhaseStatus === "failed" ? "text-red-400" : "text-[#3a3a58]"
                  )}>
                    Verifying
                  </p>
                </div>

                <ReviewStatusBadge
                  phase={phase}
                  fixCycle={fixCycle || 0}
                  review={holisticReview || null}
                  lang={lang}
                />

                {holisticReview && phase === "review_failed" && (
                  <div className="mt-2 space-y-1">
                    {holisticReview.bugs?.map((bug, i) => (
                      <div key={bug.id || i} className="flex items-start gap-1.5">
                        <XCircle className="w-2.5 h-2.5 text-red-400 mt-0.5 shrink-0" />
                        <span className="text-[10px] text-red-400/80 leading-snug">
                          <span className="font-medium">[{bug.severity}]</span> {bug.description}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ─── Done phase ─── */}
            {isFullyComplete && (
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-[9.5px] font-mono text-[#34d68a] uppercase tracking-wider">
                    Done
                  </p>
                </div>

                {/* File chips */}
                {changedFiles && changedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {changedFiles.map((f, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-mono text-[#34d68a] bg-[rgba(52,214,138,0.08)] border border-[rgba(52,214,138,0.2)]"
                        data-testid={`completion-file-chip-${i}`}
                      >
                        <Check className="w-2.5 h-2.5" />
                        {f.split("/").pop() || f}
                      </span>
                    ))}
                  </div>
                )}

                {/* Summary */}
                {completionSummary && (
                  <p className="text-[11px] text-[rgba(238,238,246,0.55)] leading-relaxed">
                    {completionSummary}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer: needs-input notice */}
        {(() => {
          const inputs: string[] =
            plan.needs_input || (plan as unknown as Record<string, string[]>).user_confirmation_needed || [];
          return inputs.length > 0 && inputs[0] !== "" ? (
            <div className="px-3 py-2 border-t border-border/30">
              <div className="flex items-center gap-1 mb-0.5">
                <AlertTriangle className="w-3 h-3 text-yellow-500" />
                <span className="text-[10px] font-medium text-yellow-500">
                  {t(lang, "needsInput")}
                </span>
              </div>
              {inputs.map((item, i) => (
                <p
                  key={i}
                  className="text-[11px] text-foreground/70 pl-4 leading-snug"
                >
                  • {item}
                </p>
              ))}
            </div>
          ) : null;
        })()}

        {/* Footer: confirmation input */}
        {showConfirmation && pendingConfirmation && onContinueWithInput && (
          <div className="px-3 py-2 border-t border-border/30 space-y-1.5">
            <Textarea
              placeholder={
                pendingConfirmation.stepKey === "review"
                  ? t(lang, "confirmationPlaceholder")
                  : pendingConfirmation.items[0]
              }
              value={confirmationInput || ""}
              onChange={(e) => onConfirmationInputChange?.(e.target.value)}
              className="resize-none text-[11px] min-h-[32px] max-h-[60px] bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.08)]"
              rows={1}
              data-testid="input-confirmation"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-6 text-[10px]"
                onClick={() => onContinueWithInput(tCard("chat.looksGood"))}
                data-testid="button-approve-all"
              >
                <Check className="w-2.5 h-2.5 mr-0.5" />
                {t(lang, "approve")}
              </Button>
              <Button
                size="sm"
                className="flex-1 h-6 text-[10px]"
                onClick={() => onContinueWithInput(confirmationInput || "")}
                disabled={!confirmationInput?.trim()}
                data-testid="button-submit-confirmation"
              >
                <Send className="w-2.5 h-2.5 mr-0.5" />
                {t(lang, "submitContinue")}
              </Button>
            </div>
          </div>
        )}

        {/* Footer: action buttons */}
        {!showConfirmation && (
          <div className="px-3 py-2 border-t border-border/30">
            {isFullyComplete ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full h-7 text-[11px] border-green-500/30 text-green-500 cursor-default pointer-events-none"
                disabled
                data-testid="button-plan-completed"
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {t(lang, "completed")}
              </Button>
            ) : isExecuting ? (
              <Button
                size="sm"
                variant="destructive"
                className="w-full h-7 text-[11px]"
                onClick={onStop}
                data-testid="button-stop-execution"
              >
                <StopCircle className="w-3 h-3 mr-1" />
                {t(lang, "stop")}
              </Button>
            ) : isPreExecution ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1.5"
                  onClick={onRevise}
                  data-testid="button-revise-plan"
                >
                  <PenLine className="w-3 h-3" />
                  {t(lang, "revisePlan")}
                </Button>
                <div className="flex-1" />
                <Button
                  size="sm"
                  className="h-7 text-[11px] gap-1.5"
                  onClick={onExecute}
                  data-testid="button-execute-plan"
                >
                  <Hammer className="w-3 h-3" />
                  {t(lang, "buildNow")}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                className="w-full h-7 text-[11px]"
                onClick={onExecute}
                data-testid="button-execute-plan"
              >
                <Play className="w-3 h-3 mr-1" />
                {t(lang, "startBuilding")}
              </Button>
            )}
          </div>
        )}

      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent
          className="!fixed !inset-0 !translate-x-0 !translate-y-0 !max-w-none !w-full !h-full !rounded-none flex flex-col p-0 overflow-hidden"
          data-testid="dialog-full-plan"
        >
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/30 shrink-0">
            <DialogTitle className="text-base font-semibold leading-snug pr-8">
              {plan.summary}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {overview && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1.5">
                  {t(lang, "overview")}
                </p>
                <p className="text-[13px] text-foreground/80 leading-relaxed">
                  {overview}
                </p>
              </div>
            )}
            {whatAndWhy && (
              <div>
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1.5">
                  {t(lang, "whatAndWhy")}
                </p>
                <p className="text-[13px] text-foreground/80 leading-relaxed">
                  {whatAndWhy}
                </p>
              </div>
            )}
            {doneLooksLike && (
              <div>
                <p className="text-[10px] font-semibold text-green-500/70 uppercase tracking-wide mb-1.5">
                  {t(lang, "doneLooksLike")}
                </p>
                <p className="text-[13px] text-foreground/80 leading-relaxed">
                  {doneLooksLike}
                </p>
              </div>
            )}
            {outOfScope && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1.5">
                  {t(lang, "outOfScope")}
                </p>
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  {outOfScope}
                </p>
              </div>
            )}
            <div
              className={cn(
                (overview || whatAndWhy || doneLooksLike || outOfScope) &&
                  "border-t border-border/30 pt-4",
              )}
            >
              <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">
                {t(lang, "tasks")}
              </p>
              <div className="space-y-3">
                {steps.map((step) => (
                  <div key={step.step} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] text-[#8888a8] font-medium">
                        {step.step}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-foreground">
                        {step.title}
                      </p>
                      {step.description && (
                        <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
                          {step.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="px-6 py-4 border-t border-border/30 shrink-0 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => {
                setModalOpen(false);
                onRevise?.();
              }}
              data-testid="button-revise-plan-modal"
            >
              <PenLine className="w-3 h-3" />
              {t(lang, "revisePlan")}
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => {
                setModalOpen(false);
                onExecute?.();
              }}
              data-testid="button-build-now-modal"
            >
              <Hammer className="w-3 h-3" />
              {t(lang, "buildNow")}
            </Button>
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
  const [expanded, setExpanded] = useState(false);
  const { changedFiles } = buildResult.completionData;
  const summary = buildResult.completionData.summary || "";
  const fileChips = changedFiles.slice(0, 3);
  const extraCount = changedFiles.length - 3;

  return (
    <div className="mx-3">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left"
        style={{
          background: "#141420",
          border: "1px solid #2a2a3a",
          borderRadius: "8px",
        }}
        onClick={() => setExpanded((e) => !e)}
        data-testid="build-result-card"
      >
        <span className="text-[#4a8a4a] text-[13px] shrink-0">✓</span>
        <span className="flex-1 min-w-0 text-[12px] text-foreground/70 truncate">
          <strong className="text-foreground/90">{summary || "Build complete"}</strong>
          {changedFiles.length > 0 && (
            <span className="text-muted-foreground/50"> · {changedFiles.length} file{changedFiles.length !== 1 ? "s" : ""}</span>
          )}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {fileChips.map((f, i) => (
            <span
              key={i}
              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: "#1a2a1a",
                border: "1px solid #2a4a2a",
                color: "#6a9a6a",
              }}
            >
              {f.split("/").pop()}
            </span>
          ))}
          {extraCount > 0 && (
            <span className="text-[9px] text-muted-foreground/50">+{extraCount}</span>
          )}
          <ChevronRight
            className={cn("w-3 h-3 text-muted-foreground/40 transition-transform", expanded && "rotate-90")}
          />
        </div>
      </button>
      {expanded && (
        <div className="mt-1 px-3 py-2 rounded-lg border border-border/20 bg-card/20 space-y-1">
          <ActionLogCollapsed entries={buildResult.actionLog as any} />
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
  taskStatuses: Record<
    string,
    "pending" | "running" | "done" | "failed" | "needs-input" | "bug"
  >;
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
        <div className="rounded-lg px-3.5 py-1.5 text-[13px] leading-relaxed bg-[#1a1a2e] text-foreground max-w-[85%]">
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
      className="mx-3 my-1 text-[13px] leading-[1.65] text-foreground/80 pl-3 border-l-2 border-border/20"
      data-testid="manager-narration-bubble"
    >
      {message.content}
    </div>
  );
}
