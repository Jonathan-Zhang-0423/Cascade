import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";
import { useLanguageStore } from "@/stores/language-store";

function t(key: string) {
  return tr(useLanguageStore.getState().lang, key);
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-screen flex items-center justify-center bg-background p-6">
          <div className="flex flex-col items-center gap-4 text-center max-w-md">
            <AlertTriangle className="w-10 h-10 text-destructive/70" />
            <p className="text-base text-muted-foreground">
              {t("error.appCrash")}
            </p>
            {this.state.error?.message && (
              <pre className="text-[11px] text-muted-foreground/60 max-w-full overflow-auto whitespace-pre-wrap break-words font-mono px-3 py-2 rounded bg-muted/30 border border-border/40">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={this.handleReset} className="gap-1.5">
                <RotateCcw className="w-3 h-3" />
                {t("error.retry")}
              </Button>
              <Button size="sm" onClick={this.handleReload}>
                {t("error.appCrashReload")}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
