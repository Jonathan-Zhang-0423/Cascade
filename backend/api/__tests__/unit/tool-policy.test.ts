import { describe, expect, it } from "vitest";
import {
  compactToolResultForPolicy,
  inferToolPolicy,
  shouldRunToolInParallel,
} from "../../src/agent/runtime/tool-policy";

describe("tool policy", () => {
  it("allows read/search/network tools to parallelize and keeps mutating tools serial", () => {
    expect(shouldRunToolInParallel(inferToolPolicy("read_file"))).toBe(true);
    expect(shouldRunToolInParallel(inferToolPolicy("grep"))).toBe(true);
    expect(shouldRunToolInParallel(inferToolPolicy("mcp_search"))).toBe(true);

    expect(shouldRunToolInParallel(inferToolPolicy("write_file"))).toBe(false);
    expect(shouldRunToolInParallel(inferToolPolicy("delete_file"))).toBe(false);
    expect(shouldRunToolInParallel(inferToolPolicy("shell_run"))).toBe(false);
    expect(shouldRunToolInParallel(inferToolPolicy("update_project_memory"))).toBe(false);
  });

  it("compacts aggressive results more tightly than standard read results", () => {
    const large = "x".repeat(20_000);
    const shell = compactToolResultForPolicy(large, inferToolPolicy("shell_run"));
    const read = compactToolResultForPolicy(large, inferToolPolicy("read_file"));

    expect(shell.length).toBeLessThan(read.length);
    expect(shell).toContain("truncated by shell tool policy");
    expect(read).toContain("truncated by read tool policy");
  });
});
