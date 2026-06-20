import { useState } from "react";
import { motion } from "framer-motion";
import { Code2, EyeOff, GitFork, Share2, Clock } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
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
  wechat: "微信小程序",
  swiftui: "SwiftUI",
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
  const t = useT();
  const [shareOpen, setShareOpen] = useState(false);
  const shareUrl = `${window.location.origin}/CreateSquare/app/${app.id}`;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
        className="group relative bg-white dark:bg-[#111] rounded-2xl overflow-hidden cursor-pointer border border-gray-100 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-lg transition-all duration-200"
        onClick={onClick}
      >
        {/* Cover / preview */}
        <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 overflow-hidden">
          {app.previewScreenshot ? (
            <img
              src={app.previewScreenshot}
              alt={app.title}
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-300 dark:text-gray-600">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, rgba(99,102,255,0.12) 0%, rgba(139,92,246,0.08) 100%)" }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-indigo-400/60" />
                  <path d="M7 8l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400/60" />
                </svg>
              </div>
              <span className="text-[11px] text-gray-400">{FRAMEWORK_LABELS[app.framework] ?? app.framework}</span>
            </div>
          )}

          {/* Badge strip */}
          <div className="absolute top-2 left-2 flex gap-1">
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium",
                app.isOpenSource
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-gray-100 text-gray-500 border border-gray-200",
              )}
            >
              {app.isOpenSource ? <Code2 className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
              {app.isOpenSource ? t("square.openSource") : t("square.closedSource")}
            </span>
          </div>

          {/* Action buttons on hover */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200 flex items-end justify-end p-2 gap-1.5 opacity-0 group-hover:opacity-100">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
              className="w-7 h-7 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-sm hover:bg-white transition-colors"
              title={t("square.share")}
            >
              <Share2 className="w-3.5 h-3.5 text-gray-700" />
            </button>
            {app.isOpenSource && onFork && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onFork(app.id); }}
                className="w-7 h-7 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-sm hover:bg-white transition-colors"
                title={t("square.fork")}
              >
                <GitFork className="w-3.5 h-3.5 text-gray-700" />
              </button>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="px-3.5 py-3">
          <h3 className="text-[14px] font-semibold text-gray-900 dark:text-white truncate leading-tight">
            {app.title}
          </h3>
          {app.description && (
            <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400 line-clamp-2 leading-snug">
              {app.description}
            </p>
          )}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {t("square.by")} <span className="font-medium text-gray-600 dark:text-gray-400">@{app.authorUsername}</span>
            </span>
            <span className="flex items-center gap-0.5 text-[11px] text-gray-400">
              <Clock className="w-3 h-3" />
              {timeAgo(app.publishedAt)}
            </span>
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
