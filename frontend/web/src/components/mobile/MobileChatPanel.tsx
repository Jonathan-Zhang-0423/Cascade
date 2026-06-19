import { ChatPanel } from "@/components/ide/chat-panel";
import { ChatErrorBoundary } from "@/components/ide/chat/error-boundary";
import { TOP_BAR_H } from "./MobileIDE";
import { useTheme } from "@/components/theme-provider";
import { useEffect, useRef } from "react";

export function MobileChatPanel() {
  const { mode } = useTheme();
  const wrapRef = useRef<HTMLDivElement>(null);

  // 两层 MutationObserver：
  // 1. 先监听 wrap 本身，等滚动容器挂载后立即滚底并切换到内容监听
  // 2. 内容监听：子节点变化（新消息/动态icon）时自动滚底
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const SCROLL_SEL = '[data-testid="chat-panel"] > .flex-1';

    const scrollToBottom = (el: HTMLElement) => {
      el.scrollTop = el.scrollHeight;
    };

    let contentObserver: MutationObserver | null = null;

    const attachContentObserver = (el: HTMLElement) => {
      if (contentObserver) return; // 已经在监听了
      scrollToBottom(el);          // 立即滚一次
      contentObserver = new MutationObserver(() => scrollToBottom(el));
      contentObserver.observe(el, { childList: true, subtree: true, characterData: true });
    };

    // 先看容器是否已经存在
    const existing = wrap.querySelector(SCROLL_SEL) as HTMLElement | null;
    if (existing) {
      attachContentObserver(existing);
      return () => contentObserver?.disconnect();
    }

    // 容器还没出现，监听 wrap 直到它出现
    const waitObserver = new MutationObserver(() => {
      const el = wrap.querySelector(SCROLL_SEL) as HTMLElement | null;
      if (!el) return;
      waitObserver.disconnect();
      attachContentObserver(el);
    });
    waitObserver.observe(wrap, { childList: true, subtree: true });

    return () => {
      waitObserver.disconnect();
      contentObserver?.disconnect();
    };
  }, []);

  const isDark = mode === "dark";
  const inputBg = isDark ? "hsl(222,22%,14%)" : "#ffffff";
  const inputBorder = isDark ? "rgba(255,255,255,0.15)" : "#1A1A1A";
  const inputBorderFocus = isDark ? "rgba(255,255,255,0.35)" : "#000000";
  const textColor = isDark ? "#e8e8e8" : "#1a1a1a";
  const toolbarBg = inputBg;
  const btnTextColor = isDark ? "#aaaaaa" : "#555555";
  const checkboxBorder = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)";
  const iconColor = isDark ? "#777777" : "#888888";

  return (
    <div ref={wrapRef} className="mobile-chat-wrap relative flex flex-col h-full w-full overflow-hidden">
      <style>{`
        /* ── 完全隐藏 model selector / polish ── */
        .mobile-chat-wrap [data-testid="select-model-provider"],
        .mobile-chat-wrap [title="Polish — restructure your prompt for clarity"] {
          display: none !important;
        }

        /* ── 消息列表顶部留出 bar 高度，内容不被遮罩盖住 ── */
        /* ── 底部 padding 设 0，完全靠 ::after 占位控制底线，避免双重叠加 ── */
        .mobile-chat-wrap [data-testid="chat-panel"] > .flex-1 {
          padding-top: ${TOP_BAR_H + 4}px !important;
          padding-bottom: 0 !important;
        }

        /* ── 硬底线占位：高度 = 输入框(100px) + 胶囊(38px) + 间距(24px) + 安全区 ── */
        /* 所有内容滚到底时停在这条线上方，绝不与胶囊交叉 ── */
        .mobile-chat-wrap [data-testid="chat-panel"] > .flex-1::after {
          content: "" !important;
          display: block !important;
          height: calc(162px + env(safe-area-inset-bottom, 16px)) !important;
          width: 100% !important;
          pointer-events: none !important;
          flex-shrink: 0 !important;
        }

        /* ── 输入框：固定到视口底部，不被系统导航栏遮挡 ── */
        .mobile-chat-wrap [data-testid="chat-panel"] > .relative.shrink-0 {
          position: fixed !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          padding-bottom: env(safe-area-inset-bottom, 8px) !important;
          z-index: 45 !important;
          background: ${inputBg} !important;
        }

        /* ── 消息列表上滑虚化：顶部渐隐遮罩 ── */
        .mobile-chat-wrap [data-testid="chat-panel"] > .flex-1 {
          -webkit-mask-image: linear-gradient(
            to bottom,
            transparent 0px,
            transparent ${TOP_BAR_H}px,
            black ${TOP_BAR_H + 24}px,
            black 100%
          ) !important;
          mask-image: linear-gradient(
            to bottom,
            transparent 0px,
            transparent ${TOP_BAR_H}px,
            black ${TOP_BAR_H + 24}px,
            black 100%
          ) !important;
        }

        /* ── 输入框：主题自适应背景和字色 ── */
        .mobile-chat-wrap [data-testid="input-chat"] {
          background: ${inputBg} !important;
          color: ${textColor} !important;
        }
        .mobile-chat-wrap div:has(> textarea[data-testid="input-chat"]) {
          border: 1.5px solid ${inputBorder} !important;
          border-left: 1.5px solid ${inputBorder} !important;
          border-radius: 12px !important;
          background: ${inputBg} !important;
        }
        .mobile-chat-wrap div:has(> textarea[data-testid="input-chat"]):focus-within {
          border-color: ${inputBorderFocus} !important;
          border-left-color: ${inputBorderFocus} !important;
        }

        /* ── 工具栏背景跟随输入框 ── */
        .mobile-chat-wrap .flex.items-center.gap-1\\.5.px-2.pb-1\\.5 {
          background: ${toolbarBg} !important;
        }

        /* plan / polish 按钮文字 */
        .mobile-chat-wrap [data-testid="toggle-plan-mode"] span,
        .mobile-chat-wrap [data-testid="button-polish"] span {
          color: ${btnTextColor} !important;
        }

        /* checkbox 边框 */
        .mobile-chat-wrap [data-testid="toggle-plan-mode"] > div {
          border-color: ${checkboxBorder} !important;
        }

        /* polish 图标颜色 */
        .mobile-chat-wrap [data-testid="button-polish"] svg {
          color: ${iconColor} !important;
        }
      `}</style>
      <ChatErrorBoundary>
        <ChatPanel />
      </ChatErrorBoundary>
    </div>
  );
}
