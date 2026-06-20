import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Code2, EyeOff, GitFork, Share2, ExternalLink, Globe, Lock, Link2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { SharePanel } from "@/components/square/share-panel";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useToast } from "@/hooks/use-toast";
import cascadeLogo from "@/assets/cascade-logo.png";

const FONT = '"Inter", "Helvetica Neue", system-ui, sans-serif';

const FRAMEWORK_LABELS: Record<string, string> = {
  web: "Web",
  "rn-expo": "React Native",
  flutter: "Flutter",
  kotlin: "Kotlin",
  wechat: "微信小程序",
  swiftui: "SwiftUI",
};

const VISIBILITY_ICONS: Record<string, React.ReactNode> = {
  public: <Globe className="w-3.5 h-3.5" />,
  link_only: <Link2 className="w-3.5 h-3.5" />,
  private: <Lock className="w-3.5 h-3.5" />,
};

interface AppDetail {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  description: string | null;
  isOpenSource: boolean;
  visibility: string;
  previewScreenshot: string | null;
  framework: string;
  publishedAt: string;
  updatedAt: string;
  authorUsername: string;
}

export default function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const t = useT();
  const { toast } = useToast();
  const userId = useIDEStore((s) => s.userId);
  const syncFromServer = useProjectStore((s) => s.syncFromServer);

  const [app, setApp] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forking, setForking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  const shareUrl = `${window.location.origin}/CreateSquare/app/${id}`;

  useEffect(() => {
    if (!id) return;
    fetch(`/api/square/${id}`)
      .then((r) => {
        if (r.status === 404 || r.status === 403) { setNotFound(true); return null; }
        return r.json();
      })
      .then((data) => {
        if (data) setApp(data.app);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleFork() {
    if (!userId) { navigate("/login"); return; }
    if (!app) return;
    setForking(true);
    try {
      const res = await fetch(`/api/square/${app.id}/fork`, { method: "POST" });
      if (!res.ok) throw new Error("failed");
      await syncFromServer();
      toast({ title: t("square.forkSuccess") });
      navigate("/app");
    } catch {
      toast({ title: "Fork 失败，请重试", variant: "destructive" });
    } finally {
      setForking(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0d0d0d] flex items-center justify-center" style={{ fontFamily: FONT }}>
        <div className="w-8 h-8 rounded-full border-2 border-gray-200 border-t-gray-700 animate-spin" />
      </div>
    );
  }

  if (notFound || !app) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0d0d0d] flex flex-col items-center justify-center gap-4" style={{ fontFamily: FONT }}>
        <p className="text-[15px] text-gray-500">{t("square.notFound")}</p>
        <button
          type="button"
          onClick={() => navigate("/CreateSquare")}
          className="text-[13px] text-indigo-500 hover:text-indigo-600 transition-colors"
        >
          {t("square.backToSquare")}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#0d0d0d]" style={{ fontFamily: FONT }}>
      {/* ── Top nav ── */}
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-[#0d0d0d]/90 backdrop-blur-md border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/CreateSquare")}
            className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("square.backToSquare")}
          </button>
          <div className="flex-1" />
          <img src={cascadeLogo} alt="Cascade" className="w-5 h-5 object-contain opacity-50" />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">

          {/* ── Left: iframe preview ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="order-2 lg:order-1"
          >
            <div className="rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 aspect-[4/3] relative shadow-sm">
              <iframe
                key={iframeKey}
                src={`/project/${app.projectId}/preview`}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms"
                title={app.title}
              />
              {/* Reload button */}
              <button
                type="button"
                onClick={() => setIframeKey((k) => k + 1)}
                className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/80 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center shadow-sm hover:bg-white dark:hover:bg-black/70 transition-colors"
                title="刷新预览"
              >
                <ExternalLink className="w-3.5 h-3.5 text-gray-600 dark:text-gray-300" />
              </button>
            </div>
          </motion.div>

          {/* ── Right: meta panel ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="order-1 lg:order-2 space-y-5"
          >
            {/* Title + badges */}
            <div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-100">
                  {FRAMEWORK_LABELS[app.framework] ?? app.framework}
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                  app.isOpenSource
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-gray-100 text-gray-500 border-gray-200"
                }`}>
                  {app.isOpenSource ? <Code2 className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  {app.isOpenSource ? t("square.openSource") : t("square.closedSource")}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-gray-400 bg-gray-50 border border-gray-100">
                  {VISIBILITY_ICONS[app.visibility]}
                  {app.visibility === "public" ? t("publish.visPublic") : app.visibility === "link_only" ? t("publish.visLinkOnly") : t("publish.visPrivate")}
                </span>
              </div>

              <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" style={{ letterSpacing: "-0.02em" }}>
                {app.title}
              </h1>

              {app.description && (
                <p className="mt-2 text-[14px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  {app.description}
                </p>
              )}
            </div>

            {/* Author */}
            <div className="flex items-center gap-2 py-3 border-t border-b border-gray-100 dark:border-gray-800">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-[12px] font-semibold shrink-0">
                {app.authorUsername[0]?.toUpperCase() ?? "?"}
              </div>
              <div>
                <p className="text-[13px] font-medium text-gray-800 dark:text-gray-200">@{app.authorUsername}</p>
                <p className="text-[11px] text-gray-400">
                  {t("square.publishedAt")} {new Date(app.publishedAt).toLocaleDateString("zh-CN")}
                </p>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="space-y-2">
              {/* Share */}
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-[13px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <Share2 className="w-4 h-4" />
                {t("square.share")}
              </button>

              {/* Fork (open source only, auth required) */}
              {app.isOpenSource && (
                <button
                  type="button"
                  onClick={handleFork}
                  disabled={forking}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 text-[13px] font-medium transition-colors disabled:opacity-60"
                >
                  <GitFork className="w-4 h-4" />
                  {forking ? t("square.forking") : t("square.fork")}
                </button>
              )}
            </div>

            {/* Open source info box */}
            {app.isOpenSource && (
              <div
                className="rounded-xl p-4 text-[12px] text-gray-500 space-y-1 leading-relaxed"
                style={{ background: "linear-gradient(135deg, rgba(99,102,255,0.05) 0%, rgba(139,92,246,0.04) 100%)", border: "1px solid rgba(99,102,255,0.12)" }}
              >
                <p className="font-medium text-indigo-600 text-[13px]">开源项目</p>
                <p>此应用的源码对所有人开放。Fork 后可在自己的项目中查看、编辑和继续开发。</p>
              </div>
            )}
          </motion.div>
        </div>
      </div>

      <SharePanel open={shareOpen} onClose={() => setShareOpen(false)} url={shareUrl} title={app.title} />
    </div>
  );
}
