import { useState, useEffect } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { X, BookOpen, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

type SkillType = "knowledge" | "tool";

interface Skill {
  id?: number;
  name: string;
  description: string;
  type: SkillType;
  content: string;
  enabled: boolean;
}

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
  const [saving, setSaving] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (!skill && type === "tool" && !content) setContent(DEFAULT_TOOL_JSON);
    if (!skill && type === "knowledge") setContent("");
  }, [type]);

  const validateJson = (val: string) => {
    try { JSON.parse(val); setJsonError(null); } catch (e) { setJsonError(String(e)); }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    if (type === "tool") { try { JSON.parse(content); } catch { return; } }
    setSaving(true);
    try {
      const body = { name: name.trim(), description, type, content, enabled: true, userId };
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
      if (res.ok) { onSaved(); onClose(); }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[560px] max-h-[80vh] flex flex-col bg-[#0d1525] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.06)]">
          <h2 className="text-sm font-semibold text-white">
            {skill?.id ? "Edit Skill" : "New Skill"}
          </h2>
          <button onClick={onClose} className="text-[rgba(255,255,255,0.4)] hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-5 py-4 overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">Name</label>
            <input
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-skill"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">Description</label>
            <input
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this skill do?"
            />
          </div>

          {/* Type selector */}
          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">Type</label>
            <div className="flex gap-2">
              {(["knowledge", "tool"] as SkillType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border",
                    type === t
                      ? "bg-blue-600/20 border-blue-500/50 text-blue-300"
                      : "border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.4)] hover:text-white"
                  )}
                >
                  {t === "knowledge" ? <BookOpen className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                  {t === "knowledge" ? "Knowledge Pack" : "Tool Plugin"}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1">
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">
              {type === "knowledge" ? "Markdown Content" : "Tool Definition (JSON)"}
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
              placeholder={type === "knowledge" ? "# My Skill\n\nWrite your guidance here..." : ""}
              spellCheck={false}
            />
            {jsonError && (
              <p className="mt-1 text-[10px] text-red-400">{jsonError}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[rgba(255,255,255,0.06)]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-xs text-[rgba(255,255,255,0.5)] hover:text-white border border-[rgba(255,255,255,0.08)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || (type === "tool" && !!jsonError)}
            className="px-4 py-1.5 rounded-md text-xs bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save Skill"}
          </button>
        </div>
      </div>
    </div>
  );
}
