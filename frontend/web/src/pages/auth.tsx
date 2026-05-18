import { useState } from "react";
import { useLocation } from "wouter";
import { useIDEStore } from "@/stores/ide-store";
import { useT } from "@/lib/i18n";

type Mode = "login" | "register";

export default function AuthPage() {
  const t = useT();
  const setUserId = useIDEStore((s) => s.setUserId);
  const setStoredUsername = useIDEStore((s) => s.setUsername);
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) { setError(t("auth.usernameRequired")); return; }
    if (password.length < 6) { setError(t("auth.passwordTooShort")); return; }

    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        const knownErrors: Record<string, string> = {
          "Username already taken": t("auth.usernameTaken"),
          "Invalid credentials": t("auth.invalidCredentials"),
          "username and password required": t("auth.fillBothFields"),
        };
        setError(knownErrors[data.error] ?? t("auth.genericError"));
        return;
      }
      setUserId(data.id);
      setStoredUsername(data.username);
      setLocation("/");
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
            {mode === "login" ? t("auth.signInSubtitle") : t("auth.registerSubtitle")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">{t("auth.usernameLabel")}</label>
            <input
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("auth.usernamePlaceholder")}
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">{t("auth.passwordLabel")}</label>
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

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-40 mt-2"
          >
            {loading ? "…" : mode === "login" ? t("auth.signIn") : t("auth.createAccount")}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[rgba(255,255,255,0.35)]">
          {mode === "login" ? t("auth.noAccount") : t("auth.hasAccount")}
          <button
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
            className="text-blue-400 hover:text-blue-300"
          >
            {mode === "login" ? t("auth.signUp") : t("auth.signIn")}
          </button>
        </p>
      </div>
    </div>
  );
}
