import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ChatErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ChatErrorBoundary]", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center"
          data-testid="chat-error-boundary"
        >
          <AlertTriangle className="w-8 h-8 text-destructive/70" />
          <p className="text-sm text-muted-foreground max-w-[240px]">
            {this.props.fallbackMessage || "Something went wrong in the chat panel."}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={this.handleReset}
            data-testid="button-retry-chat"
          >
            <RotateCcw className="w-3 h-3" />
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
