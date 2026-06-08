import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildShellTools } from "../src/agent/tools/shell-tools";
import type { BuildSessionState } from "../src/agent/orchestrator/build-orchestrator";

vi.mock("../src/agent/tools/shell-manager", () => ({
  shellManager: {
    runCommand: vi.fn(),
  },
}));

import { shellManager } from "../src/agent/tools/shell-manager";
import { execSync } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

function makeSession(): BuildSessionState {
  return {
    id: "shell-test",
    aborted: false,
    files: new Map(),
    plan: { steps: [] },
    userRequest: "test",
    userLang: "English",
    events: [],
    nextEventId: 1,
    done: false,
    sseWriters: new Set(),
    parts: [],
    status: { type: "idle" },
  };
}

const noopEmit = () => {};

describe("shell_run", () => {
  // shell_run early-returns when ENABLE_SHELL is unset (never calling shellManager).
  // Tests that exercise the command path enable it; the "disabled" test unsets it.
  const prevEnableShell = process.env.ENABLE_SHELL;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_SHELL = "true";
  });
  afterEach(() => {
    if (prevEnableShell === undefined) delete process.env.ENABLE_SHELL;
    else process.env.ENABLE_SHELL = prevEnableShell;
  });

  it("returns stdout, stderr, and exit code on success", async () => {
    vi.mocked(shellManager.runCommand).mockResolvedValue({
      stdout: "Compilation complete.\n",
      stderr: "",
      exitCode: 0,
    });

    const { handlers } = buildShellTools(makeSession());
    const result = await handlers.shell_run({ command: "tsc --noEmit" }, noopEmit);

    expect(result).toContain("stdout:");
    expect(result).toContain("Compilation complete.");
    expect(result).toContain("exit code: 0");
  });

  it("includes stderr in output when present", async () => {
    vi.mocked(shellManager.runCommand).mockResolvedValue({
      stdout: "",
      stderr: "error TS2304: Cannot find name 'x'.\n",
      exitCode: 1,
    });

    const { handlers } = buildShellTools(makeSession());
    const result = await handlers.shell_run({ command: "tsc --noEmit" }, noopEmit);

    expect(result).toContain("stderr:");
    expect(result).toContain("Cannot find name 'x'");
    expect(result).toContain("exit code: 1");
  });

  it("returns ENABLE_SHELL disabled message when shell is not enabled", async () => {
    delete process.env.ENABLE_SHELL;

    const { handlers } = buildShellTools(makeSession());
    const result = await handlers.shell_run({ command: "npm test" }, noopEmit);

    expect(result).toContain("ENABLE_SHELL is not set");
    expect(result).toContain("Skipping shell execution");
    expect(shellManager.runCommand).not.toHaveBeenCalled();
  });

  it("returns error when command is empty string", async () => {
    const { handlers } = buildShellTools(makeSession());
    const result = await handlers.shell_run({ command: "" }, noopEmit);

    expect(result).toBe("Error: command is required");
    expect(shellManager.runCommand).not.toHaveBeenCalled();
  });

  it("passes timeout_ms to shellManager when provided", async () => {
    vi.mocked(shellManager.runCommand).mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });

    const { handlers } = buildShellTools(makeSession());
    await handlers.shell_run({ command: "npm test", timeout_ms: 60000 }, noopEmit);

    expect(shellManager.runCommand).toHaveBeenCalledWith("shell-test", "npm test", 60000);
  });
});
