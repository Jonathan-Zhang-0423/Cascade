/**
 * Shared utilities for server-side compiler modules (rn-web, wechat-web, etc.)
 */

import { createHash } from "crypto";

/**
 * Deterministic hash of a set of source files.
 * Used as a cache key for compiled artifacts.
 */
export function hashSources(
  files: Array<{ path: string; content: string }>,
  extra?: string,
): string {
  const h = createHash("sha256");
  for (const f of files.sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path);
    h.update(f.content);
  }
  if (extra) h.update(extra);
  return h.digest("hex").slice(0, 16);
}
