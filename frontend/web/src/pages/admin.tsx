import { useState, useCallback } from "react";
import cascadeLogo from "../assets/cascade-logo.png";

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

const FONT = '"Inter", "Helvetica Neue", system-ui, sans-serif';

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
              Waitlist Admin
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
            {/* Page title row */}
            <div className="flex items-end justify-between mb-10">
              <div>
                <h1
                  className="font-bold text-black leading-tight"
                  style={{ fontSize: "clamp(28px, 4vw, 40px)", fontFamily: FONT }}
                >
                  Waitlist
                </h1>
                <p className="text-gray-500 text-[14px] mt-1">cascadeai.co · {data.total} subscribers</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleRefresh}
                  disabled={loading}
                  className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40"
                  style={{
                    background: "rgba(255,255,255,0.9)",
                    border: "1px solid rgba(0,0,0,0.1)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                  }}
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
              </div>
            </div>

            {error && <p className="mb-4 text-[13px] text-red-500">{error}</p>}
            {sendResult && <p className="mb-4 text-[13px] text-green-600 font-medium">{sendResult}</p>}

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
                            style={s.status === "invited"
                              ? { background: "rgba(34,197,94,0.08)", color: "#16a34a" }
                              : { background: "rgba(234,179,8,0.08)", color: "#a16207" }}
                          >
                            {s.status === "invited" ? "Invited" : "Pending"}
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
          </>
        )}
      </div>
    </div>
  );
}
