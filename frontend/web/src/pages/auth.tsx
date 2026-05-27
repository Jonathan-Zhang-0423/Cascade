import { useEffect, useState } from "react";
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

  // The GitHub callback redirects back to /auth?github_error=<reason> when
  // OAuth fails. Surface it as a normal error message so the user knows.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("github_error")) {
      setError(t("auth.githubError"));
      const url = new URL(window.location.href);
      url.searchParams.delete("github_error");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleGithubSignIn = () => {
    // Full-page navigation so the browser handles GitHub's redirect chain
    // and the session cookie set by the callback is sent back on return.
    window.location.href = "/api/auth/github";
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

        <button
          type="button"
          onClick={handleGithubSignIn}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] text-white text-sm font-medium hover:bg-[rgba(255,255,255,0.1)]"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-.99-.02-1.95-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18a10.95 10.95 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z"/>
          </svg>
          {t("auth.continueWithGithub")}
        </button>

        <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.3)]">
          <div className="flex-1 h-px bg-[rgba(255,255,255,0.08)]" />
          {t("auth.or")}
          <div className="flex-1 h-px bg-[rgba(255,255,255,0.08)]" />
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
