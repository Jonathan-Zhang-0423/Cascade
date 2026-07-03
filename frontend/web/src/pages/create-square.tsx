import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { Search, ChevronDown, X } from "lucide-react";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useToast } from "@/hooks/use-toast";
import { AppCard, type AppCardData } from "@/components/square/app-card";
import { SiteBeian } from "@/components/SiteBeian";
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

const APP_CATEGORIES = [
  { value: "", label: "全部类型" },
  { value: "tools", label: "工具效率" },
  { value: "games", label: "游戏娱乐" },
  { value: "education", label: "教育学习" },
  { value: "data-viz", label: "数据可视化" },
  { value: "creative", label: "内容创作" },
  { value: "social", label: "社交通讯" },
  { value: "business", label: "商业金融" },
  { value: "lifestyle", label: "生活服务" },
  { value: "other", label: "其它" },
];

type SortMode = "latest" | "hottest";

interface Author {
  username: string;
  appCount: number;
}

export default function CreateSquarePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const userId = useIDEStore((s) => s.userId);
  const syncFromServer = useProjectStore((s) => s.syncFromServer);

  const [apps, setApps] = useState<AppCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchInput, setSearchInput] = useState(""); // what user types
  const [search, setSearch] = useState("");            // debounced, sent to API
  const [framework, setFramework] = useState("");
  const [category, setCategory] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [author, setAuthor] = useState("");            // username filter
  const [sort, setSort] = useState<SortMode>("latest");
  const [offset, setOffset] = useState(0);
  const [forkingId, setForkingId] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [authorDropOpen, setAuthorDropOpen] = useState(false);
  const authorDropRef = useRef<HTMLDivElement>(null);
  const categoryDropRef = useRef<HTMLDivElement>(null);
  const categoryPortalRef = useRef<HTMLDivElement>(null);
  const [categoryDropPos, setCategoryDropPos] = useState<{ top: number; left: number } | null>(null);

  // keep offset in a ref so fetchApps closure stays stable when loading more
  const offsetRef = useRef(0);

  const LIMIT = 20;

  // Debounce search input → 400ms
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close author dropdown when clicking outside
  useEffect(() => {
    if (!authorDropOpen) return;
    const handler = (e: MouseEvent) => {
      if (authorDropRef.current && !authorDropRef.current.contains(e.target as Node)) {
        setAuthorDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [authorDropOpen]);

  // Close category dropdown when clicking outside (check both trigger and portal)
  useEffect(() => {
    if (!categoryOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = categoryDropRef.current?.contains(target);
      const inPortal = categoryPortalRef.current?.contains(target);
      if (!inTrigger && !inPortal) {
        setCategoryOpen(false);
        setCategoryDropPos(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [categoryOpen]);

  // Close category dropdown on scroll — the portal's position is computed once at open time
  // (absolute coords, not re-measured), so if the horizontal filter row scrolls (common on
  // mobile touch drag) or the page scrolls, the trigger button moves but the dropdown doesn't,
  // leaving them visually detached. Closing on any scroll is simpler and more robust than
  // tracking position continuously.
  useEffect(() => {
    if (!categoryOpen) return;
    const closeIt = () => { setCategoryOpen(false); setCategoryDropPos(null); };
    const filterRow = categoryDropRef.current?.closest(".overflow-x-auto");
    window.addEventListener("scroll", closeIt, { passive: true });
    filterRow?.addEventListener("scroll", closeIt, { passive: true });
    return () => {
      window.removeEventListener("scroll", closeIt);
      filterRow?.removeEventListener("scroll", closeIt);
    };
  }, [categoryOpen]);

  // Fetch authors list on mount
  useEffect(() => {
    fetch("/api/square/authors")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.authors) setAuthors(d.authors); })
      .catch(() => {});
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
        ...(category ? { category } : {}),
        ...(author ? { author } : {}),
        ...(search ? { q: search } : {}),
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
  }, [framework, category, sort, search, author]);

  useEffect(() => {
    fetchApps(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framework, category, sort, search, author]);

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

  // Apps are already filtered server-side; no client-side filter needed
  const filtered = apps;

  return (
    <>
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
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-14 sm:h-20 flex items-center justify-between">
          <button type="button" onClick={() => navigate("/")} className="cursor-pointer">
            <img src={cascadeLogo} alt="Cascade AI" className="h-6 sm:h-8 w-auto object-contain" />
          </button>
          {userId ? (
            <button
              type="button"
              onClick={() => navigate("/app")}
              className="px-4 sm:px-5 py-1.5 sm:py-2 rounded-full text-[13px] sm:text-[14px] font-semibold text-white bg-black transition-all duration-200 hover:opacity-85 active:scale-[0.97]"
            >
              进入工作台
            </button>
          ) : (
            <a
              href="/login"
              className="px-4 sm:px-5 py-1.5 sm:py-2 rounded-full text-[13px] sm:text-[14px] font-semibold text-white bg-black transition-all duration-200 hover:opacity-85 active:scale-[0.97]"
            >
              Try it now
            </a>
          )}
        </div>
      </header>

      {/* ── Hero — staggered fadeUp animations, same as landing ── */}
      <section className="pt-24 sm:pt-36 pb-8 sm:pb-12 px-4 sm:px-6 text-center">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
          className="max-w-3xl mx-auto"
        >
          <motion.h1
            variants={fadeUp}
            custom={1}
            className="font-bold text-black leading-[1.15] mb-4 sm:mb-6 tracking-tight"
            style={{ fontSize: "clamp(32px, 7vw, 76px)", fontFamily: FONT }}
          >
            <span className="block">创造者广场</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            custom={2}
            className="text-[15px] sm:text-[19px] md:text-[22px] text-gray-800 mb-7 sm:mb-10 leading-relaxed"
          >
            浏览社区发布的应用，一键 Fork 开源项目。
          </motion.p>

          {/* Search input */}
          <motion.div variants={fadeUp} custom={3} className="flex justify-center px-2 sm:px-0">
            <div
              className="flex items-center flex-1 rounded-[10px] overflow-hidden max-w-full sm:max-w-[480px]"
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
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="搜索应用名、描述或作者..."
                className="flex-1 py-2 sm:py-2.5 bg-transparent text-[13px] sm:text-[14px] outline-none text-gray-800 placeholder:text-gray-400 min-w-0"
              />
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ── Horizontal tag filter bar + sort tabs ── */}
      <div className="sticky top-14 sm:top-20 z-40 bg-white/90 backdrop-blur-sm border-b border-black/[0.06]">
        <div className="max-w-5xl mx-auto px-4 sm:px-16">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-3 sm:py-4">
            {/* Category dropdown — portal-rendered to avoid overflow clipping */}
            <div className="relative shrink-0" ref={categoryDropRef}>
              <button
                type="button"
                onClick={() => {
                  if (categoryOpen) {
                    setCategoryOpen(false);
                    setCategoryDropPos(null);
                  } else {
                    const rect = categoryDropRef.current?.getBoundingClientRect();
                    if (rect) setCategoryDropPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
                    setCategoryOpen(true);
                  }
                }}
                className={`flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12px] sm:text-[13px] font-medium transition-all duration-150 border ${
                  category ? "bg-black text-white border-black" : "text-gray-500 hover:text-gray-900 border-gray-200"
                }`}
              >
                <span>{category ? APP_CATEGORIES.find(c => c.value === category)?.label : "应用类型"}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${categoryOpen ? "rotate-180" : ""}`} />
              </button>
            </div>

            {/* Divider — hidden on mobile to save space */}
            {authors.length > 0 && (
              <span className="hidden sm:inline text-gray-200 select-none text-[13px] shrink-0">|</span>
            )}

            {/* Author dropdown */}
            {authors.length > 0 && (
              <div className="relative shrink-0" ref={authorDropRef}>
                <button
                  type="button"
                  onClick={() => setAuthorDropOpen((v) => !v)}
                  className={`flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12px] sm:text-[13px] transition-all duration-150 border ${
                    author
                      ? "bg-black text-white border-black font-medium"
                      : "text-gray-500 hover:text-gray-900 border-gray-200 hover:border-gray-400"
                  }`}
                >
                  {author ? (
                    <>
                      <span>@{author}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setAuthor(""); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setAuthor(""); } }}
                        className="ml-0.5 opacity-70 hover:opacity-100"
                      >
                        <X className="w-3 h-3" />
                      </span>
                    </>
                  ) : (
                    <>
                      <span>创作者</span>
                      <ChevronDown className="w-3 h-3 opacity-50" />
                    </>
                  )}
                </button>

                <AnimatePresence>
                  {authorDropOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.97 }}
                      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute left-0 top-full mt-2 rounded-xl overflow-hidden"
                      style={{
                        minWidth: 180,
                        maxHeight: 280,
                        overflowY: "auto",
                        background: "white",
                        border: "1px solid rgba(0,0,0,0.1)",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
                        zIndex: 100,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => { setAuthor(""); setAuthorDropOpen(false); }}
                        className={`w-full text-left px-4 py-2.5 text-[13px] transition-colors hover:bg-gray-50 ${
                          !author ? "font-semibold text-black" : "text-gray-700"
                        }`}
                      >
                        全部创作者
                      </button>
                      <div className="h-px bg-gray-100 mx-3" />
                      {authors.map((a) => (
                        <button
                          key={a.username}
                          type="button"
                          onClick={() => { setAuthor(a.username); setAuthorDropOpen(false); }}
                          className={`w-full text-left px-4 py-2.5 text-[13px] transition-colors hover:bg-gray-50 flex items-center justify-between gap-3 ${
                            author === a.username ? "font-semibold text-black bg-gray-50" : "text-gray-700"
                          }`}
                        >
                          <span>@{a.username}</span>
                          <span className="text-[11px] text-gray-400 shrink-0">{a.appCount} 个应用</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {author && (
              <span className="shrink-0 text-[11px] sm:text-[12px] text-gray-400">
                {filtered.length} 个结果
              </span>
            )}

            {/* Spacer to push sort to right on desktop, inline on mobile */}
            <div className="hidden sm:flex flex-1" />

            {/* Sort tabs — always visible, shrink-0 so they don't wrap */}
            <div className="flex items-center gap-2 shrink-0 ml-2 sm:ml-0">
              <button
                type="button"
                onClick={() => setSort("latest")}
                className={`shrink-0 text-[12px] sm:text-[13px] transition-colors duration-150 ${
                  sort === "latest" ? "text-black font-semibold" : "text-gray-400 hover:text-gray-700"
                }`}
              >
                最新
              </button>
              <span className="text-gray-300 text-[13px] select-none shrink-0">|</span>
              <button
                type="button"
                onClick={() => setSort("hottest")}
                className={`shrink-0 text-[12px] sm:text-[13px] transition-colors duration-150 ${
                  sort === "hottest" ? "text-black font-semibold" : "text-gray-400 hover:text-gray-700"
                }`}
              >
                最热
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Grid ── */}
      <section className="py-8 sm:py-16 px-4 sm:px-16">
        <div className="max-w-5xl mx-auto">
          {loading ? (
            /* Loading skeleton */
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 sm:gap-5">
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
              className="flex flex-col items-center justify-center py-20 sm:py-28 gap-4 text-center"
            >
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                <Search className="w-6 h-6 sm:w-7 sm:h-7 text-gray-300" />
              </div>
              <p className="text-[16px] sm:text-[19px] font-semibold text-gray-800">
                {search ? "没有找到相关应用" : "还没有发布的应用"}
              </p>
              <p className="text-[13px] sm:text-[16px] text-gray-500">
                {search ? "换个关键词试试" : "来做第一个发布应用的创造者吧"}
              </p>
            </motion.div>
          ) : (
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
                {filtered.map((app, i) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    index={i}
                    onClick={() => navigate(`/BuilderSquare/app/${app.id}`)}
                    onFork={forkingId === app.id ? undefined : handleFork}
                  />
                ))}
              </div>

              {/* Load more */}
              {hasMore && (
                <div className="flex justify-center mt-12 sm:mt-16">
                  <button
                    type="button"
                    onClick={() => fetchApps(false)}
                    disabled={loadingMore}
                    className="px-7 sm:px-8 py-2.5 sm:py-3 rounded-full text-[13px] sm:text-[14px] font-semibold text-white bg-black transition-all duration-200 hover:opacity-85 active:scale-[0.97] disabled:opacity-50"
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
      <footer className="py-6 sm:py-8 px-4 sm:px-8 border-t border-black/[0.06]">
        <div className="max-w-7xl mx-auto flex flex-col items-center gap-3 md:flex-row md:justify-between">
          <img
            src={cascadeLogo}
            alt="Cascade AI"
            className="hidden md:block h-6 w-auto"
            style={{ filter: "brightness(0)" }}
          />
          <p className="text-[12px] sm:text-[13px] text-gray-400">© 2026 Cascade AI. All rights reserved.</p>
        </div>
        <SiteBeian className="mt-3" />
      </footer>
    </div>

    {/* Category dropdown portal — renders above everything */}
    {categoryOpen && categoryDropPos && createPortal(
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.97 }}
          transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          ref={categoryPortalRef}
          style={{
            position: "absolute",
            top: categoryDropPos.top,
            left: categoryDropPos.left,
            width: 128,
            background: "white",
            border: "1px solid rgba(0,0,0,0.1)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
            borderRadius: 12,
            overflow: "hidden",
            zIndex: 99999,
          }}
        >
          {APP_CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => { setCategory(c.value); setCategoryOpen(false); setCategoryDropPos(null); }}
              style={{ fontFamily: '"Inter", system-ui, sans-serif' }}
              className={`w-full text-left px-4 py-2.5 text-[13px] transition-colors hover:bg-gray-50 ${
                category === c.value ? "font-semibold text-black bg-gray-50" : "text-gray-700"
              }`}
            >
              {c.label}
            </button>
          ))}
        </motion.div>
      </AnimatePresence>,
      document.body
    )}
    </>
  );
}
