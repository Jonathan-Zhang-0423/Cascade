import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useIDEStore } from "@/stores/ide-store";
import { useT } from "@/lib/i18n";
import { useLanguageStore } from "@/stores/language-store";
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

// ── Types ─────────────────────────────────────────────────────────────────────
type Page = "signin" | "signup";
type SignInChannel = "email" | "phone";
type SignInMode = "password" | "otp";
type SignUpChannel = "email" | "phone";

// ── Micro animations ──────────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.42, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

// ── Shared input style ────────────────────────────────────────────────────────
const inputCls =
  "w-full bg-[#fafafa] border border-[#e5e5e5] rounded-xl px-4 py-3 text-[14px] text-gray-900 outline-none placeholder:text-gray-400 transition-all duration-200 focus:bg-white focus:border-black/30 focus:shadow-[0_0_0_3px_rgba(0,0,0,0.05)]";
const labelCls = "block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2";

// ── GitHub icon ───────────────────────────────────────────────────────────────
function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current shrink-0" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-.99-.02-1.95-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18a10.95 10.95 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

// ── Language toggle ───────────────────────────────────────────────────────────
function LangPill() {
  const { lang, setLang } = useLanguageStore();
  return (
    <button
      onClick={() => setLang(lang === "zh" ? "en" : "zh")}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium text-gray-500 hover:text-gray-900 transition-all duration-200 hover:bg-black/[0.04] select-none"
      style={{ border: "1px solid rgba(0,0,0,0.08)" }}
      aria-label="Toggle language"
    >
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.1"/>
        <path d="M6.5 1C6.5 1 4.5 3.5 4.5 6.5s2 5.5 2 5.5M6.5 1c0 0 2 2.5 2 5.5s-2 5.5-2 5.5M1 6.5h11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      </svg>
      {lang === "zh" ? "中文" : "EN"}
    </button>
  );
}

// ── Primary button ────────────────────────────────────────────────────────────
function PrimaryBtn({ children, loading, disabled, type = "submit" }: {
  children: React.ReactNode; loading?: boolean; disabled?: boolean; type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className="w-full flex items-center justify-center h-12 rounded-xl bg-black text-white text-[14px] font-semibold transition-all duration-200 hover:opacity-80 active:scale-[0.98] disabled:opacity-35 disabled:cursor-not-allowed mt-1"
      style={{ fontFamily: FONT, letterSpacing: "-0.01em" }}
    >
      {loading ? (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 0.75, repeat: Infinity, ease: "linear" }}
          className="w-4 h-4 rounded-full border-[2px] border-white/25 border-t-white"
        />
      ) : children}
    </button>
  );
}

// ── Send code button ──────────────────────────────────────────────────────────
function SendBtn({ onClick, loading, sent, resendIn, labelSend, labelResend, labelWait }: {
  onClick: () => void; loading: boolean; sent: boolean; resendIn: number;
  labelSend: string; labelResend: string; labelWait: string;
}) {
  const isDisabled = loading || resendIn > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className="shrink-0 h-12 px-4 rounded-xl text-[13px] font-semibold transition-all duration-200 whitespace-nowrap"
      style={{
        background: isDisabled ? "rgba(0,0,0,0.04)" : "black",
        color: isDisabled ? "rgba(0,0,0,0.35)" : "white",
        border: isDisabled ? "1px solid rgba(0,0,0,0.08)" : "none",
        cursor: isDisabled ? "not-allowed" : "pointer",
      }}
    >
      {loading && !sent ? labelWait : resendIn > 0 ? `${resendIn}s` : sent ? labelResend : labelSend}
    </button>
  );
}

// ── Error message ─────────────────────────────────────────────────────────────
function ErrorMsg({ msg }: { msg: string | null }) {
  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          initial={{ opacity: 0, y: -6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] text-red-600"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0">
              <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M6.5 4v2.5M6.5 9v.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            {msg}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Notice (success) message ──────────────────────────────────────────────────
function NoticeMsg({ msg }: { msg: string | null }) {
  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className="mb-5 flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] text-emerald-700"
          style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.18)" }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0">
            <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M4 6.5l2 2 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {msg}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-5">
      <div className="flex-1 h-px bg-black/[0.07]" />
      <span className="text-[10px] uppercase tracking-[0.15em] text-gray-400 font-medium">{label}</span>
      <div className="flex-1 h-px bg-black/[0.07]" />
    </div>
  );
}

// ── Page tab switcher ─────────────────────────────────────────────────────────
function PageTabs({ page, onChange, labelSignIn, labelSignUp }: {
  page: Page; onChange: (p: Page) => void; labelSignIn: string; labelSignUp: string;
}) {
  return (
    <div className="flex justify-center mb-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
      {(["signin", "signup"] as Page[]).map((p) => {
        const active = page === p;
        return (
          <button
            key={p} type="button" onClick={() => onChange(p)}
            className="relative px-8 pb-3 text-[14px] font-semibold transition-colors duration-200"
            style={{ color: active ? "#111" : "rgba(0,0,0,0.35)" }}
          >
            {p === "signin" ? labelSignIn : labelSignUp}
            {active && (
              <motion.div
                layoutId="auth-tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-black rounded-full"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Channel pills (Email / Phone) ─────────────────────────────────────────────
function ChannelPills({ tabs, active, onChange }: {
  tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void;
}) {
  return (
    <div className="flex justify-center gap-2 mb-5">
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id} type="button" onClick={() => onChange(t.id)}
            className="px-5 py-1.5 rounded-full text-[12px] font-semibold transition-all duration-200"
            style={{
              background: isActive ? "#111" : "transparent",
              color: isActive ? "white" : "rgba(0,0,0,0.45)",
              border: isActive ? "1px solid transparent" : "1px solid rgba(0,0,0,0.12)",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Mode toggle (Password / OTP) ──────────────────────────────────────────────
function ModePills({ mode, onChange, labelPwd, labelOtp }: {
  mode: SignInMode; onChange: (m: SignInMode) => void; labelPwd: string; labelOtp: string;
}) {
  return (
    <div className="flex gap-2 mb-5">
      {(["password", "otp"] as SignInMode[]).map((m) => {
        const isActive = mode === m;
        return (
          <button
            key={m} type="button" onClick={() => onChange(m)}
            className="px-4 py-1.5 rounded-full text-[12px] font-semibold transition-all duration-200"
            style={{
              background: isActive ? "#111" : "transparent",
              color: isActive ? "white" : "rgba(0,0,0,0.45)",
              border: isActive ? "1px solid transparent" : "1px solid rgba(0,0,0,0.12)",
            }}
          >
            {m === "password" ? labelPwd : labelOtp}
          </button>
        );
      })}
    </div>
  );
}

// ── OTP form — standalone component (prevents remount on parent re-render) ────
function OtpBlock({
  isSignUp, channel, otpTarget, setOtpTarget, otpCode, setOtpCode,
  inviteCode, setInviteCode, otpSent, resendIn, loading, error,
  onSubmit, onSend,
  labelTarget, placeholderTarget, labelCode, labelInvite, inviteHint,
  labelSend, labelResend, labelWait, labelSubmit, labelInviteCodeHint,
}: {
  isSignUp: boolean; channel: "email" | "sms";
  otpTarget: string; setOtpTarget: (v: string) => void;
  otpCode: string; setOtpCode: (v: string) => void;
  inviteCode: string; setInviteCode: (v: string) => void;
  otpSent: boolean; resendIn: number; loading: boolean; error: string | null;
  onSubmit: (e: React.FormEvent) => void; onSend: () => void;
  labelTarget: string; placeholderTarget: string; labelCode: string;
  labelInvite: string; inviteHint: string;
  labelSend: string; labelResend: string; labelWait: string;
  labelSubmit: string; labelInviteCodeHint: string;
}) {
  const inputCls = "w-full bg-[#fafafa] border border-[#e5e5e5] rounded-xl px-4 py-3 text-[14px] text-gray-900 outline-none placeholder:text-gray-400 transition-all duration-200 focus:bg-white focus:border-black/30 focus:shadow-[0_0_0_3px_rgba(0,0,0,0.05)]";
  const labelCls = "block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <label className={labelCls}>{labelTarget}</label>
        <div className="flex gap-2">
          <input
            type={channel === "email" ? "email" : "tel"}
            className={inputCls + " flex-1"}
            value={otpTarget}
            onChange={(e) => setOtpTarget(e.target.value)}
            placeholder={placeholderTarget}
            autoComplete={channel === "email" ? "email" : "tel"}
            required
          />
          <SendBtn onClick={onSend} loading={loading} sent={otpSent} resendIn={resendIn}
            labelSend={labelSend} labelResend={labelResend} labelWait={labelWait} />
        </div>
      </div>
      <div>
        <label className={labelCls}>{labelCode}</label>
        <input inputMode="numeric" maxLength={6}
          className={inputCls + " tracking-[0.5em] font-mono text-center"}
          value={otpCode}
          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="• • • • • •" autoComplete="one-time-code" required />
      </div>
      {isSignUp && (
        <div>
          <label className={labelCls}>{labelInvite}</label>
          <input className={inputCls + " tracking-widest font-mono uppercase"}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="CASCXXX 或 CASCEDUXXXX" autoComplete="off" required />
          <p className="mt-1.5 text-[11px] text-gray-400">{labelInviteCodeHint}</p>
        </div>
      )}
      <ErrorMsg msg={error} />
      <PrimaryBtn loading={loading}>{labelSubmit}</PrimaryBtn>
    </form>
  );
}

// ── Shell — standalone component (prevents remount on parent re-render) ───────
function Shell({ children, footer }: { children: React.ReactNode; footer: string }) {
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-start px-4"
      style={{
        fontFamily: FONT,
        background: "linear-gradient(160deg, #fafafa 0%, #f4f4f5 100%)",
        paddingTop: "32px",
        paddingBottom: "24px",
      }}
    >
      <div className="fixed inset-0 pointer-events-none opacity-[0.025]"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")" }} />
      <div className="w-full max-w-[400px] flex flex-col items-center">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="mb-5">
          <img src={cascadeLogo} alt="Cascade AI" className="h-8 w-auto object-contain" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          className="w-full relative bg-white rounded-2xl overflow-hidden"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.06)" }}>
          {children}
        </motion.div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
          className="mt-5 text-center text-[11px] text-gray-400">
          {footer}
        </motion.p>
      </div>
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

  const [page, setPage] = useState<Page>("signin");
  const [signInChannel, setSignInChannel] = useState<SignInChannel>("email");
  const [signInMode, setSignInMode] = useState<SignInMode>("password");
  const [signUpChannel, setSignUpChannel] = useState<SignUpChannel>("email");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [otpTarget, setOtpTarget] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const resendRef = useRef<number | null>(null);
  const [inviteCode, setInviteCode] = useState("");

  const [forgot, setForgot] = useState(false);
  const [forgotChannel, setForgotChannel] = useState<"email" | "sms">("email");
  const [forgotTarget, setForgotTarget] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotResendIn, setForgotResendIn] = useState(0);
  const forgotResendRef = useRef<number | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const resetOtp = () => { setOtpTarget(""); setOtpCode(""); setOtpSent(false); setResendIn(0); };

  const switchPage = (p: Page) => {
    setPage(p); setError(null); setNotice(null);
    resetOtp(); setIdentifier(""); setPassword(""); setInviteCode("");
  };
  const switchSignInChannel = (c: string) => {
    setSignInChannel(c as SignInChannel); setError(null); resetOtp(); setIdentifier(""); setPassword("");
  };
  const switchSignInMode = (m: SignInMode) => { setSignInMode(m); setError(null); resetOtp(); setPassword(""); };
  const switchSignUpChannel = (c: string) => { setSignUpChannel(c as SignUpChannel); setError(null); resetOtp(); setInviteCode(""); };

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
  } as Record<string, string>)[msg] ?? t("auth.genericError");

  const validateTarget = (channel: "email" | "sms", value: string): string | null => {
    if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase()))
      return t("auth.otpInvalidEmail");
    if (channel === "sms" && !/^\+\d{8,15}$/.test(value.trim()))
      return t("auth.otpInvalidPhone");
    return null;
  };

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!identifier.trim() || !password) { setError(t("auth.fillBothFields")); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: identifier.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(mapError(data.error)); return; }
      setUserId(data.id); setStoredUsername(data.username); setLocation("/app");
    } finally { setLoading(false); }
  };

  const handleSendOtp = async (channel: "email" | "sms", target: string) => {
    const err = validateTarget(channel, target);
    if (err) { setError(err); return; }
    setError(null); setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, target: target.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(mapError(data.error)); if (typeof data.retryAfterSec === "number") setResendIn(data.retryAfterSec); return; }
      setOtpSent(true); setResendIn(data.retryAfterSec ?? 60);
    } finally { setLoading(false); }
  };

  const handleOtpSignIn = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!/^\d{6}$/.test(otpCode)) { setError(t("auth.otpInvalidCode")); return; }
    const channel = signInChannel === "email" ? "email" : "sms";
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

  const handleOtpSignUp = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!/^\d{6}$/.test(otpCode)) { setError(t("auth.otpInvalidCode")); return; }
    if (!inviteCode.trim()) { setError(t("auth.inviteCodeRequired")); return; }
    const channel = signUpChannel === "email" ? "email" : "sms";
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/verify-login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, target: otpTarget.trim(), code: otpCode, inviteCode: inviteCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(mapError(data.error)); return; }
      setUserId(data.id); setStoredUsername(data.username); setLocation("/set-password");
    } finally { setLoading(false); }
  };

  const handleGitHub = () => { window.location.href = "/api/auth/github"; };

  const openForgot = () => { setForgot(true); setForgotTarget(""); setForgotCode(""); setForgotSent(false); setForgotResendIn(0); setNewPassword(""); setError(null); };
  const closeForgot = () => { setForgot(false); setError(null); };

  const handleForgotSend = async () => {
    const err = validateTarget(forgotChannel === "email" ? "email" : "sms", forgotTarget);
    if (err) { setError(err); return; }
    setError(null); setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: forgotChannel, target: forgotTarget.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(mapError(data.error)); if (typeof data.retryAfterSec === "number") setForgotResendIn(data.retryAfterSec); return; }
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
      setForgot(false); setPage("signin"); setNotice(t("auth.resetSuccess"));
    } finally { setLoading(false); }
  };

  const otpChannel = page === "signin" ? (signInChannel === "email" ? "email" : "sms") : (signUpChannel === "email" ? "email" : "sms");

  // ── shared OtpBlock props ─────────────────────────────────────────────────
  const otpBlockProps = (isSignUp: boolean) => ({
    isSignUp,
    channel: otpChannel,
    otpTarget, setOtpTarget,
    otpCode, setOtpCode,
    inviteCode, setInviteCode,
    otpSent, resendIn, loading, error,
    onSubmit: isSignUp ? handleOtpSignUp : handleOtpSignIn,
    onSend: () => handleSendOtp(otpChannel, otpTarget),
    labelTarget: otpChannel === "email" ? t("auth.emailAddr") : t("auth.phoneNumber"),
    placeholderTarget: otpChannel === "email" ? t("auth.emailPlaceholder") : t("auth.phonePlaceholder"),
    labelCode: t("auth.verifyCode"),
    labelInvite: t("auth.inviteCodeLabel"),
    inviteHint: t("auth.inviteCodeHint"),
    labelSend: t("auth.sendCode"),
    labelResend: t("auth.resendCode"),
    labelWait: t("auth.sending"),
    labelSubmit: isSignUp ? t("auth.pageSignUp") : t("auth.pageSignIn"),
    labelInviteCodeHint: t("auth.inviteCodeHint"),
  });

  // ════════════════════════════════════════════════════════════════════════
  // Forgot password
  // ════════════════════════════════════════════════════════════════════════
  if (forgot) {
    return (
      <Shell footer={t("auth.footer")}>
        <div className="p-6">
          <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.06 } } }}>
            {/* back + lang */}
            <motion.div variants={fadeUp} custom={0} className="flex items-center justify-between mb-6">
              <button type="button" onClick={closeForgot}
                className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400 hover:text-gray-900 transition-colors">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {t("auth.forgotBack")}
              </button>
              <LangPill />
            </motion.div>

            <motion.div variants={fadeUp} custom={1} className="mb-6">
              <h1 className="text-[20px] font-bold text-gray-900 tracking-tight">{t("auth.resetPasswordTitle")}</h1>
              <p className="mt-1 text-[13px] text-gray-500">{t("auth.resetPasswordDesc")}</p>
            </motion.div>

            {/* GitHub note */}
            <motion.div variants={fadeUp} custom={1.5}
              className="mb-5 flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-[12px] text-gray-500"
              style={{ background: "rgba(0,0,0,0.025)", border: "1px solid rgba(0,0,0,0.07)" }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 mt-0.5">
                <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.1"/>
                <path d="M6.5 5v.2M6.5 7v2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              {t("auth.githubHint")}
            </motion.div>

            <motion.div variants={fadeUp} custom={2}>
              <ChannelPills
                tabs={[{ id: "email", label: t("auth.methodEmail") }, { id: "sms", label: t("auth.methodPhone") }]}
                active={forgotChannel}
                onChange={(id) => { setForgotChannel(id as "email" | "sms"); setError(null); setForgotTarget(""); setForgotCode(""); setForgotSent(false); }}
              />
            </motion.div>

            <form onSubmit={handleForgotSubmit} className="flex flex-col gap-4">
              <motion.div variants={fadeUp} custom={3}>
                <label className={labelCls}>{forgotChannel === "email" ? t("auth.emailAddr") : t("auth.phoneNumber")}</label>
                <div className="flex gap-2">
                  <input type={forgotChannel === "email" ? "email" : "tel"} className={inputCls + " flex-1"}
                    value={forgotTarget} onChange={(e) => setForgotTarget(e.target.value)}
                    placeholder={forgotChannel === "email" ? t("auth.emailPlaceholder") : t("auth.phonePlaceholder")}
                    autoComplete={forgotChannel === "email" ? "email" : "tel"} required />
                  <SendBtn onClick={handleForgotSend} loading={loading} sent={forgotSent} resendIn={forgotResendIn}
                    labelSend={t("auth.sendCode")} labelResend={t("auth.resendCode")} labelWait={t("auth.sending")} />
                </div>
              </motion.div>
              <motion.div variants={fadeUp} custom={4}>
                <label className={labelCls}>{t("auth.verifyCode")}</label>
                <input inputMode="numeric" maxLength={6}
                  className={inputCls + " tracking-[0.5em] font-mono text-center"}
                  value={forgotCode} onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="• • • • • •" autoComplete="one-time-code" required />
              </motion.div>
              <motion.div variants={fadeUp} custom={5}>
                <label className={labelCls}>{t("auth.newPassword")}</label>
                <input type="password" className={inputCls} value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("auth.newPasswordPlaceholder")} autoComplete="new-password" required />
              </motion.div>
              <motion.div variants={fadeUp} custom={6}><ErrorMsg msg={error} /></motion.div>
              <motion.div variants={fadeUp} custom={7}>
                <PrimaryBtn loading={loading}>{t("auth.doResetPassword")}</PrimaryBtn>
              </motion.div>
            </form>
          </motion.div>
        </div>
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Sign In / Sign Up
  // ════════════════════════════════════════════════════════════════════════
  return (
    <Shell footer={t("auth.footer")}>
      {/* no top-bar — lang pill moves below tabs */}
      <div className="px-6 pb-6 pt-4">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        >
          <motion.div variants={fadeUp} custom={0}>
            <NoticeMsg msg={notice} />
          </motion.div>

          {/* Page tabs — centered */}
          <motion.div variants={fadeUp} custom={1}>
            <PageTabs
              page={page} onChange={switchPage}
              labelSignIn={t("auth.pageSignIn")}
              labelSignUp={t("auth.pageSignUp")}
            />
          </motion.div>

          {/* Lang pill — centered, right below tabs */}
          <motion.div variants={fadeUp} custom={1.5} className="flex justify-center mt-3 mb-5">
            <LangPill />
          </motion.div>

          {/* Title */}
          <motion.div variants={fadeUp} custom={2} className="mb-5 text-center">
            <h1 className="text-[22px] font-bold text-gray-900 tracking-tight" style={{ letterSpacing: "-0.02em" }}>
              {page === "signin" ? t("auth.welcomeBack") : t("auth.createAccount2")}
            </h1>
            <p className="mt-1 text-[13px] text-gray-500">
              {page === "signin" ? t("auth.signInDesc") : t("auth.signUpDesc")}
            </p>
          </motion.div>

          {/* GitHub */}
          <motion.div variants={fadeUp} custom={3}>
            <button type="button" onClick={handleGitHub}
              className="w-full flex items-center justify-center gap-2.5 h-11 rounded-xl text-[13px] font-semibold text-gray-700 transition-all duration-200 hover:bg-gray-50 active:scale-[0.98]"
              style={{ border: "1px solid rgba(0,0,0,0.12)", background: "white" }}>
              <GitHubIcon />
              {page === "signin" ? t("auth.continueWithGithub") : t("auth.signUpWithGithub")}
            </button>
          </motion.div>

          <motion.div variants={fadeUp} custom={4}>
            <Divider label={t("auth.or")} />
          </motion.div>

          {/* Forms */}
          <motion.div variants={fadeUp} custom={5}>
            <AnimatePresence mode="wait">
              {page === "signin" ? (
                <motion.div key="signin"
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.2 }}>

                  {/* Email / Phone — underline tabs */}
                  <div className="flex border-b border-black/[0.07] mb-5">
                    {([{ id: "email", label: t("auth.signinMethodEmail") }, { id: "phone", label: t("auth.signinMethodPhone") }]).map((tab) => (
                      <button key={tab.id} type="button" onClick={() => switchSignInChannel(tab.id)}
                        className={`px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-all duration-200 ${
                          signInChannel === tab.id
                            ? "border-black text-gray-900"
                            : "border-transparent text-gray-400 hover:text-gray-700"}`}>
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Password / OTP — underline tabs */}
                  <div className="flex border-b border-black/[0.07] mb-5">
                    {([{ id: "password", label: t("auth.passwordLogin") }, { id: "otp", label: t("auth.codeLogin") }]).map((tab) => (
                      <button key={tab.id} type="button" onClick={() => switchSignInMode(tab.id as SignInMode)}
                        className={`px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-all duration-200 ${
                          signInMode === tab.id
                            ? "border-black text-gray-900"
                            : "border-transparent text-gray-400 hover:text-gray-700"}`}>
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <AnimatePresence mode="wait">
                    {signInMode === "password" ? (
                      <motion.form key="pwd"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onSubmit={handlePasswordSignIn} className="flex flex-col gap-4">
                        <div>
                          <label className={labelCls}>
                            {signInChannel === "email" ? t("auth.emailAddr") : t("auth.phoneNumber")}
                          </label>
                          <input
                            type={signInChannel === "email" ? "email" : "tel"}
                            className={inputCls}
                            value={identifier}
                            onChange={(e) => setIdentifier(e.target.value)}
                            placeholder={signInChannel === "email" ? t("auth.emailPlaceholder") : t("auth.phonePlaceholder")}
                            autoComplete={signInChannel === "email" ? "email" : "tel"}
                            required
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className={labelCls + " mb-0"}>{t("auth.passwordLabel")}</label>
                            <button type="button" onClick={openForgot}
                              className="text-[11px] font-medium text-gray-400 hover:text-gray-800 transition-colors">
                              {t("auth.forgotPassword")}
                            </button>
                          </div>
                          <input type="password" className={inputCls} value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••" autoComplete="current-password" required />
                        </div>
                        <ErrorMsg msg={error} />
                        <PrimaryBtn loading={loading}>{t("auth.pageSignIn")}</PrimaryBtn>
                      </motion.form>
                    ) : (
                      <motion.div key="otp"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}>
                        <OtpBlock {...otpBlockProps(false)} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ) : (
                <motion.div key="signup"
                  initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.2 }}>
                  <div className="flex border-b border-black/[0.07] mb-5">
                    {([{ id: "email", label: t("auth.methodEmail") }, { id: "phone", label: t("auth.methodPhone") }]).map((tab) => (
                      <button key={tab.id} type="button" onClick={() => switchSignUpChannel(tab.id)}
                        className={`px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-all duration-200 ${
                          signUpChannel === tab.id
                            ? "border-black text-gray-900"
                            : "border-transparent text-gray-400 hover:text-gray-700"}`}>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <OtpBlock {...otpBlockProps(true)} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
    </Shell>
  );
}
