/**
 * Inlines a web project's local CSS/JS files into a single HTML string for the
 * preview iframe's `srcDoc`. Extracted from preview-panel as a pure, dependency-
 * free function so it can be unit-tested in isolation.
 *
 * IMPORTANT: when inlining a local `<script src>`, the original tag's attributes
 * are preserved — especially `type="module"`. Previously every local script was
 * rewritten to a bare `<script>…</script>`, which dropped `type="module"` and
 * made any `import` statement throw "Cannot use import statement outside a
 * module" in the srcdoc iframe. Keeping the attributes lets module scripts +
 * import maps work, which is how 3D/WebGL (Three.js) games load libraries here.
 */

/** Minimal file-tree shape this module needs (a subset of the store's FileNode). */
export interface InlineFileNode {
  path: string;
  content?: string;
  children?: InlineFileNode[];
}

function findContent(files: InlineFileNode[], path: string): string | undefined {
  for (const file of files) {
    if (file.path === path) return file.content;
    if (file.children) {
      const found = findContent(file.children, path);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function isExternalUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//");
}

export function resolveFilePath(src: string, basePath: string): string {
  if (src.startsWith("/project/")) return src;

  let resolved: string;
  if (src.startsWith("/")) {
    resolved = `/project${src}`;
  } else {
    const baseDir = basePath.substring(0, basePath.lastIndexOf("/"));
    resolved = `${baseDir}/${src}`;
  }

  const parts = resolved.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === "" && normalized.length > 0) continue;
    if (part === ".") continue;
    if (part === ".." && normalized.length > 1) {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join("/");
}

/**
 * Pull the attributes off a `<script …>` open tag, minus `src` (which we're
 * replacing with inline content). Returns a string like ` type="module" defer`
 * (leading space) ready to splice back into the inline tag, or "" if none.
 */
export function extractScriptAttrs(openTag: string): string {
  const m = /^<script\b([\s\S]*?)>/i.exec(openTag);
  if (!m) return "";
  const attrRegion = m[1];
  // Tokenize attributes: name, name="v", name='v', name=v
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  const kept: string[] = [];
  let a: RegExpExecArray | null;
  while ((a = attrRe.exec(attrRegion)) !== null) {
    const name = a[1];
    if (!name) continue;
    if (name.toLowerCase() === "src") continue; // dropped — content is inlined
    kept.push(a[0].trim());
  }
  return kept.length ? " " + kept.join(" ") : "";
}

export function inlineExternalFiles(
  html: string,
  files: InlineFileNode[],
  entryPath = "/project/index.html",
): string {
  let result = html;

  // Inline local stylesheets.
  result = result.replace(
    /<link\s+([^>]*?)(?:rel=["']stylesheet["'][^>]*?href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*?rel=["']stylesheet["'])[^>]*\/?>/gi,
    (match, _attrs, href1, href2) => {
      const href = href1 || href2;
      if (!href || isExternalUrl(href)) return match;
      const filePath = resolveFilePath(href, entryPath);
      const content = findContent(files, filePath);
      if (content !== undefined) {
        return `<style>/* ${href} */\n${content}\n</style>`;
      }
      return match;
    },
  );

  // Inline local scripts — preserving the original attributes (type="module" etc).
  result = result.replace(
    /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (match, src) => {
      if (isExternalUrl(src)) return match;
      const filePath = resolveFilePath(src, entryPath);
      const content = findContent(files, filePath);
      if (content !== undefined) {
        const attrs = extractScriptAttrs(match);
        return `<script${attrs}>/* ${src} */\n${content}\n</script>`;
      }
      return match;
    },
  );

  return result;
}

