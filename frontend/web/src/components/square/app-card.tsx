import { useState } from "react";
import { motion } from "framer-motion";
import { GitFork, Share2, Lock, Unlock } from "lucide-react";
import { SharePanel } from "./share-panel";

export interface AppCardData {
  id: string;
  title: string;
  description: string | null;
  isOpenSource: boolean;
  framework: string;
  previewScreenshot: string | null;
  publishedAt: string;
  authorUsername: string;
  viewCount?: number;
  forkCount?: number;
}

interface AppCardProps {
  app: AppCardData;
  onClick: () => void;
  onFork?: (id: string) => void;
  index?: number;
}

const FRAMEWORK_LABELS: Record<string, string> = {
  web: "Web",
  "rn-expo": "React Native",
  flutter: "Flutter",
  kotlin: "Kotlin",
  wechat: "小程序",
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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "今天";
  if (d === 1) return "昨天";
  if (d < 30) return `${d}天前`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}个月前`;
  return `${Math.floor(m / 12)}年前`;
}

export function AppCard({ app, onClick, onFork, index = 0 }: AppCardProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const shareUrl = `${window.location.origin}/CreateSquare/app/${app.id}`;
  const fwLabel = FRAMEWORK_LABELS[app.framework] ?? app.framework;
  const fwEmoji = FRAMEWORK_EMOJI[app.framework] ?? "✦";

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: index * 0.045, ease: [0.22, 1, 0.36, 1] }}
        className="group relative cursor-pointer rounded-2xl overflow-hidden bg-white transition-all duration-200 hover:-translate-y-1"
        style={{
          border: "1px solid rgba(0,0,0,0.07)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
          fontFamily: "Inter, sans-serif",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = "0 8px 32px rgba(0,0,0,0.10)";
          e.currentTarget.style.borderColor = "rgba(0,0,0,0.13)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)";
          e.currentTarget.style.borderColor = "rgba(0,0,0,0.07)";
        }}
        onClick={onClick}
      >
        {/* Cover */}
        <div className="relative w-full aspect-[16/9] bg-gray-50 overflow-hidden">
          {app.previewScreenshot ? (
            <img
              src={app.previewScreenshot}
              alt={app.title}
              className="object-cover w-full h-full group-hover:scale-[1.03] transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm">
                <span className="text-[18px] select-none">{fwEmoji}</span>
              </div>
              <span className="text-[12px] text-gray-500">{fwLabel}</span>
            </div>
          )}

          {/* Framework badge — top left */}
          <div className="absolute top-2.5 left-2.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 text-white backdrop-blur-sm">
              {fwLabel}
            </span>
          </div>

          {/* Open/private badge — top right */}
          <div className="absolute top-2.5 right-2.5">
            {app.isOpenSource ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 text-white backdrop-blur-sm">
                <Unlock className="w-2.5 h-2.5" />
                开源
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/40 text-white/80 backdrop-blur-sm">
                <Lock className="w-2.5 h-2.5" />
                私有
              </span>
            )}
          </div>

          {/* Hover action buttons — bottom right */}
          <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
              className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-md hover:bg-gray-50 transition-colors"
              title="分享"
            >
              <Share2 className="w-3.5 h-3.5 text-gray-700" />
            </button>
            {app.isOpenSource && onFork && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onFork(app.id); }}
                className="w-8 h-8 rounded-full bg-black flex items-center justify-center shadow-md hover:opacity-80 transition-opacity"
                title="Fork"
              >
                <GitFork className="w-3.5 h-3.5 text-white" />
              </button>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="px-3.5 py-3">
          <h3 className="text-[14px] font-semibold text-gray-900 truncate leading-tight">
            {app.title}
          </h3>
          {app.description && (
            <p className="mt-1 text-[12px] text-gray-500 line-clamp-2 leading-snug">
              {app.description}
            </p>
          )}
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-[11px] text-gray-400">@{app.authorUsername}</span>
            <span className="text-[11px] text-gray-400">{timeAgo(app.publishedAt)}</span>
          </div>
        </div>
      </motion.div>

      <SharePanel
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        url={shareUrl}
        title={app.title}
      />
    </>
  );
}
