import { useState } from "react";
import {
  type ManagerPlan,
  type ManagerSubTask,
  type BuildResultData,
  useIDEStore,
} from "@/stores/ide-store";
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
  Hammer,
  PenLine,
  Search,
  ExternalLink,
  X,
  LayoutGrid,
  Ban,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanCardLang, ActionLogEntry, NarrationSegment } from "./chat-types";
import { t, usePlanCardLang, normalizeSteps } from "./chat-utils";
import { BuildLivePanel } from "./BuildLivePanel";

function StepItem({
  task,
  status,
  failureReason,
  isCompleted,
  stepActions,
}: {
  task: ManagerSubTask;
  status?: "pending" | "running" | "done" | "failed" | "needs-input" | "bug";
  failureReason?: string;
  isCompleted?: boolean;
  showNumber?: boolean;
  isLast?: boolean;
  liveNarration?: string;
  stepActions?: ActionLogEntry[];
}) {
  const s = status || "pending";
  const lang = usePlanCardLang();
  const isRunning = s === "running";

  const statusSymbol = (() => {
    switch (s) {
      case "done": return <span className="text-[#34d68a]">✓</span>;
      case "running": return <span className="text-[#4f82ff] animate-pulse">●</span>;
      case "failed": return <span className="text-[#ef4444]">✗</span>;
      case "needs-input": return <span className="text-[#f59e0b]">?</span>;
      case "bug": return <span className="text-[#f97316]">!</span>;
      default: return <span className="text-muted-foreground/40">○</span>;
    }
  })();

  const failureReasonLabel =
    s === "failed"
      ? failureReason === "no_code"
        ? t(lang, "noCodeOutput")
        : failureReason === "editor_error"
          ? t(lang, "editorError")
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
      <span className="w-[14px] text-right text-[10px] text-muted-foreground/40 shrink-0 pt-px">
        {task.step}
      </span>
      <span className="w-[14px] text-center shrink-0">{statusSymbol}</span>
      <div className="flex-1 min-w-0 flex items-start gap-2">
        <span
          className={cn(
            "flex-1 min-w-0",
            isCompleted ? "text-muted-foreground/40"
              : s === "done" ? "text-muted-foreground/60"
              : s === "failed" ? "text-[#ef4444]"
              : isRunning ? "text-foreground font-medium"
              : s === "needs-input" ? "text-[#f59e0b]"
              : s === "bug" ? "text-[#f97316]"
              : "text-muted-foreground/70",
          )}
        >
          {task.title}
        </span>
        {failureReasonLabel && (
          <span className="ml-2 text-[9px] text-[#ef4444]/70">
            ({failureReasonLabel})
          </span>
        )}
      </div>
    </div>
  );
}

export function ThinkingToggle({ thinking, isCompleted }: { thinking: string; isCompleted?: boolean }) {
  const [open, setOpen] = useState(false);
  const lang = usePlanCardLang();
  return (
    <div className="mb-1">
      <button
        className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        onClick={() => setOpen((o) => !o)}
        data-testid="button-toggle-thinking"
      >
        {open ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
        <span className="italic">{t(lang, isCompleted ? "thinking" : "thinkingInProgress")}</span>
      </button>
      {open && (
        <p className="mt-1 font-mono text-[10px] text-muted-foreground/50 italic whitespace-pre-wrap pl-4 max-h-[150px] overflow-y-auto">
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
  fixCycle,
  thinking,
  liveNarration,
  completionSummary,
  changedFiles,
  stepActionsMap,
}: {
  plan: ManagerPlan;
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "needs-input" | "bug">;
  taskFailureReasons?: Record<string, string>;
  onExecute?: () => void;
  onRevise?: (note?: string) => void;
  isExecuting?: boolean;
  onStop?: () => void;
  onContinueWithInput?: (userInput?: string) => void;
  pendingConfirmation?: { stepKey: string; items: string[] } | null;
  confirmationInput?: string;
  onConfirmationInputChange?: (value: string) => void;
  fixCycle?: number;
  thinking?: string;
  liveNarration?: string;
  completionSummary?: string;
  changedFiles?: string[];
  stepActionsMap?: Map<number, ActionLogEntry[]>;
}) {
  const lang = usePlanCardLang();
  const { setPlanPreview, checkpoints, restoreCheckpoint, refreshPreview } = useIDEStore();
  const steps = normalizeSteps(plan);
  const doneCount = steps.filter((s) => taskStatuses[String(s.step)] === "done").length;
  const total = steps.length;
  const allDone = doneCount === total && total > 0;
  const hasNeedsInput = steps.some((s) => taskStatuses[String(s.step)] === "needs-input");
  const showConfirmation = hasNeedsInput;
  // Build completion: a build is fully complete once every step is done.
  const isFullyComplete = allDone;
  const isPreExecution = doneCount === 0 && !isExecuting && !isFullyComplete && onExecute;

  const [expanded, setExpanded] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [rollbackRestored, setRollbackRestored] = useState(false);

  const whatAndWhy = plan.narrated_what_and_why || plan.what_and_why;
  const doneLooksLike = plan.narrated_done_looks_like || plan.done_looks_like;
  const outOfScope = plan.narrated_out_of_scope || plan.out_of_scope;
  const overview = plan.overview;

  if (minimized) {
    return (
      <div className="mx-2.5 my-1 flex justify-start">
        <button
          onClick={() => setMinimized(false)}
          className={cn(
            "flex items-center gap-1.5 font-mono text-[10px] rounded-full border px-2.5 py-1 transition-colors hover:bg-accent/10",
            isFullyComplete
              ? "border-[rgba(52,214,138,0.3)] text-[#34d68a] bg-[rgba(52,214,138,0.06)]"
              : "border-border text-muted-foreground/60 bg-[var(--panel-mid-bg)]"
          )}
          style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.15)" }}
          data-testid="task-plan-card-mini"
        >
          {isFullyComplete ? (
            <span className="text-[11px]">✓</span>
          ) : isExecuting ? (
            <span className="text-[11px] text-[#4f82ff] animate-pulse">●</span>
          ) : (
            <span className="text-[11px]">○</span>
          )}
          <span className="max-w-[160px] truncate">{plan.summary}</span>
          <span className="text-muted-foreground/40 text-[9px]">{doneCount}/{total}</span>
        </button>
      </div>
    );
  }

  return (
    <>
      {thinking && (
        <div className="px-3 mb-0.5">
          <ThinkingToggle thinking={thinking} isCompleted={isFullyComplete} />
        </div>
      )}

      {/* Main task plan confirm card */}
      <div
        className={cn(
          "mx-2.5 my-1 rounded-[14px] border overflow-visible",
          isFullyComplete
            ? "border-[rgba(52,214,138,0.15)] bg-[var(--panel-mid-bg)]"
            : "border-border bg-[var(--panel-mid-bg)]",
        )}
        style={{ boxShadow: "0 2px 16px rgba(0,0,0,0.18)" }}
        data-testid="task-plan-card"
      >
        {/* ── Section 1: Header ── */}
        <div className="px-4 pt-3.5 pb-2.5 flex items-center gap-2 border-b border-border/60">
          {isFullyComplete ? (
            <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0 text-[#34d68a] text-[13px]">✓</span>
          ) : (isExecuting && !allDone) ? (
            <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0 text-[#4f82ff] text-[13px] animate-pulse">●</span>
          ) : (
            <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0 text-muted-foreground/50 text-[13px]">○</span>
          )}
          <span className="font-mono text-[12.5px] font-semibold text-foreground flex-1 min-w-0 truncate">
            {t(lang, isFullyComplete ? "taskPlanCreated" : "taskPlanInProgress")}
          </span>
          <button
            onClick={() => {
              setPlanPreview(true, {
                summary: plan.summary,
                overview,
                steps: steps.map((s) => ({ title: s.title, description: s.description })),
              });
              window.dispatchEvent(new Event("plan-preview-open"));
            }}
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors shrink-0"
            data-testid="button-view-plan-doc"
          >
            <ExternalLink className="w-3 h-3" />
            <span>{t(lang, "view")}</span>
          </button>
          <button
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0 ml-0.5"
            onClick={() => setMinimized(true)}
            title="minimize"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── Section 2: Content ── */}
        <div className="px-4 py-3 border-b border-border/60">
          <p className="text-[12.5px] font-semibold text-foreground leading-snug mb-1.5">
            {plan.summary}
          </p>
          {overview && (
            <p className="text-[11.5px] text-muted-foreground leading-relaxed mb-2">
              {overview}
            </p>
          )}

          {/* Steps list (collapsible) */}
          {expanded && (
            <div className="mt-2.5 space-y-0.5">
              {steps.map((task: ManagerSubTask, idx: number) => {
                return (
                  <StepItem
                    key={task.step}
                    task={task}
                    status={taskStatuses[String(task.step)]}
                    failureReason={taskFailureReasons?.[String(task.step)]}
                    isCompleted={isFullyComplete}
                    showNumber
                    isLast={idx === steps.length - 1}
                    stepActions={stepActionsMap?.get(task.step)}
                  />
                );
              })}
            </div>
          )}

          {/* Progress line */}
          <div className="font-mono text-[10px] text-muted-foreground/50 mt-2">
            {t(lang, "stepsDone", { done: doneCount, total })}
            {isFullyComplete && ` · ${t(lang, "allDone")}`}
          </div>
        </div>

        {/* Confirmation input */}
        {showConfirmation && pendingConfirmation && onContinueWithInput && (
          <div className="px-4 py-2.5 space-y-1.5 border-b border-border/60">
            <Textarea
              placeholder={pendingConfirmation.items[0]}
              value={confirmationInput || ""}
              onChange={(e) => onConfirmationInputChange?.(e.target.value)}
              className="resize-none font-mono text-[11px] min-h-[28px] max-h-[60px] bg-[var(--panel-mid-bg)] border-border/40"
              rows={1}
              data-testid="input-confirmation"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-5 text-[9px] font-mono border-border"
                onClick={() => onContinueWithInput(t(lang, "looksGood"))}
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

        {/* Needs-input notice */}
        {(() => {
          const inputs: string[] =
            plan.needs_input || (plan as unknown as Record<string, string[]>).user_confirmation_needed || [];
          return inputs.length > 0 && inputs[0] !== "" ? (
            <div className="px-4 py-2 border-b border-border/60">
              <div className="flex items-center gap-1 font-mono text-[10px] text-[#f59e0b]">
                <AlertTriangle className="w-2.5 h-2.5" />
                <span>{t(lang, "needsInput")}</span>
              </div>
              {inputs.map((item, i) => (
                <p key={i} className="font-mono text-[10px] text-muted-foreground/60 pl-4 leading-snug">
                  • {item}
                </p>
              ))}
            </div>
          ) : null;
        })()}

        {/* ── Section 3: Primary actions ── */}
        {!showConfirmation && !isFullyComplete && (
          <div className="px-4 py-2.5 border-b border-border/60 flex items-center gap-2">
            {isExecuting ? (
              <button
                className="font-mono text-[10px] text-[#ef4444]/70 hover:text-[#ef4444] border border-[rgba(239,68,68,0.2)] rounded-lg px-3 py-1.5 transition-colors"
                onClick={onStop}
                data-testid="button-stop-execution"
              >
                {t(lang, "stop")}
              </button>
            ) : isPreExecution ? (
              <>
                <div className="flex-1" />
                {/* Primary: Build here */}
                <button
                  className="font-mono text-[10px] text-white bg-[#4f82ff] hover:bg-[#3a6ee8] rounded-lg px-4 py-1.5 transition-colors font-semibold"
                  onClick={onExecute}
                  data-testid="button-execute-plan"
                >
                  {t(lang, "buildHere")}
                </button>
              </>
            ) : (
              <button
                className="font-mono text-[10px] text-white bg-[#4f82ff] hover:bg-[#3a6ee8] rounded-lg px-4 py-1.5 transition-colors font-semibold flex items-center gap-1"
                onClick={onExecute}
                data-testid="button-execute-plan"
              >
                <Hammer className="w-2.5 h-2.5" />
                {t(lang, "buildNow")}
              </button>
            )}
          </div>
        )}

        {/* ── Section 4: Bottom toolbar ── */}
        <div className="px-4 py-2 flex items-center gap-1">
          {/* Left: Revise + Cancel */}
          <button
            className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70 hover:text-foreground/80 transition-colors px-1.5 py-1 rounded hover:bg-accent/10"
            onClick={() => setRegenerateOpen(true)}
            data-testid="button-revise-plan"
          >
            <PenLine className="w-3 h-3" />
            <span>{t(lang, "revise")}</span>
          </button>
          <button
            className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70 hover:text-foreground/80 transition-colors px-1.5 py-1 rounded hover:bg-accent/10"
            onClick={onStop}
            data-testid="button-cancel-plan"
          >
            <Ban className="w-3 h-3" />
            <span>{t(lang, "cancel")}</span>
          </button>

          <div className="flex-1" />

        </div>
      </div>

      <RegeneratePlanDialog
        open={regenerateOpen}
        onOpenChange={setRegenerateOpen}
        onConfirm={(note) => {
          setRegenerateOpen(false);
          onRevise?.(note);
        }}
        lang={lang}
      />
    </>
  );
}

export function RegeneratePlanDialog({
  open,
  onOpenChange,
  onConfirm,
  lang,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note?: string) => void;
  lang: PlanCardLang;
}) {
  const [mode, setMode] = useState<"simple" | "with-note">("with-note");
  const [note, setNote] = useState("");

  const handleConfirm = () => {
    if (mode === "with-note") {
      onConfirm(note.trim() || undefined);
    } else {
      onConfirm(undefined);
    }
    setNote("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 bg-[var(--panel-mid-bg)] border-border">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border/60">
          <DialogTitle className="text-sm font-mono font-medium">
            {t(lang, "regenerateTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="px-5 py-4 space-y-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              className="mt-0.5"
              checked={mode === "simple"}
              onChange={() => setMode("simple")}
            />
            <span className="text-[12px] font-mono text-foreground/90 leading-snug">
              {t(lang, "regenerateModeSimple")}
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              className="mt-0.5"
              checked={mode === "with-note"}
              onChange={() => setMode("with-note")}
            />
            <span className="text-[12px] font-mono text-foreground/90 leading-snug">
              {t(lang, "regenerateModeWithNote")}
            </span>
          </label>
          {mode === "with-note" && (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t(lang, "regenerateNotePlaceholder")}
              className="min-h-[80px] text-[12px] font-mono bg-[var(--panel-mid-bg)] border-border"
              autoFocus
            />
          )}
        </div>
        <div className="px-5 py-3 border-t border-border/60 flex justify-end gap-2">
          <button
            className="font-mono text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-3 py-1.5 transition-colors"
            onClick={() => onOpenChange(false)}
            data-testid="button-regenerate-cancel"
          >
            {t(lang, "cancel")}
          </button>
          <button
            className="font-mono text-[11px] text-white bg-[#4f82ff] hover:bg-[#3a6ee8] rounded px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleConfirm}
            disabled={mode === "with-note" && !note.trim()}
            data-testid="button-regenerate-confirm"
          >
            {t(lang, "regenerateConfirm")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BuildResultCard({
  buildResult,
}: {
  buildResult: BuildResultData;
}) {
  const hasContent =
    (buildResult.segments && buildResult.segments.length > 0) ||
    (buildResult.actionLog && buildResult.actionLog.length > 0);
  if (!hasContent) return null;

  const segments: NarrationSegment[] | undefined = buildResult.segments?.map(
    (s) => ({
      id: s.id,
      narration: s.narration,
      actions: s.actions as ActionLogEntry[],
      isLive: false,
    }),
  );

  return (
    <div className="mx-2.5 my-1 overflow-hidden" data-testid="build-result-card">
      <BuildLivePanel
        entries={buildResult.actionLog as ActionLogEntry[]}
        segments={segments}
        isCompleted
        tokenUsage={(buildResult as any).tokenUsage}
        completionSummary={(buildResult as any).completionData?.summary}
      />
    </div>
  );
}

function stripMd(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/_{1,2}(.+?)_{1,2}/g, "$1")
    .replace(/\|.+\|/g, "")
    .replace(/^-{3,}$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  fixCycle,
  liveNarration,
  completionData,
  stepActionsMap,
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
  onRevise?: (note?: string) => void;
  isExecuting?: boolean;
  onStop?: () => void;
  onContinueWithInput?: (userInput?: string) => void;
  pendingConfirmation?: { stepKey: string; items: string[] } | null;
  confirmationInput?: string;
  onConfirmationInputChange?: (value: string) => void;
  fixCycle?: number;
  liveNarration?: string;
  completionData?: { changedFiles: string[]; summary: string } | null;
  stepActionsMap?: Map<number, ActionLogEntry[]>;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end px-3">
        <div className="rounded-md px-3 py-1.5 text-[13px] leading-relaxed max-w-[80%] bg-[#E8E8E6] text-[#1A1A1A] dark:bg-[hsl(220,15%,22%)] dark:text-[hsl(210,20%,88%)]">
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
        fixCycle={fixCycle}
        thinking={message.thinking}
        liveNarration={liveNarration}
        completionSummary={completionData?.summary}
        changedFiles={completionData?.changedFiles}
        stepActionsMap={stepActionsMap}
      />
    );
  }

  if (message.source === "manager_raw") {
    return null;
  }

  // Assistant text reply with no plan/buildResult — e.g. clarifying questions or
  // communicator narration. Render the content; without this the reply is
  // invisible (the user bubble shows but the agent's answer never appears).
  if (!message.content) return null;

  const cleanContent = stripMd(message.content);
  const contentLines = cleanContent.split("\n").filter((l) => l.trim());
  return (
    <div data-testid="manager-narration-bubble">
      {message.thinking && (
        <div className="px-3.5 pb-1">
          <ThinkingToggle thinking={message.thinking} />
        </div>
      )}
      <div className="px-3.5 py-1 font-mono text-[12px] leading-[1.6] text-muted-foreground space-y-1">
        {contentLines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
}
