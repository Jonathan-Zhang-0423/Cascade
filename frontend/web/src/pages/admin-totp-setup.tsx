import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import cascadeLogo from "../assets/cascade-logo.png";

const FONT = '"Inter", "Helvetica Neue", system-ui, sans-serif';

export default function AdminTotpSetupPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<"loading" | "qr" | "done">("loading");
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/admin/auth/me", { credentials: "include" })
      .then((r) => {
        if (!r.ok) { navigate("/admin/login"); return null; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        if (data.user.totpEnabled) { navigate("/admin"); return; }
        return setupTotp();
      })
      .catch(() => navigate("/admin/login"));
  }, []);

  async function setupTotp() {
    try {
      const res = await fetch("/api/admin/auth/setup-totp", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || "初始化失败"); return; }
      const data = await res.json();
      setSecret(data.secret);
      setUri(data.uri);
      setBackupCodes(data.backupCodes);
      setStep("qr");
    } catch {
      setError("无法连接服务器");
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !/^\d{6}$/.test(code.trim())) { setError("请输入 6 位数字验证码"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/admin/auth/confirm-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "验证失败"); return; }
      setStep("done");
    } catch {
      setError("无法连接服务器");
    } finally {
      setLoading(false);
    }
  }

  function copyBackupCodes() {
    navigator.clipboard.writeText(backupCodes.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="min-h-screen w-full overflow-x-hidden"
      style={{ fontFamily: FONT, background: "white" }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0,0,0,0.04) 0%, transparent 70%)",
        }}
      />

      {/* Navbar */}
      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          backdropFilter: "blur(14px)",
          backgroundColor: "rgba(255,255,255,0.85)",
          borderBottom: "1px solid rgba(0,0,0,0.07)",
        }}
      >
        <div className="max-w-6xl mx-auto px-8 h-20 flex items-center">
          <img src={cascadeLogo} alt="Cascade AI" className="h-8 w-auto object-contain" />
        </div>
      </header>

      <div className="relative z-10 max-w-6xl mx-auto px-6 pt-36 pb-20">
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">

          {step === "loading" && (
            <p className="text-gray-400 text-[14px]">加载中...</p>
          )}

          {step === "qr" && (
            <>
              <h1
                className="font-bold text-black mb-3 leading-tight"
                style={{ fontSize: "clamp(28px, 4vw, 40px)", fontFamily: FONT }}
              >
                设置双因素认证
              </h1>
              <p className="text-gray-500 text-[16px] mb-8">
                使用 Google Authenticator 扫描下方二维码完成绑定。
              </p>

              <div className="w-full max-w-sm text-left space-y-5">
                {/* QR Code */}
                <div className="flex justify-center">
                  <div
                    className="p-4 rounded-2xl"
                    style={{ background: "white", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}
                  >
                    <QRCodeSVG value={uri} size={180} level="M" />
                  </div>
                </div>

                {/* Manual secret */}
                <div>
                  <p className="text-[12px] text-gray-400 mb-1">无法扫码？手动输入密钥：</p>
                  <div
                    className="w-full px-4 py-3 rounded-xl text-[13px] font-mono text-gray-700 break-all select-all"
                    style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.08)" }}
                  >
                    {secret}
                  </div>
                </div>

                {/* Backup codes */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[13px] font-semibold text-gray-700">备用码（请妥善保存）</p>
                    <button
                      onClick={copyBackupCodes}
                      className="text-[12px] text-gray-400 hover:text-gray-700 transition-colors"
                    >
                      {copied ? "✓ 已复制" : "复制全部"}
                    </button>
                  </div>
                  <div
                    className="w-full px-4 py-3 rounded-xl grid grid-cols-2 gap-y-1.5 gap-x-4"
                    style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.08)" }}
                  >
                    {backupCodes.map((c, i) => (
                      <code key={i} className="text-[13px] font-mono text-gray-600">{c}</code>
                    ))}
                  </div>
                  <p className="text-[12px] text-amber-500 mt-1.5">⚠ 每个备用码只能使用一次，丢失后无法恢复</p>
                </div>

                {/* Confirm form */}
                <form onSubmit={handleConfirm} className="flex flex-col gap-3 pt-3" style={{ borderTop: "1px solid rgba(0,0,0,0.07)" }}>
                  <p className="text-[13px] text-gray-500">扫码后，输入 App 显示的 6 位验证码确认绑定：</p>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="w-full px-4 py-3 rounded-xl text-center outline-none text-gray-900 placeholder:text-gray-400"
                    style={{
                      background: "rgba(255,255,255,0.9)",
                      border: "1px solid rgba(0,0,0,0.12)",
                      boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
                      fontSize: "20px",
                      letterSpacing: "0.3em",
                    }}
                    onFocus={(e) => { e.currentTarget.style.border = "1px solid rgba(0,0,0,0.4)"; }}
                    onBlur={(e) => { e.currentTarget.style.border = "1px solid rgba(0,0,0,0.12)"; }}
                  />
                  {error && <p className="text-[13px] text-red-500">{error}</p>}
                  <button
                    type="submit"
                    disabled={loading || code.length !== 6}
                    className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-all hover:opacity-85 active:scale-[0.98] disabled:opacity-50"
                    style={{ background: "#111827", boxShadow: "0 4px 16px rgba(0,0,0,0.18)" }}
                  >
                    {loading ? "验证中…" : "确认绑定"}
                  </button>
                </form>
              </div>
            </>
          )}

          {step === "done" && (
            <>
              <div className="text-4xl mb-4">✓</div>
              <h1
                className="font-bold text-black mb-3"
                style={{ fontSize: "clamp(28px, 4vw, 40px)", fontFamily: FONT }}
              >
                绑定成功
              </h1>
              <p className="text-gray-500 text-[16px] mb-8">
                双因素认证已启用，后续登录需输入密码和动态验证码。
              </p>
              <button
                onClick={() => navigate("/admin")}
                className="px-8 py-3 rounded-xl text-[14px] font-semibold text-white transition-all hover:opacity-85 active:scale-[0.98]"
                style={{ background: "#111827", boxShadow: "0 4px 16px rgba(0,0,0,0.18)" }}
              >
                进入管理面板
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
