import { useLanguageStore, type Lang } from "@/stores/language-store";
import { cn } from "@/lib/utils";

export function LangToggle({ className }: { className?: string }) {
  const { lang, setLang } = useLanguageStore();

  return (
    <div
      className={cn(
        "flex items-center h-7 rounded-md border border-border/60 bg-muted/40 overflow-hidden text-xs font-medium select-none",
        className
      )}
      data-testid="lang-toggle"
    >
      <button
        className={cn(
          "px-2 h-full transition-colors",
          lang === "en"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => setLang("en")}
        data-testid="lang-toggle-en"
        aria-label="Switch to English"
      >
        EN
      </button>
      <div className="w-px h-4 bg-border/60" />
      <button
        className={cn(
          "px-2 h-full transition-colors",
          lang === "zh"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => setLang("zh")}
        data-testid="lang-toggle-zh"
        aria-label="切换到中文"
      >
        中
      </button>
    </div>
  );
}
