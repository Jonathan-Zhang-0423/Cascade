import { useState } from "react";
import { useIDEStore } from "@/stores/ide-store";

type Mode = "login" | "register";
type ExperienceLevel = "beginner" | "intermediate" | "advanced";

const LEVEL_OPTIONS: Array<{ value: ExperienceLevel; label: string; description: string }> = [
  { value: "beginner", label: "Beginner", description: "I'm new to coding or just getting started" },
  { value: "intermediate", label: "Intermediate", description: "I can build projects but still learning best practices" },
  { value: "advanced", label: "Advanced", description: "I write production code and know my way around a codebase" },
];

export default function AuthPage() {
  const setUserId = useIDEStore((s) => s.setUserId);
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [level, setLevel] = useState<ExperienceLevel>("intermediate");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = mode === "register"
        ? { username, password, experienceLevel: level }
        : { username, password };
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong"); return; }
      setUserId(data.id);
      window.location.href = "/";
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080810] flex items-center justify-center">
      <div className="w-full max-w-md bg-[#0d1525] border border-[rgba(255,255,255,0.08)] rounded-2xl p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">Cascade</h1>
          <p className="mt-1 text-sm text-[rgba(255,255,255,0.4)]">
            {mode === "login" ? "Sign in to continue" : "Create your account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">Username</label>
            <input
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">Password</label>
            <input
              type="password"
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-2">
                How much programming experience do you have?
              </label>
              <div className="flex flex-col gap-2">
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
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-40 mt-2"
          >
            {loading ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[rgba(255,255,255,0.35)]">
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <button
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
            className="text-blue-400 hover:text-blue-300"
          >
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
