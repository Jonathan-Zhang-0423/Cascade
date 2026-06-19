/**
 * 站点备案信息（ICP 备案 + 公安联网备案）。
 *
 * 工信部要求：网站底部展示 ICP 备案号，并超链接到 https://beian.miit.gov.cn。
 * 公安联网备案（新版）：使用 32 位“数据码”驱动跳转，链接到
 *   https://beian.mps.gov.cn/#/query/webSearch?code=<数据码>
 *
 * 全部通过 Vite 环境变量配置，改号码只改 .env、无需动代码：
 *   VITE_ICP_BEIAN=京ICP备2026033858号-1
 *   VITE_GONGAN_DATACODE=b0c6736fcfce7f98be301aaeb6c333ba   公安联网备案 32 位数据码（驱动链接）
 *   VITE_GONGAN_TEXT=公安联网备案                            底部展示文案（可选，缺省即此值）
 *
 * 任一变量为空则对应条目不渲染，所以号码没下来时挂着也不会显示空链接。
 */

const ICP_BEIAN = (import.meta.env.VITE_ICP_BEIAN as string | undefined)?.trim() || "";
const GONGAN_DATACODE = (import.meta.env.VITE_GONGAN_DATACODE as string | undefined)?.trim() || "";
const GONGAN_TEXT = (import.meta.env.VITE_GONGAN_TEXT as string | undefined)?.trim() || "公安联网备案";

// 新版公安联网备案：数据码作为 query 跳转到全国互联网安全管理服务平台。
const GONGAN_URL = GONGAN_DATACODE
  ? `https://beian.mps.gov.cn/#/query/webSearch?code=${GONGAN_DATACODE}`
  : "";

interface SiteBeianProps {
  /** 额外类名，便于在不同 footer 里微调间距/颜色 */
  className?: string;
}

export function SiteBeian({ className = "" }: SiteBeianProps) {
  if (!ICP_BEIAN && !GONGAN_URL) return null;

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-gray-400 ${className}`}
    >
      {ICP_BEIAN && (
        <a
          href="https://beian.miit.gov.cn"
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-gray-600 transition-colors"
        >
          {ICP_BEIAN}
        </a>
      )}
      {GONGAN_URL && (
        <a
          href={GONGAN_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-gray-600 transition-colors"
        >
          {GONGAN_TEXT}
        </a>
      )}
    </div>
  );
}
