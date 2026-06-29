/**
 * SSE (Server-Sent Events) infrastructure — the shared plumbing for all
 * agent session types (build, manager, review). Extracted from routes/index.ts
 * so session modules can use it without depending on the route layer.
 *
 * Provides:
 * - BufferedEvent: the event shape stored for replay
 * - SseCapableSession: the minimal interface a session needs for SSE
 * - SseEmit: the emit function type
 * - createSessionEmit: creates the emit fn that buffers + broadcasts
 * - attachSseWriter: attaches an HTTP response as an SSE writer with
 *   replay, dedup, and heartbeat
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BufferedEvent {
  eventId: number;
  data: Record<string, unknown>;
}

export interface SseCapableSession {
  nextEventId: number;
  events: BufferedEvent[];
  sseWriters: Set<(data: string) => void>;
  done: boolean;
}

export type SseEmit = (data: Record<string, unknown>) => void;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an emit function for a session. Each call:
 * 1. Assigns a monotonic eventId
 * 2. Buffers the event for replay on reconnect
 * 3. Broadcasts to all attached SSE writers
 */
export function createSessionEmit(session: SseCapableSession): SseEmit {
  return (data: Record<string, unknown>) => {
    const eventId = session.nextEventId++;
    const event: BufferedEvent = { eventId, data: { ...data, eventId } };
    session.events.push(event);
    const line = `data: ${JSON.stringify(event.data)}\n\n`;
    Array.from(session.sseWriters).forEach(writer => {
      try { writer(line); } catch {}
    });
  };
}

// ─── Writer attachment ────────────────────────────────────────────────────────

/**
 * Attach an HTTP response as an SSE stream writer to a session.
 * Handles: headers, replay from lastEventId, dedup, heartbeat, cleanup on close.
 */
export function attachSseWriter(session: SseCapableSession, res: any, lastEventId: number): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.socket?.setNoDelay?.(true);

  const replayHighWater = session.nextEventId;
  const sentEventIds = new Set<number>();

  const writer = (line: string) => {
    try {
      const match = line.match(/^data: (.+)$/);
      if (match) {
        const parsed = JSON.parse(match[1]);
        if (typeof parsed.eventId === "number" && parsed.eventId < replayHighWater) {
          return;
        }
        if (typeof parsed.eventId === "number") {
          if (sentEventIds.has(parsed.eventId)) return;
          sentEventIds.add(parsed.eventId);
        }
      }
      res.write(line); (res as any).flush?.();
    } catch {}
  };

  session.sseWriters.add(writer);

  const replayEvents = session.events.filter(e => e.eventId > lastEventId && e.eventId < replayHighWater);
  for (const event of replayEvents) {
    sentEventIds.add(event.eventId);
    try { res.write(`data: ${JSON.stringify({ ...event.data, replay: true })}\n\n`); (res as any).flush?.(); } catch {}
  }
  if (replayEvents.length > 0) {
    try { res.write(`data: ${JSON.stringify({ type: "replay_boundary" })}\n\n`); (res as any).flush?.(); } catch {}
  }

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); (res as any).flush?.(); } catch {}
  }, 2000);

  res.on("close", () => {
    session.sseWriters.delete(writer);
    clearInterval(heartbeat);
  });

  if (session.done) {
    setTimeout(() => {
      try { res.end(); } catch {}
    }, 100);
  }
}
