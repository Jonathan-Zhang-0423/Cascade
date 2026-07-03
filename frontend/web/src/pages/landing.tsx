import { useState, useEffect } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
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

// ─── Feature cards ──────────────────────────────────────────
const FEATURES = [
  {
    icon: <div className="w-14 h-14 flex items-center justify-center"><img src={iconFeature1} alt="Build anywhere" className="w-full h-full object-contain" /></div>,
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
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 sm:h-20 flex items-center justify-between">
          <img src={cascadeLogo} alt="Cascade AI" data-testid="nav-logo" className="h-6 sm:h-8 w-auto object-contain" />
          <a
            href="/login"
            className="px-4 sm:px-5 py-1.5 sm:py-2 rounded-full text-[13px] sm:text-[14px] font-semibold text-white whitespace-nowrap transition-all duration-200 hover:opacity-85 active:scale-[0.97]"
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
              className="text-[19px] sm:text-[20px] md:text-[22px] text-gray-800 mb-12 leading-relaxed lg:whitespace-nowrap"
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
            className="h-5 md:h-6 w-auto"
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
