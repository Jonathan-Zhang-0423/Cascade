import { useState, useCallback } from "react";

interface Subscriber {
  id: number;
  email: string;
  createdAt: string;
  isEdu: boolean;
  status: "pending" | "invited";
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

type FilterStatus = "all" | "pending" | "invited";
type FilterType = "all" | "edu" | "normal";

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
      setSendResult(`✅ 成功发送 ${body.sent} 封邀请码邮件`);
      setSelected(new Set());
      await handleRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invites");
    } finally {
      setSending(false);
    }
  }

  function handleExportCSV() {
    if (!data) return;
    const rows = [
      ["ID", "Email", "类型", "状态", "邀请码", "申请时间", "发送时间", "有效期至", "批次"],
      ...filtered.map((s) => [
        s.id,
        s.email,
        s.isEdu ? "EDU" : "普通",
        s.status === "invited" ? "已邀请" : "待邀请",
        s.inviteCode ?? "",
        formatDate(s.createdAt),
        s.invitedAt ? formatDate(s.invitedAt) : "",
        s.expiresAt ? formatDate(s.expiresAt) : "",
        s.batchId ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waitlist_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
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

  const pendingFiltered = filtered.filter((s) => s.status === "pending");
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

  const cardStyle = {
    background: "rgba(255,255,255,0.85)",
    border: "1px solid rgba(0,0,0,0.08)",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
  };

  return (
    <div
      className="min-h-screen w-full"
      style={{
        fontFamily: "'Inter', sans-serif",
        background: "radial-gradient(ellipse 120% 80% at 50% -10%, #c8d0d8 0%, #dde1e6 25%, #edeff2 50%, #f6f7f9 75%, #ffffff 100%)",
      }}
    >
      <div className="max-w-6xl mx-auto w-full px-6 py-12">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Waitlist 管理后台</h1>
            <p className="text-sm text-gray-500 mt-1">CascadeAI · cascadeai.co</p>
          </div>
          {authed && data && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">共 <strong className="text-gray-900">{data.total}</strong> 位用户</span>
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 transition-all hover:bg-white/60 disabled:opacity-50"
                style={cardStyle}
              >
                {loading ? "刷新中…" : "刷新"}
              </button>
              <button
                onClick={handleExportCSV}
                className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 transition-all hover:bg-white/60"
                style={cardStyle}
              >
                导出 CSV
              </button>
            </div>
          )}
        </div>

        {/* Login */}
        {!authed && (
          <div className="max-w-sm">
            <form onSubmit={handleLogin} className="flex flex-col gap-3">
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Admin 密码"
                required
                className="px-4 py-2.5 rounded-md text-sm outline-none"
                style={{ ...cardStyle, color: "#1a1f2e" }}
                onFocus={(e) => { e.currentTarget.style.border = "1px solid rgba(17,24,39,0.55)"; }}
                onBlur={(e) => { e.currentTarget.style.border = "1px solid rgba(0,0,0,0.12)"; }}
              />
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2.5 rounded-md text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "#111827", boxShadow: "0 2px 8px rgba(0,0,0,0.20)" }}
              >
                {loading ? "登录中…" : "登录"}
              </button>
            </form>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        {sendResult && <p className="mt-4 text-sm text-green-600 font-medium">{sendResult}</p>}

        {/* Stats */}
        {authed && data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { label: "总用户", value: data.total },
                { label: "待邀请", value: data.subscribers.filter((s) => s.status === "pending").length },
                { label: "已邀请", value: data.subscribers.filter((s) => s.status === "invited").length },
                { label: "EDU 用户", value: data.subscribers.filter((s) => s.isEdu).length },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl px-5 py-4" style={cardStyle}>
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Filters + Send */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索邮箱…"
                className="px-3 py-2 rounded-md text-sm outline-none w-52"
                style={{ ...cardStyle, color: "#1a1f2e" }}
              />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                className="px-3 py-2 rounded-md text-sm outline-none"
                style={cardStyle}
              >
                <option value="all">全部状态</option>
                <option value="pending">待邀请</option>
                <option value="invited">已邀请</option>
              </select>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as FilterType)}
                className="px-3 py-2 rounded-md text-sm outline-none"
                style={cardStyle}
              >
                <option value="all">全部类型</option>
                <option value="normal">普通用户</option>
                <option value="edu">EDU 用户</option>
              </select>

              <div className="ml-auto flex items-center gap-3">
                {selected.size > 0 && (
                  <span className="text-sm text-gray-500">已选 <strong>{selected.size}</strong> 人</span>
                )}
                <button
                  onClick={handleSendInvites}
                  disabled={selected.size === 0 || sending}
                  className="px-5 py-2 rounded-md text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{ background: "#111827", boxShadow: "0 2px 8px rgba(0,0,0,0.20)" }}
                >
                  {sending ? "发送中…" : `发送邀请码${selected.size > 0 ? ` (${selected.size})` : ""}`}
                </button>
              </div>
            </div>

            {/* Table */}
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">暂无数据</p>
            ) : (
              <div className="rounded-xl overflow-hidden" style={cardStyle}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.07)", background: "rgba(0,0,0,0.02)" }}>
                      <th className="px-4 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={allPendingSelected}
                          onChange={toggleSelectAll}
                          className="rounded"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">类型</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">状态</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">邀请码</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">申请时间</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">有效期至</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">批次</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s, i) => (
                      <tr
                        key={s.id}
                        style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none" }}
                        className={selected.has(s.id) ? "bg-blue-50/60" : ""}
                      >
                        <td className="px-4 py-3">
                          {s.status === "pending" && (
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
                        <td className="px-4 py-3 text-gray-900 font-medium">{s.email}</td>
                        <td className="px-4 py-3">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={s.isEdu
                              ? { background: "rgba(99,102,241,0.1)", color: "#4f46e5" }
                              : { background: "rgba(0,0,0,0.06)", color: "#374151" }}
                          >
                            {s.isEdu ? "EDU" : "普通"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={s.status === "invited"
                              ? { background: "rgba(34,197,94,0.1)", color: "#16a34a" }
                              : { background: "rgba(234,179,8,0.1)", color: "#a16207" }}
                          >
                            {s.status === "invited" ? "已邀请" : "待邀请"}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-700 text-xs">{s.inviteCode ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(s.createdAt)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{s.expiresAt ? formatDate(s.expiresAt) : "—"}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{s.batchId ? `#${s.batchId}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
