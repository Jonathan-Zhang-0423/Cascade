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
      if (res.ok) { const d = await res.json(); setNotifs(d.notifications ?? []); }
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
  const [accountInfo, setAccountInfo] = useState<{ email?: string; phone?: string; githubId?: string } | null>(null);
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(u => {
      if (u) setAccountInfo({ email: u.email, phone: u.phone, githubId: u.githubId });
    }).catch(() => {});
  }, []);

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
    navigator.clipboard.writeText(text).then(() => {
      if (type === "code") { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000); }
      else { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }
    });
  };

  const handleEditUsernameOpen = () => {
    setNewUsername(username ?? "");
    setEditUsernameError("");
    setShowEditUsername(true);
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
    } finally {
      setEditUsernameLoading(false);
    }
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
    {
      icon: <Clock className="w-3.5 h-3.5" />,
      label: t("navbar.recentProjects"),
      action: () => { navigate("/app"); setLogoMenuOpen(false); },
    },
    {
      icon: <Wand2 className="w-3.5 h-3.5" />,
      label: "AIGC 创作",
      action: () => { navigate("/aigc"); setLogoMenuOpen(false); },
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
    {
      icon: <LogOut className="w-3.5 h-3.5" />,
      label: t("navbar.logout"),
      action: () => { handleSignOut(); setLogoMenuOpen(false); },
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
            {/* Theme selector — hidden on mobile, shown in user menu there */}
            <div className="hidden sm:block">
              <LangToggle />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-user-menu"
                >
                  <User className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{username ?? "…"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs font-semibold text-foreground">
                  {username ?? "…"}
                </DropdownMenuLabel>
                {/* 注册方式 */}
                {accountInfo && (accountInfo.email || accountInfo.phone || accountInfo.githubId) && (
                  <div className="px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground/60 mb-0.5">注册方式</p>
                    {accountInfo.email && (
                      <p className="text-[11px] text-muted-foreground truncate">📧 {accountInfo.email}</p>
                    )}
                    {accountInfo.phone && (
                      <p className="text-[11px] text-muted-foreground truncate">📱 {accountInfo.phone}</p>
                    )}
                    {accountInfo.githubId && (
                      <p className="text-[11px] text-muted-foreground">🐙 GitHub</p>
                    )}
                  </div>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs cursor-pointer gap-2"
                  onClick={handleEditUsernameOpen}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {t("auth.editUsername")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs cursor-pointer gap-2"
                  onClick={openInviteDialog}
                >
                  <Gift className="w-3.5 h-3.5" />
                  {t("navbar.invite")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs cursor-pointer gap-2"
                  data-testid="menu-item-sign-out"
                  onClick={handleSignOut}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {t("dashboard.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Theme selector — desktop only, removed */}
            <Button
              onClick={() => setShowNewDialog(true)}
              className="gap-2"
              data-testid="button-new-project"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t("dashboard.newProject")}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 pb-28">
        <div className="flex items-center justify-between mb-1">
          <h1 className="font-lora text-xl font-bold tracking-tight text-foreground" data-testid="text-dashboard-title">
            {t("dashboard.myProjects")}
          </h1>
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
              {/* 列表 */}
              <div className="flex flex-col overflow-y-auto" style={{ width: "100%", maxWidth: "100%", borderRight: "none" }}
                /* PC 上加右边框 */
              >
                <style>{`@media(min-width:640px){.notif-list{width:260px!important;border-right:1px solid var(--panel-divider)!important}}`}</style>
                <div className="notif-list flex flex-col overflow-y-auto h-full" style={{ width: "100%" }}>
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
                          {/* 手机端展开内容（直接内联显示，不需要右栏）*/}
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
                ) : (() => {
                  const active = notifs.find(n => n.id === (selectedNotifId ?? notifs[0]?.id)) ?? notifs[0];
                  if (!active) return null;
                  return (
                    <div className="flex flex-col h-full">
                      <div className="px-6 shrink-0 flex flex-col justify-center" style={{ height: 72, borderBottom: "1px solid var(--panel-divider)" }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(79,130,255,0.10)", color: "#4f82ff" }}>
                            {active.type === "changelog" ? "更新公告" : "系统消息"}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(active.createdAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <h3 className="text-[14px] font-semibold text-foreground leading-snug truncate">{active.title}</h3>
                      </div>
                      <div className="flex-1 overflow-y-auto px-6 py-5">
                        {active.body
                          ? <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{active.body}</p>
                          : <p className="text-[13px] text-muted-foreground">暂无详细内容。</p>}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
