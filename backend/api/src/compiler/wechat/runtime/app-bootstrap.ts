/**
 * Generates the index.tsx entry point for a WeChat Mini Program preview bundle.
 *
 * Emits a self-contained React app that:
 *  - Runs App() lifecycle (onLaunch, onShow)
 *  - Manages a page stack (navigateTo / redirectTo / navigateBack / reLaunch)
 *  - Renders a navbar with back button and title
 *  - Renders a tabBar if app.json defines one
 *  - Wires wx.navigateTo / wx.navigateBack / wx.switchTab to the router
 *  - Bridges console.log/warn/error to the parent IDE frame
 */

export interface TabBarItem {
  pagePath: string;
  text: string;
  iconPath?: string;
  selectedIconPath?: string;
}

export interface AppBootstrapOptions {
  pages: Array<{
    path: string;
    componentName: string;
  }>;
  entryPage: string;
  navBgColor: string;
  navTextColor: string;
  navTitle: string;
  tabBar?: {
    color: string;
    selectedColor: string;
    backgroundColor: string;
    list: TabBarItem[];
  };
  appJsName: string;
}

export function generateAppBootstrap(opts: AppBootstrapOptions): string {
  const { pages, entryPage, navBgColor, navTextColor, navTitle, tabBar, appJsName } = opts;

  const pageImports = pages
    .map((p) => `import { ${p.componentName}, __pageFactory_${p.componentName}, __pageConfig_${p.componentName} } from "./${p.componentName}";`)
    .join("\n");

  const pageRegistry = pages
    .map((p) => `  "${p.path}": { Component: ${p.componentName}, factory: __pageFactory_${p.componentName}, config: __pageConfig_${p.componentName} },`)
    .join("\n");

  const tabBarJson = tabBar ? JSON.stringify(tabBar) : "null";

  return `
import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { wx } from "./wx-polyfill";
${pageImports}

// ── Console bridge to parent IDE frame ──
(function() {
  const levels = ["log", "warn", "error", "info"];
  levels.forEach(function(l) {
    const orig = console[l].bind(console);
    console[l] = function(...args) {
      const msg = args.map(a => { try { return typeof a === "object" ? JSON.stringify(a) : String(a); } catch(e) { return String(a); } }).join(" ");
      try { window.parent.postMessage({ type: "__cascade_console__", level: l, message: msg }, "*"); } catch(e) {}
      orig(...args);
    };
  });
  window.addEventListener("error", function(e) {
    const msg = (e && e.message) || "Script error";
    const line = e && e.lineno;
    try { window.parent.postMessage({ type: "__cascade_console__", level: "error", message: msg + (line ? " (line " + line + ")" : "") }, "*"); } catch(_) {}
    try { window.parent.postMessage({ type: "__cascade_runtime_error__", message: String(msg) + (line ? " (line " + line + ")" : "") }, "*"); } catch(_) {}
  });
  window.addEventListener("unhandledrejection", function(e) {
    const reason = e.reason && (e.reason.stack || e.reason.message || String(e.reason)) || "Unhandled promise rejection";
    try { window.parent.postMessage({ type: "__cascade_console__", level: "error", message: reason }, "*"); } catch(_) {}
    try { window.parent.postMessage({ type: "__cascade_runtime_error__", message: reason }, "*"); } catch(_) {}
  });
})();

// ── Page registry ──
const PAGE_REGISTRY: Record<string, { Component: React.ComponentType<any>; factory: () => Record<string, unknown>; config: Record<string, unknown> }> = {
${pageRegistry}
};

// ── TabBar config ──
const TAB_BAR_CONFIG = ${tabBarJson};

// ── App instance ──
let __appInst__: Record<string, unknown> = {};
function App(cfg: Record<string, unknown>) {
  __appInst__ = cfg;
  (window as any).__wxApp__ = cfg;
  try { (cfg.onLaunch as Function)?.call(cfg, {}); } catch(e) { console.error(e); }
  try { (cfg.onShow as Function)?.call(cfg, {}); } catch(e) { console.error(e); }
}
(window as any).getApp = () => __appInst__;

// ── Page instance factory ──
function createPageInst(pagePath: string, options: Record<string, string> = {}) {
  const entry = PAGE_REGISTRY[pagePath];
  if (!entry) return null;
  // Each page module exports a __pageFactory__ that calls Page() and returns the config
  const cfg = entry.factory?.() ?? {};
  const data = Object.assign({}, cfg.data ?? {});
  let _setData: ((d: Record<string, unknown>) => void) | null = null;

  // Build observer map from cfg.observers: { 'field.**': fn, 'a, b': fn }
  // Keys may be comma-separated paths; '**' means any change to the object.
  type ObserverEntry = { paths: string[]; fn: Function };
  const observers: ObserverEntry[] = [];
  if (cfg.observers && typeof cfg.observers === "object") {
    for (const [key, fn] of Object.entries(cfg.observers as Record<string, unknown>)) {
      if (typeof fn !== "function") continue;
      const paths = key.split(",").map((p) => p.trim()).filter(Boolean);
      observers.push({ paths, fn });
    }
  }

  // Check if a changed key matches an observer path.
  // Supports exact match, wildcard (**), and dot-path prefix matching.
  function matchesObserver(changedKey: string, observerPath: string): boolean {
    if (observerPath === "**") return true;
    const op = observerPath.replace(/\\.\\*\\*$/, "");
    return changedKey === op || changedKey.startsWith(op + ".") || op.startsWith(changedKey + ".");
  }

  // Get a nested value from data by dot-path (e.g. "user.name").
  function getByPath(obj: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce((cur: unknown, k) => {
      if (cur == null || typeof cur !== "object") return undefined;
      return (cur as Record<string, unknown>)[k];
    }, obj);
  }

  const inst: Record<string, unknown> = {
    data,
    route: pagePath,
    setData(obj: Record<string, unknown>, cb?: () => void) {
      Object.assign(this.data as object, obj);
      _setData?.(Object.assign({}, this.data as object));
      cb?.();
      // Fire observers for any changed key.
      if (observers.length > 0) {
        const changedKeys = Object.keys(obj);
        for (const { paths, fn } of observers) {
          const matched = paths.some((p) => changedKeys.some((k) => matchesObserver(k, p)));
          if (matched) {
            // Pass current values for each observed path as arguments.
            const args = paths.map((p) => getByPath(this.data as Record<string, unknown>, p.replace(/\\.\\*\\*$/, "")));
            try { fn.apply(inst, args); } catch (e) { console.error("[observer]", e); }
          }
        }
      }
    },
    __bindSetData(fn: (d: Record<string, unknown>) => void) { _setData = fn; },
  };
  // Bind all methods from cfg onto inst
  for (const k of Object.keys(cfg)) {
    if (typeof cfg[k] === "function") inst[k] = (cfg[k] as Function).bind(inst);
  }
  try { (inst.onLoad as Function)?.call(inst, options); } catch(e) { console.error(e); }
  try { (inst.onShow as Function)?.call(inst, {}); } catch(e) { console.error(e); }
  setTimeout(() => { try { (inst.onReady as Function)?.call(inst); } catch(e) { console.error(e); } }, 0);
  return inst;
}

// ── Router ──
type StackEntry = { path: string; inst: Record<string, unknown>; key: number };

function WxApp() {
  const [stack, setStack] = useState<StackEntry[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [transition, setTransition] = useState<"push" | "pop" | "fade" | null>(null);
  const stackRef = useRef<StackEntry[]>([]);
  const keyRef = useRef(0);

  const navigate = useCallback((url: string) => {
    let path = url, options: Record<string, string> = {}, replace = false, relaunch = false, tab = false;
    if (url.startsWith("__redirect__:")) { path = url.slice(13); replace = true; }
    else if (url.startsWith("__relaunch__:")) { path = url.slice(13); relaunch = true; }
    else if (url.startsWith("__tab__:")) { path = url.slice(8); tab = true; }
    const parts = path.split("?");
    path = parts[0].startsWith("/") ? parts[0].slice(1) : parts[0];
    if (parts[1]) parts[1].split("&").forEach(p => { const kv = p.split("="); if (kv[0]) options[decodeURIComponent(kv[0])] = kv[1] ? decodeURIComponent(kv[1]) : ""; });

    if (tab && TAB_BAR_CONFIG) {
      const idx = TAB_BAR_CONFIG.list.findIndex((t: TabBarItem) => t.pagePath.replace(/^\\//, "") === path);
      if (idx >= 0) setActiveTab(idx);
    }

    // Fire onHide on the current top page before pushing a new one.
    const currentTop = stackRef.current[stackRef.current.length - 1];
    if (currentTop && !relaunch) {
      try { (currentTop.inst.onHide as Function)?.call(currentTop.inst); } catch {}
    }
    // Fire onUnload on pages being replaced/relaunched.
    if (relaunch) {
      for (const entry of stackRef.current) {
        try { (entry.inst.onUnload as Function)?.call(entry.inst); } catch {}
      }
    } else if (replace && stackRef.current.length > 0) {
      const replaced = stackRef.current[stackRef.current.length - 1];
      try { (replaced.inst.onUnload as Function)?.call(replaced.inst); } catch {}
    }

    const inst = createPageInst(path, options);
    if (!inst) { console.warn("[wx] page not found:", path); return; }
    const key = ++keyRef.current;
    // Tab swaps fade; relaunch/replace are instant; push slides in.
    setTransition(tab || relaunch || replace ? (tab ? "fade" : null) : "push");
    setStack(prev => {
      let next: StackEntry[];
      if (relaunch) next = [{ path, inst, key }];
      else if (replace && prev.length > 0) next = [...prev.slice(0, -1), { path, inst, key }];
      else next = [...prev, { path, inst, key }];
      stackRef.current = next;
      return next;
    });
  }, []);

  const navigateBack = useCallback((delta: number) => {
    setStack(prev => {
      if (prev.length <= 1) return prev;
      setTransition("pop");
      // Fire onHide + onUnload on pages being popped.
      const popped = prev.slice(Math.max(1, prev.length - delta));
      for (const entry of popped) {
        try { (entry.inst.onHide as Function)?.call(entry.inst); } catch {}
        // onSaveExitState fires before onUnload — return value is saved state.
        try {
          const savedState = (entry.inst.onSaveExitState as Function)?.call(entry.inst);
          if (savedState != null) {
            // Store in sessionStorage so it can be retrieved via getLaunchOptionsSync.
            try { sessionStorage.setItem("wx_exit_state_" + entry.path, JSON.stringify(savedState)); } catch {}
          }
        } catch {}
        try { (entry.inst.onUnload as Function)?.call(entry.inst); } catch {}
      }
      const next = prev.slice(0, Math.max(1, prev.length - delta));
      stackRef.current = next;
      const top = next[next.length - 1];
      try { (top.inst.onShow as Function)?.call(top.inst); } catch {}
      // Reset navbar overrides when returning to a previous page — the
      // previous page's config is the source of truth, not the popped page's overrides.
      setNavTitleOverride(null);
      setNavBgOverride(null);
      setNavTextOverride(null);
      setNavLoading(false);
      // Reset tab badges/red-dots — they are page-specific state.
      setTabBadges({});
      setTabRedDots({});
      return next;
    });
  }, []);

  const switchTab = useCallback((url: string) => {
    const path = url.startsWith("/") ? url.slice(1) : url;
    if (TAB_BAR_CONFIG) {
      const idx = TAB_BAR_CONFIG.list.findIndex((t: TabBarItem) => t.pagePath.replace(/^\\//, "") === path);
      if (idx >= 0) { setActiveTab(idx); navigate("__tab__:" + url); }
    }
  }, [navigate]);

  useEffect(() => {
    (window as any).__wxNavigate = navigate;
    (window as any).__wxNavigateBack = navigateBack;
    (window as any).__wxSwitchTab = switchTab;
    (window as any).getCurrentPages = () => stackRef.current.map(e => e.inst);
  }, [navigate, navigateBack, switchTab]);

  // Tab bar badge/red-dot state — keyed by tab index.
  const [tabBadges, setTabBadges] = useState<Record<number, string>>({});
  const [tabRedDots, setTabRedDots] = useState<Record<number, boolean>>({});
  useEffect(() => {
    (window as any).__wxSetTabBadge = (index: number, text: string) =>
      setTabBadges((prev) => ({ ...prev, [index]: text }));
    (window as any).__wxRemoveTabBadge = (index: number) =>
      setTabBadges((prev) => { const n = { ...prev }; delete n[index]; return n; });
    (window as any).__wxShowTabRedDot = (index: number) =>
      setTabRedDots((prev) => ({ ...prev, [index]: true }));
    (window as any).__wxHideTabRedDot = (index: number) =>
      setTabRedDots((prev) => { const n = { ...prev }; delete n[index]; return n; });
    return () => {
      delete (window as any).__wxSetTabBadge;
      delete (window as any).__wxRemoveTabBadge;
      delete (window as any).__wxShowTabRedDot;
      delete (window as any).__wxHideTabRedDot;
    };
  }, []);
  // write to these via window.__wxSetNavTitle / __wxSetNavBg / __wxSetNavText.
  const [navTitleOverride, setNavTitleOverride] = useState<string | null>(null);
  const [navBgOverride, setNavBgOverride] = useState<string | null>(null);
  const [navTextOverride, setNavTextOverride] = useState<string | null>(null);
  const [navLoading, setNavLoading] = useState(false);
  useEffect(() => {
    (window as any).__wxSetNavTitle = (t: string) => setNavTitleOverride(t);
    (window as any).__wxSetNavBg = (c: string) => setNavBgOverride(c);
    (window as any).__wxSetNavText = (c: string) => setNavTextOverride(c);
    (window as any).__wxSetNavLoading = (v: boolean) => setNavLoading(v);
    return () => {
      delete (window as any).__wxSetNavTitle;
      delete (window as any).__wxSetNavBg;
      delete (window as any).__wxSetNavText;
      delete (window as any).__wxSetNavLoading;
    };
  }, []);
  // Reset overrides when the page changes.
  useEffect(() => {
    setNavTitleOverride(null);
    setNavBgOverride(null);
    setNavTextOverride(null);
    setNavLoading(false);
  }, [stack.length]);

  // Boot: run app.js then load entry page
  useEffect(() => {
    try {
      const appMod = require("./${appJsName}");
      const appFn = appMod?.default ?? appMod;
      if (typeof appFn === "function") appFn({ App, getApp: () => __appInst__, wx });
    } catch(e) { console.error("[wx] app.js error:", e); }
    navigate("${entryPage}");
  }, []);

  const current = stack[stack.length - 1];
  const showBack = stack.length > 1;
  const pageTitle = navTitleOverride ?? (current ? (PAGE_REGISTRY[current.path]?.config?.navigationBarTitleText as string ?? "${navTitle}") : "${navTitle}");
  const pageBg = navBgOverride ?? (current ? (PAGE_REGISTRY[current.path]?.config?.navigationBarBackgroundColor as string ?? "${navBgColor}") : "${navBgColor}");
  const pageTextColor = navTextOverride ?? (current ? (PAGE_REGISTRY[current.path]?.config?.navigationBarTextStyle === "black" ? "#000" : "${navTextColor}") : "${navTextColor}");

  const hasTabBar = !!TAB_BAR_CONFIG && TAB_BAR_CONFIG.list.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f5f5f5" }}>
      {/* Navbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", height: 44, flexShrink: 0, background: pageBg, color: pageTextColor, zIndex: 100 }}>
        {showBack && (
          <button onClick={() => navigateBack(1)} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "inherit", cursor: "pointer", display: "flex", alignItems: "center", padding: "0 8px" }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
        <span style={{ fontSize: 17, fontWeight: 600 }}>{pageTitle}</span>
        {/* Share button — triggers onShareAppMessage / onShareTimeline / onAddToFavorites */}
        {current && (PAGE_REGISTRY[current.path]?.config?.enableShareAppMessage !== false) && (
          <button
            onClick={() => {
              const inst = current.inst;
              const hasShareMsg = typeof (inst.onShareAppMessage as unknown) === "function";
              const hasShareTimeline = typeof (inst.onShareTimeline as unknown) === "function";
              const hasFavorites = typeof (inst.onAddToFavorites as unknown) === "function";
              // Build a mini share menu.
              const menu = document.createElement("div");
              menu.style.cssText = "position:fixed;right:8px;top:52px;background:#fff;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);z-index:99999;overflow:hidden;font-size:14px;min-width:140px;";
              const addItem = (label: string, fn: () => void) => {
                const btn = document.createElement("button");
                btn.textContent = label;
                btn.style.cssText = "display:block;width:100%;padding:12px 16px;background:none;border:none;cursor:pointer;text-align:left;font-size:14px;border-bottom:1px solid rgba(0,0,0,0.06);";
                btn.onclick = () => { menu.remove(); fn(); };
                menu.appendChild(btn);
              };
              if (hasShareMsg) addItem("发送给朋友", () => {
                try { (inst.onShareAppMessage as Function).call(inst, { from: "menu", target: {} }); } catch {}
              });
              if (hasShareTimeline) addItem("分享到朋友圈", () => {
                try { (inst.onShareTimeline as Function).call(inst, {}); } catch {}
              });
              if (hasFavorites) addItem("收藏", () => {
                try { (inst.onAddToFavorites as Function).call(inst, {}); } catch {}
              });
              if (!hasShareMsg && !hasShareTimeline && !hasFavorites) addItem("（页面未定义分享）", () => {});
              document.body.appendChild(menu);
              const close = (e: MouseEvent) => { if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener("click", close); } };
              setTimeout(() => document.addEventListener("click", close), 0);
            }}
            style={{ position: "absolute", right: navLoading ? 36 : 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "inherit", cursor: "pointer", padding: "0 8px", opacity: 0.7 }}
            title="分享"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="1.8"/>
              <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/>
              <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="1.8"/>
              <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        )}
        {navLoading && (
          <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" style={{ animation: "__wx_spin__ 0.8s linear infinite" }}>
              <circle cx="16" cy="16" r="12" stroke="rgba(255,255,255,0.3)" strokeWidth="3"/>
              <path d="M16 4a12 12 0 0 1 12 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </span>
        )}
      </div>

      {/* Page content */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {current && <PageRenderer key={current.key} entry={current} transition={transition} onTransitionEnd={() => setTransition(null)} />}
      </div>

      {/* TabBar */}
      {hasTabBar && (
        <div id="__wx_tabbar__" style={{ display: "flex", height: 50, flexShrink: 0, background: TAB_BAR_CONFIG!.backgroundColor ?? "#fff", borderTop: "1px solid rgba(0,0,0,0.08)", paddingBottom: "env(safe-area-inset-bottom, 0)" }}>
          {TAB_BAR_CONFIG!.list.map((item: TabBarItem, i: number) => {
            const active = i === activeTab;
            const iconSrc = active ? item.selectedIconPath : item.iconPath;
            const tint = active ? TAB_BAR_CONFIG!.selectedColor : TAB_BAR_CONFIG!.color;
            return (
              <button key={i} onClick={() => {
                const path = item.pagePath.replace(/^\\//, "");
                const topInst = stackRef.current[stackRef.current.length - 1]?.inst;
                try { (topInst?.onTabItemTap as Function)?.call(topInst, { index: i, pagePath: item.pagePath, text: item.text }); } catch {}
                switchTab("/" + path);
              }} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", gap: 2, padding: "4px 0", minHeight: 44, position: "relative" }}>
                <div style={{ position: "relative" }}>
                  <TabIcon src={iconSrc} tint={tint} />
                  {tabBadges[i] != null && (
                    <span style={{ position: "absolute", top: -4, right: -8, background: "#fa5151", color: "#fff", fontSize: 9, fontWeight: 600, borderRadius: 8, padding: "1px 4px", minWidth: 14, textAlign: "center", lineHeight: "14px" }}>
                      {tabBadges[i]}
                    </span>
                  )}
                  {tabRedDots[i] && tabBadges[i] == null && (
                    <span style={{ position: "absolute", top: -2, right: -4, width: 8, height: 8, background: "#fa5151", borderRadius: "50%" }} />
                  )}
                </div>
                <span style={{ fontSize: 10, color: tint, lineHeight: 1.2 }}>{item.text}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Renders a tab-bar icon; falls back to a colored dot if the iconPath is missing
// or fails to load (preview only sends text source files, so asset paths 404).
function TabIcon({ src, tint }: { src: string | undefined; tint: string }) {
  const [failed, setFailed] = useState(!src);
  if (!src || failed) {
    return (
      <div style={{ width: 22, height: 22, borderRadius: 11, background: tint, opacity: 0.85 }} />
    );
  }
  return (
    <img src={src} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} onError={() => setFailed(true)} />
  );
}

// ── Page renderer — owns reactive data state ──
function PageRenderer({ entry, transition, onTransitionEnd }: { entry: StackEntry; transition: "push" | "pop" | "fade" | null; onTransitionEnd: () => void }) {
  const [data, setData] = useState<Record<string, unknown>>(entry.inst.data as Record<string, unknown>);
  const [animState, setAnimState] = useState<"entering" | "idle">(transition ? "entering" : "idle");
  const [pulling, setPulling] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const reachBottomFiredRef = useRef(false);
  const pageScrollThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset onReachBottom fired flag when the page entry changes (new page navigation).
  useEffect(() => {
    reachBottomFiredRef.current = false;
  }, [entry.key]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const touchStartY = useRef<number | null>(null);

  // Clean up the onPageScroll throttle timer on unmount.
  useEffect(() => {
    return () => {
      if (pageScrollThrottleRef.current) {
        clearTimeout(pageScrollThrottleRef.current);
        pageScrollThrottleRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    (entry.inst as any).__bindSetData(setData);
  }, [entry.inst]);

  // Kick off enter animation next frame so the "from" frame paints first.
  useEffect(() => {
    if (transition && animState === "entering") {
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimState("idle"));
      });
      return () => cancelAnimationFrame(id);
    }
  }, [transition, animState]);

  // Expose wx.stopPullDownRefresh hook for this page.
  useEffect(() => {
    (entry.inst as any).__stopPullDownRefresh = () => { setRefreshing(false); setPulling(0); };
    return () => { (entry.inst as any).__stopPullDownRefresh = null; };
  }, [entry.inst]);

  // Wire wx.pageScrollTo to the scroller.
  useEffect(() => {
    (entry.inst as any).__scrollTo = (opts: { scrollTop?: number; duration?: number }) => {
      if (!scrollerRef.current) return;
      scrollerRef.current.scrollTo({ top: opts.scrollTop ?? 0, behavior: opts.duration === 0 ? "instant" : "smooth" });
    };
    return () => { (entry.inst as any).__scrollTo = null; };
  }, [entry.inst]);

  // Wire onResize lifecycle — fires when the window is resized.
  useEffect(() => {
    const handler = () => {
      try {
        (entry.inst.onResize as Function)?.call(entry.inst, {
          size: { windowWidth: window.innerWidth, windowHeight: window.innerHeight },
        });
      } catch {}
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [entry.inst]);

  const reg = PAGE_REGISTRY[entry.path];
  if (!reg) return <div style={{ padding: 16, color: "red" }}>Page not found: {entry.path}</div>;

  const pullEnabled = !!(reg.config?.enablePullDownRefresh);
  const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Enter/exit transforms for the page wrapper.
  let wrapperStyle: React.CSSProperties = {
    position: "absolute", inset: 0,
    transition: reduceMotion ? "none" : "transform 0.28s ease-out, opacity 0.2s ease-out",
    background: "#f5f5f5",
    willChange: "transform, opacity",
  };
  if (transition === "push" && animState === "entering") wrapperStyle = { ...wrapperStyle, transform: "translateX(100%)" };
  else if (transition === "pop" && animState === "entering") wrapperStyle = { ...wrapperStyle, transform: "translateX(-15%)", opacity: 0.4 };
  else if (transition === "fade" && animState === "entering") wrapperStyle = { ...wrapperStyle, opacity: 0 };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!pullEnabled || refreshing) return;
    const el = scrollerRef.current;
    if (!el || el.scrollTop > 0) return;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartY.current == null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) setPulling(Math.min(dy * 0.5, 80));
  };
  const onTouchEnd = () => {
    if (touchStartY.current == null) { setPulling(0); return; }
    touchStartY.current = null;
    if (pulling >= 60) {
      setPulling(60);
      setRefreshing(true);
      try { (entry.inst.onPullDownRefresh as Function)?.call(entry.inst); } catch(e) { console.error(e); }
      // Auto-stop after 10s as a safety net.
      setTimeout(() => {
        if ((entry.inst as any).__stopPullDownRefresh) (entry.inst as any).__stopPullDownRefresh();
      }, 10000);
    } else {
      setPulling(0);
    }
  };

  const { Component } = reg;
  const spinnerTop = pulling > 0 || refreshing ? pulling - 30 : -40;

  return (
    <div
      style={wrapperStyle}
      onTransitionEnd={() => onTransitionEnd()}
    >
      {/* Pull-to-refresh spinner */}
      {pullEnabled && (
        <div style={{ position: "absolute", top: spinnerTop, left: 0, right: 0, display: "flex", justifyContent: "center", transition: refreshing ? "none" : "top 0.2s ease-out", pointerEvents: "none", zIndex: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 15, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none" style={{ animation: refreshing ? "__wx_spin__ 0.8s linear infinite" : "none", transform: !refreshing ? "rotate(" + (pulling / 60) * 180 + "deg)" : undefined }}>
              <circle cx="16" cy="16" r="12" stroke="rgba(7,193,96,0.2)" strokeWidth="3" />
              <path d="M16 4a12 12 0 0 1 12 12" stroke="#07c160" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )}
      <div
        ref={scrollerRef}
        onTouchStart={pullEnabled ? onTouchStart : undefined}
        onTouchMove={pullEnabled ? onTouchMove : undefined}
        onTouchEnd={pullEnabled ? onTouchEnd : undefined}
        onTouchCancel={pullEnabled ? onTouchEnd : undefined}
        onScroll={(e) => {
          const el = e.currentTarget;
          const scrollTop = el.scrollTop;
          // onPageScroll — throttled to ~16ms (one animation frame) to match WeChat behavior.
          if (!pageScrollThrottleRef.current) {
            pageScrollThrottleRef.current = setTimeout(() => {
              pageScrollThrottleRef.current = null;
              try { (entry.inst.onPageScroll as Function)?.call(entry.inst, { scrollTop }); } catch {}
            }, 16);
          }
          // onReachBottom — fire once per threshold crossing (reset when user scrolls back up)
          const threshold = (reg.config?.onReachBottomDistance as number) ?? 50;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
          if (nearBottom && !reachBottomFiredRef.current) {
            reachBottomFiredRef.current = true;
            try { (entry.inst.onReachBottom as Function)?.call(entry.inst); } catch {}
          } else if (!nearBottom) {
            reachBottomFiredRef.current = false;
          }
        }}
        style={{ height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch", transform: pulling > 0 && !refreshing ? "translateY(" + pulling + "px)" : refreshing ? "translateY(40px)" : "translateY(0)", transition: touchStartY.current != null ? "none" : "transform 0.2s ease-out" } as React.CSSProperties}
      >
        <Component __page__={entry.inst} __data__={data} />
      </div>
    </div>
  );
}

// ── Mount ──
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<WxApp />);
`;
}
