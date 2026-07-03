import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dockerode", () => {
  class DockerMock {
    getImage() {
      return {
        inspect: vi.fn(() => new Promise(() => {})),
      };
    }
  }
  return { default: DockerMock };
});

describe("ShellManager timeout behavior", () => {
  const previousEnableShell = process.env.ENABLE_SHELL;

  afterEach(() => {
    vi.resetModules();
    if (previousEnableShell === undefined) delete process.env.ENABLE_SHELL;
    else process.env.ENABLE_SHELL = previousEnableShell;
  });

  it("bounds sandbox image preparation by the command timeout", async () => {
    process.env.ENABLE_SHELL = "true";
    vi.resetModules();
    const { ShellManager } = await import("../src/agent/tools/shell-manager");
    const manager = new ShellManager();

    await manager.createShell("sess-1", "/tmp/cascade-shell-timeout-test", "web");

    const start = Date.now();
    const result = await manager.runCommand("sess-1", "node --version", 50);

    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("timed out");
    expect(result.stderr).toContain("preparing sandbox image");
  });
});
