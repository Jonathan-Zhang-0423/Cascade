import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, GitFork, Share2, RotateCcw, Unlock, Lock, Globe, Link2, Heart, MessageCircle, Trash2 } from "lucide-react";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useToast } from "@/hooks/use-toast";
import { SharePanel } from "@/components/square/share-panel";
import { SiteBeian } from "@/components/SiteBeian";
import cascadeLogo from "@/assets/cascade-logo.png";

// Inter font injection — same pattern as landing.tsx
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

const FRAMEWORK_LABELS: Record<string, string> = {
  web: "Web",
  "rn-expo": "React Native",
  flutter: "Flutter",
  kotlin: "Kotlin",
  wechat: "微信小程序",
  swiftui: "SwiftUI",
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

function VisibilityIcon({ visibility }: { visibility: string }) {
  if (visibility === "public") return <Globe className="w-3.5 h-3.5" />;
  if (visibility === "link_only") return <Link2 className="w-3.5 h-3.5" />;
  return <Lock className="w-3.5 h-3.5" />;
}

function visibilityLabel(visibility: string): string {
  if (visibility === "public") return "公开";
  if (visibility === "link_only") return "链接可见";
  return "私密";
}

export default function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const userId = useIDEStore((s) => s.userId);
  const syncFromServer = useProjectStore((s) => s.syncFromServer);

  const [app, setApp] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forking, setForking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  // Like state
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liking, setLiking] = useState(false);

  // Comment state
  const [comments, setComments] = useState<AppComment[]>([]);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentInput, setCommentInput] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  const shareUrl = `${window.location.origin}/CreateSquare/app/${id}`;

  // Scroll listener for navbar blur effect
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 20);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/square/${id}`)
      .then((r) => {
        if (r.status === 404 || r.status === 403) { setNotFound(true); return null; }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setApp(data.app);
          setLikeCount(data.app.likeCount ?? 0);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));

    // Fetch like status and comments in parallel
    fetch(`/api/square/${id}/like`)
      .then((r) => r.json())
      .then((d) => setLiked(d.liked ?? false))
      .catch(() => {});

    fetch(`/api/square/${id}/comments?limit=20`)
      .then((r) => r.json())
      .then((d) => { setComments(d.comments ?? []); setCommentTotal(d.total ?? 0); })
      .catch(() => {});
  }, [id]);

  async function handleFork() {
    if (!userId) { navigate("/login"); return; }
    if (!app) return;
    setForking(true);
    try {
      const res = await fetch(`/api/square/${app.id}/fork`, { method: "POST" });
      if (!res.ok) throw new Error("failed");
      await syncFromServer();
      toast({ title: "Fork 成功" });
      navigate("/app");
    } catch {
      toast({ title: "Fork 失败，请重试", variant: "destructive" });
    } finally {
      setForking(false);
    }
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
      toast({ title: "操作失败，请重试", variant: "destructive" });
    } finally {
      setLiking(false);
    }
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
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!app) return;
    try {
      const res = await fetch(`/api/square/${app.id}/comments/${commentId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setCommentTotal((t) => Math.max(0, t - 1));
    } catch {
      toast({ title: "删除失败，请重试", variant: "destructive" });
    }
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div
        className="min-h-screen bg-white flex items-center justify-center"
        style={{ fontFamily: FONT }}
      >
        <div className="w-8 h-8 rounded-full border-2 border-gray-200 border-t-gray-700 animate-spin" />
      </div>
    );
  }

  // ── Not found state ──
  if (notFound || !app) {
    return (
      <div
        className="min-h-screen bg-white flex flex-col items-center justify-center gap-4"
        style={{ fontFamily: FONT }}
      >
        <p className="text-[15px] text-gray-500">找不到该应用</p>
        <button
          type="button"
          onClick={() => navigate("/CreateSquare")}
          className="text-[13px] text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回创造者广场
        </button>
      </div>
    );
  }

  // ── Main render ──
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: FONT }}>

      {/* ── Navbar — fixed top, transparent→blur on scroll ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          backdropFilter: scrolled ? "blur(14px)" : "none",
          backgroundColor: scrolled ? "rgba(255,255,255,0.80)" : "transparent",
          borderBottom: scrolled ? "1px solid rgba(0,0,0,0.07)" : "1px solid transparent",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
          {/* Left: back arrow + text */}
          <button
            type="button"
            onClick={() => navigate("/CreateSquare")}
            className="flex items-center gap-2 text-[14px] text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>创造者广场</span>
          </button>

          {/* Right: Cascade logo */}
          <img src={cascadeLogo} alt="Cascade" className="h-7 w-auto object-contain" />
        </div>
      </header>

      {/* ── Page body — pad top for fixed navbar ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8 pt-28 pb-16">
        <div className="flex flex-col lg:flex-row gap-10 lg:gap-12 items-start">

          {/* ── Left column: 55% — iframe preview ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="w-full lg:w-[55%] order-2 lg:order-1"
          >
            <div className="relative rounded-2xl overflow-hidden border border-black/[0.07] shadow-sm aspect-[16/9] bg-gray-50">
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
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm hover:bg-gray-50 transition-colors"
                title="刷新预览"
                aria-label="刷新预览"
              >
                <RotateCcw className="w-3.5 h-3.5 text-gray-600" />
              </button>
            </div>
          </motion.div>

          {/* ── Right column: 45% — meta panel ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="w-full lg:w-[45%] order-1 lg:order-2 flex flex-col gap-5"
          >
            {/* App title */}
            <h1
              className="text-[28px] sm:text-[32px] font-bold text-gray-900 tracking-tight leading-tight"
            >
              {app.title}
            </h1>

            {/* Author + date */}
            <p className="text-[14px] text-gray-500">
              @{app.authorUsername} · {timeAgo(app.publishedAt)}
            </p>

            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Framework badge */}
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-black text-white text-[12px] font-semibold">
                {FRAMEWORK_LABELS[app.framework] ?? app.framework}
              </span>

              {/* Open/private badge */}
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-black/[0.10] text-[12px] text-gray-600">
                {app.isOpenSource
                  ? <Unlock className="w-3.5 h-3.5" />
                  : <Lock className="w-3.5 h-3.5" />}
                {app.isOpenSource ? "开源" : "闭源"}
              </span>
            </div>

            {/* Description */}
            {app.description && (
              <p className="text-[14px] text-gray-600 leading-relaxed">
                {app.description}
              </p>
            )}

            {/* Divider */}
            <div className="border-t border-black/[0.07]" />

            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              {/* Fork button — only if open source */}
              {app.isOpenSource && (
                <button
                  type="button"
                  onClick={handleFork}
                  disabled={forking}
                  className="w-full py-3 rounded-xl bg-black text-white text-[14px] font-semibold hover:opacity-85 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <GitFork className="w-4 h-4" />
                  {forking ? "Fork 中…" : "Fork 项目"}
                </button>
              )}

              {/* Like + Share row */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleLike}
                  disabled={liking}
                  className="flex-1 py-3 rounded-xl border text-[14px] font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  style={liked
                    ? { background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.3)", color: "#dc2626" }
                    : { borderColor: "rgba(0,0,0,0.12)", color: "#374151" }}
                >
                  <Heart className="w-4 h-4" fill={liked ? "currentColor" : "none"} />
                  {likeCount > 0 ? likeCount : "点赞"}
                </button>
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="flex-1 py-3 rounded-xl border border-black/[0.12] text-[14px] font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Share2 className="w-4 h-4" />
                  分享
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-black/[0.07]" />

            {/* Stats row */}
            <div className="flex items-center gap-4 text-[12px] text-gray-400">
              <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{likeCount} 点赞</span>
              <span className="flex items-center gap-1"><GitFork className="w-3.5 h-3.5" />{app.forkCount} Fork</span>
              <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{commentTotal} 评论</span>
            </div>

            {/* Divider */}
            <div className="border-t border-black/[0.07]" />

            {/* Visibility info row + dates */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-[12px] text-gray-400">
                <VisibilityIcon visibility={app.visibility} />
                <span>{visibilityLabel(app.visibility)}</span>
              </div>
              <p className="text-[12px] text-gray-400">
                发布于 {new Date(app.publishedAt).toLocaleDateString("zh-CN")}
              </p>
              <p className="text-[12px] text-gray-400">
                更新于 {new Date(app.updatedAt).toLocaleDateString("zh-CN")}
              </p>
            </div>
          </motion.div>
        </div>

        {/* ── Comments section ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="mt-14"
        >
          <h2 className="text-[18px] font-bold text-gray-900 mb-6 flex items-center gap-2">
            <MessageCircle className="w-5 h-5" />
            评论
            {commentTotal > 0 && (
              <span className="text-[14px] font-normal text-gray-400">{commentTotal}</span>
            )}
          </h2>

          {/* Comment input */}
          <div className="mb-8">
            {userId ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleComment();
                  }}
                  maxLength={500}
                  rows={3}
                  placeholder="写下你的评论…（⌘+Enter 发送）"
                  className="w-full px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 border border-black/[0.10] rounded-xl outline-none focus:border-black/30 transition-colors resize-none"
                  style={{ fontFamily: FONT }}
                />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">{commentInput.length}/500</span>
                  <button
                    type="button"
                    onClick={handleComment}
                    disabled={submittingComment || !commentInput.trim()}
                    className="px-5 py-2 rounded-xl bg-black text-white text-[13px] font-medium hover:opacity-85 transition-opacity disabled:opacity-40"
                  >
                    {submittingComment ? "发送中…" : "发送"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-5 py-4 rounded-xl border border-black/[0.07] bg-gray-50 text-center">
                <p className="text-[13px] text-gray-500">
                  <button
                    type="button"
                    onClick={() => navigate("/login")}
                    className="text-black font-medium hover:underline"
                  >
                    登录
                  </button>
                  {" "}后才能发表评论
                </p>
              </div>
            )}
          </div>

          {/* Comment list */}
          {comments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-gray-400">
              <MessageCircle className="w-8 h-8 text-gray-200" />
              <p className="text-[13px]">还没有评论，来说点什么吧</p>
            </div>
          ) : (
            <div className="space-y-5">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-3">
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-[12px] font-semibold text-gray-600 select-none">
                    {c.authorUsername.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-[13px] font-semibold text-gray-900">@{c.authorUsername}</span>
                      <span className="text-[11px] text-gray-400">{timeAgo(c.createdAt)}</span>
                    </div>
                    <p className="text-[14px] text-gray-700 leading-relaxed break-words">{c.content}</p>
                  </div>
                  {/* Delete — only own comments */}
                  {c.userId === userId && (
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(c.id)}
                      className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors mt-0.5"
                      title="删除评论"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      <SharePanel open={shareOpen} onClose={() => setShareOpen(false)} url={shareUrl} title={app.title} />

      <footer className="py-6 px-8 border-t border-black/[0.06]">
        <div className="max-w-7xl mx-auto flex flex-col items-center gap-2">
          <p className="text-[12px] text-gray-400">© 2026 Cascade AI. All rights reserved.</p>
          <SiteBeian />
        </div>
      </footer>
    </div>
  );
}
