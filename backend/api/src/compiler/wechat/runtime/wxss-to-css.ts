/**
 * WXSS → CSS transformer for WeChat Mini Program browser preview.
 *
 * Transforms:
 *  - rpx units → vw  (750rpx = 100vw, so 1rpx = 1/7.5 vw)
 *  - `page` selector → `#__wx_page__` (our preview root element)
 *  - Scopes all rules with a page-path prefix class to prevent cross-page leakage
 */

const RPX_RE = /([\d.]+)rpx/g;

function rpxToVw(css: string): string {
  return css.replace(RPX_RE, (_, n) => `${(parseFloat(n) / 7.5).toFixed(3)}vw`);
}

/**
 * Strip CSS block comments. Scope tokenizer treats everything before `{` as
 * the selector, so a leading `/* ... *\/` would end up jammed into the selector
 * list and break comma-split scoping if the comment contained `,` or `{`.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Slugify a WeChat page path for use in CSS class names and JSX className.
 * Must be kept in sync between the WXML → JSX transformer and the WXSS → CSS
 * transformer — otherwise page-scoped styles don't match the wrapper class.
 */
export function slugifyPagePath(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Rewrite `page { ... }` selector to `#__wx_page__`.
 * Also handles `page.class`, `page > child`, etc.
 */
function rewritePageSelector(css: string): string {
  // Match `page` as a standalone selector token (not inside a string or comment)
  return css.replace(/(?<![.#\w])page\b(?=\s*[{,>+~\s])/g, "#__wx_page__");
}

/**
 * Scope all CSS rules with a wrapper class so page styles don't bleed across pages.
 * e.g. `.container { ... }` → `.wx-page-home .container { ... }`
 *
 * Handles:
 *  - Regular rules: `.foo { ... }`
 *  - @media blocks (scopes rules inside)
 *  - @keyframes (left unscoped — they're global by nature)
 *  - Already-scoped rules (idempotent)
 */
function scopeWithPrefix(css: string, prefix: string): string {
  if (!prefix) return css;
  const scopeClass = `.wx-page-${prefix}`;

  // Simple tokenizer: split on top-level `{` and `}` to find rule boundaries.
  // This handles nested @media but not deeply nested CSS (which WXSS doesn't support).
  const result: string[] = [];
  let i = 0;
  const len = css.length;

  while (i < len) {
    // Skip whitespace
    const wsStart = i;
    while (i < len && /\s/.test(css[i])) i++;

    // Find the next `{`
    const selectorStart = i;
    let depth = 0;
    let inString = false;
    let stringChar = "";

    while (i < len) {
      const ch = css[i];
      if (inString) {
        if (ch === stringChar && css[i - 1] !== "\\") inString = false;
      } else if (ch === '"' || ch === "'") {
        inString = true; stringChar = ch;
      } else if (ch === "{") {
        depth++;
        if (depth === 1) break;
      } else if (ch === "}") {
        depth--;
        if (depth < 0) { i++; break; } // stray closing brace
      }
      i++;
    }

    if (i >= len) break;

    const selector = css.slice(selectorStart, i).trim();
    i++; // consume `{`

    // Find matching `}`
    const bodyStart = i;
    depth = 1;
    inString = false;
    while (i < len && depth > 0) {
      const ch = css[i];
      if (inString) {
        if (ch === stringChar && css[i - 1] !== "\\") inString = false;
      } else if (ch === '"' || ch === "'") {
        inString = true; stringChar = ch;
      } else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const body = css.slice(bodyStart, i - 1);

    if (!selector) continue;

    // @keyframes — emit as-is (global, no scoping needed)
    if (/^@keyframes\b/i.test(selector)) {
      result.push(`${selector} {\n${body}}\n`);
      continue;
    }

    // @media / @supports — recurse into body
    if (/^@(media|supports)\b/i.test(selector)) {
      const innerScoped = scopeWithPrefix(body, prefix);
      result.push(`${selector} {\n${innerScoped}}\n`);
      continue;
    }

    // Regular rule — scope each comma-separated selector
    const scopedSelectors = selector
      .split(",")
      .map((s) => {
        s = s.trim();
        if (!s) return "";
        // Already scoped or is a root-level selector we rewrote
        if (s.startsWith(scopeClass) || s.startsWith("#__wx_page__")) return s;
        // :root, html, body — don't scope
        if (/^(html|body|:root)\b/.test(s)) return s;
        return `${scopeClass} ${s}`;
      })
      .filter(Boolean)
      .join(",\n");

    result.push(`${scopedSelectors} {\n${body}}\n`);
  }

  return result.join("\n");
}

export interface WxssTransformOptions {
  /** Page path used as scoping prefix, e.g. "pages/index/index" → "pages-index-index" */
  pagePrefix?: string;
  /** If true, skip scoping (used for app.wxss global styles) */
  global?: boolean;
}

export function transformWxss(wxss: string, opts: WxssTransformOptions = {}): string {
  let css = stripComments(wxss);
  css = rpxToVw(css);
  css = rewritePageSelector(css);
  if (!opts.global && opts.pagePrefix) {
    css = scopeWithPrefix(css, slugifyPagePath(opts.pagePrefix));
  }
  return css;
}
