import { useRef, useEffect, useCallback, useState } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { useLLMMonitorStore, type LLMEvent, type LLMEventType } from "@/stores/llm-monitor-store";
import { useVirtualizer } from "@tanstack/react-virtual";
import { X, Trash2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_STYLES: Record<string, { color: string; label: string }> = {
  thinking_token: { color: "text-zinc-500 italic", label: "THINK" },
  narration_token: { color: "text-blue-400", label: "NARR" },
  raw_token: { color: "text-zinc-300", label: "RAW" },
  manager_token: { color: "text-zinc-300", label: "MGR" },
  communicator_token: { color: "text-cyan-400", label: "COMM" },
  communicator_summary: { color: "text-cyan-400", label: "COMM" },
  communicator_narration_starting: { color: "text-cyan-500", label: "COMM" },
  communicator_error: { color: "text-red-400", label: "COMM" },
  action_log: { color: "text-amber-400", label: "ACTION" },
  step_starting: { color: "text-emerald-400 font-semibold", label: "STEP" },
  manager_done: { color: "text-emerald-500", label: "DONE" },
  manager_error: { color: "text-red-400", label: "ERROR" },
  build_error: { color: "text-red-400", label: "ERROR" },
  done: { color: "text-zinc-500", label: "DONE" },
  all_complete: { color: "text-emerald-400 font-semibold", label: "COMPLETE" },
  plan_ready: { color: "text-violet-400", label: "PLAN" },
  editor_token: { color: "text-orange-400", label: "EDIT" },
  code_applied: { color: "text-orange-400", label: "CODE" },
  step_completed: { color: "text-emerald-400", label: "STEP✓" },
  step_failed: { color: "text-red-400", label: "STEP✗" },
  step_cancelled: { color: "text-zinc-500", label: "STEP○" },
  reviewing: { color: "text-violet-400", label: "REVIEW" },
  bugs_found: { color: "text-red-400", label: "BUGS" },
  fixing: { color: "text-amber-400", label: "FIX" },
  review_passed: { color: "text-emerald-400", label: "PASS" },
  needs_input: { color: "text-amber-400", label: "INPUT" },
  vibe_token: { color: "text-pink-400", label: "VIBE" },
};

const SOURCE_COLORS: Record<string, string> = {
  manager: "text-blue-500",
  editor: "text-orange-500",
  verifier: "text-violet-500",
  communicator: "text-cyan-500",
  "vibe-chat": "text-pink-500",
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

function getTypeStyle(type: LLMEventType) {
  return TYPE_STYLES[type] || { color: "text-zinc-400", label: type.toUpperCase() };
}

function EventRow({ event }: { event: LLMEvent }) {
  const style = getTypeStyle(event.type);
  const sourceColor = SOURCE_COLORS[event.source] || "text-zinc-500";
  const content = event.content.length > 500 ? event.content.slice(0, 500) + "…" : event.content;

  return (
    <div className="flex gap-1.5 px-2 py-0.5 text-[11px] leading-[16px] font-mono hover:bg-white/5 min-w-0" data-testid={`llm-event-${event.id}`}>
      <span className="text-zinc-600 shrink-0 w-[72px]">{formatTime(event.timestamp)}</span>
      <span className={cn("shrink-0 w-[48px] uppercase text-[10px]", sourceColor)}>{event.source.slice(0, 6)}</span>
      <span className={cn("shrink-0 w-[52px] uppercase text-[10px]", style.color)}>{style.label}</span>
      <span className={cn("break-all min-w-0", style.color)}>{content}</span>
    </div>
  );
}

export function LLMMonitor() {
  const isOpen = useIDEStore((s) => s.isLLMMonitorOpen);
  const setOpen = useIDEStore((s) => s.setLLMMonitorOpen);
  const events = useLLMMonitorStore((s) => s.events);
  const eventCount = useLLMMonitorStore((s) => s.eventCount);
  const clearEvents = useLLMMonitorStore((s) => s.clearEvents);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const userScrolledRef = useRef(false);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 30,
  });

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (!atBottom) {
      userScrolledRef.current = true;
      setAutoScroll(false);
    } else {
      userScrolledRef.current = false;
      setAutoScroll(true);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      userScrolledRef.current = false;
      setAutoScroll(true);
    }
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, autoScroll]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[520px] max-w-[calc(100vw-32px)] h-[360px] flex flex-col rounded-lg border border-border/60 bg-[#0d0d0d]/95 backdrop-blur-md shadow-2xl"
      data-testid="llm-monitor-panel"
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold text-zinc-300">LLM Monitor</span>
          <span className="text-[10px] text-zinc-600 tabular-nums" data-testid="llm-event-count">{eventCount}</span>
        </div>
        <div className="flex items-center gap-1">
          {!autoScroll && (
            <button
              className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
              onClick={scrollToBottom}
              aria-label="Scroll to bottom"
              data-testid="llm-monitor-scroll-bottom"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={clearEvents}
            aria-label="Clear log"
            data-testid="llm-monitor-clear"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={() => setOpen(false)}
            aria-label="Close monitor"
            data-testid="llm-monitor-close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        onScroll={handleScroll}
        data-testid="llm-monitor-scroll"
      >
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-600 text-xs">
            No events yet — start an AI session to see output here
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const event = events[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <EventRow event={event} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
