import { useState, useRef, useEffect } from "react";
import {
  type ManagerPlan,
  type ManagerSubTask,
  type HolisticReviewResult,
  type ReviewPhase,
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
  FileCode,
  Loader2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
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
import { PREVIEW_STEP_COUNT } from "./chat-types";
import { t, usePlanCardLang, normalizeSteps, renderMarkdown } from "./chat-utils";

function StepItem({
  task,
  status,
  failureReason,
  isCompleted,
  showNumber,
  isLast,
}: {
  task: ManagerSubTask;
  status?: "pending" | "running" | "done" | "failed" | "needs-input" | "bug";
  failureReason?: string;
  isCompleted?: boolean;
  showNumber?: boolean;
  isLast?: boolean;
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
      <div className="flex-1 flex items-center flex-wrap gap-x-2 min-w-0">
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
        {isRunning && (
          <span
            className="text-[10px] text-[#4f82ff] border border-[rgba(79,130,255,0.25)] rounded px-1.5 py-0.5 shrink-0 font-medium"
            style={{ animation: "badge-pulse 1.5s ease-in-out infinite" }}
            data-testid={`step-building-${task.step}`}
          >
            Building…
          </span>
        )}
        {failureReasonLabel && (
          <span
            className="text-[10px] bg-red-500/15 text-red-400 border border-red-500/30 rounded px-1.5 py-0.5 shrink-0"
            data-testid={`step-failure-reason-${task.step}`}
          >
            {failureReasonLabel}
          </span>
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
        className="flex items-center gap-1 text-[12px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        onClick={() => setOpen((o) => !o)}
        data-testid="button-toggle-thinking"
      >
        {open ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span className="italic font-medium">(Thinking)</span>
      </button>
      {open && (
        <p
          className="mt-1 text-muted-foreground/60 italic whitespace-pre-wrap text-[12px] border-l-2 border-muted pl-2"
          data-testid="text-thinking-content"
        >
          {thinking}
        </p>
      )}
    </div>
  );
}

const NARRATION_TRUNCATE_LINES = 15;
const NARRATION_TRUNCATE_CHARS = 600;

export function NarrationBubble({
  message,
}: {
  message: {
    role: string;
    content: string;
    source?: "communicator" | "manager_raw" | "manager";
    thinking?: string;
    typing?: boolean;
  };
}) {
  const [expanded, setExpanded] = useState(false);

  const content = message.content || "";
  const lines = content.split("\n");
  const needsTruncation =
    lines.length > NARRATION_TRUNCATE_LINES || content.length > NARRATION_TRUNCATE_CHARS;
  const showFull = !needsTruncation || expanded;

  let displayContent = content;
  if (!showFull) {
    const truncatedLines = lines.slice(0, NARRATION_TRUNCATE_LINES);
    displayContent = truncatedLines.join("\n");
    if (displayContent.length > NARRATION_TRUNCATE_CHARS) {
      displayContent = displayContent.slice(0, NARRATION_TRUNCATE_CHARS);
    }
    displayContent += "…";
  }

  return (
    <div
      className="my-1 text-[13px] leading-relaxed text-foreground"
      style={{
        paddingLeft: '12px',
        marginLeft: '12px',
        marginRight: '12px',
        borderLeft: '2px solid rgba(255,255,255,0.06)',
      }}
      data-testid="plan-message-bubble"
    >
      {message.thinking && <ThinkingToggle thinking={message.thinking} />}
      {content && (
        <>
          <div className="text-foreground/90">
            {renderMarkdown(displayContent)}
          </div>
          {needsTruncation && (
            <button
              className="text-[11px] text-primary/70 hover:text-primary transition-colors mt-1"
              onClick={() => setExpanded((e) => !e)}
              data-testid="button-toggle-narration"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
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

  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Track execution elapsed time
  const executionStartRef = useRef<number | null>(null);
  const [elapsedLabel, setElapsedLabel] = useState<string | null>(null);
  useEffect(() => {
    if (isExecuting && executionStartRef.current === null) {
      executionStartRef.current = Date.now();
    }
    if (!isExecuting && executionStartRef.current !== null && isFullyComplete) {
      const secs = Math.round((Date.now() - executionStartRef.current) / 1000);
      if (secs < 60) {
        setElapsedLabel(secs <= 1 ? "1 second" : `${secs} seconds`);
      } else {
        const mins = Math.round(secs / 60);
        setElapsedLabel(mins === 1 ? "1 minute" : `${mins} minutes`);
      }
    }
  }, [isExecuting, isFullyComplete]);

  const hasMore = steps.length > PREVIEW_STEP_COUNT;
  const visibleSteps =
    isPreExecution && !stepsExpanded
      ? steps.slice(0, PREVIEW_STEP_COUNT)
      : steps;
  const peekSteps =
    isPreExecution && hasMore && !stepsExpanded
      ? steps.slice(PREVIEW_STEP_COUNT, PREVIEW_STEP_COUNT + 2)
      : [];

  const whatAndWhy = plan.narrated_what_and_why || plan.what_and_why;
  const doneLooksLike = plan.narrated_done_looks_like || plan.done_looks_like;
  const outOfScope = plan.narrated_out_of_scope || plan.out_of_scope;
  const overview = plan.overview;
  const relevantFiles = plan.relevant_files;
  const hasRichSections = !!(
    overview ||
    whatAndWhy ||
    doneLooksLike ||
    outOfScope
  );

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
        {hasRichSections ? (
          <>
            <div className="px-3 pt-2.5 pb-1.5 border-b border-border/20 flex items-center gap-2">
              <p className="text-[12px] font-medium text-foreground leading-snug flex-1 min-w-0">
                {plan.summary}
              </p>
              <button
                onClick={() => setModalOpen(true)}
                className="p-1 rounded hover:bg-[rgba(255,255,255,0.06)] transition-colors text-[#8888a8] hover:text-foreground shrink-0"
                title={t(lang, "viewPlanDoc")}
                data-testid="button-view-plan-doc"
              >
                <FileText className="w-3 h-3" />
              </button>
            </div>
            {isExecuting && total > 0 && (
              <div className="px-3 pt-1 pb-2 border-b border-border/20">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-primary font-semibold uppercase tracking-wide">
                    Plan · {doneCount} of {total}
                  </span>
                  <span className="text-[11px] text-muted-foreground/60">
                    {Math.round((doneCount / total) * 100)}%
                  </span>
                </div>
                <div className="h-[2px] rounded-full bg-border/40 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
                    style={{ width: `${(doneCount / total) * 100}%` }}
                  />
                </div>
              </div>
            )}
            <div className="px-3 py-2 border-b border-border/20 border-l-2 border-l-[#4f82ff] bg-[rgba(79,130,255,0.03)]">
              <div className="flex items-center gap-2 mb-1">
                <Lightbulb className="w-3.5 h-3.5 text-[#4f82ff] shrink-0" />
                <p className="text-[10px] font-semibold text-[#4f82ff] uppercase tracking-wide">
                  {t(lang, "whatAndWhy")}
                </p>
              </div>
              <p className="text-[12px] text-foreground/80 leading-relaxed">
                {whatAndWhy || t(lang, "whatAndWhyNone")}
              </p>
            </div>
            <div className="px-3 py-2 border-b border-border/20 border-l-2 border-l-[#34d68a] bg-[rgba(52,214,138,0.03)]">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#34d68a] shrink-0" />
                <p className="text-[10px] font-semibold text-[#34d68a] uppercase tracking-wide">
                  {t(lang, "doneLooksLike")}
                </p>
              </div>
              <p className="text-[12px] text-foreground/80 leading-relaxed">
                {doneLooksLike || t(lang, "doneLooksLikeNone")}
              </p>
            </div>
            <div className="px-3 py-2 border-b border-border/20 border-l-2 border-l-[#8888a8] bg-[rgba(136,136,168,0.03)]">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-3.5 h-3.5 text-[#8888a8] shrink-0" />
                <p className="text-[10px] font-semibold text-[#8888a8] uppercase tracking-wide">
                  {t(lang, "outOfScope")}
                </p>
              </div>
              <p className="text-[12px] text-foreground/80 leading-relaxed">
                {outOfScope || t(lang, "outOfScopeNone")}
              </p>
            </div>

            <div
              className={cn(
                "px-3 py-2 border-b border-border/20 border-l-2 border-l-[#a78bfa] bg-[rgba(167,139,250,0.03)]",
                !(relevantFiles && relevantFiles.length > 0) && "border-b-0",
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Hammer className="w-3.5 h-3.5 text-[#a78bfa] shrink-0" />
                  <p className="text-[10px] font-semibold text-[#a78bfa] uppercase tracking-wide">
                    {t(lang, "tasks")}
                  </p>
                </div>
                {isExecuting && total > 0 ? (
                  <span
                    className="text-[10px] font-mono text-muted-foreground/60"
                    data-testid="step-progress-counter"
                  >
                    {doneCount}/{total}
                  </span>
                ) : isPreExecution && hasMore ? (
                  <button
                    onClick={() => setStepsExpanded(!stepsExpanded)}
                    className="flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80 transition-colors"
                    data-testid="button-expand-steps"
                  >
                    {stepsExpanded ? (
                      <ChevronUp className="w-2.5 h-2.5" />
                    ) : (
                      <ChevronDown className="w-2.5 h-2.5" />
                    )}
                    {stepsExpanded
                      ? t(lang, "collapse")
                      : t(lang, "showAllSteps", { n: steps.length })}
                  </button>
                ) : null}
              </div>
              <div className="space-y-0">
                {visibleSteps.map((task: ManagerSubTask, idx: number) => (
                  <StepItem
                    key={task.step}
                    task={task}
                    status={taskStatuses[String(task.step)]}
                    failureReason={taskFailureReasons?.[String(task.step)]}
                    isCompleted={isFullyComplete}
                    showNumber
                    isLast={idx === visibleSteps.length - 1}
                  />
                ))}
              </div>
              {peekSteps.length > 0 && !stepsExpanded && (
                <div className="relative mt-0">
                  <div className="space-y-0 blur-[2px] select-none pointer-events-none opacity-50">
                    {peekSteps.map((task: ManagerSubTask) => (
                      <StepItem
                        key={task.step}
                        task={task}
                        status={taskStatuses[String(task.step)]}
                        failureReason={taskFailureReasons?.[String(task.step)]}
                        isCompleted={isFullyComplete}
                        showNumber
                        isLast={false}
                      />
                    ))}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-card/90 pointer-events-none" />
                </div>
              )}
            </div>

            {relevantFiles && relevantFiles.length > 0 && (
              <div className="px-3 py-2 border-l-2 border-l-[#fb923c] bg-[rgba(251,146,60,0.03)]">
                <div className="flex items-center gap-2 mb-1">
                  <FileCode className="w-3.5 h-3.5 text-[#fb923c] shrink-0" />
                  <p className="text-[10px] font-semibold text-[#fb923c] uppercase tracking-wide">
                    {t(lang, "relevantFiles")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {relevantFiles.map((f, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.05)] text-[10px] text-[#8888a8] font-mono"
                      data-testid={`file-badge-${i}`}
                    >
                      <FileCode className="w-2.5 h-2.5 shrink-0" />
                      {f.split("/").pop() || f}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : isPreExecution ? (
          <>
            <div className="px-3 pt-2.5 pb-1.5 flex items-start justify-between gap-2">
              <p className="text-[13px] leading-snug min-w-0 flex-1 text-foreground">
                {plan.summary || (plan as unknown as Record<string, string>).user_requirement || ""}
              </p>
              <button
                onClick={() => setModalOpen(true)}
                className="p-1 rounded hover:bg-[rgba(255,255,255,0.06)] transition-colors text-[#8888a8] hover:text-foreground shrink-0"
                title={t(lang, "viewPlanDoc")}
                data-testid="button-view-plan-doc-preexec"
              >
                <FileText className="w-3 h-3" />
              </button>
            </div>
            <div className="relative px-3 pb-2">
              <div className="space-y-0">
                {visibleSteps.map((task: ManagerSubTask, idx: number) => (
                  <StepItem
                    key={task.step}
                    task={task}
                    status={taskStatuses[String(task.step)]}
                    failureReason={taskFailureReasons?.[String(task.step)]}
                    isCompleted={isFullyComplete}
                    isLast={idx === visibleSteps.length - 1}
                  />
                ))}
              </div>
              {peekSteps.length > 0 && (
                <div className="relative mt-0">
                  <div className="space-y-0 blur-[2px] select-none pointer-events-none opacity-50">
                    {peekSteps.map((task: ManagerSubTask) => (
                      <StepItem
                        key={task.step}
                        task={task}
                        status={taskStatuses[String(task.step)]}
                        failureReason={taskFailureReasons?.[String(task.step)]}
                        isCompleted={isFullyComplete}
                        isLast={false}
                      />
                    ))}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-card/90 pointer-events-none" />
                  <button
                    onClick={() => setStepsExpanded(true)}
                    className="flex items-center gap-1 mt-1 text-[11px] text-primary hover:text-primary/80 transition-colors"
                    data-testid="button-expand-steps"
                  >
                    <ChevronDown className="w-3 h-3" />
                    {t(lang, "showAllSteps", { n: steps.length })}
                  </button>
                </div>
              )}
              {stepsExpanded && hasMore && (
                <button
                  onClick={() => setStepsExpanded(false)}
                  className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-collapse-steps"
                >
                  <ChevronUp className="w-3 h-3" />
                  {t(lang, "collapse")}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="px-3 pb-2">
            {(plan.summary || (plan as unknown as Record<string, string>).user_requirement) && (
              <div className="flex items-start justify-between gap-2 pt-2.5 pb-1">
                <p className="text-[12px] text-foreground/70 leading-snug flex-1 min-w-0">
                  {plan.summary || (plan as unknown as Record<string, string>).user_requirement}
                </p>
                <button
                  onClick={() => setModalOpen(true)}
                  className="p-1 rounded hover:bg-[rgba(255,255,255,0.06)] transition-colors text-[#8888a8] hover:text-foreground shrink-0"
                  title={t(lang, "viewPlanDoc")}
                  data-testid="button-view-plan-doc-completed"
                >
                  <FileText className="w-3 h-3" />
                </button>
              </div>
            )}
            {isExecuting && total > 0 && (
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wide">
                  Steps
                </span>
                <span
                  className="text-[10px] font-mono text-muted-foreground/60"
                  data-testid="step-progress-counter"
                >
                  {doneCount}/{total}
                </span>
              </div>
            )}
            <div className="space-y-0">
              {steps.map((task: ManagerSubTask, idx: number) => (
                <StepItem
                  key={task.step}
                  task={task}
                  status={taskStatuses[String(task.step)]}
                  failureReason={taskFailureReasons?.[String(task.step)]}
                  isCompleted={isFullyComplete}
                  isLast={idx === steps.length - 1}
                />
              ))}
            </div>
          </div>
        )}

        {doneCount > 0 && !isFullyComplete && (
          <div className="px-3 pb-2 flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">
              {allDone
                ? t(lang, "allStepsBuilt", { n: total })
                : t(lang, "stepsDone", { done: doneCount, total })}
            </span>
          </div>
        )}

        <ReviewStatusBadge
          phase={phase}
          fixCycle={fixCycle || 0}
          review={holisticReview || null}
          lang={lang}
        />

        {isFullyComplete && (
          <div className="px-3 pb-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-green-500" />
            <span className="text-[10px] text-green-500 font-medium">
              {t(lang, "allVerified")}
            </span>
          </div>
        )}

        {holisticReview &&
          phase === "review_failed" && (
            <div className="px-3 pb-1.5" data-testid="review-summary-row">
              <div className="flex items-center gap-2 text-[10px] font-medium rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1">
                <XCircle className="w-3 h-3 text-red-500 shrink-0" />
                <span className="text-red-400">Validation failed</span>
                {holisticReview.requirement_match_percent !== undefined && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-green-500">{holisticReview.requirement_match_percent}% matched</span>
                  </>
                )}
                {holisticReview.bugs?.length > 0 && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-red-400">{holisticReview.bugs.length} {holisticReview.bugs.length === 1 ? "issue" : "issues"}</span>
                  </>
                )}
              </div>
            </div>
          )}

        {holisticReview &&
          phase === "review_failed" &&
          holisticReview.bugs.length > 0 && (
            <div className="px-3 pb-2" data-testid="review-bugs-list">
              {holisticReview.bugs.map((bug, i) => (
                <div
                  key={bug.id || i}
                  className="flex items-start gap-1.5 py-0.5"
                >
                  <XCircle className="w-2.5 h-2.5 text-red-400 mt-0.5 shrink-0" />
                  <span className="text-[10px] text-red-400/80 leading-snug">
                    <span className="font-medium">[{bug.severity}]</span>{" "}
                    {bug.description}
                  </span>
                </div>
              ))}
            </div>
          )}

        {(() => {
          const inputs: string[] =
            plan.needs_input || (plan as unknown as Record<string, string[]>).user_confirmation_needed || [];
          return inputs.length > 0 && inputs[0] !== "" ? (
            <div className="px-3 pb-2">
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

        {showConfirmation && pendingConfirmation && onContinueWithInput && (
          <div
            className="px-3 pb-2 space-y-2"
            data-testid="confirmation-input-area"
          >
            <div className="flex items-center gap-1 mb-1">
              <HelpCircle className="w-3 h-3 text-yellow-500" />
              <span className="text-[10px] font-medium text-yellow-500">
                {t(lang, "pleaseRespond")}
              </span>
            </div>
            {pendingConfirmation.items.map((item, i) => (
              <p
                key={i}
                className="text-[11px] text-foreground/80 pl-4 leading-snug"
              >
                • {item}
              </p>
            ))}
            <Textarea
              value={confirmationInput || ""}
              onChange={(e) => onConfirmationInputChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  onContinueWithInput(confirmationInput || "");
                }
              }}
              placeholder={t(lang, "inputPlaceholder")}
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

        {isFullyComplete ? (
          <div className="px-3 py-2 border-t border-green-500/20 space-y-1.5">
            {elapsedLabel && (
              <p className="text-[10px] text-muted-foreground/50 text-center">
                Worked for {elapsedLabel}
              </p>
            )}
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
          </div>
        ) : (
          onExecute && (
            <div className="px-3 py-2 border-t border-border/30">
              {isExecuting ? (
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
              ) : showConfirmation ? null : isPreExecution ? (
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
          )
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
}: {
  message: {
    role: string;
    content: string;
    plan?: ManagerPlan;
    source?: "communicator" | "manager_raw" | "manager";
    typing?: boolean;
    thinking?: string;
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
      />
    );
  }

  if (message.source === "manager_raw") {
    return null;
  }

  return <NarrationBubble message={message} />;
}
