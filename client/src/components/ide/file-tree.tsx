import { useState } from "react";
import { useIDEStore, type FileNode } from "@/stores/ide-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  FileCode,
  FileType,
  Folder,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "html":
      return <FileCode className="w-4 h-4 text-orange-400 shrink-0" />;
    case "css":
      return <FileType className="w-4 h-4 text-blue-400 shrink-0" />;
    case "js":
    case "jsx":
      return <FileCode className="w-4 h-4 text-yellow-400 shrink-0" />;
    case "ts":
    case "tsx":
      return <FileCode className="w-4 h-4 text-blue-500 shrink-0" />;
    case "json":
      return <FileText className="w-4 h-4 text-green-400 shrink-0" />;
    default:
      return <FileText className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
}

function FileTreeItem({
  node,
  depth = 0,
}: {
  node: FileNode;
  depth?: number;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const { activeFile, setActiveFile } = useIDEStore();
  const isActive = activeFile === node.path;
  const isFolder = node.type === "folder";

  return (
    <div>
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

      {isFolder && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const { files } = useIDEStore();

  return (
    <div className="h-full flex flex-col bg-sidebar" data-testid="file-tree">
      <div className="flex items-center justify-between px-3 h-10 border-b border-sidebar-border shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Explorer
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-1.5">
          {files.map((file) => (
            <FileTreeItem key={file.path} node={file} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
