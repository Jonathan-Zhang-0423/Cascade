import { Brain, Hammer, Shield, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export type BuildPhase = "thinking" | "working" | "verifying" | "fixing" | null;

const phaseConfig: Record<
  string,
  { icon: typeof Brain; label: string; color: string; animation: string }
> = {
  thinking: {
    icon: Brain,
    label: "Thinking",
    color: "text-blue-400 bg-blue-500/10 border-blue-500/25",
    animation: "animate-pulse",
  },
  working: {
    icon: Hammer,
    label: "Working",
    color: "text-amber-400 bg-amber-500/10 border-amber-500/25",
    animation: "animate-spin",
  },
  verifying: {
    icon: Shield,
    label: "Verifying",
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
    animation: "animate-pulse",
  },
  fixing: {
    icon: Wrench,
    label: "Fixing",
    color: "text-orange-400 bg-orange-500/10 border-orange-500/25",
    animation: "animate-spin",
  },
};

export function BuildPhaseIndicator({
  phase,
}: {
  phase: BuildPhase;
}) {
  if (!phase) return null;

  const config = phaseConfig[phase];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-all duration-300",
        config.color,
      )}
      data-testid="build-phase-indicator"
    >
      <Icon className={cn("w-3 h-3 shrink-0", config.animation)} />
      <span>{config.label}</span>
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full opacity-75",
            phase === "thinking"
              ? "bg-blue-400 animate-ping"
              : phase === "working"
                ? "bg-amber-400 animate-ping"
                : phase === "verifying"
                  ? "bg-emerald-400 animate-ping"
                  : "bg-orange-400 animate-ping",
          )}
        />
        <span
          className={cn(
            "relative inline-flex rounded-full h-1.5 w-1.5",
            phase === "thinking"
              ? "bg-blue-400"
              : phase === "working"
                ? "bg-amber-400"
                : phase === "verifying"
                  ? "bg-emerald-400"
                  : "bg-orange-400",
          )}
        />
      </span>
    </div>
  );
}
