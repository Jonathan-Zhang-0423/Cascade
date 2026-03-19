import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

interface VariantResult {
  filesCount: number;
  charsInContext: number;
  latencyMs: number;
  verifierStatus: "pass" | "fail";
  matchPercent: number;
  summary: string;
}

interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  scenarioDescription: string;
  variantA: VariantResult;
  variantB: VariantResult;
}

interface ABTestResponse {
  results: ScenarioResult[];
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function VariantCell({ v, label }: { v: VariantResult; label: string }) {
  return (
    <div
      data-testid={`variant-cell-${label.toLowerCase()}`}
      className="bg-card border rounded-lg p-4 flex flex-col gap-2 min-w-[200px]"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">{label}</span>
        <Badge
          variant={v.verifierStatus === "pass" ? "default" : "destructive"}
          className="text-xs"
          data-testid={`badge-status-${label.toLowerCase()}`}
        >
          {v.verifierStatus === "pass" ? "PASS" : "FAIL"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">Files sent</span>
        <span className="font-mono font-medium" data-testid={`stat-files-${label.toLowerCase()}`}>{v.filesCount}</span>

        <span className="text-muted-foreground">Context chars</span>
        <span className="font-mono font-medium" data-testid={`stat-chars-${label.toLowerCase()}`}>{fmt(v.charsInContext)}</span>

        <span className="text-muted-foreground">Latency</span>
        <span className="font-mono font-medium" data-testid={`stat-latency-${label.toLowerCase()}`}>{fmt(v.latencyMs)} ms</span>

        <span className="text-muted-foreground">Match %</span>
        <span
          className={`font-mono font-semibold ${v.matchPercent >= 80 ? "text-green-500" : v.matchPercent >= 50 ? "text-yellow-500" : "text-red-500"}`}
          data-testid={`stat-match-${label.toLowerCase()}`}
        >
          {v.matchPercent}%
        </span>
      </div>

      {v.summary && (
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed border-t pt-2">
          {v.summary}
        </p>
      )}
    </div>
  );
}

function WinnerBadge({ a, b }: { a: VariantResult; b: VariantResult }) {
  const aScore = a.matchPercent;
  const bScore = b.matchPercent;
  const aFaster = a.latencyMs < b.latencyMs;
  const aMoreAccurate = aScore > bScore;
  const bMoreAccurate = bScore > aScore;
  const aLessContext = a.charsInContext < b.charsInContext;

  if (aMoreAccurate && aFaster) {
    return <Badge className="bg-blue-500 text-white text-xs">A wins (faster + more accurate)</Badge>;
  }
  if (bMoreAccurate && !aFaster) {
    return <Badge className="bg-purple-500 text-white text-xs">B wins (faster + more accurate)</Badge>;
  }
  if (aMoreAccurate) {
    return <Badge className="bg-blue-400 text-white text-xs">A more accurate · B faster</Badge>;
  }
  if (bMoreAccurate) {
    return <Badge className="bg-purple-400 text-white text-xs">B more accurate · A {aFaster ? "faster" : "not faster"}</Badge>;
  }
  if (aFaster && aLessContext) {
    return <Badge variant="secondary" className="text-xs">Tied accuracy · A faster & smaller</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">Tied</Badge>;
}

function AggregateRow({ results }: { results: ScenarioResult[] }) {
  const n = results.length;
  if (n === 0) return null;

  const avgA = {
    latencyMs: Math.round(results.reduce((s, r) => s + r.variantA.latencyMs, 0) / n),
    charsInContext: Math.round(results.reduce((s, r) => s + r.variantA.charsInContext, 0) / n),
    matchPercent: Math.round(results.reduce((s, r) => s + r.variantA.matchPercent, 0) / n),
    passCount: results.filter((r) => r.variantA.verifierStatus === "pass").length,
  };
  const avgB = {
    latencyMs: Math.round(results.reduce((s, r) => s + r.variantB.latencyMs, 0) / n),
    charsInContext: Math.round(results.reduce((s, r) => s + r.variantB.charsInContext, 0) / n),
    matchPercent: Math.round(results.reduce((s, r) => s + r.variantB.matchPercent, 0) / n),
    passCount: results.filter((r) => r.variantB.verifierStatus === "pass").length,
  };

  const aWinsAccuracy = avgA.matchPercent > avgB.matchPercent;
  const bWinsAccuracy = avgB.matchPercent > avgA.matchPercent;
  const aWinsSpeed = avgA.latencyMs < avgB.latencyMs;
  const aWinsSize = avgA.charsInContext < avgB.charsInContext;

  return (
    <div className="mt-8 border-t pt-6" data-testid="aggregate-row">
      <h2 className="text-lg font-semibold mb-4">Overall Summary</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-muted/40 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-semibold text-sm uppercase tracking-wide">Variant A — All Files</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Avg latency</span>
            <span className={`font-mono font-medium ${aWinsSpeed ? "text-green-500" : ""}`}>{fmt(avgA.latencyMs)} ms</span>

            <span className="text-muted-foreground">Avg context</span>
            <span className={`font-mono font-medium ${aWinsSize ? "text-green-500" : ""}`}>{fmt(avgA.charsInContext)} ch</span>

            <span className="text-muted-foreground">Avg match %</span>
            <span className={`font-mono font-semibold ${aWinsAccuracy ? "text-green-500" : ""}`}>{avgA.matchPercent}%</span>

            <span className="text-muted-foreground">Verifier passes</span>
            <span className="font-mono font-medium">{avgA.passCount} / {n}</span>
          </div>
        </div>

        <div className="bg-muted/40 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-semibold text-sm uppercase tracking-wide">Variant B — Required Files Only</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Avg latency</span>
            <span className={`font-mono font-medium ${!aWinsSpeed ? "text-green-500" : ""}`}>{fmt(avgB.latencyMs)} ms</span>

            <span className="text-muted-foreground">Avg context</span>
            <span className={`font-mono font-medium ${!aWinsSize ? "text-green-500" : ""}`}>{fmt(avgB.charsInContext)} ch</span>

            <span className="text-muted-foreground">Avg match %</span>
            <span className={`font-mono font-semibold ${bWinsAccuracy ? "text-green-500" : ""}`}>{avgB.matchPercent}%</span>

            <span className="text-muted-foreground">Verifier passes</span>
            <span className="font-mono font-medium">{avgB.passCount} / {n}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 p-4 bg-card border rounded-lg text-sm text-muted-foreground">
        <strong className="text-foreground">Interpretation: </strong>
        {aWinsAccuracy && aWinsSpeed
          ? "Variant A (all files) is both faster and more accurate. The extra context doesn't hurt performance and helps the model."
          : bWinsAccuracy && !aWinsSpeed
          ? "Variant B (required files) is both faster and more accurate. Focused context clearly helps quality and reduces latency."
          : aWinsAccuracy && !aWinsSpeed
          ? "Trade-off: Variant A is more accurate but slower. Variant B is faster but sacrifices some accuracy."
          : bWinsAccuracy && aWinsSpeed
          ? "Trade-off: Variant B is more accurate but Variant A is faster. Accuracy should usually win — consider Variant B."
          : "Both variants are roughly equivalent. Either fix would work. Variant B uses fewer tokens, making it slightly more efficient."}
      </div>
    </div>
  );
}

export default function ABTestPage() {
  const [results, setResults] = useState<ScenarioResult[] | null>(null);

  const runTest = useMutation({
    mutationFn: async () => {
      const data = await apiRequest("POST", "/api/ab-test", {});
      return data as ABTestResponse;
    },
    onSuccess: (data) => {
      setResults(data.results);
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2" data-testid="page-title">Editor Context A/B Test</h1>
          <p className="text-muted-foreground text-sm max-w-2xl">
            Compares two approaches to selecting which files are sent to the Editor Agent:
          </p>
          <div className="mt-3 flex flex-col sm:flex-row gap-3">
            <div className="flex-1 border rounded-lg p-3 bg-card text-sm">
              <span className="font-semibold text-blue-500">Variant A — All Files</span>
              <p className="text-muted-foreground mt-1">Sends the entire project to the Editor every time. Simple, guarantees full context, uses more tokens.</p>
            </div>
            <div className="flex-1 border rounded-lg p-3 bg-card text-sm">
              <span className="font-semibold text-purple-500">Variant B — Required Files Only</span>
              <p className="text-muted-foreground mt-1">Sends only the files annotated in the Manager's plan step. Leaner, but relies on Manager accuracy.</p>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <Button
            data-testid="button-run-test"
            onClick={() => runTest.mutate()}
            disabled={runTest.isPending}
            size="lg"
          >
            {runTest.isPending ? "Running test… (this takes ~2–3 min)" : "Run A/B Test"}
          </Button>
          {runTest.isPending && (
            <p className="text-sm text-muted-foreground mt-2" data-testid="status-running">
              Running 3 scenarios × 2 variants concurrently. Each Editor call + Verifier call takes ~30–60s…
            </p>
          )}
          {runTest.isError && (
            <p className="text-sm text-red-500 mt-2" data-testid="status-error">
              Error: {(runTest.error as Error)?.message || "Test failed"}
            </p>
          )}
        </div>

        {results && (
          <div data-testid="results-container">
            <div className="space-y-8">
              {results.map((r) => (
                <div key={r.scenarioId} className="border rounded-xl p-5 bg-card/50" data-testid={`scenario-${r.scenarioId}`}>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h2 className="font-semibold text-base">{r.scenarioName}</h2>
                      <p className="text-sm text-muted-foreground mt-0.5">{r.scenarioDescription}</p>
                    </div>
                    <WinnerBadge a={r.variantA} b={r.variantB} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <VariantCell v={r.variantA} label="A" />
                    <VariantCell v={r.variantB} label="B" />
                  </div>
                </div>
              ))}
            </div>

            <AggregateRow results={results} />
          </div>
        )}
      </div>
    </div>
  );
}
