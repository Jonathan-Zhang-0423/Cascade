import { useState, useEffect } from "react";
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
import { Plus, Trash2, Pencil, FolderOpen, Calendar, Send, Palette, CheckSquare, Square, CheckCheck, LogOut, User } from "lucide-react";
import { getProjectEmoji } from "@/lib/project-emoji";
import { CascadeLogo } from "@/assets/CascadeLogo";
import { useTheme } from "@/components/theme-provider";
import { THEME_LIST, type ThemeId } from "@/lib/themes";
import { LangToggle } from "@/components/lang-toggle";
import { useT } from "@/lib/i18n";
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

export default function DashboardPage() {
  const { projects, createProject, deleteProject, renameProject, syncFromServer } = useProjectStore();
  const [, navigate] = useLocation();
  const { themeId, setThemeId } = useTheme();
  const [showNewDialog, setShowNewDialog] = useState(false);

  useEffect(() => {
    syncFromServer();
  }, [syncFromServer]);

  const [ideaText, setIdeaText] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [selectedFramework, setSelectedFramework] = useState<"web" | "rn-expo" | "flutter" | "swiftui" | "kotlin">("web");

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

  const handleCreate = async () => {
    const idea = ideaText.trim();
    if (!idea) return;
    const emoji = getProjectEmoji(idea);
    const id = await createProject(t("dashboard.newProject"), idea, emoji, selectedFramework);
    setIdeaText("");
    setSelectedFramework("web");
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
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 h-14">
          <div className="flex items-center">
            <CascadeLogo width={36} height={36} />
          </div>
          <div className="flex items-center gap-2">
            <LangToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-user-menu"
                >
                  <User className="w-3.5 h-3.5" />
                  {username ?? "…"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {t("dashboard.account")}
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
            <Select value={themeId} onValueChange={(v) => setThemeId(v as ThemeId)}>
              <SelectTrigger className="w-[150px] h-8 text-xs" data-testid="select-theme">
                <Palette className="w-3.5 h-3.5 mr-1 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_LIST.map((th) => (
                  <SelectItem key={th.id} value={th.id}>
                    {th.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => setShowNewDialog(true)}
              className="gap-2"
              data-testid="button-new-project"
            >
              <Plus className="w-4 h-4" />
              {t("dashboard.newProject")}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 pb-28">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-dashboard-title">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="project-grid">
            {sorted.map((project) => {
              const isSelected = selectedIds.has(project.id);
              return (
                <div
                  key={project.id}
                  className={`group relative bg-card border rounded-xl p-5 transition-all cursor-pointer
                    ${selectMode
                      ? isSelected
                        ? "border-primary shadow-md ring-2 ring-primary/30 bg-primary/5"
                        : "border-card-border hover:border-primary/40 hover:shadow-md"
                      : "border-card-border hover:border-primary/40 hover:shadow-md"
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
                  {/* Checkbox overlay in select mode */}
                  {selectMode && (
                    <div
                      className="absolute top-3 left-3 z-10"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(project.id);
                      }}
                      data-testid={`checkbox-project-${project.id}`}
                    >
                      {isSelected ? (
                        <CheckCheck className="w-5 h-5 text-primary" />
                      ) : (
                        <Square className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  )}

                  <div className={`flex items-start justify-between mb-3 ${selectMode ? "pl-7" : ""}`}>
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-2xl leading-none select-none" data-testid={`emoji-project-${project.id}`}>
                      {project.emoji ?? getProjectEmoji(project.name)}
                    </div>
                    {!selectMode && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                  <h3 className={`font-semibold text-foreground mb-1 truncate ${selectMode ? "pl-7" : ""}`} data-testid={`text-project-name-${project.id}`}>
                    {project.name}
                  </h3>
                  <div className={`flex items-center gap-1.5 text-xs text-muted-foreground ${selectMode ? "pl-7" : ""}`}>
                    <Calendar className="w-3 h-3" />
                    <span>{new Date(project.createdAt).toLocaleDateString()}</span>
                  </div>
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
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Framework</label>
            <Select value={selectedFramework} onValueChange={(v: any) => setSelectedFramework(v)}>
              <SelectTrigger data-testid="select-framework">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="web">Web (HTML/CSS/JS)</SelectItem>
                <SelectItem value="rn-expo">React Native (Expo)</SelectItem>
                <SelectItem value="flutter">Flutter</SelectItem>
                <SelectItem value="swiftui">SwiftUI (iOS)</SelectItem>
                <SelectItem value="kotlin">Kotlin Compose (Android)</SelectItem>
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
