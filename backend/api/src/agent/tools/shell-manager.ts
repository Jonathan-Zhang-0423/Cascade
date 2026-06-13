import Docker from "dockerode";
import path from "path";
import type { Framework } from "../../compiler/framework-detector";

const SANDBOX_IMAGE_DEFAULT = "node:20-slim";
const SANDBOX_IMAGE_FLUTTER = "ghcr.io/cirruslabs/flutter:stable";

const COMMAND_TIMEOUT_DEFAULT = 30_000; // 30s
const COMMAND_TIMEOUT_MAX = 120_000;    // 2 min hard cap

interface ShellSession {
  sessionDir: string;
  framework?: Framework;
}

class ShellManager {
  private docker: Docker | null = null;
  private sessions = new Map<string, ShellSession>();
  private enabled = process.env.ENABLE_SHELL === "true";
  // Per-image readiness: an in-flight/resolved promise so we pull each sandbox
  // image at most once. A missing image otherwise makes createContainer throw a
  // cryptic "(HTTP code 404) no such image" that surfaces to the agent as a
  // useless "Shell error:". The first command for a framework pays the pull;
  // subsequent ones are instant.
  private imageReady = new Map<string, Promise<void>>();

  constructor() {
    if (this.enabled) {
      try {
        this.docker = new Docker();
      } catch (err) {
        console.warn("[ShellManager] Docker not available:", err instanceof Error ? err.message : err);
        this.enabled = false;
      }
    }
  }

  /** Register a session so it can run commands. Does not start a container yet
   *  (containers are created per-command for simplicity and isolation). */
  async createShell(sessionId: string, sessionDir: string, framework?: Framework): Promise<void> {
    if (!this.enabled) return;
    this.sessions.set(sessionId, { sessionDir, framework });
  }

  /**
   * Ensure a sandbox image is present locally, pulling it once if missing.
   * Memoized per image so concurrent/repeat commands don't trigger parallel
   * pulls. Throws a clear error if the pull fails (e.g. no registry access).
   */
  private async ensureImage(image: string): Promise<void> {
    if (!this.docker) throw new Error("Docker not available");
    let ready = this.imageReady.get(image);
    if (!ready) {
      ready = (async () => {
        const docker = this.docker!;
        try {
          await docker.getImage(image).inspect();
          return; // already present
        } catch {
          // Not present — pull it.
        }
        const stream = await docker.pull(image);
        await new Promise<void>((resolve, reject) => {
          docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
        });
      })();
      this.imageReady.set(image, ready);
    }
    try {
      await ready;
    } catch (err) {
      // Don't cache a failed pull — allow a later retry.
      this.imageReady.delete(image);
      throw err;
    }
  }

  /**
   * Run a shell command inside a sandboxed Docker container.
   * The container is created, runs the command, and is removed immediately.
   * The session directory is bind-mounted as /workspace.
   */
  async runCommand(
    sessionId: string,
    command: string,
    timeoutMs = COMMAND_TIMEOUT_DEFAULT,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.enabled || !this.docker) {
      return { stdout: "", stderr: "Shell execution is not enabled (set ENABLE_SHELL=true).", exitCode: 1 };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return { stdout: "", stderr: "Shell session not found.", exitCode: 1 };
    }

    const cappedTimeout = Math.min(timeoutMs, COMMAND_TIMEOUT_MAX);
    const image = session.framework === "flutter" ? SANDBOX_IMAGE_FLUTTER : SANDBOX_IMAGE_DEFAULT;

    let container: Docker.Container | null = null;
    try {
      // Pull the sandbox image on first use so a missing image doesn't surface
      // as a cryptic Docker 404. Bounded by the command timeout budget.
      try {
        await this.ensureImage(image);
      } catch (pullErr) {
        const m = pullErr instanceof Error ? pullErr.message : String(pullErr);
        return { stdout: "", stderr: `Sandbox image "${image}" is unavailable (pull failed: ${m}). Shell commands can't run until it's pulled.`, exitCode: 1 };
      }
      container = await this.docker.createContainer({
        Image: image,
        Cmd: ["sh", "-c", command],
        WorkingDir: "/workspace",
        HostConfig: {
          Binds: [`${session.sessionDir}:/workspace:rw`],
          NetworkMode: "none",
          Memory: 512 * 1024 * 1024,      // 512 MB
          NanoCpus: 500_000_000,           // 0.5 CPU
          ReadonlyRootfs: false,
          AutoRemove: false,               // we remove manually after reading logs
        },
        AttachStdout: true,
        AttachStderr: true,
      });

      await container.start();

      // Wait for container to finish (with timeout)
      const statusCode = await Promise.race<number>([
        container.wait().then((r: { StatusCode: number }) => r.StatusCode),
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error(`Command timed out after ${cappedTimeout}ms`)), cappedTimeout),
        ),
      ]);

      // Collect logs
      const logBuffer = await container.logs({ stdout: true, stderr: true, follow: false });
      const { stdout, stderr } = demuxDockerStream(logBuffer as Buffer);

      return { stdout, stderr, exitCode: statusCode };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { stdout: "", stderr: `Shell error: ${message}`, exitCode: 1 };
    } finally {
      if (container) {
        container.remove({ force: true }).catch(() => {});
      }
    }
  }

  /** Remove the shell session. Containers are already cleaned up per-command. */
  async destroyShell(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

/**
 * Docker log streams have an 8-byte header per frame: [stream_type, 0, 0, 0, size(4 bytes)].
 * stream_type: 1 = stdout, 2 = stderr.
 */
function demuxDockerStream(buffer: Buffer): { stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    const frameSize = buffer.readUInt32BE(offset + 4);
    const frameEnd = offset + 8 + frameSize;
    if (frameEnd > buffer.length) break;
    const chunk = buffer.slice(offset + 8, frameEnd).toString("utf-8");
    if (streamType === 1) stdout += chunk;
    else if (streamType === 2) stderr += chunk;
    offset = frameEnd;
  }
  return { stdout, stderr };
}

export const shellManager = new ShellManager();
