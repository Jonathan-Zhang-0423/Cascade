import { mkdir, rename, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

export interface IVideoStorage {
  save(videoId: string, srcPath: string): Promise<string>;
  delete(storagePath: string): Promise<void>;
  getDownloadUrl(storagePath: string): string;
  getLocalPath(storagePath: string): string | null;
}

const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR ?? "/data/videos";

export class LocalVideoStorage implements IVideoStorage {
  private readonly dir: string;
  constructor(dir = VIDEO_DIR) { this.dir = dir; }

  async save(videoId: string, srcPath: string): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const dest = join(this.dir, `${videoId}.mp4`);
    await rename(srcPath, dest);
    return dest;
  }

  async delete(storagePath: string): Promise<void> {
    await rm(storagePath, { force: true });
  }

  getDownloadUrl(storagePath: string): string {
    const filename = storagePath.split("/").pop() ?? "";
    const videoId = filename.replace(/\.mp4$/, "");
    return `/api/video/file/${videoId}`;
  }

  getLocalPath(storagePath: string): string | null {
    return existsSync(storagePath) ? storagePath : null;
  }
}

// COS stub — activate after: npm install cos-nodejs-sdk-v5
// Set env: COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
// Then replace `export const videoStorage` below with new CosVideoStorage()
//
// export class CosVideoStorage implements IVideoStorage { ... }

export const videoStorage: IVideoStorage = new LocalVideoStorage();
