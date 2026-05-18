import type { ToolSchema, ToolHandler } from "../loop/agent-loop";
import type { BuildSessionState } from "../orchestrator/build-orchestrator";
import { shellManager } from "./shell-manager";

export function buildShellTools(session: BuildSessionState): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "shell_run",
        description:
          "Run a shell command in a sandboxed environment with the project files available at /workspace. Use this to compile code (tsc --noEmit), run tests (npm test), or check for runtime errors. Requires ENABLE_SHELL=true.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Shell command to execute, e.g. 'tsc --noEmit' or 'npm test'",
            },
            timeout_ms: {
              type: "number",
              description: "Max execution time in milliseconds (default 30000, max 120000)",
            },
          },
          required: ["command"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    shell_run: async (args, emit) => {
      const command = args.command as string;
      const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : undefined;

      if (!command) return "Error: command is required";

      if (!process.env.ENABLE_SHELL) {
        return "shell_run is unavailable: ENABLE_SHELL is not set. Skipping shell execution — proceed with static analysis only.";
      }

      emit({ type: "action_log", actionType: "file_write", label: "Shell", detail: command });

      const result = await shellManager.runCommand(session.id, command, timeoutMs);

      const parts: string[] = [];
      if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.trim()}`);
      if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trim()}`);
      parts.push(`exit code: ${result.exitCode}`);
      return parts.join("\n\n");
    },
  };

  return { schemas, handlers };
}
