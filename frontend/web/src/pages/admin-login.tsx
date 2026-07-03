import { useState } from "react";
import { useLocation } from "wouter";
import cascadeLogo from "../assets/cascade-logo.png";

const FONT = '"Inter", "Helvetica Neue", system-ui, sans-serif';

export default function AdminLoginPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<"password" | "totp">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "登录失败"); return; }
      if (data.requireTotp) {
        setTempToken(data.tempToken);
        setStep("totp");
      } else {
        navigate("/admin/setup-totp");
      }
    } catch {
      setError("无法连接服务器，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!totpCode.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tempToken, code: totpCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "验证失败"); return; }
      navigate("/admin");
    } catch {
      setError("无法连接服务器，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen w-full overflow-x-hidden"
      style={{ fontFamily: FONT, background: "white" }}
    >
      {/* subtle radial glow */}
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
          {step === "password" ? (
            <>
              <h1
                className="font-bold text-black mb-3 leading-tight"
                style={{ fontSize: "clamp(36px, 5vw, 52px)", fontFamily: FONT }}
              >
                CascadeAI Admin
              </h1>
              <p className="text-gray-500 text-[16px] mb-10">
                请输入管理员账户信息以继续。
              </p>
              <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3 w-full max-w-sm">
                <input
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="用户名"
                  required
                  className="w-full px-4 py-3 rounded-xl text-[14px] outline-none text-gray-900 placeholder:text-gray-400"
                  style={{
                    background: "rgba(255,255,255,0.9)",
                    border: "1px solid rgba(0,0,0,0.12)",
                    boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
                  }}
                  onFocus={(e) => { e.currentTarget.style.border = "1px solid rgba(0,0,0,0.4)"; }}
                  onBlur={(e) => { e.currentTarget.style.border = "1px solid rgba(0,0,0,0.12)"; }}
                />
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="密码"
                  required
                  className="w-full px-4 py-3 rounded-xl text-[14px] outline-none text-gray-900 placeholder:text-gray-400"
                  style={{
                    background: "rgba(255,255,255,0.9)",
                    border: "1px solid rgba(0,0,0,0.12)",
                    boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
                  }}
                  onFocus={(e) => { e.currentTarget.style.border = "1px solid rgba(0,0,0,0.4)"; }}
                  onBlur={(e) => { e.currentTarget.style.border = "1px solid rgba(0,0,0,0.12)"; }}
                />
                <button
                  type="submit"
                  disabled={loading || !username.trim() || !password}
                  className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-all hover:opacity-85 active:scale-[0.98] disabled:opacity-50"
                  style={{ background: "#111827", boxShadow: "0 4px 16px rgba(0,0,0,0.18)" }}
                >
                  {loading ? "登录中…" : "登录"}
                </button>
              </form>
              {error && <p className="mt-4 text-[13px] text-red-500">{error}</p>}
            </>
          ) : (
            <>
              <h1
                className="font-bold text-black mb-3 leading-tight"
                style={{ fontSize: "clamp(28px, 4vw, 40px)", fontFamily: FONT }}
              >
                双因素验证
              </h1>
              <p className="text-gray-500 text-[16px] mb-10">
                请打开 Google Authenticator 输入 6 位动态验证码。
              </p>
              <form onSubmit={handleTotpSubmit} className="flex flex-col gap-3 w-full max-w-sm">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={8}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/[^A-Za-z0-9]/g, ""))}
                  placeholder="000000"
                  required
                  className="w-full px-4 py-3 rounded-xl text-[14px] text-center tracking-widest outline-none text-gray-900 placeholder:text-gray-400"
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
                <p className="text-[12px] text-gray-400 -mt-1">也可输入 8 位备用码</p>
                <button
                  type="submit"
                  disabled={loading || !totpCode.trim()}
                  className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-all hover:opacity-85 active:scale-[0.98] disabled:opacity-50"
                  style={{ background: "#111827", boxShadow: "0 4px 16px rgba(0,0,0,0.18)" }}
                >
                  {loading ? "验证中…" : "验证"}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep("password"); setError(""); setTotpCode(""); }}
                  className="text-[13px] text-gray-400 hover:text-gray-700 transition-colors py-1"
                >
                  ← 返回重新登录
                </button>
              </form>
              {error && <p className="mt-4 text-[13px] text-red-500">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
