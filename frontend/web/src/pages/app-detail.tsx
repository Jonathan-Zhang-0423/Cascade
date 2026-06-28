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

  const [app, setApp] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forking, setForking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liking, setLiking] = useState(false);

  const [comments, setComments] = useState<AppComment[]>([]);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentInput, setCommentInput] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  const shareUrl = `${window.location.origin}/CreateSquare/app/${id}`;

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
        <button type="button" onClick={() => navigate("/CreateSquare")}
          className="text-[13px] text-gray-400 hover:text-gray-800 transition-colors flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> 返回广场
        </button>
      </div>
    );
  }

  const fwLabel = FRAMEWORK_LABELS[app.framework] ?? app.framework;
  const fwEmoji = FRAMEWORK_EMOJI[app.framework] ?? "✦";
  const previewUrl = `/preview-serve/${app.id}/`;

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
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-14 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate("/CreateSquare")}
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
      <div className="pt-14 max-w-7xl mx-auto px-4 sm:px-8">
        <div className="flex flex-col lg:flex-row gap-8 xl:gap-10 py-6 sm:py-8 lg:items-start">

          {/* ══ LEFT COLUMN: preview + comments ══ */}
          <div className="flex-1 min-w-0">

            {/* Browser-chrome preview window */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="w-full rounded-2xl overflow-hidden"
              style={{ border: "1px solid rgba(0,0,0,0.09)", boxShadow: "0 4px 24px rgba(0,0,0,0.07)" }}
            >
              {/* Chrome bar */}
              <div
                className="flex items-center gap-3 px-4 h-10 shrink-0"
                style={{ background: "#f5f5f5", borderBottom: "1px solid rgba(0,0,0,0.08)" }}
              >
                {/* Traffic lights */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-3 h-3 rounded-full" style={{ background: "#fc615d" }} />
                  <div className="w-3 h-3 rounded-full" style={{ background: "#fdbc40" }} />
                  <div className="w-3 h-3 rounded-full" style={{ background: "#34c84a" }} />
                </div>
                {/* Fake URL bar */}
                <div
                  className="flex-1 flex items-center gap-1.5 px-3 h-6 rounded-md text-[11px] text-gray-400 min-w-0"
                  style={{ background: "#ebebeb" }}
                >
                  <Globe className="w-3 h-3 shrink-0 text-gray-400" />
                  <span className="truncate">{app.title.toLowerCase().replace(/\s+/g, "-")}.cascade.app</span>
                </div>
                {/* Refresh */}
                <button
                  type="button"
                  onClick={() => setIframeKey((k) => k + 1)}
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-black/[0.07] transition-colors text-gray-500"
                  title="刷新"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>

              {/* Preview content */}
              <div className="relative w-full bg-gray-50" style={{ aspectRatio: "16/9" }}>
                {app.previewScreenshot ? (
                  <img
                    key={iframeKey}
                    src={app.previewScreenshot}
                    alt={app.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-sm">
                      <span className="text-xl select-none">{fwEmoji}</span>
                    </div>
                    <span className="text-[12px] text-gray-400">{fwLabel}</span>
                  </div>
                )}
              </div>
            </motion.div>

            {/* ── Comments ── */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="mt-8"
            >
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
                <div className="flex gap-3 mb-7">
                  <Avatar name={userId} size={8} />
                  <div className="flex-1">
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
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400"
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
            </motion.div>
          </div>

          {/* ══ RIGHT COLUMN: sticky info + actions ══ */}
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="w-full lg:w-72 xl:w-80 shrink-0 lg:sticky lg:top-20"
          >
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.09)" }}>

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

              {/* Stats row */}
              <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                {[
                  { icon: <Eye className="w-3.5 h-3.5" />, value: app.viewCount },
                  { icon: <Heart className="w-3.5 h-3.5" />, value: likeCount },
                  { icon: <GitFork className="w-3.5 h-3.5" />, value: app.forkCount },
                  { icon: <MessageCircle className="w-3.5 h-3.5" />, value: commentTotal },
                ].map((s, i) => (
                  <div key={i} className="flex items-center gap-1 text-[12px] text-gray-400">
                    {s.icon}
                    <span>{s.value}</span>
                  </div>
                ))}
              </div>

              {/* Tags / meta */}
              <div className="px-5 py-3.5 flex flex-wrap gap-1.5">
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
    </div>
  );
}
