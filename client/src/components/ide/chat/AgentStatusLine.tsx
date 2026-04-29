/**
 * AgentStatusLine — unified "Verb+ing ▍" status indicator for all agent phases.
 *
 * Design:
 * - One consistent component replaces BuildPhaseIndicator, CodestartLoader
 *   status cards, and the reconnecting indicator
 * - Per-phase color tinting on the dot + label
 * - Blinking block cursor gives a "live terminal" feel (like Claude Code)
 * - Label cross-fades when phase changes (no jarring swap)
 * - Elapsed time appears after 2s in dim mono, right-aligned
 * - Fades in on mount via CSS animation
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export type AgentStatus =
  | "planning"
  | "preparing"
  | "thinking"
  | "working"
  | "verifying"
  | "fixing"
  | "reconnecting"
  | null;

interface StatusConfig {
  color: string;
  dotAnim: string;
}

const STATUS_CONFIG: Record<Exclude<AgentStatus, null>, StatusConfig> = {
  planning:     { color: "#4f82ff", dotAnim: "animate-pulse" },
  preparing:    { color: "#818cf8", dotAnim: "animate-pulse" },
  thinking:     { color: "#818cf8", dotAnim: "animate-pulse" },
  working:      { color: "#f59e0b", dotAnim: "animate-ping"  },
  verifying:    { color: "#34d68a", dotAnim: "animate-pulse" },
  fixing:       { color: "#f97316", dotAnim: "animate-ping"  },
  reconnecting: { color: "#f59e0b", dotAnim: "animate-ping"  },
};

interface AgentStatusLineProps {
  status: AgentStatus;
  /** Elapsed seconds — shown after 2s to give temporal context */
  elapsed?: number;
  className?: string;
}

export function AgentStatusLine({ status, elapsed, className }: AgentStatusLineProps) {
  const [shown, setShown] = useState<AgentStatus>(status);
  const [fading, setFading] = useState(false);
  const [cursorOn, setCursorOn] = useState(true);
  const t = useT();

  const STATUS_LABELS: Record<Exclude<AgentStatus, null>, string> = {
    planning:     t("agent.planning"),
    preparing:    t("agent.preparing"),
    thinking:     t("agent.thinking"),
    working:      t("agent.working"),
    verifying:    t("agent.verifying"),
    fixing:       t("agent.fixing"),
    reconnecting: t("agent.reconnecting"),
  };

  // Cross-fade when phase changes
  useEffect(() => {
    if (status === shown) return;
    if (status === null) {
      setShown(null);
      return;
    }
    setFading(true);
    const t = setTimeout(() => {
      setShown(status);
      setFading(false);
    }, 110);
    return () => clearTimeout(t);
  }, [status, shown]);

  // Blinking cursor — 530ms period, step-end feel
  useEffect(() => {
    const id = setInterval(() => setCursorOn((v) => !v), 530);
    return () => clearInterval(id);
  }, []);

  if (!shown) return null;

  const cfg = STATUS_CONFIG[shown];
  const showElapsed = typeof elapsed === "number" && elapsed >= 2;

  return (
    <>
      <style>{`
        @keyframes status-fade-in {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .agent-status-line { animation: status-fade-in 180ms ease; }
      `}</style>
      <div
        className={cn("agent-status-line flex items-center gap-2 px-1 pb-1.5", className)}
        data-testid="agent-status-line"
      >
        {/* Pulsing dot */}
        <span className="relative flex h-2 w-2 shrink-0">
          <span
            className={cn("absolute inline-flex h-full w-full rounded-full opacity-50", cfg.dotAnim)}
            style={{ backgroundColor: cfg.color }}
          />
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{ backgroundColor: cfg.color }}
          />
        </span>

        {/* Label + blinking block cursor */}
        <span
          className={cn(
            "text-[12px] font-medium leading-none transition-opacity",
            fading ? "opacity-0 duration-[110ms]" : "opacity-100 duration-[110ms]",
          )}
          style={{ color: cfg.color }}
        >
          {STATUS_LABELS[shown]}
          {/* Block cursor — the single detail that makes this feel "live" */}
          <span
            style={{
              display: "inline-block",
              marginLeft: "2px",
              width: "6px",
              height: "12px",
              verticalAlign: "text-bottom",
              borderRadius: "1px",
              backgroundColor: cfg.color,
              opacity: cursorOn ? 0.65 : 0,
              transition: "opacity 60ms",
            }}
          />
        </span>

        {/* Elapsed — dim mono, right-aligned, appears after 2s */}
        {showElapsed && (
          <span
            className="ml-auto text-[10px] font-mono shrink-0"
            style={{ color: "rgba(136,136,168,0.4)" }}
          >
            {elapsed}s
          </span>
        )}
      </div>
    </>
  );
}
