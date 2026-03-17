import { useState, useRef, useEffect } from "react";
import { useIDEStore, type FileNode } from "@/stores/ide-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
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
  ChevronRight,
  ChevronDown,
  FileText,
  FileCode,
  FileType,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  X,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";

function getFileIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return <FileCode className="w-4 h-4 text-sky-500 shrink-0" />;
  if (lower === "makefile") return <FileText className="w-4 h-4 text-zinc-400 shrink-0" />;
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "html":
    case "svelte":
    case "vue":
      return <FileCode className="w-4 h-4 text-orange-400 shrink-0" />;
    case "css":
    case "scss":
    case "sass":
    case "less":
      return <FileType className="w-4 h-4 text-blue-400 shrink-0" />;
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return <FileCode className="w-4 h-4 text-yellow-400 shrink-0" />;
    case "py":
    case "pyw":
      return <FileCode className="w-4 h-4 text-yellow-500 shrink-0" />;
    case "ts":
    case "tsx":
      return <FileCode className="w-4 h-4 text-blue-500 shrink-0" />;
    case "go":
    case "dart":
      return <FileCode className="w-4 h-4 text-sky-400 shrink-0" />;
    case "java":
      return <FileCode className="w-4 h-4 text-red-400 shrink-0" />;
    case "rb":
      return <FileCode className="w-4 h-4 text-red-500 shrink-0" />;
    case "scala":
      return <FileCode className="w-4 h-4 text-red-600 shrink-0" />;
    case "c":
    case "h":
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hxx":
      return <FileCode className="w-4 h-4 text-teal-400 shrink-0" />;
    case "cs":
      return <FileCode className="w-4 h-4 text-purple-400 shrink-0" />;
    case "php":
      return <FileCode className="w-4 h-4 text-purple-500 shrink-0" />;
    case "graphql":
    case "gql":
      return <FileCode className="w-4 h-4 text-purple-600 shrink-0" />;
    case "rs":
    case "swift":
    case "kt":
    case "kts":
      return <FileCode className="w-4 h-4 text-orange-500 shrink-0" />;
    case "json":
      return <FileText className="w-4 h-4 text-green-400 shrink-0" />;
    case "yaml":
    case "yml":
    case "xml":
    case "svg":
    case "toml":
      return <FileText className="w-4 h-4 text-green-500 shrink-0" />;
    case "sh":
    case "bash":
    case "zsh":
    case "sql":
    case "md":
    case "txt":
      return <FileText className="w-4 h-4 text-gray-400 shrink-0" />;
    case "r":
    case "lua":
    case "pl":
    case "pm":
    case "ex":
    case "exs":
      return <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />;
    case "dockerfile":
      return <FileCode className="w-4 h-4 text-sky-500 shrink-0" />;
    case "proto":
    case "ini":
    case "cfg":
      return <FileText className="w-4 h-4 text-zinc-400 shrink-0" />;
    default:
      return <FileText className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
}

function InlineInput({
  defaultValue,
  onSubmit,
  onCancel,
}: {
  defaultValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim()) {
          onSubmit(value.trim());
        } else if (e.key === "Escape") {
          onCancel();
        }
      }}
      onBlur={() => {
        if (value.trim()) {
          onSubmit(value.trim());
        } else {
          onCancel();
        }
      }}
      className="h-6 text-xs px-1 py-0 rounded-sm"
      aria-label="Enter file or folder name"
      data-testid="input-inline-rename"
    />
  );
}

function FileTreeItem({
  node,
  depth = 0,
}: {
  node: FileNode;
  depth?: number;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { activeFile, setActiveFile, addFile, renameFile, deleteFile, setPreviewFile } =
    useIDEStore();
  const isActive = activeFile === node.path;
  const isFolder = node.type === "folder";
  const [newItemType, setNewItemType] = useState<"file" | "folder" | null>(null);

  const handleCreateNew = (type: "file" | "folder") => {
    if (isFolder) {
      setIsOpen(true);
      setNewItemType(type);
    }
  };

  return (
    <div role="treeitem" aria-expanded={isFolder ? isOpen : undefined}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            {isRenaming ? (
              <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="py-0.5 px-2">
                <InlineInput
                  defaultValue={node.name}
                  onSubmit={(newName) => {
                    renameFile(node.path, newName);
                    setIsRenaming(false);
                  }}
                  onCancel={() => setIsRenaming(false)}
                />
              </div>
            ) : (
              <button
                className={cn(
                  "flex items-center gap-1.5 w-full text-left py-1 px-2 text-xs rounded-md transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => {
                  if (isFolder) {
                    setIsOpen(!isOpen);
                  } else {
                    setActiveFile(node.path);
                  }
                }}
                aria-label={isFolder ? `${node.name} folder` : node.name}
                data-testid={`tree-item-${node.name}`}
              >
                {isFolder ? (
                  <>
                    {isOpen ? (
                      <ChevronDown className="w-3 h-3 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 shrink-0" />
                    )}
                    {isOpen ? (
                      <FolderOpen className="w-4 h-4 text-blue-400 shrink-0" />
                    ) : (
                      <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                    )}
                  </>
                ) : (
                  <>
                    <span className="w-3 shrink-0" />
                    {getFileIcon(node.name)}
                  </>
                )}
                <span className="truncate">{node.name}</span>
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {isFolder && (
            <>
              <ContextMenuItem
                onClick={() => handleCreateNew("file")}
                data-testid="ctx-new-file"
              >
                <FilePlus className="w-4 h-4 mr-2" />
                New File
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => handleCreateNew("folder")}
                data-testid="ctx-new-folder"
              >
                <FolderPlus className="w-4 h-4 mr-2" />
                New Folder
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {!isFolder && node.name.endsWith(".html") && (
            <>
              <ContextMenuItem
                onClick={() => setPreviewFile(node.path)}
                data-testid="ctx-preview"
              >
                <Play className="w-4 h-4 mr-2" />
                Preview
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            onClick={() => setIsRenaming(true)}
            data-testid="ctx-rename"
          >
            <Pencil className="w-4 h-4 mr-2" />
            Rename
          </ContextMenuItem>
          {!isFolder && (
            <ContextMenuItem
              onClick={() => {
                const parentPath = node.path.substring(
                  0,
                  node.path.lastIndexOf("/")
                );
                const ext = node.name.includes(".")
                  ? "." + node.name.split(".").pop()
                  : "";
                const baseName = node.name.replace(ext, "");
                addFile(parentPath, `${baseName}-copy${ext}`, "file");
              }}
              data-testid="ctx-duplicate"
            >
              <Copy className="w-4 h-4 mr-2" />
              Duplicate
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteTarget(node.path)}
            data-testid="ctx-delete"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isFolder && isOpen && node.children && (
        <div>
          {newItemType && (
            <div
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              className="py-0.5 px-2"
            >
              <InlineInput
                defaultValue=""
                onSubmit={(name) => {
                  addFile(node.path, name, newItemType);
                  setNewItemType(null);
                }}
                onCancel={() => setNewItemType(null)}
              />
            </div>
          )}
          {node.children.map((child) => (
            <FileTreeItem key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {isFolder ? "folder" : "file"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{node.name}"? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  deleteFile(deleteTarget);
                  setDeleteTarget(null);
                }
              }}
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

export function FileTree() {
  const { files, addFile, setActiveTool } = useIDEStore();
  const [newItemType, setNewItemType] = useState<"file" | "folder" | null>(null);

  return (
    <div className="h-full flex flex-col" data-testid="file-tree">
      <div className="flex items-center justify-between gap-1 px-3 h-9 border-b border-border/50 shrink-0">
        <span className="text-xs font-medium text-foreground">
          Files
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setNewItemType("file")}
            aria-label="New file"
            data-testid="button-new-file"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setNewItemType("folder")}
            aria-label="New folder"
            data-testid="button-new-folder"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setActiveTool(null)}
            aria-label="Close panel"
            data-testid="button-close-files"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-1.5" role="tree" aria-label="File explorer">
          {newItemType && (
            <div className="py-0.5 px-2">
              <InlineInput
                defaultValue=""
                onSubmit={(name) => {
                  addFile("/project", name, newItemType);
                  setNewItemType(null);
                }}
                onCancel={() => setNewItemType(null)}
              />
            </div>
          )}
          {files.map((file) => (
            <FileTreeItem key={file.path} node={file} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
