import { mkdir, rename, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IVideoStorage {
  /** 将生成好的 MP4 持久化，返回可用于后续访问的标识（本地为相对路径，COS 为完整 URL） */
  save(videoId: string, srcPath: string): Promise<string>;
  /** 删除已持久化的视频 */
  delete(storagePath: string): Promise<void>;
  /** 获取可供客户端下载的 URL（本地实现返回 API 路径，COS 实现返回签名 URL） */
  getDownloadUrl(storagePath: string): string;
  /** 获取文件在磁盘上的绝对路径（仅本地实现有效；COS 实现返回 null） */
  getLocalPath(storagePath: string): string | null;
}

// ─── Local implementation ─────────────────────────────────────────────────────

const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR ?? "/data/videos";

export class LocalVideoStorage implements IVideoStorage {
  private readonly dir: string;

  constructor(dir = VIDEO_DIR) {
    this.dir = dir;
  }

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
    // storagePath is the absolute local path; extract the videoId from filename
    const filename = storagePath.split("/").pop() ?? "";
    const videoId = filename.replace(/\.mp4$/, "");
    return `/api/video/file/${videoId}`;
  }

  getLocalPath(storagePath: string): string | null {
    return existsSync(storagePath) ? storagePath : null;
  }
}

// ─── COS implementation (stub — user fills in after adding cos-nodejs-sdk-v5) ─
//
// To activate:
// 1. npm install cos-nodejs-sdk-v5
// 2. Set env vars: COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
// 3. Uncomment the class below and change `export const videoStorage` to use it.
//
// export class CosVideoStorage implements IVideoStorage {
//   private cos: any;
//   private bucket = process.env.COS_BUCKET!;
//   private region = process.env.COS_REGION!;
//
//   constructor() {
//     const COS = require("cos-nodejs-sdk-v5");
//     this.cos = new COS({
//       SecretId: process.env.COS_SECRET_ID,
//       SecretKey: process.env.COS_SECRET_KEY,
//     });
//   }
//
//   async save(videoId: string, srcPath: string): Promise<string> {
//     const key = `videos/${videoId}.mp4`;
//     await new Promise<void>((resolve, reject) => {
//       this.cos.uploadFile(
//         { Bucket: this.bucket, Region: this.region, Key: key, FilePath: srcPath },
//         (err: unknown) => (err ? reject(err) : resolve()),
//       );
//     });
//     await rm(srcPath, { force: true });
//     return key; // storagePath is the COS key
//   }
//
//   async delete(storagePath: string): Promise<void> {
//     await new Promise<void>((resolve, reject) => {
//       this.cos.deleteObject(
//         { Bucket: this.bucket, Region: this.region, Key: storagePath },
//         (err: unknown) => (err ? reject(err) : resolve()),
//       );
//     });
//   }
//
//   getDownloadUrl(storagePath: string): string {
//     return `https://${this.bucket}.cos.${this.region}.myqcloud.com/${storagePath}`;
//   }
//
//   getLocalPath(_storagePath: string): string | null {
//     return null; // files are in COS, not local disk
//   }
// }

// ─── Singleton ────────────────────────────────────────────────────────────────

export const videoStorage: IVideoStorage = new LocalVideoStorage();
