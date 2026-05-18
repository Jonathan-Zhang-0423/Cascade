import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import { useIDEStore, findFileContent, getFileLanguage } from "@/stores/ide-store";
import { X, FileCode, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCallback } from "react";
import { useTheme } from "@/components/theme-provider";
import { getThemeConfig, THEMES } from "@/lib/themes";
import { useT } from "@/lib/i18n";

let themesRegistered = false;
let monacoTsConfigured = false;

function registerCustomThemes(monaco: Monaco) {
  if (themesRegistered) return;
  themesRegistered = true;
  for (const [id, config] of Object.entries(THEMES)) {
    if (config.customTheme) {
      monaco.editor.defineTheme(id, config.customTheme);
    }
  }
}

function configureTypeScript(monaco: Monaco) {
  if (monacoTsConfigured) return;
  monacoTsConfigured = true;

  const compilerOptions = {
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.Bundler,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    lib: ["ES2020", "DOM", "DOM.Iterable"],
    strict: false,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    allowJs: true,
    resolveJsonModule: true,
  };

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions as any);
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions as any);

  // Suppress "cannot find module" errors — we don't have node_modules in the browser
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,  // no node_modules in browser → all semantic errors are false positives
    noSyntaxValidation: false,   // keep syntax error highlighting
  });
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });
}

export function CodeEditor() {
  const { activeFile, openFiles, files, setActiveFile, closeFile, updateFileContent } =
    useIDEStore();
  const { themeId } = useTheme();
  const t = useT();

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    registerCustomThemes(monaco);
    configureTypeScript(monaco);
  }, []);

  const openCommandPalette = () => {
    const event = new KeyboardEvent("keydown", {
      key: "p",
      metaKey: true,
      ctrlKey: true,
      shiftKey: true,
    });
    document.dispatchEvent(event);
  };

  const content = activeFile ? findFileContent(files, activeFile) : "";
  const language = activeFile ? getFileLanguage(activeFile) : "plaintext";
  const themeConfig = getThemeConfig(themeId);

  const getFileName = (path: string) => path.split("/").pop() || path;

  return (
    <div className="h-full flex flex-col" data-testid="code-editor">
      {openFiles.length > 0 ? (
        <>
          <div
            className="flex items-center border-b border-[rgba(255,255,255,0.07)] shrink-0 overflow-x-auto h-9"
            role="tablist"
            aria-label={t("editor.openFiles")}
          >
            {openFiles.map((filePath) => (
              <div
                key={filePath}
                role="tab"
                aria-selected={filePath === activeFile}
                tabIndex={filePath === activeFile ? 0 : -1}
                className={cn(
                  "group flex items-center gap-1.5 px-3 h-full text-xs cursor-pointer border-r border-[rgba(255,255,255,0.05)] transition-colors min-w-fit",
                  filePath === activeFile
                    ? "bg-[#0c0c14] text-foreground"
                    : "bg-[rgba(255,255,255,0.02)] text-[#8888a8] hover:text-foreground hover:bg-[rgba(255,255,255,0.05)]"
                )}
                onClick={() => setActiveFile(filePath)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setActiveFile(filePath);
                  }
                }}
                data-testid={`tab-${getFileName(filePath)}`}
              >
                <FileCode className="w-3.5 h-3.5 shrink-0" />
                <span>{getFileName(filePath)}</span>
                <button
                  className="ml-1 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-[rgba(255,255,255,0.08)] p-0.5 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeFile(filePath);
                  }}
                  aria-label={t("editor.closeTab", { name: getFileName(filePath) })}
                  data-testid={`button-close-tab-${getFileName(filePath)}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              className="flex items-center justify-center h-full px-2 text-[#8888a8] hover:text-foreground hover:bg-[rgba(255,255,255,0.05)] transition-colors"
              onClick={openCommandPalette}
              aria-label={t("editor.openFile")}
              data-testid="button-open-file-palette"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 min-h-0">
            <Editor
              height="100%"
              language={language}
              value={content || ""}
              theme={themeConfig.monacoTheme}
              beforeMount={handleBeforeMount}
              onChange={(value) => {
                if (activeFile && value !== undefined) {
                  updateFileContent(activeFile, value);
                }
              }}
              options={{
                fontSize: 14,
                fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
                fontLigatures: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: "smooth",
                cursorSmoothCaretAnimation: "on",
                renderLineHighlight: "all",
                bracketPairColorization: { enabled: true },
                padding: { top: 12 },
                lineNumbers: "on",
                wordWrap: "on",
                tabSize: 2,
                automaticLayout: true,
              }}
            />
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center" data-testid="editor-empty">
          <div className="text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-[rgba(255,255,255,0.04)] flex items-center justify-center mx-auto">
              <FileCode className="w-7 h-7 text-[#484860]" />
            </div>
            <div>
              <p className="text-sm text-[#8888a8]">{t("editor.noFileOpen")}</p>
              <p className="text-xs text-[#484860]">
                {t("editor.selectFile")}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
