import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, QrCode, Link2 } from "lucide-react";
import { useT } from "@/lib/i18n";

interface SharePanelProps {
  open: boolean;
  onClose: () => void;
  url: string;
  title: string;
}

function QRCodeSvg({ url, size = 160 }: { url: string; size?: number }) {
  // Simple QR using a public API via img tag — no extra deps needed
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=000000&margin=8`;
  return (
    <div
      className="rounded-xl overflow-hidden shadow-sm border border-gray-100"
      style={{ width: size, height: size }}
    >
      <img src={src} alt="QR code" width={size} height={size} className="block" />
    </div>
  );
}

type Tab = "link" | "qr";

export function SharePanel({ open, onClose, url, title }: SharePanelProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("link");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) { setCopied(false); setTab("link"); }
  }, [open]);

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] bg-white dark:bg-[#111] rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">{t("square.share")}</h3>
                <p className="text-[12px] text-gray-400 truncate max-w-[200px]">{title}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-5 pt-4 pb-0">
              {(["link", "qr"] as Tab[]).map((t_) => (
                <button
                  key={t_}
                  type="button"
                  onClick={() => setTab(t_)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                    tab === t_
                      ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                      : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  {t_ === "link" ? <Link2 className="w-3.5 h-3.5" /> : <QrCode className="w-3.5 h-3.5" />}
                  {t_ === "link" ? t("square.shareLink") : t("square.shareQr")}
                </button>
              ))}
            </div>

            <div className="px-5 py-4">
              {tab === "link" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-200 dark:border-gray-700">
                    <span className="flex-1 text-[12px] text-gray-600 dark:text-gray-300 truncate font-mono">{url}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 text-[13px] font-medium transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        {t("square.linkCopied")}
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        {t("square.copyLink")}
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-2">
                  <QRCodeSvg url={url} size={160} />
                  <p className="text-[12px] text-gray-400 text-center">扫描二维码访问此应用</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
