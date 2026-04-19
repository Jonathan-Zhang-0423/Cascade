import { useState, useEffect } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { Plus, Pencil, Trash2, BookOpen, Wrench, ToggleLeft, ToggleRight } from "lucide-react";
import { cn } from "@/lib/utils";

type SkillType = "knowledge" | "tool";

interface Skill {
  id: number;
  name: string;
  description: string;
  type: SkillType;
  content: string;
  enabled: boolean;
}

interface SkillsPanelProps {
  onEdit: (skill: Skill | null, scope: "user" | "project") => void;
}

export function SkillsPanel({ onEdit }: SkillsPanelProps) {
  const projectId = useIDEStore((s) => s.projectId);
  // TODO (Task 7): replace with real userId from store once added
  const userId: string | null = null;
  const [userSkillsList, setUserSkillsList] = useState<Skill[]>([]);
  const [projectSkillsList, setProjectSkillsList] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSkills = async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [uRes, pRes] = await Promise.all([
        fetch(`/api/skills/user?userId=${encodeURIComponent(userId)}`),
        projectId ? fetch(`/api/skills/project/${projectId}?userId=${encodeURIComponent(userId)}`) : Promise.resolve(null),
      ]);
      if (uRes.ok) setUserSkillsList(await uRes.json());
      if (pRes?.ok) setProjectSkillsList(await pRes.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSkills(); }, [projectId, userId]);

  const toggleSkill = async (skill: Skill, scope: "user" | "project") => {
    const url = scope === "user"
      ? `/api/skills/user/${skill.id}`
      : `/api/skills/project/${projectId}/${skill.id}`;
    await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !skill.enabled, userId }),
    });
    fetchSkills();
  };

  const deleteSkill = async (skill: Skill, scope: "user" | "project") => {
    if (!confirm(`Delete skill "${skill.name}"?`)) return;
    const url = scope === "user"
      ? `/api/skills/user/${skill.id}?userId=${encodeURIComponent(userId ?? "")}`
      : `/api/skills/project/${projectId}/${skill.id}?userId=${encodeURIComponent(userId ?? "")}`;
    await fetch(url, { method: "DELETE" });
    fetchSkills();
  };

  const SkillRow = ({ skill, scope }: { skill: Skill; scope: "user" | "project" }) => (
    <div className={cn(
      "flex items-start gap-2 px-3 py-2 rounded-md group",
      "hover:bg-[rgba(255,255,255,0.04)]",
      !skill.enabled && "opacity-40"
    )}>
      <div className="mt-0.5 shrink-0 text-[rgba(255,255,255,0.4)]">
        {skill.type === "tool" ? <Wrench className="w-3.5 h-3.5" /> : <BookOpen className="w-3.5 h-3.5" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[rgba(255,255,255,0.85)] truncate">{skill.name}</p>
        {skill.description && (
          <p className="text-[10px] text-[rgba(255,255,255,0.35)] truncate">{skill.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={() => toggleSkill(skill, scope)}
          className="p-0.5 rounded hover:text-blue-400 text-[rgba(255,255,255,0.4)]"
          title={skill.enabled ? "Disable" : "Enable"}
        >
          {skill.enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => onEdit(skill, scope)}
          className="p-0.5 rounded hover:text-blue-400 text-[rgba(255,255,255,0.4)]"
          title="Edit"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={() => deleteSkill(skill, scope)}
          className="p-0.5 rounded hover:text-red-400 text-[rgba(255,255,255,0.4)]"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  const Section = ({
    title,
    skills,
    scope,
  }: {
    title: string;
    skills: Skill[];
    scope: "user" | "project";
  }) => (
    <div className="mb-4">
      <div className="flex items-center justify-between px-3 mb-1">
        <span className="text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.3)] font-semibold">
          {title}
        </span>
        <button
          onClick={() => onEdit(null, scope)}
          className="flex items-center gap-0.5 text-[10px] text-[rgba(255,255,255,0.35)] hover:text-blue-400"
        >
          <Plus className="w-3 h-3" /> New
        </button>
      </div>
      {skills.length === 0 ? (
        <p className="px-3 text-[10px] text-[rgba(255,255,255,0.2)] italic">No skills yet</p>
      ) : (
        skills.map((s) => <SkillRow key={s.id} skill={s} scope={scope} />)
      )}
    </div>
  );

  if (loading) {
    return <div className="p-3 text-xs text-[rgba(255,255,255,0.3)]">Loading skills…</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto py-2">
      {projectId && <Section title="Project Skills" skills={projectSkillsList} scope="project" />}
      <Section title="My Skills" skills={userSkillsList} scope="user" />
    </div>
  );
}
