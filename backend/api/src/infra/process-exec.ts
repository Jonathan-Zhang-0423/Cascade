import { spawn } from "child_process";

/**
 * Sandboxed child-process execution for the multi-language code runner.
 * Extracted from routes/index.ts so it can be shared between the run-file
 * route and the video (ffmpeg) startup check without duplicating the
 * timeout + output-cap logic.
 *
 * Run execution timeout (10s) applies to every script/binary execution phase.
 * Output is capped at MAX_OUTPUT_BYTES; processes exceeding either limit are
 * killed.
 */
export const EXEC_TIMEOUT_MS = 10_000;
export const MAX_OUTPUT_BYTES = 512 * 1024;

export function spawnProcess(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let totalBytes = 0;

    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const accumulate = (chunks: Buffer[], d: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - totalBytes;
      if (remaining <= 0) return;
      const slice = remaining < d.length ? d.subarray(0, remaining) : d;
      chunks.push(slice);
      totalBytes += slice.length;
      if (totalBytes >= MAX_OUTPUT_BYTES) {
        try { child.kill("SIGKILL"); } catch {}
      }
    };

    child.stdout?.on("data", (d: Buffer) => accumulate(outChunks, d));
    child.stderr?.on("data", (d: Buffer) => accumulate(errChunks, d));

    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        try { child.kill("SIGKILL"); } catch {}
      }
    }, opts.timeout ?? EXEC_TIMEOUT_MS);

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
        exitCode: code,
        timedOut,
      });
    };

    child.on("close", (code) => finish(code ?? 1));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: "", stderr: err.message, exitCode: 127, timedOut: false });
    });
  });
}
