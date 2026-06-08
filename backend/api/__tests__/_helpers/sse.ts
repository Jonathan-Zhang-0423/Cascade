/**
 * SSE client helpers for streaming-route tests. Parses `data:` frames out of a
 * fetch Response body, supports mid-stream abort + reconnect with Last-Event-ID,
 * and collects the event sequence for assertions.
 */

export interface SseEvent {
  data: any;
  raw: string;
}

/**
 * Consume an SSE response until `until` returns true, the stream ends, or the
 * timeout elapses. Returns all parsed data events. Ignores heartbeats/comments.
 */
export async function collectSse(
  res: Response,
  opts: { until?: (ev: SseEvent, all: SseEvent[]) => boolean; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  if (!res.body) return events;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;

  try {
    while (true) {
      if (Date.now() > deadline) break;
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value?: Uint8Array; done: boolean }>((resolve) =>
          setTimeout(() => resolve({ done: true }), Math.max(0, deadline - Date.now())),
        ),
      ]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLines = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue; // comment/heartbeat
        const raw = dataLines.join("\n");
        let data: any = raw;
        try {
          data = JSON.parse(raw);
        } catch {
          /* keep raw */
        }
        const ev: SseEvent = { data, raw };
        events.push(ev);
        if (opts.until?.(ev, events)) {
          await reader.cancel().catch(() => {});
          return events;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return events;
}

/** Extract the numeric eventId fields seen in a collected event list. */
export function eventIds(events: SseEvent[]): number[] {
  return events.map((e) => e?.data?.eventId).filter((x) => typeof x === "number");
}

/** Find the first event matching a `type`. */
export function firstOfType(events: SseEvent[], type: string): SseEvent | undefined {
  return events.find((e) => e?.data?.type === type);
}

/** Count events of a given `type`. */
export function countOfType(events: SseEvent[], type: string): number {
  return events.filter((e) => e?.data?.type === type).length;
}
