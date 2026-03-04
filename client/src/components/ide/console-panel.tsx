import { useEffect, useRef } from "react";
import { useIDEStore, type ConsoleEntry } from "@/stores/ide-store";
import { Button } from "@/components/ui/button";
import {
  Trash2,
  Terminal,
  AlertTriangle,
  XCircle,
  Info,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

function ConsoleEntryRow({ entry }: { entry: ConsoleEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const levelConfig = {
    log: {
      icon: <Terminal className="w-3 h-3 shrink-0" />,
      color: "text-foreground",
      bg: "",
    },
    info: {
      icon: <Info className="w-3 h-3 shrink-0" />,
      color: "text-blue-400",
      bg: "",
    },
    warn: {
      icon: <AlertTriangle className="w-3 h-3 shrink-0" />,
      color: "text-yellow-400",
      bg: "bg-yellow-500/5",
    },
    error: {
      icon: <XCircle className="w-3 h-3 shrink-0" />,
      color: "text-red-400",
      bg: "bg-red-500/5",
    },
  };

  const config = levelConfig[entry.level];

  return (
    <div
      className={cn(
        "flex items-start gap-2 px-3 py-1 font-mono text-xs border-b border-border/20 hover:bg-muted/20 transition-colors",
        config.bg
      )}
      data-testid={`console-entry-${entry.id}`}
    >
      <span className="text-muted-foreground/50 shrink-0 select-none pt-px">
        {time}
      </span>
      <span className={cn("shrink-0 pt-px", config.color)}>{config.icon}</span>
      <span className={cn("break-all whitespace-pre-wrap", config.color)}>
        {entry.message}
      </span>
    </div>
  );
}

export function ConsolePanel() {
  const { consoleEntries, clearConsole, toggleConsole } =
    useIDEStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [consoleEntries]);

  const errorCount = consoleEntries.filter((e) => e.level === "error").length;
  const warnCount = consoleEntries.filter((e) => e.level === "warn").length;

  return (
    <div className="h-full flex flex-col" data-testid="console-panel">
      <div className="flex items-center justify-between gap-2 px-3 h-9 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">Console</span>
          </div>

          {(errorCount > 0 || warnCount > 0) && (
            <div className="flex items-center gap-2">
              {errorCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-red-400" data-testid="text-error-count">
                  <XCircle className="w-3 h-3" />
                  {errorCount}
                </span>
              )}
              {warnCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-yellow-400" data-testid="text-warn-count">
                  <AlertTriangle className="w-3 h-3" />
                  {warnCount}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={clearConsole}
            aria-label="Clear console"
            data-testid="button-clear-console"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={toggleConsole}
            aria-label="Close console"
            data-testid="button-close-console"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" ref={scrollRef}>
        {consoleEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-muted-foreground/50 font-mono">
              No console output yet. Run your code to see results here.
            </p>
          </div>
        ) : (
          consoleEntries.map((entry) => (
            <ConsoleEntryRow key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}
