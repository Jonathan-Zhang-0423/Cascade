import { useState } from "react";
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
import { Code2, Plus, Trash2, Pencil, FolderOpen, Calendar, Send, Palette } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { THEME_LIST, type ThemeId } from "@/lib/themes";

migrateOldState();

export default function DashboardPage() {
  const { projects, createProject, deleteProject, renameProject } = useProjectStore();
  const [, navigate] = useLocation();
  const { themeId, setThemeId } = useTheme();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [ideaText, setIdeaText] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");

  const handleCreate = () => {
    const idea = ideaText.trim();
    if (!idea) return;
    const id = createProject("New Project", idea);
    setIdeaText("");
    setShowNewDialog(false);
    navigate(`/project/${id}`);
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

  const sortedProjects = [...projects].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="min-h-screen bg-background" data-testid="dashboard-page">
      <header className="border-b border-border/50 bg-sidebar">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Code2 className="w-4.5 h-4.5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight text-foreground" data-testid="text-dashboard-logo">
              CodeStart
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Select value={themeId} onValueChange={(v) => setThemeId(v as ThemeId)}>
              <SelectTrigger className="w-[150px] h-8 text-xs" data-testid="select-theme">
                <Palette className="w-3.5 h-3.5 mr-1 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_LIST.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
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
              New Project
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-foreground mb-1" data-testid="text-dashboard-title">
          My Projects
        </h1>
        <p className="text-muted-foreground mb-6">
          Create a new project or open an existing one to start building.
        </p>

        {sortedProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="empty-state">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <FolderOpen className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">No projects yet</h2>
            <p className="text-muted-foreground mb-6 max-w-sm">
              Tell us what you want to build and we'll get started right away!
            </p>
            <Button
              onClick={() => setShowNewDialog(true)}
              className="gap-2"
              data-testid="button-new-project-empty"
            >
              <Plus className="w-4 h-4" />
              Start Building
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="project-grid">
            {sortedProjects.map((project) => (
              <div
                key={project.id}
                className="group relative bg-card border border-card-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer"
                onClick={() => navigate(`/project/${project.id}`)}
                data-testid={`card-project-${project.id}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Code2 className="w-5 h-5 text-primary" />
                  </div>
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
                </div>
                <h3 className="font-semibold text-foreground mb-1 truncate" data-testid={`text-project-name-${project.id}`}>
                  {project.name}
                </h3>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="w-3 h-3" />
                  <span>{new Date(project.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-new-project">
          <DialogHeader>
            <DialogTitle className="text-lg">What do you want to build today? 😉</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="e.g. A snake game, a personal portfolio, a to-do list..."
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)} data-testid="button-cancel-new">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!ideaText.trim()} className="gap-2" data-testid="button-create-project">
              <Send className="w-3.5 h-3.5" />
              Let's Go!
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameId !== null} onOpenChange={(open) => !open && setRenameId(null)}>
        <DialogContent data-testid="dialog-rename-project">
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="New name"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleRename()}
            autoFocus
            data-testid="input-rename-project"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameId(null)} data-testid="button-cancel-rename">
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!renameName.trim()} data-testid="button-confirm-rename">
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent data-testid="dialog-delete-project">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this project and all its files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
