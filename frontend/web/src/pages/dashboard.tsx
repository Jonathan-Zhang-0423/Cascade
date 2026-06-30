import { useState, useEffect, useRef } from "react";
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
import { Plus, Trash2, Pencil, FolderOpen, Send, Palette, CheckSquare, Square, CheckCheck, LogOut, User, Home, Clock, Sun, Moon, HelpCircle, ChevronDown, Check, Languages, Gift, Copy, Bell, Wand2 } from "lucide-react";
import { getProjectEmoji } from "@/lib/project-emoji";
import { CascadeLogo } from "@/assets/CascadeLogo";
import { useTheme } from "@/components/theme-provider";
import { THEME_LIST, type ThemeId } from "@/lib/themes";
import { LangToggle } from "@/components/lang-toggle";
import { useT } from "@/lib/i18n";
import { useLanguageStore } from "@/stores/language-store";
import { useIDEStore } from "@/stores/ide-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

  useEffect(() => { fetchNotifs(); }, []);
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
    email?: string; phone?: string; githubId?: string;
    hasPassword?: boolean;
    firstName?: string; lastName?: string; bio?: string;
    avatarUrl?: string;
  } | null>(null);
  const refreshAccountInfo = () => {
    fetch("/api/auth/me", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(u => {
      if (u) setAccountInfo({
        email: u.email, phone: u.phone, githubId: u.githubId,
        hasPassword: u.hasPassword,
        firstName: u.firstName, lastName: u.lastName, bio: u.bio,
        avatarUrl: u.avatarUrl,
      });
    }).catch(() => {});
  };
  useEffect(() => { refreshAccountInfo(); }, []);

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUserId(null);
    setUsername(null);
    window.location.href = "/login";
  };

  // ── Edit username state ───────────────────────────────────────────────────
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

  // Password dialog
  type PwdMode = "set" | "change" | "forgot";
  const [showPwdDialog, setShowPwdDialog] = useState(false);
  const [pwdMode, setPwdMode] = useState<PwdMode>("set");
  const [pwdStep, setPwdStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdForgotChannel, setPwdForgotChannel] = useState<"email" | "sms">("email");
  const [pwdForgotTarget, setPwdForgotTarget] = useState("");
  const [pwdForgotCode, setPwdForgotCode] = useState("");
  const [pwdOtpCountdown, setPwdOtpCountdown] = useState(0);

  // Email dialog
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailStep, setEmailStep] = useState<1 | 2 | 3>(1);
  const [emailTarget, setEmailTarget] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailOtpCountdown, setEmailOtpCountdown] = useState(0);

  // Phone dialog
  const [showPhoneDialog, setShowPhoneDialog] = useState(false);
  const [phoneStep, setPhoneStep] = useState<1 | 2 | 3>(1);
  const [phoneTarget, setPhoneTarget] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneOtpCountdown, setPhoneOtpCountdown] = useState(0);

  // OTP countdown helper
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
  const showToast = (msg: string, variant: "success" | "error" = "success") => {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500;background:${variant === "success" ? "#111" : "#dc2626"};color:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.18);pointer-events:none;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  };

  // Validation helpers
  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const isValidPhone = (v: string) => /^\+\d{8,15}$/.test(v.trim());

  // ── Invite panel state ────────────────────────────────────────────────────
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referralCount, setReferralCount] = useState(0);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const openInviteDialog = () => {
    setShowInviteDialog(true);
    if (referralCode) return;
    setInviteLoading(true);
    fetch("/api/referral/my-code")
      .then((r) => r.json())
      .then((d) => {
        if (d.referralCode) {
          setReferralCode(d.referralCode);
          setReferralLink(d.referralLink);
          setReferralCount(d.referralCount ?? 0);
        }
      })
      .catch(() => {})
      .finally(() => setInviteLoading(false));
  };

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
        setEditUsernameError(
          data.error === "Username already taken" ? t("auth.usernameTaken") : data.error
        );
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
      refreshAccountInfo();
    } catch { showToast("保存失败，请重试", "error"); } finally { setProfileSaving(false); }
  };

  // onBlur 自动保存 — 离开输入框时若有改动则自动保存
  const handleProfileBlurSave = () => {
    if (profileDirty && !profileSaving) handleProfileSave();
  };

  const openPwdDialog = () => {
    const hasPassword = accountInfo?.hasPassword ?? false;
    setPwdMode(hasPassword ? "change" : "set");
    setPwdStep(1);
    setPwdCurrent(""); setPwdNew(""); setPwdConfirm("");
    setPwdError(""); setPwdLoading(false);
    setPwdForgotChannel("email");
    setPwdForgotTarget(accountInfo?.email ?? accountInfo?.phone ?? "");
    setPwdForgotCode(""); setPwdOtpCountdown(0);
    setShowPwdDialog(true);
  };

  const handlePwdSendOtp = async () => {
    const channel = pwdForgotChannel;
    const target = pwdForgotTarget.trim();
    if (channel === "email" && !isValidEmail(target)) { setPwdError("邮箱格式不正确"); return; }
    if (channel === "sms" && !isValidPhone(target)) { setPwdError("手机号格式不正确（需含国家区号如 +86）"); return; }
    setPwdError(""); setPwdLoading(true);
    try {
      const r = await fetch("/api/auth/reset-password/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, target }),
      });
      const d = await r.json();
      if (!r.ok) { setPwdError(d.error ?? "发送失败"); return; }
      startCountdown(setPwdOtpCountdown, d.retryAfterSec ?? 60);
      setPwdStep(3);
    } catch { setPwdError("发送失败，请重试"); } finally { setPwdLoading(false); }
  };

  const handlePwdSubmit = async () => {
    setPwdError(""); setPwdLoading(true);
    try {
      if (pwdMode === "set" || pwdMode === "change") {
        if (pwdNew.length < 6) { setPwdError("密码至少6位"); setPwdLoading(false); return; }
        if (pwdNew !== pwdConfirm) { setPwdError("两次密码不一致"); setPwdLoading(false); return; }
        const body: Record<string, string> = { password: pwdNew };
        if (pwdMode === "change") body.currentPassword = pwdCurrent;
        const r = await fetch("/api/auth/set-password", {
          method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "include", body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) { setPwdError(d.error === "Current password incorrect" ? "当前密码错误" : d.error ?? "失败"); return; }
        setShowPwdDialog(false);
        showToast("密码已更新，请重新登录");
        setTimeout(() => { window.location.href = "/login"; }, 1500);
      } else {
        if (pwdStep === 3) {
          if (!/^\d{6}$/.test(pwdForgotCode)) { setPwdError("验证码格式错误"); return; }
          setPwdStep(4); setPwdError("");
        } else if (pwdStep === 4) {
          if (pwdNew.length < 6) { setPwdError("密码至少6位"); return; }
          setPwdStep(5); setPwdError("");
        } else if (pwdStep === 5) {
          if (pwdNew !== pwdConfirm) { setPwdError("两次密码不一致"); return; }
          const r = await fetch("/api/auth/reset-password/verify", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel: pwdForgotChannel, target: pwdForgotTarget, code: pwdForgotCode, password: pwdNew }),
          });
          const d = await r.json();
          if (!r.ok) { setPwdError(d.error ?? "验证失败"); return; }
          setShowPwdDialog(false);
          showToast("密码已重置，请重新登录");
          setTimeout(() => { window.location.href = "/login"; }, 1500);
        }
      }
    } catch { setPwdError("操作失败，请重试"); } finally { setPwdLoading(false); }
  };

  const openEmailDialog = () => {
    setEmailStep(1); setEmailTarget(accountInfo?.email ?? "");
    setEmailCode(""); setEmailError(""); setEmailLoading(false); setEmailOtpCountdown(0);
    setShowEmailDialog(true);
  };

  const handleEmailSendOtp = async () => {
    const target = emailTarget.trim();
    if (!isValidEmail(target)) { setEmailError("邮箱格式不正确"); return; }
    setEmailError(""); setEmailLoading(true);
    try {
      const r = await fetch("/api/auth/otp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ channel: "email", target, purpose: "bind_email" }),
      });
      const d = await r.json();
      if (!r.ok) { setEmailError(d.error ?? "发送失败"); return; }
      startCountdown(setEmailOtpCountdown, d.retryAfterSec ?? 60);
      setEmailStep(2);
    } catch { setEmailError("发送失败，请重试"); } finally { setEmailLoading(false); }
  };

  const handleEmailVerify = async () => {
    if (!/^\d{6}$/.test(emailCode)) { setEmailError("验证码格式错误"); return; }
    setEmailError(""); setEmailLoading(true);
    try {
      const r = await fetch("/api/auth/bind-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ target: emailTarget.trim(), code: emailCode }),
      });
      const d = await r.json();
      if (!r.ok) {
        setEmailError(d.error === "Email already in use" ? "该邮箱已被其他账号使用"
          : d.error === "Invalid or expired code" ? "验证码错误或已过期"
          : d.error ?? "验证失败");
        return;
      }
      setShowEmailDialog(false);
      refreshAccountInfo();
      showToast("邮箱已绑定");
    } catch { setEmailError("验证失败，请重试"); } finally { setEmailLoading(false); }
  };

  const openPhoneDialog = () => {
    setPhoneStep(1); setPhoneTarget(accountInfo?.phone ?? "");
    setPhoneCode(""); setPhoneError(""); setPhoneLoading(false); setPhoneOtpCountdown(0);
    setShowPhoneDialog(true);
  };

  const handlePhoneSendOtp = async () => {
    const target = phoneTarget.trim();
    if (!isValidPhone(target)) { setPhoneError("手机号格式不正确（需含国家区号如 +86）"); return; }
    setPhoneError(""); setPhoneLoading(true);
    try {
      const r = await fetch("/api/auth/otp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ channel: "sms", target, purpose: "bind_phone" }),
      });
      const d = await r.json();
      if (!r.ok) { setPhoneError(d.error ?? "发送失败"); return; }
      startCountdown(setPhoneOtpCountdown, d.retryAfterSec ?? 60);
      setPhoneStep(2);
    } catch { setPhoneError("发送失败，请重试"); } finally { setPhoneLoading(false); }
  };

  const handlePhoneVerify = async () => {
    if (!/^\d{6}$/.test(phoneCode)) { setPhoneError("验证码格式错误"); return; }
    setPhoneError(""); setPhoneLoading(true);
    try {
      const r = await fetch("/api/auth/bind-phone", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ target: phoneTarget.trim(), code: phoneCode }),
      });
      const d = await r.json();
      if (!r.ok) {
        setPhoneError(d.error === "Phone already in use" ? "该手机号已被其他账号使用"
          : d.error === "Invalid or expired code" ? "验证码错误或已过期"
          : d.error ?? "验证失败");
        return;
      }
      setShowPhoneDialog(false);
      refreshAccountInfo();
      showToast("手机号已绑定");
    } catch { setPhoneError("验证失败，请重试"); } finally { setPhoneLoading(false); }
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
                  className="absolute top-full left-0 mt-1 w-48 rounded-lg py-1 z-50"
                  style={{
                    background: "#ffffff",
                    opacity: 1,
                    border: "1px solid rgba(0,0,0,0.10)",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                  }}
                >
                  {logoMenuItems.map((item, i) =>
                    item === null ? (
                      <div key={`d${i}`} className="h-px my-1 bg-border/50" />
                    ) : (
                      <button
                        key={item.label}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] transition-colors text-left hover:bg-black/5"
                        style={{ color: "#1a1a1a" }}
                        onClick={item.action}
                      >
                        <span className="shrink-0" style={{ color: "#555555" }}>{item.icon}</span>
                        {item.label}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="h-8 px-2.5 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors"
              onClick={() => { setProfileTab("home"); setProfileOpen(true); }}
              data-testid="button-user-menu"
            >
              {accountInfo?.firstName || username || "…"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 pb-28">
        <div className="flex items-center justify-between mb-1">
          <h1 className="font-lora text-xl font-bold tracking-tight text-foreground" data-testid="text-dashboard-title">
            {t("dashboard.myProjects")}
          </h1>
          <div className="flex items-center gap-2">
            {!selectMode && (
              <Button
                onClick={() => setShowNewDialog(true)}
                size="sm"
                className="gap-1.5"
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
                className="gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={enterSelectMode}
                data-testid="button-enter-select"
              >
                <CheckSquare className="w-4 h-4" />
                {t("dashboard.select")}
              </Button>
            )}
          </div>
        </div>
        <p className="text-muted-foreground mb-6">
          {t("dashboard.subtitle")}
        </p>

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
      {/* Edit username dialog */}
      <Dialog open={showEditUsername} onOpenChange={(open) => !open && setShowEditUsername(false)}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{t("auth.editUsername")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditUsernameSubmit} className="flex flex-col gap-4 mt-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                {t("auth.editUsernameLabel")}
              </label>
              <Input
                value={newUsername}
                onChange={(e) => { setNewUsername(e.target.value); setEditUsernameError(""); }}
                placeholder={t("auth.editUsernamePlaceholder")}
                autoFocus
                maxLength={32}
              />
              {editUsernameError && (
                <p className="mt-1.5 text-xs text-destructive">{editUsernameError}</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" size="sm"
                onClick={() => setShowEditUsername(false)}>
                {t("auth.editUsernameCancel")}
              </Button>
              <Button type="submit" size="sm" disabled={editUsernameLoading || !newUsername.trim()}>
                {editUsernameLoading ? "…" : t("auth.editUsernameSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Invite dialog */}
      <Dialog open={showInviteDialog} onOpenChange={(open) => !open && setShowInviteDialog(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <Gift className="w-4 h-4 text-[#4f82ff]" />
              {t("navbar.invitePanel.title")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-muted-foreground">{t("navbar.invitePanel.desc")}</p>
          {inviteLoading ? (
            <p className="text-[12px] text-muted-foreground py-2">{t("navbar.invitePanel.loading")}</p>
          ) : referralCode ? (
            <div className="flex flex-col gap-3 pt-1">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
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
          ) : null}
        </DialogContent>
      </Dialog>

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
                      className="relative flex items-center gap-2.5 px-4 cursor-pointer transition-colors shrink-0"
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
      {/* ── 个人主页弹窗 ── */}
      {profileOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setProfileOpen(false); }}
        >
          <div
            className="flex overflow-hidden w-full"
            style={{
              maxWidth: 760,
              minHeight: 500,
              margin: "0 16px",
              borderRadius: 16,
              background: "var(--panel-mid-bg)",
              border: "1px solid var(--panel-divider)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            {/* 左侧导航 */}
            <div className="flex flex-col shrink-0" style={{ width: 140, borderRight: "1px solid var(--panel-divider)", background: "var(--panel-left-bg)", padding: "20px 0 16px" }}>
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
                  className="w-full text-left text-[13px] px-5 py-2.5 transition-colors hover:bg-accent/10"
                  style={{
                    fontWeight: profileTab === tab ? 700 : 400,
                    color: profileTab === tab ? "var(--foreground)" : "var(--muted-foreground)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {tab === "home" ? "个人主页" : tab === "account" ? "账户信息" : "邀请礼遇"}
                </button>
              ))}
              <div className="flex-1" />
              <button
                onClick={handleSignOut}
                className="mx-3.5 py-2 rounded-lg text-[12px] font-semibold text-white transition-colors text-center"
                style={{ background: "#1a1a1a", border: "none", cursor: "pointer" }}
              >
                退出登录
              </button>
            </div>

            {/* 右侧内容 */}
            <div className="flex-1 overflow-y-auto" style={{ padding: "24px 28px 28px" }}>

              {/* ===== 个人主页 tab ===== */}
              {profileTab === "home" && (
                <div>
                  <p className="text-[15px] font-bold text-foreground mb-5">个人主页</p>
                  <div className="flex gap-5 items-start">
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
                            className="h-7 px-2.5 text-[12px] text-muted-foreground rounded-md outline-none"
                            style={{ width: 140, border: "1px solid var(--panel-divider)", background: "var(--panel-left-bg)" }}
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

                      {/* 姓氏 + 名字 — 三个输入框大小一致 */}
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] text-foreground shrink-0" style={{ width: 52 }}>姓氏：</span>
                        <Input value={lastName} onChange={(e) => { setLastName(e.target.value); setProfileDirty(true); }} onBlur={handleProfileBlurSave} className="h-7 text-[12px]" style={{ width: 140 }} maxLength={20} />
                        <span className="text-[13px] text-foreground shrink-0 ml-2">名字：</span>
                        <Input value={firstName} onChange={(e) => { setFirstName(e.target.value); setProfileDirty(true); }} onBlur={handleProfileBlurSave} className="h-7 text-[12px]" style={{ width: 140 }} maxLength={40} />
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
                      <span className={`flex-1 text-[13px] ${accountInfo?.githubId ? "text-green-700" : "text-muted-foreground/60"}`}>
                        {accountInfo?.githubId ? "已绑定" : "未绑定"}
                      </span>
                      {accountInfo?.githubId ? (
                        <button className="flex items-center gap-1 text-[12px] text-foreground hover:text-[#3a6ea8] transition-colors shrink-0" style={{ background: "none", border: "none", cursor: "pointer" }}>
                          <Pencil className="w-3 h-3" />解除绑定
                        </button>
                      ) : (
                        <button className="px-2.5 text-[12px] font-medium text-white rounded shrink-0" style={{ height: 24, background: "#3a6ea8", border: "none", cursor: "pointer" }}>
                          绑定 GitHub
                        </button>
                      )}
                    </div>

                    {/* 微信 */}
                    <div className="flex items-center gap-2 py-3">
                      <span className="text-[13px] text-muted-foreground shrink-0 w-[60px]">微信</span>
                      <span className="flex-1 text-[13px] text-muted-foreground/60">未绑定</span>
                      <button className="px-2.5 text-[12px] font-medium text-white rounded shrink-0" style={{ height: 24, background: "#3a6ea8", border: "none", cursor: "pointer" }}>
                        绑定微信
                      </button>
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
          </div>
        </div>
      )}

      {/* ── 密码弹窗 ── */}
      {showPwdDialog && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowPwdDialog(false); }}
        >
          <div className="w-full max-w-sm mx-4 rounded-2xl p-6 flex flex-col gap-4"
            style={{ background: "var(--panel-mid-bg)", border: "1px solid var(--panel-divider)", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">
                {pwdMode === "set" ? "设置密码" : pwdMode === "change" ? "修改密码" : "重置密码"}
              </h2>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowPwdDialog(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* set / change: step 1 */}
            {(pwdMode === "set" || pwdMode === "change") && (
              <div className="flex flex-col gap-3">
                {pwdMode === "change" && (
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-1 block">当前密码</label>
                    <Input type="password" value={pwdCurrent} onChange={(e) => setPwdCurrent(e.target.value)} placeholder="输入当前密码" className="h-9 text-[13px]" />
                  </div>
                )}
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">新密码</label>
                  <Input type="password" value={pwdNew} onChange={(e) => setPwdNew(e.target.value)} placeholder="至少6位" className="h-9 text-[13px]" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">确认新密码</label>
                  <Input type="password" value={pwdConfirm} onChange={(e) => setPwdConfirm(e.target.value)} placeholder="再次输入新密码" className="h-9 text-[13px]"
                    onKeyDown={(e) => e.key === "Enter" && handlePwdSubmit()} />
                </div>
                {pwdError && <p className="text-[12px] text-destructive">{pwdError}</p>}
                <div className="flex items-center justify-between pt-1">
                  {pwdMode === "change" && (
                    <button className="text-[12px] text-[#4f82ff] hover:underline" onClick={() => { setPwdMode("forgot"); setPwdStep(2); setPwdError(""); }}>
                      忘记密码？
                    </button>
                  )}
                  {pwdMode === "set" && <span />}
                  <Button size="sm" onClick={handlePwdSubmit} disabled={pwdLoading || !pwdNew || !pwdConfirm || (pwdMode === "change" && !pwdCurrent)} className="gap-1.5">
                    {pwdLoading ? "处理中…" : "确认"}
                  </Button>
                </div>
              </div>
            )}

            {/* forgot: step 2 — 选择验证方式 */}
            {pwdMode === "forgot" && pwdStep === 2 && (
              <div className="flex flex-col gap-3">
                <p className="text-[12px] text-muted-foreground">选择验证方式后，我们将发送验证码</p>
                <div className="flex gap-2">
                  {(["email", "sms"] as const).map((ch) => (
                    <button key={ch} onClick={() => setPwdForgotChannel(ch)}
                      className="flex-1 py-2 rounded-lg text-[12px] font-medium border transition-colors"
                      style={{ borderColor: pwdForgotChannel === ch ? "#4f82ff" : "var(--panel-divider)", background: pwdForgotChannel === ch ? "rgba(79,130,255,0.08)" : "transparent", color: pwdForgotChannel === ch ? "#4f82ff" : "var(--muted-foreground)" }}>
                      {ch === "email" ? "邮箱" : "手机号"}
                    </button>
                  ))}
                </div>
                <Input
                  value={pwdForgotTarget}
                  onChange={(e) => { setPwdForgotTarget(e.target.value); setPwdError(""); }}
                  placeholder={pwdForgotChannel === "email" ? "输入邮箱地址" : "输入手机号（含区号 +86）"}
                  className="h-9 text-[13px]"
                />
                {pwdError && <p className="text-[12px] text-destructive">{pwdError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setPwdMode("change"); setPwdStep(1); setPwdError(""); }}>取消</Button>
                  <Button size="sm" onClick={handlePwdSendOtp} disabled={pwdLoading || !pwdForgotTarget.trim()}>
                    {pwdLoading ? "发送中…" : "发送验证码"}
                  </Button>
                </div>
              </div>
            )}

            {/* forgot: step 3 — 输入验证码 */}
            {pwdMode === "forgot" && pwdStep === 3 && (
              <div className="flex flex-col gap-3">
                <p className="text-[12px] text-muted-foreground">验证码已发送至 <span className="font-medium text-foreground">{pwdForgotTarget}</span></p>
                <Input value={pwdForgotCode} onChange={(e) => setPwdForgotCode(e.target.value)} placeholder="输入6位验证码" className="h-9 text-[13px]" maxLength={6} />
                {pwdError && <p className="text-[12px] text-destructive">{pwdError}</p>}
                <div className="flex items-center justify-between">
                  <button className="text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                    disabled={pwdOtpCountdown > 0} onClick={handlePwdSendOtp}>
                    {pwdOtpCountdown > 0 ? `${pwdOtpCountdown}s 后重发` : "重新发送"}
                  </button>
                  <Button size="sm" onClick={handlePwdSubmit} disabled={pwdLoading || !/^\d{6}$/.test(pwdForgotCode)}>
                    {pwdLoading ? "验证中…" : "下一步"}
                  </Button>
                </div>
              </div>
            )}

            {/* forgot: step 4 — 设置新密码 */}
            {pwdMode === "forgot" && pwdStep === 4 && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">新密码</label>
                  <Input type="password" value={pwdNew} onChange={(e) => setPwdNew(e.target.value)} placeholder="至少6位" className="h-9 text-[13px]" />
                </div>
                {pwdError && <p className="text-[12px] text-destructive">{pwdError}</p>}
                <div className="flex justify-end">
                  <Button size="sm" onClick={handlePwdSubmit} disabled={pwdLoading || pwdNew.length < 6}>
                    {pwdLoading ? "处理中…" : "下一步"}
                  </Button>
                </div>
              </div>
            )}

            {/* forgot: step 5 — 确认新密码 */}
            {pwdMode === "forgot" && pwdStep === 5 && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">确认新密码</label>
                  <Input type="password" value={pwdConfirm} onChange={(e) => setPwdConfirm(e.target.value)} placeholder="再次输入新密码" className="h-9 text-[13px]"
                    onKeyDown={(e) => e.key === "Enter" && handlePwdSubmit()} />
                </div>
                {pwdError && <p className="text-[12px] text-destructive">{pwdError}</p>}
                <div className="flex justify-end">
                  <Button size="sm" onClick={handlePwdSubmit} disabled={pwdLoading || !pwdConfirm}>
                    {pwdLoading ? "重置中…" : "重置密码"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 绑定邮箱弹窗 ── */}
      {showEmailDialog && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowEmailDialog(false); }}
        >
          <div className="w-full max-w-sm mx-4 rounded-2xl p-6 flex flex-col gap-4"
            style={{ background: "var(--panel-mid-bg)", border: "1px solid var(--panel-divider)", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">{accountInfo?.email ? "更换邮箱" : "绑定邮箱"}</h2>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowEmailDialog(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {emailStep === 1 && (
              <div className="flex flex-col gap-3">
                <Input value={emailTarget} onChange={(e) => { setEmailTarget(e.target.value); setEmailError(""); }}
                  placeholder="输入邮箱地址" className="h-9 text-[13px]"
                  onKeyDown={(e) => e.key === "Enter" && handleEmailSendOtp()} />
                {emailError && <p className="text-[12px] text-destructive">{emailError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowEmailDialog(false)}>取消</Button>
                  <Button size="sm" onClick={handleEmailSendOtp} disabled={emailLoading || !emailTarget.trim()}>
                    {emailLoading ? "发送中…" : "发送验证码"}
                  </Button>
                </div>
              </div>
            )}

            {emailStep === 2 && (
              <div className="flex flex-col gap-3">
                <p className="text-[12px] text-muted-foreground">验证码已发送至 <span className="font-medium text-foreground">{emailTarget}</span></p>
                <Input value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder="输入6位验证码" className="h-9 text-[13px]" maxLength={6}
                  onKeyDown={(e) => e.key === "Enter" && handleEmailVerify()} />
                {emailError && <p className="text-[12px] text-destructive">{emailError}</p>}
                <div className="flex items-center justify-between">
                  <button className="text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                    disabled={emailOtpCountdown > 0} onClick={handleEmailSendOtp}>
                    {emailOtpCountdown > 0 ? `${emailOtpCountdown}s 后重发` : "重新发送"}
                  </button>
                  <Button size="sm" onClick={handleEmailVerify} disabled={emailLoading || !/^\d{6}$/.test(emailCode)}>
                    {emailLoading ? "验证中…" : "绑定"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 绑定手机号弹窗 ── */}
      {showPhoneDialog && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowPhoneDialog(false); }}
        >
          <div className="w-full max-w-sm mx-4 rounded-2xl p-6 flex flex-col gap-4"
            style={{ background: "var(--panel-mid-bg)", border: "1px solid var(--panel-divider)", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">{accountInfo?.phone ? "更换手机号" : "绑定手机号"}</h2>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowPhoneDialog(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {phoneStep === 1 && (
              <div className="flex flex-col gap-3">
                <p className="text-[12px] text-muted-foreground">请输入手机号（含国家区号，如 +86 开头）</p>
                <Input value={phoneTarget} onChange={(e) => { setPhoneTarget(e.target.value); setPhoneError(""); }}
                  placeholder="+86 13800000000" className="h-9 text-[13px]"
                  onKeyDown={(e) => e.key === "Enter" && handlePhoneSendOtp()} />
                {phoneError && <p className="text-[12px] text-destructive">{phoneError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowPhoneDialog(false)}>取消</Button>
                  <Button size="sm" onClick={handlePhoneSendOtp} disabled={phoneLoading || !phoneTarget.trim()}>
                    {phoneLoading ? "发送中…" : "发送验证码"}
                  </Button>
                </div>
              </div>
            )}

            {phoneStep === 2 && (
              <div className="flex flex-col gap-3">
                <p className="text-[12px] text-muted-foreground">验证码已发送至 <span className="font-medium text-foreground">{phoneTarget}</span></p>
                <Input value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} placeholder="输入6位验证码" className="h-9 text-[13px]" maxLength={6}
                  onKeyDown={(e) => e.key === "Enter" && handlePhoneVerify()} />
                {phoneError && <p className="text-[12px] text-destructive">{phoneError}</p>}
                <div className="flex items-center justify-between">
                  <button className="text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                    disabled={phoneOtpCountdown > 0} onClick={handlePhoneSendOtp}>
                    {phoneOtpCountdown > 0 ? `${phoneOtpCountdown}s 后重发` : "重新发送"}
                  </button>
                  <Button size="sm" onClick={handlePhoneVerify} disabled={phoneLoading || !/^\d{6}$/.test(phoneCode)}>
                    {phoneLoading ? "验证中…" : "绑定"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
