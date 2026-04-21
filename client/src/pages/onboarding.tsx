import { useState } from "react";
import { useLocation } from "wouter";
import { useIDEStore } from "@/stores/ide-store";

type ExperienceLevel = "beginner" | "intermediate" | "advanced";

const LEVEL_OPTIONS: Array<{ value: ExperienceLevel; label: string; description: string }> = [
  { value: "beginner", label: "Beginner", description: "I'm new to coding or just getting started" },
  { value: "intermediate", label: "Intermediate", description: "I can build projects but still learning best practices" },
  { value: "advanced", label: "Advanced", description: "I write production code and know my way around a codebase" },
];

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const setUserId = useIDEStore((s) => s.setUserId);
  const [level, setLevel] = useState<ExperienceLevel>("intermediate");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/me/experience", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experienceLevel: level }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Something went wrong");
        return;
      }
      const data = await res.json();
      setUserId(data.id);
      setLocation("/");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080810] flex items-center justify-center">
      <div className="w-full max-w-md bg-[#0d1525] border border-[rgba(255,255,255,0.08)] rounded-2xl p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">One quick question</h1>
          <p className="mt-2 text-sm text-[rgba(255,255,255,0.4)]">
            This helps us tailor the AI's guidance to your experience level.
          </p>
        </div>

        <div className="flex flex-col gap-2 mb-6">
          {LEVEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setLevel(opt.value)}
              className={[
                "flex items-start gap-3 px-4 py-3 rounded-lg border text-left transition-colors",
                level === opt.value
                  ? "border-blue-500/60 bg-blue-600/10"
                  : "border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.2)]",
              ].join(" ")}
            >
              <span className={[
                "w-4 h-4 rounded-full border-2 shrink-0 mt-0.5",
                level === opt.value ? "border-blue-400 bg-blue-400" : "border-[rgba(255,255,255,0.3)]",
              ].join(" ")} />
              <div>
                <p className="text-sm font-medium text-white">{opt.label}</p>
                <p className="text-[11px] text-[rgba(255,255,255,0.4)]">{opt.description}</p>
              </div>
            </button>
          ))}
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-40"
        >
          {loading ? "Saving…" : "Get started"}
        </button>
      </div>
    </div>
  );
}
