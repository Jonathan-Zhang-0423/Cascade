import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/loop/agent-loop", () => ({
  runAgentLoop: vi.fn(),
}));

vi.mock("../src/agent/providers/kimi-client", () => ({
  getFastClient: vi.fn(() => ({ client: { __id: "fast" }, model: "fast-model" })),
}));

import { runExploreAgent } from "../src/agent/orchestrator/explore-agent";
import { runAgentLoop } from "../src/agent/loop/agent-loop";
import { getFastClient } from "../src/agent/providers/kimi-client";

describe("explore agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the fast client with thinking disabled for lightweight scans", async () => {
    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      finalText: "React app with App.tsx entry point.",
    });

    const result = await runExploreAgent(
      [{ path: "/project/src/App.tsx", content: "export function App() { return null; }" }],
      "Add a settings panel",
    );

    expect(result).toBe("React app with App.tsx entry point.");
    expect(getFastClient).toHaveBeenCalledTimes(1);
    expect(runAgentLoop).toHaveBeenCalledTimes(1);

    const callArgs = (runAgentLoop as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = callArgs[5] as Record<string, unknown>;
    expect(opts.client).toEqual({ __id: "fast" });
    expect(opts.model).toBe("fast-model");
    expect(opts.disableThinking).toBe(true);
    expect(opts.phase).toBe("manager");
  });
});
