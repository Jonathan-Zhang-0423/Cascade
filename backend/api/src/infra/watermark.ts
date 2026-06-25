// FFmpeg watermark — pure text overlay, no external assets needed.
// Text: "Cascade AI" at bottom-right, white with black shadow.

import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { rename, rm } from "fs/promises";

const WM_TEXT = (process.env.WATERMARK_TEXT ?? "Cascade AI").replace(/'/g, "\\'");
const FONT_SIZE = 20;
const PADDING = 16;

function drawtextFilter(): string {
  return (
    `drawtext=text='${WM_TEXT}':` +
    `x=w-tw-${PADDING}:y=h-th-${PADDING}:` +
    `fontcolor=white:fontsize=${FONT_SIZE}:` +
    `shadowcolor=black@0.8:shadowx=2:shadowy=2`
  );
}

function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: "pipe" });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error(`ffmpeg timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Overlay watermark text onto an image (PNG/JPEG → PNG). */
export async function addImageWatermark(inputPath: string, outputPath: string): Promise<void> {
  const tmp = join(tmpdir(), `wm-img-${Date.now()}.png`);
  try {
    await runFfmpeg(["-y", "-i", inputPath, "-vf", drawtextFilter(), "-frames:v", "1", tmp]);
    await rename(tmp, outputPath);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Overlay watermark text onto a video (MP4 → MP4). */
export async function addVideoWatermark(inputPath: string, outputPath: string): Promise<void> {
  const tmp = join(tmpdir(), `wm-vid-${Date.now()}.mp4`);
  try {
    await runFfmpeg([
      "-y", "-i", inputPath,
      "-vf", drawtextFilter(),
      "-c:v", "libx264", "-crf", "23", "-preset", "fast",
      "-c:a", "copy",
      tmp,
    ]);
    await rename(tmp, outputPath);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
