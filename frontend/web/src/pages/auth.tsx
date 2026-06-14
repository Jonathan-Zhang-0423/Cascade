import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useIDEStore } from "@/stores/ide-store";
import { useT } from "@/lib/i18n";
import cascadeLogo from "../assets/cascade-logo.png";

// ── Font ─────────────────────────────────────────────────────────────────────
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
  const el = document.getElementById("cascade-font");
  if (!el) {
    const s = document.createElement("style");
    s.id = "cascade-font";
    s.textContent = fontStyle;
    document.head.appendChild(s);
  }
}
const FONT = '"Inter", "Helvetica Neue", system-ui, sans-serif';

// ── Animations ───────────────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.45, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

// ── Shared styles ────────────────────────────────────────────────────────────
const inputCls =
  "w-full bg-white border border-black/[0.12] rounded-xl px-4 py-3 text-[14px] text-gray-900 outline-none placeholder:text-gray-400 transition-all duration-200 focus:border-black focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)]";
const labelCls = "block text-[12px] font-medium text-gray-600 mb-1.5";

// ── Types ────────────────────────────────────────────────────────────────────
type Page = "signin" | "signup";
// sign-in methods
type SignInMethod = "password" | "email" | "phone";
// sign-up methods
type SignUpMethod = "email" | "phone";

// ── Shared sub-components ────────────────────────────────────────────────────
function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] fill-current shrink-0" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-.99-.02-1.95-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18a10.95 10.95 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-5">
      <div className="flex-1 h-px bg-black/[0.08]" />
      <span className="text-[11px] uppercase tracking-widest text-gray-400 font-medium">{label}</span>
      <div className="flex-1 h-px bg-black/[0.08]" />
    </div>
  );
}

function PrimaryBtn({ children, loading, disabled, type = "submit" }: {
  children: React.ReactNode; loading?: boolean; disabled?: boolean; type?: "submit" | "button";
}) {
  return (
    <button type={type} disabled={disabled || loading}
      className="w-full flex items-center justify-center py-3 rounded-xl bg-black text-white text-[14px] font-semibold tracking-tight transition-all duration-200 hover:opacity-85 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer mt-2"
      style={{ fontFamily: FONT }}>
      {loading
        ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white" />
        : children}
    </button>
  );
}

function SendBtn({ onClick, loading, sent, resendIn }: {
  onClick: () => void; loading: boolean; sent: boolean; resendIn: number;
}) {
  return (
    <button type="button" onClick={onClick} disabled={loading || resendIn > 0}
      className="shrink-0 px-4 py-3 rounded-xl bg-black text-white text-[13px] font-medium hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 whitespace-nowrap">
      {loading && !sent ? "…" : resendIn > 0 ? `${resendIn}s` : sent ? "重发" : "发送"}
    </button>
  );
}

function ErrorMsg({ msg }: { msg: string | null }) {
  return (
    <AnimatePresence>
      {msg && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="text-[13px] text-red-500 flex items-center gap-1.5">
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

function NoticeMsg({ msg }: { msg: string | null }) {
  return (
    <AnimatePresence>
      {msg && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="mb-4 px-4 py-3 rounded-xl text-[13px] text-green-700 flex items-center gap-2"
          style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.18)" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4.5 7l2 2L9.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {msg}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Page-level switcher (Sign In / Sign Up) ──────────────────────────────────
function PageSwitcher({ page, onChange }: { page: Page; onChange: (p: Page) => void }) {
  return (
    <div className="flex p-1 rounded-xl mb-6" style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.07)" }}>
      {(["signin", "signup"] as Page[]).map((p) => (
        <button key={p} type="button" onClick={() => onChange(p)}
          className={`flex-1 py-2 text-[13px] font-semibold rounded-lg transition-all duration-200 ${
            page === p ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
          {p === "signin" ? "Sign In" : "Sign Up"}
        </button>
      ))}
    </div>
  );
}

// ── Method tab switcher ──────────────────────────────────────────────────────
function MethodTabs({ tabs, active, onChange }: {
  tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-0 mb-5 border-b border-black/[0.07]">
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => onChange(t.id)}
          className={`px-4 py-2 text-[13px] font-medium transition-all duration-200 border-b-2 -mb-px ${
            active === t.id
              ? "border-black text-gray-900"
              : "border-transparent text-gray-400 hover:text-gray-700"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Layout wrapper ───────────────────────────────────────────────────────────
function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-white flex flex-col items-center justify-center px-4" style={{ fontFamily: FONT }}>
      <div className="fixed inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(99,102,255,0.04) 0%, transparent 60%)" }} />

      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="relative z-10 mb-8">
        <img src={cascadeLogo} alt="Cascade AI" className="h-8 w-auto object-contain" />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[420px] bg-white rounded-2xl p-8"
        style={{ border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)" }}>
        {children}
      </motion.div>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
        className="relative z-10 mt-6 text-[12px] text-gray-400">
        © 2026 Cascade AI. All rights reserved.
      </motion.p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════════════
export default function AuthPage() {
  const t = useT();
  const setUserId = useIDEStore((s) => s.setUserId);
  const setStoredUsername = useIDEStore((s) => s.setUsername);
  const [, setLocation] = useLocation();

  // ── Page & method state ──────────────────────────────────────────────────
  const [page, setPage] = useState<Page>("signin");
  const [signInMethod, setSignInMethod] = useState<SignInMethod>("password");
  const [signUpMethod, setSignUpMethod] = useState<SignUpMethod>("email");

  // ── Form state ───────────────────────────────────────────────────────────
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // OTP shared (email / phone, for both sign-in and sign-up)
  const [otpTarget, setOtpTarget] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const resendRef = useRef<number | null>(null);

  // Sign-up extras
  const [inviteCode, setInviteCode] = useState("");

  // Forgot password
  const [forgot, setForgot] = useState(false);
  const [forgotChannel, setForgotChannel] = useState<"email" | "sms">("email");
  const [forgotTarget, setForgotTarget] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotResendIn, setForgotResendIn] = useState(0);
  const forgotResendRef = useRef<number | null>(null);
  const [newPassword, setNewPassword] = useState("");

  // UI
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── GitHub error / notice from query params ──────────────────────────────
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has("github_error")) {
      setError(t("auth.githubError"));
      const url = new URL(window.location.href);
      url.searchParams.delete("github_error");
      window.history.replaceState({}, "", url.toString());
    }
    if (p.has("passwordSet")) {
      setNotice(t("auth.setPasswordDone"));
      const url = new URL(window.location.href);
      url.searchParams.delete("passwordSet");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // ── Resend countdown (OTP) ───────────────────────────────────────────────
  useEffect(() => {
    if (resendIn <= 0) return;
    resendRef.current = window.setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => { if (resendRef.current) window.clearInterval(resendRef.current); };
  }, [resendIn > 0]);

  useEffect(() => {
    if (forgotResendIn <= 0) return;
    forgotResendRef.current = window.setInterval(() => setForgotResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => { if (forgotResendRef.current) window.clearInterval(forgotResendRef.current); };
  }, [forgotResendIn > 0]);

  // ── Reset OTP state when switching page/method ───────────────────────────
  const resetOtp = () => { setOtpTarget(""); setOtpCode(""); setOtpSent(false); setResendIn(0); };

  const switchPage = (p: Page) => { setPage(p); setError(null); setNotice(null); resetOtp(); setInviteCode(""); };
  const switchSignInMethod = (m: string) => { setSignInMethod(m as SignInMethod); setError(null); resetOtp(); };
  const switchSignUpMethod = (m: string) => { setSignUpMethod(m as SignUpMethod); setError(null); resetOtp(); setInviteCode(""); };

  // ── Error map ────────────────────────────────────────────────────────────
  const mapError = (msg: string): string => ({
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
  }[msg] ?? t("auth.genericError"));

  // ── Validators ───────────────────────────────────────────────────────────
  const validateOtpTarget = (channel: "email" | "sms", value: string): string | null => {
    if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase()))
      return t("auth.otpInvalidEmail");
    if (channel === "sms" && !/^\+\d{8,15}$/.test(value.trim()))
      return t("auth.otpInvalidPhone");
    return null;
  };

  // ── Handlers ─────────────────────────────────────────────────────────────

  // Sign in with username + password
  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim()) { setError(t("auth.usernameRequired")); return; }
    if (!password) { setError(t("auth.passwordTooShort")); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(mapError(data.error)); return; }
      setUserId(data.id); setStoredUsername(data.username); setLocation("/app");
    } finally { setLoading(false); }
  };

  // Send OTP (sign-in or sign-up)
  const handleSendOtp = async (channel: "email" | "sms", target: string) => {
    const err = validateOtpTarget(channel, target);
    if (err) { setError(err); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, target: target.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(mapError(data.error));
        if (typeof data.retryAfterSec === "number") setResendIn(data.retryAfterSec);
        return;
      }
      setOtpSent(true);
      setResendIn(data.retryAfterSec ?? 60);
    } finally { setLoading(false); }
  };

  // Verify OTP for sign-in
  const handleOtpSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(otpCode)) { setError(t("auth.otpInvalidCode")); return; }
    const channel = signInMethod === "email" ? "email" : "sms";
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/verify-login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, target: otpTarget.trim(), code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) { setError(mapError(data.error)); return; }
      setUserId(data.id); setStoredUsername(data.username);
      setLocation(res.status === 201 ? "/set-password" : "/app");
    } finally { setLoading(false); }
  };

  // Verify OTP for sign-up (needs invite code)
  const handleOtpSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(otpCode)) { setError(t("auth.otpInvalidCode")); return; }
    if (!inviteCode.trim()) { setError(t("auth.inviteCodeRequired")); return; }
    const channel = signUpMethod === "email" ? "email" : "sms";
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/verify-login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, target: otpTarget.trim(), code: otpCode, inviteCode: inviteCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(mapError(data.error)); return; }
      setUserId(data.id); setStoredUsername(data.username);
      setLocation("/set-password");
    } finally { setLoading(false); }
  };

  const handleGitHub = () => { window.location.href = "/api/auth/github"; };

  // ── Forgot password handlers ─────────────────────────────────────────────
  const openForgot = () => {
    setForgot(true); setForgotTarget(""); setForgotCode(""); setForgotSent(false);
    setForgotResendIn(0); setNewPassword(""); setError(null);
  };
  const closeForgot = () => { setForgot(false); setError(null); };

  const handleForgotSend = async () => {
    const channel = forgotChannel;
    const err = validateOtpTarget(channel === "email" ? "email" : "sms", forgotTarget);
    if (err) { setError(err); return; }
    setError(null); setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, target: forgotTarget.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(mapError(data.error));
        if (typeof data.retryAfterSec === "number") setForgotResendIn(data.retryAfterSec);
        return;
      }
      setForgotSent(true); setForgotResendIn(data.retryAfterSec ?? 60);
    } finally { setLoading(false); }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!/^\d{6}$/.test(forgotCode)) { setError(t("auth.otpInvalidCode")); return; }
    if (newPassword.length < 6) { setError(t("auth.passwordTooShort")); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: forgotChannel, target: forgotTarget.trim(), code: forgotCode, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(mapError(data.error)); return; }
      setForgot(false); setPage("signin"); setSignInMethod("password");
      setNotice(t("auth.resetSuccess"));
    } finally { setLoading(false); }
  };

  // ════════════════════════════════════════════════════════════════════════
  // Forgot password view
  // ════════════════════════════════════════════════════════════════════════
  if (forgot) {
    return (
      <AuthCard>
        <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.07 } } }}>
          {/* back */}
          <motion.button variants={fadeUp} custom={0} type="button" onClick={closeForgot}
            className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 transition-colors mb-5">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            返回登录
          </motion.button>

          <motion.div variants={fadeUp} custom={1} className="mb-6 text-center">
            <h1 className="text-[22px] font-bold text-gray-900 tracking-tight" style={{ fontFamily: FONT }}>重置密码</h1>
            <p className="mt-1.5 text-[14px] text-gray-500">通过邮箱或手机号验证身份</p>
          </motion.div>

          {/* GitHub hint */}
          <motion.div variants={fadeUp} custom={1.5}
            className="mb-5 px-4 py-3 rounded-xl text-[13px] text-gray-500 flex items-start gap-2"
            style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.07)" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 mt-0.5">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 5v.3M7 7v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            通过 <strong className="text-gray-700">GitHub</strong> 注册的账号无需密码，直接使用 GitHub 登录即可。
          </motion.div>

          {/* channel tabs */}
          <motion.div variants={fadeUp} custom={2}>
            <MethodTabs
              tabs={[{ id: "email", label: "邮箱" }, { id: "sms", label: "手机号" }]}
              active={forgotChannel}
              onChange={(id) => { setForgotChannel(id as "email" | "sms"); setError(null); setForgotTarget(""); setForgotCode(""); setForgotSent(false); }}
            />
          </motion.div>

          <form onSubmit={handleForgotSubmit} className="flex flex-col gap-4">
            <motion.div variants={fadeUp} custom={3}>
              <label className={labelCls}>{forgotChannel === "email" ? "邮箱地址" : "手机号码"}</label>
              <div className="flex gap-2">
                <input type={forgotChannel === "email" ? "email" : "tel"} className={inputCls + " flex-1"}
                  value={forgotTarget} onChange={(e) => setForgotTarget(e.target.value)}
                  placeholder={forgotChannel === "email" ? "your@email.com" : "+86 13800138000"}
                  autoComplete={forgotChannel === "email" ? "email" : "tel"} required />
                <SendBtn onClick={handleForgotSend} loading={loading} sent={forgotSent} resendIn={forgotResendIn} />
              </div>
            </motion.div>

            <motion.div variants={fadeUp} custom={4}>
              <label className={labelCls}>验证码</label>
              <input inputMode="numeric" maxLength={6} className={inputCls + " tracking-[0.4em] font-mono"}
                value={forgotCode} onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000" autoComplete="one-time-code" required />
            </motion.div>

            <motion.div variants={fadeUp} custom={5}>
              <label className={labelCls}>新密码</label>
              <input type="password" className={inputCls} value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 6 位" autoComplete="new-password" required />
            </motion.div>

            <motion.div variants={fadeUp} custom={6}><ErrorMsg msg={error} /></motion.div>
            <motion.div variants={fadeUp} custom={7}><PrimaryBtn loading={loading}>重置密码</PrimaryBtn></motion.div>
          </form>
        </motion.div>
      </AuthCard>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Sign In view
  // ════════════════════════════════════════════════════════════════════════
  const signInView = (
    <motion.div key="signin" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>

      {/* Method tabs */}
      <MethodTabs
        tabs={[{ id: "password", label: "密码" }, { id: "email", label: "邮箱验证码" }, { id: "phone", label: "手机验证码" }]}
        active={signInMethod}
        onChange={switchSignInMethod}
      />

      {/* ── Password method ── */}
      {signInMethod === "password" && (
        <form onSubmit={handlePasswordSignIn} className="flex flex-col gap-4">
          <div>
            <label className={labelCls}>{t("auth.usernameLabel")}</label>
            <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder={t("auth.usernamePlaceholder")} autoComplete="username" required />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelCls + " mb-0"}>{t("auth.passwordLabel")}</label>
              <button type="button" onClick={openForgot}
                className="text-[12px] text-gray-500 hover:text-gray-900 transition-colors">
                忘记密码？
              </button>
            </div>
            <input type="password" className={inputCls} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              autoComplete="current-password" required />
          </div>
          <ErrorMsg msg={error} />
          <PrimaryBtn loading={loading}>Sign In</PrimaryBtn>
        </form>
      )}

      {/* ── Email OTP method ── */}
      {signInMethod === "email" && (
        <form onSubmit={handleOtpSignIn} className="flex flex-col gap-4">
          <div>
            <label className={labelCls}>邮箱地址</label>
            <div className="flex gap-2">
              <input type="email" className={inputCls + " flex-1"} value={otpTarget}
                onChange={(e) => setOtpTarget(e.target.value)} placeholder="your@email.com"
                autoComplete="email" required />
              <SendBtn onClick={() => handleSendOtp("email", otpTarget)} loading={loading} sent={otpSent} resendIn={resendIn} />
            </div>
          </div>
          <div>
            <label className={labelCls}>验证码</label>
            <input inputMode="numeric" maxLength={6} className={inputCls + " tracking-[0.4em] font-mono"}
              value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000" autoComplete="one-time-code" required />
          </div>
          <ErrorMsg msg={error} />
          <PrimaryBtn loading={loading}>Sign In</PrimaryBtn>
        </form>
      )}

      {/* ── Phone OTP method ── */}
      {signInMethod === "phone" && (
        <form onSubmit={handleOtpSignIn} className="flex flex-col gap-4">
          <div>
            <label className={labelCls}>手机号码</label>
            <div className="flex gap-2">
              <input type="tel" className={inputCls + " flex-1"} value={otpTarget}
                onChange={(e) => setOtpTarget(e.target.value)} placeholder="+86 13800138000"
                autoComplete="tel" required />
              <SendBtn onClick={() => handleSendOtp("sms", otpTarget)} loading={loading} sent={otpSent} resendIn={resendIn} />
            </div>
          </div>
          <div>
            <label className={labelCls}>验证码</label>
            <input inputMode="numeric" maxLength={6} className={inputCls + " tracking-[0.4em] font-mono"}
              value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000" autoComplete="one-time-code" required />
          </div>
          <ErrorMsg msg={error} />
          <PrimaryBtn loading={loading}>Sign In</PrimaryBtn>
        </form>
      )}
    </motion.div>
  );

  // ════════════════════════════════════════════════════════════════════════
  // Sign Up view
  // ════════════════════════════════════════════════════════════════════════
  const signUpView = (
    <motion.div key="signup" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>

      {/* Method tabs */}
      <MethodTabs
        tabs={[{ id: "email", label: "邮箱" }, { id: "phone", label: "手机号" }]}
        active={signUpMethod}
        onChange={switchSignUpMethod}
      />

      {/* ── Email OTP sign-up ── */}
      {signUpMethod === "email" && (
        <form onSubmit={handleOtpSignUp} className="flex flex-col gap-4">
          <div>
            <label className={labelCls}>邮箱地址</label>
            <div className="flex gap-2">
              <input type="email" className={inputCls + " flex-1"} value={otpTarget}
                onChange={(e) => setOtpTarget(e.target.value)} placeholder="your@email.com"
                autoComplete="email" required />
              <SendBtn onClick={() => handleSendOtp("email", otpTarget)} loading={loading} sent={otpSent} resendIn={resendIn} />
            </div>
          </div>
          <div>
            <label className={labelCls}>验证码</label>
            <input inputMode="numeric" maxLength={6} className={inputCls + " tracking-[0.4em] font-mono"}
              value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000" autoComplete="one-time-code" required />
          </div>
          <div>
            <label className={labelCls}>邀请码</label>
            <input className={inputCls + " tracking-widest font-mono uppercase"}
              value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXXXX" autoComplete="off" required />
            <p className="mt-1.5 text-[12px] text-gray-400">注册需要邀请码，可从邀请邮件中获取</p>
          </div>
          <ErrorMsg msg={error} />
          <PrimaryBtn loading={loading}>Sign Up</PrimaryBtn>
        </form>
      )}

      {/* ── Phone OTP sign-up ── */}
      {signUpMethod === "phone" && (
        <form onSubmit={handleOtpSignUp} className="flex flex-col gap-4">
          <div>
            <label className={labelCls}>手机号码</label>
            <div className="flex gap-2">
              <input type="tel" className={inputCls + " flex-1"} value={otpTarget}
                onChange={(e) => setOtpTarget(e.target.value)} placeholder="+86 13800138000"
                autoComplete="tel" required />
              <SendBtn onClick={() => handleSendOtp("sms", otpTarget)} loading={loading} sent={otpSent} resendIn={resendIn} />
            </div>
          </div>
          <div>
            <label className={labelCls}>验证码</label>
            <input inputMode="numeric" maxLength={6} className={inputCls + " tracking-[0.4em] font-mono"}
              value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000" autoComplete="one-time-code" required />
          </div>
          <div>
            <label className={labelCls}>邀请码</label>
            <input className={inputCls + " tracking-widest font-mono uppercase"}
              value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXXXX" autoComplete="off" required />
            <p className="mt-1.5 text-[12px] text-gray-400">注册需要邀请码，可从邀请邮件中获取</p>
          </div>
          <ErrorMsg msg={error} />
          <PrimaryBtn loading={loading}>Sign Up</PrimaryBtn>
        </form>
      )}
    </motion.div>
  );

  // ════════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════════
  return (
    <AuthCard>
      <motion.div initial="hidden" animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.07 } } }}>

        {/* Notice */}
        <motion.div variants={fadeUp} custom={0}>
          <NoticeMsg msg={notice} />
        </motion.div>

        {/* Page switcher */}
        <motion.div variants={fadeUp} custom={1}>
          <PageSwitcher page={page} onChange={switchPage} />
        </motion.div>

        {/* Title */}
        <motion.div variants={fadeUp} custom={2} className="mb-5 text-center">
          <h1 className="text-[20px] font-bold text-gray-900 tracking-tight" style={{ fontFamily: FONT }}>
            {page === "signin" ? "欢迎回来" : "创建账号"}
          </h1>
          <p className="mt-1 text-[13px] text-gray-500">
            {page === "signin" ? "选择你的登录方式" : "选择注册方式，需要邀请码"}
          </p>
        </motion.div>

        {/* GitHub button */}
        <motion.div variants={fadeUp} custom={3}>
          <button type="button" onClick={handleGitHub}
            className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl text-[14px] font-medium text-gray-800 transition-all duration-200 hover:bg-black/[0.04] active:scale-[0.98]"
            style={{ border: "1px solid rgba(0,0,0,0.12)", background: "white" }}>
            <GitHubIcon />
            {page === "signin" ? "Continue with GitHub" : "Sign up with GitHub"}
          </button>
        </motion.div>

        <motion.div variants={fadeUp} custom={4}>
          <Divider label="或" />
        </motion.div>

        {/* Method-specific form */}
        <motion.div variants={fadeUp} custom={5}>
          <AnimatePresence mode="wait">
            {page === "signin" ? signInView : signUpView}
          </AnimatePresence>
        </motion.div>

      </motion.div>
    </AuthCard>
  );
}
