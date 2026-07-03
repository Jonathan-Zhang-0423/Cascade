export type TodoStatus = "pending" | "running" | "done" | "failed";

export interface TodoLedgerStepInput {
  step: number;
  sub_task_id?: string;
  title: string;
  acceptance_criteria?: string;
  required_files?: string[];
}

export interface TodoLedgerEntry {
  stepId: number | string;
  stepNumber: number;
  status: TodoStatus;
  title: string;
  requiredFiles: string[];
  acceptanceCriteria?: string;
  touchedFiles: string[];
  summary?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface TodoLedgerSnapshot {
  steps: TodoLedgerEntry[];
  allDone: boolean;
  completedCount: number;
  totalCount: number;
}

export class TodoLedger {
  private entries = new Map<number | string, TodoLedgerEntry>();

  constructor(steps: TodoLedgerStepInput[]) {
    for (const step of steps) {
      const key = step.step;
      this.entries.set(key, {
        stepId: step.sub_task_id ?? step.step,
        stepNumber: step.step,
        status: "pending",
        title: step.title,
        requiredFiles: step.required_files ?? [],
        acceptanceCriteria: step.acceptance_criteria,
        touchedFiles: [],
      });
    }
  }

  resolve(stepId: number | string): TodoLedgerEntry | undefined {
    if (this.entries.has(stepId)) return this.entries.get(stepId);
    const asNum = typeof stepId === "string" ? Number(stepId) : stepId;
    if (Number.isFinite(asNum) && this.entries.has(asNum)) return this.entries.get(asNum);
    for (const entry of this.entries.values()) {
      if (entry.stepId === stepId) return entry;
    }
    return undefined;
  }

  start(stepId: number | string, now = Date.now()): TodoLedgerEntry | undefined {
    const entry = this.resolve(stepId);
    if (!entry) return undefined;
    if (entry.status !== "done") entry.status = "running";
    entry.startedAt ??= now;
    return entry;
  }

  complete(stepId: number | string, summary: string, touchedFiles: string[] = [], now = Date.now()): TodoLedgerEntry | undefined {
    const entry = this.resolve(stepId);
    if (!entry) return undefined;
    entry.status = "done";
    entry.summary = summary;
    entry.completedAt = now;
    entry.touchedFiles = Array.from(new Set([...entry.touchedFiles, ...touchedFiles]));
    return entry;
  }

  fail(stepId: number | string, error: string, now = Date.now()): TodoLedgerEntry | undefined {
    const entry = this.resolve(stepId);
    if (!entry) return undefined;
    entry.status = "failed";
    entry.error = error;
    entry.completedAt = now;
    return entry;
  }

  recordTouchedFile(filePath: string): void {
    const running = this.snapshot().steps.filter((s) => s.status === "running");
    const target = running[running.length - 1] ?? this.snapshot().steps.find((s) => s.status === "pending");
    if (!target) return;
    const entry = this.resolve(target.stepNumber);
    if (!entry || entry.touchedFiles.includes(filePath)) return;
    entry.touchedFiles.push(filePath);
  }

  nextAfter(stepId: number | string): TodoLedgerEntry | undefined {
    const current = this.resolve(stepId);
    if (!current) return undefined;
    return this.snapshot().steps.find((entry) => entry.stepNumber > current.stepNumber && entry.status !== "done");
  }

  snapshot(): TodoLedgerSnapshot {
    const steps = Array.from(this.entries.values()).sort((a, b) => a.stepNumber - b.stepNumber);
    const completedCount = steps.filter((s) => s.status === "done").length;
    return {
      steps: steps.map((s) => ({ ...s, touchedFiles: [...s.touchedFiles] })),
      allDone: steps.length > 0 && completedCount === steps.length,
      completedCount,
      totalCount: steps.length,
    };
  }

  assertAllDone(): void {
    const snap = this.snapshot();
    if (!snap.allDone) {
      const open = snap.steps
        .filter((s) => s.status !== "done")
        .map((s) => `${s.stepNumber}:${s.status}`)
        .join(", ");
      throw new Error(`Cannot complete build; ledger still has unfinished steps: ${open || "(none)"}`);
    }
  }
}

