import { useState, useEffect, useRef, memo, useCallback, useImperativeHandle, forwardRef } from "react";
import { useLocation } from "wouter";
import { useProjectStore, migrateOldState } from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Pencil, FolderOpen, Send, CheckSquare, Square, CheckCheck, LogOut, Home, Sun, Moon, HelpCircle, ChevronDown, Check, Languages, Gift, Copy, Bell, Wand2, ArrowLeft, User } from "lucide-react";
import { getProjectEmoji } from "@/lib/project-emoji";
import { CascadeLogo } from "@/assets/CascadeLogo";
import { useTheme } from "@/components/theme-provider";
import { THEME_LIST, type ThemeId } from "@/lib/themes";
import { useT } from "@/lib/i18n";
import { useLanguageStore } from "@/stores/language-store";
import { useIDEStore } from "@/stores/ide-store";

migrateOldState();

type Notif = { id: number; type: string; title: string; body: string | null; isRead: boolean; createdAt: string };

function NotifDetail({ notif }: { notif: Notif | undefined }) {
  if (!notif) return null;
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 shrink-0 flex flex-col justify-center" style={{ height: 72, borderBottom: "1px solid var(--panel-divider)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: "rgba(79,130,255,0.10)", color: "#4f82ff" }}>
            {notif.type === "changelog" ? "更新公告" : "系统消息"}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {new Date(notif.createdAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <h3 className="text-[14px] font-semibold text-foreground leading-snug truncate">{notif.title}</h3>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {notif.body
          ? <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{notif.body}</p>
          : <p className="text-[13px] text-muted-foreground">暂无详细内容。</p>}
      </div>
    </div>
  );
}

function relativeDate(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (days >= 30) return `${Math.floor(days / 30)}mo ago`;
  if (days >= 7) return `${Math.floor(days / 7)}w ago`;
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  if (mins >= 1) return `${mins}m ago`;
  return "just now";
}

// ─── Isolated Dialog Components (prevent re-render focus loss) ────────────────

type PwdDialogHandle = { open: (opts: { mode: "set" | "change"; email?: string; phone?: string }) => void };
const PwdDialog = memo(forwardRef<PwdDialogHandle, { onSuccess: (msg: string) => void }>(({ onSuccess }, ref) => {
  type PwdMode = "set" | "change" | "forgot";
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<PwdMode>("set");
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [current, setCurrent] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotChannel, setForgotChannel] = useState<"email" | "sms">("email");
  const [forgotTarget, setForgotTarget] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [initEmail, setInitEmail] = useState<string | undefined>();
  const [initPhone, setInitPhone] = useState<string | undefined>();

  const startCountdown = (seconds: number) => {
    setOtpCountdown(seconds);
    const id = setInterval(() => {
      setOtpCountdown((prev) => { if (prev <= 1) { clearInterval(id); return 0; } return prev - 1; });
    }, 1000);
  };

  useImperativeHandle(ref, () => ({
    open(opts) {
      setMode(opts.mode); setStep(1);
      // mode="change" 时不预填当前密码，让用户手动输入
      setCurrent(""); setNewPwd(""); setConfirm("");
      setError(""); setLoading(false);
      setForgotChannel("email");
      setForgotTarget(opts.email ?? opts.phone ?? "");
      setForgotCode(""); setOtpCountdown(0);
      setInitEmail(opts.email); setInitPhone(opts.phone);
      setShow(true);
    }
  }));

  const handleSendOtp = async () => {
    const channel = forgotChannel;
    const target = forgotTarget.trim();
    if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) { setError("邮箱格式不正确"); return; }
    if (channel === "sms" && !/^\+\d{8,15}$/.test(target)) { setError("手机号格式不正确（需含国家区号如 +86）"); return; }
    setError(""); setLoading(true);
    try {
      const r = await fetch("/api/auth/reset-password/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, target }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "发送失败"); return; }
      startCountdown(d.retryAfterSec ?? 60);
      setStep(3);
    } catch { setError("发送失败，请重试"); } finally { setLoading(false); }
  };

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      if (mode === "set" || mode === "change") {
        if (newPwd.length < 6) { setError("密码至少6位"); setLoading(false); return; }
        if (newPwd !== confirm) { setError("两次密码不一致"); setLoading(false); return; }
        const body: Record<string, string> = { password: newPwd };
        if (mode === "change") body.currentPassword = current;
        const r = await fetch("/api/auth/set-password", {
          method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "include", body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) { setError(d.error === "Current password incorrect" ? "当前密码错误" : d.error ?? "失败"); return; }
        setShow(false);
        onSuccess("密码已更新，请重新登录");
        setTimeout(() => { window.location.href = "/login"; }, 1500);
      } else {
        // forgot flow steps
        if (step === 3) {
          if (!/^\d{6}$/.test(forgotCode)) { setError("验证码格式错误"); return; }
          setStep(4); setError("");
        } else if (step === 4) {
          if (newPwd.length < 6) { setError("密码至少6位"); return; }
          setStep(5); setError("");
        } else if (step === 5) {
          if (newPwd !== confirm) { setError("两次密码不一致"); return; }
          const r = await fetch("/api/auth/reset-password/verify", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel: forgotChannel, target: forgotTarget, code: forgotCode, password: newPwd }),
          });
          const d = await r.json();
          if (!r.ok) { setError(d.error ?? "验证失败"); return; }
          setShow(false);
          onSuccess("密码已重置，请重新登录");
          setTimeout(() => { window.location.href = "/login"; }, 1500);
        }
      }
    } catch { setError("操作失败，请重试"); } finally { setLoading(false); }
  };

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) setShow(false); }}>
      <div className="w-full max-w-sm mx-4 rounded-2xl p-6 flex flex-col gap-4"
        style={{ background: "var(--panel-mid-bg)", border: "1px solid var(--panel-divider)", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">
            {mode === "set" ? "设置密码" : mode === "change" ? "修改密码" : "重置密码"}
          </h2>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setShow(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {(mode === "set" || mode === "change") && (
          <div className="flex flex-col gap-3">
            {mode === "change" && (
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">当前密码</label>
                <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="输入当前密码" className="h-9 text-[13px]" autoComplete="new-password" />
              </div>
            )}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">新密码</label>
              <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="至少6位" className="h-9 text-[13px]" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">确认新密码</label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="再次输入" className="h-9 text-[13px]" />
            </div>
            {error && <p className="text-[12px] text-destructive">{error}</p>}
            <div className="flex items-center justify-between mt-1">
              {mode === "change" && (
                <button className="text-[12px] text-muted-foreground hover:text-foreground underline" onClick={() => { setMode("forgot"); setStep(1); setError(""); setForgotTarget(initEmail ?? initPhone ?? ""); }}>忘记密码？</button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="ghost" size="sm" onClick={() => setShow(false)}>取消</Button>
                <Button size="sm" onClick={handleSubmit} disabled={loading}>{loading ? "提交中…" : mode === "set" ? "设置密码" : "修改密码"}</Button>
              </div>
            </div>
          </div>
        )}

        {mode === "forgot" && (
          <div className="flex flex-col gap-3">
            {step === 1 && (
              <>
                <p className="text-[12px] text-muted-foreground">选择验证方式来重置密码：</p>
                <div className="flex flex-col gap-2">
                  {initEmail && (
                    <label className="flex items-center gap-2 cursor-pointer text-[13px]">
                      <input type="radio" checked={forgotChannel === "email"} onChange={() => { setForgotChannel("email"); setForgotTarget(initEmail); }} />
                      <span>邮箱：{initEmail}</span>
                    </label>
                  )}
                  {initPhone && (
                    <label className="flex items-center gap-2 cursor-pointer text-[13px]">
                      <input type="radio" checked={forgotChannel === "sms"} onChange={() => { setForgotChannel("sms"); setForgotTarget(initPhone); }} />
                      <span>手机：{initPhone}</span>
                    </label>
                  )}
                </div>
                {error && <p className="text-[12px] text-destructive">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setMode("change"); setStep(1); setError(""); }}>返回</Button>
                  <Button size="sm" onClick={() => { setStep(2); setError(""); }} disabled={!initEmail && !initPhone}>下一步</Button>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <p className="text-[12px] text-muted-foreground">将向 <strong>{forgotTarget}</strong> 发送验证码。</p>
                {error && <p className="text-[12px] text-destructive">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(1)}>上一步</Button>
                  <Button size="sm" onClick={handleSendOtp} disabled={loading}>{loading ? "发送中…" : "发送验证码"}</Button>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">验证码</label>
                  <div className="flex gap-2">
                    <Input value={forgotCode} onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6位验证码" maxLength={6} className="flex-1 h-9 text-[13px]" />
                    <button className="text-[12px] shrink-0 px-3 h-9 rounded-md border" disabled={otpCountdown > 0 || loading} onClick={handleSendOtp} style={{ borderColor: "var(--panel-divider)" }}>
                      {otpCountdown > 0 ? `${otpCountdown}s` : "重发"}
                    </button>
                  </div>
                </div>
                {error && <p className="text-[12px] text-destructive">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={handleSubmit} disabled={forgotCode.length !== 6}>下一步</Button>
                </div>
              </>
            )}
            {step === 4 && (
              <>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">新密码（至少6位）</label>
                  <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="输入新密码" className="h-9 text-[13px]" />
                </div>
                {error && <p className="text-[12px] text-destructive">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(3)}>上一步</Button>
                  <Button size="sm" onClick={handleSubmit}>下一步</Button>
                </div>
              </>
            )}
            {step === 5 && (
              <>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">确认新密码</label>
                  <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="再次输入" className="h-9 text-[13px]" />
                </div>
                {error && <p className="text-[12px] text-destructive">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(4)}>上一步</Button>
                  <Button size="sm" onClick={handleSubmit} disabled={loading}>{loading ? "提交中…" : "重置密码"}</Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}));

type EmailDialogHandle = { open: (opts: { currentEmail?: string }) => void };
const EmailDialog = memo(forwardRef<EmailDialogHandle, { onSuccess: () => void }>(({ onSuccess }, ref) => {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [title, setTitle] = useState("绑定邮箱");

  const startCountdown = (seconds: number) => {
    setOtpCountdown(seconds);
    const id = setInterval(() => {
      setOtpCountdown((prev) => { if (prev <= 1) { clearInterval(id); return 0; } return prev - 1; });
    }, 1000);
  };

  useImperativeHandle(ref, () => ({
    open(opts) {
      setStep(1); setTarget(opts.currentEmail ?? ""); setCode(""); setError(""); setLoading(false); setOtpCountdown(0);
      setTitle(opts.currentEmail ? "更换邮箱" : "绑定邮箱");
      setShow(true);
    }
  }));

  const handleSendOtp = async () => {
    const t = target.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) { setError("邮箱格式不正确"); return; }
    setError(""); setLoading(true);
    try {
      const r = await fetch("/api/auth/otp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ channel: "email", target: t, purpose: "bind_email" }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "发送失败"); return; }
      startCountdown(d.retryAfterSec ?? 60);
      setStep(2);
    } catch { setError("发送失败，请重试"); } finally { setLoading(false); }
  };

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(code)) { setError("验证码格式错误"); return; }
    setError(""); setLoading(true);
    try {
      const r = await fetch("/api/auth/bind-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ target: target.trim(), code }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error === "Email already in use" ? "该邮箱已被其他账号使用" : d.error === "Invalid or expired code" ? "验证码错误或已过期" : d.error ?? "验证失败");
        return;
      }
      setShow(false);
      onSuccess();
    } catch { setError("验证失败，请重试"); } finally { setLoading(false); }
  };

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) setShow(false); }}>
      <div className="w-full max-w-sm mx-4 rounded-2xl p-6 flex flex-col gap-4"
        style={{ background: "var(--panel-mid-bg)", border: "1px solid var(--panel-divider)", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setShow(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {step === 1 && (
          <div className="flex flex-col gap-3">
            <Input value={target} onChange={(e) => { setTarget(e.target.value); setError(""); }}
              placeholder="输入邮箱地址" className="h-9 text-[13px]"
              onKeyDown={(e) => e.key === "Enter" && handleSendOtp()} />
            {error && <p className="text-[12px] text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShow(false)}>取消</Button>
              <Button size="sm" onClick={handleSendOtp} disabled={loading || !target.trim()}>{loading ? "发送中…" : "发送验证码"}</Button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="flex flex-col gap-3">
            <p className="text-[12px] text-muted-foreground">验证码已发送至 <span className="font-medium text-foreground">{target}</span></p>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="输入6位验证码" className="h-9 text-[13px]" maxLength={6}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()} />
            {error && <p className="text-[12px] text-destructive">{error}</p>}
            <div className="flex items-center justify-between">
              <button className="text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                disabled={otpCountdown > 0} onClick={handleSendOtp}>
                {otpCountdown > 0 ? `${otpCountdown}s 后重发` : "重新发送"}
              </button>
              <Button size="sm" onClick={handleVerify} disabled={loading || !/^\d{6}$/.test(code)}>{loading ? "验证中…" : "绑定"}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}));

type PhoneDialogHandle = { open: (opts: { currentPhone?: string }) => void };
const PhoneDialog = memo(forwardRef<PhoneDialogHandle, { onSuccess: () => void }>(({ onSuccess }, ref) => {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [title, setTitle] = useState("绑定手机号");

  const startCountdown = (seconds: number) => {
    setOtpCountdown(seconds);
    const id = setInterval(() => {
      setOtpCountdown((prev) => { if (prev <= 1) { clearInterval(id); return 0; } return prev - 1; });
    }, 1000);
  };

  useImperativeHandle(ref, () => ({
    open(opts) {
      setStep(1); setTarget(opts.currentPhone ?? ""); setCode(""); setError(""); setLoading(false); setOtpCountdown(0);
      setTitle(opts.currentPhone ? "更换手机号" : "绑定手机号");
      setShow(true);
    }
  }));

  const handleSendOtp = async () => {
    const t = target.trim();
    if (!/^\+\d{8,15}$/.test(t)) { setError("手机号格式不正确（需含国家区号如 +86）"); return; }
    setError(""); setLoading(true);
    try {
      const r = await fetch("/api/auth/otp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ channel: "sms", target: t, purpose: "bind_phone" }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "发送失败"); return; }
      startCountdown(d.retryAfterSec ?? 60);
      setStep(2);
    } catch { setError("发送失败，请重试"); } finally { setLoading(false); }
  };

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(code)) { setError("验证码格式错误"); return; }
    setError(""); setLoading(true);
    try {
      const r = await fetch("/api/auth/bind-phone", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ target: target.trim(), code }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error === "Phone already in use" ? "该手机号已被其他账号使用" : d.error === "Invalid or expired code" ? "验证码错误或已过期" : d.error ?? "验证失败");
        return;
      }
      setShow(false);
      onSuccess();
    } catch { setError("验证失败，请重试"); } finally { setLoading(false); }
  };

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) setShow(false); }}>
      <div className="w-full max-w-sm mx-4 rounded-2xl p-6 flex flex-col gap-4"
        style={{ background: "var(--panel-mid-bg)", border: "1px solid var(--panel-divider)", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setShow(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {step === 1 && (
          <div className="flex flex-col gap-3">
            <p className="text-[12px] text-muted-foreground">请输入手机号（含国家区号，如 +86 开头）</p>
            <Input value={target} onChange={(e) => { setTarget(e.target.value); setError(""); }}
              placeholder="+86 13800000000" className="h-9 text-[13px]"
              onKeyDown={(e) => e.key === "Enter" && handleSendOtp()} />
            {error && <p className="text-[12px] text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShow(false)}>取消</Button>
              <Button size="sm" onClick={handleSendOtp} disabled={loading || !target.trim()}>{loading ? "发送中…" : "发送验证码"}</Button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="flex flex-col gap-3">
            <p className="text-[12px] text-muted-foreground">验证码已发送至 <span className="font-medium text-foreground">{target}</span></p>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="输入6位验证码" className="h-9 text-[13px]" maxLength={6}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()} />
            {error && <p className="text-[12px] text-destructive">{error}</p>}
            <div className="flex items-center justify-between">
              <button className="text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                disabled={otpCountdown > 0} onClick={handleSendOtp}>
                {otpCountdown > 0 ? `${otpCountdown}s 后重发` : "重新发送"}
              </button>
              <Button size="sm" onClick={handleVerify} disabled={loading || !/^\d{6}$/.test(code)}>{loading ? "验证中…" : "绑定"}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}));

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { projects, createProject, deleteProject, renameProject, syncFromServer } = useProjectStore();
  const [, navigate] = useLocation();
  const { themeId, setThemeId, mode } = useTheme();
  const { lang, setLang } = useLanguageStore();
  const [showNewDialog, setShowNewDialog] = useState(false);

  // logo menu
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const logoMenuRef = useRef<HTMLDivElement>(null);

  // 用户建议弹窗
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim() || feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: feedbackText.trim(), source: "pc" }),
      });
      setFeedbackDone(true);
      setFeedbackText("");
      setTimeout(() => { setFeedbackDone(false); setFeedbackOpen(false); }, 1800);
    } catch { /* non-fatal */ } finally {
      setFeedbackSubmitting(false);
    }
  };

  // 消息通知
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<{id:number;type:string;title:string;body:string|null;isRead:boolean;createdAt:string}[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [selectedNotifId, setSelectedNotifId] = useState<number|null>(null);
  const unreadCount = notifs.filter((n) => !n.isRead).length;

  const fetchNotifs = async () => {
    setNotifLoading(true);
    try {
      const res = await fetch("/api/notifications", { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        const list = d.notifications ?? [];
        setNotifs(list);
        // 自动选中第一条（如果还没选）
        if (list.length > 0) {
          setSelectedNotifId((prev) => prev ?? list[0].id);
        }
      }
    } catch { /* non-fatal */ } finally { setNotifLoading(false); }
  };

  const markRead = async (id: number) => {
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
    await fetch(`/api/notifications/${id}/read`, { method: "PATCH", credentials: "include" }).catch(() => {});
  };

  const markAllRead = async () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await fetch("/api/notifications/read-all", { method: "PATCH", credentials: "include" }).catch(() => {});
  };

  // 初始拉取 + 每 30s 轮询 + 切回标签时刷新
  useEffect(() => {
    fetchNotifs();
    const timer = setInterval(fetchNotifs, 30_000);
    const onFocus = () => fetchNotifs();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);
  useEffect(() => { if (notifOpen) fetchNotifs(); }, [notifOpen]);

  useEffect(() => {
    syncFromServer();
  }, [syncFromServer]);

  const [ideaText, setIdeaText] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [selectedFramework, setSelectedFramework] = useState<"web" | "rn-expo" | "flutter" | "kotlin" | "wechat">("web");
  const [usePlanFirst, setUsePlanFirst] = useState(true);

  // Bulk select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);

  const t = useT();

  const username = useIDEStore((s) => s.username);
  const setUserId = useIDEStore((s) => s.setUserId);
  const setUsername = useIDEStore((s) => s.setUsername);

  // 注册方式信息
  const [accountInfo, setAccountInfo] = useState<{
    email?: string; phone?: string; githubId?: string; githubLogin?: string; wechatOpenId?: string; wechatNickname?: string;
    hasPassword?: boolean;
    firstName?: string; lastName?: string; bio?: string;
    avatarUrl?: string;
  } | null>(null);
  const refreshAccountInfo = useCallback(() => {
    fetch("/api/auth/me", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(u => {
      if (u) setAccountInfo({
        email: u.email, phone: u.phone, githubId: u.githubId, githubLogin: u.githubLogin, wechatOpenId: u.wechatOpenId, wechatNickname: u.wechatNickname,
        hasPassword: u.hasPassword,
        firstName: u.firstName, lastName: u.lastName, bio: u.bio,
        avatarUrl: u.avatarUrl,
      });
    }).catch(() => {});
  }, []);
  useEffect(() => { refreshAccountInfo(); }, []);

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUserId(null);
    setUsername(null);
    window.location.href = "/login";
  };

  // ── Username dialog state ─────────────────────────────────────────────────
  const [showEditUsername, setShowEditUsername] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [editUsernameError, setEditUsernameError] = useState("");
  const [editUsernameLoading, setEditUsernameLoading] = useState(false);
  const [usernameCooldown, setUsernameCooldown] = useState<{ canChange: boolean; remainingDays: number } | null>(null);

  // ── Profile modal state ───────────────────────────────────────────────────
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<"home" | "account" | "invite">("home");
  const [usernameEditMode, setUsernameEditMode] = useState(false);
  const [inlineUsername, setInlineUsername] = useState("");
  const [inlineUsernameLoading, setInlineUsernameLoading] = useState(false);
  const [inlineUsernameError, setInlineUsernameError] = useState("");

  // Profile inline edit
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  useEffect(() => {
    if (accountInfo) {
      setFirstName(accountInfo.firstName ?? "");
      setLastName(accountInfo.lastName ?? "");
      setBio(accountInfo.bio ?? "");
      setProfileDirty(false);
    }
  }, [accountInfo]);

  // Dialog refs (state isolated in child components to prevent focus loss)
  const pwdDialogRef = useRef<PwdDialogHandle>(null);
  const emailDialogRef = useRef<EmailDialogHandle>(null);
  const phoneDialogRef = useRef<PhoneDialogHandle>(null);

  // OTP countdown helper (still needed for profile-modal inline dialogs)
  const startCountdown = (setter: React.Dispatch<React.SetStateAction<number>>, seconds: number) => {
    setter(seconds);
    const id = setInterval(() => {
      setter((prev: number) => {
        if (prev <= 1) { clearInterval(id); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  // Toast helper
  const showToast = useCallback((msg: string, variant: "success" | "error" = "success") => {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500;background:${variant === "success" ? "#111" : "#dc2626"};color:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.18);pointer-events:none;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }, []);

  // Stable dialog callbacks — defined outside JSX so memo() on dialog components actually works
  const onPwdSuccess = useCallback((msg: string) => showToast(msg), [showToast]);
  const onEmailSuccess = useCallback(() => { refreshAccountInfo(); showToast("邮箱已绑定"); }, [refreshAccountInfo, showToast]);
  const onPhoneSuccess = useCallback(() => { refreshAccountInfo(); showToast("手机号已绑定"); }, [refreshAccountInfo, showToast]);

  // Validation helpers
  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const isValidPhone = (v: string) => /^\+\d{8,15}$/.test(v.trim());

  // ── Invite panel state ────────────────────────────────────────────────────
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referralCount, setReferralCount] = useState(0);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const copyText = (text: string, type: "code" | "link") => {
    const doCopy = () => {
      if (type === "code") { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000); }
      else { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(doCopy).catch(() => {
        // fallback for contexts where clipboard API is blocked
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        doCopy();
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      doCopy();
    }
  };

  const handleEditUsernameOpen = async () => {
    setNewUsername(username ?? "");
    setEditUsernameError("");
    setShowEditUsername(true);
    try {
      const r = await fetch("/api/auth/me/username-cooldown", { credentials: "include" });
      if (r.ok) setUsernameCooldown(await r.json());
    } catch {}
  };

  const handleEditUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditUsernameError("");
    const trimmed = newUsername.trim();
    if (trimmed.length < 2) { setEditUsernameError(t("auth.usernameTooShort")); return; }
    setEditUsernameLoading(true);
    try {
      const res = await fetch("/api/auth/me/username", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "Username cooldown active") {
          setEditUsernameError(`还需等待 ${data.remainingDays} 天才能再次修改`);
        } else {
          setEditUsernameError(data.error === "Username already taken" ? t("auth.usernameTaken") : data.error);
        }
        return;
      }
      setUsername(data.username);
      setShowEditUsername(false);
      setProfileOpen(true);
      showToast("用户名已更新");
    } finally {
      setEditUsernameLoading(false);
    }
  };

  const handleProfileSave = async () => {
    setProfileSaving(true);
    try {
      const res = await fetch("/api/auth/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ firstName, lastName, bio }),
      });
      if (!res.ok) { showToast("保存失败，请重试", "error"); return; }
      setProfileDirty(false);
      // 直接更新 accountInfo 而不调用 refreshAccountInfo()
      // 避免整个组件 re-render 导致正在编辑的 input 失焦
      setAccountInfo(prev => prev ? { ...prev, firstName, lastName, bio } : prev);
    } catch { showToast("保存失败，请重试", "error"); } finally { setProfileSaving(false); }
  };

  // onBlur 自动保存 — 离开输入框时若有改动则自动保存
  const handleProfileBlurSave = () => {
    if (profileDirty && !profileSaving) handleProfileSave();
  };

  const openPwdDialog = () => {
    pwdDialogRef.current?.open({ mode: accountInfo?.hasPassword ? "change" : "set", email: accountInfo?.email, phone: accountInfo?.phone });
  };

  const openEmailDialog = () => {
    emailDialogRef.current?.open({ currentEmail: accountInfo?.email });
  };

  const openPhoneDialog = () => {
    phoneDialogRef.current?.open({ currentPhone: accountInfo?.phone });
  };


  // close logo menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (logoMenuRef.current && !logoMenuRef.current.contains(e.target as Node)) {
        setLogoMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const lightThemeId: ThemeId = "vs-light";
  const darkThemeId: ThemeId = "vs-dark";

  const logoMenuItems = [
    {
      icon: <Home className="w-3.5 h-3.5" />,
      label: t("navbar.home"),
      action: () => { navigate("/app"); setLogoMenuOpen(false); },
    },
    null,
    {
      icon: mode === "light" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />,
      label: mode === "light" ? t("navbar.darkMode") : t("navbar.lightMode"),
      action: () => { setThemeId(mode === "light" ? darkThemeId : lightThemeId); setLogoMenuOpen(false); },
    },
    {
      icon: <Languages className="w-3.5 h-3.5" />,
      label: lang === "zh" ? t("navbar.langEn") : t("navbar.langZh"),
      action: () => { setLang(lang === "zh" ? "en" : "zh"); setLogoMenuOpen(false); },
    },
    null,
    {
      icon: <HelpCircle className="w-3.5 h-3.5" />,
      label: t("navbar.help"),
      action: () => { setLogoMenuOpen(false); setFeedbackOpen(true); },
    },
    {
      icon: <Bell className="w-3.5 h-3.5" />,
      label: lang === "zh" ? `消息通知${unreadCount > 0 ? ` (${unreadCount})` : ""}` : `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ""}`,
      action: () => { setLogoMenuOpen(false); setNotifOpen(true); },
    },
  ];

  const handleCreate = async () => {
    const idea = ideaText.trim();
    if (!idea || isCreating) return;
    setIsCreating(true);
    try {
      const emoji = getProjectEmoji(idea);
      const initialMode = usePlanFirst ? "manager" : "build";
      const id = await createProject(t("dashboard.newProject"), idea, emoji, selectedFramework, initialMode);
      setIdeaText("");
      setSelectedFramework("web");
      setUsePlanFirst(true);
      setShowNewDialog(false);
      navigate(`/project/${id}`);
      // Auto-name the project based on the idea — fire and forget
      const framework = selectedFramework;
      fetch("/api/generate-project-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, framework }),
      })
        .then((r) => r.json())
        .then((data: { name?: string }) => {
          if (data.name) renameProject(id, data.name, false);
        })
        .catch(() => {});
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteProject(deleteId);
      setDeleteId(null);
    }
  };

  const handleRename = () => {
    const name = renameName.trim();
    if (!name || !renameId) return;
    renameProject(renameId, name, true);
    setRenameId(null);
    setRenameName("");
  };

  const sorted = [...projects].sort((a, b) => b.createdAt - a.createdAt);

  const enterSelectMode = () => {
    setSelectMode(true);
    setSelectedIds(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const allSelected = sorted.length > 0 && selectedIds.size === sorted.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map((p) => p.id)));
    }
  };

  const handleBulkDelete = () => {
    for (const id of selectedIds) {
      deleteProject(id);
    }
    setShowBulkDeleteDialog(false);
    exitSelectMode();
  };

  // Auto-exit select mode when no projects remain
  useEffect(() => {
    if (selectMode && sorted.length === 0) {
      exitSelectMode();
    }
  }, [selectMode, sorted.length]);

  return (
    <div className="min-h-screen bg-background" data-testid="dashboard-page">
      <header className="border-b border-border/50 bg-sidebar">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 sm:px-6 h-14">
          <div className="flex items-center">
            <div className="relative" ref={logoMenuRef}>
              <button
                className="relative flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-accent/20 transition-colors"
                onClick={() => setLogoMenuOpen((v) => !v)}
                aria-label="Open menu"
              >
                <CascadeLogo width={28} height={28} />
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
                {/* 未读通知红点 */}
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white font-bold"
                    style={{ background: "#ef4444", fontSize: 9, minWidth: 14, height: 14, padding: "0 3px", pointerEvents: "none" }}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>

              {logoMenuOpen && (
                <div
                  className="absolute top-full left-0 mt-1 w-48 max-w-[calc(100vw-2rem)] rounded-lg py-1 z-50"
                  style={{
                    background: "var(--panel-mid-bg)",
                    opacity: 1,
                    border: "1px solid var(--panel-divider)",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                  }}
                >
                  {logoMenuItems.map((item, i) =>
                    item === null ? (
                      <div key={`d${i}`} className="h-px my-1 bg-border/50" />
                    ) : (
                      <button
                        key={item.label}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] transition-colors text-left hover:bg-accent/10 text-foreground"
                        onClick={item.action}
                      >
                        <span className="shrink-0 text-muted-foreground">{item.icon}</span>
                        {item.label}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:mr-[-26px]">
            <Button
              size="sm"
              className="w-auto px-3 sm:w-[104px] shrink-0 justify-center gap-1.5 bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
              onClick={() => { window.location.href = "/BuilderSquare"; }}
            >
              {t("dashboard.builderSquare")}
            </Button>
            {/* 手机端：头像圆圈（无头像则显示人像 icon 占位）；PC 端保持原有文字按钮 */}
            <button
              className="hidden sm:flex sm:h-8 sm:w-[72px] shrink-0 truncate rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors items-center justify-center"
              onClick={() => { setProfileTab("home"); setProfileOpen(true); }}
              data-testid="button-user-menu"
            >
              {accountInfo?.firstName || username || "…"}
            </button>
            <button
              className="flex sm:hidden shrink-0 w-8 h-8 rounded-full overflow-hidden items-center justify-center transition-opacity hover:opacity-80"
              style={{ background: accountInfo?.avatarUrl ? "transparent" : "#3a6ea8" }}
              onClick={() => { setProfileTab("home"); setProfileOpen(true); }}
              data-testid="button-user-menu-mobile"
              aria-label="个人主页"
            >
              {accountInfo?.avatarUrl ? (
                <img src={accountInfo.avatarUrl} className="w-full h-full object-cover" alt="avatar" />
              ) : (
                <User className="w-4 h-4 text-white" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 pb-28">
        <div className="flex items-center justify-between mb-1">
          <h1 className="font-lora text-xl font-bold tracking-tight text-foreground" data-testid="text-dashboard-title">
            {t("dashboard.myProjects")}
          </h1>
          <div className="flex items-center gap-2 sm:mr-[-26px]">
            {!selectMode && (
              <Button
                onClick={() => setShowNewDialog(true)}
                size="sm"
                className="w-8 px-0 sm:w-[104px] sm:px-3 h-8 shrink-0 justify-center gap-1.5 bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
                data-testid="button-new-project"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">{t("dashboard.newProject")}</span>
              </Button>
            )}
            {sorted.length > 0 && !selectMode && (
              <Button
                variant="ghost"
                size="sm"
                className="w-8 px-0 sm:w-[72px] sm:px-3 h-8 shrink-0 justify-center gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={enterSelectMode}
                data-testid="button-enter-select"
              >
                <CheckSquare className="w-4 h-4" />
                <span className="hidden sm:inline">{t("dashboard.select")}</span>
              </Button>
            )}
          </div>
        </div>
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="empty-state">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <FolderOpen className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">{t("dashboard.noProjects")}</h2>
            <p className="text-muted-foreground mb-6 max-w-sm">
              {t("dashboard.noProjectsDesc")}
            </p>
            <Button
              onClick={() => setShowNewDialog(true)}
              className="gap-2"
              data-testid="button-new-project-empty"
            >
              <Plus className="w-4 h-4" />
              {t("dashboard.startBuilding")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col border border-border/40 rounded-xl overflow-hidden" data-testid="project-list">
            {sorted.map((project, idx) => {
              const isSelected = selectedIds.has(project.id);
              const fw = project.framework ?? "web";
              const fwLabel: Record<string, string> = {
                web: "Web", "rn-expo": "RN", flutter: "Flutter", kotlin: "Kotlin", wechat: "WeChat",
              };
              return (
                <div
                  key={project.id}
                  className={`group relative flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-b-0 transition-colors cursor-pointer
                    ${selectMode
                      ? isSelected ? "bg-primary/5" : "hover:bg-muted/30"
                      : "hover:bg-muted/30"
                    }`}
                  onClick={() => {
                    if (selectMode) {
                      toggleSelect(project.id);
                    } else {
                      navigate(`/project/${project.id}`);
                    }
                  }}
                  data-testid={`card-project-${project.id}`}
                >
                  {/* Select checkbox */}
                  {selectMode && (
                    <div
                      className="shrink-0"
                      onClick={(e) => { e.stopPropagation(); toggleSelect(project.id); }}
                      data-testid={`checkbox-project-${project.id}`}
                    >
                      {isSelected
                        ? <CheckCheck className="w-4 h-4 text-primary" />
                        : <Square className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  )}

                  {/* Row number */}
                  {!selectMode && (
                    <span className="font-lora text-sm font-bold text-muted-foreground/30 w-6 shrink-0 text-right select-none tabular-nums">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                  )}

                  {/* Emoji */}
                  <span className="text-xl leading-none shrink-0 select-none" data-testid={`emoji-project-${project.id}`}>
                    {project.emoji ?? getProjectEmoji(project.name)}
                  </span>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate" data-testid={`text-project-name-${project.id}`}>
                      {project.name}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary/70">
                        {fwLabel[fw] ?? fw}
                      </span>
                      <span className="text-[11px] text-muted-foreground/50">
                        {relativeDate(project.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Actions — always visible on mobile, hover on desktop */}
                  {!selectMode && (
                    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameId(project.id);
                          setRenameName(project.name);
                        }}
                        data-testid={`button-rename-${project.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteId(project.id);
                        }}
                        data-testid={`button-delete-${project.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Bulk select action bar */}
      {selectMode && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-sidebar/95 backdrop-blur-sm"
          data-testid="bulk-action-bar"
        >
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={toggleSelectAll}
                data-testid="button-select-all"
              >
                {allSelected ? (
                  <CheckCheck className="w-4 h-4 text-primary" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                {allSelected ? t("dashboard.deselectAll") : t("dashboard.selectAll")}
              </button>
              <span className="text-sm text-muted-foreground" data-testid="text-selected-count">
                {t("dashboard.selectedCount", { n: String(selectedIds.size) })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={exitSelectMode}
                data-testid="button-cancel-select"
              >
                {t("dashboard.cancelSelect")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                disabled={selectedIds.size === 0}
                onClick={() => setShowBulkDeleteDialog(true)}
                data-testid="button-delete-selected"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("dashboard.deleteSelected")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-new-project">
          <DialogHeader>
            <DialogTitle className="text-lg">{t("dashboard.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder={t("dashboard.ideaPlaceholder")}
            value={ideaText}
            onChange={(e) => setIdeaText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleCreate();
              }
            }}
            autoFocus
            className="min-h-[80px] resize-none"
            data-testid="input-project-idea"
          />

          {/* 启动方式 — 勾选框形式，在框架上方 */}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setUsePlanFirst((v) => !v)}
              className="flex items-start gap-2.5 w-full text-left"
              data-testid="button-mode-plan"
            >
              <div
                className={[
                  "mt-0.5 w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors",
                  usePlanFirst
                    ? "bg-[#4f82ff] border-[#4f82ff]"
                    : "border-border",
                ].join(" ")}
              >
                {usePlanFirst && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">{t("dashboard.modePlanLabel")}</div>
              </div>
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("dashboard.framework")}</label>
            <Select value={selectedFramework} onValueChange={(v: any) => setSelectedFramework(v)}>
              <SelectTrigger data-testid="select-framework">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="web">{t("dashboard.frameworkWeb")}</SelectItem>
                <SelectItem value="wechat">{t("dashboard.frameworkWechat")}</SelectItem>
                <SelectItem value="rn-expo">{t("dashboard.frameworkRN")}</SelectItem>
                <SelectItem value="flutter" disabled>
                  <span className="flex items-center gap-2">
                    {t("dashboard.frameworkFlutter")}
                    <span className="text-xs text-muted-foreground">({t("dashboard.comingSoon")})</span>
                  </span>
                </SelectItem>
                <SelectItem value="kotlin" disabled>
                  <span className="flex items-center gap-2">
                    {t("dashboard.frameworkKotlin")}
                    <span className="text-xs text-muted-foreground">({t("dashboard.comingSoon")})</span>
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)} data-testid="button-cancel-new">
              {t("dashboard.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={!ideaText.trim() || isCreating} className="gap-2" data-testid="button-create-project">
              <Send className="w-3.5 h-3.5" />
              {t("dashboard.letsGo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameId !== null} onOpenChange={(open) => !open && setRenameId(null)}>
        <DialogContent data-testid="dialog-rename-project">
          <DialogHeader>
            <DialogTitle>{t("dashboard.renameProject")}</DialogTitle>
          </DialogHeader>
          <Input
            placeholder={t("dashboard.newName")}
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleRename()}
            autoFocus
            data-testid="input-rename-project"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameId(null)} data-testid="button-cancel-rename">
              {t("dashboard.cancel")}
            </Button>
            <Button onClick={handleRename} disabled={!renameName.trim()} data-testid="button-confirm-rename">
              {t("dashboard.rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent data-testid="dialog-delete-project">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dashboard.deleteProject")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dashboard.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">{t("dashboard.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {t("dashboard.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={(open) => !open && setShowBulkDeleteDialog(false)}>
        <AlertDialogContent data-testid="dialog-bulk-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dashboard.bulkDeleteTitle", { n: String(selectedIds.size) })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dashboard.bulkDeleteDesc", { n: String(selectedIds.size) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setShowBulkDeleteDialog(false)}
              data-testid="button-cancel-bulk-delete"
            >
              {t("dashboard.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-bulk-delete"
            >
              {t("dashboard.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* ── 修改用户名弹窗 ── */}
      {showEditUsername && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowEditUsername(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") setShowEditUsername(false); }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="w-full max-w-sm mx-4 rounded-2xl p-6 flex flex-col gap-4" style={{ background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold" style={{ color: "#111" }}>修改用户名</h2>
              <button className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowEditUsername(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {usernameCooldown && !usernameCooldown.canChange ? (
              <div>
                <p className="text-[13px]" style={{ color: "#dc2626" }}>
                  用户名每六个月只能修改一次。
                </p>
                <p className="text-[13px] text-muted-foreground mt-1">
                  距离下次可修改还有 <strong>{usernameCooldown.remainingDays}</strong> 天。
                </p>
                <div className="flex justify-end mt-4">
                  <button onClick={() => setShowEditUsername(false)} style={{ background: "#111", color: "#fff", border: "none", borderRadius: 6, padding: "7px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                    知道了
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleEditUsernameSubmit} className="flex flex-col gap-4">
                <p className="text-[12px] text-muted-foreground">用户名每六个月只能修改一次，请确认您的新用户名。</p>
                <div>
                  <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">新用户名</label>
                  <Input
                    value={newUsername}
                    onChange={(e) => { setNewUsername(e.target.value); setEditUsernameError(""); }}
                    placeholder="输入新用户名（2–32 个字符）"
                    autoFocus
                    maxLength={32}
                  />
                  {editUsernameError && (
                    <p className="mt-1.5 text-[12px]" style={{ color: "#dc2626" }}>{editUsernameError}</p>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowEditUsername(false)} style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 6, padding: "7px 16px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", color: "#555" }}>
                    取消
                  </button>
                  <button type="submit" disabled={editUsernameLoading || !newUsername.trim()} style={{ background: "#111", color: "#fff", border: "none", borderRadius: 6, padding: "7px 20px", fontSize: 13, fontWeight: 600, cursor: editUsernameLoading ? "not-allowed" : "pointer", opacity: editUsernameLoading ? 0.6 : 1, fontFamily: "inherit" }}>
                    {editUsernameLoading ? "提交中…" : "确认修改"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── 用户建议弹窗 ── */}
      {feedbackOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setFeedbackOpen(false); }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 flex flex-col gap-4"
            style={{ background: "var(--panel-mid-bg)", border: "1px solid var(--panel-divider)", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">{t("navbar.help")}</h2>
              <button className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => setFeedbackOpen(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <p className="text-[12px] text-muted-foreground">您的建议将帮助我们改进产品，我们会认真阅读每一条反馈。</p>
            <textarea
              className="w-full rounded-lg px-3 py-2.5 text-[13px] text-foreground resize-none outline-none focus:ring-1 focus:ring-[#4f82ff]"
              style={{ background: "var(--panel-left-bg)", border: "1px solid var(--panel-divider)", minHeight: 120 }}
              placeholder="请输入您的建议或反馈..."
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              maxLength={2000}
              autoFocus
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground/60">{feedbackText.length}/2000</span>
              <button
                className="px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
                style={{ background: feedbackDone ? "rgba(52,214,138,0.15)" : "#4f82ff", color: feedbackDone ? "#34d68a" : "white", opacity: feedbackSubmitting ? 0.6 : 1 }}
                onClick={handleFeedbackSubmit}
                disabled={feedbackSubmitting || !feedbackText.trim()}
              >
                {feedbackDone ? "✓ 已提交" : feedbackSubmitting ? "提交中..." : "提交建议"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 消息通知弹窗（响应式：手机单列全屏，PC 双栏）── */}
      {notifOpen && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setNotifOpen(false); }}>
          <div className="flex flex-col overflow-hidden w-full sm:rounded-2xl"
            style={{
              height: "90dvh",
              maxHeight: "90dvh",
              width: "100%",
              maxWidth: 780,
              background: "var(--panel-mid-bg)",
              border: "1px solid var(--panel-divider)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.22)",
              borderRadius: "16px 16px 0 0",
            }}>
            {/* 头部 */}
            <div className="flex items-center justify-between px-5 py-3.5 shrink-0" style={{ borderBottom: "1px solid var(--panel-divider)" }}>
              <div className="flex items-center gap-2.5">
                <span className="text-[13px] font-semibold text-foreground tracking-tight">消息通知</span>
                {unreadCount > 0 && (
                  <span className="flex items-center justify-center rounded-full text-white font-bold text-[10px]"
                    style={{ minWidth: 17, height: 17, background: "#4f82ff", padding: "0 4px" }}>
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[11px] transition-opacity hover:opacity-70" style={{ color: "#4f82ff" }}>全部已读</button>
                )}
                <button className="flex items-center justify-center w-5 h-5 rounded transition-colors text-muted-foreground hover:text-foreground" onClick={() => setNotifOpen(false)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>

            {/* 内容区：手机单列，PC 双栏 */}
            <div className="flex flex-1 overflow-hidden">
              {/* 左栏：手机全宽，PC 固定 260px */}
              <div className="flex flex-col overflow-y-auto w-full sm:w-[260px] sm:shrink-0" style={{ borderRight: "1px solid var(--panel-divider)" }}>
                {notifLoading && (
                  <div className="flex items-center justify-center flex-1 py-12">
                    <div className="w-4 h-4 rounded-full border-2 border-[#4f82ff] border-t-transparent animate-spin" />
                  </div>
                )}
                {!notifLoading && notifs.length === 0 && (
                  <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 py-12">
                    <Bell className="w-6 h-6 text-muted-foreground opacity-40" />
                    <p className="text-[12px] text-muted-foreground text-center">暂无通知</p>
                  </div>
                )}
                {notifs.map((n) => {
                  const isSelected = (selectedNotifId ?? notifs[0]?.id) === n.id;
                  return (
                    <div key={n.id}
                      className="relative flex items-start sm:items-center gap-2.5 px-4 cursor-pointer transition-colors shrink-0"
                      style={{ minHeight: 72, borderBottom: "1px solid var(--panel-divider)", background: isSelected ? "rgba(79,130,255,0.08)" : n.isRead ? "transparent" : "rgba(79,130,255,0.04)", padding: "12px 16px" }}
                      onClick={() => { markRead(n.id); setSelectedNotifId(n.id); }}
                    >
                      {!n.isRead && <div className="absolute left-0 top-4 bottom-4 rounded-r-full" style={{ width: 2.5, background: "#4f82ff" }} />}
                      <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg"
                        style={{ background: n.type === "changelog" ? "rgba(79,130,255,0.10)" : "rgba(52,214,138,0.10)" }}>
                        <span className="text-[13px]">{n.type === "changelog" ? "🎉" : "💬"}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] leading-snug" style={{ fontWeight: n.isRead ? 400 : 600, color: "var(--foreground)" }}>{n.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {new Date(n.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </p>
                        {/* 手机端内联展开 */}
                        {isSelected && n.body && (
                          <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed sm:hidden whitespace-pre-wrap">{n.body}</p>
                        )}
                      </div>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        className="shrink-0 text-muted-foreground sm:hidden"
                        style={{ transform: isSelected ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  );
                })}
              </div>

              {/* 右栏详情：仅 PC 显示 */}
              <div className="hidden sm:flex flex-1 flex-col overflow-hidden">
                {notifs.length === 0 && !notifLoading ? (
                  <div className="flex flex-col items-center justify-center flex-1 gap-3">
                    <div className="flex items-center justify-center w-14 h-14 rounded-2xl"
                      style={{ background: "rgba(79,130,255,0.07)", border: "1px solid rgba(79,130,255,0.12)" }}>
                      <Bell className="w-6 h-6" style={{ color: "#4f82ff", opacity: 0.6 }} />
                    </div>
                    <p className="text-[13px] font-medium text-foreground">收件箱是空的</p>
                    <p className="text-[12px] text-muted-foreground mt-1">新消息会出现在这里</p>
                  </div>
                ) : (
                  <NotifDetail notif={notifs.find(n => n.id === selectedNotifId) ?? notifs[0]} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── 个人主页弹窗（响应式：手机全屏 + 顶部横向 Tab 条，PC 保持原有左右分栏）── */}
      {profileOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setProfileOpen(false); }}
        >
          <div
            className="flex flex-col sm:flex-row overflow-hidden w-full h-full sm:h-auto sm:rounded-2xl"
            style={{
              maxWidth: 760,
              minHeight: 500,
              margin: 0,
              background: "var(--panel-mid-bg)",
              border: "1px solid var(--panel-divider)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            {/* 顶部工具条 — 仅手机显示：返回箭头 + 标题 */}
            <div className="flex sm:hidden items-center gap-2 px-4 shrink-0" style={{ height: 52, borderBottom: "1px solid var(--panel-divider)" }}>
              <button
                onClick={() => setProfileOpen(false)}
                className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                style={{ background: "none", border: "none", cursor: "pointer" }}
                aria-label="关闭"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="text-[14px] font-semibold text-foreground">
                {profileTab === "home" ? "个人主页" : profileTab === "account" ? "账户信息" : "邀请礼遇"}
              </span>
            </div>

            {/* 导航 — 手机：顶部横向 Tab 条；PC：左侧竖直导航栏（原样保留） */}
            <div
              className="flex sm:flex-col shrink-0 sm:w-[140px] w-full"
              style={{ borderRight: "1px solid var(--panel-divider)", background: "var(--panel-left-bg)" }}
            >
              <div className="flex sm:flex-col w-full sm:py-5 sm:pb-4">
                {(["home", "account", "invite"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => {
                      setProfileTab(tab);
                      if (tab === "invite" && !referralCode) {
                        setInviteLoading(true);
                        fetch("/api/referral/my-code", { credentials: "include" })
                          .then((r) => r.json())
                          .then((d) => { if (d.referralCode) { setReferralCode(d.referralCode); setReferralLink(d.referralLink); setReferralCount(d.referralCount ?? 0); } })
                          .catch(() => {})
                          .finally(() => setInviteLoading(false));
                      }
                    }}
                    className="flex-1 sm:w-full sm:flex-none text-center sm:text-left text-[13px] px-3 sm:px-5 py-2.5 transition-colors hover:bg-accent/10"
                    style={{
                      fontWeight: profileTab === tab ? 700 : 400,
                      color: profileTab === tab ? "var(--foreground)" : "var(--muted-foreground)",
                      background: "transparent",
                      border: "none",
                      borderBottom: "2px solid transparent",
                      borderBottomColor: profileTab === tab ? "var(--foreground)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    {tab === "home" ? "个人主页" : tab === "account" ? "账户信息" : "邀请礼遇"}
                  </button>
                ))}
              </div>
              <div className="flex-1 hidden sm:block" />
              <button
                onClick={handleSignOut}
                className="hidden sm:block mx-3.5 py-2 rounded-lg text-[12px] font-semibold text-white transition-colors text-center"
                style={{ background: "#1a1a1a", border: "none", cursor: "pointer" }}
              >
                退出登录
              </button>
            </div>

            {/* 右侧内容 — 手机需要给底部退出登录按钮留出空间 */}
            <div className="flex-1 overflow-y-auto p-5 pb-24 sm:p-[24px_28px_28px]">

              {/* ===== 个人主页 tab ===== */}
              {profileTab === "home" && (
                <div>
                  <p className="text-[15px] font-bold text-foreground mb-5">个人主页</p>
                  <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
                    {/* 头像列 */}
                    <div className="flex flex-col items-center gap-2 shrink-0" style={{ width: 88 }}>
                      <div
                        className="w-[78px] h-[78px] rounded-full flex items-center justify-center text-white font-bold text-[28px] shrink-0 relative overflow-hidden group cursor-pointer"
                        style={{ background: accountInfo?.avatarUrl ? "transparent" : "#3a6ea8" }}
                        onClick={() => document.getElementById("avatar-file-input")?.click()}
                      >
                        {accountInfo?.avatarUrl ? (
                          <img src={accountInfo.avatarUrl} className="w-full h-full object-cover" alt="avatar" />
                        ) : (
                          (username ?? "?")[0].toUpperCase()
                        )}
                        <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-semibold text-white">
                          更换
                        </div>
                      </div>
                      <button
                        className="text-[11px] px-2.5 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => document.getElementById("avatar-file-input")?.click()}
                      >
                        上传图片
                      </button>
                      <input
                        id="avatar-file-input"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 2 * 1024 * 1024) { showToast("图片不能超过 2MB", "error"); return; }
                          const fd = new FormData();
                          fd.append("avatar", file);
                          try {
                            const res = await fetch("/api/auth/me/avatar", { method: "POST", credentials: "include", body: fd });
                            const data = await res.json();
                            if (res.ok && data.avatarUrl) { refreshAccountInfo(); showToast("头像已更新"); }
                            else { showToast(data.error || "上传失败", "error"); }
                          } catch { showToast("上传失败", "error"); }
                          e.target.value = "";
                        }}
                      />
                    </div>

                    {/* 表单列 */}
                    <div className="flex-1 flex flex-col gap-2.5">
                      {/* 用户名：查看模式 */}
                      {!usernameEditMode && (
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-foreground shrink-0" style={{ width: 52 }}>用户名：</span>
                          <input
                            readOnly
                            value={username ?? ""}
                            className="h-7 px-2.5 text-[12px] text-muted-foreground rounded-md outline-none flex-1 min-w-0 sm:flex-none"
                            style={{ width: undefined, maxWidth: 140, border: "1px solid var(--panel-divider)", background: "var(--panel-left-bg)" }}
                          />
                          <button
                            className="flex items-center gap-1 text-[12px] text-foreground hover:text-[#3a6ea8] transition-colors shrink-0"
                            style={{ background: "none", border: "none", cursor: "pointer" }}
                            onClick={() => { setInlineUsername(username ?? ""); setInlineUsernameError(""); setUsernameEditMode(true); handleEditUsernameOpen(); }}
                          >
                            <Pencil className="w-3 h-3" />
                            修改用户名
                          </button>
                        </div>
                      )}

                      {/* 用户名：编辑模式 */}
                      {usernameEditMode && (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] text-foreground shrink-0">用户名：</span>
                            <input
                              autoFocus
                              value={inlineUsername}
                              onChange={(e) => { setInlineUsername(e.target.value); setInlineUsernameError(""); }}
                              className="flex-1 h-7 px-2.5 text-[12px] text-foreground rounded-md outline-none"
                              style={{ border: "1px solid #3a6ea8", background: "var(--panel-mid-bg)" }}
                              onKeyDown={(e) => { if (e.key === "Escape") setUsernameEditMode(false); }}
                            />
                          </div>
                          {usernameCooldown && !usernameCooldown.canChange && (
                            <p className="text-[11px] text-orange-600 ml-0.5">用户名每6个月只能修改一次，还需等待 {usernameCooldown.remainingDays} 天</p>
                          )}
                          {usernameCooldown?.canChange && (
                            <p className="text-[11px] text-orange-600 ml-0.5">注意：用户名每6个月只能修改一次</p>
                          )}
                          {inlineUsernameError && <p className="text-[11px] text-destructive ml-0.5">{inlineUsernameError}</p>}
                          <div className="flex gap-1.5 ml-0.5">
                            <button
                              className="px-3 h-[26px] text-[12px] font-semibold text-white rounded-[5px] transition-colors"
                              style={{ background: "#1a1a1a", border: "none", cursor: "pointer" }}
                              disabled={inlineUsernameLoading || (usernameCooldown ? !usernameCooldown.canChange : false)}
                              onClick={async () => {
                                const trimmed = inlineUsername.trim();
                                if (trimmed.length < 2) { setInlineUsernameError("用户名至少2个字符"); return; }
                                setInlineUsernameLoading(true);
                                try {
                                  const res = await fetch("/api/auth/me/username", {
                                    method: "PUT",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ username: trimmed }),
                                  });
                                  const data = await res.json();
                                  if (!res.ok) { setInlineUsernameError(data.error === "Username already taken" ? "用户名已被占用" : data.error); return; }
                                  setUsername(data.username);
                                  setUsernameEditMode(false);
                                  showToast("用户名已更新");
                                } finally { setInlineUsernameLoading(false); }
                              }}
                            >
                              {inlineUsernameLoading ? "保存中…" : "保存"}
                            </button>
                            <button
                              className="px-3 h-[26px] text-[12px] rounded-[5px] border border-border text-muted-foreground hover:bg-muted/30 transition-colors"
                              style={{ background: "var(--panel-mid-bg)", cursor: "pointer" }}
                              onClick={() => setUsernameEditMode(false)}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      )}

                      {/* 姓氏 + 名字 — PC 固定宽度对齐，手机各占一半自适应 */}
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-foreground shrink-0" style={{ width: 52 }}>姓氏：</span>
                          <Input value={lastName} onChange={(e) => { setLastName(e.target.value); setProfileDirty(true); }} onBlur={handleProfileBlurSave} className="h-7 text-[12px] flex-1 min-w-0 sm:flex-none" style={{ maxWidth: 140 }} maxLength={20} />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-foreground shrink-0 sm:ml-2">名字：</span>
                          <Input value={firstName} onChange={(e) => { setFirstName(e.target.value); setProfileDirty(true); }} onBlur={handleProfileBlurSave} className="h-7 text-[12px] flex-1 min-w-0 sm:flex-none" style={{ maxWidth: 140 }} maxLength={40} />
                        </div>
                      </div>

                      {/* 个人简介 */}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[13px] text-foreground">个人简介</span>
                        <Textarea value={bio} onChange={(e) => { setBio(e.target.value); setProfileDirty(true); }} onBlur={handleProfileBlurSave} placeholder="介绍一下自己..." className="text-[12px] resize-none" style={{ minHeight: 78 }} maxLength={200} />
                      </div>

                      {/* 密码 */}
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[13px] text-foreground shrink-0">密码：</span>
                        <span className="flex-1 text-[12px] text-muted-foreground" style={accountInfo?.hasPassword ? { letterSpacing: 3 } : {}}>
                          {accountInfo?.hasPassword ? "············" : "未设置"}
                        </span>
                        <button
                          className="flex items-center gap-1 text-[12px] text-foreground hover:text-[#3a6ea8] transition-colors shrink-0"
                          style={{ background: "none", border: "none", cursor: "pointer" }}
                          onClick={openPwdDialog}
                        >
                          <Pencil className="w-3 h-3" />
                          {accountInfo?.hasPassword ? "编辑" : "设置密码"}
                        </button>
                      </div>

                      {/* 邮箱 */}
                      <div className="flex items-center gap-2 mt-3">
                        <span className="text-[13px] text-foreground shrink-0">邮箱：</span>
                        <span className={`flex-1 text-[12px] ${accountInfo?.email ? "text-[#3a6ea8]" : "text-muted-foreground"}`}>
                          {accountInfo?.email ?? "未绑定"}
                        </span>
                        <button
                          className="flex items-center gap-1 text-[12px] text-foreground hover:text-[#3a6ea8] transition-colors shrink-0"
                          style={{ background: "none", border: "none", cursor: "pointer" }}
                          onClick={openEmailDialog}
                        >
                          <Pencil className="w-3 h-3" />
                          {accountInfo?.email ? "编辑" : "绑定邮箱"}
                        </button>
                      </div>

                      {/* 手机号 */}
                      <div className="flex items-center gap-2 mt-3">
                        <span className="text-[13px] text-foreground shrink-0">手机号：</span>
                        <span className={`flex-1 text-[12px] ${accountInfo?.phone ? "text-foreground" : "text-muted-foreground"}`}>
                          {accountInfo?.phone ?? "未绑定"}
                        </span>
                        <button
                          className="flex items-center gap-1 text-[12px] text-foreground hover:text-[#3a6ea8] transition-colors shrink-0"
                          style={{ background: "none", border: "none", cursor: "pointer" }}
                          onClick={openPhoneDialog}
                        >
                          <Pencil className="w-3 h-3" />
                          {accountInfo?.phone ? "编辑" : "绑定手机"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ===== 账户信息 tab ===== */}
              {profileTab === "account" && (
                <div>
                  <p className="text-[15px] font-bold text-foreground mb-5">账户信息</p>
                  <div className="flex flex-col">
                    {/* 密码 */}
                    <div className="flex items-center gap-2 py-3" style={{ borderBottom: "1px solid var(--panel-divider)" }}>
                      <span className="text-[13px] text-muted-foreground shrink-0 w-[60px]">密码</span>
                      <span className={`flex-1 text-[13px] ${accountInfo?.hasPassword ? "text-muted-foreground" : "text-muted-foreground/60"}`} style={accountInfo?.hasPassword ? { letterSpacing: 3, fontSize: 10 } : {}}>
                        {accountInfo?.hasPassword ? "············" : "未设置"}
                      </span>
                      {accountInfo?.hasPassword ? (
                        <button className="flex items-center gap-1 text-[12px] text-foreground hover:text-[#3a6ea8] transition-colors shrink-0" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={openPwdDialog}>
                          <Pencil className="w-3 h-3" />编辑
                        </button>
                      ) : (
                        <button className="px-2.5 text-[12px] font-medium text-white rounded shrink-0" style={{ height: 24, background: "#3a6ea8", border: "none", cursor: "pointer" }} onClick={openPwdDialog}>
                          设置密码
                        </button>
                      )}
                    </div>

                    {/* 邮箱 */}
                    <div className="flex items-center gap-2 py-3" style={{ borderBottom: "1px solid var(--panel-divider)" }}>
                      <span className="text-[13px] text-muted-foreground shrink-0 w-[60px]">邮箱</span>
                      <span className={`flex-1 text-[13px] ${accountInfo?.email ? "text-[#3a6ea8]" : "text-muted-foreground/60"}`}>
                        {accountInfo?.email ?? "未绑定"}
                      </span>
                      {accountInfo?.email ? (
                        <button className="flex items-center gap-1 text-[12px] text-foreground hover:text-[#3a6ea8] transition-colors shrink-0" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={openEmailDialog}>
                          <Pencil className="w-3 h-3" />编辑
                        </button>
                      ) : (
                        <button className="px-2.5 text-[12px] font-medium text-white rounded shrink-0" style={{ height: 24, background: "#3a6ea8", border: "none", cursor: "pointer" }} onClick={openEmailDialog}>
                          绑定邮箱
                        </button>
                      )}
                    </div>

                    {/* 手机号 */}
                    <div className="flex items-center gap-2 py-3" style={{ borderBottom: "1px solid var(--panel-divider)" }}>
                      <span className="text-[13px] text-muted-foreground shrink-0 w-[60px]">手机号</span>
                      <span className={`flex-1 text-[13px] ${accountInfo?.phone ? "text-foreground" : "text-muted-foreground/60"}`}>
                        {accountInfo?.phone ?? "未绑定"}
                      </span>
                      {accountInfo?.phone ? (
                        <button className="flex items-center gap-1 text-[12px] text-foreground hover:text-[#3a6ea8] transition-colors shrink-0" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={openPhoneDialog}>
                          <Pencil className="w-3 h-3" />编辑
                        </button>
                      ) : (
                        <button className="px-2.5 text-[12px] font-medium text-white rounded shrink-0" style={{ height: 24, background: "#3a6ea8", border: "none", cursor: "pointer" }} onClick={openPhoneDialog}>
                          绑定手机
                        </button>
                      )}
                    </div>

                    {/* GitHub */}
                    <div className="flex items-center gap-2 py-3" style={{ borderBottom: "1px solid var(--panel-divider)" }}>
                      <span className="text-[13px] text-muted-foreground shrink-0 w-[60px]">GitHub</span>
                      <span className={`flex-1 text-[13px] ${accountInfo?.githubId ? "text-foreground" : "text-muted-foreground/60"}`}>
                        {accountInfo?.githubId ? (accountInfo.githubLogin || accountInfo.githubId) : "未绑定"}
                      </span>
                      {accountInfo?.githubId ? (
                        <button className="flex items-center gap-1 text-[12px] text-foreground hover:text-[#3a6ea8] transition-colors shrink-0" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={async () => {
                          if (!confirm("确定解除 GitHub 绑定？")) return;
                          const r = await fetch("/api/auth/unbind-github", { method: "POST", credentials: "include" });
                          const d = await r.json();
                          if (r.ok) { refreshAccountInfo(); showToast("已解除 GitHub 绑定"); }
                          else { showToast(d.error === "Cannot unbind — no other login method available" ? "无法解绑：需保留至少一种登录方式" : d.error ?? "解绑失败"); }
                        }}>
                          <Pencil className="w-3 h-3" />解除绑定
                        </button>
                      ) : (
                        <button className="px-2.5 text-[12px] font-medium text-white rounded shrink-0" style={{ height: 24, background: "#3a6ea8", border: "none", cursor: "pointer" }} onClick={() => { window.location.href = "/api/auth/github?mode=bind"; }}>
                          绑定 GitHub
                        </button>
                      )}
                    </div>

                    {/* 微信 */}
                    <div className="flex items-center gap-2 py-3">
                      <span className="text-[13px] text-muted-foreground shrink-0 w-[60px]">微信</span>
                      <span className={`flex-1 text-[13px] ${accountInfo?.wechatOpenId ? "text-foreground" : "text-muted-foreground/60"}`}>
                        {accountInfo?.wechatOpenId ? (accountInfo.wechatNickname || "已绑定") : "未绑定"}
                      </span>
                      {accountInfo?.wechatOpenId ? (
                        <button className="flex items-center gap-1 text-[12px] text-foreground hover:text-[#3a6ea8] transition-colors shrink-0" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={async () => {
                          if (!confirm("确定解除微信绑定？")) return;
                          const r = await fetch("/api/auth/unbind-wechat", { method: "POST", credentials: "include" });
                          const d = await r.json();
                          if (r.ok) { refreshAccountInfo(); showToast("已解除微信绑定"); }
                          else { showToast(d.error === "Cannot unbind — no other login method available" ? "无法解绑：需保留至少一种登录方式" : d.error ?? "解绑失败"); }
                        }}>
                          <Pencil className="w-3 h-3" />解除绑定
                        </button>
                      ) : (
                        <button className="px-2.5 text-[12px] font-medium text-white rounded shrink-0" style={{ height: 24, background: "#3a6ea8", border: "none", cursor: "pointer" }} onClick={() => { window.location.href = "/api/auth/wechat?mode=bind"; }}>
                          绑定微信
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ===== 邀请礼遇 tab ===== */}
              {profileTab === "invite" && (
                <div>
                  <p className="text-[15px] font-bold text-foreground mb-5">邀请礼遇</p>
                  <p className="text-[12px] text-muted-foreground mb-4">{t("navbar.invitePanel.desc")}</p>
                  {inviteLoading ? (
                    <p className="text-[12px] text-muted-foreground py-2">{t("navbar.invitePanel.loading")}</p>
                  ) : referralCode ? (
                    <div className="flex flex-col gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          {t("navbar.invitePanel.yourCode")}
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-[14px] font-mono tracking-widest px-3 py-2 rounded-lg bg-muted text-foreground">
                            {referralCode}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                            onClick={() => copyText(referralCode, "code")}
                          >
                            {copiedCode ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <Button
                        className="w-full gap-2"
                        style={copiedLink ? { background: "rgba(52,214,138,0.15)", color: "#34d68a" } : {}}
                        onClick={() => referralLink && copyText(referralLink, "link")}
                      >
                        {copiedLink
                          ? <><Check className="w-4 h-4" />{t("navbar.invitePanel.copied")}</>
                          : <><Copy className="w-4 h-4" />{t("navbar.invitePanel.copyLink")}</>}
                      </Button>
                      <p className="text-[11px] text-center text-muted-foreground">
                        {t("navbar.invitePanel.referralCount").replace("{n}", String(referralCount))}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">暂无邀请码</p>
                  )}
                </div>
              )}

            </div>

            {/* 退出登录 — 仅手机显示，固定在底部（PC 版按钮在左侧导航栏内，见上方） */}
            <button
              onClick={handleSignOut}
              className="flex sm:hidden items-center justify-center mx-4 mb-4 py-2.5 rounded-lg text-[13px] font-semibold text-white transition-colors text-center shrink-0"
              style={{ background: "#1a1a1a", border: "none", cursor: "pointer" }}
            >
              退出登录
            </button>
          </div>
        </div>
      )}

      <PwdDialog ref={pwdDialogRef} onSuccess={onPwdSuccess} />
      <EmailDialog ref={emailDialogRef} onSuccess={onEmailSuccess} />
      <PhoneDialog ref={phoneDialogRef} onSuccess={onPhoneSuccess} />
    </div>
  );
}
