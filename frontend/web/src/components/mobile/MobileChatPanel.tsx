import { ChatPanel } from "@/components/ide/chat-panel";
import { ChatErrorBoundary } from "@/components/ide/chat/error-boundary";
import { useTheme } from "@/components/theme-provider";

// 这些常量直接内联，避免与 MobileIDE.tsx 产生循环依赖
const TOP_BAR_H = 44;
const INPUT_AREA_H = 84;
const CAPSULE_H = 38;
const CAPSULE_BOTTOM_OFFSET = INPUT_AREA_H + 24;
const MSG_LIST_BOTTOM_PAD = CAPSULE_BOTTOM_OFFSET + CAPSULE_H + 16;

export function MobileChatPanel() {
  const { mode } = useTheme();

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
    <div className="mobile-chat-wrap relative flex flex-col h-full w-full overflow-hidden">
      <style>{`
        /* ── 完全隐藏 model selector / polish ── */
        .mobile-chat-wrap [data-testid="select-model-provider"],
        .mobile-chat-wrap [title="Polish — restructure your prompt for clarity"] {
          display: none !important;
        }

        /* ── 消息列表顶部留出 bar 高度，底部留出胶囊高度，内容不被遮住 ── */
        .mobile-chat-wrap [data-testid="chat-panel"] > .flex-1 {
          padding-top: ${TOP_BAR_H + 4}px !important;
          padding-bottom: ${MSG_LIST_BOTTOM_PAD}px !important;
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
