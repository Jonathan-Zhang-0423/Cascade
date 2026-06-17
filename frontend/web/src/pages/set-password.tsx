import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useT } from "@/lib/i18n";
import cascadeLogo from "../assets/cascade-logo.png";

// ── Font (matches landing page) ─────────────────────────────────────────────
const fontStyle = `
  @font-face {
    font-family: "Inter";
    src: url("/fonts/Inter-Medium.ttf") format("truetype");
    font-weight: 100 900;
    font-style: normal;
    font-display: swap;
  }
`;
if (typeof document !== "undefined") {
  const existing = document.getElementById("cascade-font");
  if (!existing) {
    const style = document.createElement("style");
    style.id = "cascade-font";
    style.textContent = fontStyle;
    document.head.appendChild(style);
  }
}

const FONT = '"Inter", "Helvetica Neue", system-ui, sans-serif';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const inputCls =
  "w-full bg-white border border-black/[0.12] rounded-xl px-4 py-3 text-[14px] text-gray-900 outline-none placeholder:text-gray-400 transition-all duration-200 focus:border-black focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)]";

const labelCls = "block text-[12px] font-medium text-gray-600 mb-1.5";

// ── Password strength indicator ──────────────────────────────────────────────
function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;

  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;

  const bars = [
    score >= 1 ? (score <= 1 ? "bg-red-400" : score === 2 ? "bg-amber-400" : "bg-green-400") : "bg-black/[0.08]",
    score >= 2 ? (score === 2 ? "bg-amber-400" : "bg-green-400") : "bg-black/[0.08]",
    score >= 3 ? "bg-green-400" : "bg-black/[0.08]",
    score >= 4 ? "bg-green-400" : "bg-black/[0.08]",
  ];

  const label = score <= 1 ? "弱" : score === 2 ? "一般" : score === 3 ? "较强" : "强";
  const labelColor = score <= 1 ? "text-red-500" : score === 2 ? "text-amber-500" : "text-green-500";

  return (
    <div className="mt-2">
      <div className="flex gap-1 mb-1">
        {bars.map((cls, i) => (
          <div key={i} className={`flex-1 h-1 rounded-full transition-all duration-300 ${cls}`} />
        ))}
      </div>
      <p className={`text-[11px] font-medium ${labelColor}`}>密码强度：{label}</p>
    </div>
  );
}

// ── Error message ────────────────────────────────────────────────────────────
function ErrorMsg({ msg }: { msg: string | null }) {
  return (
    <AnimatePresence>
      {msg && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="text-[13px] text-red-500 flex items-center gap-1.5"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0">
            <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6.5 4v3M6.5 9v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {msg}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/**
 * Post-registration "add a password" step for OTP-registered users.
 * Optional — the user can skip and continue with OTP login.
 * Setting a password destroys the session server-side (force re-login).
 */
export default function SetPasswordPage() {
  const t = useT();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if user already has a password set
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => { if (data.hasPassword) setHasPassword(true); })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError(t("auth.passwordTooShort")); return; }
    if (password !== confirm) { setError(t("auth.setPasswordMismatch")); return; }
    if (hasPassword && !currentPassword) {
      setError("请输入当前密码");
      return;
    }
    setLoading(true);
    try {
      const body: Record<string, string> = { password };
      if (hasPassword && currentPassword) body.currentPassword = currentPassword;
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error === "Current password incorrect"
          ? "当前密码不正确"
          : data.error === "Current password required"
          ? "请输入当前密码"
          : data.error ?? t("auth.genericError");
        setError(msg);
        return;
      }
      setLocation("/login?passwordSet=1");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => setLocation("/app");

  return (
    <div
      className="min-h-screen w-full bg-white flex flex-col items-center justify-center px-4"
      style={{ fontFamily: FONT }}
    >
      {/* subtle bg texture matching landing */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 50% 0%, rgba(99,102,255,0.04) 0%, transparent 60%)",
        }}
      />

      {/* logo */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mb-8"
      >
        <img src={cascadeLogo} alt="Cascade AI" className="h-8 w-auto object-contain" />
      </motion.div>

      {/* card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[420px] bg-white rounded-2xl p-8"
        style={{
          border: "1px solid rgba(0,0,0,0.10)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)",
        }}
      >
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
        >
          {/* header */}
          <motion.div variants={fadeUp} custom={0} className="mb-7 text-center">
            {/* lock icon */}
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.07)" }}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="3" y="10" width="16" height="10" rx="3" stroke="#111" strokeWidth="1.5" />
                <path d="M7 10V7a4 4 0 0 1 8 0v3" stroke="#111" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="11" cy="15" r="1.5" fill="#111" />
              </svg>
            </div>
            <h1 className="text-[22px] font-bold text-gray-900 tracking-tight" style={{ fontFamily: FONT }}>
              {t("auth.setPasswordTitle")}
            </h1>
            <p className="mt-1.5 text-[14px] text-gray-500">
              设置密码后可用用户名直接登录，也可继续使用验证码
            </p>
          </motion.div>

          {/* form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Current password — only shown when user already has a password */}
            {hasPassword && (
              <motion.div variants={fadeUp} custom={0.5}>
                <label className={labelCls}>当前密码</label>
                <input
                  type="password"
                  className={inputCls}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="输入当前密码"
                  autoComplete="current-password"
                  autoFocus
                />
              </motion.div>
            )}
            <motion.div variants={fadeUp} custom={1}>
              <label className={labelCls}>{t("auth.setPasswordLabel")}</label>
              <input
                type="password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.setPasswordPlaceholder")}
                autoComplete="new-password"
                autoFocus={!hasPassword}
              />
              <PasswordStrength password={password} />
            </motion.div>

            <motion.div variants={fadeUp} custom={2}>
              <label className={labelCls}>{t("auth.setPasswordConfirmLabel")}</label>
              <div className="relative">
                <input
                  type="password"
                  className={inputCls + (confirm && password && confirm === password
                    ? " border-green-400 focus:border-green-500 focus:shadow-[0_0_0_3px_rgba(34,197,94,0.12)]"
                    : confirm && password && confirm !== password
                    ? " border-red-300 focus:border-red-400 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.08)]"
                    : "")}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={t("auth.setPasswordConfirmPlaceholder")}
                  autoComplete="new-password"
                />
                {confirm && password && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {confirm === password ? (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" fill="rgba(34,197,94,0.12)" stroke="rgba(34,197,94,0.5)" strokeWidth="1"/>
                        <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.35)" strokeWidth="1"/>
                        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    )}
                  </div>
                )}
              </div>
              {confirm && password && confirm !== password && (
                <p className="mt-1.5 text-[11px] text-red-500">{t("auth.setPasswordMismatch")}</p>
              )}
              {confirm && password && confirm === password && (
                <p className="mt-1.5 text-[11px] text-green-600">密码一致</p>
              )}
            </motion.div>

            <motion.div variants={fadeUp} custom={3}>
              <ErrorMsg msg={error} />
            </motion.div>

            <motion.div variants={fadeUp} custom={4}>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center py-3 rounded-xl bg-black text-white text-[14px] font-semibold tracking-tight transition-all duration-200 hover:opacity-85 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer mt-1"
                style={{ fontFamily: FONT }}
              >
                {loading ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                    className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white"
                  />
                ) : t("auth.setPasswordSubmit")}
              </button>
            </motion.div>

            <motion.div variants={fadeUp} custom={5} className="text-center">
              <button
                type="button"
                onClick={handleSkip}
                className="text-[13px] text-gray-400 hover:text-gray-700 transition-colors"
              >
                {t("auth.setPasswordSkip")} →
              </button>
            </motion.div>
          </form>
        </motion.div>
      </motion.div>

      {/* footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="relative z-10 mt-6 text-[12px] text-gray-400"
      >
        © 2026 Cascade AI. All rights reserved.
      </motion.p>
    </div>
  );
}
