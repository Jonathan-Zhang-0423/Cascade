import { ChatPanel } from "@/components/ide/chat-panel";
import { ChatErrorBoundary } from "@/components/ide/chat/error-boundary";
import { TOP_BAR_H } from "./MobileIDE";
import { useTheme } from "@/components/theme-provider";
import { useEffect, useRef } from "react";

export function MobileChatPanel() {
  const { mode } = useTheme();
  const wrapRef = useRef<HTMLDivElement>(null);

  // 两层 MutationObserver + 用户滚动检测：
  // 仅当用户在底部附近且未主动上滑时才自动滚底
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const SCROLL_THRESHOLD = 120;
    const RESUME_THRESHOLD = 30;
    const SCROLL_SEL = '[data-testid="chat-panel"] > .flex-1';

    let userScrolledUp = false;

    const isNearBottom = (el: HTMLElement) =>
      el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_THRESHOLD;

    const scrollToBottom = (el: HTMLElement) => {
      if (userScrolledUp) return; // 用户正在上滑，不打扰
      if (isNearBottom(el)) el.scrollTop = el.scrollHeight;
    };

    let contentObserver: MutationObserver | null = null;
    let scrollListener: (() => void) | null = null;

    const attachContentObserver = (el: HTMLElement) => {
      if (contentObserver) return;
      // 挂载时强制滚一次
      el.scrollTop = el.scrollHeight;

      // 监听用户滚动方向
      scrollListener = () => {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (dist <= RESUME_THRESHOLD) {
          userScrolledUp = false; // 滚回底部，恢复自动滚底
        } else if (dist > SCROLL_THRESHOLD) {
          userScrolledUp = true;  // 主动上滑，禁止自动滚底
        }
      };
      el.addEventListener("scroll", scrollListener, { passive: true });

      // 只监听 childList（新消息节点增减），不监听 characterData（打字机文字变化）
      contentObserver = new MutationObserver(() => scrollToBottom(el));
      contentObserver.observe(el, { childList: true, subtree: true });
    };

    const existing = wrap.querySelector(SCROLL_SEL) as HTMLElement | null;
    if (existing) {
      attachContentObserver(existing);
      return () => {
        contentObserver?.disconnect();
        if (scrollListener && existing) existing.removeEventListener("scroll", scrollListener);
      };
    }

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
      if (scrollListener) {
        const el = wrap.querySelector(SCROLL_SEL) as HTMLElement | null;
        if (el) el.removeEventListener("scroll", scrollListener);
      }
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
