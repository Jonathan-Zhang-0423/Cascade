import { useState, useEffect, useRef, useCallback } from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import cascadeLogo from "../assets/cascade-logo.png";

// ─── Particle canvas for hero section ──────────────────────────────────────
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const init = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    if (!ctx) return;

    let W = (canvas.width = canvas.offsetWidth);
    let H = (canvas.height = canvas.offsetHeight);

    const mouse = { x: W / 2, y: H / 2, px: W / 2, py: H / 2, vx: 0, vy: 0 };
    const particles: Particle[] = [];
    const MAX = 400;
    const HUES = [220, 240, 260, 200, 280];

    class Particle {
      x: number; y: number;
      vx: number; vy: number;
      life: number; decay: number;
      size: number; hue: number; sat: number; lit: number;
      trail: { x: number; y: number }[];
      maxTrail: number; gravity: number;

      constructor(x: number, y: number, opts: {
        angle?: number; speed?: number; decay?: number;
        size?: number; hue?: number; maxTrail?: number; gravity?: number;
      } = {}) {
        this.x = x; this.y = y;
        const angle = opts.angle ?? Math.random() * Math.PI * 2;
        const speed = opts.speed ?? Math.random() * 2.5 + 0.5;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = 1;
        this.decay = opts.decay ?? Math.random() * 0.014 + 0.008;
        this.size = opts.size ?? Math.random() * 2 + 0.5;
        this.hue = opts.hue ?? HUES[Math.floor(Math.random() * HUES.length)];
        this.sat = 70 + Math.random() * 20;
        this.lit = 35 + Math.random() * 20;
        this.trail = [];
        this.maxTrail = opts.maxTrail ?? Math.floor(Math.random() * 7 + 3);
        this.gravity = opts.gravity ?? 0;
      }

      update() {
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > this.maxTrail) this.trail.shift();
        this.vx *= 0.97; this.vy *= 0.97;
        this.vy += this.gravity;
        this.x += this.vx; this.y += this.vy;
        this.life -= this.decay;
      }

      draw(c: CanvasRenderingContext2D) {
        if (this.life <= 0) return;
        const a = Math.max(0, this.life);
        if (this.trail.length > 1) {
          c.beginPath();
          c.moveTo(this.trail[0].x, this.trail[0].y);
          for (let i = 1; i < this.trail.length; i++) c.lineTo(this.trail[i].x, this.trail[i].y);
          c.strokeStyle = `hsla(${this.hue},${this.sat}%,${this.lit}%,${a * 0.25})`;
          c.lineWidth = this.size * 0.5;
          c.lineCap = "round";
          c.stroke();
        }
        const g = c.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size * 5);
        g.addColorStop(0, `hsla(${this.hue},${this.sat}%,${this.lit}%,${a * 0.18})`);
        g.addColorStop(1, `hsla(${this.hue},${this.sat}%,${this.lit}%,0)`);
        c.beginPath(); c.arc(this.x, this.y, this.size * 5, 0, Math.PI * 2);
        c.fillStyle = g; c.fill();
        c.beginPath(); c.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        c.fillStyle = `hsla(${this.hue},${this.sat}%,${this.lit}%,${a * 0.85})`;
        c.fill();
      }

      get dead() { return this.life <= 0; }
    }

    function spawnTrail(speed: number) {
      if (particles.length >= MAX) return;
      const count = Math.min(Math.floor(speed * 1.2 + 1), 4);
      for (let i = 0; i < count; i++) {
        const angle = Math.atan2(mouse.vy, mouse.vx) + (Math.random() - 0.5) * 1.4;
        particles.push(new Particle(mouse.x, mouse.y, {
          angle, speed: Math.random() * 1.8 + 0.4,
          decay: 0.02 + Math.random() * 0.015,
          size: Math.random() * 1.8 + 0.4,
          maxTrail: 5, gravity: 0.025,
        }));
      }
    }

    function explode(x: number, y: number) {
      const count = 60 + Math.floor(Math.random() * 30);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        particles.push(new Particle(x, y, {
          angle, speed: Math.random() * 6 + 1.5,
          decay: 0.01 + Math.random() * 0.012,
          size: Math.random() * 2.5 + 0.8,
          maxTrail: 9, gravity: 0.04,
        }));
      }
    }

    let frame = 0;
    let rafId: number;

    function loop() {
      rafId = requestAnimationFrame(loop);
      frame++;
      ctx.clearRect(0, 0, W, H);
      // fade trail with transparent overlay instead of white fill
      ctx.fillStyle = "rgba(0,0,0,0.04)";
      ctx.fillRect(0, 0, W, H);

      mouse.vx = mouse.x - mouse.px;
      mouse.vy = mouse.y - mouse.py;
      mouse.px = mouse.x; mouse.py = mouse.y;
      const speed = Math.sqrt(mouse.vx ** 2 + mouse.vy ** 2);
      if (frame % 2 === 0 && speed > 0.8) spawnTrail(speed);

      for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        particles[i].draw(ctx);
        if (particles[i].dead) particles.splice(i, 1);
      }

      if (particles.length < 150) {
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 55) {
              const a = (1 - dist / 55) * Math.min(particles[i].life, particles[j].life) * 0.2;
              ctx.beginPath();
              ctx.moveTo(particles[i].x, particles[i].y);
              ctx.lineTo(particles[j].x, particles[j].y);
              ctx.strokeStyle = `hsla(230,70%,40%,${a})`;
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }
      }
    }

    function onMouseMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }
    function onClick(e: MouseEvent) {
      explode(e.clientX, e.clientY);
    }
    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      mouse.x = t.clientX;
      mouse.y = t.clientY;
    }
    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      explode(t.clientX, t.clientY);
    }
    function onResize() {
      const c = canvasRef.current;
      if (!c) return;
      W = c.width = window.innerWidth;
      H = c.height = window.innerHeight;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("click", onClick);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("resize", onResize);
    loop();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("click", onClick);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const cleanup = init();
    return cleanup;
  }, [init]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full"
      style={{ cursor: "crosshair", zIndex: 0, pointerEvents: "none" }}
    />
  );
}

// ─── Typewriter for hero heading ───────────────────────────────────────────
const WORDS = ["Your Phone", "Your Tablet", "Your PC", "Every Device"];
const TYPE_SPEED = 70;
const DELETE_SPEED = 40;
const PAUSE_AFTER_TYPE = 1400;
const PAUSE_AFTER_DELETE = 300;
const FINAL_PAUSE = 30000;

function useTypewriter() {
  const firstWord = WORDS[0];
  const [displayed, setDisplayed] = useState(firstWord);
  const [cursorVisible, setCursorVisible] = useState(true);
  const wordIndex = useRef(0);
  const charIndex = useRef(firstWord.length);
  const isDeleting = useRef(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    function tick() {
      const word = WORDS[wordIndex.current];
      const atEnd = charIndex.current === word.length;
      const atStart = charIndex.current === 0;
      const isLast = wordIndex.current === WORDS.length - 1;
      if (!isDeleting.current) {
        if (atEnd) {
          if (isLast) {
            timeout = setTimeout(() => { isDeleting.current = true; tick(); }, FINAL_PAUSE);
            return;
          }
          timeout = setTimeout(() => { isDeleting.current = true; tick(); }, PAUSE_AFTER_TYPE);
          return;
        }
        charIndex.current += 1;
        setDisplayed(word.slice(0, charIndex.current));
        timeout = setTimeout(tick, TYPE_SPEED);
      } else {
        if (atStart) {
          isDeleting.current = false;
          wordIndex.current = (wordIndex.current + 1) % WORDS.length;
          timeout = setTimeout(tick, PAUSE_AFTER_DELETE);
          return;
        }
        charIndex.current -= 1;
        setDisplayed(word.slice(0, charIndex.current));
        timeout = setTimeout(tick, DELETE_SPEED);
      }
    }
    // Start from end of first word, wait then begin delete cycle
    timeout = setTimeout(() => { tick(); }, PAUSE_AFTER_TYPE);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, []);

  return { displayed, cursorVisible };
}

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
    <div className="flex flex-col h-full bg-[#0d1117] rounded-[28px] overflow-hidden">
      {/* status bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[10px] text-white/60 font-medium">9:41</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-[6px] rounded-sm border border-white/40 relative">
            <div className="absolute inset-[1px] right-[2px] bg-white/40 rounded-sm" />
          </div>
        </div>
      </div>
      {/* header */}
      <div className="px-4 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <span className="text-white text-[9px] font-bold">C</span>
          </div>
          <span className="text-white text-[12px] font-semibold">Cascade AI</span>
        </div>
      </div>
      {/* messages */}
      <div className="flex-1 px-3 py-3 flex flex-col gap-2 overflow-hidden">
        <div className="self-start max-w-[80%] bg-white/[0.07] rounded-2xl rounded-tl-sm px-3 py-2">
          <p className="text-white/70 text-[10px] leading-relaxed">Hi! What would you like to build today?</p>
        </div>
        <div className="self-end max-w-[85%] bg-blue-600 rounded-2xl rounded-tr-sm px-3 py-2">
          <p className="text-white text-[10px] leading-relaxed">
            {typed}
            <span style={{ opacity: cursor ? 1 : 0, transition: "opacity 0.1s" }}>|</span>
          </p>
        </div>
      </div>
      {/* input bar */}
      <div className="px-3 pb-4 pt-2 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 bg-white/[0.06] rounded-full px-3 py-2">
          <span className="text-white/30 text-[10px] flex-1">Message Cascade...</span>
          <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
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
      className="w-3.5 h-3.5 rounded-full border-2 border-blue-400/30 border-t-blue-400"
    />
  );
}

function Frame2() {
  return (
    <div className="flex flex-col h-full bg-[#0d1117] rounded-[28px] overflow-hidden">
      {/* status bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[10px] text-white/60 font-medium">9:41</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-[6px] rounded-sm border border-white/40 relative">
            <div className="absolute inset-[1px] right-[2px] bg-white/40 rounded-sm" />
          </div>
        </div>
      </div>
      {/* header */}
      <div className="px-4 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <span className="text-white text-[9px] font-bold">C</span>
          </div>
          <span className="text-white text-[12px] font-semibold">Cascade AI</span>
        </div>
      </div>
      {/* plan content */}
      <div className="flex-1 px-3 py-3 flex flex-col gap-2 overflow-hidden">
        <p className="text-white/50 text-[9px] font-mono uppercase tracking-wider mb-1">Execution Plan</p>
        {PLAN_STEPS.map((step, i) => (
          <motion.div
            key={step.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.45, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-2 bg-white/[0.05] border border-white/[0.07] rounded-xl px-3 py-2 relative overflow-hidden"
          >
            {/* blue left border */}
            <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-blue-500 rounded-l-xl" />
            <div className="pl-1 shrink-0">
              {i === 0 ? <SpinnerIcon /> :
               i === 1 ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-blue-400">
                  <rect x="1" y="2" width="12" height="2" rx="1" fill="currentColor" opacity="0.6"/>
                  <rect x="1" y="6" width="9" height="2" rx="1" fill="currentColor" opacity="0.8"/>
                  <rect x="1" y="10" width="6" height="2" rx="1" fill="currentColor"/>
                </svg>
               ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-blue-400">
                  <path d="M3 11L6 8L3 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M7 11H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M7 8H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
               )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-[10px] font-medium leading-tight">{step.label}</p>
              <p className="text-white/40 text-[8.5px] leading-tight mt-0.5">{step.desc}</p>
            </div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: i < 2 ? 1 : 0.3 }}
              transition={{ delay: i * 0.45 + 0.3 }}
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${i === 0 ? "bg-blue-400 animate-pulse" : i === 1 ? "bg-yellow-400" : "bg-white/20"}`}
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
            className="w-1 h-1 rounded-full bg-blue-400"
          />
          <span className="text-blue-400/70 text-[9px] font-mono">Working on it…</span>
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
    <div className="flex flex-col h-full bg-[#0d1117] rounded-[28px] overflow-hidden relative">
      {/* status bar — green tint */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1 bg-[#0d1f14]">
        <span className="text-[10px] text-white/60 font-medium">9:41</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-[6px] rounded-sm border border-white/40 relative">
            <div className="absolute inset-[1px] right-[2px] bg-white/40 rounded-sm" />
          </div>
        </div>
      </div>
      {/* app header */}
      <div className="px-4 py-3 bg-[#0d1f14] border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white text-[13px] font-bold leading-tight">Fitness Tracker</p>
            <p className="text-green-400/70 text-[9px] mt-0.5">Today · 2 of 3 complete</p>
          </div>
          <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2C4.24 2 2 4.24 2 7s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 9c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" fill="#4ade80" opacity="0.7"/>
              <path d="M7 4.5v2.75l1.75 1.75" stroke="#4ade80" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </div>
        </div>
      </div>
      {/* progress bar */}
      <div className="px-4 py-2 bg-[#0d1f14]">
        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "66%" }}
            transition={{ duration: 1, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full"
          />
        </div>
      </div>
      {/* workout list */}
      <div className="flex-1 px-3 py-2 flex flex-col gap-1.5 overflow-hidden">
        <p className="text-white/40 text-[8.5px] uppercase tracking-wider font-mono px-1 mb-0.5">Today's Workouts</p>
        {WORKOUT_ITEMS.map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.15 + 0.2, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${
              item.done
                ? "bg-green-500/[0.08] border-green-500/20"
                : "bg-white/[0.04] border-white/[0.06]"
            }`}
          >
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
              item.done ? "border-green-400 bg-green-400" : "border-white/30"
            }`}>
              {item.done && (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-medium leading-tight ${item.done ? "text-white/60 line-through" : "text-white"}`}>
                {item.label}
              </p>
              <p className="text-white/30 text-[8px] mt-0.5">{item.sub}</p>
            </div>
          </motion.div>
        ))}
      </div>
      {/* bottom nav */}
      <div className="px-4 pb-4 pt-2 border-t border-white/[0.06] flex items-center justify-around">
        {["Home", "Stats", "Goals"].map((tab, i) => (
          <div key={tab} className={`flex flex-col items-center gap-0.5 ${i === 0 ? "opacity-100" : "opacity-30"}`}>
            <div className={`w-4 h-4 rounded-sm ${i === 0 ? "bg-green-400" : "bg-white/40"}`}
              style={{ clipPath: i === 0 ? "polygon(20% 0%,80% 0%,100% 100%,0% 100%)" : undefined }}
            />
            <span className={`text-[7px] ${i === 0 ? "text-green-400" : "text-white/40"}`}>{tab}</span>
          </div>
        ))}
      </div>

      {/* ✓ App Ready badge */}
      <AnimatePresence>
        {badgeVisible && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 18 }}
            className="absolute bottom-14 right-3 flex items-center gap-1.5 bg-green-500 rounded-full px-2.5 py-1 shadow-lg shadow-green-500/30"
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
      {/* ambient glow behind phone */}
      <div
        className="absolute pointer-events-none"
        style={{
          inset: "-60px",
          background: "radial-gradient(ellipse at 50% 50%, rgba(99,130,255,0.18) 0%, rgba(139,92,246,0.10) 40%, transparent 70%)",
          filter: "blur(24px)",
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
      <div className="absolute inset-[7px] rounded-[37px] bg-[#080810] overflow-hidden">
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
          background: "radial-gradient(ellipse at 50% 0%, rgba(79,130,255,0.18) 0%, transparent 60%)",
        }}
      />
    </div>
  );
}

// ─── Feature cards ──────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 16v2M13 16v2M5 18h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <rect x="5" y="2" width="6" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
    ),
    title: "Works on Every Device",
    desc: "Build your App from your phone, tablet, or desktop — Cascade works wherever you are",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M3 14l4-4 3 3 3-4 4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="2" y="3" width="16" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
    title: "Multi-Platform Output",
    desc: "Generate Web apps, React Native, Flutter, or WeChat Mini Programs in one click",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 2L10 5M10 15L10 18M2 10L5 10M15 10L18 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
      </svg>
    ),
    title: "Live Preview",
    desc: "Every code change reflects instantly in the preview — what you see is what you ship",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 3C6.13 3 3 6.13 3 10s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10 6v4l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: "AI-Powered Planning",
    desc: "One sentence is all it takes — Cascade breaks it into a full execution plan automatically",
  },
];

// ─── How It Works steps ─────────────────────────────────────────────────────
const HOW_STEPS = [
  {
    num: "01",
    title: "Describe Your Idea",
    desc: "Type one sentence about the app you want. No technical knowledge required.",
  },
  {
    num: "02",
    title: "AI Plans & Builds",
    desc: "Cascade analyzes your request, generates a step-by-step plan, and executes it automatically.",
  },
  {
    num: "03",
    title: "See It Live",
    desc: "Your app appears in real time. Tweak, preview, and launch — all from the same screen.",
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

// ─── Main page ──────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { displayed, cursorVisible } = useTypewriter();

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
    <div className="min-h-screen w-full overflow-x-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      <ParticleCanvas />
      {/* Background */}
      <div
        className="fixed inset-0 -z-10"
        style={{
          background: "radial-gradient(ellipse 120% 80% at 50% -10%, #c8d0d8 0%, #dde1e6 25%, #edeff2 50%, #f6f7f9 75%, #ffffff 100%)",
        }}
      />

      {/* Navbar */}
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          backdropFilter: scrolled ? "blur(14px)" : "none",
          backgroundColor: scrolled ? "rgba(255,255,255,0.80)" : "transparent",
          borderBottom: scrolled ? "1px solid rgba(0,0,0,0.07)" : "1px solid transparent",
        }}
      >
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <img src={cascadeLogo} alt="Cascade AI" data-testid="nav-logo" className="h-7 w-auto object-contain" />
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-20 pb-12" style={{ padding: "80px 6% 48px 12%" }}>
        <motion.div style={{ opacity: heroOpacity, y: heroY }} className="relative z-10 w-full">
          <div className="flex flex-col lg:flex-row items-center gap-16">

            {/* Left: copy — equal flex */}
            <motion.div
              className="flex-1 text-center lg:text-left max-w-xl mx-auto lg:mx-0"
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
            >
              {/* eyebrow */}
              <motion.div variants={fadeUp} custom={0} className="inline-flex items-center gap-2 mb-5">
                <span
                  className="text-[11px] font-semibold tracking-widest uppercase px-3 py-1 rounded-full"
                  style={{
                    background: "rgba(17,24,39,0.06)",
                    color: "#374151",
                    border: "1px solid rgba(0,0,0,0.08)",
                  }}
                >
                  Now in Beta
                </span>
              </motion.div>

              <motion.h1
                variants={fadeUp}
                custom={1}
                className="text-[38px] sm:text-[46px] lg:text-[52px] tracking-tight font-bold leading-[1.1] text-[#000000] mb-6"
              >
                The AI that Turns<br />Your Ideas into<br />Real Apps
              </motion.h1>

              <motion.p
                variants={fadeUp}
                custom={2}
                className="text-[16px] sm:text-[18px] text-[#706c6c] mb-8 leading-relaxed max-w-lg mx-auto lg:mx-0"
              >
                Building with AI should not be confined to computers. From feature planning to coding, app testing to deployment, Cascade AI does it all — on every device you own.
              </motion.p>

              {/* Waitlist form */}
              <motion.form
                variants={fadeUp}
                custom={3}
                onSubmit={handleSubmit}
                noValidate
                className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 max-w-md mx-auto lg:mx-0"
              >
                {submitted ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-2 px-6 py-3 rounded-md text-sm font-medium"
                    style={{ background: "rgba(17,24,39,0.06)", color: "#111827", border: "1px solid rgba(0,0,0,0.08)" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    You're on the list — we'll be in touch!
                  </motion.div>
                ) : (
                  <>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email address"
                      data-testid="input-email"
                      className="w-full sm:w-64 px-4 py-3 rounded-md text-sm outline-none transition-all duration-200 text-center sm:text-left"
                      style={{
                        background: "rgba(255,255,255,0.85)",
                        border: "1px solid rgba(0,0,0,0.12)",
                        color: "#1a1f2e",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                      }}
                      onFocus={(e) => { e.currentTarget.style.border = "1px solid rgba(17,24,39,0.55)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(17,24,39,0.08)"; }}
                      onBlur={(e) => { e.currentTarget.style.border = "1px solid rgba(0,0,0,0.12)"; e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; }}
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      data-testid="button-join-waitlist"
                      className="w-full sm:w-auto px-6 py-3 rounded-md text-sm font-semibold text-white whitespace-nowrap transition-all duration-200 cursor-pointer hover:scale-[1.03] active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
                      style={{ backgroundColor: "#000000", boxShadow: "0 2px 8px rgba(0,0,0,0.20)" }}
                    >
                      {submitting ? "Joining…" : "Join Waitlist"}
                    </button>
                  </>
                )}
              </motion.form>
              {submitError && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 text-xs text-red-500">
                  {submitError}
                </motion.p>
              )}
              <motion.p variants={fadeUp} custom={4} className="mt-4 text-gray-400 text-[13px]">
                Free to join. Be the first to get access.
              </motion.p>

              {/* Typewriter sub-line */}
              <motion.p variants={fadeUp} custom={5} className="mt-6 text-[13px] text-gray-400">
                Works on{" "}
                <span className="font-semibold text-gray-700 inline-block min-w-[2ch]">{displayed}</span>
                <span aria-hidden="true" style={{ opacity: cursorVisible ? 1 : 0, transition: "opacity 0.1s" }}>|</span>
              </motion.p>
            </motion.div>

            {/* Right: phone demo — equal flex */}
            <motion.div
              className="flex-1 flex items-center justify-center"
              initial={{ opacity: 0, y: 32, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <PhoneDemo />
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* ── Feature highlights ── */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
          >
            <motion.p variants={fadeUp} className="text-center text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
              Everything You Need
            </motion.p>
            <motion.h2 variants={fadeUp} custom={1} className="text-center text-[28px] sm:text-[34px] font-bold text-gray-900 mb-12 leading-tight">
              One tool. Every platform.
            </motion.h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {FEATURES.map((f, i) => (
                <motion.div
                  key={f.title}
                  variants={fadeUp}
                  custom={i + 2}
                  className="flex flex-col gap-3 rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1"
                  style={{
                    background: "rgba(255,255,255,0.60)",
                    backdropFilter: "blur(12px)",
                    border: "1px solid rgba(0,0,0,0.07)",
                    boxShadow: "0 2px 16px rgba(0,0,0,0.05)",
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(17,24,39,0.06)", color: "#374151" }}
                  >
                    {f.icon}
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-gray-900 leading-tight mb-1">{f.title}</p>
                    <p className="text-[11px] text-gray-500 leading-relaxed">{f.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={{ visible: { transition: { staggerChildren: 0.12 } } }}
          >
            <motion.p variants={fadeUp} className="text-center text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
              Simple Process
            </motion.p>
            <motion.h2 variants={fadeUp} custom={1} className="text-center text-[28px] sm:text-[34px] font-bold text-gray-900 mb-14 leading-tight">
              How It Works
            </motion.h2>

            <div className="flex flex-col md:flex-row gap-0 md:gap-0 relative">
              {/* connector line desktop */}
              <div className="hidden md:block absolute top-[28px] left-[calc(16.66%+16px)] right-[calc(16.66%+16px)] h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />

              {HOW_STEPS.map((step, i) => (
                <motion.div
                  key={step.num}
                  variants={fadeUp}
                  custom={i + 2}
                  className="flex-1 flex flex-col items-center text-center px-6 py-6 relative"
                >
                  {/* vertical connector mobile */}
                  {i < HOW_STEPS.length - 1 && (
                    <div className="md:hidden absolute bottom-0 left-1/2 -translate-x-1/2 w-px h-6 bg-gray-200" />
                  )}
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 relative z-10"
                    style={{
                      background: "rgba(255,255,255,0.80)",
                      border: "1px solid rgba(0,0,0,0.08)",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                    }}
                  >
                    <span className="text-[18px] font-black text-gray-800">{step.num}</span>
                  </div>
                  <p className="text-[15px] font-semibold text-gray-900 mb-2">{step.title}</p>
                  <p className="text-[13px] text-gray-500 leading-relaxed">{step.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-24 px-6">
        <motion.div
          className="max-w-lg mx-auto text-center"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
        >
          <motion.h2 variants={fadeUp} className="text-[28px] sm:text-[34px] font-bold text-gray-900 mb-4 leading-tight">
            Ready to build your first app?
          </motion.h2>
          <motion.p variants={fadeUp} custom={1} className="text-[15px] text-gray-500 mb-8">
            Join the waitlist and be among the first to experience Cascade AI.
          </motion.p>
          <motion.form
            variants={fadeUp}
            custom={2}
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            {submitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 px-6 py-3 rounded-md text-sm font-medium"
                style={{ background: "rgba(17,24,39,0.06)", color: "#111827", border: "1px solid rgba(0,0,0,0.08)" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                You're on the list — we'll be in touch!
              </motion.div>
            ) : (
              <>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email address"
                  className="w-full sm:w-64 px-4 py-3 rounded-md text-sm outline-none transition-all duration-200 text-center sm:text-left"
                  style={{
                    background: "rgba(255,255,255,0.85)",
                    border: "1px solid rgba(0,0,0,0.12)",
                    color: "#1a1f2e",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  }}
                  onFocus={(e) => { e.currentTarget.style.border = "1px solid rgba(17,24,39,0.55)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(17,24,39,0.08)"; }}
                  onBlur={(e) => { e.currentTarget.style.border = "1px solid rgba(0,0,0,0.12)"; e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; }}
                />
                <button
                  type="submit"
                  disabled={submitting}
                  data-testid="button-join-waitlist-bottom"
                  className="w-full sm:w-auto px-6 py-3 rounded-md text-sm font-semibold text-white whitespace-nowrap transition-all duration-200 cursor-pointer hover:scale-[1.03] active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
                  style={{ backgroundColor: "#000000", boxShadow: "0 2px 8px rgba(0,0,0,0.20)" }}
                >
                  {submitting ? "Joining…" : "Join Waitlist"}
                </button>
              </>
            )}
          </motion.form>
          {submitError && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 text-xs text-red-500">
              {submitError}
            </motion.p>
          )}
          <motion.p variants={fadeUp} custom={3} className="mt-4 text-gray-400 text-[13px]">
            Free to join. Be the first to get access.
          </motion.p>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-black/[0.06]">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <img src={cascadeLogo} alt="Cascade AI" className="h-5 w-auto object-contain opacity-50" />
          <p className="text-[12px] text-gray-400">© 2026 Cascade AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
