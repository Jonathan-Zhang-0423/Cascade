import { useState, useEffect, useRef } from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { SiteBeian } from "../components/SiteBeian";
import cascadeLogo from "../assets/cascade-logo.png";
import iconFeature1 from "../assets/icon-feature-1.svg";
import iconFeature2 from "../assets/icon-feature-2.svg";
import iconFeature3 from "../assets/icon-feature-3.svg";
import iconFeature4 from "../assets/icon-feature-4.svg";

// Inter Medium font (local variable font)
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

// ─── Phone animation frame hook ────────────────────────────────────────────
const FRAME_DURATIONS = [4500, 5000, 5000]; // ms per frame

function usePhoneFrames() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setFrame((f) => (f + 1) % 3);
    }, FRAME_DURATIONS[frame]);
    return () => clearTimeout(timer);
  }, [frame]);
  return frame;
}

// ─── Shared phone header ───────────────────────────────────────────────────
function PhoneHeader() {
  return (
    <>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[10px] font-medium" style={{ color: "rgba(0,0,0,0.5)" }}>9:41</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-[6px] rounded-sm border border-black/30 relative">
            <div className="absolute inset-[1px] right-[2px] bg-black/30 rounded-sm" />
          </div>
        </div>
      </div>
      <div className="px-4 py-2 border-b border-black/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-black flex items-center justify-center shrink-0">
            <img src={cascadeLogo} alt="Cascade" className="w-4 h-4 object-contain" style={{ filter: "brightness(0) invert(1)" }} />
          </div>
          <span className="text-black text-[12px] font-semibold">Cascade AI</span>
        </div>
      </div>
    </>
  );
}

// ─── Frame 1: Chat input with typewriter ───────────────────────────────────
const CHAT_TEXT = "Build me a fitness tracker app";
const CHAT_TYPE_SPEED = 65;

function Frame1() {
  const [typed, setTyped] = useState("");
  const [cursor, setCursor] = useState(true);
  const idx = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setTyped("");
    let timeout: ReturnType<typeof setTimeout>;
    function tick() {
      if (idx.current < CHAT_TEXT.length) {
        idx.current += 1;
        setTyped(CHAT_TEXT.slice(0, idx.current));
        timeout = setTimeout(tick, CHAT_TYPE_SPEED);
      }
    }
    timeout = setTimeout(tick, 400);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setCursor((v) => !v), 530);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col h-full bg-white rounded-[28px] overflow-hidden">
      <PhoneHeader />
      {/* messages */}
      <div className="flex-1 px-3 py-3 flex flex-col gap-2 overflow-hidden">
        <div className="self-start max-w-[80%] bg-[#f3f4f6] rounded-2xl rounded-tl-sm px-3 py-2">
          <p className="text-black/70 text-[10px] leading-relaxed">Hi! What would you like to build today?</p>
        </div>
        <div className="self-end max-w-[85%] bg-black rounded-2xl rounded-tr-sm px-3 py-2">
          <p className="text-white text-[10px] leading-relaxed">
            {typed}
            <span style={{ opacity: cursor ? 1 : 0, transition: "opacity 0.1s" }}>|</span>
          </p>
        </div>
      </div>
      {/* input bar */}
      <div className="px-3 pb-4 pt-2 border-t border-black/[0.06]">
        <div className="flex items-center gap-2 bg-[#f3f4f6] rounded-full px-3 py-2">
          <span className="text-black/30 text-[10px] flex-1">Message Cascade...</span>
          <div className="w-5 h-5 rounded-full bg-black flex items-center justify-center shrink-0">
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <path d="M2 8L8 5L2 2V4.5L6 5L2 5.5V8Z" fill="white" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Frame 2: Plan cards ────────────────────────────────────────────────────
const PLAN_STEPS = [
  { icon: "thinking", label: "Thinking", desc: "Analyzing your request…" },
  { icon: "planning", label: "Planning", desc: "Generating development plan" },
  { icon: "building", label: "Building", desc: "Executing step by step" },
];

function SpinnerIcon() {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-gray-700"
    />
  );
}

function Frame2() {
  return (
    <div className="flex flex-col h-full bg-white rounded-[28px] overflow-hidden">
      <PhoneHeader />
      {/* plan content */}
      <div className="flex-1 px-3 py-3 flex flex-col gap-2 overflow-hidden">
        <p className="text-black/40 text-[9px] font-mono uppercase tracking-wider mb-1">Execution Plan</p>
        {PLAN_STEPS.map((step, i) => (
          <motion.div
            key={step.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.45, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-2 bg-[#f9fafb] rounded-xl px-3 py-2 relative overflow-hidden"
          >
            {/* black left border */}
            <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-black rounded-l-xl" />
            <div className="pl-1 shrink-0">
              {i === 0 ? <SpinnerIcon /> :
               i === 1 ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-gray-400">
                  <rect x="1" y="2" width="12" height="2" rx="1" fill="currentColor" opacity="0.6"/>
                  <rect x="1" y="6" width="9" height="2" rx="1" fill="currentColor" opacity="0.8"/>
                  <rect x="1" y="10" width="6" height="2" rx="1" fill="currentColor"/>
                </svg>
               ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-gray-400">
                  <path d="M3 11L6 8L3 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M7 11H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M7 8H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
               )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-black text-[10px] font-medium leading-tight">{step.label}</p>
              <p className="text-gray-400 text-[8.5px] leading-tight mt-0.5">{step.desc}</p>
            </div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: i < 2 ? 1 : 0.3 }}
              transition={{ delay: i * 0.45 + 0.3 }}
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${i === 0 ? "bg-black animate-pulse" : i === 1 ? "bg-gray-400" : "bg-gray-200"}`}
            />
          </motion.div>
        ))}
      </div>
      {/* bottom hint */}
      <div className="px-4 pb-4 pt-1">
        <div className="flex items-center gap-1.5">
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="w-1 h-1 rounded-full bg-black/50"
          />
          <span className="text-black/50 text-[9px] font-mono">Working on it…</span>
        </div>
      </div>
    </div>
  );
}

// ─── Frame 3: App preview ───────────────────────────────────────────────────
const WORKOUT_ITEMS = [
  { label: "Morning Run", sub: "5.2 km · 32 min", done: true },
  { label: "Push-ups", sub: "3 sets × 20 reps", done: true },
  { label: "Evening Stretch", sub: "15 min", done: false },
];

function Frame3() {
  const [badgeVisible, setBadgeVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBadgeVisible(true), 800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col h-full bg-white rounded-[28px] overflow-hidden relative">
      <PhoneHeader />
      {/* app header */}
      <div className="px-4 py-3 bg-white border-b border-black/[0.06]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-black text-[13px] font-bold leading-tight">Fitness Tracker</p>
            <p className="text-gray-400 text-[9px] mt-0.5">Today · 2 of 3 complete</p>
          </div>
          <div className="w-7 h-7 rounded-full bg-black/[0.06] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2C4.24 2 2 4.24 2 7s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 9c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" fill="#000" opacity="0.4"/>
              <path d="M7 4.5v2.75l1.75 1.75" stroke="#000" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
            </svg>
          </div>
        </div>
      </div>
      {/* progress bar */}
      <div className="px-4 py-2 bg-white">
        <div className="h-1 bg-black/[0.08] rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "66%" }}
            transition={{ duration: 1, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="h-full bg-black rounded-full"
          />
        </div>
      </div>
      {/* workout list */}
      <div className="flex-1 px-3 py-2 flex flex-col gap-1.5 overflow-hidden">
        <p className="text-black/30 text-[8.5px] uppercase tracking-wider font-mono px-1 mb-0.5">Today's Workouts</p>
        {WORKOUT_ITEMS.map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.15 + 0.2, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl ${
              item.done
                ? "bg-black/[0.04]"
                : "bg-black/[0.02]"
            }`}
          >
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
              item.done ? "border-black bg-black" : "border-black/30"
            }`}>
              {item.done && (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-medium leading-tight ${item.done ? "text-black/40 line-through" : "text-black"}`}>
                {item.label}
              </p>
              <p className="text-black/30 text-[8px] mt-0.5">{item.sub}</p>
            </div>
          </motion.div>
        ))}
      </div>
      {/* bottom nav */}
      <div className="px-4 pb-4 pt-2 border-t border-black/[0.06] flex items-center justify-around">
        {["Home", "Stats", "Goals"].map((tab, i) => (
          <div key={tab} className={`flex flex-col items-center gap-0.5 ${i === 0 ? "opacity-100" : "opacity-25"}`}>
            <div className="w-4 h-4 rounded-sm bg-black"
              style={{ clipPath: i === 0 ? "polygon(20% 0%,80% 0%,100% 100%,0% 100%)" : undefined }}
            />
            <span className="text-[7px] text-black">{tab}</span>
          </div>
        ))}
      </div>

      {/* App Ready badge */}
      <AnimatePresence>
        {badgeVisible && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 18 }}
            className="absolute bottom-14 right-3 flex items-center gap-1.5 bg-black rounded-full px-2.5 py-1 shadow-lg shadow-black/20"
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M2 5.5L4.5 8L8 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-white text-[9px] font-semibold whitespace-nowrap">App Ready</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Phone shell wrapper ────────────────────────────────────────────────────
function PhoneDemo() {
  const frame = usePhoneFrames();

  return (
    <div className="relative mx-auto" style={{ width: 280, height: 560 }}>
      {/* blue-purple ambient glow behind phone */}
      <div
        className="absolute pointer-events-none"
        style={{
          inset: "-60px",
          background: "radial-gradient(ellipse at 50% 50%, rgba(99,102,255,0.22) 0%, rgba(139,92,246,0.14) 40%, transparent 70%)",
          filter: "blur(28px)",
        }}
      />
      {/* outer shell */}
      <div
        className="absolute inset-0 rounded-[44px] shadow-2xl"
        style={{
          background: "linear-gradient(145deg, #2a2a3e 0%, #0d0d1a 60%, #1a1a2e 100%)",
          boxShadow: "0 40px 80px rgba(0,0,0,0.50), 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.12)",
        }}
      />
      {/* side buttons */}
      <div className="absolute -left-[3px] top-[110px] w-[3px] h-10 bg-[#1a1a2e] rounded-l-sm" />
      <div className="absolute -left-[3px] top-[168px] w-[3px] h-10 bg-[#1a1a2e] rounded-l-sm" />
      <div className="absolute -right-[3px] top-[136px] w-[3px] h-14 bg-[#1a1a2e] rounded-r-sm" />
      {/* screen bezel */}
      <div className="absolute inset-[7px] rounded-[37px] bg-white overflow-hidden">
        {/* notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-6 bg-[#0d0d1a] rounded-b-2xl z-10 flex items-center justify-center gap-1.5 pt-1">
          <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
          <div className="w-8 h-2 rounded-full bg-white/10" />
        </div>
        {/* frame content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={frame}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="absolute inset-0"
          >
            {frame === 0 && <Frame1 />}
            {frame === 1 && <Frame2 />}
            {frame === 2 && <Frame3 />}
          </motion.div>
        </AnimatePresence>
      </div>
      {/* home indicator */}
      <div className="absolute bottom-[12px] left-1/2 -translate-x-1/2 w-20 h-1 bg-white/20 rounded-full" />
      {/* top glow */}
      <div
        className="absolute inset-0 rounded-[44px] pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 50% 0%, rgba(99,102,255,0.15) 0%, transparent 60%)",
        }}
      />
    </div>
  );
}

// ─── Feature cards ──────────────────────────────────────────
const FEATURES = [
  {
    icon: <div className="w-20 h-20 flex items-center justify-center"><img src={iconFeature1} alt="Build anywhere" className="w-full h-full object-contain" /></div>,
    title: "Build anywhere, anytime",
    desc: "Cascade AI works on all your devices — phone, tablet, PC. So you can build anywhere at anytime.",
  },
  {
    icon: <div className="w-14 h-14 flex items-center justify-center"><img src={iconFeature2} alt="Full-stack power" className="w-full h-full object-contain" /></div>,
    title: "Full-stack power at your fingertips",
    desc: "From feature planning, coding, to testing, our full-stack agent works across your frontend and backend to ship anything you want.",
  },
  {
    icon: <div className="w-14 h-14 flex items-center justify-center"><img src={iconFeature3} alt="Ready, set, deploy" className="w-full h-full object-contain" /></div>,
    title: "Ready, set, deploy",
    desc: "We provide hosting, operation, and domain on our platform, so you can go live whenever you are ready.",
  },
  {
    icon: <div className="w-14 h-14 flex items-center justify-center bg-white"><img src={iconFeature4} alt="Unlock value" className="w-full h-full object-contain" /></div>,
    title: "Unlock the value in your ideas",
    desc: "Your idea just got more valuable. Our agent helps you go-to-market with everything you need for a successful business.",
  },
];

// ─── Fade-up animation variant ──────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

// ─── Shared waitlist form ────────────────────────────────────────────────────
function WaitlistForm({
  email, setEmail, submitted, submitting, submitError, onSubmit, testIdInput, testIdButton,
}: {
  email: string;
  setEmail: (v: string) => void;
  submitted: boolean;
  submitting: boolean;
  submitError: string;
  onSubmit: (e: React.FormEvent) => void;
  testIdInput?: string;
  testIdButton?: string;
}) {
  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="inline-flex items-center gap-2 px-5 py-3 rounded-[12px] text-[13px] font-medium"
        style={{ background: "rgba(17,24,39,0.06)", color: "#111827", border: "1px solid rgba(0,0,0,0.08)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        You're on the list!
      </motion.div>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate className="w-full">
      <div
        className="flex items-center rounded-[12px] overflow-hidden w-full sm:w-[360px]"
        style={{
          background: "rgba(255,255,255,0.90)",
          border: "1px solid rgba(0,0,0,0.12)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          padding: "4px 4px 4px 12px",
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email address"
          data-testid={testIdInput}
          className="flex-1 py-2 sm:py-3 bg-transparent text-[13px] sm:text-[14px] outline-none text-gray-800 placeholder:text-gray-400 min-w-0"
        />
        <button
          type="submit"
          disabled={submitting}
          data-testid={testIdButton}
          className="shrink-0 flex items-center justify-center px-3 py-2 sm:px-5 sm:py-3 rounded-[8px] text-[13px] sm:text-[14px] font-semibold text-white transition-all duration-200 hover:opacity-85 active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
          style={{ backgroundColor: "#000000" }}
        >
          {submitting ? "…" : "Get one month free"}
        </button>
      </div>
      {submitError && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 text-[12px] text-red-500 text-center">
          {submitError}
        </motion.p>
      )}
    </form>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0.7]);
  const heroY = useTransform(scrollY, [0, 300], [0, 30]);

  useEffect(() => {
    const unsub = scrollY.on("change", (v) => setScrolled(v > 20));
    return () => unsub();
  }, [scrollY]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setSubmitError("Please enter your email address."); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) { setSubmitError("Please enter a valid email address."); return; }
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setSubmitError((data as { error?: string }).error ?? "Something went wrong — please try again.");
      }
    } catch {
      setSubmitError("Unable to reach the server — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-white" style={{ fontFamily: FONT }}>

      {/* Navbar */}
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          backdropFilter: scrolled ? "blur(14px)" : "none",
          backgroundColor: scrolled ? "rgba(255,255,255,0.80)" : "transparent",
          borderBottom: scrolled ? "1px solid rgba(0,0,0,0.07)" : "1px solid transparent",
        }}
      >
        <div className="max-w-7xl mx-auto px-8 h-20 flex items-center justify-between">
          <img src={cascadeLogo} alt="Cascade AI" data-testid="nav-logo" className="h-8 w-auto object-contain" />
          <a
            href="/login"
            className="px-5 py-2 rounded-full text-[14px] font-semibold text-white transition-all duration-200 hover:opacity-85 active:scale-[0.97]"
            style={{ backgroundColor: "#000000" }}
          >
            Try it now
          </a>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-6 pt-40 pb-8 sm:pb-20 lg:pt-28 lg:pb-20">
        <motion.div style={{ opacity: heroOpacity, y: heroY }} className="relative z-10 w-full max-w-3xl mx-auto text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
          >
            <motion.h1
              variants={fadeUp}
              custom={0}
              className="tracking-tight font-bold leading-[1.15] text-black mb-12"
              style={{ fontSize: "clamp(48px, 7vw, 76px)", fontFamily: FONT }}
            >
              <span className="block">Build more.</span>
              <span className="block">Hustle less.</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              custom={1}
              className="text-[19px] sm:text-[22px] text-gray-800 mb-12 leading-relaxed lg:whitespace-nowrap"
              lang="en"
            >
              See your ideas come to life, and scale to new heights — all with Cascade AI.
            </motion.p>

            <motion.div variants={fadeUp} custom={2} className="flex justify-center w-full px-0 sm:px-0">
              <div className="w-full sm:w-auto">
                <WaitlistForm
                  email={email} setEmail={setEmail}
                  submitted={submitted} submitting={submitting} submitError={submitError}
                  onSubmit={handleSubmit}
                  testIdInput="input-email" testIdButton="button-join-waitlist"
                />
              </div>
            </motion.div>

          </motion.div>
        </motion.div>
      </section>

      {/* ── Feature highlights ── */}
      <section className="pt-8 pb-16 sm:py-24 px-6 sm:px-16 bg-white">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
            variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
          >
            <motion.p
              variants={fadeUp}
              className="text-center text-[19px] font-semibold tracking-wide text-gray-400 mb-5 mx-auto leading-tight uppercase px-4 sm:text-[22px]"
            >
              CASCADE AI IS THE ALL-IN-ONE AGENTIC SOLUTION FOR EVERY BUILDER, WITH OR WITHOUT AN IDEA.
            </motion.p>
            <motion.h2
              variants={fadeUp}
              custom={1}
              className="text-center font-bold text-black mb-5 sm:mb-16 leading-[1.2]"
              style={{ fontFamily: FONT }}
            >
              <span className="block sm:hidden text-black whitespace-nowrap" style={{ fontSize: "8.5vw" }}>One tool.</span>
              <span className="block sm:hidden text-black whitespace-nowrap" style={{ fontSize: "8.5vw" }}>Every platform.</span>
              <span className="block sm:hidden text-black whitespace-nowrap" style={{ fontSize: "8.5vw" }}>Infinite potential.</span>
              <span className="hidden sm:block text-black" style={{ fontSize: "clamp(48px, 7vw, 76px)" }}>One tool.</span>
              <span className="hidden sm:block text-black" style={{ fontSize: "clamp(48px, 7vw, 76px)" }}>Every platform.</span>
              <span className="hidden sm:block text-black" style={{ fontSize: "clamp(48px, 7vw, 76px)" }}>Infinite potential.</span>
            </motion.h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-10 place-items-center mx-auto max-w-[360px] sm:max-w-none">
              {FEATURES.map((f, i) => (
                <motion.div
                  key={f.title}
                  variants={fadeUp}
                  custom={i + 2}
                  className="flex flex-col gap-4 sm:gap-5 p-6 sm:p-10 rounded-2xl w-full sm:max-w-none text-center sm:text-left items-center sm:items-start bg-white"
                >
                  <div className="text-gray-800 sm:h-20 flex sm:items-end">{f.icon}</div>
                  <div>
                    <p
                      className="font-semibold text-gray-900 leading-tight mb-2 [text-wrap:balance] sm:[text-wrap:unset] max-w-[260px] sm:max-w-none mx-auto sm:mx-0"
                      style={{ fontSize: "clamp(20px, 3.5vw, 22px)", fontFamily: FONT }}
                    >
                      {f.title}
                    </p>
                    <p className="text-[16px] sm:text-[16px] text-gray-700 leading-relaxed [text-wrap:balance] w-full sm:w-[340px] lg:w-[380px]" lang="en">{f.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-16 sm:py-40 px-6 sm:px-12 bg-white">
        <motion.div
          className="max-w-3xl mx-auto text-center"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
        >
          <motion.h2
            variants={fadeUp}
            className="font-bold text-black mb-10 sm:mb-12 leading-[1.15]"
            style={{ fontSize: "clamp(42px, 7vw, 68px)", fontFamily: FONT }}
          >
            <span className="block">Build More.</span>
            <span className="block">Hustle Less.</span>
          </motion.h2>
          <motion.div variants={fadeUp} custom={1} className="flex justify-center w-full px-0 sm:px-0">
            <div className="w-full sm:w-auto">
              <WaitlistForm
                email={email} setEmail={setEmail}
                submitted={submitted} submitting={submitting} submitError={submitError}
                onSubmit={handleSubmit}
                testIdButton="button-join-waitlist-bottom"
              />
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-8 border-t border-black/[0.06]">
        <div className="max-w-7xl mx-auto flex flex-col items-center gap-3 md:flex-row md:justify-between">
          <img
            src={cascadeLogo}
            alt="Cascade AI"
            className="hidden md:block h-6 w-auto"
            style={{ filter: "brightness(0)" }}
          />
          <div className="flex flex-col items-center gap-1.5 md:items-end">
            <p className="text-[13px] text-gray-400">© 2026 Cascade AI. All rights reserved.</p>
            <SiteBeian />
          </div>
        </div>
      </footer>
    </div>
  );
}
