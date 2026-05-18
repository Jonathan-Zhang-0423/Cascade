/**
 * wx.* API polyfill for WeChat Mini Program browser preview.
 * Exported as an ES module; bundled into wx-vendor.js at server startup.
 */

// Injected by esbuild define at compile time — unique per project.
// Falls back to empty string so the polyfill still works when loaded outside
// the compiler pipeline (e.g. unit tests or the vendor bundle preview).
declare const __WX_PROJECT_ID__: string;
const _pid = (typeof __WX_PROJECT_ID__ !== "undefined" && __WX_PROJECT_ID__)
  ? __WX_PROJECT_ID__ + "_"
  : "";
const _key = (k: string) => "wx_" + _pid + k;
const _pfx = "wx_" + _pid;

let _toastTimer: ReturnType<typeof setTimeout> | null = null;

const WX_FONT = '-apple-system,"PingFang SC","Helvetica Neue","Microsoft YaHei",Arial,sans-serif';

// SVG markup is static (defined here in source), not user-controlled.
const SVG_SUCCESS = '<svg width="36" height="36" viewBox="0 0 32 32" fill="none"><polyline points="7,16 13,22 25,10" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_ERROR = '<svg width="36" height="36" viewBox="0 0 32 32" fill="none"><line x1="9" y1="9" x2="23" y2="23" stroke="#fff" stroke-width="3" stroke-linecap="round"/><line x1="23" y1="9" x2="9" y2="23" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';
const SVG_SPINNER = '<svg width="36" height="36" viewBox="0 0 32 32" fill="none" style="animation:__wx_spin__ 0.8s linear infinite"><circle cx="16" cy="16" r="12" stroke="rgba(255,255,255,0.25)" stroke-width="3"/><path d="M16 4a12 12 0 0 1 12 12" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';

function _ensureOverlayStyles() {
  if (document.getElementById("__wx_overlay_style__")) return;
  const s = document.createElement("style");
  s.id = "__wx_overlay_style__";
  s.textContent = `
    @keyframes __wx_spin__ { to { transform: rotate(360deg); } }
    @keyframes __wx_fade_in__ { from { opacity: 0; } to { opacity: 1; } }
    @keyframes __wx_toast_in__ { from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
    #__wx_toast__, #__wx_loading__ { animation: __wx_toast_in__ 0.18s ease-out; }
    #__wx_modal_backdrop__ { animation: __wx_fade_in__ 0.18s ease-out; }
  `;
  document.head.appendChild(s);
}

function _setSvg(el: HTMLElement, svg: string) {
  // SVG constants above are static; safe to insert as HTML. No user input flows here.
  el.innerHTML = svg;
}

function _showToastOverlay(opts: { title?: string; icon?: string; duration?: number; mask?: boolean }) {
  const title = opts.title ?? "";
  const icon = opts.icon ?? "success";
  const duration = opts.duration != null ? opts.duration : 1500;
  document.getElementById("__wx_toast__")?.remove();
  document.getElementById("__wx_toast_mask__")?.remove();
  if (_toastTimer) clearTimeout(_toastTimer);
  _ensureOverlayStyles();
  const el = document.createElement("div");
  el.id = "__wx_toast__";
  const hasIcon = icon !== "none";
  const sizing = hasIcon
    ? "width:120px;height:120px;padding:0;justify-content:center;"
    : "max-width:80%;padding:12px 20px;min-width:0;";
  el.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);" +
    "background:rgba(17,17,17,0.75);color:#fff;border-radius:8px;" +
    "display:flex;flex-direction:column;align-items:center;gap:8px;" +
    "z-index:99999;font-size:14px;line-height:1.4;text-align:center;" +
    "pointer-events:" + (opts.mask ? "auto" : "none") + ";" +
    "font-family:" + WX_FONT + ";" + sizing;
  if (hasIcon) {
    const iconEl = document.createElement("div");
    _setSvg(iconEl, icon === "success" ? SVG_SUCCESS : icon === "error" ? SVG_ERROR : SVG_SPINNER);
    el.appendChild(iconEl);
  }
  if (title) {
    const label = document.createElement("span");
    label.style.cssText = "font-size:14px;max-width:100px;word-break:break-all;";
    label.textContent = title;
    el.appendChild(label);
  }
  if (opts.mask) {
    const backdrop = document.createElement("div");
    backdrop.id = "__wx_toast_mask__";
    backdrop.style.cssText = "position:fixed;inset:0;background:transparent;z-index:99998;";
    document.body.appendChild(backdrop);
  }
  document.body.appendChild(el);
  if (duration > 0) _toastTimer = setTimeout(() => {
    document.getElementById("__wx_toast__")?.remove();
    document.getElementById("__wx_toast_mask__")?.remove();
  }, duration);
}

function _showLoadingOverlay(title?: string, mask?: boolean) {
  document.getElementById("__wx_loading__")?.remove();
  document.getElementById("__wx_loading_mask__")?.remove();
  _ensureOverlayStyles();
  const el = document.createElement("div");
  el.id = "__wx_loading__";
  el.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);" +
    "background:rgba(17,17,17,0.75);color:#fff;border-radius:8px;" +
    "width:120px;height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;" +
    "z-index:99999;font-size:14px;text-align:center;" +
    "pointer-events:" + (mask ? "auto" : "none") + ";" +
    "font-family:" + WX_FONT + ";";
  const spinEl = document.createElement("div");
  _setSvg(spinEl, SVG_SPINNER);
  el.appendChild(spinEl);
  const label = document.createElement("span");
  label.style.cssText = "max-width:100px;word-break:break-all;";
  label.textContent = title ?? "加载中";
  el.appendChild(label);
  if (mask) {
    const backdrop = document.createElement("div");
    backdrop.id = "__wx_loading_mask__";
    backdrop.style.cssText = "position:fixed;inset:0;background:transparent;z-index:99998;";
    document.body.appendChild(backdrop);
  }
  document.body.appendChild(el);
}

function _showModalOverlay(opts: {
  title?: string; content?: string; showCancel?: boolean;
  cancelText?: string; confirmText?: string;
  cancelColor?: string; confirmColor?: string;
  success?: (r: { confirm: boolean; cancel: boolean }) => void;
  complete?: (r: { confirm: boolean; cancel: boolean }) => void;
}) {
  _ensureOverlayStyles();
  const backdrop = document.createElement("div");
  backdrop.id = "__wx_modal_backdrop__";
  backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:center;justify-content:center;padding:24px;font-family:" + WX_FONT + ";";
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;border-radius:8px;width:272px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.12);";

  const body = document.createElement("div");
  body.style.cssText = "padding:24px 20px 20px;text-align:center;";
  if (opts.title) {
    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-size:17px;font-weight:600;color:#1a1a1a;margin-bottom:" + (opts.content ? "10px" : "0") + ";line-height:1.3;";
    titleEl.textContent = opts.title;
    body.appendChild(titleEl);
  }
  if (opts.content) {
    const contentEl = document.createElement("div");
    contentEl.style.cssText = "font-size:15px;color:#555;line-height:1.45;white-space:pre-wrap;";
    contentEl.textContent = opts.content;
    body.appendChild(contentEl);
  }
  box.appendChild(body);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;border-top:1px solid rgba(0,0,0,0.1);";
  const showCancel = opts.showCancel !== false;
  const cancelColor = opts.cancelColor ?? "#576b95";
  const confirmColor = opts.confirmColor ?? "#576b95";

  let cancelBtn: HTMLButtonElement | null = null;
  if (showCancel) {
    cancelBtn = document.createElement("button");
    cancelBtn.style.cssText = "flex:1;padding:14px 0;background:transparent;border:none;border-right:1px solid rgba(0,0,0,0.1);font-size:17px;color:" + cancelColor + ";cursor:pointer;font-family:inherit;";
    cancelBtn.textContent = opts.cancelText ?? "取消";
    btnRow.appendChild(cancelBtn);
  }
  const okBtn = document.createElement("button");
  okBtn.style.cssText = "flex:1;padding:14px 0;background:transparent;border:none;font-size:17px;color:" + confirmColor + ";font-weight:500;cursor:pointer;font-family:inherit;";
  okBtn.textContent = opts.confirmText ?? "确定";
  btnRow.appendChild(okBtn);
  box.appendChild(btnRow);

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  const close = (confirmed: boolean) => {
    backdrop.remove();
    const r = { confirm: confirmed, cancel: !confirmed };
    opts.success?.(r); opts.complete?.(r);
  };
  okBtn.onclick = () => close(true);
  cancelBtn?.addEventListener("click", () => close(false));
}

function _sysInfo() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  return { brand: isIOS ? "Apple" : "Android", model: isIOS ? "iPhone" : "Android Device", pixelRatio: window.devicePixelRatio || 1, screenWidth: window.screen.width, screenHeight: window.screen.height, windowWidth: window.innerWidth, windowHeight: window.innerHeight, statusBarHeight: 20, language: navigator.language || "zh_CN", version: "8.0.0", system: isIOS ? "iOS 16.0" : "Android 12", platform: isIOS ? "ios" : "android", SDKVersion: "3.0.0", fontSizeSetting: 16, safeArea: { left: 0, right: window.innerWidth, top: 20, bottom: window.innerHeight - 34, width: window.innerWidth, height: window.innerHeight - 54 }, errMsg: "getSystemInfo:ok" };
}

type WxOpts = Record<string, unknown> & { success?: (r: unknown) => void; fail?: (r: unknown) => void; complete?: (r: unknown) => void };
const ok = (opts: WxOpts, extra: Record<string, unknown> = {}) => { const r = { errMsg: "ok", ...extra }; opts.success?.(r); opts.complete?.(r); };
const fail = (opts: WxOpts, msg: string) => { const r = { errMsg: msg }; opts.fail?.(r); opts.complete?.(r); };

type WxNav = { __wxNavigate?: (u: string) => void; __wxNavigateBack?: (d: number) => void; __wxSwitchTab?: (u: string) => void; __wxApp__?: unknown };

export const wx = {
  navigateTo(opts: WxOpts & { url?: string }) { try { (window as unknown as WxNav).__wxNavigate?.(opts.url ?? ""); ok(opts, { errMsg: "navigateTo:ok" }); } catch (e: unknown) { fail(opts, "navigateTo:fail " + (e as Error).message); } },
  redirectTo(opts: WxOpts & { url?: string }) { try { (window as unknown as WxNav).__wxNavigate?.("__redirect__:" + (opts.url ?? "")); ok(opts, { errMsg: "redirectTo:ok" }); } catch (e: unknown) { fail(opts, "redirectTo:fail " + (e as Error).message); } },
  navigateBack(opts: WxOpts & { delta?: number } = {}) { try { (window as unknown as WxNav).__wxNavigateBack?.(opts.delta ?? 1); ok(opts, { errMsg: "navigateBack:ok" }); } catch (e: unknown) { fail(opts, "navigateBack:fail " + (e as Error).message); } },
  switchTab(opts: WxOpts & { url?: string }) { try { (window as unknown as WxNav).__wxSwitchTab?.(opts.url ?? ""); ok(opts, { errMsg: "switchTab:ok" }); } catch (e: unknown) { fail(opts, "switchTab:fail " + (e as Error).message); } },
  reLaunch(opts: WxOpts & { url?: string }) { try { (window as unknown as WxNav).__wxNavigate?.("__relaunch__:" + (opts.url ?? "")); ok(opts, { errMsg: "reLaunch:ok" }); } catch (e: unknown) { fail(opts, "reLaunch:fail " + (e as Error).message); } },

  showToast(opts: WxOpts & { title?: string; icon?: string; duration?: number; mask?: boolean }) { _showToastOverlay(opts); ok(opts, { errMsg: "showToast:ok" }); },
  hideToast(opts: WxOpts = {}) { document.getElementById("__wx_toast__")?.remove(); document.getElementById("__wx_toast_mask__")?.remove(); ok(opts, { errMsg: "hideToast:ok" }); },
  showLoading(opts: WxOpts & { title?: string; mask?: boolean }) { _showLoadingOverlay(opts.title as string | undefined, opts.mask as boolean | undefined); ok(opts, { errMsg: "showLoading:ok" }); },
  hideLoading(opts: WxOpts = {}) { document.getElementById("__wx_loading__")?.remove(); document.getElementById("__wx_loading_mask__")?.remove(); ok(opts, { errMsg: "hideLoading:ok" }); },
  showModal: _showModalOverlay,
  showActionSheet(opts: WxOpts & { itemList?: string[]; itemColor?: string }) {
    const items = (opts.itemList as string[]) ?? [];
    const itemColor = (opts.itemColor as string) ?? "#000";
    const backdrop = document.createElement("div");
    backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:flex-end;font-family:" + WX_FONT + ";";
    const sheet = document.createElement("div");
    sheet.style.cssText = "background:#f5f5f5;width:100%;padding:0 8px 8px;";
    const itemsWrap = document.createElement("div");
    itemsWrap.style.cssText = "background:#fff;border-radius:12px;overflow:hidden;margin-bottom:8px;";
    items.forEach((item, i) => {
      const btn = document.createElement("button");
      btn.dataset.idx = String(i);
      btn.style.cssText = "display:block;width:100%;padding:14px;background:#fff;border:none;border-bottom:" + (i < items.length - 1 ? "1px solid rgba(0,0,0,0.06)" : "none") + ";font-size:17px;color:" + itemColor + ";cursor:pointer;text-align:center;font-family:inherit;";
      btn.textContent = item;
      itemsWrap.appendChild(btn);
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.id = "__wx_sc__";
    cancelBtn.style.cssText = "display:block;width:100%;padding:14px;background:#fff;border:none;font-size:17px;color:#000;cursor:pointer;text-align:center;border-radius:12px;font-weight:500;font-family:inherit;";
    cancelBtn.textContent = "取消";
    sheet.appendChild(itemsWrap); sheet.appendChild(cancelBtn);
    backdrop.appendChild(sheet); document.body.appendChild(backdrop);
    itemsWrap.querySelectorAll<HTMLButtonElement>("[data-idx]").forEach((btn) => { btn.onclick = () => { backdrop.remove(); opts.success?.({ tapIndex: parseInt(btn.dataset.idx!, 10) }); }; });
    cancelBtn.onclick = () => { backdrop.remove(); opts.fail?.({ errMsg: "showActionSheet:fail cancel" }); };
    backdrop.onclick = (e) => { if (e.target === backdrop) { backdrop.remove(); opts.fail?.({ errMsg: "showActionSheet:fail cancel" }); } };
  },
  showNavigationBarLoading(opts: WxOpts = {}) {
    (window as unknown as { __wxSetNavLoading?: (v: boolean) => void }).__wxSetNavLoading?.(true);
    ok(opts, { errMsg: "showNavigationBarLoading:ok" });
  },
  hideNavigationBarLoading(opts: WxOpts = {}) {
    (window as unknown as { __wxSetNavLoading?: (v: boolean) => void }).__wxSetNavLoading?.(false);
    ok(opts, { errMsg: "hideNavigationBarLoading:ok" });
  },
  setNavigationBarTitle(opts: WxOpts & { title?: string }) {
    const title = opts.title as string | undefined;
    if (title) {
      document.title = title;
      (window as unknown as { __wxSetNavTitle?: (t: string) => void }).__wxSetNavTitle?.(title);
    }
    ok(opts, { errMsg: "setNavigationBarTitle:ok" });
  },
  setNavigationBarColor(opts: WxOpts & { frontColor?: string; backgroundColor?: string } = {}) {
    if (opts.backgroundColor) {
      (window as unknown as { __wxSetNavBg?: (c: string) => void }).__wxSetNavBg?.(opts.backgroundColor as string);
    }
    if (opts.frontColor) {
      (window as unknown as { __wxSetNavText?: (c: string) => void }).__wxSetNavText?.(opts.frontColor as string);
    }
    ok(opts, { errMsg: "setNavigationBarColor:ok" });
  },
  setTabBarBadge(opts: WxOpts & { index?: number; text?: string } = {}) {
    (window as unknown as { __wxSetTabBadge?: (i: number, t: string) => void }).__wxSetTabBadge?.((opts.index as number) ?? 0, String(opts.text ?? ""));
    ok(opts, { errMsg: "setTabBarBadge:ok" });
  },
  removeTabBarBadge(opts: WxOpts & { index?: number } = {}) {
    (window as unknown as { __wxRemoveTabBadge?: (i: number) => void }).__wxRemoveTabBadge?.((opts.index as number) ?? 0);
    ok(opts, { errMsg: "removeTabBarBadge:ok" });
  },
  showTabBarRedDot(opts: WxOpts & { index?: number } = {}) {
    (window as unknown as { __wxShowTabRedDot?: (i: number) => void }).__wxShowTabRedDot?.((opts.index as number) ?? 0);
    ok(opts, { errMsg: "showTabBarRedDot:ok" });
  },
  hideTabBarRedDot(opts: WxOpts & { index?: number } = {}) {
    (window as unknown as { __wxHideTabRedDot?: (i: number) => void }).__wxHideTabRedDot?.((opts.index as number) ?? 0);
    ok(opts, { errMsg: "hideTabBarRedDot:ok" });
  },
  showTabBar(opts: WxOpts = {}) { document.getElementById("__wx_tabbar__")?.style.setProperty("display", "flex"); ok(opts, {}); },
  hideTabBar(opts: WxOpts = {}) { document.getElementById("__wx_tabbar__")?.style.setProperty("display", "none"); ok(opts, {}); },
  setTabBarItem() {}, setTabBarStyle() {},
  pageScrollTo(opts: WxOpts & { scrollTop?: number; duration?: number } = {}) {
    try {
      const pages = (window as unknown as { getCurrentPages?: () => Array<Record<string, unknown>> }).getCurrentPages?.();
      const top = pages && pages[pages.length - 1];
      (top?.__scrollTo as ((o: { scrollTop?: number; duration?: number }) => void) | null)?.(opts);
    } catch {}
    ok(opts, { errMsg: "pageScrollTo:ok" });
  },
  startPullDownRefresh(opts: WxOpts = {}) { ok(opts, { errMsg: "startPullDownRefresh:ok" }); },
  stopPullDownRefresh(opts: WxOpts = {}) {
    try {
      const pages = (window as unknown as { getCurrentPages?: () => Array<Record<string, unknown>> }).getCurrentPages?.();
      const top = pages && pages[pages.length - 1];
      (top?.__stopPullDownRefresh as (() => void) | null)?.();
    } catch {}
    ok(opts, { errMsg: "stopPullDownRefresh:ok" });
  },
  getMenuButtonBoundingClientRect() {
    // Return a plausible capsule-button rect for a 375px-wide phone frame.
    return { width: 87, height: 32, top: 6, right: 367, bottom: 38, left: 280 };
  },
  onAppShow(cb: (opts: Record<string, unknown>) => void) { window.addEventListener("focus", () => cb({})); },
  onAppHide(cb: () => void) { window.addEventListener("blur", () => cb()); },
  offAppShow() {}, offAppHide() {},
  createMediaQueryObserver() {
    return {
      observe(descriptor: Record<string, unknown>, cb: (res: { matches: boolean }) => void) {
        const mq = descriptor.minWidth != null
          ? window.matchMedia(`(min-width: ${descriptor.minWidth}px)`)
          : descriptor.maxWidth != null
            ? window.matchMedia(`(max-width: ${descriptor.maxWidth}px)`)
            : null;
        if (mq) { cb({ matches: mq.matches }); mq.addEventListener("change", (e) => cb({ matches: e.matches })); }
      },
      disconnect() {},
    };
  },

  request(opts: WxOpts & { url?: string; method?: string; data?: unknown; header?: Record<string, string>; timeout?: number }) {
    const url = opts.url ?? "";
    const method = ((opts.method as string) ?? "GET").toUpperCase();
    const data = opts.data;
    const header: Record<string, string> = (opts.header as Record<string, string>) ?? {};
    const timeoutMs = (opts.timeout as number | undefined) ?? 60000;
    let body: string | undefined;
    if (data && method !== "GET" && method !== "HEAD") {
      header["Content-Type"] = header["Content-Type"] ?? "application/json";
      body = typeof data === "object" ? JSON.stringify(data) : String(data);
    }
    const fetchUrl = method === "GET" && data && typeof data === "object" ? url + "?" + new URLSearchParams(data as Record<string, string>).toString() : url;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(fetchUrl, { method, headers: header, body, signal: controller.signal })
      .then((res) => res.text().then((text) => {
        clearTimeout(timer);
        let responseData: unknown; try { responseData = JSON.parse(text); } catch { responseData = text; }
        const r = { data: responseData, statusCode: res.status, header: Object.fromEntries(res.headers.entries()), errMsg: "request:ok" };
        opts.success?.(r); opts.complete?.(r);
      }))
      .catch((err: Error) => {
        clearTimeout(timer);
        const msg = err.name === "AbortError" ? "request:fail timeout" : "request:fail " + err.message;
        const r = { errMsg: msg };
        opts.fail?.(r); opts.complete?.(r);
      });
    return { abort() { clearTimeout(timer); controller.abort(); } };
  },

  downloadFile(opts: WxOpts & { url?: string; header?: Record<string, string>; filePath?: string } = {}) {
    const url = opts.url ?? "";
    fetch(url, { headers: (opts.header as Record<string, string>) ?? {} })
      .then((res) => res.blob().then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const r = { tempFilePath: objectUrl, filePath: opts.filePath ?? objectUrl, statusCode: res.status, errMsg: "downloadFile:ok" };
        opts.success?.(r); opts.complete?.(r);
      }))
      .catch((err: Error) => { const r = { errMsg: "downloadFile:fail " + err.message }; opts.fail?.(r); opts.complete?.(r); });
    return { abort() {}, onProgressUpdate() {} };
  },

  uploadFile(opts: WxOpts & { url?: string; filePath?: string; name?: string; header?: Record<string, string>; formData?: Record<string, string> } = {}) {
    const url = opts.url ?? "";
    const form = new FormData();
    if (opts.filePath) {
      // filePath may be an object URL from chooseImage — fetch it back as a blob.
      fetch(opts.filePath as string)
        .then((r) => r.blob())
        .then((blob) => {
          form.append(opts.name ?? "file", blob, "upload");
          for (const [k, v] of Object.entries((opts.formData as Record<string, string>) ?? {})) form.append(k, v);
          return fetch(url, { method: "POST", headers: (opts.header as Record<string, string>) ?? {}, body: form });
        })
        .then((res) => res.text().then((text) => {
          const r = { data: text, statusCode: res.status, errMsg: "uploadFile:ok" };
          opts.success?.(r); opts.complete?.(r);
        }))
        .catch((err: Error) => { const r = { errMsg: "uploadFile:fail " + err.message }; opts.fail?.(r); opts.complete?.(r); });
    } else {
      fail(opts, "uploadFile:fail no filePath");
    }
    return { abort() {}, onProgressUpdate() {} };
  },

  setStorage(opts: WxOpts & { key?: string; data?: unknown }) { try { localStorage.setItem(_key(opts.key!), JSON.stringify(opts.data)); ok(opts, { errMsg: "setStorage:ok" }); } catch (e: unknown) { fail(opts, "setStorage:fail " + (e as Error).message); } },
  setStorageSync(key: string, data: unknown) { try { localStorage.setItem(_key(key), JSON.stringify(data)); } catch {} },
  getStorage(opts: WxOpts & { key?: string }) { try { const raw = localStorage.getItem(_key(opts.key!)); if (raw === null) throw new Error("data not found"); ok(opts, { data: JSON.parse(raw), errMsg: "getStorage:ok" }); } catch (e: unknown) { fail(opts, "getStorage:fail " + (e as Error).message); } },
  getStorageSync(key: string): unknown { try { return JSON.parse(localStorage.getItem(_key(key)) ?? "null"); } catch { return null; } },
  removeStorage(opts: WxOpts & { key?: string }) { localStorage.removeItem(_key(opts.key!)); ok(opts, { errMsg: "removeStorage:ok" }); },
  removeStorageSync(key: string) { localStorage.removeItem(_key(key)); },
  clearStorage(opts: WxOpts = {}) { Object.keys(localStorage).filter((k) => k.startsWith(_pfx)).forEach((k) => localStorage.removeItem(k)); ok(opts, { errMsg: "clearStorage:ok" }); },
  clearStorageSync() { Object.keys(localStorage).filter((k) => k.startsWith(_pfx)).forEach((k) => localStorage.removeItem(k)); },
  getStorageInfo(opts: WxOpts = {}) { const keys = Object.keys(localStorage).filter((k) => k.startsWith(_pfx)).map((k) => k.slice(_pfx.length)); ok(opts, { keys, currentSize: 0, limitSize: 10240, errMsg: "getStorageInfo:ok" }); },
  getStorageInfoSync() { return { keys: Object.keys(localStorage).filter((k) => k.startsWith(_pfx)).map((k) => k.slice(_pfx.length)), currentSize: 0, limitSize: 10240 }; },

  getSystemInfo(opts: WxOpts = {}) { ok(opts, _sysInfo()); },
  getSystemInfoSync: _sysInfo,
  getWindowInfo: _sysInfo,
  getNetworkType(opts: WxOpts = {}) { ok(opts, { networkType: navigator.onLine ? "wifi" : "none", errMsg: "getNetworkType:ok" }); },
  onNetworkStatusChange(cb: (r: { isConnected: boolean; networkType: string }) => void) { window.addEventListener("online", () => cb({ isConnected: true, networkType: "wifi" })); window.addEventListener("offline", () => cb({ isConnected: false, networkType: "none" })); },
  offNetworkStatusChange() {},
  vibrateLong(opts: WxOpts = {}) { navigator.vibrate?.(400); ok(opts, {}); },
  vibrateShort(opts: WxOpts = {}) { navigator.vibrate?.(15); ok(opts, {}); },
  getBatteryInfo(opts: WxOpts = {}) { ok(opts, { level: 100, isCharging: true, errMsg: "getBatteryInfo:ok" }); },

  setClipboardData(opts: WxOpts & { data?: string }) { if (navigator.clipboard) { navigator.clipboard.writeText(opts.data ?? "").then(() => ok(opts, { errMsg: "setClipboardData:ok" })).catch((e: Error) => fail(opts, "setClipboardData:fail " + e)); } else { ok(opts, { errMsg: "setClipboardData:ok" }); } },
  getClipboardData(opts: WxOpts = {}) { if (navigator.clipboard) { navigator.clipboard.readText().then((t) => ok(opts, { data: t, errMsg: "getClipboardData:ok" })).catch((e: Error) => fail(opts, "getClipboardData:fail " + e)); } else { fail(opts, "getClipboardData:fail"); } },

  getLocation(opts: WxOpts = {}) { if (navigator.geolocation) { navigator.geolocation.getCurrentPosition((p) => ok(opts, { latitude: p.coords.latitude, longitude: p.coords.longitude, speed: p.coords.speed ?? 0, accuracy: p.coords.accuracy, errMsg: "getLocation:ok" }), (e) => fail(opts, "getLocation:fail " + e.message)); } else { fail(opts, "getLocation:fail"); } },
  chooseLocation(opts: WxOpts = {}) { fail(opts, "chooseLocation:fail not supported in preview"); },
  onLocationChange() {}, offLocationChange() {}, startLocationUpdate() {}, stopLocationUpdate() {},

  chooseImage(opts: WxOpts & { count?: number } = {}) { const input = document.createElement("input"); input.type = "file"; input.accept = "image/*"; if ((opts.count ?? 9) > 1) input.multiple = true; input.onchange = () => { const files = Array.from(input.files ?? []); const paths = files.map((f) => URL.createObjectURL(f)); ok(opts, { tempFilePaths: paths, tempFiles: files.map((f, i) => ({ path: paths[i], size: f.size })), errMsg: "chooseImage:ok" }); }; input.click(); },
  chooseVideo(opts: WxOpts = {}) { const input = document.createElement("input"); input.type = "file"; input.accept = "video/*"; input.onchange = () => { const f = input.files?.[0]; if (f) ok(opts, { tempFilePath: URL.createObjectURL(f), size: f.size, errMsg: "chooseVideo:ok" }); }; input.click(); },
  chooseMedia(opts: WxOpts & { count?: number; mediaType?: string[]; sourceType?: string[] } = {}) {
    const types = (opts.mediaType as string[] | undefined) ?? ["image", "video"];
    const accept = types.includes("video") && !types.includes("image") ? "video/*"
      : types.includes("image") && !types.includes("video") ? "image/*"
      : "image/*,video/*";
    const input = document.createElement("input");
    input.type = "file"; input.accept = accept;
    if ((opts.count ?? 9) > 1) input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      const tempFiles = files.map((f) => ({
        tempFilePath: URL.createObjectURL(f),
        size: f.size,
        duration: 0,
        height: 0,
        width: 0,
        thumbTempFilePath: "",
        fileType: f.type.startsWith("video") ? "video" : "image",
      }));
      ok(opts, { tempFiles, errMsg: "chooseMedia:ok" });
    };
    input.click();
  },
  getImageInfo(opts: WxOpts & { src?: string } = {}) {
    const img = new Image();
    img.onload = () => ok(opts, { width: img.naturalWidth, height: img.naturalHeight, path: opts.src ?? "", type: "unknown", orientation: "up", errMsg: "getImageInfo:ok" });
    img.onerror = () => fail(opts, "getImageInfo:fail");
    img.src = opts.src ?? "";
  },
  compressImage(opts: WxOpts & { src?: string; quality?: number } = {}) {
    // In preview, return the original src unchanged (no canvas compression needed for testing).
    ok(opts, { tempFilePath: opts.src ?? "", errMsg: "compressImage:ok" });
  },
  saveVideoToPhotosAlbum(opts: WxOpts = {}) { fail(opts, "saveVideoToPhotosAlbum:fail not supported in preview"); },
  previewImage(opts: WxOpts & { current?: string; urls?: string[] } = {}) { const lb = document.createElement("div"); lb.style.cssText = "position:fixed;inset:0;background:#000;z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;"; const img = document.createElement("img"); img.src = opts.current ?? opts.urls?.[0] ?? ""; img.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;"; lb.appendChild(img); lb.onclick = () => { lb.remove(); opts.complete?.({ errMsg: "previewImage:ok" }); }; document.body.appendChild(lb); ok(opts, { errMsg: "previewImage:ok" }); },
  previewMedia(opts: WxOpts & { current?: number; sources?: Array<{ url: string; type?: string }> } = {}) {
    const sources = (opts.sources as Array<{ url: string; type?: string }>) ?? [];
    const src = sources[opts.current ?? 0]?.url ?? "";
    if (src) {
      const lb = document.createElement("div");
      lb.style.cssText = "position:fixed;inset:0;background:#000;z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;";
      const el = sources[opts.current ?? 0]?.type === "video"
        ? Object.assign(document.createElement("video"), { src, controls: true, style: "max-width:100%;max-height:100%;" })
        : Object.assign(document.createElement("img"), { src, style: "max-width:100%;max-height:100%;object-fit:contain;" });
      lb.appendChild(el); lb.onclick = (e) => { if (e.target === lb) lb.remove(); }; document.body.appendChild(lb);
    }
    ok(opts, { errMsg: "previewMedia:ok" });
  },
  saveImageToPhotosAlbum(opts: WxOpts = {}) { fail(opts, "saveImageToPhotosAlbum:fail not supported in preview"); },
  openLocation(opts: WxOpts & { latitude?: number; longitude?: number; name?: string; address?: string } = {}) {
    const lat = opts.latitude ?? 0;
    const lng = opts.longitude ?? 0;
    const name = encodeURIComponent((opts.name as string) ?? "");
    window.open(`https://maps.google.com/?q=${lat},${lng}&label=${name}`, "_blank");
    ok(opts, { errMsg: "openLocation:ok" });
  },
  requestSubscribeMessage(opts: WxOpts & { tmplIds?: string[] } = {}) {
    const result: Record<string, string> = {};
    for (const id of (opts.tmplIds as string[]) ?? []) result[id] = "accept";
    ok(opts, { ...result, errMsg: "requestSubscribeMessage:ok" });
  },
  requestSubscribeDeviceMessage(opts: WxOpts = {}) { ok(opts, { errMsg: "requestSubscribeDeviceMessage:ok" }); },
  showRedPackage(opts: WxOpts = {}) { ok(opts, { errMsg: "showRedPackage:ok" }); },

  canvasToTempFilePath(opts: WxOpts & { canvasId?: string } = {}) { const c = document.getElementById(opts.canvasId ?? "") as HTMLCanvasElement | null; if (c) ok(opts, { tempFilePath: c.toDataURL(), errMsg: "canvasToTempFilePath:ok" }); else fail(opts, "canvasToTempFilePath:fail"); },

  login(opts: WxOpts = {}) { ok(opts, { code: "PREVIEW_CODE_" + Date.now(), errMsg: "login:ok" }); },
  checkSession(opts: WxOpts = {}) { ok(opts, { errMsg: "checkSession:ok" }); },
  getUserInfo(opts: WxOpts = {}) { ok(opts, { userInfo: { nickName: "Preview User", avatarUrl: "", gender: 0, country: "", province: "", city: "", language: "zh_CN" }, errMsg: "getUserInfo:ok" }); },
  getUserProfile(opts: WxOpts = {}) { wx.getUserInfo(opts); },
  authorize(opts: WxOpts = {}) { ok(opts, { errMsg: "authorize:ok" }); },
  openSetting(opts: WxOpts = {}) { ok(opts, { authSetting: {}, errMsg: "openSetting:ok" }); },
  getSetting(opts: WxOpts = {}) { ok(opts, { authSetting: {}, errMsg: "getSetting:ok" }); },
  requestPayment(opts: WxOpts = {}) { _showModalOverlay({ title: "支付", content: "支付在预览环境中不可用。", showCancel: false, confirmText: "确定" }); fail(opts, "requestPayment:fail not supported in preview"); },
  showShareMenu(opts: WxOpts = {}) { ok(opts, { errMsg: "showShareMenu:ok" }); },
  hideShareMenu(opts: WxOpts = {}) { ok(opts, { errMsg: "hideShareMenu:ok" }); },
  updateShareMenu() {},
  getShareInfo(opts: WxOpts = {}) { ok(opts, { errMsg: "getShareInfo:ok", encryptedData: "", iv: "", cloudID: "" }); },
  makePhoneCall(opts: WxOpts & { phoneNumber?: string } = {}) {
    // In a browser we can attempt tel: link; most desktop browsers will prompt.
    if (opts.phoneNumber) {
      const a = document.createElement("a");
      a.href = "tel:" + (opts.phoneNumber as string);
      a.click();
    }
    ok(opts, { errMsg: "makePhoneCall:ok" });
  },
  scanCode(opts: WxOpts & { onlyFromCamera?: boolean } = {}) {
    // No camera access in preview — return a mock QR result.
    ok(opts, { result: "https://example.com", scanType: "QR_CODE", charSet: "UTF-8", rawData: "", errMsg: "scanCode:ok" });
  },
  openDocument(opts: WxOpts & { filePath?: string; fileType?: string } = {}) {
    if (opts.filePath) { window.open(opts.filePath as string, "_blank"); }
    ok(opts, { errMsg: "openDocument:ok" });
  },
  addCard(opts: WxOpts = {}) { ok(opts, { cardList: [], errMsg: "addCard:ok" }); },
  openCard(opts: WxOpts = {}) { ok(opts, { errMsg: "openCard:ok" }); },
  getAccountInfoSync() {
    return {
      miniProgram: { appId: "wx_preview_appid", envVersion: "release", version: "1.0.0" },
      plugin: { appId: "", version: "" },
    };
  },
  getLaunchOptionsSync() {
    return { scene: 1001, path: "", query: {}, referrerInfo: {}, forwardMaterials: [], chatType: 1 };
  },
  getEnterOptionsSync() {
    return { scene: 1001, path: "", query: {}, referrerInfo: {}, forwardMaterials: [], chatType: 1 };
  },
  onLaunch(cb: (opts: Record<string, unknown>) => void) { setTimeout(() => cb({ scene: 1001, path: "", query: {}, referrerInfo: {} }), 0); },
  nextTick(cb: () => void) { setTimeout(cb, 0); },
  reportMonitor() {}, reportAnalytics() {}, reportEvent() {}, reportPerformance() {},
  canIUse() { return true; },
  env: { USER_DATA_PATH: "wxfile://usr", VERSION: "1.0.0" },
  base64ToArrayBuffer(str: string) { const binary = atob(str); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes.buffer; },
  arrayBufferToBase64(buf: ArrayBuffer) { const bytes = new Uint8Array(buf); let binary = ""; for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]); return btoa(binary); },

  // ── Error / rejection handlers ─────────────────────────────────────────────
  onError(cb: (msg: string) => void) { window.addEventListener("error", (e) => cb(e.message)); },
  offError() {},
  onUnhandledRejection(cb: (r: { reason: unknown; promise: Promise<unknown> }) => void) {
    window.addEventListener("unhandledrejection", (e) => cb({ reason: e.reason, promise: e.promise }));
  },
  offUnhandledRejection() {},

  // ── Background color ───────────────────────────────────────────────────────
  setBackgroundColor(opts: WxOpts & { backgroundColor?: string; backgroundColorTop?: string; backgroundColorBottom?: string } = {}) {
    const color = (opts.backgroundColor ?? opts.backgroundColorTop) as string | undefined;
    if (color) {
      const page = document.getElementById("__wx_page__");
      if (page) page.style.background = color;
    }
    ok(opts, { errMsg: "setBackgroundColor:ok" });
  },
  setBackgroundTextStyle(opts: WxOpts & { textStyle?: "dark" | "light" } = {}) {
    ok(opts, { errMsg: "setBackgroundTextStyle:ok" });
  },

  // ── App / device info ──────────────────────────────────────────────────────
  getAppBaseInfo() {
    return { SDKVersion: "3.0.0", enableDebug: false, host: { env: "WeChat" }, language: navigator.language || "zh_CN", version: "8.0.0", theme: "light" };
  },
  getDeviceInfo() {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    return { brand: isIOS ? "Apple" : "Android", model: isIOS ? "iPhone" : "Android Device", system: isIOS ? "iOS 16.0" : "Android 12", platform: isIOS ? "ios" : "android", deviceOrientation: "portrait", devicePixelRatio: window.devicePixelRatio || 2 };
  },
  getAppAuthorizeSetting() { return { albumAuthorized: "authorized", bluetoothAuthorized: "authorized", cameraAuthorized: "authorized", locationAuthorized: "authorized", locationReducedAccuracy: false, microphoneAuthorized: "authorized", notificationAuthorized: "authorized", notificationHidePreview: "authorized", phoneCalendarAuthorized: "authorized" }; },

  // ── Performance ────────────────────────────────────────────────────────────
  getPerformance() {
    return {
      getEntries() { return []; },
      getEntriesByType() { return []; },
      getEntriesByName() { return []; },
      createObserver() { return { observe() {}, disconnect() {} }; },
    };
  },

  // ── Worker ─────────────────────────────────────────────────────────────────
  createWorker(scriptPath: string) {
    // Web Workers require a separate script file — not feasible in the preview
    // sandbox. Return a stub that logs a warning.
    console.warn("[wx] createWorker is not supported in preview:", scriptPath);
    return {
      postMessage() {},
      onMessage(_cb: (r: { message: unknown }) => void) {},
      terminate() {},
    };
  },

  // ── Offscreen canvas ───────────────────────────────────────────────────────
  createOffscreenCanvas(opts: { type?: "2d" | "webgl"; width?: number; height?: number } = {}) {
    const canvas = document.createElement("canvas");
    canvas.width = opts.width ?? 300;
    canvas.height = opts.height ?? 150;
    return canvas;
  },

  // ── Update manager ─────────────────────────────────────────────────────────
  getUpdateManager() {
    return {
      onCheckForUpdate(cb: (r: { hasUpdate: boolean }) => void) { setTimeout(() => cb({ hasUpdate: false }), 0); },
      onUpdateReady(cb: () => void) { void cb; },
      onUpdateFailed(cb: () => void) { void cb; },
      applyUpdate() {},
    };
  },

  // ── Video / live player context ────────────────────────────────────────────
  createVideoContext(videoId: string) {
    const getEl = () => document.getElementById(videoId) as HTMLVideoElement | null;
    return {
      play() { getEl()?.play(); },
      pause() { getEl()?.pause(); },
      stop() { const v = getEl(); if (v) { v.pause(); v.currentTime = 0; } },
      seek(pos: number) { const v = getEl(); if (v) v.currentTime = pos; },
      sendDanmu() {},
      playbackRate(rate: number) { const v = getEl(); if (v) v.playbackRate = rate; },
      requestFullScreen() { getEl()?.requestFullscreen?.(); },
      exitFullScreen() { document.exitFullscreen?.(); },
    };
  },
  createLivePlayerContext() {
    return { play() {}, stop() {}, mute() {}, unmute() {}, requestFullScreen() {}, exitFullScreen() {}, snapshot() {} };
  },

  // ── WebSocket ──────────────────────────────────────────────────────────────
  connectSocket(opts: WxOpts & { url?: string; header?: Record<string, string>; protocols?: string[] } = {}) {
    let ws: WebSocket | null = null;
    try { ws = new WebSocket(opts.url ?? "", opts.protocols); } catch {}
    const task = {
      send(o: WxOpts & { data?: string | ArrayBuffer } = {}) { ws?.send(o.data ?? ""); ok(o, {}); },
      close(o: WxOpts = {}) { ws?.close(); ok(o, {}); },
      onOpen(cb: () => void) { ws?.addEventListener("open", () => cb()); },
      onClose(cb: (r: { code: number; reason: string }) => void) { ws?.addEventListener("close", (e) => cb({ code: e.code, reason: e.reason })); },
      onError(cb: (r: { errMsg: string }) => void) { ws?.addEventListener("error", () => cb({ errMsg: "socket error" })); },
      onMessage(cb: (r: { data: string | ArrayBuffer }) => void) { ws?.addEventListener("message", (e) => cb({ data: e.data })); },
    };
    ws?.addEventListener("open", () => ok(opts, { errMsg: "connectSocket:ok" }));
    ws?.addEventListener("error", () => fail(opts, "connectSocket:fail"));
    return task;
  },
  sendSocketMessage(opts: WxOpts & { data?: string | ArrayBuffer } = {}) { ok(opts, {}); },
  closeSocket(opts: WxOpts = {}) { ok(opts, {}); },
  onSocketOpen(cb: () => void) { void cb; },
  onSocketClose(cb: () => void) { void cb; },
  onSocketError(cb: () => void) { void cb; },
  onSocketMessage(cb: () => void) { void cb; },

  // ── Recorder ──────────────────────────────────────────────────────────────
  getRecorderManager() {
    return {
      start() {}, stop() {}, pause() {}, resume() {},
      onStart(cb: () => void) { void cb; },
      onStop(cb: (r: { tempFilePath: string }) => void) { void cb; },
      onPause(cb: () => void) { void cb; },
      onResume(cb: () => void) { void cb; },
      onError(cb: (r: { errMsg: string }) => void) { void cb; },
      onFrameRecorded(cb: (r: { frameBuffer: ArrayBuffer; isLastFrame: boolean }) => void) { void cb; },
    };
  },

  // ── Navigate to mini-program ───────────────────────────────────────────────
  navigateToMiniProgram(opts: WxOpts & { appId?: string; path?: string } = {}) {
    _showModalOverlay({ title: "跳转小程序", content: `跳转到 ${opts.appId ?? "其他小程序"} 在预览中不可用。`, showCancel: false, confirmText: "确定" });
    fail(opts, "navigateToMiniProgram:fail not supported in preview");
  },
  navigateBackMiniProgram(opts: WxOpts = {}) { ok(opts, {}); },
  exitMiniProgram(opts: WxOpts = {}) { ok(opts, {}); },

  createSelectorQuery() {
    type FieldsOpts = { id?: boolean; dataset?: boolean; rect?: boolean; size?: boolean; scrollOffset?: boolean; node?: boolean; properties?: string[]; computedStyle?: string[] };
    type Q = { sel: string | null; all: boolean; vp: boolean; type: string; cb?: (r: unknown) => void; opts?: FieldsOpts };
    const queries: Q[] = [];
    const query = {
      select(s: string) { return this._q(s, false, false); },
      selectAll(s: string) { return this._q(s, true, false); },
      selectViewport() { return this._q(null, false, true); },
      _q(sel: string | null, all: boolean, vp: boolean) {
        const m = {
          boundingClientRect(cb?: (r: unknown) => void) { queries.push({ sel, all, vp, type: "rect", cb }); return m; },
          scrollOffset(cb?: (r: unknown) => void) { queries.push({ sel, all, vp, type: "scroll", cb }); return m; },
          fields(opts: FieldsOpts, cb?: (r: unknown) => void) { queries.push({ sel, all, vp, type: "fields", cb, opts }); return m; },
          exec(cb?: (r: unknown[]) => void) { return query.exec(cb); },
        };
        return m;
      },
      exec(cb?: (r: unknown[]) => void) {
        const results = queries.map((q) => {
          if (q.type === "rect") {
            if (q.vp) { const r = { width: window.innerWidth, height: window.innerHeight }; q.cb?.(r); return r; }
            const result = q.all
              ? Array.from(document.querySelectorAll(q.sel ?? "")).map((e) => e.getBoundingClientRect())
              : (document.querySelector(q.sel ?? "") as Element | null)?.getBoundingClientRect() ?? null;
            q.cb?.(result); return result;
          }
          if (q.type === "scroll") {
            if (q.vp) { const r = { scrollLeft: window.scrollX, scrollTop: window.scrollY, scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight, width: window.innerWidth, height: window.innerHeight }; q.cb?.(r); return r; }
            const el = document.querySelector(q.sel ?? "") as Element | null;
            const r = el ? { scrollLeft: el.scrollLeft, scrollTop: el.scrollTop } : null;
            q.cb?.(r); return r;
          }
          // fields query — honor opts.{node, size, rect, scrollOffset, id, dataset}
          const opts = q.opts ?? {};
          const buildFields = (el: Element): Record<string, unknown> => {
            const rect = el.getBoundingClientRect();
            const out: Record<string, unknown> = {};
            if (opts.id) out.id = el.id;
            if (opts.node) out.node = el;
            if (opts.size) { out.width = rect.width; out.height = rect.height; }
            if (opts.rect) { out.left = rect.left; out.top = rect.top; out.right = rect.right; out.bottom = rect.bottom; }
            if (opts.scrollOffset) { out.scrollLeft = (el as HTMLElement).scrollLeft; out.scrollTop = (el as HTMLElement).scrollTop; }
            if (opts.dataset) {
              const ds: Record<string, string> = {};
              for (const a of Array.from(el.attributes)) if (a.name.startsWith("data-")) ds[a.name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = a.value;
              out.dataset = ds;
            }
            return out;
          };
          if (q.vp) { const r = { width: window.innerWidth, height: window.innerHeight }; q.cb?.(r); return r; }
          if (q.all) {
            const els = Array.from(document.querySelectorAll(q.sel ?? ""));
            const r = els.map(buildFields);
            q.cb?.(r); return r;
          }
          const el = document.querySelector(q.sel ?? "") as Element | null;
          const r = el ? buildFields(el) : null;
          q.cb?.(r); return r;
        });
        cb?.(results);
      },
    };
    return query;
  },

  getFileSystemManager() {
    // localStorage-backed virtual file system for preview.
    // Files are stored as wx_fs_<path> keys.
    const fsKey = (p: string) => "wx_fs_" + _pid + p;
    return {
      readFile(opts: WxOpts & { filePath?: string; encoding?: string } = {}) {
        const path = opts.filePath as string | undefined;
        if (!path) { fail(opts, "readFile:fail invalid path"); return; }
        const raw = localStorage.getItem(fsKey(path));
        if (raw === null) { fail(opts, "readFile:fail file not found"); return; }
        const encoding = (opts.encoding as string | undefined) ?? "utf-8";
        let data: string | ArrayBuffer = raw;
        if (encoding === "base64") {
          try { data = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)).buffer; } catch { data = raw; }
        } else if (encoding === "binary") {
          try { data = Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer; } catch { data = raw; }
        }
        ok(opts, { data, errMsg: "readFile:ok" });
      },
      readFileSync(filePath: string, encoding?: string): string | ArrayBuffer {
        const raw = localStorage.getItem(fsKey(filePath));
        if (raw === null) throw new Error("readFileSync:fail file not found");
        if (encoding === "base64") {
          try { return Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)).buffer; } catch {}
        }
        return raw;
      },
      writeFile(opts: WxOpts & { filePath?: string; data?: string | ArrayBuffer; encoding?: string } = {}) {
        const path = opts.filePath as string | undefined;
        if (!path) { fail(opts, "writeFile:fail invalid path"); return; }
        const data = typeof opts.data === "string" ? opts.data : "";
        try { localStorage.setItem(fsKey(path), data); ok(opts, { errMsg: "writeFile:ok" }); }
        catch (e: unknown) { fail(opts, "writeFile:fail " + (e as Error).message); }
      },
      writeFileSync(filePath: string, data: string) {
        localStorage.setItem(fsKey(filePath), data);
      },
      appendFile(opts: WxOpts & { filePath?: string; data?: string } = {}) {
        const path = opts.filePath as string | undefined;
        if (!path) { fail(opts, "appendFile:fail invalid path"); return; }
        const existing = localStorage.getItem(fsKey(path)) ?? "";
        localStorage.setItem(fsKey(path), existing + (opts.data ?? ""));
        ok(opts, { errMsg: "appendFile:ok" });
      },
      unlink(opts: WxOpts & { filePath?: string } = {}) {
        const path = opts.filePath as string | undefined;
        if (path) localStorage.removeItem(fsKey(path));
        ok(opts, { errMsg: "unlink:ok" });
      },
      readdir(opts: WxOpts & { dirPath?: string } = {}) {
        const prefix = fsKey(opts.dirPath ?? "/");
        const files = Object.keys(localStorage)
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length).split("/")[0])
          .filter(Boolean);
        ok(opts, { files: [...new Set(files)], errMsg: "readdir:ok" });
      },
      mkdir(opts: WxOpts = {}) { ok(opts, { errMsg: "mkdir:ok" }); },
      rmdir(opts: WxOpts = {}) { ok(opts, { errMsg: "rmdir:ok" }); },
      stat(opts: WxOpts & { path?: string } = {}) {
        const path = opts.path as string | undefined;
        const exists = path ? localStorage.getItem(fsKey(path)) !== null : false;
        if (!exists) { fail(opts, "stat:fail file not found"); return; }
        ok(opts, { stats: { isFile: () => true, isDirectory: () => false, size: localStorage.getItem(fsKey(path!))?.length ?? 0, lastModifiedTime: Date.now() }, errMsg: "stat:ok" });
      },
      access(opts: WxOpts & { path?: string } = {}) {
        const path = opts.path as string | undefined;
        if (path && localStorage.getItem(fsKey(path)) !== null) ok(opts, { errMsg: "access:ok" });
        else fail(opts, "access:fail file not found");
      },
      saveFile(opts: WxOpts & { tempFilePath?: string; filePath?: string } = {}) {
        const src = opts.tempFilePath as string | undefined;
        const dest = opts.filePath as string | undefined ?? src;
        ok(opts, { savedFilePath: dest, errMsg: "saveFile:ok" });
      },
      getSavedFileList(opts: WxOpts = {}) {
        const files = Object.keys(localStorage)
          .filter((k) => k.startsWith("wx_fs_" + _pid))
          .map((k) => ({ filePath: k.slice(("wx_fs_" + _pid).length), size: localStorage.getItem(k)?.length ?? 0, createTime: 0 }));
        ok(opts, { fileList: files, errMsg: "getSavedFileList:ok" });
      },
      removeSavedFile(opts: WxOpts & { filePath?: string } = {}) {
        if (opts.filePath) localStorage.removeItem(fsKey(opts.filePath as string));
        ok(opts, { errMsg: "removeSavedFile:ok" });
      },
    };
  },

  // ── Audio ──────────────────────────────────────────────────────────────────
  createInnerAudioContext() {
    const audio = new Audio();
    let _onPlay: (() => void) | null = null;
    let _onPause: (() => void) | null = null;
    let _onStop: (() => void) | null = null;
    let _onEnded: (() => void) | null = null;
    let _onError: ((e: { errMsg: string }) => void) | null = null;
    let _onTimeUpdate: (() => void) | null = null;
    audio.addEventListener("play", () => _onPlay?.());
    audio.addEventListener("pause", () => _onPause?.());
    audio.addEventListener("ended", () => { _onStop?.(); _onEnded?.(); });
    audio.addEventListener("error", () => _onError?.({ errMsg: "audio error" }));
    audio.addEventListener("timeupdate", () => _onTimeUpdate?.());
    return {
      get src() { return audio.src; },
      set src(v: string) { audio.src = v; },
      get autoplay() { return audio.autoplay; },
      set autoplay(v: boolean) { audio.autoplay = v; },
      get loop() { return audio.loop; },
      set loop(v: boolean) { audio.loop = v; },
      get volume() { return audio.volume; },
      set volume(v: number) { audio.volume = v; },
      get currentTime() { return audio.currentTime; },
      set currentTime(v: number) { audio.currentTime = v; },
      get duration() { return audio.duration; },
      get paused() { return audio.paused; },
      play() { audio.play().catch(() => {}); },
      pause() { audio.pause(); },
      stop() { audio.pause(); audio.currentTime = 0; },
      seek(pos: number) { audio.currentTime = pos; },
      destroy() { audio.pause(); audio.src = ""; },
      onPlay(cb: () => void) { _onPlay = cb; },
      onPause(cb: () => void) { _onPause = cb; },
      onStop(cb: () => void) { _onStop = cb; },
      onEnded(cb: () => void) { _onEnded = cb; },
      onError(cb: (e: { errMsg: string }) => void) { _onError = cb; },
      onTimeUpdate(cb: () => void) { _onTimeUpdate = cb; },
      offPlay() { _onPlay = null; },
      offPause() { _onPause = null; },
      offStop() { _onStop = null; },
      offEnded() { _onEnded = null; },
      offError() { _onError = null; },
      offTimeUpdate() { _onTimeUpdate = null; },
    };
  },

  // ── Animation ──────────────────────────────────────────────────────────────
  // Returns a WeChat-compatible animation object. The generated keyframes are
  // applied via element.animate() when the page calls this.setData({ anim }).
  createAnimation(opts: { duration?: number; timingFunction?: string; delay?: number; transformOrigin?: string } = {}) {
    const duration = opts.duration ?? 400;
    const easing = opts.timingFunction ?? "linear";
    const delay = opts.delay ?? 0;
    const steps: Array<Record<string, string | number>> = [];
    let current: Record<string, string | number> = {};

    const api = {
      // Transform helpers
      rotate: (deg: number) => { current.transform = `${current.transform ?? ""} rotate(${deg}deg)`.trim(); return api; },
      rotateX: (deg: number) => { current.transform = `${current.transform ?? ""} rotateX(${deg}deg)`.trim(); return api; },
      rotateY: (deg: number) => { current.transform = `${current.transform ?? ""} rotateY(${deg}deg)`.trim(); return api; },
      scale: (x: number, y?: number) => { current.transform = `${current.transform ?? ""} scale(${x},${y ?? x})`.trim(); return api; },
      scaleX: (x: number) => { current.transform = `${current.transform ?? ""} scaleX(${x})`.trim(); return api; },
      scaleY: (y: number) => { current.transform = `${current.transform ?? ""} scaleY(${y})`.trim(); return api; },
      translate: (x: number, y: number) => { current.transform = `${current.transform ?? ""} translate(${x}px,${y}px)`.trim(); return api; },
      translateX: (x: number) => { current.transform = `${current.transform ?? ""} translateX(${x}px)`.trim(); return api; },
      translateY: (y: number) => { current.transform = `${current.transform ?? ""} translateY(${y}px)`.trim(); return api; },
      // Style helpers
      opacity: (v: number) => { current.opacity = v; return api; },
      backgroundColor: (v: string) => { current.backgroundColor = v; return api; },
      width: (v: number) => { current.width = `${v}px`; return api; },
      height: (v: number) => { current.height = `${v}px`; return api; },
      top: (v: number) => { current.top = `${v}px`; return api; },
      left: (v: number) => { current.left = `${v}px`; return api; },
      // Commit a step
      step(stepOpts?: { duration?: number; timingFunction?: string }) {
        steps.push({ ...current, __duration__: stepOpts?.duration ?? duration, __easing__: stepOpts?.timingFunction ?? easing });
        current = {};
        return api;
      },
      // Export — returns a plain object that the page stores in data and passes
      // to the component via the `animation` prop. The runtime component reads
      // this and calls element.animate() if available.
      export() {
        return {
          actions: steps.map((s) => ({
            animates: Object.entries(s)
              .filter(([k]) => !k.startsWith("__"))
              .map(([type, value]) => ({ type, value })),
            option: { transformOrigin: opts.transformOrigin ?? "50% 50% 0", transition: { duration: s.__duration__, timingFunction: s.__easing__, delay } },
          })),
        };
      },
    };
    return api;
  },

  // ── Intersection observer ──────────────────────────────────────────────────
  createIntersectionObserver(_component: unknown, opts: { thresholds?: number[]; initialRatio?: number } = {}) {
    const thresholds = opts.thresholds ?? [0];
    let _observer: IntersectionObserver | null = null;
    return {
      relativeTo(_selector: string, _margins?: unknown) { return this; },
      relativeToViewport(_margins?: unknown) { return this; },
      observe(selector: string, cb: (res: { intersectionRatio: number; intersectionRect: DOMRect; boundingClientRect: DOMRect; relativeRect: DOMRect; time: number }) => void) {
        const el = document.querySelector(selector);
        if (!el) return;
        _observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            cb({ intersectionRatio: entry.intersectionRatio, intersectionRect: entry.intersectionRect as DOMRect, boundingClientRect: entry.boundingClientRect as DOMRect, relativeRect: entry.rootBounds as DOMRect ?? entry.boundingClientRect as DOMRect, time: entry.time });
          }
        }, { threshold: thresholds });
        _observer.observe(el);
      },
      disconnect() { _observer?.disconnect(); _observer = null; },
    };
  },

  // ── Canvas 2D context ──────────────────────────────────────────────────────
  createCanvasContext(canvasId: string) {
    // Returns a WeChat-compatible canvas context backed by the real DOM canvas.
    // Deferred to next tick so the canvas element has mounted.
    let _canvas: HTMLCanvasElement | null = null;
    let _ctx: CanvasRenderingContext2D | null = null;
    const getCtx = () => {
      if (_ctx) return _ctx;
      _canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
      _ctx = _canvas?.getContext("2d") ?? null;
      return _ctx;
    };
    const proxy = new Proxy({} as CanvasRenderingContext2D, {
      get(_t, prop) {
        const ctx = getCtx();
        if (!ctx) return () => {};
        const val = (ctx as unknown as Record<string, unknown>)[prop as string];
        return typeof val === "function" ? (val as Function).bind(ctx) : val;
      },
      set(_t, prop, value) {
        const ctx = getCtx();
        if (ctx) (ctx as unknown as Record<string, unknown>)[prop as string] = value;
        return true;
      },
    });
    (proxy as unknown as { draw: (reserve?: boolean, cb?: () => void) => void }).draw = (_reserve?: boolean, cb?: () => void) => { cb?.(); };
    return proxy;
  },
};

(window as unknown as { wx: typeof wx }).wx = wx;
(window as unknown as { getCurrentPages: () => unknown[] }).getCurrentPages = () => [];
(window as unknown as { getApp: () => unknown }).getApp = () => (window as unknown as WxNav).__wxApp__ ?? {};
