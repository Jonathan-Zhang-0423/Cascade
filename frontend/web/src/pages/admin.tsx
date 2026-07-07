import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import cascadeLogo from "../assets/cascade-logo.png";

interface BlockedIp {
  ip: string;
  reason: string;
  blockedAt: string;
  blockedUntil: string;
  remainingSec: number;
}

interface LockedUser {
  userId: string;
  username: string;
  email: string | null;
  failCount: number;
  lockedAt: string | null;
  lockedUntil: string;
  remainingSec: number;
}

type AdminTab = "waitlist" | "users" | "security" | "feedback" | "changelog";

interface AppUser {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  githubId: string | null;
  wechatOpenId: string | null;
  activated: boolean;
  authMethod: string;
  projectCount: number;
  lastActiveAt: string | null;
  trialExpiresAt: string | null;
  trialRemainingSec: number | null;
}

interface Subscriber {
  id: number;
  email: string;
  createdAt: string;
  isEdu: boolean;
  status: "pending" | "invited" | "email_failed";
  inviteCode: string | null;
  invitedAt: string | null;
  expiresAt: string | null;
  batchId: number | null;
  seqNum: number | null;
  registeredAt: string | null;
}

interface WaitlistData {
  total: number;
  subscribers: Subscriber[];
}

type FilterStatus = "all" | "pending" | "invited" | "email_failed";
type FilterType = "all" | "edu" | "qj" | "normal";

const FONT = '"Inter", "Helvetica Neue", system-ui, sans-serif';

function fmt(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtRemain(sec: number) {
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) return `${Math.ceil(sec / 60)}分钟`;
  return `${Math.ceil(sec / 3600)}小时`;
}

export default function AdminPage() {
  const [, navigate] = useLocation();
  const [data, setData] = useState<WaitlistData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState(false);
  const authChecked = useRef(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkMsgForm, setBulkMsgForm] = useState({
    open: false, subject: "", content: "", viaEmail: true, viaNotification: true,
  });
  const [bulkMsgSending, setBulkMsgSending] = useState(false);
  const [bulkMsgResult, setBulkMsgResult] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [activeTab, setActiveTab] = useState<AdminTab>("waitlist");

  // Users panel state
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [usersSearch, setUsersSearch] = useState("");
  // 点击表头列名后弹出的筛选菜单：当前激活的列 + 每列已选值集合。
  const [openHeader, setOpenHeader] = useState<string | null>(null);
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});

  // Security panel state
  const [blockedIps, setBlockedIps] = useState<BlockedIp[]>([]);
  const [lockedUsers, setLockedUsers] = useState<LockedUser[]>([]);
  const [secLoading, setSecLoading] = useState(false);
  const [secMsg, setSecMsg] = useState("");
  const [secError, setSecError] = useState("");
  const [secFilter, setSecFilter] = useState<"all" | "ip" | "user">("all");

  // Feedback panel state
  const [feedbackItems, setFeedbackItems] = useState<{id:number;content:string;source:string;createdAt:string;username:string|null;email:string|null;phone:string|null;repliedAt:string|null;replyContent:string|null}[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackSourceFilter, setFeedbackSourceFilter] = useState<"all"|"pc"|"mobile"|"qiji">("all");
  const [replyTarget, setReplyTarget] = useState<number|null>(null);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyMsg, setReplyMsg] = useState("");

  // Changelog panel state
  const [changelogItems, setChangelogItems] = useState<{id:number;version:string|null;title:string;content:string;publishedAt:string;isPublished:boolean}[]>([]);
  const [changelogLoading, setChangelogLoading] = useState(false);
  const [changelogError, setChangelogError] = useState("");
  const [changelogMsg, setChangelogMsg] = useState("");
  const [changelogForm, setChangelogForm] = useState<{open:boolean;editId:number|null;version:string;title:string;content:string;isPublished:boolean}>({open:false,editId:null,version:"",title:"",content:"",isPublished:false});
  const [changelogSaving, setChangelogSaving] = useState(false);
  const [secSearch, setSecSearch] = useState("");
  const [manualIp, setManualIp] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  // OTP limit panel state
  const [otpTarget, setOtpTarget] = useState("");
  const [otpRecords, setOtpRecords] = useState<{ id: number; channel: string; purpose: string; attempts: number; expiresAt: string; consumedAt: string | null; createdAt: string }[]>([]);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpMsg, setOtpMsg] = useState("");
  const [otpError, setOtpError] = useState("");

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/waitlist", { credentials: "include" });
    if (res.status === 401 || res.status === 403) {
      navigate("/admin/login");
      throw new Error("未登录");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? "Something went wrong.");
    }
    return res.json() as Promise<WaitlistData>;
  }, [navigate]);

  // JWT 鉴权检查：挂载时调用 /me，未登录跳转登录页
  useEffect(() => {
    if (authChecked.current) return;
    authChecked.current = true;
    fetch("/api/admin/auth/me", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) { navigate("/admin/login"); return; }
        // 已登录，加载 waitlist 数据
        try {
          const json = await fetchData();
          setData(json);
          setAuthed(true);
        } catch {
          // fetchData 内部已处理跳转
        }
      })
      .catch(() => navigate("/admin/login"));
  }, [navigate, fetchData]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
  }

  async function handleRefresh() {
    setLoading(true);
    setError("");
    try {
      setData(await fetchData());
      setSelected(new Set());
      setSendResult("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reach the server.");
    } finally {
      setLoading(false);
    }
  }

  // ── Users handlers ─────────────────────────────────────────────────────────
  async function fetchUsers() {
    setUsersLoading(true); setUsersError("");
    try {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (!res.ok) throw new Error("加载失败");
      const json = await res.json();
      setAppUsers(json.items ?? []);
    } catch {
      setUsersError("加载失败，请重试");
    } finally {
      setUsersLoading(false);
    }
  }

  // ── Feedback handlers ─────────────────────────────────────────────────────
  async function fetchFeedback() {
    setFeedbackLoading(true); setFeedbackError("");
    try {
      const res = await fetch("/api/admin/feedback", { credentials: "include" });
      if (!res.ok) throw new Error("加载失败");
      const json = await res.json();
      setFeedbackItems(json.feedback ?? []);
    } catch {
      setFeedbackError("加载失败，请重试");
    } finally {
      setFeedbackLoading(false);
    }
  }

  async function sendFeedbackReply(feedbackId: number) {
    if (!replyText.trim()) return;
    setReplySending(true); setReplyMsg("");
    const msgContent = replyText.trim();
    try {
      const res = await fetch(`/api/admin/feedback/${feedbackId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: msgContent }),
      });
      if (!res.ok) throw new Error("发送失败");
      // 立即更新本地状态，不需要刷新页面
      setFeedbackItems((prev) => prev.map((item) =>
        item.id === feedbackId
          ? { ...item, repliedAt: new Date().toISOString(), replyContent: msgContent }
          : item
      ));
      setReplyMsg("已发送通知给用户");
      setReplyTarget(null);
      setReplyText("");
      setTimeout(() => setReplyMsg(""), 2000);
    } catch {
      setReplyMsg("发送失败，请重试");
    } finally {
      setReplySending(false);
    }
  }

  // ── Changelog handlers ─────────────────────────────────────────────────────
  async function fetchChangelog() {
    setChangelogLoading(true); setChangelogError("");
    try {
      const res = await fetch("/api/admin/changelog", { credentials: "include" });
      if (!res.ok) throw new Error("加载失败");
      const json = await res.json();
      setChangelogItems(json.entries ?? []);
    } catch {
      setChangelogError("加载失败，请重试");
    } finally {
      setChangelogLoading(false);
    }
  }

  async function saveChangelogEntry() {
    if (!changelogForm.title.trim() || !changelogForm.content.trim()) return;
    setChangelogSaving(true); setChangelogError("");
    try {
      const url = changelogForm.editId ? `/api/admin/changelog/${changelogForm.editId}` : "/api/admin/changelog";
      const method = changelogForm.editId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ version: changelogForm.version.trim() || undefined, title: changelogForm.title.trim(), content: changelogForm.content.trim(), isPublished: changelogForm.isPublished }),
      });
      if (!res.ok) throw new Error("保存失败");
      setChangelogForm({ open: false, editId: null, version: "", title: "", content: "", isPublished: false });
      setChangelogMsg(changelogForm.editId ? "已更新" : "已新增");
      setTimeout(() => setChangelogMsg(""), 2000);
      await fetchChangelog();
    } catch {
      setChangelogError("保存失败，请重试");
    } finally {
      setChangelogSaving(false);
    }
  }

  async function deleteChangelogEntry(id: number) {
    if (!window.confirm("确认删除该条目？")) return;
    try {
      const res = await fetch(`/api/admin/changelog/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("删除失败");
      setChangelogItems((prev) => prev.filter((e) => e.id !== id));
      setChangelogMsg("已删除"); setTimeout(() => setChangelogMsg(""), 2000);
    } catch { setChangelogError("删除失败"); }
  }

  async function notifyChangelog(id: number) {
    if (!window.confirm("确认向所有用户推送该更新通知？")) return;
    try {
      const res = await fetch(`/api/admin/changelog/${id}/notify`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("推送失败");
      const json = await res.json();
      // 推送成功后自动标记为已发布
      await fetch(`/api/admin/changelog/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isPublished: true }),
      });
      setChangelogItems((prev) => prev.map((e) => e.id === id ? { ...e, isPublished: true } : e));
      setChangelogMsg(`已推送通知给 ${json.sent} 位用户`);
      setTimeout(() => setChangelogMsg(""), 3000);
    } catch { setChangelogError("推送失败，请重试"); }
  }

  async function toggleChangelogPublished(item: {id:number;isPublished:boolean}) {
    try {
      const res = await fetch(`/api/admin/changelog/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isPublished: !item.isPublished }),
      });
      if (!res.ok) throw new Error("操作失败");
      setChangelogItems((prev) => prev.map((e) => e.id === item.id ? { ...e, isPublished: !e.isPublished } : e));
    } catch { setChangelogError("操作失败"); }
  }

  // ── Security handlers ──────────────────────────────────────────────────────
  async function fetchSecurity() {
    setSecLoading(true); setSecError("");
    try {
      const [ipRes, userRes] = await Promise.all([
        fetch("/api/admin/blocklist/ip", { credentials: "include" }),
        fetch("/api/admin/blocklist/users", { credentials: "include" }),
      ]);
      const ipData = await ipRes.json();
      const userData = await userRes.json();
      setBlockedIps(ipData.items ?? []);
      setLockedUsers(userData.items ?? []);
    } catch {
      setSecError("加载失败，请重试");
    } finally {
      setSecLoading(false);
    }
  }

  async function handleUnblockIp(ip: string) {
    setSecError(""); setSecMsg("");
    try {
      const res = await fetch(`/api/admin/blocklist/ip/${encodeURIComponent(ip)}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) throw new Error("解除失败");
      setSecMsg(`IP ${ip} 已解除封禁`);
      fetchSecurity();
    } catch (err) {
      setSecError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleUnlockUser(userId: string, username: string) {
    setSecError(""); setSecMsg("");
    try {
      const res = await fetch(`/api/admin/blocklist/users/${userId}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) throw new Error("解除失败");
      setSecMsg(`账号 ${username} 已解除锁定`);
      fetchSecurity();
    } catch (err) {
      setSecError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleManualBlockIp(e: React.FormEvent) {
    e.preventDefault();
    if (!manualIp.trim()) return;
    setSecError(""); setSecMsg("");
    try {
      const res = await fetch("/api/admin/blocklist/ip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ip: manualIp.trim(), durationHours: 1, reason: manualReason.trim() || "手动封禁" }),
      });
      if (!res.ok) throw new Error("封禁失败");
      setSecMsg(`IP ${manualIp.trim()} 已封禁 1 小时`);
      setManualIp(""); setManualReason("");
      fetchSecurity();
    } catch (err) {
      setSecError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleFetchOtp() {
    if (!otpTarget.trim()) return;
    setOtpLoading(true); setOtpError(""); setOtpMsg("");
    try {
      const res = await fetch(`/api/admin/otp-limit/${encodeURIComponent(otpTarget.trim().toLowerCase())}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("查询失败");
      const json = await res.json();
      setOtpRecords(json.items ?? []);
    } catch {
      setOtpError("查询失败，请重试");
    } finally {
      setOtpLoading(false);
    }
  }

  async function handleClearOtp() {
    if (!otpTarget.trim()) return;
    setOtpLoading(true); setOtpError(""); setOtpMsg("");
    try {
      const res = await fetch(`/api/admin/otp-limit/${encodeURIComponent(otpTarget.trim().toLowerCase())}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("清除失败");
      const json = await res.json();
      setOtpMsg(`已清除 ${json.deleted} 条 OTP 记录，限制已解除`);
      setOtpRecords([]);
    } catch {
      setOtpError("清除失败，请重试");
    } finally {
      setOtpLoading(false);
    }
  }

  // Load security data when switching to security tab
  useEffect(() => {
    if (authed && activeTab === "security") fetchSecurity();
  }, [authed, activeTab]);

  // Load users when switching to users tab
  useEffect(() => {
    if (authed && activeTab === "users") fetchUsers();
  }, [authed, activeTab]);

  useEffect(() => {
    if (authed && activeTab === "feedback") fetchFeedback();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab]);

  useEffect(() => {
    if (authed && activeTab === "changelog") fetchChangelog();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeTab]);

  // 点击页面任意处关闭表头筛选下拉。
  useEffect(() => {
    if (!openHeader) return;
    const close = () => setOpenHeader(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openHeader]);

  async function handleSendInvites() {
    if (selected.size === 0) return;
    setSending(true);
    setSendResult("");
    setError("");
    try {
      const res = await fetch("/api/admin/send-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to send invites");
      setSendResult(`Sent ${body.sent} invite${body.sent !== 1 ? "s" : ""} successfully.`);
      setSelected(new Set());
      await handleRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invites");
    } finally {
      setSending(false);
    }
  }

  async function handleExportCSV() {
    try {
      const res = await fetch("/api/admin/export-csv", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `waitlist_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export CSV");
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  // ── Users: 列定义 + 每行在该列的“分类值”（点击表头按这些值筛选）──────────────
  // value(u) 返回该用户在此列的分类标签；筛选时按标签精确匹配。
  const userColumns: { key: string; label: string; value: (u: AppUser) => string }[] = [
    { key: "user", label: "用户", value: (u) => u.username },
    {
      key: "type", label: "类型",
      value: (u) => {
        const e = (u.email ?? "").toLowerCase();
        if (e.endsWith("@miracleplus.com")) return "奇迹";
        if (e.endsWith(".edu") || e.endsWith(".edu.cn")) return "EDU";
        return "普通";
      },
    },
    { key: "auth", label: "注册方式", value: (u) => ({ github: "GitHub", email: "邮箱", phone: "手机", other: "其他" } as Record<string, string>)[u.authMethod] ?? u.authMethod },
    { key: "activated", label: "状态", value: (u) => (u.activated ? "已激活" : "未激活") },
    { key: "projects", label: "项目数", value: (u) => String(u.projectCount) },
    { key: "trial", label: "免费期", value: (u) => (u.trialRemainingSec == null ? "无" : u.trialRemainingSec <= 0 ? "已过期" : "试用中") },
  ];
  const userColByKey = Object.fromEntries(userColumns.map((c) => [c.key, c]));

  // 某列的全部可选分类值（去重、稳定排序），供表头下拉展示。
  function colOptions(key: string): string[] {
    const col = userColByKey[key];
    if (!col) return [];
    return Array.from(new Set(appUsers.map((u) => col.value(u)))).sort();
  }

  // 应用搜索 + 所有列的多选筛选。
  const filteredUsers = appUsers.filter((u) => {
    if (usersSearch) {
      const q = usersSearch.toLowerCase();
      const hit = u.username.toLowerCase().includes(q)
        || (u.email ?? "").toLowerCase().includes(q)
        || (u.phone ?? "").toLowerCase().includes(q);
      if (!hit) return false;
    }
    for (const [key, sel] of Object.entries(colFilters)) {
      if (sel.size === 0) continue;
      const col = userColByKey[key];
      if (col && !sel.has(col.value(u))) return false;
    }
    return true;
  });

  // 切换某列某个分类值的选中状态。
  function toggleColFilter(key: string, val: string) {
    setColFilters((prev) => {
      const next = { ...prev };
      const set = new Set(next[key] ?? []);
      set.has(val) ? set.delete(val) : set.add(val);
      next[key] = set;
      return next;
    });
  }
  function clearColFilter(key: string) {
    setColFilters((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }

  async function handleSendBulkMessage() {
    if (selected.size === 0 || !bulkMsgForm.content.trim()) return;
    setBulkMsgSending(true);
    setBulkMsgResult("");
    try {
      const res = await fetch("/api/admin/bulk-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subscriberIds: Array.from(selected),
          subject: bulkMsgForm.subject.trim(),
          content: bulkMsgForm.content.trim(),
          viaEmail: bulkMsgForm.viaEmail,
          viaNotification: bulkMsgForm.viaNotification,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "发送失败");
      setBulkMsgResult(
        `邮件已发送 ${body.emailSent} 封${body.emailFailed > 0 ? `（失败 ${body.emailFailed} 封）` : ""}，站内通知已发送 ${body.notificationSent} 条${body.notificationSkipped > 0 ? `（跳过未注册 ${body.notificationSkipped} 人）` : ""}`
      );
      setSelected(new Set());
      setBulkMsgForm({ open: false, subject: "", content: "", viaEmail: true, viaNotification: true });
    } catch (err) {
      setBulkMsgResult(err instanceof Error ? err.message : "发送失败，请重试");
    } finally {
      setBulkMsgSending(false);
    }
  }

  const filtered = (data?.subscribers ?? []).filter((s) => {
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    if (filterType === "edu" && !s.isEdu) return false;
    if (filterType === "qj" && !s.email.toLowerCase().endsWith("@miracleplus.com")) return false;
    if (filterType === "normal" && (s.isEdu || s.email.toLowerCase().endsWith("@miracleplus.com"))) return false;
    if (search && !s.email.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const allSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((s) => next.delete(s.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((s) => next.add(s.id));
        return next;
      });
    }
  }

  const selectedRegisteredCount = filtered.filter((s) => selected.has(s.id) && s.registeredAt).length;

  return (
    <div
      className="min-h-screen w-full overflow-x-hidden"
      style={{
        fontFamily: FONT,
        background: "white",
      }}
    >
      {/* subtle radial glow top-center, matching landing hero */}
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
        <div className="max-w-6xl mx-auto px-8 h-20 flex items-center justify-between">
          <img src={cascadeLogo} alt="Cascade AI" className="h-8 w-auto object-contain" />
          {authed && (
            <span className="text-xs text-gray-400 font-medium tracking-wide uppercase">Admin</span>
          )}
        </div>
      </header>

      <div className="relative z-10 max-w-6xl mx-auto px-6 pt-36 pb-20">

        {/* Loading state while auth check runs */}
        {!authed && (
          <div className="min-h-[60vh] flex items-center justify-center">
            <p className="text-gray-400 text-[14px]">验证登录状态…</p>
          </div>
        )}

        {/* Dashboard */}
        {authed && data && (
          <>
            {/* Tab switcher */}
            <div className="flex gap-1 mb-8 border-b border-black/[0.07]">
              {([["waitlist", "Waitlist"], ["users", "用户"], ["security", "安全管理"], ["feedback", "用户建议"], ["changelog", "更新看板"]] as [AdminTab, string][]).map(([tab, label]) => {
                const unrepliedCount = tab === "feedback" ? feedbackItems.filter(f => !f.repliedAt).length : 0;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`relative px-5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-all ${
                      activeTab === tab ? "border-black text-black" : "border-transparent text-gray-400 hover:text-gray-700"
                    }`}
                  >
                    {label}
                    {unrepliedCount > 0 && (
                      <span
                        className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white font-bold"
                        style={{ background: "#ef4444", fontSize: 9, minWidth: 14, height: 14, padding: "0 3px" }}
                      >
                        {unrepliedCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Page title row */}
            <div className="flex items-end justify-between mb-10">
              <div>
                <h1
                  className="font-bold text-black leading-tight"
                  style={{ fontSize: "clamp(28px, 4vw, 40px)", fontFamily: FONT }}
                >
                  {activeTab === "waitlist" ? "Waitlist" : activeTab === "users" ? "用户" : activeTab === "feedback" ? "用户建议" : activeTab === "changelog" ? "更新看板" : "安全管理"}
                </h1>
                {activeTab === "waitlist" && (
                  <p className="text-gray-500 text-[14px] mt-1">cascadeai.co · {data.total} subscribers</p>
                )}
                {activeTab === "users" && (
                  <p className="text-gray-500 text-[14px] mt-1">共 {appUsers.length} 人 · 已激活 {appUsers.filter((u) => u.activated).length} 人</p>
                )}
                {activeTab === "security" && (
                  <p className="text-gray-500 text-[14px] mt-1">IP 封禁 {blockedIps.length} 条 · 账号锁定 {lockedUsers.length} 条</p>
                )}
                {activeTab === "changelog" && (
                  <p className="text-gray-500 text-[14px] mt-1">共 {changelogItems.length} 条 · 已发布 {changelogItems.filter((e) => e.isPublished).length} 条</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {activeTab === "users" && (
                  <button
                    onClick={fetchUsers}
                    disabled={usersLoading}
                    className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.1)", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}
                  >
                    {usersLoading ? "刷新中…" : "刷新"}
                  </button>
                )}
                {activeTab === "waitlist" && (
                  <>
                    <button
                      onClick={handleRefresh}
                      disabled={loading}
                      className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40"
                      style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.1)", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}
                    >
                      {loading ? "Refreshing…" : "Refresh"}
                    </button>
                    <button
                      onClick={() => setBulkMsgForm((f) => ({ ...f, open: true }))}
                      disabled={selected.size === 0}
                      className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all hover:opacity-85 active:scale-[0.97] disabled:opacity-40"
                      style={{ background: "#111827", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}
                    >
                      群发消息 {selected.size > 0 ? `(${selected.size})` : ""}
                    </button>
                    <button
                      onClick={handleExportCSV}
                      className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all hover:opacity-85 active:scale-[0.97]"
                      style={{ background: "#111827", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}
                    >
                      Export CSV
                    </button>
                  </>
                )}
                {activeTab === "security" && (
                  <button
                    onClick={fetchSecurity}
                    disabled={secLoading}
                    className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.1)", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}
                  >
                    {secLoading ? "刷新中…" : "刷新"}
                  </button>
                )}
                {activeTab === "changelog" && (
                  <>
                    <button
                      onClick={fetchChangelog}
                      disabled={changelogLoading}
                      className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40"
                      style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.1)", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}
                    >
                      {changelogLoading ? "刷新中…" : "刷新"}
                    </button>
                    <button
                      onClick={() => setChangelogForm({ open: true, editId: null, version: "", title: "", content: "", isPublished: true })}
                      className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all hover:opacity-85 active:scale-[0.97]"
                      style={{ background: "#111827", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}
                    >
                      + 新增
                    </button>
                  </>
                )}
              </div>
            </div>

            {error && <p className="mb-4 text-[13px] text-red-500">{error}</p>}
            {sendResult && <p className="mb-4 text-[13px] text-green-600 font-medium">{sendResult}</p>}

            {/* ── Waitlist tab ─────────────────────────────────────────── */}
            {activeTab === "waitlist" && (<>
            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Total", value: data.total },
                { label: "Pending", value: data.subscribers.filter((s) => s.status === "pending").length },
                { label: "Invited", value: data.subscribers.filter((s) => s.status === "invited").length },
                { label: "EDU", value: data.subscribers.filter((s) => s.isEdu).length },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl px-6 py-5"
                  style={{
                    background: "rgba(255,255,255,0.9)",
                    border: "1px solid rgba(0,0,0,0.07)",
                    boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
                  }}
                >
                  <p className="text-3xl font-bold text-black tracking-tight">{stat.value}</p>
                  <p className="text-[12px] text-gray-400 mt-1 font-medium uppercase tracking-wide">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Filters + Send */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email…"
                className="px-3 py-2.5 rounded-xl text-[13px] outline-none w-52"
                style={{
                  fontFamily: FONT,
                  background: "rgba(255,255,255,0.9)",
                  border: "1px solid rgba(0,0,0,0.10)",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
                  color: "#111827",
                }}
              />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                className="px-3 py-2.5 rounded-xl text-[13px] outline-none"
                style={{
                  fontFamily: FONT,
                  background: "rgba(255,255,255,0.9)",
                  border: "1px solid rgba(0,0,0,0.10)",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
                }}
              >
                <option value="all" style={{ fontFamily: FONT }}>All status</option>
                <option value="pending" style={{ fontFamily: FONT }}>Pending</option>
                <option value="invited" style={{ fontFamily: FONT }}>Invited</option>
                <option value="email_failed" style={{ fontFamily: FONT }}>Email Failed</option>
              </select>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as FilterType)}
                className="px-3 py-2.5 rounded-xl text-[13px] outline-none"
                style={{
                  fontFamily: FONT,
                  background: "rgba(255,255,255,0.9)",
                  border: "1px solid rgba(0,0,0,0.10)",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
                }}
              >
                <option value="all" style={{ fontFamily: FONT }}>All types</option>
                <option value="normal" style={{ fontFamily: FONT }}>Normal</option>
                <option value="edu" style={{ fontFamily: FONT }}>EDU</option>
                <option value="qj" style={{ fontFamily: FONT }}>QJ</option>
              </select>

              <div className="ml-auto flex items-center gap-3">
                {selected.size > 0 && (
                  <span className="text-[13px] text-gray-500">
                    <strong className="text-black">{selected.size}</strong> selected
                  </span>
                )}
                <button
                  onClick={handleSendInvites}
                  disabled={selected.size === 0 || sending}
                  className="px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all hover:opacity-85 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ fontFamily: FONT, background: "#111827", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}
                >
                  {sending ? "Sending…" : `Send Invite${selected.size > 1 ? "s" : ""}${selected.size > 0 ? ` (${selected.size})` : ""}`}
                </button>
              </div>
            </div>

            {bulkMsgResult && <p className="mb-4 text-[13px] text-green-600 font-medium">{bulkMsgResult}</p>}

            {/* 群发消息面板 */}
            {bulkMsgForm.open && (
              <div className="rounded-2xl p-5 flex flex-col gap-3 mb-5" style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 20px rgba(0,0,0,0.05)" }}>
                <p className="text-[13px] text-gray-500">
                  已选 <strong className="text-black">{selected.size}</strong> 位用户，其中 <strong className="text-black">{selectedRegisteredCount}</strong> 位已注册（可收到站内通知，其余仅能收到邮件）
                </p>
                <input
                  type="text"
                  value={bulkMsgForm.subject}
                  onChange={(e) => setBulkMsgForm((f) => ({ ...f, subject: e.target.value }))}
                  placeholder="标题"
                  className="px-3 py-2.5 rounded-xl text-[13px] outline-none"
                  style={{ fontFamily: FONT, background: "white", border: "1px solid rgba(0,0,0,0.10)", color: "#111827" }}
                />
                <textarea
                  value={bulkMsgForm.content}
                  onChange={(e) => setBulkMsgForm((f) => ({ ...f, content: e.target.value }))}
                  placeholder="正文内容…"
                  rows={5}
                  className="px-3 py-2.5 rounded-xl text-[13px] outline-none resize-none"
                  style={{ fontFamily: FONT, background: "white", border: "1px solid rgba(0,0,0,0.10)", color: "#111827" }}
                />
                <div className="flex items-center gap-5">
                  <label className="flex items-center gap-2 text-[13px] text-gray-700">
                    <input
                      type="checkbox"
                      checked={bulkMsgForm.viaEmail}
                      onChange={(e) => setBulkMsgForm((f) => ({ ...f, viaEmail: e.target.checked }))}
                      className="rounded"
                    />
                    发邮件
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-gray-700">
                    <input
                      type="checkbox"
                      checked={bulkMsgForm.viaNotification}
                      onChange={(e) => setBulkMsgForm((f) => ({ ...f, viaNotification: e.target.checked }))}
                      className="rounded"
                    />
                    发站内通知
                  </label>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <button
                    onClick={handleSendBulkMessage}
                    disabled={bulkMsgSending || !bulkMsgForm.content.trim() || (!bulkMsgForm.viaEmail && !bulkMsgForm.viaNotification)}
                    className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all hover:opacity-85 active:scale-[0.97] disabled:opacity-40"
                    style={{ background: "#111827", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}
                  >
                    {bulkMsgSending ? "发送中，请勿关闭页面…" : "发送"}
                  </button>
                  <button
                    onClick={() => setBulkMsgForm({ open: false, subject: "", content: "", viaEmail: true, viaNotification: true })}
                    disabled={bulkMsgSending}
                    className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.1)" }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* Table */}
            {filtered.length === 0 ? (
              <div className="text-center py-20 text-gray-400 text-[14px]">No subscribers found.</div>
            ) : (
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.9)",
                  border: "1px solid rgba(0,0,0,0.07)",
                  boxShadow: "0 2px 20px rgba(0,0,0,0.05)",
                }}
              >
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.015)" }}>
                      <th className="px-5 py-3.5 text-left w-10">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          className="rounded"
                        />
                      </th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Email</th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Type</th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Invite Code</th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Joined</th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Expires</th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Registered</th>
                      <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Batch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s, i) => (
                      <tr
                        key={s.id}
                        style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }}
                        className={selected.has(s.id) ? "bg-gray-50/80" : "hover:bg-gray-50/40 transition-colors"}
                      >
                        <td className="px-5 py-3.5">
                          <input
                            type="checkbox"
                            checked={selected.has(s.id)}
                            onChange={() => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                                return next;
                              });
                            }}
                            className="rounded"
                          />
                        </td>
                        <td className="px-5 py-3.5 font-medium text-gray-900">{s.email}</td>
                        <td className="px-5 py-3.5">
                          <span
                            className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                            style={s.isEdu
                              ? { background: "rgba(99,102,241,0.08)", color: "#4f46e5" }
                              : { background: "rgba(0,0,0,0.05)", color: "#374151" }}
                          >
                            {s.isEdu ? "EDU" : "Normal"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                            style={
                              s.status === "invited"
                                ? { background: "rgba(34,197,94,0.08)", color: "#16a34a" }
                                : s.status === "email_failed"
                                ? { background: "rgba(239,68,68,0.08)", color: "#dc2626" }
                                : { background: "rgba(234,179,8,0.08)", color: "#a16207" }
                            }
                          >
                            {s.status === "invited" ? "Invited" : s.status === "email_failed" ? "Email Failed" : "Pending"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 font-mono text-gray-500 text-[12px]">{s.inviteCode ?? "—"}</td>
                        <td className="px-5 py-3.5 text-gray-400 text-[12px]">{formatDate(s.createdAt)}</td>
                        <td className="px-5 py-3.5 text-gray-400 text-[12px]">{s.expiresAt ? formatDate(s.expiresAt) : "—"}</td>
                        <td className="px-5 py-3.5 text-[12px]">
                          {s.registeredAt
                            ? <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: "rgba(34,197,94,0.08)", color: "#16a34a" }}>{formatDate(s.registeredAt)}</span>
                            : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-3.5 text-gray-400 text-[12px]">{s.batchId ? `#${s.batchId}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </>)} {/* end waitlist tab */}

            {/* ── Users tab ────────────────────────────────────────────── */}
            {activeTab === "users" && (
              <div className="flex flex-col gap-5">
                {usersError && <p className="text-[13px] text-red-500">{usersError}</p>}

                {/* Search + active filter chips */}
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    value={usersSearch}
                    onChange={(e) => setUsersSearch(e.target.value)}
                    placeholder="搜索用户名 / 邮箱 / 手机…"
                    className="px-3 py-2.5 rounded-xl text-[13px] outline-none w-64"
                    style={{ fontFamily: FONT, background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)", color: "#111827" }}
                  />
                  {Object.entries(colFilters).flatMap(([key, sel]) =>
                    Array.from(sel).map((val) => (
                      <button
                        key={`${key}:${val}`}
                        onClick={() => toggleColFilter(key, val)}
                        className="px-2.5 py-1 rounded-full text-[12px] font-medium text-gray-700 flex items-center gap-1.5 hover:bg-gray-100 transition-colors"
                        style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.10)" }}
                      >
                        <span className="text-gray-400">{userColByKey[key]?.label}:</span> {val}
                        <span className="text-gray-400">✕</span>
                      </button>
                    ))
                  )}
                  <span className="ml-auto text-[13px] text-gray-500">
                    <strong className="text-black">{filteredUsers.length}</strong> / {appUsers.length}
                  </span>
                </div>

                {/* Table */}
                {appUsers.length === 0 ? (
                  <div className="text-center py-20 text-gray-400 text-[14px]">{usersLoading ? "加载中…" : "暂无用户"}</div>
                ) : (
                  <div className="rounded-2xl overflow-visible" style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 20px rgba(0,0,0,0.05)" }}>
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.015)" }}>
                          {userColumns.map((col) => {
                            const sel = colFilters[col.key];
                            const activeCount = sel?.size ?? 0;
                            return (
                              <th key={col.key} className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider relative">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setOpenHeader(openHeader === col.key ? null : col.key); }}
                                  className="flex items-center gap-1.5 hover:text-gray-700 transition-colors uppercase"
                                >
                                  {col.label}
                                  {activeCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold normal-case" style={{ background: "rgba(0,0,0,0.08)", color: "#111" }}>{activeCount}</span>
                                  )}
                                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" className="opacity-50"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                </button>
                                {openHeader === col.key && (
                                  <div className="absolute left-3 top-full mt-1 z-20 min-w-[160px] rounded-xl py-1.5 normal-case"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ background: "white", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 8px 28px rgba(0,0,0,0.14)" }}>
                                    <div className="flex items-center justify-between px-3 py-1.5">
                                      <span className="text-[11px] font-semibold text-gray-400">筛选{col.label}</span>
                                      {activeCount > 0 && (
                                        <button onClick={() => clearColFilter(col.key)} className="text-[11px] text-gray-400 hover:text-gray-700">清除</button>
                                      )}
                                    </div>
                                    <div className="max-h-60 overflow-y-auto">
                                      {colOptions(col.key).map((opt) => {
                                        const checked = sel?.has(opt) ?? false;
                                        const n = appUsers.filter((u) => col.value(u) === opt).length;
                                        return (
                                          <button
                                            key={opt}
                                            onClick={() => toggleColFilter(col.key, opt)}
                                            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors text-left"
                                          >
                                            <span className="w-3.5 h-3.5 rounded flex items-center justify-center shrink-0" style={{ border: checked ? "none" : "1.5px solid rgba(0,0,0,0.25)", background: checked ? "#111" : "transparent" }}>
                                              {checked && <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                            </span>
                                            <span className="flex-1 font-medium normal-case">{opt}</span>
                                            <span className="text-gray-400">{n}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </th>
                            );
                          })}
                          <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">最后活跃</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((u, i) => (
                          <tr key={u.id} style={{ borderBottom: i < filteredUsers.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }} className="hover:bg-gray-50/40 transition-colors">
                            <td className="px-5 py-3.5">
                              <div className="font-medium text-gray-900">{u.username}</div>
                              <div className="text-gray-400 text-[12px]">{u.email ?? u.phone ?? "—"}</div>
                            </td>
                            <td className="px-5 py-3.5">
                              {(() => {
                                const cat = userColByKey["type"].value(u);
                                const style = cat === "奇迹" ? { background: "rgba(168,85,247,0.08)", color: "#9333ea" }
                                  : cat === "EDU" ? { background: "rgba(99,102,241,0.08)", color: "#4f46e5" }
                                  : { background: "rgba(0,0,0,0.05)", color: "#374151" };
                                return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold" style={style}>{cat}</span>;
                              })()}
                            </td>
                            <td className="px-5 py-3.5 text-gray-600">
                              <div className="flex items-center gap-1 flex-wrap">
                                {u.phone && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: "rgba(34,197,94,0.08)", color: "#16a34a" }}>📱</span>}
                                {u.email && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: "rgba(99,102,241,0.08)", color: "#4f46e5" }}>📧</span>}
                                {u.githubId && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: "rgba(0,0,0,0.06)", color: "#333" }}>GH</span>}
                                {u.wechatOpenId && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: "rgba(34,197,94,0.08)", color: "#07c160" }}>微信</span>}
                              </div>
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold" style={u.activated ? { background: "rgba(34,197,94,0.08)", color: "#16a34a" } : { background: "rgba(234,179,8,0.08)", color: "#a16207" }}>
                                {u.activated ? "已激活" : "未激活"}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-gray-900 font-medium">{u.projectCount}</td>
                            <td className="px-5 py-3.5">
                              {u.trialRemainingSec == null ? (
                                <span className="text-gray-400 text-[12px]">无</span>
                              ) : u.trialRemainingSec <= 0 ? (
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626" }}>已过期</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: "rgba(34,197,94,0.08)", color: "#16a34a" }}>剩 {fmtRemain(u.trialRemainingSec)}</span>
                              )}
                            </td>
                            <td className="px-5 py-3.5 text-gray-400 text-[12px]">{u.lastActiveAt ? fmt(u.lastActiveAt) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── Security tab ─────────────────────────────────────────── */}
            {activeTab === "security" && (
              <div className="flex flex-col gap-8">
                {secError && <p className="text-[13px] text-red-500">{secError}</p>}
                {secMsg && <p className="text-[13px] text-green-600 font-medium">{secMsg}</p>}

                {/* Filter row */}
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    value={secSearch}
                    onChange={(e) => setSecSearch(e.target.value)}
                    placeholder="搜索 IP 或用户名…"
                    className="px-3 py-2.5 rounded-xl text-[13px] outline-none w-52"
                    style={{ fontFamily: FONT, background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)", color: "#111827" }}
                  />
                  <select
                    value={secFilter}
                    onChange={(e) => setSecFilter(e.target.value as "all" | "ip" | "user")}
                    className="px-3 py-2.5 rounded-xl text-[13px] outline-none"
                    style={{ fontFamily: FONT, background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}
                  >
                    <option value="all">全部类型</option>
                    <option value="ip">IP 封禁</option>
                    <option value="user">账号锁定</option>
                  </select>
                </div>

                {/* Manual block IP form */}
                {(secFilter === "all" || secFilter === "ip") && (
                  <div
                    className="rounded-2xl p-5"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}
                  >
                    <h2 className="text-[13px] font-semibold text-gray-700 mb-3">手动封禁 IP</h2>
                    <form onSubmit={handleManualBlockIp} className="flex flex-wrap gap-2">
                      <input
                        value={manualIp}
                        onChange={(e) => setManualIp(e.target.value)}
                        placeholder="IP 地址（如 1.2.3.4）"
                        className="px-3 py-2 rounded-xl text-[13px] outline-none flex-1 min-w-[160px]"
                        style={{ fontFamily: FONT, border: "1px solid rgba(0,0,0,0.12)", background: "white" }}
                      />
                      <input
                        value={manualReason}
                        onChange={(e) => setManualReason(e.target.value)}
                        placeholder="封禁原因（可选）"
                        className="px-3 py-2 rounded-xl text-[13px] outline-none flex-1 min-w-[160px]"
                        style={{ fontFamily: FONT, border: "1px solid rgba(0,0,0,0.12)", background: "white" }}
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white transition-all hover:opacity-85"
                        style={{ background: "#dc2626" }}
                      >
                        封禁 1 小时
                      </button>
                    </form>
                  </div>
                )}

                {/* IP blocklist table */}
                {(secFilter === "all" || secFilter === "ip") && (
                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 20px rgba(0,0,0,0.05)" }}
                  >
                    <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.015)" }}>
                      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">IP 黑名单</span>
                      <span className="text-[11px] text-gray-400">{blockedIps.filter(i => !secSearch || i.ip.includes(secSearch)).length} 条</span>
                    </div>
                    {blockedIps.filter(i => !secSearch || i.ip.includes(secSearch)).length === 0 ? (
                      <div className="text-center py-10 text-gray-400 text-[13px]">暂无封禁 IP</div>
                    ) : (
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">IP 地址</th>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">原因</th>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">封禁时间</th>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">解除时间</th>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">剩余</th>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {blockedIps.filter(i => !secSearch || i.ip.includes(secSearch)).map((item, idx, arr) => (
                            <tr key={item.ip} style={{ borderBottom: idx < arr.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }}
                              className="hover:bg-gray-50/40 transition-colors">
                              <td className="px-5 py-3 font-mono font-medium text-gray-900">{item.ip}</td>
                              <td className="px-5 py-3 text-gray-500">{item.reason}</td>
                              <td className="px-5 py-3 text-gray-400 text-[12px]">{fmt(item.blockedAt)}</td>
                              <td className="px-5 py-3 text-gray-400 text-[12px]">{fmt(item.blockedUntil)}</td>
                              <td className="px-5 py-3">
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                  style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626" }}>
                                  {fmtRemain(item.remainingSec)}
                                </span>
                              </td>
                              <td className="px-5 py-3">
                                <button
                                  onClick={() => handleUnblockIp(item.ip)}
                                  className="px-3 py-1 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                                  style={{ border: "1px solid rgba(0,0,0,0.10)" }}
                                >
                                  解除封禁
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* Locked users table */}
                {(secFilter === "all" || secFilter === "user") && (
                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 20px rgba(0,0,0,0.05)" }}
                  >
                    <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.015)" }}>
                      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">账号锁定</span>
                      <span className="text-[11px] text-gray-400">{lockedUsers.filter(u => !secSearch || u.username.includes(secSearch) || (u.email ?? "").includes(secSearch)).length} 条</span>
                    </div>
                    {lockedUsers.filter(u => !secSearch || u.username.includes(secSearch) || (u.email ?? "").includes(secSearch)).length === 0 ? (
                      <div className="text-center py-10 text-gray-400 text-[13px]">暂无锁定账号</div>
                    ) : (
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">用户名</th>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">邮箱</th>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">失败次数</th>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">锁定时间</th>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">剩余</th>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lockedUsers.filter(u => !secSearch || u.username.includes(secSearch) || (u.email ?? "").includes(secSearch)).map((u, idx, arr) => (
                            <tr key={u.userId} style={{ borderBottom: idx < arr.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }}
                              className="hover:bg-gray-50/40 transition-colors">
                              <td className="px-5 py-3 font-medium text-gray-900">{u.username}</td>
                              <td className="px-5 py-3 text-gray-500">{u.email ?? "—"}</td>
                              <td className="px-5 py-3">
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                  style={{ background: "rgba(234,179,8,0.08)", color: "#a16207" }}>
                                  {u.failCount} 次
                                </span>
                              </td>
                              <td className="px-5 py-3 text-gray-400 text-[12px]">{u.lockedAt ? fmt(u.lockedAt) : "—"}</td>
                              <td className="px-5 py-3">
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                  style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626" }}>
                                  {fmtRemain(u.remainingSec)}
                                </span>
                              </td>
                              <td className="px-5 py-3">
                                <button
                                  onClick={() => handleUnlockUser(u.userId, u.username)}
                                  className="px-3 py-1 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                                  style={{ border: "1px solid rgba(0,0,0,0.10)" }}
                                >
                                  解除锁定
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

              {/* OTP 发送限制解除 */}
              <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                <h3 className="text-[13px] font-semibold text-gray-700 mb-4">解除验证码发送限制</h3>
                {otpError && <p className="text-[12px] text-red-500 mb-3">{otpError}</p>}
                {otpMsg && <p className="text-[12px] text-green-600 font-medium mb-3">{otpMsg}</p>}
                <div className="flex gap-2 mb-4">
                  <input type="text" value={otpTarget}
                    onChange={(e) => { setOtpTarget(e.target.value); setOtpMsg(""); setOtpError(""); }}
                    placeholder="邮箱或手机号（如 929954000@qq.com）"
                    className="flex-1 px-3 py-2.5 rounded-xl text-[13px] outline-none"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}
                    onKeyDown={(e) => e.key === "Enter" && handleFetchOtp()}
                  />
                  <button onClick={handleFetchOtp} disabled={otpLoading || !otpTarget.trim()}
                    className="px-4 py-2 rounded-xl text-[13px] font-semibold"
                    style={{ background: "rgba(0,0,0,0.06)", color: "#374151" }}>查询</button>
                  <button onClick={handleClearOtp} disabled={otpLoading || !otpTarget.trim()}
                    className="px-4 py-2 rounded-xl text-[13px] font-semibold"
                    style={{ background: "rgba(239,68,68,0.1)", color: "#dc2626" }}>解除限制</button>
                </div>
                {otpRecords.length > 0 && (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                        <th className="px-3 py-2 text-left text-gray-400 font-semibold uppercase tracking-wider">渠道</th>
                        <th className="px-3 py-2 text-left text-gray-400 font-semibold uppercase tracking-wider">用途</th>
                        <th className="px-3 py-2 text-left text-gray-400 font-semibold uppercase tracking-wider">发送时间</th>
                        <th className="px-3 py-2 text-left text-gray-400 font-semibold uppercase tracking-wider">已使用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {otpRecords.map((r, idx, arr) => (
                        <tr key={r.id} style={{ borderBottom: idx < arr.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }} className="hover:bg-gray-50/40">
                          <td className="px-3 py-2 text-gray-700">{r.channel}</td>
                          <td className="px-3 py-2 text-gray-700">{r.purpose}</td>
                          <td className="px-3 py-2 text-gray-400">{fmt(r.createdAt)}</td>
                          <td className="px-3 py-2">
                            {r.consumedAt
                              ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a" }}>已使用</span>
                              : <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: "rgba(234,179,8,0.08)", color: "#a16207" }}>未使用</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {otpRecords.length === 0 && otpTarget && !otpLoading && !otpMsg && (
                  <p className="text-[12px] text-gray-400">暂无记录</p>
                )}
              </div>
            </div>
            )}

            {/* ── Feedback tab ─────────────────────────────────────────────── */}
            {activeTab === "feedback" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h3 className="text-[14px] font-semibold text-gray-700">用户建议列表</h3>
                  <select
                    className="ml-auto text-[12px] rounded-lg px-2 py-1 text-gray-600"
                    style={{ border: "1px solid rgba(0,0,0,0.10)", background: "white" }}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFeedbackSourceFilter(v as "all" | "pc" | "mobile" | "qiji");
                    }}
                  >
                    <option value="all">全部来源</option>
                    <option value="pc">PC端</option>
                    <option value="mobile">移动端</option>
                    <option value="qiji">奇迹论坛账号</option>
                  </select>
                  <button
                    onClick={fetchFeedback}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                    style={{ border: "1px solid rgba(0,0,0,0.10)" }}
                  >刷新</button>
                </div>
                {feedbackLoading && <p className="text-[13px] text-gray-400">加载中...</p>}
                {feedbackError && <p className="text-[12px] text-red-500">{feedbackError}</p>}
                {!feedbackLoading && feedbackItems.filter(item => {
                  if (feedbackSourceFilter === "all") return true;
                  if (feedbackSourceFilter === "qiji") return item.email?.endsWith("@miracleplus.com");
                  return item.source === feedbackSourceFilter;
                }).length === 0 && (
                  <p className="text-[13px] text-gray-400">暂无用户建议</p>
                )}
                {replyMsg && <p className="text-[12px] text-green-600 font-medium">{replyMsg}</p>}
                {feedbackItems.filter(item => {
                  if (feedbackSourceFilter === "all") return true;
                  if (feedbackSourceFilter === "qiji") return item.email?.endsWith("@miracleplus.com");
                  return item.source === feedbackSourceFilter;
                }).map((item) => (
                  <div key={item.id} className="relative rounded-2xl p-4" style={{ background: item.repliedAt ? "rgba(240,253,244,0.9)" : "rgba(255,255,255,0.9)", border: `1px solid ${item.repliedAt ? "rgba(34,197,94,0.2)" : "rgba(0,0,0,0.07)"}`, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                    {/* 未回复红点 */}
                    {!item.repliedAt && (
                      <span
                        className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-white font-bold"
                        style={{ background: "#ef4444", fontSize: 9, minWidth: 14, height: 14, padding: "0 3px" }}
                      >
                        新
                      </span>
                    )}
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="text-[12px] font-semibold text-gray-700">{item.username ?? item.email ?? item.phone ?? "匿名"}</span>
                      {item.email && <span className="text-[11px] text-gray-400">{item.email}</span>}
                      {item.email?.endsWith("@miracleplus.com") && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "rgba(168,85,247,0.08)", color: "#9333ea" }}>奇迹</span>
                      )}
                      {item.repliedAt && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a" }}>✓ 已回复</span>
                      )}
                      <span className="ml-auto text-[11px] text-gray-400">{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: item.source === "mobile" ? "rgba(79,130,255,0.10)" : "rgba(0,0,0,0.05)", color: item.source === "mobile" ? "#4f82ff" : "#666" }}>{item.source === "mobile" ? "移动端" : "PC端"}</span>
                    </div>
                    <p className="text-[13px] text-gray-700 whitespace-pre-wrap leading-relaxed">{item.content}</p>
                    {item.repliedAt && item.replyContent && (
                      <div className="mt-2 px-3 py-2 rounded-xl text-[12px]" style={{ background: "rgba(34,197,94,0.08)", borderLeft: "3px solid rgba(34,197,94,0.4)" }}>
                        <span className="text-[10px] text-green-600 font-semibold block mb-0.5">管理员回复 · {new Date(item.repliedAt).toLocaleString("zh-CN")}</span>
                        <span className="text-gray-700">{item.replyContent}</span>
                      </div>
                    )}
                    <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                      {replyTarget === item.id ? (
                        <div className="flex flex-col gap-2">
                          <textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="输入回复内容，用户将收到通知…"
                            rows={3}
                            maxLength={500}
                            className="w-full px-3 py-2 rounded-xl text-[12px] outline-none resize-none"
                            style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.10)" }}
                            autoFocus
                          />
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => { setReplyTarget(null); setReplyText(""); }}
                              className="px-3 py-1.5 rounded-lg text-[12px] text-gray-500 hover:bg-gray-100 transition-colors"
                            >取消</button>
                            <button
                              onClick={() => sendFeedbackReply(item.id)}
                              disabled={replySending || !replyText.trim()}
                              className="px-4 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40 transition-colors"
                              style={{ background: "#111827" }}
                            >{replySending ? "发送中…" : "发送通知"}</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setReplyTarget(item.id); setReplyText(""); }}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                          style={{ border: "1px solid rgba(0,0,0,0.10)" }}
                        >💬 回复用户</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Changelog tab ────────────────────────────────────────── */}
            {activeTab === "changelog" && (
              <div className="space-y-5">
                {changelogError && <p className="text-[13px] text-red-500">{changelogError}</p>}
                {changelogMsg && <p className="text-[13px] text-green-600 font-medium">{changelogMsg}</p>}

                {/* Inline form */}
                {changelogForm.open && (
                  <div className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(0,0,0,0.1)", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
                    <h3 className="text-[14px] font-semibold text-gray-800 mb-4">{changelogForm.editId ? "编辑条目" : "新增条目"}</h3>
                    <div className="flex flex-col gap-3">
                      <div className="flex gap-3">
                        <input
                          placeholder="版本号（如 v1.2.0，可选）"
                          value={changelogForm.version}
                          onChange={(e) => setChangelogForm((f) => ({ ...f, version: e.target.value }))}
                          className="w-48 px-3 py-2.5 rounded-xl text-[13px] outline-none"
                          style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}
                        />
                        <input
                          placeholder="标题 *"
                          value={changelogForm.title}
                          onChange={(e) => setChangelogForm((f) => ({ ...f, title: e.target.value }))}
                          className="flex-1 px-3 py-2.5 rounded-xl text-[13px] outline-none"
                          style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}
                        />
                      </div>
                      <textarea
                        placeholder="内容 *（支持换行）"
                        value={changelogForm.content}
                        onChange={(e) => setChangelogForm((f) => ({ ...f, content: e.target.value }))}
                        rows={5}
                        className="w-full px-3 py-2.5 rounded-xl text-[13px] outline-none resize-none"
                        style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}
                      />
                      <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setChangelogForm({ open: false, editId: null, version: "", title: "", content: "", isPublished: false })}
                            className="px-4 py-2 rounded-xl text-[13px] font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                          >取消</button>
                          <button
                            onClick={saveChangelogEntry}
                            disabled={changelogSaving || !changelogForm.title.trim() || !changelogForm.content.trim()}
                            className="px-5 py-2 rounded-xl text-[13px] font-semibold text-white transition-all hover:opacity-85 disabled:opacity-40"
                            style={{ background: "#111827" }}
                          >{changelogSaving ? "保存中…" : "保存"}</button>
                      </div>
                    </div>
                  </div>
                )}

                {changelogLoading && <p className="text-[13px] text-gray-400">加载中…</p>}
                {!changelogLoading && changelogItems.length === 0 && !changelogForm.open && (
                  <div className="text-center py-20 text-gray-400 text-[14px]">暂无更新条目，点击右上角「+ 新增」开始</div>
                )}
                {changelogItems.length > 0 && (
                  <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 20px rgba(0,0,0,0.05)" }}>
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.015)" }}>
                          <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">版本</th>
                          <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">标题</th>
                          <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">发布时间</th>
                          <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">状态</th>
                          <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changelogItems.map((entry, i) => (
                          <tr key={entry.id} style={{ borderBottom: i < changelogItems.length - 1 ? "1px solid rgba(0,0,0,0.04)" : "none" }} className="hover:bg-gray-50/40 transition-colors">
                            <td className="px-5 py-3.5">
                              {entry.version
                                ? <span className="text-[11px] font-mono px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(79,130,255,0.10)", color: "#4f82ff" }}>{entry.version}</span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-5 py-3.5 font-medium text-gray-800 max-w-xs truncate">{entry.title}</td>
                            <td className="px-5 py-3.5 text-gray-400 text-[12px] whitespace-nowrap">{new Date(entry.publishedAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                            <td className="px-5 py-3.5">
                              <span
                                className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                                style={entry.isPublished
                                  ? { background: "rgba(34,197,94,0.08)", color: "#16a34a" }
                                  : { background: "rgba(0,0,0,0.05)", color: "#6b7280" }}
                              >{entry.isPublished ? "已发布" : "草稿"}</span>
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setChangelogForm({ open: true, editId: entry.id, version: entry.version ?? "", title: entry.title, content: entry.content, isPublished: entry.isPublished })}
                                  className="px-3 py-1 rounded-lg text-[12px] font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                                  style={{ border: "1px solid rgba(0,0,0,0.08)" }}
                                >编辑</button>
                                <button
                                  onClick={() => !entry.isPublished && notifyChangelog(entry.id)}
                                  disabled={entry.isPublished}
                                  className="px-3 py-1 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                  style={{ border: "1px solid rgba(79,130,255,0.2)", background: "rgba(79,130,255,0.05)", color: "#4f82ff" }}
                                >推送通知</button>
                                <button
                                  onClick={() => deleteChangelogEntry(entry.id)}
                                  className="px-3 py-1 rounded-lg text-[12px] font-medium transition-colors"
                                  style={{ border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)", color: "#dc2626" }}
                                >删除</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

          </>
        )}
      </div>
    </div>
  );
}
