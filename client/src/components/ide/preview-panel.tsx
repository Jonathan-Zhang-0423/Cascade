import { useIDEStore, findFileContent } from "@/stores/ide-store";
import { useMemo, useState } from "react";
import { Globe, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PreviewPanel() {
  const { files } = useIDEStore();
  const [refreshKey, setRefreshKey] = useState(0);

  const htmlContent = useMemo(() => {
    return findFileContent(files, "/project/index.html") || "";
  }, [files, refreshKey]);

  return (
    <div className="h-full flex flex-col bg-background" data-testid="preview-panel">
      <div className="flex items-center justify-between gap-2 px-3 h-10 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Preview
          </span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setRefreshKey((k) => k + 1)}
          aria-label="Refresh preview"
          data-testid="button-refresh-preview"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 bg-white">
        <iframe
          key={refreshKey}
          srcDoc={htmlContent}
          className="w-full h-full border-0"
          title="Preview"
          sandbox="allow-scripts allow-modals"
          data-testid="preview-iframe"
        />
      </div>
    </div>
  );
}
