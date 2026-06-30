/**
 * SiteBeian — ICP + Gongan beian footer component.
 * Env vars (all optional — empty = not rendered):
 *   VITE_ICP_BEIAN        e.g. "京ICP备2026033858号-1"
 *   VITE_GONGAN_DATACODE  e.g. "b0c6736fcfce7f98be301aaeb6c333ba"
 *   VITE_GONGAN_TEXT      e.g. "京公网安备11010802049002号"  (falls back to that string)
 */

const ICP_BEIAN = (import.meta.env.VITE_ICP_BEIAN as string | undefined)?.trim() || "";
const GONGAN_DATACODE = (import.meta.env.VITE_GONGAN_DATACODE as string | undefined)?.trim() || "";
const GONGAN_TEXT =
  (import.meta.env.VITE_GONGAN_TEXT as string | undefined)?.trim() ||
  "京公网安备11010802049002号";

const GONGAN_URL = GONGAN_DATACODE
  ? "https://beian.mps.gov.cn/#/query/webSearch?code=" + GONGAN_DATACODE
  : "";

function GonganIcon() {
  return (
    <img
      src="/gongan-icon.png"
      alt=""
      aria-hidden="true"
      style={{ width: 16, height: 16, display: "inline-block", verticalAlign: "middle", marginRight: 3 }}
    />
  );
}

interface SiteBeianProps {
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
          className="flex items-center hover:text-gray-600 transition-colors"
        >
          <GonganIcon />
          {GONGAN_TEXT}
        </a>
      )}
    </div>
  );
}
