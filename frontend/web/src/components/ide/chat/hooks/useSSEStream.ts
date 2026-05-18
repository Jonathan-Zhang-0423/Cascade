export interface SseEvent {
  type: string;
  eventId?: number;
  replay?: boolean;
  [key: string]: unknown;
}

export interface ParseSseOptions<T extends SseEvent = SseEvent> {
  onEvent: (ev: T) => void | Promise<void>;
  onHeartbeat?: () => void;
  signal?: AbortSignal;
  validate?: (raw: SseEvent) => T;
}

export async function parseSseStream<T extends SseEvent = SseEvent>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: ParseSseOptions<T>,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (options.signal?.aborted) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === ": heartbeat" || trimmed.startsWith(": ")) {
        options.onHeartbeat?.();
        continue;
      }

      if (!trimmed.startsWith("data: ")) continue;
      const raw = trimmed.slice(6).trim();
      if (raw === "[DONE]") return;

      let parsed: SseEvent;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      const ev = options.validate ? options.validate(parsed) : (parsed as T);
      await options.onEvent(ev);
    }
  }
}

export interface HeartbeatWatchdog {
  reset: () => void;
  clear: () => void;
  timedOut: boolean;
}

export function createHeartbeatWatchdog(
  timeoutMs: number,
  onTimeout: () => void,
): HeartbeatWatchdog {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const state = { timedOut: false };

  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      state.timedOut = true;
      onTimeout();
    }, timeoutMs);
  };

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  reset();

  return {
    reset,
    clear,
    get timedOut() {
      return state.timedOut;
    },
  };
}

export interface ReconnectController {
  scheduleReconnect: (
    sessionId: string,
    lastEventId: number,
    checkStatus: (sessionId: string) => Promise<boolean>,
    reconnect: (sessionId: string, lastEventId: number) => void,
  ) => boolean;
  cancelReconnect: () => void;
  isReconnecting: boolean;
  retryCount: number;
}

export function createReconnectController(maxRetries: number): ReconnectController {
  let retryCount = 0;
  let reconnecting = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    scheduleReconnect(sessionId, lastEventId, checkStatus, reconnect) {
      if (retryCount >= maxRetries) return false;
      retryCount++;
      reconnecting = true;
      const backoffMs = Math.min(1000 * Math.pow(2, retryCount - 1), 16000);
      timer = setTimeout(async () => {
        timer = null;
        const active = await checkStatus(sessionId);
        if (!active) {
          reconnecting = false;
          return;
        }
        reconnect(sessionId, lastEventId);
      }, backoffMs);
      return true;
    },
    cancelReconnect() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      reconnecting = false;
      retryCount = 0;
    },
    get isReconnecting() {
      return reconnecting;
    },
    set isReconnecting(v: boolean) {
      reconnecting = v;
    },
    get retryCount() {
      return retryCount;
    },
    set retryCount(v: number) {
      retryCount = v;
    },
  };
}
