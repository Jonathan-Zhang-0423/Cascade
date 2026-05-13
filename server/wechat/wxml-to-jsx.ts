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

const SKIP_PREFIXING = new Set([
  "true", "false", "null", "undefined", "NaN", "Infinity",
  "typeof", "instanceof", "void", "delete", "new", "in", "of",
  "Math", "Date", "JSON", "Object", "Array", "String", "Number",
  "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite",
  "console", "window", "document", "wx",
  "__data__", "__page__", "__parseStyle",
  "item", "index",
]);

function rewriteExpr(expr: string): string {
  let result = "";
  let i = 0;
  while (i < expr.length) {
    // Skip string literals
    if (expr[i] === "'" || expr[i] === '"' || expr[i] === "`") {
      const q = expr[i];
      result += q;
      i++;
      while (i < expr.length && expr[i] !== q) {
        if (expr[i] === "\\") { result += expr[i] + expr[i+1]; i += 2; continue; }
        result += expr[i++];
      }
      result += expr[i++] || "";
      continue;
    }
    // Identifier start
    if (/[a-zA-Z_$]/.test(expr[i])) {
      let name = "";
      while (i < expr.length && /[a-zA-Z0-9_$]/.test(expr[i])) name += expr[i++];
      // Check what precedes (was it a dot?)
      const prevNonSpace = result.trimEnd();
      const preceded_by_dot = prevNonSpace.endsWith(".");
      // Check what follows (is it a paren = function call, or colon = object key?)
      let j = i;
      while (j < expr.length && expr[j] === " ") j++;
      const followed_by_paren = expr[j] === "(";
      const followed_by_colon = expr[j] === ":";
      if (!preceded_by_dot && !followed_by_paren && !followed_by_colon && !SKIP_PREFIXING.has(name)) {
        result += "__data__." + name;
      } else {
        result += name;
      }
      continue;
    }
    result += expr[i++];
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
  if (tag === "template" && attribs.is) {
    const tmplName = attribs.is.replace(/\{\{|\}\}/g, "").trim();
    const tmplNodes = templates.get(tmplName);
    if (!tmplNodes) return `${pad}{/* template "${tmplName}" not found */}\n`;
    return tmplNodes.map((c) => convertNode(c, templates, indent)).join("");
  }

  // ── <import> / <include> / <wxs> — unsupported, emit comment ──
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

  // Build the inner element (without wx: directives)
  const innerJsx = buildElement(el, tag, attribs, templates, indent);

  let result = innerJsx;

  // Wrap with wx:for
  if (wxFor) {
    const listExpr = wxFor.replace(/^\{\{/, "").replace(/\}\}$/, "").trim();
    result = `${pad}({(${listExpr} ?? []).map((${wxForItem}: unknown, ${wxForIndex}: number) => (\n${result}${pad}))}\n${pad})\n`;
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

    // Event attributes
    const evtProp = mapEventAttr(name);
    if (evtProp) {
      // Handler name is the value (no parens in WXML)
      const handlerName = value.trim();
      props.push(`${evtProp}={__page__.${handlerName} ? __page__.${handlerName}.bind(__page__) : undefined}`);
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
  errors: string[];
}

/**
 * Convert a WXML string to a React component function body string.
 * The output is wrapped in a function that receives `__page__` (the page instance)
 * and `__data__` (the page's reactive data object).
 */
export function wxmlToJsx(wxml: string, pagePath: string): WxmlToJsxResult {
  const errors: string[] = [];
  let nodes: ChildNode[];
  try {
    nodes = parseWxml(wxml);
  } catch (e: unknown) {
    return { jsx: "<View><Text>WXML parse error</Text></View>", errors: [(e as Error).message] };
  }

  const templates: TemplateMap = new Map();

  // First pass: collect template definitions
  for (const node of nodes) {
    if (node.type === "tag" && (node as Element).name.toLowerCase() === "template" && (node as Element).attribs?.name) {
      templates.set((node as Element).attribs.name, (node as Element).children ?? []);
    }
  }

  // Second pass: convert content nodes (use convertChildren for wx:if/elif/else chain support)
  const contentNodes = nodes.filter(
    (n) => !(n.type === "tag" && (n as Element).name.toLowerCase() === "template" && (n as Element).attribs?.name)
  );
  const body = convertChildren(contentNodes, templates, 2);

  const safePageClass = slugifyPagePath(pagePath);
  const safePageIdent = pagePath.replace(/[^a-zA-Z0-9]/g, "_");

  const jsx = `
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

  return { jsx, errors };
}
