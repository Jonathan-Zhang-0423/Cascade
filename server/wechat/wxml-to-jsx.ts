/**
 * WXML → React JSX transpiler for WeChat Mini Program browser preview.
 *
 * Converts WXML markup to a React functional component string that uses
 * the wx-runtime components (View, Text, Image, etc.).
 *
 * Handles:
 *  - wx:if / wx:elif / wx:else
 *  - wx:for / wx:for-item / wx:for-index / wx:key
 *  - <block> transparent wrapper
 *  - <template name="..."> definitions and <template is="..."> usage
 *  - bindtap / catchtap / bindinput / bindchange / bind* event mapping
 *  - {{ expression }} data binding in attributes and text
 *  - Data attributes (data-*) passed through as props
 */

import { Parser, DomHandler } from "htmlparser2";
import type { ChildNode, Element, Text as TextNode } from "domhandler";
import { slugifyPagePath } from "./wxss-to-css.js";

// ---------------------------------------------------------------------------
// WXML component → wx-runtime component name
// ---------------------------------------------------------------------------

const COMP_MAP: Record<string, string> = {
  view: "View", text: "Text", image: "Image", button: "Button",
  input: "Input", textarea: "Textarea", "scroll-view": "ScrollView",
  swiper: "Swiper", "swiper-item": "SwiperItem", navigator: "Navigator",
  form: "Form", label: "Label", checkbox: "Checkbox",
  "checkbox-group": "CheckboxGroup", radio: "Radio", "radio-group": "RadioGroup",
  switch: "Switch", slider: "Slider", picker: "Picker",
  icon: "Icon", progress: "Progress", block: "Block",
  canvas: "Canvas",
  // Rung 3 additions
  "rich-text": "RichText",
  video: "Video",
  "web-view": "WebView",
  "movable-view": "MovableView",
  "movable-area": "MovableArea",
  "cover-view": "CoverView",
  "cover-image": "CoverImage",
  "live-player": "LivePlayerStub",
  "live-pusher": "LivePlayerStub",
  ad: "AdStub",
  "official-account": "AdStub",
  // Fallback unknown tags to View
};

// ---------------------------------------------------------------------------
// Event attribute mapping: bind*/catch* → React prop names
// ---------------------------------------------------------------------------

function mapEventAttr(name: string): string | null {
  const lower = name.toLowerCase();
  // bindtap / catchtap → onClick (catchtap also stops propagation — handled in runtime)
  if (lower === "bindtap" || lower === "catchtap") return lower === "catchtap" ? "catchtap" : "bindtap";
  // bindinput / bindchange / bindfocus / bindblur / bindconfirm / bindsubmit / bindreset
  // bindscroll / bindscrolltolower / bindscrolltoupper / bindchange on swiper
  if (lower.startsWith("bind") || lower.startsWith("catch")) return lower;
  return null;
}

// ---------------------------------------------------------------------------
// Expression helpers
// ---------------------------------------------------------------------------

/** Wrap a {{ expr }} string as a JS expression, or a plain string as a string literal */
// ---------------------------------------------------------------------------
// Expression rewriting — prefix bare identifiers with __data__.
// ---------------------------------------------------------------------------

// Identifiers that already resolve in the generated scope (globals, keywords,
// runtime locals). Never prefix these.
const SKIP_PREFIXING = new Set([
  // Literals & keywords
  "true", "false", "null", "undefined", "NaN", "Infinity",
  "typeof", "instanceof", "void", "delete", "new", "in", "of",
  "return", "if", "else", "for", "while", "do", "switch", "case",
  "break", "continue", "this", "yield", "async", "await",
  // JS built-in globals the agent reaches for
  "Math", "Date", "JSON", "Object", "Array", "String", "Number",
  "Boolean", "Symbol", "Map", "Set", "WeakMap", "WeakSet",
  "Promise", "Error", "TypeError", "RangeError", "SyntaxError",
  "ReferenceError", "RegExp", "Reflect", "Intl", "URL",
  "URLSearchParams", "Proxy", "ArrayBuffer", "Uint8Array", "Int8Array",
  "Float32Array", "Float64Array", "DataView",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURI", "decodeURI", "encodeURIComponent", "decodeURIComponent",
  "console", "window", "document", "globalThis", "wx",
  // Runtime locals from the surrounding generated function
  "__data__", "__page__", "__parseStyle", "__parseInlineStyle",
  // Default wx:for loop variables
  "item", "index",
]);

// Per-page extra identifiers to leave un-prefixed (e.g. <wxs module="..."> names).
// Mutated by wxmlToJsx() before each compile; reset to an empty set on entry.
let _extraSkip = new Set<string>();

/**
 * Rewrite a WXML `{{ ... }}` expression into a JS expression that resolves
 * bare identifiers from the page's reactive `__data__` object.
 *
 * Gotchas handled:
 *   - String literals (single/double/template) are passed through untouched.
 *   - Optional chaining (`user?.name`): `name` after `?.` is a property access.
 *   - Member access (`foo.bar`): `bar` is a property, never prefixed.
 *   - Function calls (`filter(x => x.active)`): the identifier before `(`
 *     is treated as a method on the preceding object / a free function.
 *   - Object keys (`{a: 1}`): the identifier before `:` is a key, not a ref.
 *   - Arrow-function parameters (`(x) =>` or `x =>`): the parameter name is
 *     added to a local scope stack and skipped while inside the arrow body.
 *   - Destructuring parameters (`({id, name}) =>`): each binding is scoped.
 *   - Numeric literals (`1.5`, `.5`): the `.` inside is not a member access.
 */
function rewriteExpr(expr: string): string {
  let result = "";
  let i = 0;
  // Stack of name-sets that act as local scopes (from arrow parameters).
  // An identifier found in any scope is treated as already-bound.
  const localScopes: Array<Set<string>> = [];
  // Per-page additional skips (e.g. <wxs module="..."> names). Set by wxmlToJsx
  // before invoking the transform.
  if (_extraSkip.size) localScopes.push(_extraSkip);
  // Paren depth at which each scope was opened; used to pop on close.
  const scopeDepths: number[] = [];
  let parenDepth = 0;

  const isLocal = (name: string) => {
    for (let s = localScopes.length - 1; s >= 0; s--) if (localScopes[s].has(name)) return true;
    return false;
  };

  // Member access: identifier preceded by `.` (but not a numeric literal dot).
  const precededByMember = (): boolean => {
    let p = result.length - 1;
    while (p >= 0 && /\s/.test(result[p])) p--;
    if (p < 0) return false;
    if (result[p] !== ".") return false;
    const before = p > 0 ? result[p - 1] : "";
    return !/[0-9]/.test(before);
  };

  // Single-ident arrow: `name =>` — push scope binding `name`.
  const tryPushArrowScope = (name: string, nameEnd: number): boolean => {
    let q = nameEnd;
    while (q < expr.length && /\s/.test(expr[q])) q++;
    if (expr[q] === "=" && expr[q + 1] === ">") {
      localScopes.push(new Set([name]));
      scopeDepths.push(parenDepth);
      return true;
    }
    return false;
  };

  while (i < expr.length) {
    const c = expr[i];

    // String literals — pass through, but rewrite ${...} interpolations in template literals.
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      result += q;
      i++;
      while (i < expr.length && expr[i] !== q) {
        if (expr[i] === "\\") { result += expr[i] + (expr[i + 1] ?? ""); i += 2; continue; }
        if (q === "`" && expr[i] === "$" && expr[i + 1] === "{") {
          result += "${";
          i += 2;
          let d = 1;
          const sub: string[] = [];
          while (i < expr.length && d > 0) {
            if (expr[i] === "{") d++;
            else if (expr[i] === "}") { d--; if (d === 0) break; }
            sub.push(expr[i]);
            i++;
          }
          result += rewriteExpr(sub.join(""));
          result += "}";
          if (expr[i] === "}") i++;
          continue;
        }
        result += expr[i++];
      }
      result += expr[i++] ?? "";
      continue;
    }

    // Numeric literal — pass through digits + decimal + exponent so the dot
    // inside `1.5` doesn't trip member-access detection.
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(expr[i + 1] ?? ""))) {
      while (i < expr.length && /[0-9.]/.test(expr[i])) result += expr[i++];
      // exponent
      if (expr[i] === "e" || expr[i] === "E") {
        result += expr[i++];
        if (expr[i] === "+" || expr[i] === "-") result += expr[i++];
        while (i < expr.length && /[0-9]/.test(expr[i])) result += expr[i++];
      }
      continue;
    }

    // Paren tracking — open paren may be an arrow-param list.
    if (c === "(") {
      // Find matching `)`.
      let d = 1;
      let p = i + 1;
      while (p < expr.length && d > 0) {
        if (expr[p] === "(") d++;
        else if (expr[p] === ")") d--;
        else if (expr[p] === "'" || expr[p] === '"' || expr[p] === "`") {
          const q = expr[p];
          p++;
          while (p < expr.length && expr[p] !== q) {
            if (expr[p] === "\\") p += 2; else p++;
          }
        }
        if (d > 0) p++;
      }
      // Arrow if `)` is followed by `=>`.
      let q = p + 1;
      while (q < expr.length && /\s/.test(expr[q])) q++;
      const isArrowParams = d === 0 && expr[q] === "=" && expr[q + 1] === ">";
      if (isArrowParams) {
        // Parse identifier names from the param list expr[i+1 .. p].
        const names = new Set<string>();
        let s = i + 1;
        let topDepth = 0;
        let inDefault = false;
        while (s < p) {
          const ch = expr[s];
          if (ch === "{" || ch === "[" || ch === "(") { topDepth++; s++; continue; }
          if (ch === "}" || ch === "]" || ch === ")") { topDepth--; s++; continue; }
          if (topDepth === 0) {
            if (ch === ",") { inDefault = false; s++; continue; }
            if (ch === "=") { inDefault = true; s++; continue; }
            if (ch === ":") { inDefault = true; s++; continue; }
            if (!inDefault && /[a-zA-Z_$]/.test(ch)) {
              let n = "";
              while (s < p && /[a-zA-Z0-9_$]/.test(expr[s])) n += expr[s++];
              names.add(n);
              continue;
            }
          } else if (/[a-zA-Z_$]/.test(ch)) {
            // Conservative: any ident inside a destructuring pattern is a binding.
            let n = "";
            while (s < p && /[a-zA-Z0-9_$]/.test(expr[s])) n += expr[s++];
            names.add(n);
            continue;
          }
          s++;
        }
        if (names.size > 0) {
          // The arrow body executes at the CURRENT (outer) paren depth —
          // it persists until a `,` or `)` at depth === parenDepth.
          localScopes.push(names);
          scopeDepths.push(parenDepth);
        }
      }
      parenDepth++;
      result += c;
      i++;
      continue;
    }
    if (c === ")") {
      parenDepth--;
      // Arrow body ends when we drop BELOW the depth at which it was pushed.
      while (scopeDepths.length > 0 && scopeDepths[scopeDepths.length - 1] > parenDepth) {
        scopeDepths.pop();
        localScopes.pop();
      }
      result += c;
      i++;
      continue;
    }
    if (c === ",") {
      // Pop arrow scopes whose bodies end at this comma at the same paren depth.
      while (scopeDepths.length > 0 && scopeDepths[scopeDepths.length - 1] === parenDepth) {
        scopeDepths.pop();
        localScopes.pop();
      }
      result += c;
      i++;
      continue;
    }
    if (c === ",") {
      // Pop arrow scopes whose body ends at this comma at the same paren depth.
      while (scopeDepths.length > 0 && scopeDepths[scopeDepths.length - 1] === parenDepth) {
        scopeDepths.pop();
        localScopes.pop();
      }
      result += c;
      i++;
      continue;
    }

    // Identifier.
    if (/[a-zA-Z_$]/.test(c)) {
      let name = "";
      while (i < expr.length && /[a-zA-Z0-9_$]/.test(expr[i])) name += expr[i++];

      // Single-ident arrow: `foo =>` (param `foo` bound locally).
      if (tryPushArrowScope(name, i)) {
        result += name;
        continue;
      }

      // Look ahead for `:` (object key) or `(` (call/wxs import).
      let j = i;
      while (j < expr.length && /\s/.test(expr[j])) j++;
      const followedByColon = expr[j] === ":" && expr[j + 1] !== ":";
      const followedByParen = expr[j] === "(";
      const memberAccess = precededByMember();

      if (memberAccess || followedByColon || followedByParen || SKIP_PREFIXING.has(name) || isLocal(name)) {
        result += name;
        continue;
      }

      result += "__data__." + name;
      continue;
    }

    result += c;
    i++;
  }

  return result;
}

function attrToJsx(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    const inner = rewriteExpr(trimmed.slice(2, -2).trim());
    return "{" + inner + "}";
  }
  if (trimmed.includes("{{")) {
    const tpl = trimmed.replace(/\{\{([^}]+)\}\}/g, (_: string, e: string) => "${" + rewriteExpr(e.trim()) + "}");
    return "{`" + tpl + "`}";
  }
  return '"' + value.replace(/"/g, "&quot;") + '"';
}

function textToJsx(text: string): string {
  if (!text.includes("{{")) return text;
  const parts: string[] = [];
  let last = 0;
  const re = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(JSON.stringify(text.slice(last, m.index)));
    parts.push(rewriteExpr(m[1].trim()));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(JSON.stringify(text.slice(last)));
  return "{" + parts.join(" + ") + "}";
}

// ---------------------------------------------------------------------------
// Template registry (for <template name="..."> / <template is="...">)
// ---------------------------------------------------------------------------

type TemplateMap = Map<string, ChildNode[]>;

// ---------------------------------------------------------------------------
// Core node converter
// ---------------------------------------------------------------------------

function convertNode(node: ChildNode, templates: TemplateMap, indent: number): string {
  const pad = "  ".repeat(indent);

  if (node.type === "text") {
    const raw = (node as TextNode).data;
    const trimmed = raw.trim();
    if (!trimmed) return "";
    return pad + textToJsx(trimmed) + "\n";
  }

  if (node.type !== "tag") return "";

  const el = node as Element;
  const tag = el.name.toLowerCase();
  const attribs = el.attribs ?? {};

  // ── <template name="..."> definition — register and emit nothing ──
  if (tag === "template" && attribs.name) {
    templates.set(attribs.name, el.children ?? []);
    return "";
  }

  // ── <template is="..."> usage — inline the template ──
  // Supports both static `is="name"` and dynamic `is="{{expr}}"`.
  if (tag === "template" && attribs.is) {
    const rawIs = attribs.is.trim();
    const isDynamic = rawIs.startsWith("{{") && rawIs.endsWith("}}");
    if (isDynamic) {
      // Emit a runtime lookup: find the template by name at render time.
      // We pass all registered template names as a lookup map.
      const expr = rewriteExpr(rawIs.slice(2, -2).trim());
      const dataAttr = attribs.data ? rewriteExpr(attribs.data.replace(/^\{\{/, "").replace(/\}\}$/, "").trim()) : "{}";
      // Build a map of template-name → render function.
      const tmplEntries = Array.from(templates.entries())
        .map(([name, nodes]) => {
          const body = nodes.map((c) => convertNode(c, templates, indent + 2)).join("");
          return `"${name}": ((__tplData__) => (<>${body.trim()}</>))`;
        })
        .join(",\n");
      if (!tmplEntries) return `${pad}{/* no templates defined */}\n`;
      return `${pad}{((__tmplMap__) => { const __fn__ = __tmplMap__[${expr}]; return __fn__ ? __fn__(${dataAttr}) : null; })({${tmplEntries}})}\n`;
    }
    const tmplName = rawIs;
    const tmplNodes = templates.get(tmplName);
    if (!tmplNodes) return `${pad}{/* template "${tmplName}" not found */}\n`;
    return tmplNodes.map((c) => convertNode(c, templates, indent)).join("");
  }

  // ── <import> / <include> / <wxs> — wxs is handled in the prelude; others are no-ops ──
  if (tag === "import" || tag === "include" || tag === "wxs") {
    return `${pad}{/* <${tag}> is not supported in preview */}\n`;
  }

  // ── wx:if / wx:elif / wx:else ──
  const wxIf = attribs["wx:if"];
  const wxElif = attribs["wx:elif"];
  const wxElse = "wx:else" in attribs;

  // ── wx:for ──
  const wxFor = attribs["wx:for"];
  const wxForItem = attribs["wx:for-item"] ?? "item";
  const wxForIndex = attribs["wx:for-index"] ?? "index";

  // Register custom loop variable names so rewriteExpr leaves them unprefixed.
  if (wxFor) {
    _extraSkip.add(wxForItem);
    _extraSkip.add(wxForIndex);
  }

  // Build the inner element (without wx: directives)
  const innerJsx = buildElement(el, tag, attribs, templates, indent);

  let result = innerJsx;

  // Wrap with wx:for. Use runtime helper __wxFor() so iteration works over
  // arrays, objects (key/value pairs), strings, and numbers — the real
  // mini-program runtime accepts all four. Defaults: item / index, but for
  // object iteration `index` is the KEY (matches WeChat semantics).
  if (wxFor) {
    const listExpr = rewriteExpr(wxFor.replace(/^\{\{/, "").replace(/\}\}$/, "").trim());
    result = `${pad}({__wxFor(${listExpr}).map((${wxForItem}: unknown, ${wxForIndex}: unknown) => (\n${result}${pad}))}\n${pad})\n`;
  }

  // wx:if / wx:elif / wx:else are handled at the parent children level (see convertChildren).
  // Here we only wrap wx:if and wx:elif for standalone nodes (no siblings visible at this level).
  if (wxIf) {
    const cond = rewriteExpr(wxIf.replace(/^\{\{/, "").replace(/\}\}$/, "").trim());
    result = `${pad}{(${cond}) && (\n${result}${pad})}\n`;
  } else if (wxElif) {
    const cond = rewriteExpr(wxElif.replace(/^\{\{/, "").replace(/\}\}$/, "").trim());
    result = `${pad}{(${cond}) && (\n${result}${pad})}\n`;
  }
  // wx:else: emitted as-is; convertChildren wraps it in the else branch of the preceding condition.

  return result;
}

/**
 * Convert a list of sibling nodes, grouping wx:if / wx:elif / wx:else chains
 * into proper ternary expressions so wx:else is never rendered unconditionally.
 */
function convertChildren(nodes: ChildNode[], templates: TemplateMap, indent: number): string {
  const pad = "  ".repeat(indent);
  const result: string[] = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];

    // Only element nodes can carry wx:if
    if (node.type !== "tag") {
      result.push(convertNode(node, templates, indent));
      i++;
      continue;
    }

    const el = node as Element;
    const attribs = el.attribs ?? {};
    const wxIf = attribs["wx:if"];

    if (!wxIf) {
      result.push(convertNode(node, templates, indent));
      i++;
      continue;
    }

    // Start of a wx:if chain — collect all elif/else siblings
    const ifCond = rewriteExpr(wxIf.replace(/^\{\{/, "").replace(/\}\}$/, "").trim());
    const ifBody = buildElement(el, el.name.toLowerCase(), attribs, templates, indent + 1);

    const branches: Array<{ cond: string | null; body: string }> = [
      { cond: ifCond, body: ifBody },
    ];

    i++;
    // Consume whitespace-only text nodes between siblings
    while (i < nodes.length) {
      const next = nodes[i];
      if (next.type === "text" && !(next as import("domhandler").Text).data.trim()) {
        i++;
        continue;
      }
      if (next.type !== "tag") break;
      const nextEl = next as Element;
      const nextAttribs = nextEl.attribs ?? {};
      if ("wx:elif" in nextAttribs) {
        const elifCond = rewriteExpr(nextAttribs["wx:elif"].replace(/^\{\{/, "").replace(/\}\}$/, "").trim());
        const elifBody = buildElement(nextEl, nextEl.name.toLowerCase(), nextAttribs, templates, indent + 1);
        branches.push({ cond: elifCond, body: elifBody });
        i++;
      } else if ("wx:else" in nextAttribs) {
        const elseBody = buildElement(nextEl, nextEl.name.toLowerCase(), nextAttribs, templates, indent + 1);
        branches.push({ cond: null, body: elseBody });
        i++;
        break;
      } else {
        break;
      }
    }

    // Emit as nested ternary: cond1 ? branch1 : cond2 ? branch2 : elseBody
    if (branches.length === 1) {
      // No elif/else — simple &&
      result.push(`${pad}{(${branches[0].cond}) && (\n${branches[0].body}${pad})}\n`);
    } else {
      // Build ternary chain
      let expr = "";
      for (let b = 0; b < branches.length; b++) {
        const br = branches[b];
        if (br.cond === null) {
          // else branch
          expr += `(\n${br.body}${pad})`;
        } else if (b === branches.length - 1) {
          // Last conditional with no else — use && for the last one
          expr = `(${br.cond}) ? (\n${br.body}${pad}) : null`;
          // Wrap previous ternary
          for (let prev = b - 1; prev >= 0; prev--) {
            const pb = branches[prev];
            if (pb.cond !== null) {
              expr = `(${pb.cond}) ? (\n${pb.body}${pad}) : ${expr}`;
            }
          }
          break;
        } else {
          // Will be wrapped in the next iteration
        }
      }
      // Rebuild properly: if/elif/.../else as left-to-right ternary
      let ternary = branches[branches.length - 1].cond === null
        ? `(\n${branches[branches.length - 1].body}${pad})`
        : "null";
      for (let b = branches.length - (branches[branches.length - 1].cond === null ? 2 : 1); b >= 0; b--) {
        const br = branches[b];
        ternary = `(${br.cond}) ? (\n${br.body}${pad}) : ${ternary}`;
      }
      result.push(`${pad}{${ternary}}\n`);
    }
  }

  return result.join("");
}

function buildElement(el: Element, tag: string, attribs: Record<string, string>, templates: TemplateMap, indent: number): string {
  const pad = "  ".repeat(indent);
  const compName = COMP_MAP[tag] ?? "View";

  // Build props string
  const props: string[] = [];

  for (const [name, value] of Object.entries(attribs)) {
    // Skip wx: directives (handled above)
    if (name.startsWith("wx:")) continue;

    // generic:xxx="comp-name" — WeChat custom-component generics.
    // In preview we can't dynamically resolve the component, so we skip
    // the attribute silently (the component renders its default slot).
    if (name.startsWith("generic:")) continue;

    // Event attributes
    const evtProp = mapEventAttr(name);
    if (evtProp) {
      // Handler name is the value (no parens in WXML)
      const handlerName = value.trim();
      props.push(`${evtProp}={__page__.${handlerName} ? __page__.${handlerName}.bind(__page__) : undefined}`);
      continue;
    }

    // mark:xxx attributes — WeChat event mark system. Store as data-wx-mark-xxx
    // so event handlers can read e.mark.xxx from the event object.
    if (name.startsWith("mark:")) {
      const markKey = name.slice(5);
      props.push(`data-wx-mark-${markKey}=${attrToJsx(value)}`);
      continue;
    }

    // data-* attributes — pass through as-is
    if (name.startsWith("data-")) {
      props.push(`${name}=${attrToJsx(value)}`);
      continue;
    }

    // Boolean attributes
    if (name === "disabled" || name === "checked" || name === "multiple" || name === "autoplay" || name === "indicator-dots" || name === "show-info" || name === "password" || name === "lazy-load") {
      const val = value.trim();
      if (val === "" || val === "true" || val === "{{true}}") { props.push(name === "indicator-dots" ? "indicatorDots" : name === "show-info" ? "showInfo" : name === "lazy-load" ? "lazyLoad" : name); continue; }
      if (val === "false" || val === "{{false}}") continue;
      props.push(`${camelCase(name)}=${attrToJsx(value)}`);
      continue;
    }

    // hidden — keep element in DOM but set display:none (unlike wx:if which removes it).
    if (name === "hidden") {
      const val = value.trim();
      const isHidden = val === "" || val === "true" || val === "{{true}}";
      const isDynamic = val.startsWith("{{") && val.endsWith("}}");
      if (isDynamic) {
        const expr = rewriteExpr(val.slice(2, -2).trim());
        props.push(`style={{...(${expr} ? {display:"none"} : {})}}`);
      } else if (isHidden) {
        props.push(`style={{display:"none"}}`);
      }
      continue;
    }

    // slot — pass through as a prop so custom components can use it.
    if (name === "slot") {
      props.push(`slot=${attrToJsx(value)}`);
      continue;
    }

    // class → className
    if (name === "class") { props.push(`className=${attrToJsx(value)}`); continue; }

    // style — convert rpx inline (basic)
    if (name === "style") { props.push(`style={__parseStyle(${JSON.stringify(value)})}`); continue; }

    // All other attributes — camelCase the name
    props.push(`${camelCase(name)}=${attrToJsx(value)}`);
  }

  // Add key for wx:for items
  if (attribs["wx:for"]) {
    const wxKey = attribs["wx:key"];
    if (wxKey && wxKey !== "*this") {
      props.push(`key={${attribs["wx:for-item"] ?? "item"}.${wxKey}}`);
    } else {
      props.push(`key={${attribs["wx:for-index"] ?? "index"}}`);
    }
  }

  const propsStr = props.length ? " " + props.join(" ") : "";

  // Self-closing tags
  const selfClose = new Set(["input", "image", "icon", "progress"]);
  if (selfClose.has(tag) && (!el.children || el.children.length === 0)) {
    return `${pad}<${compName}${propsStr} />\n`;
  }

  // Children — use convertChildren so wx:if/wx:elif/wx:else chains are handled correctly
  const children = convertChildren(el.children ?? [], templates, indent + 1);

  if (!children.trim()) {
    return `${pad}<${compName}${propsStr} />\n`;
  }

  return `${pad}<${compName}${propsStr}>\n${children}${pad}</${compName}>\n`;
}

function camelCase(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Parse WXML string into DOM nodes using htmlparser2
// ---------------------------------------------------------------------------

function parseWxml(wxml: string): ChildNode[] {
  let nodes: ChildNode[] = [];
  const handler = new DomHandler((err, dom) => {
    if (!err) nodes = dom as ChildNode[];
  }, { withStartIndices: false, withEndIndices: false });
  const parser = new Parser(handler, { xmlMode: false, lowerCaseTags: false, lowerCaseAttributeNames: false, recognizeSelfClosing: true });
  parser.write(wxml);
  parser.end();
  return nodes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WxmlToJsxResult {
  jsx: string;
  /** Fatal errors — compilation produced nothing usable. */
  errors: string[];
  /** Non-fatal issues (unsupported features silently dropped). */
  warnings: string[];
}

/**
 * Convert a WXML string to a React component function body string.
 * The output is wrapped in a function that receives `__page__` (the page instance)
 * and `__data__` (the page's reactive data object).
 */
export function wxmlToJsx(wxml: string, pagePath: string): WxmlToJsxResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Reset per-page rewriter state.
  _extraSkip = new Set<string>();
  let nodes: ChildNode[];
  try {
    nodes = parseWxml(wxml);
  } catch (e: unknown) {
    return { jsx: "<View><Text>WXML parse error</Text></View>", errors: [(e as Error).message], warnings: [] };
  }

  const templates: TemplateMap = new Map();

  // First pass: collect template definitions
  for (const node of nodes) {
    if (node.type === "tag" && (node as Element).name.toLowerCase() === "template" && (node as Element).attribs?.name) {
      templates.set((node as Element).attribs.name, (node as Element).children ?? []);
    }
  }

  // Walk the tree once to detect unsupported WXML features and record warnings.
  // The actual transform (next step) silently drops these; surfacing them here
  // turns them into dismissible yellow chips in the preview UI.
  const warnedTags = new Set<string>();
  // Collect <wxs module="x"> blocks into named CommonJS modules. Supports both:
  //   - inline:  <wxs module="m">var fmt = function(x) { return x }; module.exports = { fmt }</wxs>
  //   - external: <wxs module="m" src="./util.wxs"/>  (warned only — file resolution
  //     would require cross-file context we don't have here; fall back to empty {})
  const wxsModules: Array<{ name: string; src: string; external?: string }> = [];
  (function scan(list: ChildNode[]) {
    for (const n of list) {
      if (n.type === "tag") {
        const e = n as Element;
        const t = e.name.toLowerCase();
        if (t === "wxs" && e.attribs?.module) {
          const name = e.attribs.module;
          const src = e.attribs.src;
          if (src) {
            wxsModules.push({ name, src: "", external: src });
          } else {
            // Concatenate child text nodes as the module body.
            const body = (e.children ?? [])
              .filter((c) => c.type === "text")
              .map((c) => (c as TextNode).data)
              .join("\n");
            wxsModules.push({ name, src: body });
          }
          continue;
        }
        if ((t === "import" || t === "include") && !warnedTags.has(t)) {
          warnedTags.add(t);
          warnings.push(`<${t}> is not yet supported — content will not execute in preview.`);
        }
        if (e.children) scan(e.children);
      }
    }
  })(nodes);
  for (const m of wxsModules) {
    if (m.external) {
      warnings.push(`<wxs src="${m.external}"> external import is not supported in preview — module "${m.name}" is empty.`);
    }
    // Register module name as a local so rewriteExpr leaves it unprefixed.
    _extraSkip.add(m.name);
  }

  // Second pass: convert content nodes (use convertChildren for wx:if/elif/else chain support)
  const contentNodes = nodes.filter(
    (n) => !(n.type === "tag" && (n as Element).name.toLowerCase() === "template" && (n as Element).attribs?.name)
  );
  const body = convertChildren(contentNodes, templates, 2);

  // Build wxs module bindings — each <wxs module="m">...</wxs> becomes a CommonJS-style
  // IIFE binding `const m = (function() { var module = { exports: {} }; <body>; return module.exports; })();`
  // External (src=) modules become empty objects since we can't resolve cross-file in this pass.
  const wxsBindings = wxsModules
    .map((m) => {
      if (m.external) {
        return `const ${m.name} = {};`;
      }
      // Wrap in try/catch so a malformed wxs body doesn't kill the whole page.
      return `const ${m.name} = (function() {
  try {
    const module = { exports: {} };
    const exports = module.exports;
    (function() { ${m.src} })();
    return module.exports;
  } catch (e) {
    console.warn("[wxs] module \\"${m.name}\\" failed:", e);
    return {};
  }
})();`;
    })
    .join("\n");

  const safePageClass = slugifyPagePath(pagePath);
  const safePageIdent = pagePath.replace(/[^a-zA-Z0-9]/g, "_");

  const jsx = `
${wxsBindings}

// Iteration helper: WeChat's wx:for accepts arrays, objects, strings, and numbers.
// Returns Array<[item, indexOrKey]> mapped to plain map() for JSX rendering.
function __wxFor(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") return val.split("");
  if (typeof val === "number") return Array.from({ length: val }, (_, i) => i);
  if (typeof val === "object") {
    // Object iteration: __wxFor returns key/value pairs; the .map below
    // unpacks them so the user's wx:for-item is the value and wx:for-index is the key.
    // (Real WeChat: index = key for object iteration.)
    return Object.keys(val).map((k) => ({ __wx_key__: k, __wx_val__: val[k] }));
  }
  return [];
}

function __parseStyle(s) {
  if (!s) return {};
  const obj = {};
  s.split(";").forEach(part => {
    const idx = part.indexOf(":");
    if (idx < 0) return;
    const key = part.slice(0, idx).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const val = part.slice(idx + 1).trim().replace(/([\\d.]+)rpx/g, (_, n) => (parseFloat(n) / 7.5).toFixed(3) + "vw");
    if (key) obj[key] = val;
  });
  return obj;
}

function WxPage_${safePageIdent}({ __page__, __data__ }) {
  return (
    <div id="__wx_page__" className="wx-page-${safePageClass}">
${body}    </div>
  );
}
`;

  return { jsx, errors, warnings };
}
