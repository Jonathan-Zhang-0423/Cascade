import { useState, useCallback } from "react";
import { Copy, Check, X, QrCode } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  onClose: () => void;
  publishedAppId?: string;
  projectId: string;
}

const PLATFORM_TIPS = [
  {
    name: "小红书",
    icon: "📕",
    tip: "复制链接 → 打开小红书 → 发布笔记 → 正文粘贴链接",
  },
  {
    name: "抖音",
    icon: "🎵",
    tip: "复制链接 → 打开抖音 → 发布视频 → 描述中粘贴链接",
  },
  {
    name: "微信",
    icon: "💬",
    tip: "截图二维码 → 微信扫一扫 或 复制链接发送给好友",
  },
];

export function MediaSharePanel({ onClose, publishedAppId, projectId }: Props) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [nativeShareDone, setNativeShareDone] = useState(false);

  const shareUrl = publishedAppId
    ? `${window.location.origin}/BuilderSquare/app/${publishedAppId}`
    : `${window.location.origin}/preview/${projectId}`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ description: "链接已复制", duration: 1500 });
    } catch {
      toast({ description: "复制失败，请手动复制", duration: 2000 });
    }
  }, [shareUrl, toast]);

  const handleNativeShare = useCallback(async () => {
    if (!navigator.share) { handleCopy(); return; }
    try {
      await navigator.share({
        title: "Cascade AI — App 演示",
        text: "我用 Cascade AI 生成了这个 App，快来看看！",
        url: shareUrl,
      });
      setNativeShareDone(true);
    } catch {
      // User cancelled — no-op
    }
  }, [shareUrl, handleCopy]);

  return (
    <div className="px-3 pb-3 pt-2 space-y-3"
      style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.15)" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted-foreground/80">分享到</span>
        <button onClick={onClose} className="text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Native share (mobile) + copy */}
      <div className="flex gap-2">
        <button
          onClick={handleNativeShare}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-all"
          style={{ background: "#4f82ff", color: "#fff" }}
        >
          {nativeShareDone ? <Check className="w-3 h-3" /> : "📤"}
          {nativeShareDone ? "已分享" : "系统分享"}
        </button>
        <button
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-all"
          style={{ background: "rgba(255,255,255,0.07)", color: "var(--foreground)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {copied ? <Check className="w-3 h-3 text-[#34d68a]" /> : <Copy className="w-3 h-3" />}
          {copied ? "已复制" : "复制链接"}
        </button>
      </div>

      {/* Link display */}
      <div className="flex items-center gap-2 px-2.5 py-2 rounded-md text-[11px] text-muted-foreground/50 truncate"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <span className="truncate flex-1">{shareUrl}</span>
      </div>

      {/* Platform tips */}
      <div className="space-y-1.5">
        {PLATFORM_TIPS.map((p) => (
          <div key={p.name} className="flex items-start gap-2 text-[11px]">
            <span className="w-4 shrink-0">{p.icon}</span>
            <span className="text-muted-foreground/50">{p.tip}</span>
          </div>
        ))}
      </div>

      {!publishedAppId && (
        <p className="text-[11px] text-muted-foreground/40 italic">
          发布到创造者广场后可获得永久公开链接
        </p>
      )}
    </div>
  );
}
