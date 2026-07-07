import { ObservableState } from "./observable-state";
import {
  type BuildStreamState,
  type StoreActions,
  INITIAL_BUILD_STREAM_STATE,
} from "./types";

/**
 * Stubbed after removing the agent loop. It preserves the old stream API for
 * stale IDE imports without calling build-session endpoints.
 */
export class BuildStreamInstance {
  readonly projectId: string;
  readonly chatSessionId: string;
  readonly state: ObservableState<BuildStreamState>;
  userConfirmation = "";

  constructor(projectId: string, private readonly actions: StoreActions, chatSessionId: string = "main") {
    this.projectId = projectId;
    this.chatSessionId = chatSessionId;
    this.state = new ObservableState<BuildStreamState>({ ...INITIAL_BUILD_STREAM_STATE });
  }

  get isActive(): boolean {
    return false;
  }

  get currentSessionId(): string | null {
    return null;
  }

  async execute(_opts?: { userMessage?: string }): Promise<void> {
    this.actions.addChatMessage({
      role: "assistant",
      content: "旧项目构建流程已下线。",
    });
    this.actions.setAiResponding(false);
    this.actions.setExecutingTaskIndex(null);
  }

  stop(): void {
    this.actions.setAiResponding(false);
    this.actions.setExecutingTaskIndex(null);
  }

  async attemptReconnect(): Promise<void> {
    this.resetLive();
  }

  restoreTaskStatuses(): void {}

  resetLive(): void {
    this.state.reset({ ...INITIAL_BUILD_STREAM_STATE });
  }

  dispose(): void {
    this.resetLive();
  }
}
