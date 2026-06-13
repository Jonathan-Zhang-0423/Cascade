import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useIDEStore } from "@/stores/ide-store";
import { useT } from "@/lib/i18n";

type Tab = "username" | "email" | "phone";
type Mode = "login" | "register";

export default function AuthPage() {
  const t = useT();
  const setUserId = useIDEStore((s) => s.setUserId);
  const setStoredUsername = useIDEStore((s) => s.setUsername);
  const [, setLocation] = useLocation();

  const [tab, setTab] = useState<Tab>("username");

  // Username/password state
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  // OTP state (shared between email + phone tabs, reset on tab switch)
  const [otpTarget, setOtpTarget] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpInviteCode, setOtpInviteCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const resendTimerRef = useRef<number | null>(null);

  // Forgot-password subview state (reuses otpTarget/otpCode/resendIn machinery).
  const [forgot, setForgot] = useState(false);
  const [forgotChannel, setForgotChannel] = useState<"email" | "sms">("email");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // GitHub callback may bounce us back with ?github_error=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("github_error")) {
      setError(t("auth.githubError"));
      const url = new URL(window.location.href);
      url.searchParams.delete("github_error");
      window.history.replaceState({}, "", url.toString());
    }
    // After setting a password the user is bounced here to re-login.
    if (params.has("passwordSet")) {
      setNotice(t("auth.setPasswordDone"));
      const url = new URL(window.location.href);
      url.searchParams.delete("passwordSet");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resend countdown
  useEffect(() => {
    if (resendIn <= 0) return;
    resendTimerRef.current = window.setInterval(() => {
      setResendIn((s) => Math.max(0, s - 1));
    }, 1000);
    return () => {
      if (resendTimerRef.current) window.clearInterval(resendTimerRef.current);
    };
  }, [resendIn > 0]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setError(null);
    setOtpCode("");
    setOtpInviteCode("");
    setOtpSent(false);
  };

  const validateOtpTarget = (): string | null => {
    if (tab === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(otpTarget.trim().toLowerCase())) {
        return t("auth.otpInvalidEmail");
      }
    } else if (tab === "phone") {
      if (!/^\+\d{8,15}$/.test(otpTarget.trim())) {
        return t("auth.otpInvalidPhone");
      }
    }
    return null;
  };

  const mapServerError = (msg: string): string => {
    const map: Record<string, string> = {
      "Username already taken": t("auth.usernameTaken"),
      "Invalid credentials": t("auth.invalidCredentials"),
      "username and password required": t("auth.fillBothFields"),
      "Invite code required": t("auth.inviteCodeRequired"),
      "Invalid invite code": t("auth.inviteCodeInvalid"),
      "Invite code already used": t("auth.inviteCodeUsed"),
      "Invite code expired": t("auth.inviteCodeExpired"),
      "Invalid email": t("auth.otpInvalidEmail"),
      "Invalid phone": t("auth.otpInvalidPhone"),
      "Invalid or expired code": t("auth.otpInvalidOrExpired"),
      "Code locked - request a new one": t("auth.otpLocked"),
      "Send rate-limited": t("auth.otpRateLimited"),
    };
    return map[msg] ?? t("auth.genericError");
  };

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim()) { setError(t("auth.usernameRequired")); return; }
    if (password.length < 6) { setError(t("auth.passwordTooShort")); return; }
    if (mode === "register" && !inviteCode.trim()) { setError(t("auth.inviteCodeRequired")); return; }

    setLoading(true);
    try {
      const body = mode === "register"
        ? { username, password, inviteCode }
        : { username, password };
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(mapServerError(data.error)); return; }
      setUserId(data.id);
      setStoredUsername(data.username);
      setLocation("/app");
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    const validationError = validateOtpTarget();
    if (validationError) { setError(validationError); return; }
    setError(null);
    setLoading(true);
    try {
      const channel = tab === "email" ? "email" : "sms";
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, target: otpTarget.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(mapServerError(data.error));
        if (typeof data.retryAfterSec === "number") setResendIn(data.retryAfterSec);
        return;
      }
      setOtpSent(true);
      setResendIn(data.retryAfterSec ?? 60);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(otpCode)) { setError(t("auth.otpInvalidCode")); return; }

    setLoading(true);
    try {
      const channel = tab === "email" ? "email" : "sms";
      const body: Record<string, string> = {
        channel,
        target: otpTarget.trim(),
        code: otpCode,
      };
      if (otpInviteCode.trim()) body.inviteCode = otpInviteCode.trim();
      const res = await fetch("/api/auth/otp/verify-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(mapServerError(data.error)); return; }
      setUserId(data.id);
      setStoredUsername(data.username);
      // 201 = a new account was just auto-created via OTP. Offer to add a
      // password before continuing. 200 = existing user logged in → straight to app.
      setLocation(res.status === 201 ? "/set-password" : "/app");
    } finally {
      setLoading(false);
    }
  };

  const handleGithubSignIn = () => {
    window.location.href = "/api/auth/github";
  };

  const openForgot = () => {
    setForgot(true);
    setForgotChannel("email");
    setError(null);
    setNotice(null);
    setOtpTarget("");
    setOtpCode("");
    setOtpSent(false);
    setResetNewPassword("");
    setResendIn(0);
  };

  const closeForgot = () => {
    setForgot(false);
    setError(null);
    setOtpCode("");
    setOtpSent(false);
    setResetNewPassword("");
  };

  const validateResetTarget = (): string | null => {
    if (forgotChannel === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(otpTarget.trim().toLowerCase())) return t("auth.otpInvalidEmail");
    } else if (!/^\+\d{8,15}$/.test(otpTarget.trim())) {
      return t("auth.otpInvalidPhone");
    }
    return null;
  };

  const handleResetSend = async () => {
    const validationError = validateResetTarget();
    if (validationError) { setError(validationError); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: forgotChannel, target: otpTarget.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(mapServerError(data.error));
        if (typeof data.retryAfterSec === "number") setResendIn(data.retryAfterSec);
        return;
      }
      setOtpSent(true);
      setResendIn(data.retryAfterSec ?? 60);
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(otpCode)) { setError(t("auth.otpInvalidCode")); return; }
    if (resetNewPassword.length < 6) { setError(t("auth.passwordTooShort")); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: forgotChannel,
          target: otpTarget.trim(),
          code: otpCode,
          password: resetNewPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(mapServerError(data.error)); return; }
      // Reset succeeded — return to the username/password login with a hint.
      setForgot(false);
      setTab("username");
      setMode("login");
      setOtpCode("");
      setOtpSent(false);
      setResetNewPassword("");
      setNotice(t("auth.resetSuccess"));
    } finally {
      setLoading(false);
    }
  };

  const channelLabel = tab === "email" ? t("auth.otpChannelEmail") : t("auth.otpChannelPhone");

  if (forgot) {
    const resetChannelLabel = forgotChannel === "email" ? t("auth.otpChannelEmail") : t("auth.otpChannelPhone");
    return (
      <div className="min-h-screen bg-[#080810] flex items-center justify-center">
        <div className="w-full max-w-md bg-[#0d1525] border border-[rgba(255,255,255,0.08)] rounded-2xl p-8 shadow-2xl">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-white">{t("auth.resetTitle")}</h1>
            <p className="mt-1 text-sm text-[rgba(255,255,255,0.4)]">{t("auth.resetSubtitle")}</p>
          </div>

          {/* Channel switcher (email / phone) */}
          <div className="grid grid-cols-2 gap-1 mb-5 p-1 bg-[rgba(255,255,255,0.04)] rounded-lg border border-[rgba(255,255,255,0.06)]">
            {(["email", "sms"] as const).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => { setForgotChannel(ch); setError(null); setOtpCode(""); setOtpSent(false); setOtpTarget(""); }}
                className={`text-xs py-1.5 rounded-md transition-colors ${
                  forgotChannel === ch ? "bg-[rgba(255,255,255,0.08)] text-white" : "text-[rgba(255,255,255,0.5)] hover:text-white"
                }`}
              >
                {ch === "email" ? t("auth.tabEmail") : t("auth.tabPhone")}
              </button>
            ))}
          </div>

          <form onSubmit={handleResetSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">
                {forgotChannel === "email" ? t("auth.emailLabel") : t("auth.phoneLabel")}
              </label>
              <div className="flex gap-2">
                <input
                  type={forgotChannel === "email" ? "email" : "tel"}
                  className="flex-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                  value={otpTarget}
                  onChange={(e) => setOtpTarget(e.target.value)}
                  placeholder={forgotChannel === "email" ? t("auth.emailPlaceholder") : t("auth.phonePlaceholder")}
                  autoComplete={forgotChannel === "email" ? "email" : "tel"}
                  required
                />
                <button
                  type="button"
                  onClick={handleResetSend}
                  disabled={loading || resendIn > 0 || !otpTarget.trim()}
                  className="px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] text-white text-xs font-medium hover:bg-[rgba(255,255,255,0.1)] disabled:opacity-40 whitespace-nowrap"
                >
                  {loading && !otpSent
                    ? t("auth.otpSending")
                    : resendIn > 0
                    ? t("auth.otpResendIn", { n: String(resendIn) })
                    : t("auth.otpSend")}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-[rgba(255,255,255,0.35)]">
                {t("auth.resetSendHint", { channel: resetChannelLabel })}
              </p>
            </div>

            <div>
              <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">{t("auth.otpCodeLabel")}</label>
              <input
                inputMode="numeric"
                maxLength={6}
                className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500 tracking-[0.5em]"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("auth.otpCodePlaceholder")}
                autoComplete="one-time-code"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">{t("auth.resetNewPasswordLabel")}</label>
              <input
                type="password"
                className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                placeholder={t("auth.setPasswordPlaceholder")}
                autoComplete="new-password"
                required
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-40 mt-2"
            >
              {loading ? "…" : t("auth.resetSubmit")}
            </button>
            <button
              type="button"
              onClick={closeForgot}
              className="w-full py-2 text-[rgba(255,255,255,0.5)] text-sm font-medium hover:text-white"
            >
              {t("auth.resetBackToLogin")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080810] flex items-center justify-center">
      <div className="w-full max-w-md bg-[#0d1525] border border-[rgba(255,255,255,0.08)] rounded-2xl p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">Cascade</h1>
          <p className="mt-1 text-sm text-[rgba(255,255,255,0.4)]">
            {tab === "username" && mode === "register"
              ? t("auth.registerSubtitle")
              : t("auth.signInSubtitle")}
          </p>
        </div>

        {notice && (
          <div className="mb-5 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-sm text-green-300">
            {notice}
          </div>
        )}

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

        {/* Tab switcher */}
        <div className="grid grid-cols-3 gap-1 mb-5 p-1 bg-[rgba(255,255,255,0.04)] rounded-lg border border-[rgba(255,255,255,0.06)]">
          {(["username", "email", "phone"] as Tab[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              className={`text-xs py-1.5 rounded-md transition-colors ${
                tab === id
                  ? "bg-[rgba(255,255,255,0.08)] text-white"
                  : "text-[rgba(255,255,255,0.5)] hover:text-white"
              }`}
            >
              {id === "username" ? t("auth.tabUsername") : id === "email" ? t("auth.tabEmail") : t("auth.tabPhone")}
            </button>
          ))}
        </div>

        {tab === "username" && (
          <form onSubmit={handleUsernameSubmit} className="flex flex-col gap-4">
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
              {mode === "login" && (
                <button
                  type="button"
                  onClick={openForgot}
                  className="mt-1.5 text-[11px] text-blue-400 hover:text-blue-300"
                >
                  {t("auth.forgotPassword")}
                </button>
              )}
            </div>

            {mode === "register" && (
              <div>
                <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">{t("auth.inviteCodeLabel")}</label>
                <input
                  className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500 tracking-widest"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder={t("auth.inviteCodePlaceholder")}
                  autoComplete="off"
                  required
                />
              </div>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-40 mt-2"
            >
              {loading ? "…" : mode === "login" ? t("auth.signIn") : t("auth.createAccount")}
            </button>

            <p className="text-center text-xs text-[rgba(255,255,255,0.35)]">
              {mode === "login" ? t("auth.noAccount") : t("auth.hasAccount")}
              <button
                type="button"
                onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
                className="text-blue-400 hover:text-blue-300"
              >
                {mode === "login" ? t("auth.signUp") : t("auth.signIn")}
              </button>
            </p>
          </form>
        )}

        {(tab === "email" || tab === "phone") && (
          <form onSubmit={handleOtpSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">
                {tab === "email" ? t("auth.emailLabel") : t("auth.phoneLabel")}
              </label>
              <div className="flex gap-2">
                <input
                  type={tab === "email" ? "email" : "tel"}
                  className="flex-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                  value={otpTarget}
                  onChange={(e) => setOtpTarget(e.target.value)}
                  placeholder={tab === "email" ? t("auth.emailPlaceholder") : t("auth.phonePlaceholder")}
                  autoComplete={tab === "email" ? "email" : "tel"}
                  required
                />
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={loading || resendIn > 0 || !otpTarget.trim()}
                  className="px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] text-white text-xs font-medium hover:bg-[rgba(255,255,255,0.1)] disabled:opacity-40 whitespace-nowrap"
                >
                  {loading && !otpSent
                    ? t("auth.otpSending")
                    : resendIn > 0
                    ? t("auth.otpResendIn", { n: String(resendIn) })
                    : t("auth.otpSend")}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">{t("auth.otpCodeLabel")}</label>
              <input
                inputMode="numeric"
                maxLength={6}
                className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500 tracking-[0.5em]"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("auth.otpCodePlaceholder")}
                autoComplete="one-time-code"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">{t("auth.inviteCodeLabel")}</label>
              <input
                className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500 tracking-widest"
                value={otpInviteCode}
                onChange={(e) => setOtpInviteCode(e.target.value)}
                placeholder={t("auth.inviteCodePlaceholder")}
                autoComplete="off"
              />
              <p className="mt-1 text-[10px] text-[rgba(255,255,255,0.35)]">
                {t("auth.otpInviteHint", { channel: channelLabel })}
              </p>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-40 mt-2"
            >
              {loading ? "…" : t("auth.otpSubmit")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
