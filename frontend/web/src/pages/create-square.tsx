import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useToast } from "@/hooks/use-toast";
import { AppCard, type AppCardData } from "@/components/square/app-card";
import cascadeLogo from "@/assets/cascade-logo.png";

// Inter font — same injection pattern as landing.tsx
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
  hidden: { opacity: 0, y: 28 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const FRAMEWORKS = [
  { value: "", label: "全部" },
  { value: "web", label: "Web" },
  { value: "rn-expo", label: "React Native" },
];

type SortMode = "latest" | "hottest";

export default function CreateSquarePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const userId = useIDEStore((s) => s.userId);
  const syncFromServer = useProjectStore((s) => s.syncFromServer);

  const [apps, setApps] = useState<AppCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [framework, setFramework] = useState("");
  const [sort, setSort] = useState<SortMode>("latest");
  const [offset, setOffset] = useState(0);
  const [forkingId, setForkingId] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  // keep offset in a ref so fetchApps closure stays stable when loading more
  const offsetRef = useRef(0);

  const LIMIT = 20;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const fetchApps = useCallback(async (reset = false) => {
    const off = reset ? 0 : offsetRef.current;
    if (!reset) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(off),
        sort,
        ...(framework ? { framework } : {}),
      });
      const res = await fetch(`/api/square?${params}`);
      const data = await res.json();
      const newApps: AppCardData[] = data.apps ?? [];
      if (reset) {
        setApps(newApps);
        offsetRef.current = newApps.length;
        setOffset(newApps.length);
      } else {
        setApps((prev) => [...prev, ...newApps]);
        offsetRef.current = offsetRef.current + newApps.length;
        setOffset((prev) => prev + newApps.length);
      }
      setHasMore(newApps.length === LIMIT);
    } catch { /* silent */ }
    finally { setLoading(false); setLoadingMore(false); }
  }, [framework, sort]);

  useEffect(() => {
    fetchApps(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framework, sort]);

  async function handleFork(id: string) {
    if (!userId) { navigate("/login"); return; }
    setForkingId(id);
    try {
      const res = await fetch(`/api/square/${id}/fork`, { method: "POST" });
      if (!res.ok) throw new Error();
      await syncFromServer();
      toast({ title: "Fork 成功，已添加到你的项目" });
    } catch {
      toast({ title: "Fork 失败，请重试", variant: "destructive" });
    } finally { setForkingId(null); }
  }

  const filtered = search.trim()
    ? apps.filter(
        (a) =>
          a.title.toLowerCase().includes(search.toLowerCase()) ||
          (a.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
          a.authorUsername.toLowerCase().includes(search.toLowerCase()),
      )
    : apps;

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-white" style={{ fontFamily: FONT }}>

      {/* ── Navbar — exact same pattern as landing ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          backdropFilter: scrolled ? "blur(14px)" : "none",
          backgroundColor: scrolled ? "rgba(255,255,255,0.80)" : "transparent",
          borderBottom: scrolled ? "1px solid rgba(0,0,0,0.07)" : "1px solid transparent",
        }}
      >
        <div className="max-w-7xl mx-auto px-8 h-20 flex items-center justify-between">
          <button type="button" onClick={() => navigate("/")} className="cursor-pointer">
            <img src={cascadeLogo} alt="Cascade AI" className="h-8 w-auto object-contain" />
          </button>
          {userId ? (
            <button
              type="button"
              onClick={() => navigate("/app")}
              className="px-5 py-2 rounded-full text-[14px] font-semibold text-white bg-black transition-all duration-200 hover:opacity-85 active:scale-[0.97]"
            >
              进入工作台
            </button>
          ) : (
            <a
              href="/login"
              className="px-5 py-2 rounded-full text-[14px] font-semibold text-white bg-black transition-all duration-200 hover:opacity-85 active:scale-[0.97]"
            >
              Try it now
            </a>
          )}
        </div>
      </header>

      {/* ── Hero — staggered fadeUp animations, same as landing ── */}
      <section className="pt-36 pb-12 px-6 text-center">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
          className="max-w-3xl mx-auto"
        >
          <motion.p
            variants={fadeUp}
            custom={0}
            className="text-[13px] font-semibold tracking-[0.18em] text-gray-400 mb-5 uppercase"
          >
            COMMUNITY · OPEN SOURCE · AI-BUILT
          </motion.p>

          <motion.h1
            variants={fadeUp}
            custom={1}
            className="font-bold text-black leading-[1.15] mb-6 tracking-tight"
            style={{ fontSize: "clamp(48px, 7vw, 76px)", fontFamily: FONT }}
          >
            <span className="block">创造者广场</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            custom={2}
            className="text-[19px] sm:text-[22px] text-gray-800 mb-10 leading-relaxed"
          >
            浏览社区发布的应用，一键 Fork 开源项目，用 Cascade AI 继续创作。
          </motion.p>

          {/* Search input */}
          <motion.div variants={fadeUp} custom={3} className="flex justify-center">
            <div
              className="flex items-center flex-1 rounded-[10px] overflow-hidden w-full sm:w-[480px]"
              style={{
                background: "rgba(255,255,255,0.90)",
                border: "1px solid rgba(0,0,0,0.12)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                padding: "4px 4px 4px 12px",
              }}
            >
              <Search className="w-4 h-4 text-gray-400 shrink-0 mr-2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索应用名、描述或作者..."
                className="flex-1 py-2 sm:py-2.5 bg-transparent text-[13px] sm:text-[14px] outline-none text-gray-800 placeholder:text-gray-400 min-w-0"
              />
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ── Horizontal tag filter bar + sort tabs ── */}
      <div className="sticky top-20 z-40 bg-white/90 backdrop-blur-sm py-4 border-b border-black/[0.06]">
        <div className="max-w-5xl mx-auto px-6 sm:px-16 flex items-center justify-between gap-4">
          {/* Tag pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {FRAMEWORKS.map((f) => {
              const selected = framework === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFramework(f.value)}
                  className={
                    selected
                      ? "bg-black text-white rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-150"
                      : "text-gray-500 hover:text-gray-900 rounded-full px-4 py-1.5 text-[13px] cursor-pointer transition-all duration-150"
                  }
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Sort tabs */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSort("latest")}
              className={
                sort === "latest"
                  ? "text-black font-semibold text-[13px] transition-colors duration-150"
                  : "text-gray-400 text-[13px] cursor-pointer hover:text-gray-700 transition-colors duration-150"
              }
            >
              最新
            </button>
            <span className="text-gray-300 text-[13px] select-none">|</span>
            <button
              type="button"
              onClick={() => setSort("hottest")}
              className={
                sort === "hottest"
                  ? "text-black font-semibold text-[13px] transition-colors duration-150"
                  : "text-gray-400 text-[13px] cursor-pointer hover:text-gray-700 transition-colors duration-150"
              }
            >
              最热
            </button>
          </div>
        </div>
      </div>

      {/* ── Grid ── */}
      <section className="py-10 sm:py-16 px-6 sm:px-16">
        <div className="max-w-5xl mx-auto">
          {loading ? (
            /* Loading skeleton */
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-2xl bg-gray-100 animate-pulse flex flex-col gap-2 p-3 overflow-hidden">
                  <div className="aspect-[16/9] rounded-xl bg-gray-200 animate-pulse" />
                  <div className="h-3 rounded-full bg-gray-200 animate-pulse w-3/4 mt-1" />
                  <div className="h-2.5 rounded-full bg-gray-200 animate-pulse w-1/2" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            /* Empty state */
            <motion.div
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              className="flex flex-col items-center justify-center py-28 gap-4 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                <Search className="w-7 h-7 text-gray-300" />
              </div>
              <p className="text-[19px] font-semibold text-gray-800">
                {search ? "没有找到相关应用" : "还没有发布的应用"}
              </p>
              <p className="text-[16px] text-gray-500">
                {search ? "换个关键词试试" : "来做第一个发布应用的创造者吧"}
              </p>
            </motion.div>
          ) : (
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
                {filtered.map((app, i) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    index={i}
                    onClick={() => navigate(`/CreateSquare/app/${app.id}`)}
                    onFork={forkingId === app.id ? undefined : handleFork}
                  />
                ))}
              </div>

              {/* Load more */}
              {hasMore && !search && (
                <div className="flex justify-center mt-16">
                  <button
                    type="button"
                    onClick={() => fetchApps(false)}
                    disabled={loadingMore}
                    className="px-8 py-3 rounded-full text-[14px] font-semibold text-white bg-black transition-all duration-200 hover:opacity-85 active:scale-[0.97] disabled:opacity-50"
                  >
                    {loadingMore ? "加载中…" : "加载更多"}
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </section>

      {/* ── Footer — same as landing ── */}
      <footer className="py-8 px-8 border-t border-black/[0.06]">
        <div className="max-w-7xl mx-auto flex flex-col items-center gap-3 md:flex-row md:justify-between">
          <img
            src={cascadeLogo}
            alt="Cascade AI"
            className="hidden md:block h-6 w-auto"
            style={{ filter: "brightness(0)" }}
          />
          <p className="text-[13px] text-gray-400">© 2026 Cascade AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
