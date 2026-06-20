import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { Search, ChevronDown, ArrowLeft } from "lucide-react";
import { useT } from "@/lib/i18n";
import { AppCard, type AppCardData } from "@/components/square/app-card";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useToast } from "@/hooks/use-toast";
import cascadeLogo from "@/assets/cascade-logo.png";

const FONT = '"Inter", "Helvetica Neue", system-ui, sans-serif';

const FRAMEWORKS = [
  { value: "", label: "全部" },
  { value: "web", label: "Web" },
  { value: "rn-expo", label: "React Native" },
  { value: "flutter", label: "Flutter" },
  { value: "kotlin", label: "Kotlin" },
  { value: "wechat", label: "微信小程序" },
];

export default function CreateSquarePage() {
  const t = useT();
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
  const [offset, setOffset] = useState(0);
  const [forkingId, setForkingId] = useState<string | null>(null);
  const [showFrameworkMenu, setShowFrameworkMenu] = useState(false);

  const LIMIT = 20;

  const fetchApps = useCallback(async (reset = false) => {
    const off = reset ? 0 : offset;
    if (!reset) setLoadingMore(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(off),
        ...(framework ? { framework } : {}),
      });
      const res = await fetch(`/api/square?${params}`);
      const data = await res.json();
      const newApps: AppCardData[] = data.apps ?? [];
      if (reset) {
        setApps(newApps);
        setOffset(newApps.length);
      } else {
        setApps((prev) => [...prev, ...newApps]);
        setOffset((prev) => prev + newApps.length);
      }
      setHasMore(newApps.length === LIMIT);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [framework, offset]);

  // Initial load + on framework change
  useEffect(() => {
    fetchApps(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framework]);

  const filtered = search.trim()
    ? apps.filter(
        (a) =>
          a.title.toLowerCase().includes(search.toLowerCase()) ||
          (a.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
          a.authorUsername.toLowerCase().includes(search.toLowerCase()),
      )
    : apps;

  async function handleFork(id: string) {
    if (!userId) {
      navigate("/login");
      return;
    }
    setForkingId(id);
    try {
      const res = await fetch(`/api/square/${id}/fork`, { method: "POST" });
      if (!res.ok) throw new Error("failed");
      await syncFromServer();
      toast({ title: t("square.forkSuccess") });
    } catch {
      toast({ title: "Fork 失败，请重试", variant: "destructive" });
    } finally {
      setForkingId(null);
    }
  }

  const selectedFrameworkLabel = FRAMEWORKS.find((f) => f.value === framework)?.label ?? "全部";

  return (
    <div
      className="min-h-screen bg-white dark:bg-[#0d0d0d]"
      style={{ fontFamily: FONT }}
    >
      {/* ── Top nav ── */}
      <header
        className="sticky top-0 z-30 bg-white/90 dark:bg-[#0d0d0d]/90 backdrop-blur-md border-b border-gray-100 dark:border-gray-800"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <img src={cascadeLogo} alt="Cascade" className="w-5 h-5 object-contain opacity-70" />
          </button>

          <div className="flex-1 flex items-center justify-center">
            <h1 className="text-[15px] font-semibold text-gray-900 dark:text-white tracking-tight">
              {t("square.title")}
            </h1>
          </div>

          {userId && (
            <button
              type="button"
              onClick={() => navigate("/CreateSquare/my")}
              className="text-[13px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors whitespace-nowrap"
            >
              {t("square.myPublished")}
            </button>
          )}
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-8"
        >
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-medium mb-4"
            style={{
              background: "linear-gradient(135deg, rgba(99,102,255,0.10) 0%, rgba(139,92,246,0.07) 100%)",
              border: "1px solid rgba(99,102,255,0.20)",
              color: "rgb(99,102,241)",
            }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            AI-powered apps
          </div>
          <h2
            className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-3"
            style={{ letterSpacing: "-0.02em" }}
          >
            {t("square.title")}
          </h2>
          <p className="text-[15px] text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            {t("square.subtitle")}
          </p>
        </motion.div>

        {/* ── Search + filter bar ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="flex gap-2 max-w-xl mx-auto"
        >
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("square.search")}
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111] text-[13px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 outline-none focus:border-gray-400 dark:focus:border-gray-500 transition-colors"
            />
          </div>

          {/* Framework filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowFrameworkMenu((v) => !v)}
              className="h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111] text-[13px] text-gray-700 dark:text-gray-300 flex items-center gap-1.5 hover:border-gray-300 dark:hover:border-gray-600 transition-colors whitespace-nowrap"
            >
              {selectedFrameworkLabel}
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>
            <AnimatePresence>
              {showFrameworkMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-12 w-44 bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-100 dark:border-gray-800 shadow-xl z-20 overflow-hidden"
                >
                  {FRAMEWORKS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => { setFramework(f.value); setShowFrameworkMenu(false); }}
                      className={`w-full text-left px-4 py-2.5 text-[13px] transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                        framework === f.value ? "font-semibold text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            {showFrameworkMenu && (
              <div className="fixed inset-0 z-10" onClick={() => setShowFrameworkMenu(false)} />
            )}
          </div>
        </motion.div>
      </section>

      {/* ── Grid ── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse aspect-[3/4]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-gray-400">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" fill="currentColor" />
              </svg>
            </div>
            <p className="text-[15px] font-medium text-gray-700 dark:text-gray-300">{t("square.noApps")}</p>
            <p className="text-[13px] text-gray-400">{t("square.noAppsDesc")}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
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
              <div className="flex justify-center mt-10">
                <button
                  type="button"
                  onClick={() => fetchApps(false)}
                  disabled={loadingMore}
                  className="px-6 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-[13px] font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? "加载中..." : t("square.loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
