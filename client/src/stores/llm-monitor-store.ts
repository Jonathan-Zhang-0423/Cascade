import { create } from "zustand";

export type LLMEventSource = "manager" | "editor" | "verifier" | "communicator" | "vibe-chat";
export type LLMEventType =
  | "thinking_token"
  | "narration_token"
  | "raw_token"
  | "manager_token"
  | "communicator_token"
  | "communicator_narration_starting"
  | "communicator_error"
  | "communicator_summary"
  | "action_log"
  | "step_starting"
  | "step_completed"
  | "step_failed"
  | "step_cancelled"
  | "manager_done"
  | "manager_error"
  | "build_error"
  | "done"
  | "all_complete"
  | "plan_ready"
  | "editor_token"
  | "code_applied"
  | "reviewing"
  | "review_passed"
  | "bugs_found"
  | "fixing"
  | "needs_input"
  | "vibe_token";

export interface LLMEvent {
  id: string;
  timestamp: number;
  source: LLMEventSource;
  type: LLMEventType;
  content: string;
}

let eventCounter = 0;

interface LLMMonitorState {
  events: LLMEvent[];
  eventCount: number;
  addEvent: (source: LLMEventSource, type: LLMEventType, content: string) => void;
  clearEvents: () => void;
}

const MAX_EVENTS = 2000;
const FLUSH_INTERVAL_MS = 80;

let pendingEvents: LLMEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPending() {
  flushTimer = null;
  if (pendingEvents.length === 0) return;
  const batch = pendingEvents;
  pendingEvents = [];
  useLLMMonitorStore.setState((state) => {
    const combined = state.events.concat(batch);
    const trimmed = combined.length > MAX_EVENTS ? combined.slice(-MAX_EVENTS + 100) : combined;
    return { events: trimmed, eventCount: trimmed.length };
  });
}

export const useLLMMonitorStore = create<LLMMonitorState>((set) => ({
  events: [],
  eventCount: 0,
  addEvent: (source, type, content) => {
    const id = `llm-${++eventCounter}`;
    pendingEvents.push({ id, timestamp: Date.now(), source, type, content });
    if (!flushTimer) {
      flushTimer = setTimeout(flushPending, FLUSH_INTERVAL_MS);
    }
  },
  clearEvents: () => {
    pendingEvents = [];
    set({ events: [], eventCount: 0 });
  },
}));
