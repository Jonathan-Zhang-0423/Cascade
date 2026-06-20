import { useState } from "react";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/components/theme-provider";
import { Gift, Copy, Check } from "lucide-react";

export function MobileInvitePanel() {
  const t = useT();
  const { mode } = useTheme();
  const [open, setOpen] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referralCount, setReferralCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleOpen = () => {
    setOpen(true);
    if (referralCode) return;
    setLoading(true);
    fetch("/api/referral/my-code", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.referralCode) {
          setReferralCode(d.referralCode);
          setReferralLink(d.referralLink);
          setReferralCount(d.referralCount ?? 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const copy = (text: string, type: "code" | "link") => {
    navigator.clipboard.writeText(text).then(() => {
      if (type === "code") {
        setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000);
      }
    });
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        className="flex items-center justify-center w-8 h-8 rounded-lg"
        style={{ color: open ? "#4f82ff" : "var(--foreground)", opacity: open ? 1 : 0.7 }}
        onClick={() => (open ? setOpen(false) : handleOpen())}
        aria-label={t("navbar.invite")}
      >
        <Gift className="w-[17px] h-[17px]" />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1.5 rounded-xl p-4 flex flex-col gap-3"
          style={{
            width: "min(288px, 85vw)",
            background: mode === "dark" ? "hsl(222,22%,11%)" : "#fff",
            border: "1px solid var(--panel-divider)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
            zIndex: 200,
          }}
        >
          <div>
            <p className="text-[13px] font-semibold text-foreground">{t("navbar.invitePanel.title")}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t("navbar.invitePanel.desc")}</p>
          </div>

          {loading ? (
            <p className="text-[12px] text-muted-foreground">{t("navbar.invitePanel.loading")}</p>
          ) : referralCode ? (
            <>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  {t("navbar.invitePanel.yourCode")}
                </p>
                <div className="flex items-center gap-2">
                  <code
                    className="flex-1 text-[13px] font-mono tracking-widest px-3 py-2 rounded-lg"
                    style={{ background: "var(--panel-left-bg)", color: "var(--foreground)" }}
                  >
                    {referralCode}
                  </code>
                  <button
                    className="flex items-center justify-center w-8 h-8 rounded-lg"
                    style={{ background: "var(--panel-left-bg)" }}
                    onClick={() => copy(referralCode, "code")}
                  >
                    {copiedCode
                      ? <Check className="w-3.5 h-3.5 text-green-500" />
                      : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>
                </div>
              </div>
              <button
                className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-[12px] font-medium"
                style={{
                  background: copiedLink ? "rgba(52,214,138,0.12)" : "#4f82ff",
                  color: copiedLink ? "#34d68a" : "white",
                }}
                onClick={() => referralLink && copy(referralLink, "link")}
              >
                {copiedLink
                  ? <><Check className="w-3.5 h-3.5" />{t("navbar.invitePanel.copied")}</>
                  : <><Copy className="w-3.5 h-3.5" />{t("navbar.invitePanel.copyLink")}</>}
              </button>
              <p className="text-[11px] text-muted-foreground text-center">
                {t("navbar.invitePanel.referralCount").replace("{n}", String(referralCount))}
              </p>
            </>
          ) : (
            <p className="text-[12px] text-muted-foreground">{t("navbar.invitePanel.loading")}</p>
          )}
        </div>
      )}
    </div>
  );
}
