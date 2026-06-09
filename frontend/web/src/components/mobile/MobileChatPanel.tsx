import { ChatPanel } from "@/components/ide/chat-panel";
import { ChatErrorBoundary } from "@/components/ide/chat/error-boundary";
import { TOP_BAR_H } from "./MobileIDE";

export function MobileChatPanel() {
  return (
    <div className="mobile-chat-wrap relative flex flex-col h-full w-full overflow-hidden">
      <style>{`
        /* ── 完全隐藏 model selector / polish / suggest ── */
        .mobile-chat-wrap [data-testid="select-model-provider"],
        .mobile-chat-wrap [title="Polish — restructure your prompt for clarity"],
        .mobile-chat-wrap [title="Smart Response — let AI suggest a reply"] {
          display: none !important;
        }

        /* ── plan / review：保留按钮功能，只隐藏文字标签 ── */
        .mobile-chat-wrap [data-testid="toggle-plan-mode"] span,
        .mobile-chat-wrap [data-testid="toggle-review"] span {
          display: none !important;
        }
        /* 按钮本身稍微放大点击区域 */
        .mobile-chat-wrap [data-testid="toggle-plan-mode"],
        .mobile-chat-wrap [data-testid="toggle-review"] {
          padding: 4px 6px !important;
        }
        /* checkbox 图标稍微放大 */
        .mobile-chat-wrap [data-testid="toggle-plan-mode"] > div,
        .mobile-chat-wrap [data-testid="toggle-review"] > div {
          width: 14px !important;
          height: 14px !important;
        }

        /* ── 消息列表顶部留出 bar 高度，内容不被遮罩盖住 ── */
        .mobile-chat-wrap [data-testid="chat-panel"] > .flex-1 {
          padding-top: ${TOP_BAR_H + 4}px !important;
        }

        /* ── 输入框：白底、深色边框 ── */
        .mobile-chat-wrap [data-testid="input-chat"] {
          background: #ffffff !important;
          color: #1a1a1a !important;
        }
        .mobile-chat-wrap div:has(> textarea[data-testid="input-chat"]) {
          border: 1.5px solid #1A1A1A !important;
          border-left: 1.5px solid #1A1A1A !important;
          border-radius: 12px !important;
          background: #ffffff !important;
        }
        .mobile-chat-wrap div:has(> textarea[data-testid="input-chat"]):focus-within {
          border-color: #000000 !important;
          border-left-color: #000000 !important;
        }

        /* ── 工具栏背景跟随输入框 ── */
        .mobile-chat-wrap .flex.items-center.gap-1\\.5.px-2.pb-1\\.5 {
          background: #ffffff !important;
        }
      `}</style>
      <ChatErrorBoundary>
        <ChatPanel />
      </ChatErrorBoundary>
    </div>
  );
}
