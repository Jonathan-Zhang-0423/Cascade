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
import { Plus, Trash2, Pencil, FolderOpen, Send, Palette, CheckSquare, Square, CheckCheck, LogOut, User, Home, Clock, Sun, Moon, HelpCircle, ChevronDown, Check, Languages } from "lucide-react";
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

  useEffect(() => {
    syncFromServer();
  }, [syncFromServer]);

  const [ideaText, setIdeaText] = useState("");
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

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUserId(null);
    setUsername(null);
    window.location.href = "/login";
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
      action: () => setLogoMenuOpen(false),
    },
    {
      icon: <LogOut className="w-3.5 h-3.5" />,
      label: t("navbar.logout"),
      action: () => { handleSignOut(); setLogoMenuOpen(false); },
    },
  ];

  const handleCreate = async () => {
    const idea = ideaText.trim();
    if (!idea) return;
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
        if (data.name) renameProject(id, data.name);
      })
      .catch(() => {});
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
    renameProject(renameId, name);
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
                className="flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-accent/20 transition-colors"
                onClick={() => setLogoMenuOpen((v) => !v)}
                aria-label="Open menu"
              >
                <CascadeLogo width={28} height={28} />
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
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
                <div className="text-[11px] text-muted-foreground mt-0.5">{t("dashboard.modePlanDesc")}</div>
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
            <Button onClick={handleCreate} disabled={!ideaText.trim()} className="gap-2" data-testid="button-create-project">
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
    </div>
  );
}
