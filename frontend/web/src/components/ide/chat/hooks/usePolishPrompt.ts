import { useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import { useIDEStore } from "@/stores/ide-store";

export function usePolishPrompt(
  chatMode: string,
  chatMessages: { role: string; content: string; hidden?: boolean; typing?: boolean }[],
  managerMessages: { role: string; content: string; hidden?: boolean; typing?: boolean }[],
  input: string,
  setPolishLoading: (v: boolean) => void,
  setPolishResult: (v: { original: string; polished: string } | null) => void,
) {
  return useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const validRoles = new Set(["user", "assistant"]);
    const msgs = (chatMode === "manager" ? managerMessages : chatMessages)
      .filter(
        (m) =>
          !m.hidden &&
          !m.typing &&
          validRoles.has(m.role) &&
          m.content?.trim(),
      )
      .slice(-6)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const hasChinese = /[一-鿿]/.test(trimmed);
    const language = hasChinese ? "Chinese" : "English";
    const framework = useIDEStore.getState().projectFramework || undefined;

    setPolishLoading(true);
    try {
      const res = await fetch("/api/polish-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed, messages: msgs, mode: chatMode, framework, language }),
      });
      const data = await res.json();
      if (data.polished) {
        setPolishResult({ original: trimmed, polished: data.polished });
      } else if (data.error) {
        toast({ title: "Polish failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Polish failed", description: "Network error", variant: "destructive" });
    } finally {
      setPolishLoading(false);
    }
  }, [chatMode, chatMessages, managerMessages, input, setPolishLoading, setPolishResult]);
}
