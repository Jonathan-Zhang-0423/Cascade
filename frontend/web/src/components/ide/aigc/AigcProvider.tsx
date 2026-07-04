// AIGC state provider — lifted ABOVE the desktop/mobile split in pages/ide.tsx
// so the AIGC card state (mediaStatus), the useMediaTrigger hook instance, and
// its EventSource/poll handles survive desktop↔mobile shell switches. Both the
// desktop ChatPanel and the mobile ChatPanel (via MobileChatPanel) consume this
// same context, so AIGC works on both shells and isn't torn down on resize.
//
// Long-term pattern: feature state that must span PC + mobile should live in a
// provider mounted above the `if (isMobile)` early return, not inside a shell.

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { useMediaTrigger, type MediaTriggerStatus } from "@/components/ide/chat/hooks/useMediaTrigger";
import { streamRegistry } from "@/services/stream";

interface AigcContextValue {
  mediaStatus: MediaTriggerStatus;
  tryIntercept: (text: string) => boolean;
  resetMedia: () => void;
  submitStyle: (style: string) => void;
}

const AigcContext = createContext<AigcContextValue | null>(null);

export function AigcProvider({ children }: { children: ReactNode }) {
  const projectId = useIDEStore((s) => s.projectId);
  const addManagerMessage = useIDEStore((s) => s.addManagerMessage);
  const setManagerResponding = useIDEStore((s) => s.setManagerResponding);

  const [mediaStatus, setMediaStatus] = useState<MediaTriggerStatus>({ phase: "idle" });

  // Late-bound abort for the manager stream — read slot imperatively at call
  // time (avoids a second useActiveStream subscription + its reconnect effect).
  const abortManagerRef = useRef<() => void>(() => {});
  const abortManager = useCallback(() => abortManagerRef.current(), []);

  const onUserMessage = useCallback((content: string) => {
    addManagerMessage({ role: "user", content });
  }, [addManagerMessage]);

  const onMessage = useCallback((content: string, role?: "assistant" | "system") => {
    // ManagerMessage has no "system" role — normalize to "assistant".
    void role;
    addManagerMessage({ role: "assistant", content });
  }, [addManagerMessage]);

  const onStatus = useCallback((s: MediaTriggerStatus) => {
    setMediaStatus(s);
    // Drive the same state MVP's TypingIndicator animation reads, so the
    // opening animation shows for AIGC triggers just like normal sends.
    if (s.phase === "generating" || s.phase === "classifying") {
      setManagerResponding(true);
    } else {
      setManagerResponding(false);
    }
  }, [setManagerResponding]);

  const { tryIntercept, reset: resetMedia, submitStyle } = useMediaTrigger({
    projectId: projectId ?? undefined,
    onStatus,
    onUserMessage,
    onMessage,
    abortManager,
  });

  // Keep the abort binding fresh as projectId/sessionId change. Reading the
  // slot via getState() at call time would also work, but binding here lets the
  // effect close over the current ids without subscribing to stream state.
  useEffect(() => {
    abortManagerRef.current = () => {
      const { projectId: pid, currentSessionId: sid } = useIDEStore.getState();
      if (pid) {
        try { streamRegistry.get(pid, sid).manager.abort(); } catch {}
      }
      setManagerResponding(false);
    };
  }, [setManagerResponding]);

  return (
    <AigcContext.Provider value={{ mediaStatus, tryIntercept, resetMedia, submitStyle }}>
      {children}
    </AigcContext.Provider>
  );
}

export function useAigc(): AigcContextValue {
  const ctx = useContext(AigcContext);
  if (!ctx) throw new Error("useAigc must be used within AigcProvider");
  return ctx;
}
