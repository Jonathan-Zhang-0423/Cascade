import { useState, useMemo, useEffect } from "react";
import { Download, FileCode, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type FileNode, flattenFiles } from "@/stores/ide-store";
import { getLanguageId } from "@/lib/preview-adapters";

interface CodePreviewProps {
  files: FileNode[];
  framework: string;
  projectId: string | null;
  mainEntryFile: string;
}

const SYNTAX_COLORS: Record<string, Record<string, string>> = {
  swift: {
    keyword: "text-pink-400",
    string: "text-green-400",
    comment: "text-gray-500",
    type: "text-cyan-400",
    number: "text-orange-400",
    decorator: "text-yellow-400",
    func: "text-blue-400",
  },
  kotlin: {
    keyword: "text-orange-400",
    string: "text-green-400",
    comment: "text-gray-500",
    type: "text-cyan-400",
    number: "text-purple-400",
    decorator: "text-yellow-400",
    func: "text-blue-400",
  },
  dart: {
    keyword: "text-blue-400",
    string: "text-green-400",
    comment: "text-gray-500",
    type: "text-cyan-400",
    number: "text-orange-400",
    decorator: "text-yellow-400",
    func: "text-purple-400",
  },
  typescript: {
    keyword: "text-blue-400",
    string: "text-green-400",
    comment: "text-gray-500",
    type: "text-cyan-400",
    number: "text-orange-400",
    decorator: "text-yellow-400",
    func: "text-purple-400",
  },
};

const KEYWORDS: Record<string, string[]> = {
  swift: [
    "import", "struct", "class", "enum", "protocol", "func", "var", "let",
    "if", "else", "for", "while", "switch", "case", "return", "guard",
    "self", "Self", "true", "false", "nil", "some", "private", "public",
    "internal", "static", "mutating", "override", "init", "deinit",
    "typealias", "extension", "where", "in", "as", "is", "try", "catch",
    "throw", "throws", "async", "await", "actor",
  ],
  kotlin: [
    "import", "class", "object", "interface", "fun", "val", "var",
    "if", "else", "for", "while", "when", "return", "this", "super",
    "true", "false", "null", "private", "public", "internal", "protected",
    "override", "abstract", "open", "data", "sealed", "companion",
    "suspend", "inline", "crossinline", "noinline", "by", "lazy",
    "package", "annotation",
  ],
  dart: [
    "import", "class", "extends", "implements", "mixin", "void", "var",
    "final", "const", "if", "else", "for", "while", "switch", "case",
    "return", "this", "super", "true", "false", "null", "new",
    "static", "abstract", "override", "async", "await", "yield",
    "late", "required", "get", "set", "factory", "enum", "typedef",
  ],
  typescript: [
    "import", "export", "from", "class", "interface", "type", "function",
    "const", "let", "var", "if", "else", "for", "while", "switch", "case",
    "return", "this", "true", "false", "null", "undefined", "new",
    "async", "await", "default", "extends", "implements",
  ],
};

function highlightLine(line: string, lang: string): JSX.Element[] {
  const colors = SYNTAX_COLORS[lang] || SYNTAX_COLORS.typescript;
  const kws = KEYWORDS[lang] || [];
  const elements: JSX.Element[] = [];
  let remaining = line;
  let key = 0;

  while (remaining.length > 0) {
    if (remaining.startsWith("//")) {
      elements.push(<span key={key++} className={colors.comment}>{remaining}</span>);
      break;
    }

    if (remaining.startsWith("/*")) {
      const end = remaining.indexOf("*/");
      if (end >= 0) {
        elements.push(<span key={key++} className={colors.comment}>{remaining.slice(0, end + 2)}</span>);
        remaining = remaining.slice(end + 2);
        continue;
      }
      elements.push(<span key={key++} className={colors.comment}>{remaining}</span>);
      break;
    }

    if (remaining[0] === '"' || remaining[0] === "'" || remaining[0] === '`') {
      const quote = remaining[0];
      let i = 1;
      while (i < remaining.length) {
        if (remaining[i] === '\\') { i += 2; continue; }
        if (remaining[i] === quote) { i++; break; }
        i++;
      }
      elements.push(<span key={key++} className={colors.string}>{remaining.slice(0, i)}</span>);
      remaining = remaining.slice(i);
      continue;
    }

    if (remaining[0] === '@') {
      const m = remaining.match(/^@\w+/);
      if (m) {
        elements.push(<span key={key++} className={colors.decorator}>{m[0]}</span>);
        remaining = remaining.slice(m[0].length);
        continue;
      }
    }

    const numMatch = remaining.match(/^\d+(\.\d+)?/);
    if (numMatch && (key === 0 || /[\s(,=+\-*/<>[\]{}:]/.test(line[line.length - remaining.length - 1] || ' '))) {
      elements.push(<span key={key++} className={colors.number}>{numMatch[0]}</span>);
      remaining = remaining.slice(numMatch[0].length);
      continue;
    }

    const wordMatch = remaining.match(/^[A-Za-z_]\w*/);
    if (wordMatch) {
      const word = wordMatch[0];
      if (kws.includes(word)) {
        elements.push(<span key={key++} className={colors.keyword + " font-semibold"}>{word}</span>);
      } else if (word[0] === word[0].toUpperCase() && word[0] !== '_') {
        elements.push(<span key={key++} className={colors.type}>{word}</span>);
      } else if (remaining.length > word.length && remaining[word.length] === '(') {
        elements.push(<span key={key++} className={colors.func}>{word}</span>);
      } else {
        elements.push(<span key={key++} className="text-gray-200">{word}</span>);
      }
      remaining = remaining.slice(word.length);
      continue;
    }

    elements.push(<span key={key++} className="text-gray-400">{remaining[0]}</span>);
    remaining = remaining.slice(1);
  }

  return elements;
}

function getProjectFileList(files: FileNode[]): Array<{ path: string; content: string }> {
  return flattenFiles(files)
    .filter((f) => f.content !== undefined && f.path.startsWith("/project/"))
    .map((f) => ({ path: f.path, content: f.content || "" }));
}

export function CodePreview({ files, framework, projectId, mainEntryFile }: CodePreviewProps) {
  const projectFiles = useMemo(() => getProjectFileList(files), [files]);
  const [selectedFile, setSelectedFile] = useState(mainEntryFile);

  useEffect(() => {
    setSelectedFile(mainEntryFile);
  }, [mainEntryFile]);
  const [downloading, setDownloading] = useState(false);

  const currentFile = useMemo(
    () => projectFiles.find((f) => f.path === selectedFile) || projectFiles[0],
    [projectFiles, selectedFile]
  );

  const lang = useMemo(() => getLanguageId(selectedFile), [selectedFile]);

  const lines = useMemo(
    () => (currentFile?.content || "").split("\n"),
    [currentFile]
  );

  const handleDownload = async () => {
    if (!projectId || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/export`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-${projectId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setDownloading(false);
    }
  };

  const frameworkInfo = framework === "swiftui"
    ? { label: "SwiftUI", ide: "Xcode", icon: "🍎" }
    : { label: "Kotlin Compose", ide: "Android Studio", icon: "🤖" };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e] text-gray-200" data-testid="code-preview-panel">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-300 dark:border-[#333] bg-slate-100 dark:bg-[#252526]">
        <FileCode className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">
          {frameworkInfo.icon} {frameworkInfo.label} Preview
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 border-slate-400 dark:border-[#555] bg-slate-100 dark:bg-[#2d2d2d] hover:bg-slate-300 dark:hover:bg-[#3d3d3d] text-gray-200"
          onClick={handleDownload}
          disabled={downloading || !projectId}
          data-testid="button-download-project"
        >
          <Download className="w-3 h-3" />
          {downloading ? "Exporting..." : `Open in ${frameworkInfo.ide}`}
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-48 border-r border-slate-300 dark:border-[#333] bg-slate-100 dark:bg-[#252526] overflow-y-auto shrink-0" data-testid="code-preview-file-list">
          {projectFiles.map((f) => {
            const displayPath = f.path.replace(/^\/project\//, "");
            const isSelected = f.path === selectedFile;
            return (
              <button
                key={f.path}
                className={`w-full text-left px-3 py-1.5 text-xs truncate flex items-center gap-1 transition-colors ${
                  isSelected
                    ? "bg-slate-200 dark:bg-[#37373d] text-white"
                    : "text-gray-400 hover:bg-slate-200 dark:hover:bg-[#2a2d2e] hover:text-gray-200"
                }`}
                onClick={() => setSelectedFile(f.path)}
                data-testid={`code-preview-file-${displayPath}`}
              >
                <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${isSelected ? "rotate-90" : ""}`} />
                <span className="truncate">{displayPath}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-auto" data-testid="code-preview-content">
          <div className="p-0 font-mono text-xs leading-5">
            {lines.map((line, i) => (
              <div key={i} className="flex hover:bg-slate-200 dark:hover:bg-[#2a2d2e]">
                <span className="inline-block w-10 text-right pr-3 text-gray-600 select-none shrink-0 bg-white dark:bg-[#1e1e1e]">
                  {i + 1}
                </span>
                <span className="pl-2 whitespace-pre">{highlightLine(line, lang)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-3 py-2 border-t border-slate-300 dark:border-[#333] bg-slate-100 dark:bg-[#252526]">
        <p className="text-[10px] text-gray-500 text-center">
          {frameworkInfo.label} projects require {frameworkInfo.ide} for live preview. Download the project to run it locally.
        </p>
      </div>
    </div>
  );
}
