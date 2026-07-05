import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguageStore } from "@/stores/language-store";

const LIVE_PHRASES_ZH = [
  "正在脑洞大开中", "灵感正在路上，请稍候", "AI 正在认真思考，不是在摸鱼",
  "代码宇宙正在重组中", "正在向平行宇宙借点智慧", "思维发动机预热中",
  "正在把你的想法翻译成代码语言", "正在解锁最优解", "AI 大脑正在高速运转",
  "把咖啡因转化为代码中", "正在对齐神经元", "想法正在结晶",
  "正在量子计算最优解", "大模型正在认真上班", "正在把文字变成魔法",
  "灵感女神正在降临", "正在高速检索知识库",
];

const LIVE_PHRASES_EN = [
  "Brainwaves detected, processing", "Consulting the code oracle",
  "Firing up the neural engines", "Turning caffeine into code",
  "Assembling brilliant thoughts", "Summoning the AI muse",
  "Untangling the idea spaghetti", "Crunching possibilities",
  "Downloading inspiration", "Aligning neurons, please hold",
  "Searching all known universes", "Cooking up something great",
  "Connecting the creative dots", "Spinning up the idea turbine",
];

export function AnimatedDots() {
  return (
    <>
      <style>{`
        @keyframes dot-fade {
          0%, 20%   { opacity: 0; }
          40%, 100% { opacity: 1; }
        }
        .anim-dot-1 { animation: dot-fade 1.2s ease-in-out infinite; animation-delay: 0s;    }
        .anim-dot-2 { animation: dot-fade 1.2s ease-in-out infinite; animation-delay: 0.3s;  }
        .anim-dot-3 { animation: dot-fade 1.2s ease-in-out infinite; animation-delay: 0.6s; }
      `}</style>
      <span aria-hidden="true">
        <span className="anim-dot-1">.</span>
        <span className="anim-dot-2">.</span>
        <span className="anim-dot-3">.</span>
      </span>
    </>
  );
}

export function ActionLogLiveBar({ className }: { className?: string }) {
  const { lang } = useLanguageStore();
  const phrases = lang === "zh" ? LIVE_PHRASES_ZH : LIVE_PHRASES_EN;
  const phrase = useRef(phrases[Math.floor(Math.random() * phrases.length)]).current;

  const [charCount, setCharCount] = useState(0);
  useEffect(() => {
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (i < phrase.length) {
        i++;
        setCharCount(i);
        timer = setTimeout(tick, 90);
      } else {
        timer = setTimeout(() => {
          i = 0;
          setCharCount(0);
          timer = setTimeout(tick, 90);
        }, 2400);
      }
    };
    timer = setTimeout(tick, 90);
    return () => clearTimeout(timer);
  }, [phrase]);

  const visiblePhrase = phrase.slice(0, Math.max(1, charCount));

  return (
    <span
      className={cn(
        "inline-flex min-w-[120px] max-w-full items-center gap-1.5 rounded-sm border border-border/35 bg-muted/25 px-1.5 py-px text-muted-foreground/80 font-mono text-[10.5px] leading-4",
        className,
      )}
      data-testid="action-log-live-bar"
    >
      <Loader2 className="w-3 h-3 animate-spin shrink-0 text-muted-foreground/70" />
      <span className="truncate whitespace-nowrap">
        {visiblePhrase}
        <AnimatedDots />
      </span>
    </span>
  );
}
