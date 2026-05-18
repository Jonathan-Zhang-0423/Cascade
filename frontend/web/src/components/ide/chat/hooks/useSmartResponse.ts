import { useCallback } from "react";
import { toast } from "@/hooks/use-toast";

export function useSmartResponse(
  chatMode: string,
  chatMessages: { role: string; content: string; hidden?: boolean; typing?: boolean }[],
  managerMessages: { role: string; content: string; hidden?: boolean; typing?: boolean }[],
  setInput: (v: string) => void,
  setSmartResponseLoading: (v: boolean) => void,
) {
  return useCallback(async () => {
    const validRoles = new Set(["user", "assistant"]);
    const msgs = (chatMode === "manager" ? managerMessages : chatMessages)
      .filter(
        (m) =>
          !m.hidden &&
          !m.typing &&
          validRoles.has(m.role) &&
          m.content?.trim(),
      )
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    if (msgs.length === 0) return;

    const hasChinese = msgs.some((m) => /[\u4e00-\u9fff]/.test(m.content));
    const language = hasChinese ? "Chinese" : "English";

    setSmartResponseLoading(true);
    try {
      const res = await fetch("/api/smart-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, mode: chatMode, language }),
      });
      const data = await res.json();
      if (data.suggestion) {
        setInput(data.suggestion);
      } else if (data.error) {
        toast({
          title: "Smart response failed",
          description: data.error,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Smart response failed",
        description: "Network error",
        variant: "destructive",
      });
    } finally {
      setSmartResponseLoading(false);
    }
  }, [chatMode, chatMessages, managerMessages, setInput, setSmartResponseLoading]);
}
