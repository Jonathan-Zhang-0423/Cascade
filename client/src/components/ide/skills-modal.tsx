import { useState, useEffect } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { X, BookOpen, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Skill, SkillType } from "./skill-types";
import { useT } from "@/lib/i18n";

interface SkillsModalProps {
  skill: Skill | null;
  scope: "user" | "project";
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}

const DEFAULT_TOOL_JSON = JSON.stringify(
  {
    name: "my_tool",
    description: "Describe what this tool does",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "The input value" },
      },
      required: ["input"],
    },
    handler: {
      type: "shell",
      command: "echo {{input}}",
    },
  },
  null,
  2,
);

export function SkillsModal({ skill, scope, userId, onClose, onSaved }: SkillsModalProps) {
  const projectId = useIDEStore((s) => s.projectId);
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [type, setType] = useState<SkillType>(skill?.type ?? "knowledge");
  const [content, setContent] = useState(skill?.content ?? "");
  const [enabled] = useState(skill?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const t = useT();

  // Only auto-populate content when opening a fresh "new skill" form
  const isNew = !skill?.id;
  useEffect(() => {
    if (!isNew) return;
    if (type === "tool") {
      setContent((prev) => prev || DEFAULT_TOOL_JSON);
    } else {
      // Don't wipe user-edited content when switching away from tool
      setContent((prev) => prev === DEFAULT_TOOL_JSON ? "" : prev);
    }
    setJsonError(null);
  }, [type, isNew]);

  const validateJson = (val: string) => {
    try { JSON.parse(val); setJsonError(null); } catch (e) { setJsonError(String(e)); }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    if (type === "tool") { try { JSON.parse(content); } catch { return; } }
    setSaving(true);
    setSaveError(null);
    try {
      const body = { name: name.trim(), description, type, content, enabled, userId };
      let url: string;
      let method: string;
      if (skill?.id) {
        url = scope === "user"
          ? `/api/skills/user/${skill.id}`
          : `/api/skills/project/${projectId}/${skill.id}`;
        method = "PUT";
      } else {
        url = scope === "user"
          ? "/api/skills/user"
          : `/api/skills/project/${projectId}`;
        method = "POST";
      }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        const resBody = await res.json().catch(() => ({}));
        setSaveError((resBody as { error?: string }).error || t("skillsModal.saveError"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[560px] max-h-[80vh] flex flex-col bg-[#0d1525] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.06)]">
          <h2 className="text-sm font-semibold text-white">
            {skill?.id ? t("skillsModal.editTitle") : t("skillsModal.newTitle")}
          </h2>
          <button onClick={onClose} className="text-[rgba(255,255,255,0.4)] hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4 overflow-y-auto">
          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">{t("skillsModal.labelName")}</label>
            <input
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("skillsModal.placeholderName")}
            />
          </div>

          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">{t("skillsModal.labelDesc")}</label>
            <input
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("skillsModal.placeholderDesc")}
            />
          </div>

          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">{t("skillsModal.labelType")}</label>
            <div className="flex gap-2">
              {(["knowledge", "tool"] as SkillType[]).map((tp) => (
                <button
                  key={tp}
                  onClick={() => { setType(tp); setJsonError(null); }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border",
                    type === tp
                      ? "bg-blue-600/20 border-blue-500/50 text-blue-300"
                      : "border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.4)] hover:text-white"
                  )}
                >
                  {tp === "knowledge" ? <BookOpen className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                  {tp === "knowledge" ? t("skillsModal.typeKnowledge") : t("skillsModal.typeTool")}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1">
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">
              {type === "knowledge" ? t("skillsModal.labelMarkdown") : t("skillsModal.labelJson")}
            </label>
            <textarea
              className={cn(
                "w-full h-48 bg-[rgba(255,255,255,0.04)] border rounded-md px-3 py-2 text-xs text-white font-mono outline-none resize-none",
                jsonError ? "border-red-500/60 focus:border-red-500" : "border-[rgba(255,255,255,0.08)] focus:border-blue-500"
              )}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                if (type === "tool") validateJson(e.target.value);
              }}
              placeholder={type === "knowledge" ? t("skillsModal.placeholderMarkdown") : ""}
              spellCheck={false}
            />
            {jsonError && (
              <p className="mt-1 text-[10px] text-red-400">{jsonError}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[rgba(255,255,255,0.06)]">
          {saveError && <p className="text-[10px] text-red-400 mr-auto">{saveError}</p>}
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-xs text-[rgba(255,255,255,0.5)] hover:text-white border border-[rgba(255,255,255,0.08)]"
          >
            {t("skillsModal.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || (type === "tool" && !!jsonError)}
            className="px-4 py-1.5 rounded-md text-xs bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {saving ? t("skillsModal.saving") : t("skillsModal.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
