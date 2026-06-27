import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, GitFork, Share2, RotateCcw, Unlock, Lock, Globe, Link2, Heart, MessageCircle, Trash2, Eye } from "lucide-react";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useToast } from "@/hooks/use-toast";
import { SharePanel } from "@/components/square/share-panel";
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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
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
      toast({ title: "Fork 成功，已添加到你的项目" });
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

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: FONT }}>
        <div className="w-7 h-7 rounded-full border-2 border-gray-200 border-t-gray-800 animate-spin" />
      </div>
    );
  }

  if (notFound || !app) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4" style={{ fontFamily: FONT }}>
        <p className="text-[15px] text-gray-500">找不到该应用</p>
        <button type="button" onClick={() => navigate("/CreateSquare")}
          className="text-[13px] text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> 返回创造者广场
        </button>
      </div>
    );
  }

  const fwLabel = FRAMEWORK_LABELS[app.framework] ?? app.framework;
  const fwEmoji = FRAMEWORK_EMOJI[app.framework] ?? "✦";

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: FONT }}>

      {/* ── Navbar ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          backdropFilter: scrolled ? "blur(14px)" : "none",
          backgroundColor: scrolled ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0)",
          borderBottom: scrolled ? "1px solid rgba(0,0,0,0.07)" : "1px solid transparent",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 sm:h-16 flex items-center justify-between gap-4">
          <button type="button" onClick={() => navigate("/CreateSquare")}
            className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 transition-colors shrink-0">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">创造者广场</span>
          </button>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all border border-black/[0.09]">
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">分享</span>
            </button>
            {app.isOpenSource && (
              <button type="button" onClick={handleFork} disabled={forking}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-semibold text-white bg-black hover:opacity-85 transition-all disabled:opacity-50">
                <GitFork className="w-3.5 h-3.5" />
                {forking ? "Fork 中…" : "Fork"}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Preview — full width hero ── */}
      <div className="pt-14 sm:pt-16">
        <div className="w-full bg-gray-50" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div className="max-w-6xl mx-auto px-0 sm:px-8">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full overflow-hidden sm:rounded-b-2xl bg-gray-100"
              style={{ aspectRatio: "16/9", maxHeight: 560 }}
            >
              {app.previewScreenshot ? (
                <img
                  src={app.previewScreenshot}
                  alt={app.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-gray-50 to-gray-100">
                  <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center shadow-sm">
                    <span className="text-2xl select-none">{fwEmoji}</span>
                  </div>
                  <span className="text-[13px] text-gray-400">{fwLabel}</span>
                </div>
              )}

              {/* Overlay: refresh button */}
              <button
                type="button"
                onClick={() => setIframeKey((k) => k + 1)}
                className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm flex items-center justify-center transition-colors"
                title="刷新预览"
              >
                <RotateCcw className="w-3.5 h-3.5 text-white" />
              </button>

              {/* Framework badge */}
              <div className="absolute top-3 left-3">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-black/60 text-white backdrop-blur-sm">
                  <span>{fwEmoji}</span>
                  {fwLabel}
                </span>
              </div>

              {/* Open source badge */}
              {app.isOpenSource && (
                <div className="absolute top-3 right-12">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-black/60 text-white backdrop-blur-sm">
                    <Unlock className="w-2.5 h-2.5" />
                    开源
                  </span>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>

      {/* ── Info section ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col lg:flex-row gap-8 lg:gap-16"
        >
          {/* ── Left: title + description ── */}
          <div className="flex-1 min-w-0">
            <h1 className="text-[24px] sm:text-[28px] font-bold text-gray-900 leading-tight tracking-tight mb-3">
              {app.title}
            </h1>
            {app.description && (
              <p className="text-[15px] text-gray-600 leading-relaxed mb-5">
                {app.description}
              </p>
            )}

            {/* Author row */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-[13px] font-semibold text-gray-600 shrink-0 select-none">
                {app.authorUsername.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-900">@{app.authorUsername}</p>
                <p className="text-[11px] text-gray-400">发布于 {timeAgo(app.publishedAt)}</p>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-4 mt-5 pt-5 border-t border-black/[0.06]">
              <span className="flex items-center gap-1.5 text-[13px] text-gray-500">
                <Heart className="w-3.5 h-3.5" />
                {likeCount}
              </span>
              <span className="flex items-center gap-1.5 text-[13px] text-gray-500">
                <GitFork className="w-3.5 h-3.5" />
                {app.forkCount}
              </span>
              <span className="flex items-center gap-1.5 text-[13px] text-gray-500">
                <Eye className="w-3.5 h-3.5" />
                {app.viewCount}
              </span>
              <span className="flex items-center gap-1.5 text-[13px] text-gray-500">
                <MessageCircle className="w-3.5 h-3.5" />
                {commentTotal}
              </span>
            </div>
          </div>

          {/* ── Right: actions panel ── */}
          <div className="lg:w-64 shrink-0 flex flex-col gap-3">

            {/* Like button — big, prominent */}
            <button
              type="button"
              onClick={handleLike}
              disabled={liking}
              className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl text-[14px] font-semibold transition-all duration-200 disabled:opacity-50"
              style={liked ? {
                background: "rgba(239,68,68,0.07)",
                border: "1.5px solid rgba(239,68,68,0.25)",
                color: "#dc2626",
              } : {
                background: "rgba(0,0,0,0.04)",
                border: "1.5px solid rgba(0,0,0,0.10)",
                color: "#374151",
              }}
            >
              <Heart className="w-4 h-4" fill={liked ? "currentColor" : "none"} />
              {liked ? `已点赞 · ${likeCount}` : likeCount > 0 ? `点赞 · ${likeCount}` : "点赞"}
            </button>

            {/* Fork button — primary CTA */}
            {app.isOpenSource && (
              <button
                type="button"
                onClick={handleFork}
                disabled={forking}
                className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl text-[14px] font-semibold text-white bg-black hover:opacity-85 transition-all disabled:opacity-50"
              >
                <GitFork className="w-4 h-4" />
                {forking ? "Fork 中…" : "Fork 项目"}
              </button>
            )}

            {/* Share */}
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl text-[14px] font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-all"
              style={{ border: "1.5px solid rgba(0,0,0,0.09)" }}
            >
              <Share2 className="w-4 h-4" />
              分享
            </button>

            {/* Meta tags */}
            <div className="mt-1 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">
                {fwEmoji} {fwLabel}
              </span>
              {app.isOpenSource ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium bg-green-50 text-green-700">
                  <Unlock className="w-3 h-3" /> 开源
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">
                  <Lock className="w-3 h-3" /> 闭源
                </span>
              )}
              {app.visibility === "public" && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">
                  <Globe className="w-3 h-3" /> 公开
                </span>
              )}
              {app.visibility === "link_only" && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">
                  <Link2 className="w-3 h-3" /> 链接可见
                </span>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Divider ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8">
        <div className="border-t border-black/[0.07]" />
      </div>

      {/* ── Comments ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10 sm:py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <h2 className="text-[16px] font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <MessageCircle className="w-4.5 h-4.5 text-gray-400" />
            评论
            {commentTotal > 0 && (
              <span className="text-[13px] font-normal text-gray-400 ml-0.5">{commentTotal}</span>
            )}
          </h2>

          {/* Input */}
          <div className="mb-8">
            {userId ? (
              <div className="flex flex-col gap-2.5">
                <textarea
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleComment(); }}
                  maxLength={500}
                  rows={3}
                  placeholder="写下你的想法… （⌘+Enter 发送）"
                  className="w-full px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 rounded-xl outline-none resize-none transition-colors"
                  style={{
                    border: "1.5px solid rgba(0,0,0,0.10)",
                    fontFamily: FONT,
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = "rgba(0,0,0,0.30)"}
                  onBlur={(e) => e.currentTarget.style.borderColor = "rgba(0,0,0,0.10)"}
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
              <div className="px-5 py-4 rounded-xl bg-gray-50 text-center" style={{ border: "1.5px solid rgba(0,0,0,0.07)" }}>
                <p className="text-[13px] text-gray-500">
                  <button type="button" onClick={() => navigate("/login")} className="text-black font-semibold hover:underline">登录</button>
                  {" "}后发表评论
                </p>
              </div>
            )}
          </div>

          {/* List */}
          {comments.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 py-14 text-gray-400">
              <MessageCircle className="w-7 h-7 text-gray-200" />
              <p className="text-[13px]">还没有评论，来说点什么吧</p>
            </div>
          ) : (
            <div className="space-y-6">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-3 group">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-[12px] font-semibold text-gray-600 select-none mt-0.5">
                    {c.authorUsername.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] font-semibold text-gray-900">@{c.authorUsername}</span>
                        <span className="text-[11px] text-gray-400">{timeAgo(c.createdAt)}</span>
                      </div>
                      {c.userId === userId && (
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(c.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-400"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-[14px] text-gray-700 leading-relaxed break-words">{c.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Footer ── */}
      <footer className="py-6 px-4 sm:px-8 border-t border-black/[0.06]">
        <div className="max-w-6xl mx-auto flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <img src={cascadeLogo} alt="Cascade AI" className="hidden sm:block h-5 w-auto" style={{ filter: "brightness(0)" }} />
          <p className="text-[12px] text-gray-400">© 2026 Cascade AI. All rights reserved.</p>
        </div>
        <SiteBeian className="mt-2" />
      </footer>

      <SharePanel open={shareOpen} onClose={() => setShareOpen(false)} url={shareUrl} title={app.title} />
    </div>
  );
}
