import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useT } from "@/lib/i18n";

export default function InviteGatePage() {
  const t = useT();
  const [, setLocation] = useLocation();
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Compute the post-redeem destination once on mount. Falls back to /app.
  const [next, setNext] = useState("/app");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const n = params.get("next");
    if (n && n.startsWith("/")) setNext(n);
  }, []);

  // If the visitor has no session, send them to login first.
  useEffect(() => {
    fetch("/api/auth/me").then((r) => {
      if (!r.ok) {
        window.location.href = "/login";
        return;
      }
      r.json().then((u) => {
        if (u.inviteCode) setLocation(next);
      });
    }).catch(() => {
      window.location.href = "/login";
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!inviteCode.trim()) {
      setError(t("auth.inviteCodeRequired"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/invite-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        const map: Record<string, string> = {
          "Invalid invite code": t("auth.inviteCodeInvalid"),
          "Invite code already used": t("auth.inviteCodeUsed"),
          "Invite code expired": t("auth.inviteCodeExpired"),
          "Invite code required": t("auth.inviteCodeRequired"),
        };
        setError(map[data.error] ?? t("auth.genericError"));
        return;
      }
      setLocation(next);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080810] flex items-center justify-center">
      <div className="w-full max-w-md bg-[#0d1525] border border-[rgba(255,255,255,0.08)] rounded-2xl p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">{t("auth.inviteGateTitle")}</h1>
          <p className="mt-1 text-sm text-[rgba(255,255,255,0.4)]">{t("auth.inviteGateSubtitle")}</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-[11px] text-[rgba(255,255,255,0.5)] mb-1">{t("auth.inviteCodeLabel")}</label>
            <input
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500 tracking-widest"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder={t("auth.inviteCodePlaceholder")}
              autoComplete="off"
              autoFocus
              required
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-40 mt-2"
          >
            {loading ? "…" : t("auth.inviteGateSubmit")}
          </button>
        </form>
      </div>
    </div>
  );
}
