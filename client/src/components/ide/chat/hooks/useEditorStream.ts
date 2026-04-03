import { useState, useRef, useCallback } from "react";
import {
  useIDEStore,
  type AIProvider,
  flattenFiles,
} from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useLLMMonitorStore } from "@/stores/llm-monitor-store";
import { useLanguageStore } from "@/stores/language-store";
import { tr } from "@/lib/i18n";
import { PROJECT_NAME_REGEX, validateEditorEvent } from "../chat-types";
import type { EditorSseEvent } from "../chat-types";
import { stripProjectNameMarker } from "../chat-utils";
import { parseSseStream } from "./useSSEStream";

export function useEditorStream() {
  const {
    addChatMessage,
    updateLastAssistantMessage,
    setAiResponding,
    isAiResponding,
    isManagerResponding,
    files,
    projectId,
    refreshPreview,
    createCheckpoint,
  } = useIDEStore();
  const { renameProject } = useProjectStore();

  const editorAbortRef = useRef<AbortController | null>(null);
  const [smartResponseLoading, setSmartResponseLoading] = useState(false);
  const [providers, setProviders] = useState<{
    doubao: boolean;
    kimi: boolean;
    minimax: boolean;
    glm: boolean;
  }>({ doubao: true, kimi: false, minimax: false, glm: false });

  const applyCodeBlock = useCallback(
    async (block: { filePath: string; code: string }) => {
      const currentState = useIDEStore.getState();
      const currentFiles = flattenFiles(currentState.files);
      const exists = currentFiles.some((f) => f.path === block.filePath);
      if (exists) {
        currentState.updateFileContent(block.filePath, block.code);
      } else {
        const lastSlash = block.filePath.lastIndexOf("/");
        if (lastSlash > 0) {
          const parentPath = block.filePath.substring(0, lastSlash);
          const fileName = block.filePath.substring(lastSlash + 1);
          currentState.addFile(parentPath, fileName, "file");
          await new Promise((r) => setTimeout(r, 80));
          useIDEStore
            .getState()
            .updateFileContent(block.filePath, block.code);
        }
      }
    },
    [],
  );

  const handleEditorSend = useCallback(async (inputText: string) => {
    const trimmed = inputText.trim();
    if (!trimmed || isAiResponding || isManagerResponding) return;

    const priorMsgs = useIDEStore.getState().chatMessages;
    const isFirstUserMessage = !priorMsgs.some((m) => m.role === "user");

    const messagesForApi = [
      ...priorMsgs
        .filter(
          (m) => (m.role === "user" || m.role === "assistant") && m.content,
        )
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      { role: "user" as const, content: trimmed },
    ];

    addChatMessage({ role: "user", content: trimmed });
    addChatMessage({ role: "assistant", content: "" });
    setAiResponding(true);

    const allFiles = flattenFiles(files);
    const fileContext = allFiles.map((f) => ({
      path: f.path,
      content: f.content || "",
    }));

    const controller = new AbortController();
    editorAbortRef.current = controller;

    let accumulated = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messagesForApi,
          files: fileContext,
          provider: useIDEStore.getState().selectedProvider,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        updateLastAssistantMessage(
          tr(useLanguageStore.getState().lang, "chat.errorConnect"),
        );
        return;
      }

      const reader = response.body.getReader();

      await parseSseStream<EditorSseEvent>(reader, {
        signal: controller.signal,
        validate: validateEditorEvent,
        onEvent: async (ev) => {
          if (
            ev.type === "narration_token" &&
            typeof ev.token === "string"
          ) {
            accumulated += ev.token;
            useLLMMonitorStore
              .getState()
              .addEvent("editor-chat", "editor_token", ev.token);
            updateLastAssistantMessage(
              stripProjectNameMarker(accumulated),
            );
            await new Promise<void>((r) => setTimeout(r, 0));
          } else if (
            ev.type === "thinking_token" &&
            typeof ev.token === "string"
          ) {
            useLLMMonitorStore
              .getState()
              .addEvent("editor-chat", "thinking_token", ev.token);
          } else if (
            ev.type === "code_applied" &&
            typeof ev.filePath === "string" &&
            typeof ev.code === "string"
          ) {
            await applyCodeBlock({
              filePath: ev.filePath,
              code: ev.code,
            });
          } else if (ev.type === "action_log") {
            useLLMMonitorStore
              .getState()
              .addEvent(
                "editor-chat",
                "action_log",
                JSON.stringify(ev),
              );
          }
        },
      });

      if (isFirstUserMessage && projectId) {
        const nameFromMarker = accumulated
          .match(PROJECT_NAME_REGEX)?.[1]
          ?.trim();
        if (nameFromMarker && projectId)
          renameProject(projectId, nameFromMarker);
      }

      const stripped = stripProjectNameMarker(accumulated);
      updateLastAssistantMessage(stripped);
      createCheckpoint("AI response");
    } catch (error: unknown) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      if (isAbort) {
        if (!accumulated) {
          const msgs = useIDEStore.getState().chatMessages;
          const lastIdx = msgs.length - 1;
          if (
            lastIdx >= 0 &&
            msgs[lastIdx].role === "assistant" &&
            msgs[lastIdx].content === ""
          ) {
            useIDEStore.setState({ chatMessages: msgs.slice(0, lastIdx) });
          }
        }
      } else {
        updateLastAssistantMessage(
          tr(useLanguageStore.getState().lang, "chat.errorConnect"),
        );
      }
    } finally {
      if (editorAbortRef.current === controller) editorAbortRef.current = null;
      setAiResponding(false);
    }
  }, [
    isAiResponding,
    isManagerResponding,
    files,
    addChatMessage,
    updateLastAssistantMessage,
    setAiResponding,
    projectId,
    renameProject,
    createCheckpoint,
    applyCodeBlock,
  ]);

  return {
    handleEditorSend,
    editorAbortRef,
    smartResponseLoading,
    setSmartResponseLoading,
    providers,
    setProviders,
  };
}
