import { diffLines } from "diff";
import { cn } from "@/lib/utils";

interface InlineDiffViewProps {
  oldContent: string;
  newContent: string;
}

export function InlineDiffView({ oldContent, newContent }: InlineDiffViewProps) {
  const changes = diffLines(oldContent, newContent);

  // If there are no real changes, show a simple message
  const hasChanges = changes.some((c) => c.added || c.removed);
  if (!hasChanges) {
    return (
      <div className="text-[10px] text-muted-foreground/50 px-2 py-1 italic">
        No line-level changes detected.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-sm border border-border/30 bg-muted/20 text-[10px] font-mono leading-relaxed max-h-[200px] overflow-y-auto">
      {changes.map((part, i) => {
        if (!part.added && !part.removed) {
          // Context lines — show up to 2 lines of unchanged context
          const lines = part.value.split("\n").filter((_, idx, arr) =>
            idx < 2 || idx >= arr.length - 3
          );
          if (lines.length === 0) return null;
          return (
            <div key={i}>
              {lines.slice(0, 2).map((line, j) => (
                <div key={j} className="px-2 text-muted-foreground/40">
                  {" " + line}
                </div>
              ))}
            </div>
          );
        }
        const lines = part.value.split("\n");
        // Remove trailing empty line from split
        if (lines[lines.length - 1] === "") lines.pop();
        return (
          <div key={i}>
            {lines.map((line, j) => (
              <div
                key={j}
                className={cn(
                  "px-2 whitespace-pre",
                  part.added
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-red-500/10 text-red-400 line-through opacity-70"
                )}
              >
                {(part.added ? "+ " : "- ") + line}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
