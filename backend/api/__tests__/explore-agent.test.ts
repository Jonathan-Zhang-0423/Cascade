import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/loop/agent-loop", () => ({
  runAgentLoop: vi.fn(),
}));

vi.mock("../src/agent/providers/agent-model-router", () => ({
  resolveAgentModel: vi.fn(() => ({ client: { __id: "explorer" }, model: "explorer-model", provider: "minimax" })),
}));

import { runExploreAgent } from "../src/agent/orchestrator/explore-agent";
import { runAgentLoop } from "../src/agent/loop/agent-loop";
import { resolveAgentModel } from "../src/agent/providers/agent-model-router";

describe("explore agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the explorer model with thinking disabled for lightweight scans", async () => {
    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      finalText: "React app with App.tsx entry point.",
    });

    const result = await runExploreAgent(
      [{ path: "/project/src/App.tsx", content: "export function App() { return null; }" }],
      "Add a settings panel",
    );

    expect(result).toBe("React app with App.tsx entry point.");
    expect(resolveAgentModel).toHaveBeenCalledWith("explorer", "glm");
    expect(runAgentLoop).toHaveBeenCalledTimes(1);

    const callArgs = (runAgentLoop as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = callArgs[5] as Record<string, unknown>;
    expect(opts.client).toEqual({ __id: "explorer" });
    expect(opts.model).toBe("explorer-model");
    expect(opts.disableThinking).toBe(true);
    expect(opts.phase).toBe("research");
  });
});
