import { describe, expect, it } from "vitest";
import { EDITOR_AGENT_SYSTEM_PROMPT } from "../src/agent/prompts/editor-prompt";

describe("editor prompt", () => {
  it("keeps the build completion protocol explicit and compact", () => {
    expect(EDITOR_AGENT_SYSTEM_PROMPT).toContain("update_project_memory once");
    expect(EDITOR_AGENT_SYSTEM_PROMPT).toContain("submit_interaction_script");
    expect(EDITOR_AGENT_SYSTEM_PROMPT).toContain("Call finish_build only after");
    expect(EDITOR_AGENT_SYSTEM_PROMPT.length).toBeLessThan(5000);
  });

  it("does not include rejected demo-script selector examples", () => {
    expect(EDITOR_AGENT_SYSTEM_PROMPT).not.toContain(".todo-item");
    expect(EDITOR_AGENT_SYSTEM_PROMPT).not.toContain(".game-board");
    expect(EDITOR_AGENT_SYSTEM_PROMPT).toContain("Avoid CSS-like selectors");
  });
});
