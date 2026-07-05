import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { srcDir } from "./paths";

export type TelemetryCounter =
  | "writeFileCount"
  | "patchFileCount"
  | "hashPatchFileCount"
  | "hashPatchMissCount"
  | "deleteFileCount"
  | "runTestsCount";

export type TelemetryPhase = "builder" | "verifier" | "fixer";

export type TelemetryFinalStatus = "pass" | "fail" | "aborted" | "error";

export interface BuildTelemetryRecord {
  sessionId: string;
  projectId?: string;
  framework?: string;
  provider?: string;
  userLangNative?: string;

  startedAt: number;
  endedAt: number;
  durationMs: number;

  stepCount: number;
  parallelWavesUsed: boolean;
  contextTokenSize?: number;
  ledgerCompletionConsistent?: boolean;
  timeToFirstEditMs?: number;
  modelRouteDecisions?: Array<{
    role: string;
    provider: string;
    model: string;
    reason: string;
    routingMode: string;
    fallbackIndex: number;
  }>;
  explorerUsed?: boolean;
  explorerTimeout?: boolean;
  discoveryOnlyRounds?: number;
  thinkingModeCounts?: Record<string, number>;

  fixCycles: number;
  verifierFirstPassed: boolean;
  finalStatus: TelemetryFinalStatus;
  lastVerdictSummary?: string;

  writeFileCount: number;
  patchFileCount: number;
  hashPatchFileCount: number;
  hashPatchMissCount: number;
  deleteFileCount: number;

  filesWritten: string[];
  filesInFixerScope: string[];

  runTestsCount: number;

  timings: Partial<Record<TelemetryPhase, number>>;

  lspDiagnosticErrorCount: number;
}

export interface BuildTelemetryInit {
  id: string;
  projectId?: string;
  framework?: string;
  provider?: string;
  userLang?: string;
}

export function getTelemetryDir(): string {
  // Repo-root /telemetry (srcDir is backend/api/src, so three levels up).
  return process.env.TELEMETRY_DIR || srcDir("..", "..", "..", "telemetry");
}

function isDisabled(): boolean {
  return process.env.DISABLE_TELEMETRY === "1";
}

function ymd(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export class BuildTelemetry {
  private record: BuildTelemetryRecord;
  private filesWrittenSet = new Set<string>();
  private filesInFixerScopeSet = new Set<string>();
  private flushed = false;

  constructor(init: BuildTelemetryInit) {
    const now = Date.now();
    this.record = {
      sessionId: init.id,
      projectId: init.projectId,
      framework: init.framework,
      provider: init.provider,
      userLangNative: init.userLang,
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      stepCount: 0,
      parallelWavesUsed: false,
      fixCycles: 0,
      verifierFirstPassed: false,
      finalStatus: "error",
      writeFileCount: 0,
      patchFileCount: 0,
      hashPatchFileCount: 0,
      hashPatchMissCount: 0,
      deleteFileCount: 0,
      filesWritten: [],
      filesInFixerScope: [],
      runTestsCount: 0,
      timings: {},
      lspDiagnosticErrorCount: 0,
      modelRouteDecisions: [],
      explorerUsed: false,
      explorerTimeout: false,
      discoveryOnlyRounds: 0,
      thinkingModeCounts: {},
    };
  }

  incr(field: TelemetryCounter, by = 1): void {
    this.record[field] = (this.record[field] ?? 0) + by;
  }

  incrLspErrors(n: number): void {
    this.record.lspDiagnosticErrorCount += n;
  }

  addFileWritten(filePath: string): void {
    this.filesWrittenSet.add(filePath);
    this.record.timeToFirstEditMs ??= Date.now() - this.record.startedAt;
  }

  addFixerScope(paths: string[]): void {
    for (const p of paths) this.filesInFixerScopeSet.add(p);
  }

  setStepCount(n: number, parallelWavesUsed: boolean): void {
    this.record.stepCount = n;
    this.record.parallelWavesUsed = parallelWavesUsed;
  }

  setContextTokenSize(tokens: number): void {
    this.record.contextTokenSize = tokens;
  }

  setLedgerCompletionConsistent(consistent: boolean): void {
    this.record.ledgerCompletionConsistent = consistent;
  }

  addModelRouteDecision(decision: {
    role: string;
    provider: string;
    model: string;
    reason: string;
    routingMode: string;
    fallbackIndex: number;
  }): void {
    this.record.modelRouteDecisions ??= [];
    this.record.modelRouteDecisions.push({
      role: decision.role,
      provider: decision.provider,
      model: decision.model,
      reason: decision.reason,
      routingMode: decision.routingMode,
      fallbackIndex: decision.fallbackIndex,
    });
  }

  setExplorerUsed(used: boolean, timedOut = false): void {
    this.record.explorerUsed = used;
    this.record.explorerTimeout = timedOut;
  }

  addDiscoveryOnlyRounds(count: number): void {
    this.record.discoveryOnlyRounds = (this.record.discoveryOnlyRounds ?? 0) + count;
  }

  addThinkingMode(mode: string, count = 1): void {
    this.record.thinkingModeCounts ??= {};
    this.record.thinkingModeCounts[mode] = (this.record.thinkingModeCounts[mode] ?? 0) + count;
  }

  setFixCycle(n: number): void {
    this.record.fixCycles = n;
    this.record.verifierFirstPassed = n <= 1 && this.record.finalStatus === "pass";
  }

  setFinalStatus(status: TelemetryFinalStatus, summary?: string): void {
    this.record.finalStatus = status;
    if (summary !== undefined) this.record.lastVerdictSummary = summary;
  }

  async time<T>(phase: TelemetryPhase, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      const elapsed = Date.now() - start;
      this.record.timings[phase] = (this.record.timings[phase] ?? 0) + elapsed;
    }
  }

  snapshot(): BuildTelemetryRecord {
    return {
      ...this.record,
      endedAt: Date.now(),
      durationMs: Date.now() - this.record.startedAt,
      filesWritten: Array.from(this.filesWrittenSet),
      filesInFixerScope: Array.from(this.filesInFixerScopeSet),
      timings: { ...this.record.timings },
    };
  }

  async flush(): Promise<void> {
    if (this.flushed) return;
    this.flushed = true;
    if (isDisabled()) return;
    const snap = this.snapshot();
    const dir = getTelemetryDir();
    const file = path.join(dir, `sessions-${ymd(snap.startedAt)}.jsonl`);
    try {
      await mkdir(dir, { recursive: true });
      await appendFile(file, JSON.stringify(snap) + "\n", "utf-8");
    } catch (err) {
      console.warn("[telemetry] flush failed:", err instanceof Error ? err.message : err);
    }
  }
}
