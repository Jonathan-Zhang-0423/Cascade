import { useState } from "react";
import { useLocation } from "wouter";
import { useT } from "@/lib/i18n";

/**
 * Post-registration "add a password" step for OTP-registered users (who have
 * no password yet). Optional — the user can skip and continue with OTP login.
 * Setting a password destroys the session server-side (force re-login), so on
 * success we bounce to /login with a hint.
 */
export default function SetPasswordPage() {
  const t = useT();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (password.length < 6) { setError(t("auth.passwordTooShort")); return; }
    if (password !== confirm) { setError(t("auth.setPasswordMismatch")); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t("auth.genericError"));
        return;
      }
      // Session was destroyed server-side — go log in with the new credential.
      setLocation("/login?passwordSet=1");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => setLocation("/app");

  return (
    <div className="min-h-screen bg-[#080810] flex items-center justify-center">
      <div className="w-full max-w-md bg-[#0d1525] border border-[rgba(255,255,255,0.08)] rounded-2xl p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">{t("auth.setPasswordTitle")}</h1>
          <p className="mt-2 text-sm text-[rgba(255,255,255,0.4)]">
            {t("auth.setPasswordSubtitle")}
          </p>
        </div>

        <div className="flex flex-col gap-3 mb-6">
          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">
              {t("auth.passwordLabel")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("auth.setPasswordPlaceholder")}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] text-white text-sm placeholder:text-[rgba(255,255,255,0.25)] focus:outline-none focus:border-blue-500/60"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">
              {t("auth.setPasswordConfirmLabel")}
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t("auth.setPasswordConfirmPlaceholder")}
              autoComplete="new-password"
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              className="w-full px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] text-white text-sm placeholder:text-[rgba(255,255,255,0.25)] focus:outline-none focus:border-blue-500/60"
            />
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-40"
        >
          {loading ? t("auth.setPasswordSaving") : t("auth.setPasswordSubmit")}
        </button>
        <button
          onClick={handleSkip}
          disabled={loading}
          className="w-full mt-2 py-2.5 rounded-lg text-[rgba(255,255,255,0.5)] text-sm font-medium hover:text-white disabled:opacity-40"
        >
          {t("auth.setPasswordSkip")}
        </button>
      </div>
    </div>
  );
}
