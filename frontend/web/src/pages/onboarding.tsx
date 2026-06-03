import { useState } from "react";
import { useLocation } from "wouter";
import { useIDEStore } from "@/stores/ide-store";
import { useT } from "@/lib/i18n";

type ExperienceLevel = "beginner" | "intermediate" | "advanced";

export default function OnboardingPage() {
  const t = useT();
  const [, setLocation] = useLocation();
  const setUserId = useIDEStore((s) => s.setUserId);
  const setUsername = useIDEStore((s) => s.setUsername);
  const [level, setLevel] = useState<ExperienceLevel>("intermediate");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const LEVEL_OPTIONS: Array<{ value: ExperienceLevel; label: string; description: string }> = [
    { value: "beginner", label: t("onboarding.beginnerLabel"), description: t("onboarding.beginnerDesc") },
    { value: "intermediate", label: t("onboarding.intermediateLabel"), description: t("onboarding.intermediateDesc") },
    { value: "advanced", label: t("onboarding.advancedLabel"), description: t("onboarding.advancedDesc") },
  ];

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
        setError(data.error ?? t("onboarding.genericError"));
        return;
      }
      const data = await res.json();
      setUserId(data.id);
      setUsername(data.username);
      setLocation("/app");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080810] flex items-center justify-center">
      <div className="w-full max-w-md bg-[#0d1525] border border-[rgba(255,255,255,0.08)] rounded-2xl p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">{t("onboarding.title")}</h1>
          <p className="mt-2 text-sm text-[rgba(255,255,255,0.4)]">
            {t("onboarding.subtitle")}
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
          {loading ? t("onboarding.saving") : t("onboarding.getStarted")}
        </button>
      </div>
    </div>
  );
}
