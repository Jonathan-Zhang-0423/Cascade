import { useState, useCallback, useEffect } from "react";
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

type AdminTab = "waitlist" | "security";

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
}

interface WaitlistData {
  total: number;
  subscribers: Subscriber[];
}

type FilterStatus = "all" | "pending" | "invited" | "email_failed";
type FilterType = "all" | "edu" | "normal";

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
  const [secret, setSecret] = useState("");
  const [data, setData] = useState<WaitlistData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [activeTab, setActiveTab] = useState<AdminTab>("waitlist");

  // Security panel state
  const [blockedIps, setBlockedIps] = useState<BlockedIp[]>([]);
  const [lockedUsers, setLockedUsers] = useState<LockedUser[]>([]);
  const [secLoading, setSecLoading] = useState(false);
  const [secMsg, setSecMsg] = useState("");
  const [secError, setSecError] = useState("");
  const [secFilter, setSecFilter] = useState<"all" | "ip" | "user">("all");
  const [secSearch, setSecSearch] = useState("");
  const [manualIp, setManualIp] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async (adminSecret: string) => {
    const res = await fetch("/api/waitlist", {
      headers: { "x-admin-secret": adminSecret },
    });
    if (res.status === 401) throw new Error("Incorrect password.");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? "Something went wrong.");
    }
    return res.json() as Promise<WaitlistData>;
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;
    setLoading(true);
    setError("");
    try {
      const json = await fetchData(secret.trim());
      setData(json);
      setAuthed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reach the server.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setLoading(true);
    setError("");
    try {
      setData(await fetchData(secret.trim()));
      setSelected(new Set());
      setSendResult("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reach the server.");
    } finally {
      setLoading(false);
    }
  }

  // ── Security handlers ──────────────────────────────────────────────────────
  async function fetchSecurity() {
    setSecLoading(true); setSecError("");
    try {
      const [ipRes, userRes] = await Promise.all([
        fetch("/api/admin/blocklist/ip", { headers: { "x-admin-secret": secret.trim() } }),
        fetch("/api/admin/blocklist/users", { headers: { "x-admin-secret": secret.trim() } }),
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
        method: "DELETE", headers: { "x-admin-secret": secret.trim() },
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
        method: "DELETE", headers: { "x-admin-secret": secret.trim() },
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
        headers: { "Content-Type": "application/json", "x-admin-secret": secret.trim() },
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

  // Load security data when switching to security tab
  useEffect(() => {
    if (authed && activeTab === "security") fetchSecurity();
  }, [authed, activeTab]);

  async function handleSendInvites() {
    if (selected.size === 0) return;
    setSending(true);
    setSendResult("");
    setError("");
    try {
      const res = await fetch("/api/admin/send-invites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": secret.trim(),
        },
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
        headers: { "x-admin-secret": secret.trim() },
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

  const filtered = (data?.subscribers ?? []).filter((s) => {
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    if (filterType === "edu" && !s.isEdu) return false;
    if (filterType === "normal" && s.isEdu) return false;
    if (search && !s.email.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const pendingFiltered = filtered.filter((s) => s.status === "pending" || s.status === "email_failed");
  const allPendingSelected = pendingFiltered.length > 0 && pendingFiltered.every((s) => selected.has(s.id));

  function toggleSelectAll() {
    if (allPendingSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        pendingFiltered.forEach((s) => next.delete(s.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        pendingFiltered.forEach((s) => next.add(s.id));
        return next;
      });
    }
  }

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

        {/* Login */}
        {!authed && (
          <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
            <h1
              className="font-bold text-black mb-3 leading-tight"
              style={{ fontSize: "clamp(36px, 5vw, 52px)", fontFamily: FONT }}
            >
              CascadeAI Admin
            </h1>
            <p className="text-gray-500 text-[16px] mb-10">
              Enter your admin password to continue.
            </p>
            <form onSubmit={handleLogin} className="flex flex-col gap-3 w-full max-w-sm">
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Admin password"
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
                disabled={loading}
                className="w-full py-3 rounded-xl text-[14px] font-semibold text-white transition-all hover:opacity-85 active:scale-[0.98] disabled:opacity-50"
                style={{ background: "#111827", boxShadow: "0 4px 16px rgba(0,0,0,0.18)" }}
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
            {error && (
              <p className="mt-4 text-[13px] text-red-500">{error}</p>
            )}
          </div>
        )}

        {/* Dashboard */}
        {authed && data && (
          <>
            {/* Tab switcher */}
            <div className="flex gap-1 mb-8 border-b border-black/[0.07]">
              {([["waitlist", "Waitlist"], ["security", "安全管理"]] as [AdminTab, string][]).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-all ${
                    activeTab === tab ? "border-black text-black" : "border-transparent text-gray-400 hover:text-gray-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Page title row */}
            <div className="flex items-end justify-between mb-10">
              <div>
                <h1
                  className="font-bold text-black leading-tight"
                  style={{ fontSize: "clamp(28px, 4vw, 40px)", fontFamily: FONT }}
                >
                  {activeTab === "waitlist" ? "Waitlist" : "安全管理"}
                </h1>
                {activeTab === "waitlist" && (
                  <p className="text-gray-500 text-[14px] mt-1">cascadeai.co · {data.total} subscribers</p>
                )}
                {activeTab === "security" && (
                  <p className="text-gray-500 text-[14px] mt-1">IP 封禁 {blockedIps.length} 条 · 账号锁定 {lockedUsers.length} 条</p>
                )}
              </div>
              <div className="flex items-center gap-3">
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
                  background: "rgba(255,255,255,0.9)",
                  border: "1px solid rgba(0,0,0,0.10)",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
                }}
              >
                <option value="all">All status</option>
                <option value="pending">Pending</option>
                <option value="invited">Invited</option>
                <option value="email_failed">Email Failed</option>
              </select>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as FilterType)}
                className="px-3 py-2.5 rounded-xl text-[13px] outline-none"
                style={{
                  background: "rgba(255,255,255,0.9)",
                  border: "1px solid rgba(0,0,0,0.10)",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
                }}
              >
                <option value="all">All types</option>
                <option value="normal">Normal</option>
                <option value="edu">EDU</option>
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
                  style={{ background: "#111827", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}
                >
                  {sending ? "Sending…" : `Send Invite${selected.size > 1 ? "s" : ""}${selected.size > 0 ? ` (${selected.size})` : ""}`}
                </button>
              </div>
            </div>

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
                          checked={allPendingSelected}
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
                          {(s.status === "pending" || s.status === "email_failed") && (
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
                          )}
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
                        <td className="px-5 py-3.5 text-gray-400 text-[12px]">{s.batchId ? `#${s.batchId}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </>)} {/* end waitlist tab */}

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
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)", color: "#111827" }}
                  />
                  <select
                    value={secFilter}
                    onChange={(e) => setSecFilter(e.target.value as "all" | "ip" | "user")}
                    className="px-3 py-2.5 rounded-xl text-[13px] outline-none"
                    style={{ background: "rgba(255,255,255,0.9)", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}
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
                        style={{ border: "1px solid rgba(0,0,0,0.12)", background: "white" }}
                      />
                      <input
                        value={manualReason}
                        onChange={(e) => setManualReason(e.target.value)}
                        placeholder="封禁原因（可选）"
                        className="px-3 py-2 rounded-xl text-[13px] outline-none flex-1 min-w-[160px]"
                        style={{ border: "1px solid rgba(0,0,0,0.12)", background: "white" }}
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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
