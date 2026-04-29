/**
 * wx.* API polyfill for WeChat Mini Program browser preview.
 */
(function () {
  "use strict";

  var _toastTimer = null;

  function _showToastOverlay(opts) {
    var title = opts.title || "";
    var icon = opts.icon || "success";
    var duration = opts.duration != null ? opts.duration : 1500;
    _hideToastOverlay();
    var el = document.createElement("div");
    el.id = "__wx_toast__";
    el.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.75);color:#fff;border-radius:12px;padding:20px 28px;display:flex;flex-direction:column;align-items:center;gap:8px;z-index:99999;font-size:14px;text-align:center;min-width:120px;pointer-events:none;";
    if (!document.getElementById("__wx_spin_style__")) {
      var s = document.createElement("style");
      s.id = "__wx_spin_style__";
      s.textContent = "@keyframes __wx_spin__ { to { transform: rotate(360deg); } }";
      document.head.appendChild(s);
    }
    var svg = "";
    if (icon === "success") {
      svg = '<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="15" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/><polyline points="9,16 14,21 23,11" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    } else if (icon === "error") {
      svg = '<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="15" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/><line x1="11" y1="11" x2="21" y2="21" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><line x1="21" y1="11" x2="11" y2="21" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>';
    } else if (icon === "loading") {
      svg = '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" style="animation:__wx_spin__ 0.8s linear infinite"><circle cx="16" cy="16" r="12" stroke="rgba(255,255,255,0.25)" stroke-width="3"/><path d="M16 4a12 12 0 0 1 12 12" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';
    }
    el.innerHTML = svg + "<span>" + title + "</span>";
    document.body.appendChild(el);
    if (duration > 0) { _toastTimer = setTimeout(_hideToastOverlay, duration); }
  }

  function _hideToastOverlay() {
    clearTimeout(_toastTimer);
    var el = document.getElementById("__wx_toast__");
    if (el) el.remove();
  }

  function _showLoadingOverlay(title) {
    _hideLoadingOverlay();
    var el = document.createElement("div");
    el.id = "__wx_loading__";
    el.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.75);color:#fff;border-radius:12px;padding:20px 28px;display:flex;flex-direction:column;align-items:center;gap:8px;z-index:99999;font-size:14px;text-align:center;min-width:120px;";
    el.innerHTML = '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" style="animation:__wx_spin__ 0.8s linear infinite"><circle cx="16" cy="16" r="12" stroke="rgba(255,255,255,0.25)" stroke-width="3"/><path d="M16 4a12 12 0 0 1 12 12" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg><span>' + (title || "Loading...") + "</span>";
    document.body.appendChild(el);
  }

  function _hideLoadingOverlay() {
    var el = document.getElementById("__wx_loading__");
    if (el) el.remove();
  }

  function _showModalOverlay(opts) {
    var backdrop = document.createElement("div");
    backdrop.id = "__wx_modal__";
    backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:center;justify-content:center;padding:24px;";
    var box = document.createElement("div");
    box.style.cssText = "background:#fff;border-radius:12px;width:100%;max-width:280px;overflow:hidden;";
    var showCancel = opts.showCancel !== false;
    box.innerHTML = '<div style="padding:24px 20px 16px;text-align:center;">' +
      (opts.title ? '<div style="font-size:17px;font-weight:600;color:#333;margin-bottom:8px;">' + opts.title + '</div>' : '') +
      (opts.content ? '<div style="font-size:14px;color:#666;line-height:1.5;">' + opts.content + '</div>' : '') +
      '</div><div style="display:flex;border-top:1px solid #e5e5e5;">' +
      (showCancel ? '<button id="__wx_modal_cancel__" style="flex:1;padding:13px;background:none;border:none;border-right:1px solid #e5e5e5;font-size:16px;color:#888;cursor:pointer;">' + (opts.cancelText || "Cancel") + '</button>' : '') +
      '<button id="__wx_modal_confirm__" style="flex:1;padding:13px;background:none;border:none;font-size:16px;color:#07c160;font-weight:600;cursor:pointer;">' + (opts.confirmText || "OK") + '</button></div>';
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    function close(confirmed) {
      backdrop.remove();
      opts.success && opts.success({ confirm: confirmed, cancel: !confirmed });
      opts.complete && opts.complete({ confirm: confirmed, cancel: !confirmed });
    }
    box.querySelector("#__wx_modal_confirm__").onclick = function() { close(true); };
    var cancelBtn = box.querySelector("#__wx_modal_cancel__");
    if (cancelBtn) cancelBtn.onclick = function() { close(false); };
  }

  function _showActionSheetOverlay(opts) {
    var items = opts.itemList || [];
    var backdrop = document.createElement("div");
    backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:flex-end;";
    var sheet = document.createElement("div");
    sheet.style.cssText = "background:#f5f5f5;width:100%;border-radius:16px 16px 0 0;";
    var itemsHtml = items.map(function(item, i) {
      return '<button data-idx="' + i + '" style="display:block;width:100%;padding:14px;background:#fff;border:none;border-bottom:1px solid #e5e5e5;font-size:16px;color:' + (opts.itemColor || '#000') + ';cursor:pointer;text-align:center;">' + item + '</button>';
    }).join("");
    sheet.innerHTML = '<div style="border-radius:16px 16px 0 0;margin-bottom:8px;">' + itemsHtml + '</div><button id="__wx_sheet_cancel__" style="display:block;width:100%;padding:14px;background:#fff;border:none;font-size:16px;color:#888;cursor:pointer;text-align:center;border-radius:8px;margin-bottom:8px;">Cancel</button>';
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
    sheet.querySelectorAll("[data-idx]").forEach(function(btn) {
      btn.onclick = function() { backdrop.remove(); opts.success && opts.success({ tapIndex: parseInt(btn.getAttribute("data-idx"), 10) }); };
    });
    sheet.querySelector("#__wx_sheet_cancel__").onclick = function() { backdrop.remove(); opts.fail && opts.fail({ errMsg: "showActionSheet:fail cancel" }); };
    backdrop.onclick = function(e) { if (e.target === backdrop) { backdrop.remove(); opts.fail && opts.fail({ errMsg: "showActionSheet:fail cancel" }); } };
  }

  function _getSystemInfoSync() {
    var ua = navigator.userAgent;
    var isIOS = /iPhone|iPad|iPod/.test(ua);
    return { brand: isIOS ? "Apple" : "Android", model: isIOS ? "iPhone" : "Android Device", pixelRatio: window.devicePixelRatio || 1, screenWidth: window.screen.width, screenHeight: window.screen.height, windowWidth: window.innerWidth, windowHeight: window.innerHeight, statusBarHeight: 20, language: navigator.language || "zh_CN", version: "8.0.0", system: isIOS ? "iOS 16.0" : "Android 12", platform: isIOS ? "ios" : "android", SDKVersion: "3.0.0", fontSizeSetting: 16, albumAuthorized: true, cameraAuthorized: true, locationAuthorized: true, microphoneAuthorized: true, notificationAuthorized: true, wifiEnabled: true, locationEnabled: true, bluetoothEnabled: false, safeArea: { left: 0, right: window.innerWidth, top: 20, bottom: window.innerHeight - 34, width: window.innerWidth, height: window.innerHeight - 54 }, errMsg: "getSystemInfo:ok" };
  }

  var wx = {
    navigateTo: function(opts) { opts = opts || {}; try { window.__wxNavigate && window.__wxNavigate(opts.url); opts.success && opts.success({ errMsg: "navigateTo:ok" }); } catch(e) { opts.fail && opts.fail({ errMsg: "navigateTo:fail " + e.message }); } },
    redirectTo: function(opts) { opts = opts || {}; try { window.__wxNavigate && window.__wxNavigate("__redirect__:" + opts.url); opts.success && opts.success({ errMsg: "redirectTo:ok" }); } catch(e) { opts.fail && opts.fail({ errMsg: "redirectTo:fail " + e.message }); } },
    navigateBack: function(opts) { opts = opts || {}; try { window.__wxNavigateBack && window.__wxNavigateBack(opts.delta || 1); opts.success && opts.success({ errMsg: "navigateBack:ok" }); } catch(e) { opts.fail && opts.fail({ errMsg: "navigateBack:fail " + e.message }); } },
    switchTab: function(opts) { opts = opts || {}; try { window.__wxNavigate && window.__wxNavigate("__tab__:" + opts.url); opts.success && opts.success({ errMsg: "switchTab:ok" }); } catch(e) { opts.fail && opts.fail({ errMsg: "switchTab:fail " + e.message }); } },
    reLaunch: function(opts) { opts = opts || {}; try { window.__wxNavigate && window.__wxNavigate("__relaunch__:" + opts.url); opts.success && opts.success({ errMsg: "reLaunch:ok" }); } catch(e) { opts.fail && opts.fail({ errMsg: "reLaunch:fail " + e.message }); } },

    showToast: function(opts) { opts = opts || {}; _showToastOverlay(opts); opts.success && opts.success({ errMsg: "showToast:ok" }); },
    hideToast: function(opts) { opts = opts || {}; _hideToastOverlay(); opts.success && opts.success({ errMsg: "hideToast:ok" }); },
    showLoading: function(opts) { opts = opts || {}; _showLoadingOverlay(opts.title); opts.success && opts.success({ errMsg: "showLoading:ok" }); },
    hideLoading: function(opts) { opts = opts || {}; _hideLoadingOverlay(); opts.success && opts.success({ errMsg: "hideLoading:ok" }); },
    showModal: _showModalOverlay,
    showActionSheet: _showActionSheetOverlay,
    showNavigationBarLoading: function() {},
    hideNavigationBarLoading: function() {},
    setNavigationBarTitle: function(opts) { if (opts && opts.title) document.title = opts.title; },
    setNavigationBarColor: function() {},
    setTabBarBadge: function() {},
    removeTabBarBadge: function() {},
    showTabBarRedDot: function() {},
    hideTabBarRedDot: function() {},
    showTabBar: function() {},
    hideTabBar: function() {},

    request: function(opts) {
      opts = opts || {};
      var url = opts.url, method = (opts.method || "GET").toUpperCase(), data = opts.data, header = opts.header || {};
      var body = undefined;
      if (data && method !== "GET" && method !== "HEAD") {
        header["Content-Type"] = header["Content-Type"] || "application/json";
        body = typeof data === "object" ? JSON.stringify(data) : String(data);
      }
      var fetchUrl = (method === "GET" && data && typeof data === "object") ? url + "?" + new URLSearchParams(data).toString() : url;
      fetch(fetchUrl, { method: method, headers: header, body: body })
        .then(function(res) {
          return res.text().then(function(text) {
            var responseData; try { responseData = JSON.parse(text); } catch(e) { responseData = text; }
            var result = { data: responseData, statusCode: res.status, header: {}, errMsg: "request:ok" };
            opts.success && opts.success(result); opts.complete && opts.complete(result);
          });
        })
        .catch(function(err) {
          var result = { errMsg: "request:fail " + err.message };
          opts.fail && opts.fail(result); opts.complete && opts.complete(result);
        });
      return { abort: function() {} };
    },

    setStorage: function(opts) { opts = opts || {}; try { localStorage.setItem("wx_" + opts.key, JSON.stringify(opts.data)); opts.success && opts.success({ errMsg: "setStorage:ok" }); opts.complete && opts.complete({ errMsg: "setStorage:ok" }); } catch(e) { opts.fail && opts.fail({ errMsg: "setStorage:fail " + e.message }); } },
    setStorageSync: function(key, data) { try { localStorage.setItem("wx_" + key, JSON.stringify(data)); } catch(e) {} },
    getStorage: function(opts) { opts = opts || {}; try { var raw = localStorage.getItem("wx_" + opts.key); if (raw === null) throw new Error("data not found"); var d = JSON.parse(raw); opts.success && opts.success({ data: d, errMsg: "getStorage:ok" }); opts.complete && opts.complete({ data: d, errMsg: "getStorage:ok" }); } catch(e) { opts.fail && opts.fail({ errMsg: "getStorage:fail " + e.message }); } },
    getStorageSync: function(key) { try { return JSON.parse(localStorage.getItem("wx_" + key)); } catch(e) { return null; } },
    removeStorage: function(opts) { opts = opts || {}; localStorage.removeItem("wx_" + opts.key); opts.success && opts.success({ errMsg: "removeStorage:ok" }); },
    removeStorageSync: function(key) { localStorage.removeItem("wx_" + key); },
    clearStorage: function(opts) { opts = opts || {}; Object.keys(localStorage).filter(function(k){ return k.startsWith("wx_"); }).forEach(function(k){ localStorage.removeItem(k); }); opts.success && opts.success({ errMsg: "clearStorage:ok" }); },
    clearStorageSync: function() { Object.keys(localStorage).filter(function(k){ return k.startsWith("wx_"); }).forEach(function(k){ localStorage.removeItem(k); }); },
    getStorageInfo: function(opts) { opts = opts || {}; var keys = Object.keys(localStorage).filter(function(k){ return k.startsWith("wx_"); }).map(function(k){ return k.slice(3); }); var r = { keys: keys, currentSize: 0, limitSize: 10240, errMsg: "getStorageInfo:ok" }; opts.success && opts.success(r); opts.complete && opts.complete(r); },
    getStorageInfoSync: function() { var keys = Object.keys(localStorage).filter(function(k){ return k.startsWith("wx_"); }).map(function(k){ return k.slice(3); }); return { keys: keys, currentSize: 0, limitSize: 10240 }; },

    getSystemInfo: function(opts) { opts = opts || {}; var r = _getSystemInfoSync(); opts.success && opts.success(r); opts.complete && opts.complete(r); },
    getSystemInfoSync: _getSystemInfoSync,
    getWindowInfo: _getSystemInfoSync,
    getNetworkType: function(opts) { opts = opts || {}; var t = navigator.onLine ? "wifi" : "none"; var r = { networkType: t, errMsg: "getNetworkType:ok" }; opts.success && opts.success(r); opts.complete && opts.complete(r); },
    onNetworkStatusChange: function(cb) { window.addEventListener("online", function(){ cb({ isConnected: true, networkType: "wifi" }); }); window.addEventListener("offline", function(){ cb({ isConnected: false, networkType: "none" }); }); },
    offNetworkStatusChange: function() {},
    vibrateLong: function(opts) { opts = opts || {}; navigator.vibrate && navigator.vibrate(400); opts.success && opts.success({}); },
    vibrateShort: function(opts) { opts = opts || {}; navigator.vibrate && navigator.vibrate(15); opts.success && opts.success({}); },
    getBatteryInfo: function(opts) { opts = opts || {}; var r = { level: 100, isCharging: true, errMsg: "getBatteryInfo:ok" }; opts.success && opts.success(r); opts.complete && opts.complete(r); },

    setClipboardData: function(opts) { opts = opts || {}; if (navigator.clipboard) { navigator.clipboard.writeText(opts.data || "").then(function(){ opts.success && opts.success({ errMsg: "setClipboardData:ok" }); }).catch(function(e){ opts.fail && opts.fail({ errMsg: "setClipboardData:fail " + e }); }); } else { opts.success && opts.success({ errMsg: "setClipboardData:ok" }); } },
    getClipboardData: function(opts) { opts = opts || {}; if (navigator.clipboard) { navigator.clipboard.readText().then(function(t){ opts.success && opts.success({ data: t, errMsg: "getClipboardData:ok" }); }).catch(function(e){ opts.fail && opts.fail({ errMsg: "getClipboardData:fail " + e }); }); } else { opts.fail && opts.fail({ errMsg: "getClipboardData:fail" }); } },

    getLocation: function(opts) { opts = opts || {}; if (navigator.geolocation) { navigator.geolocation.getCurrentPosition(function(p){ var r = { latitude: p.coords.latitude, longitude: p.coords.longitude, speed: p.coords.speed || 0, accuracy: p.coords.accuracy, altitude: p.coords.altitude || 0, altitudeAccuracy: p.coords.altitudeAccuracy || 0, heading: p.coords.heading || 0, errMsg: "getLocation:ok" }; opts.success && opts.success(r); opts.complete && opts.complete(r); }, function(e){ opts.fail && opts.fail({ errMsg: "getLocation:fail " + e.message }); }); } else { opts.fail && opts.fail({ errMsg: "getLocation:fail" }); } },
    chooseLocation: function(opts) { opts = opts || {}; opts.fail && opts.fail({ errMsg: "chooseLocation:fail not supported in preview" }); },
    openLocation: function() {},
    onLocationChange: function() {},
    offLocationChange: function() {},
    startLocationUpdate: function() {},
    stopLocationUpdate: function() {},

    chooseImage: function(opts) { opts = opts || {}; var input = document.createElement("input"); input.type = "file"; input.accept = "image/*"; if ((opts.count || 9) > 1) input.multiple = true; input.onchange = function(){ var files = Array.from(input.files || []); var paths = files.map(function(f){ return URL.createObjectURL(f); }); var r = { tempFilePaths: paths, tempFiles: files.map(function(f, i){ return { path: paths[i], size: f.size }; }), errMsg: "chooseImage:ok" }; opts.success && opts.success(r); opts.complete && opts.complete(r); }; input.click(); },
    chooseVideo: function(opts) { opts = opts || {}; var input = document.createElement("input"); input.type = "file"; input.accept = "video/*"; input.onchange = function(){ var f = input.files[0]; if (f) { opts.success && opts.success({ tempFilePath: URL.createObjectURL(f), size: f.size, errMsg: "chooseVideo:ok" }); } }; input.click(); },
    chooseMedia: function(opts) { opts = opts || {}; var input = document.createElement("input"); input.type = "file"; input.accept = "image/*,video/*"; input.multiple = true; input.onchange = function(){ var files = Array.from(input.files || []); opts.success && opts.success({ tempFiles: files.map(function(f){ return { fileType: f.type.startsWith("image") ? "image" : "video", tempFilePath: URL.createObjectURL(f), size: f.size }; }), errMsg: "chooseMedia:ok" }); }; input.click(); },
    previewImage: function(opts) { opts = opts || {}; var lb = document.createElement("div"); lb.style.cssText = "position:fixed;inset:0;background:#000;z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;"; var img = document.createElement("img"); img.src = opts.current || (opts.urls && opts.urls[0]) || ""; img.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;"; lb.appendChild(img); lb.onclick = function(){ lb.remove(); }; document.body.appendChild(lb); opts.success && opts.success({ errMsg: "previewImage:ok" }); },
    saveImageToPhotosAlbum: function(opts) { opts = opts || {}; opts.fail && opts.fail({ errMsg: "saveImageToPhotosAlbum:fail not supported in preview" }); },

    createCanvasContext: function(id) { var c = document.getElementById(id); return c ? c.getContext("2d") : { draw: function(){} }; },
    canvasToTempFilePath: function(opts) { opts = opts || {}; var c = document.getElementById(opts.canvasId); if (c) { opts.success && opts.success({ tempFilePath: c.toDataURL(), errMsg: "canvasToTempFilePath:ok" }); } else { opts.fail && opts.fail({ errMsg: "canvasToTempFilePath:fail" }); } },

    login: function(opts) { opts = opts || {}; var r = { code: "PREVIEW_CODE_" + Date.now(), errMsg: "login:ok" }; opts.success && opts.success(r); opts.complete && opts.complete(r); },
    checkSession: function(opts) { opts = opts || {}; opts.success && opts.success({ errMsg: "checkSession:ok" }); opts.complete && opts.complete({ errMsg: "checkSession:ok" }); },
    getUserInfo: function(opts) { opts = opts || {}; var r = { userInfo: { nickName: "Preview User", avatarUrl: "", gender: 0, country: "", province: "", city: "", language: "zh_CN" }, errMsg: "getUserInfo:ok" }; opts.success && opts.success(r); opts.complete && opts.complete(r); },
    getUserProfile: function(opts) { wx.getUserInfo(opts); },
    authorize: function(opts) { opts = opts || {}; opts.success && opts.success({ errMsg: "authorize:ok" }); opts.complete && opts.complete({ errMsg: "authorize:ok" }); },
    openSetting: function(opts) { opts = opts || {}; opts.success && opts.success({ authSetting: {}, errMsg: "openSetting:ok" }); opts.complete && opts.complete({ authSetting: {}, errMsg: "openSetting:ok" }); },
    getSetting: function(opts) { opts = opts || {}; opts.success && opts.success({ authSetting: {}, errMsg: "getSetting:ok" }); opts.complete && opts.complete({ authSetting: {}, errMsg: "getSetting:ok" }); },

    requestPayment: function(opts) { opts = opts || {}; _showModalOverlay({ title: "Payment", content: "Payment is not available in the preview environment.", showCancel: false, confirmText: "OK" }); opts.fail && opts.fail({ errMsg: "requestPayment:fail not supported in preview" }); },

    showShareMenu: function() {},
    hideShareMenu: function() {},
    updateShareMenu: function() {},
    getShareInfo: function(opts) { opts = opts || {}; opts.success && opts.success({ errMsg: "getShareInfo:ok", encryptedData: "", iv: "", cloudID: "" }); },

    nextTick: function(cb) { setTimeout(cb, 0); },
    reportMonitor: function() {},
    reportAnalytics: function() {},
    reportEvent: function() {},
    canIUse: function() { return true; },
    env: { USER_DATA_PATH: "wxfile://usr" },

    base64ToArrayBuffer: function(str) { var binary = atob(str); var bytes = new Uint8Array(binary.length); for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes.buffer; },
    arrayBufferToBase64: function(buf) { var bytes = new Uint8Array(buf); var binary = ""; for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]); return btoa(binary); },

    createSelectorQuery: function() {
      var query = {
        _queries: [],
        _q: function(sel, all, vp) {
          var ctx = query;
          var m = {
            boundingClientRect: function(cb) { ctx._queries.push({ sel: sel, all: all, vp: vp, type: "rect", cb: cb }); return m; },
            scrollOffset: function(cb) { ctx._queries.push({ sel: sel, all: all, vp: vp, type: "scroll", cb: cb }); return m; },
            fields: function(opts, cb) { ctx._queries.push({ sel: sel, all: all, vp: vp, type: "fields", opts: opts, cb: cb }); return m; },
            exec: function(cb) { return query.exec(cb); }
          };
          return m;
        },
        select: function(s) { return this._q(s, false, false); },
        selectAll: function(s) { return this._q(s, true, false); },
        selectViewport: function() { return this._q(null, false, true); },
        exec: function(cb) {
          var results = this._queries.map(function(q) {
            var el = q.vp ? document.documentElement : q.all ? Array.from(document.querySelectorAll(q.sel || "")) : document.querySelector(q.sel || "");
            var result;
            if (q.type === "rect") {
              result = q.vp ? { width: window.innerWidth, height: window.innerHeight } : q.all ? el.map(function(e) { return e.getBoundingClientRect(); }) : (el ? el.getBoundingClientRect() : null);
            } else if (q.type === "scroll") {
              result = q.vp ? { scrollLeft: window.scrollX, scrollTop: window.scrollY, scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight, width: window.innerWidth, height: window.innerHeight } : (el ? { scrollLeft: el.scrollLeft, scrollTop: el.scrollTop } : null);
            } else if (q.type === "fields") {
              var opts = q.opts || {};
              var node = q.all ? Array.from(document.querySelectorAll(q.sel || "")) : document.querySelector(q.sel || "");
              if (Array.isArray(node)) {
                result = node.map(function(e) { return { node: opts.node ? e : undefined, width: opts.size ? e.offsetWidth : undefined, height: opts.size ? e.offsetHeight : undefined, dataset: opts.dataset ? Object.assign({}, e.dataset) : undefined }; });
              } else {
                result = node ? { node: opts.node ? node : undefined, width: opts.size ? node.offsetWidth : undefined, height: opts.size ? node.offsetHeight : undefined, dataset: opts.dataset ? Object.assign({}, node.dataset) : undefined } : null;
              }
            }
            q.cb && q.cb(result);
            return result;
          });
          cb && cb(results);
        }
      };
      return query;
    },

    getFileSystemManager: function() { return { readFile: function(opts){ opts.fail && opts.fail({ errMsg: "readFile:fail not supported" }); }, writeFile: function(opts){ opts.fail && opts.fail({ errMsg: "writeFile:fail not supported" }); }, readdir: function(opts){ opts.fail && opts.fail({ errMsg: "readdir:fail not supported" }); }, mkdir: function(opts){ opts.success && opts.success({}); }, stat: function(opts){ opts.fail && opts.fail({ errMsg: "stat:fail not supported" }); }, saveFile: function(opts){ opts.success && opts.success({ savedFilePath: opts.tempFilePath }); }, getSavedFileList: function(opts){ opts.success && opts.success({ fileList: [] }); } }; }
  };

  window.wx = wx;
  window.getCurrentPages = function() { return []; };
  window.getApp = function() { return window.__wxApp__ || {}; };
  console.log("[wx-polyfill] loaded.");
})();
