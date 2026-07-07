import { ObservableState } from "./observable-state";
import {
  type ManagerStreamState,
  type StoreActions,
  INITIAL_MANAGER_STREAM_STATE,
} from "./types";

/**
 * Stubbed after removing the agent loop. The old IDE may still import this
 * shape, but it must not open manager-chat sessions anymore.
 */
export class ManagerStreamInstance {
  readonly projectId: string;
  readonly chatSessionId: string;
  readonly state: ObservableState<ManagerStreamState>;
  autoExecutePlan = false;

  constructor(projectId: string, private readonly actions: StoreActions, chatSessionId: string = "main") {
    this.projectId = projectId;
    this.chatSessionId = chatSessionId;
    this.state = new ObservableState<ManagerStreamState>({ ...INITIAL_MANAGER_STREAM_STATE });
  }

  get isActive(): boolean {
    return false;
  }

  async send(_message: string): Promise<boolean> {
    this.actions.addManagerMessage({
      role: "assistant",
      content: "旧项目构建助手已下线。",
      source: "manager",
    });
    this.actions.setManagerResponding(false);
    return false;
  }

  abort(): void {
    this.actions.setManagerResponding(false);
  }

  resetLive(): void {
    this.state.reset({ ...INITIAL_MANAGER_STREAM_STATE });
    this.autoExecutePlan = false;
  }

  async attemptReconnect(): Promise<void> {
    this.resetLive();
  }

  dispose(): void {
    this.resetLive();
  }
}
