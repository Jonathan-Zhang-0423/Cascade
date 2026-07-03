import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, GitFork, Share2, Unlock, Lock, Globe, Link2, Heart, MessageCircle, Trash2, Eye, Maximize2, X, ChevronUp } from "lucide-react";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useToast } from "@/hooks/use-toast";
import { SharePanel } from "@/components/square/share-panel";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { SiteBeian } from "@/components/SiteBeian";
import cascadeLogo from "@/assets/cascade-logo.png";

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

// Mirrors preview-panel.tsx's iframe capability policy — keep these two in sync.
const PREVIEW_SANDBOX =
  "allow-scripts allow-modals allow-same-origin allow-forms allow-popups allow-pointer-lock allow-popups-to-escape-sandbox";
const PREVIEW_ALLOW =
  "fullscreen; autoplay; gamepad; xr-spatial-tracking; accelerometer; gyroscope; magnetometer";

const FRAMEWORK_LABELS: Record<string, string> = {
  web: "Web",
  "rn-expo": "React Native",
  flutter: "Flutter",
  kotlin: "Kotlin",
  wechat: "微信小程序",
  swiftui: "SwiftUI",
};

const FRAMEWORK_EMOJI: Record<string, string> = {
  web: "🌐",
  "rn-expo": "📱",
  flutter: "🐦",
  kotlin: "⚡",
  wechat: "💬",
  swiftui: "🍎",
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
  viewCount: number;
  forkCount: number;
  likeCount: number;
  publishedAt: string;
  updatedAt: string;
  authorUsername: string;
}

interface AppComment {
  id: string;
  content: string;
  createdAt: string;
  userId: string;
  authorUsername: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

// Matches the page's own `lg:` breakpoint (1024px) so JS branching and Tailwind classes never disagree
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

// Avatar with initial letter
function Avatar({ name, size = 8 }: { name: string; size?: number }) {
  const sz = `w-${size} h-${size}`;
  return (
    <div
      className={`${sz} rounded-full bg-gray-100 flex items-center justify-center shrink-0 select-none`}
      style={{ fontSize: size <= 7 ? 11 : 13, fontWeight: 600, color: "#374151" }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export default function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const userId = useIDEStore((s) => s.userId);
  const syncFromServer = useProjectStore((s) => s.syncFromServer);
  const isDesktop = useIsDesktop();

  const [app, setApp] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forking, setForking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [iframeKey] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(true);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);

  // Live interactive preview (same preview-serve iframe the IDE uses). Falls back
  // to the static screenshot for non-web frameworks or if the session fails to start.
  const [previewSessionUrl, setPreviewSessionUrl] = useState<string | null>(null);
  const [previewSessionFailed, setPreviewSessionFailed] = useState(false);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liking, setLiking] = useState(false);

  const [comments, setComments] = useState<AppComment[]>([]);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentInput, setCommentInput] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  const shareUrl = `${window.location.origin}/BuilderSquare/app/${id}`;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/square/${id}`)
      .then((r) => { if (r.status === 404 || r.status === 403) { setNotFound(true); return null; } return r.json(); })
      .then((data) => { if (data) { setApp(data.app); setLikeCount(data.app.likeCount ?? 0); } })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));

    fetch(`/api/square/${id}/like`)
      .then((r) => r.json()).then((d) => setLiked(d.liked ?? false)).catch(() => {});

    fetch(`/api/square/${id}/comments?limit=20`)
      .then((r) => r.json()).then((d) => { setComments(d.comments ?? []); setCommentTotal(d.total ?? 0); }).catch(() => {});
  }, [id]);

  // Live interactive preview — same iframe/preview-serve mechanism the IDE uses.
  // Anyone (logged in or not) can play with the app itself; only comments/likes require auth.
  useEffect(() => {
    if (!id) return;
    setPreviewSessionUrl(null);
    setPreviewSessionFailed(false);
    fetch(`/api/square/${id}/preview-session`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { if (d.previewUrl) setPreviewSessionUrl(d.previewUrl); else throw new Error(); })
      .catch(() => setPreviewSessionFailed(true));
  }, [id]);

  async function handleFork() {
    if (!userId) { navigate("/login"); return; }
    if (!app) return;
    setForking(true);
    try {
      const res = await fetch(`/api/square/${app.id}/fork`, { method: "POST" });
      if (!res.ok) throw new Error();
      await syncFromServer();
      toast({ title: "Fork 成功，已添加到你的项目" });
      navigate("/app");
    } catch {
      toast({ title: "Fork 失败，请重试", variant: "destructive" });
    } finally { setForking(false); }
  }

  async function handleLike() {
    if (!userId) { navigate("/login"); return; }
    if (!app || liking) return;
    setLiking(true);
    try {
      const res = await fetch(`/api/square/${app.id}/like`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setLiked(data.liked);
      setLikeCount((c) => data.liked ? c + 1 : Math.max(0, c - 1));
    } catch {
      toast({ title: "操作失败", variant: "destructive" });
    } finally { setLiking(false); }
  }

  async function handleComment() {
    if (!userId) { navigate("/login"); return; }
    if (!app || !commentInput.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/square/${app.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: commentInput.trim() }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setComments((prev) => [data.comment, ...prev]);
      setCommentTotal((t) => t + 1);
      setCommentInput("");
    } catch {
      toast({ title: "评论失败，请重试", variant: "destructive" });
    } finally { setSubmittingComment(false); }
  }

  async function handleDeleteComment(commentId: string) {
    if (!app) return;
    try {
      const res = await fetch(`/api/square/${app.id}/comments/${commentId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setCommentTotal((t) => Math.max(0, t - 1));
    } catch {
      toast({ title: "删除失败", variant: "destructive" });
    }
  }

  // ── Loading / not-found states ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: FONT }}>
        <div className="w-6 h-6 rounded-full border-2 border-gray-200 border-t-gray-800 animate-spin" />
      </div>
    );
  }

  if (notFound || !app) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4" style={{ fontFamily: FONT }}>
        <p className="text-[15px] text-gray-500">找不到该应用</p>
        <button type="button" onClick={() => navigate("/BuilderSquare")}
          className="text-[13px] text-gray-400 hover:text-gray-800 transition-colors flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> 返回广场
        </button>
      </div>
    );
  }

  const currentApp = app;
  const fwLabel = FRAMEWORK_LABELS[currentApp.framework] ?? currentApp.framework;
  const fwEmoji = FRAMEWORK_EMOJI[currentApp.framework] ?? "✦";
  // Real, clickable preview (same mechanism as the IDE's preview panel) — available for
  // everyone, logged in or not. Falls back to the static screenshot if it can't start
  // (non-web framework, no files, etc).
  const isLiveInteractive = !!previewSessionUrl && !previewSessionFailed;
  const canMaximize = isLiveInteractive || !!currentApp.previewScreenshot;

  // Tapping the preview's maximize button: mobile enters the immersive fullscreen
  // preview mode, desktop opens the lightbox (it's already pinned in place).
  function handleMaximizePreview() {
    if (isDesktop) setLightboxOpen(true);
    else setMobilePreviewOpen(true);
  }

  function renderPreviewContent() {
    if (isLiveInteractive) {
      return (
        <iframe
          ref={previewIframeRef}
          key={previewSessionUrl}
          src={previewSessionUrl}
          className="w-full h-full border-0"
          style={{ cursor: "pointer" }}
          title={currentApp.title}
          sandbox={PREVIEW_SANDBOX}
          allow={PREVIEW_ALLOW}
        />
      );
    }
    if (currentApp.previewScreenshot) {
      return (
        <img
          key={iframeKey}
          src={currentApp.previewScreenshot}
          alt={currentApp.title}
          className="w-full h-full object-cover"
        />
      );
    }
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-sm">
          <span className="text-xl select-none">{fwEmoji}</span>
        </div>
        <span className="text-[12px] text-gray-400">{fwLabel}</span>
      </div>
    );
  }

  const previewBox = (
    // Taller ratio on mobile (single column, preview is the whole width) so it reads as
    // prominent after exiting the immersive preview — matches desktop's "bigger preview" intent.
    <div className="relative w-full bg-gray-50 aspect-[4/3] sm:aspect-video">
      {renderPreviewContent()}

      {/* Fullscreen button — top right corner */}
      {canMaximize && (
        <button
          type="button"
          onClick={handleMaximizePreview}
          className="absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}
          title="全屏查看"
        >
          <Maximize2 className="w-3.5 h-3.5 text-white" />
        </button>
      )}
    </div>
  );

  // ── Mobile: immersive fullscreen preview (default state on entering the page) ──
  if (!isDesktop && mobilePreviewOpen) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col" style={{ fontFamily: FONT }}>
        {/* Top toolbar — back to plaza + exit preview, always reachable without leaving preview mode */}
        <div
          className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 pt-3 pb-6"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)" }}
        >
          <button
            type="button"
            onClick={() => navigate("/BuilderSquare")}
            className="flex items-center gap-1 px-3 py-2 rounded-full text-[12px] font-medium text-white active:scale-95 transition-transform"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            广场
          </button>
          <button
            type="button"
            onClick={() => setMobilePreviewOpen(false)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium text-white active:scale-95 transition-transform"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)" }}
          >
            <X className="w-3.5 h-3.5" />
            退出预览
          </button>
        </div>

        <div className="relative flex-1 min-h-0 bg-gray-950">
          {isLiveInteractive ? (
            <iframe
              key={previewSessionUrl}
              src={previewSessionUrl!}
              className="w-full h-full border-0 bg-white"
              title={currentApp.title}
              sandbox={PREVIEW_SANDBOX}
              allow={PREVIEW_ALLOW}
            />
          ) : currentApp.previewScreenshot ? (
            <img
              key={iframeKey}
              src={currentApp.previewScreenshot}
              alt={currentApp.title}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center">
                <span className="text-2xl select-none">{fwEmoji}</span>
              </div>
              <span className="text-[13px] text-white/50">{fwLabel}</span>
            </div>
          )}
        </div>

        {/* Bottom handle — swipe/tap up to reveal like / fork / share / author actions */}
        <button
          type="button"
          onClick={() => setMobileActionsOpen(true)}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 px-5 py-2 rounded-full text-[11px] font-medium text-white active:scale-95 transition-transform"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(10px)" }}
        >
          <ChevronUp className="w-3.5 h-3.5" />
          点赞 · 分享 · Fork
        </button>

        <Drawer open={mobileActionsOpen} onOpenChange={setMobileActionsOpen}>
          <DrawerContent style={{ fontFamily: FONT }}>
            <VisuallyHidden asChild>
              <DrawerTitle>应用操作</DrawerTitle>
            </VisuallyHidden>
            <div className="px-5 pt-2 pb-6 space-y-4">
              {/* Author */}
              <div className="flex items-center gap-3">
                <Avatar name={currentApp.authorUsername} size={9} />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-gray-900 truncate">{currentApp.title}</p>
                  <p className="text-[12px] text-gray-400">@{currentApp.authorUsername} · {timeAgo(currentApp.publishedAt)}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleLike}
                  disabled={liking}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-[13px] font-semibold transition-all active:scale-[0.97] disabled:opacity-50"
                  style={liked ? {
                    background: "rgba(239,68,68,0.06)",
                    border: "1.5px solid rgba(239,68,68,0.22)",
                    color: "#dc2626",
                  } : {
                    background: "rgba(0,0,0,0.03)",
                    border: "1.5px solid rgba(0,0,0,0.10)",
                    color: "#374151",
                  }}
                >
                  <Heart className="w-4 h-4" fill={liked ? "currentColor" : "none"} />
                  {likeCount > 0 ? likeCount : "点赞"}
                </button>

                {currentApp.isOpenSource && (
                  <button
                    type="button"
                    onClick={handleFork}
                    disabled={forking}
                    className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-[13px] font-semibold text-white bg-black active:scale-[0.97] transition-all disabled:opacity-50"
                  >
                    <GitFork className="w-4 h-4" />
                    {forking ? "Fork 中…" : "Fork"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-[13px] font-medium text-gray-600 active:scale-[0.97] transition-all"
                  style={{ border: "1.5px solid rgba(0,0,0,0.09)" }}
                >
                  <Share2 className="w-4 h-4" />
                  分享
                </button>
              </div>

              {/* Comments shortcut — leaves preview mode and jumps to the comments section */}
              <button
                type="button"
                onClick={() => { setMobileActionsOpen(false); setMobilePreviewOpen(false); }}
                className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl text-[13px] font-medium text-gray-600 active:scale-[0.97] transition-all"
                style={{ border: "1.5px solid rgba(0,0,0,0.09)" }}
              >
                <MessageCircle className="w-4 h-4" />
                查看评论{commentTotal > 0 ? ` · ${commentTotal}` : ""}
              </button>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: FONT }}>

      {/* ── Navbar ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          backdropFilter: scrolled ? "blur(16px)" : "none",
          backgroundColor: scrolled ? "rgba(255,255,255,0.90)" : "transparent",
          borderBottom: `1px solid ${scrolled ? "rgba(0,0,0,0.07)" : "transparent"}`,
        }}
      >
        <div className="max-w-[1600px] mx-auto px-4 sm:px-8 h-14 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate("/BuilderSquare")}
            className="flex items-center gap-1.5 text-[13px] font-medium text-gray-500 hover:text-black transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            创造者广场
          </button>
          <button type="button" onClick={() => navigate("/")}>
            <img src={cascadeLogo} alt="Cascade AI" className="h-6 w-auto" style={{ filter: "brightness(0)" }} />
          </button>
        </div>
      </header>

      {/* ── Page body ── */}
      <div className="pt-14 max-w-[1600px] mx-auto px-4 sm:px-8">
        <div className="flex flex-col lg:flex-row gap-8 xl:gap-10 py-6 sm:py-8 lg:items-start">

          {/* ══ LEFT COLUMN: big-screen preview, pinned on desktop ══ */}
          <div className="w-full lg:flex-1 lg:sticky lg:top-20 min-w-0">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="w-full rounded-2xl overflow-hidden"
              style={{ border: "1px solid rgba(0,0,0,0.09)", boxShadow: "0 4px 24px rgba(0,0,0,0.07)" }}
            >
              {previewBox}
            </motion.div>
          </div>

          {/* ══ RIGHT COLUMN: project card + comments merged into one scrollable card ══ */}
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="w-full lg:w-[300px] xl:w-[340px] shrink-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
            style={{ zIndex: 10 }}
          >
            <div className="rounded-2xl" style={{ border: "1px solid rgba(0,0,0,0.09)" }}>

              {/* App title block */}
              <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                <h1 className="text-[20px] font-bold text-gray-900 leading-snug tracking-tight mb-2">
                  {app.title}
                </h1>
                {app.description && (
                  <p className="text-[13px] text-gray-500 leading-relaxed">
                    {app.description}
                  </p>
                )}
              </div>

              {/* Author */}
              <div className="px-5 py-3.5 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                <Avatar name={app.authorUsername} size={9} />
                <div>
                  <p className="text-[13px] font-semibold text-gray-900">@{app.authorUsername}</p>
                  <p className="text-[11px] text-gray-400">{timeAgo(app.publishedAt)}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="px-5 py-4 flex flex-col gap-2.5" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                {/* Like */}
                <button
                  type="button"
                  onClick={handleLike}
                  disabled={liking}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
                  style={liked ? {
                    background: "rgba(239,68,68,0.06)",
                    border: "1.5px solid rgba(239,68,68,0.22)",
                    color: "#dc2626",
                  } : {
                    background: "rgba(0,0,0,0.03)",
                    border: "1.5px solid rgba(0,0,0,0.10)",
                    color: "#374151",
                  }}
                >
                  <Heart className="w-4 h-4" fill={liked ? "currentColor" : "none"} />
                  {liked ? `已点赞${likeCount > 0 ? ` · ${likeCount}` : ""}` : `点赞${likeCount > 0 ? ` · ${likeCount}` : ""}`}
                </button>

                {/* Fork — only open source */}
                {app.isOpenSource && (
                  <button
                    type="button"
                    onClick={handleFork}
                    disabled={forking}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-black hover:opacity-85 transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    <GitFork className="w-4 h-4" />
                    {forking ? "Fork 中…" : "Fork 项目"}
                  </button>
                )}

                {/* Share */}
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-all"
                  style={{ border: "1.5px solid rgba(0,0,0,0.09)" }}
                >
                  <Share2 className="w-4 h-4" />
                  分享
                </button>
              </div>

              {/* Stats row — comment count is clickable, scrolls to comments */}
              <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                {[
                  { icon: <Eye className="w-3.5 h-3.5" />, value: app.viewCount, onClick: undefined },
                  { icon: <Heart className="w-3.5 h-3.5" />, value: likeCount, onClick: undefined },
                  { icon: <GitFork className="w-3.5 h-3.5" />, value: app.forkCount, onClick: undefined },
                  {
                    icon: <MessageCircle className="w-3.5 h-3.5" />,
                    value: commentTotal,
                    onClick: () => {
                      const el = document.getElementById("comments-section");
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    },
                  },
                ].map((s, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-1 text-[12px] text-gray-400 ${s.onClick ? "cursor-pointer hover:text-gray-700 transition-colors" : ""}`}
                    onClick={s.onClick}
                    role={s.onClick ? "button" : undefined}
                  >
                    {s.icon}
                    <span>{s.value}</span>
                  </div>
                ))}
              </div>

              {/* Tags / meta */}
              <div className="px-5 py-3.5 flex flex-wrap gap-1.5" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">
                  {fwEmoji} {fwLabel}
                </span>
                {app.isOpenSource ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-green-50 text-green-700">
                    <Unlock className="w-3 h-3" /> 开源
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">
                    <Lock className="w-3 h-3" /> 闭源
                  </span>
                )}
                {app.visibility === "public" && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">
                    <Globe className="w-3 h-3" /> 公开
                  </span>
                )}
                {app.visibility === "link_only" && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">
                    <Link2 className="w-3 h-3" /> 链接可见
                  </span>
                )}
              </div>

              {/* ── Comments — merged into the same card ── */}
              <div id="comments-section" className="px-5 py-5">
                <div className="flex items-center gap-2 mb-5">
                  <MessageCircle className="w-4 h-4 text-gray-400" />
                  <h2 className="text-[15px] font-semibold text-gray-900">
                    评论
                    {commentTotal > 0 && (
                      <span className="ml-1.5 text-[13px] font-normal text-gray-400">{commentTotal}</span>
                    )}
                  </h2>
                </div>

                {/* Input */}
                {userId ? (
                  <div className="mb-7">
                    <textarea
                      value={commentInput}
                      onChange={(e) => setCommentInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleComment(); }}
                      maxLength={500}
                      rows={2}
                      placeholder="分享你的想法… (⌘↵ 发送)"
                      className="w-full px-3.5 py-2.5 text-[13px] text-gray-900 placeholder-gray-400 rounded-xl outline-none resize-none transition-all"
                      style={{ border: "1.5px solid rgba(0,0,0,0.10)", fontFamily: FONT }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.28)"; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.10)"; }}
                    />
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[11px] text-gray-400">{commentInput.length}/500</span>
                      <button
                        type="button"
                        onClick={handleComment}
                        disabled={submittingComment || !commentInput.trim()}
                        className="px-4 py-1.5 rounded-lg bg-black text-white text-[12px] font-medium hover:opacity-85 transition-opacity disabled:opacity-40"
                      >
                        {submittingComment ? "发送中…" : "发送"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mb-7 px-4 py-3.5 rounded-xl bg-gray-50 text-center"
                    style={{ border: "1.5px solid rgba(0,0,0,0.07)" }}>
                    <p className="text-[13px] text-gray-500">
                      <button type="button" onClick={() => navigate("/login")}
                        className="font-semibold text-black hover:underline">登录</button>
                      {" "}后发表评论
                    </p>
                  </div>
                )}

                {/* Comment list */}
                {comments.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-gray-400">
                    <MessageCircle className="w-6 h-6 text-gray-200" />
                    <p className="text-[13px]">还没有评论</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {comments.map((c) => (
                      <div key={c.id} className="flex gap-3 group">
                        <Avatar name={c.authorUsername} size={8} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-baseline gap-2">
                              <span className="text-[13px] font-semibold text-gray-900">@{c.authorUsername}</span>
                              <span className="text-[11px] text-gray-400">{timeAgo(c.createdAt)}</span>
                            </div>
                            {c.userId === userId && (
                              <button
                                type="button"
                                onClick={() => handleDeleteComment(c.id)}
                                className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <p className="mt-1 text-[14px] text-gray-700 leading-relaxed break-words">{c.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>

        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-black/[0.06] py-6 px-4 sm:px-8 mt-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <img src={cascadeLogo} alt="Cascade AI" className="hidden sm:block h-5 w-auto" style={{ filter: "brightness(0)" }} />
          <p className="text-[12px] text-gray-400">© 2026 Cascade AI. All rights reserved.</p>
        </div>
        <SiteBeian className="mt-2" />
      </footer>

      <SharePanel open={shareOpen} onClose={() => setShareOpen(false)} url={shareUrl} title={app.title} />

      {/* ── Desktop fullscreen preview — the entire viewport is the running app, not a
           floating panel. Matches the mobile immersive-preview treatment. ── */}
      {lightboxOpen && canMaximize && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
          <div className="relative flex-1 min-h-0 bg-gray-950">
            {isLiveInteractive ? (
              <iframe
                key={previewSessionUrl}
                src={previewSessionUrl!}
                className="w-full h-full border-0 bg-white"
                title={app.title}
                sandbox={PREVIEW_SANDBOX}
                allow={PREVIEW_ALLOW}
              />
            ) : (
              <img
                src={app.previewScreenshot!}
                alt={app.title}
                className="w-full h-full object-contain"
              />
            )}
          </div>
          {/* Exit button — top right corner, always reachable */}
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium text-white active:scale-95 hover:opacity-90 transition-all"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(10px)" }}
          >
            <X className="w-3.5 h-3.5" />
            退出全屏
          </button>
        </div>
      )}
    </div>
  );
}
