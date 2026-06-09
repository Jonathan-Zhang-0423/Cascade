import { PreviewPanel } from "@/components/ide/preview-panel";

export function MobilePreviewPanel() {
  return (
    <div className="mobile-preview-wrap h-full w-full overflow-hidden relative">
      <style>{`
        /* 隐藏顶部 Tab 栏（Preview + Tools & files + Invite + Publish 那一行）
           PreviewPanel 根节点是 data-testid="preview-panel"，
           第一个直接子 div 就是 h-[38px] 的 tab 栏 */
        .mobile-preview-wrap [data-testid="preview-panel"] > div:first-child {
          display: none !important;
        }

        /* 隐藏第二行工具栏（地址栏 / 设备切换 / 刷新按钮那行）
           它是 preview-panel 内第二个直接子 div */
        .mobile-preview-wrap [data-testid="preview-panel"] > div:nth-child(2):not(.flex-1) {
          display: none !important;
        }

        /* 让内容区占满全屏 */
        .mobile-preview-wrap [data-testid="preview-panel"] {
          height: 100% !important;
        }
      `}</style>
      <PreviewPanel fullscreen />
    </div>
  );
}
