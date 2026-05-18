/**
 * React Native Web Compiler
 *
 * Transforms React Native source files to a browser-runnable HTML bundle using:
 *  - Babel (JSX + TypeScript transform, react-native → react-native-web rewrite)
 *  - esbuild (vendor bundle: React + ReactDOM + react-native-web, built once at startup)
 *
 * The output is a self-contained index.html served from the artifact cache,
 * identical in structure to the Kotlin/Swift WASM artifact pattern.
 */

import { writeFile, mkdir, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createHash, randomBytes } from "crypto";
import { existsSync } from "fs";
import { build as esbuild } from "esbuild";
import { transformSync } from "@babel/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VENDOR_PATH = join(process.cwd(), "backend", "api", "assets", "rn-vendor.js");
const BUILD_CACHE_MAX_AGE = 30 * 60 * 1000; // 30 min
const MAX_CACHE_ENTRIES = 50;
const MAX_CONCURRENT_COMPILES = 4;
const MAX_FILES_PER_REQUEST = 30;
const MAX_TOTAL_SOURCE_BYTES = 500_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RnCompilationResult {
  success: boolean;
  buildId: string;
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Cache + concurrency
// ---------------------------------------------------------------------------

const artifactCache = new Map<string, { buildId: string; dir: string; createdAt: number }>();
let activeCompiles = 0;
const inflightCompiles = new Map<string, Promise<RnCompilationResult>>();

setInterval(() => {
  const now = Date.now();
  for (const [hash, entry] of Array.from(artifactCache.entries())) {
    if (now - entry.createdAt > BUILD_CACHE_MAX_AGE) {
      rm(entry.dir, { recursive: true, force: true }).catch(() => {});
      artifactCache.delete(hash);
    }
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Vendor bundle (built once at startup)
// ---------------------------------------------------------------------------

let vendorBuildPromise: Promise<void> | null = null;
let vendorBuildFailed = false;

export async function ensureVendorBundle(): Promise<void> {
  if (existsSync(VENDOR_PATH)) return;
  if (vendorBuildPromise) return vendorBuildPromise;

  vendorBuildPromise = (async () => {
    await mkdir(join(process.cwd(), "backend", "api", "assets"), { recursive: true });
    console.log("[rn-web] Building vendor bundle (React + ReactDOM + react-native-web)...");
    try {
      await esbuild({
        entryPoints: [join(process.cwd(), "backend", "api", "src", "compiler", "rn-web", "rn-vendor-entry.js")],
        bundle: true,
        format: "iife",
        globalName: "__RNW__",
        outfile: VENDOR_PATH,
        minify: true,
        define: {
          "process.env.NODE_ENV": '"production"',
          "__DEV__": "false",
        },
        // Redirect react-native imports to react-native-web for all bundled packages.
        // Stub files exist at node_modules/react-native-web/Libraries/* for deep paths
        // that gesture-handler and safe-area-context import but don't exist in rnw.
        alias: {
          "react-native": "react-native-web",
          "react-native-worklets": "react-native-web",
          // Stub out codegenNativeComponent — imported by react-native-safe-area-context
          // at init time. Without this it crashes in the browser IIFE with a dynamic require error.
          "react-native/Libraries/Utilities/codegenNativeComponent": join(process.cwd(), "backend", "api", "stubs", "codegenNativeComponent.js"),
        },
        // Mark packages that call native codegen at init time as external.
        // react-native-screens, react-native-gesture-handler, and react-native-reanimated
        // all call codegenNativeComponent / TurboModuleRegistry at module load time,
        // which throws in a browser context. They are each fully stubbed in
        // the HTML shell require() shim instead.
        // react-native-safe-area-context is bundled (not external) with its
        // codegenNativeComponent call stubbed out above.
        external: [
          "react-native-web/Libraries/*",
          "react-native-screens",
          "react-native-gesture-handler",
          "react-native-reanimated",
        ],
        loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl" },
        logLevel: "error",
      });
      vendorBuildFailed = false;
      console.log("[rn-web] Vendor bundle ready:", VENDOR_PATH);
    } catch (err: any) {
      console.error("[rn-web] Failed to build vendor bundle:", err?.message);
      vendorBuildFailed = true;
      vendorBuildPromise = null;
      throw err;
    }
  })();

  return vendorBuildPromise;
}

// ---------------------------------------------------------------------------
// Source hashing
// ---------------------------------------------------------------------------

function hashSources(files: Array<{ path: string; content: string }>): string {
  const h = createHash("sha256");
  for (const f of files.sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path);
    h.update(f.content);
  }
  return h.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Babel transform
// ---------------------------------------------------------------------------

const BABEL_PRESETS = [
  ["@babel/preset-typescript", { allExtensions: true, isTSX: true }],
  ["@babel/preset-react", { runtime: "classic" }],
];

const BABEL_PLUGINS = [
  [
    "module-resolver",
    {
      alias: {
        "react-native": "react-native-web",
        "@react-native-async-storage/async-storage": "react-native-web/dist/exports/AsyncStorage",
      },
    },
  ],
  // Transform ES module imports/exports to CommonJS require() so the inline registry works
  "@babel/plugin-transform-modules-commonjs",
];

function transformFile(source: string, filename: string): { code: string; error?: string } {
  try {
    const result = transformSync(source, {
      filename,
      presets: BABEL_PRESETS as any,
      plugins: BABEL_PLUGINS as any,
      sourceMaps: false,
      compact: false,
    });
    return { code: result?.code || "" };
  } catch (err: any) {
    return { code: "", error: err?.message || "Babel transform failed" };
  }
}

// ---------------------------------------------------------------------------
// HTML shell builder
// ---------------------------------------------------------------------------

function buildHtmlShell(
  transformedModules: Array<{ name: string; code: string }>,
  appEntryName: string,
  projectName: string,
  vendorCode: string
): string {
  // Build a simple module registry so files can require() each other.
  // IMPORTANT: escape </script> sequences inside the JS so browsers don't
  // prematurely close the <script> tag (causes garbled JS / SyntaxError).
  const escapeScript = (s: string) => s.replace(/<\/script/gi, "<\\/script");

  const moduleCode = transformedModules
    .map(
      (m) => `
__modules[${JSON.stringify(m.name)}] = (function(module, exports, require) {
${escapeScript(m.code)}
});`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>${projectName}</title>
  <style>
    * { box-sizing: border-box; }
    html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
  // react-native-web's style-setting code iterates style objects and does
  // element.style[key] = value. If 'key' is a number (e.g. from StyleSheet.create
  // returning numeric IDs, or from an array of styles), Chrome throws:
  // "Failed to set an indexed property [0] on 'CSSStyleDeclaration'".
  // Wrap the style property on every HTMLElement so numeric-index writes are
  // silently dropped before they reach the native CSSStyleDeclaration setter.
  (function() {
    var _origStyleDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style');
    if (!_origStyleDesc) return;
    var _styleCache = new WeakMap();
    Object.defineProperty(HTMLElement.prototype, 'style', {
      get: function() {
        var real = _origStyleDesc.get.call(this);
        var cached = _styleCache.get(real);
        if (cached) return cached;
        var proxy = new Proxy(real, {
          set: function(target, prop, value) {
            if (typeof prop === 'string' && /^\\d+$/.test(prop)) return true;
            target[prop] = value;
            return true;
          }
        });
        _styleCache.set(real, proxy);
        return proxy;
      },
      set: _origStyleDesc.set,
      configurable: true,
    });
  })();
  </script>
  <script>/* react-native-web vendor bundle */
${vendorCode}
</script>
  <script>
(function() {
  // Expose globals from vendor bundle
  var React = __RNW__.React;
  var ReactDOM = __RNW__.ReactDOM;
  var RNW = __RNW__.ReactNativeWeb;

  // Wrap React.createElement to catch null/undefined component types BEFORE React
  // throws the cryptic minified error #130. This gives us a useful error message.
  var _origCreateElement = React.createElement.bind(React);
  React.createElement = function(type, props) {
    if (type === null || type === undefined) {
      // Capture stack to identify which module is using the null component
      var stack = '';
      try { stack = new Error().stack || ''; } catch(_) {}
      // Extract user module lines from the stack (skip framework internals)
      var stackLines = stack.split('\\n').filter(function(l) {
        return l.indexOf('__modules') !== -1 || l.indexOf('executeModule') !== -1 || l.indexOf('makeRequire') !== -1;
      }).slice(0, 5).join('\\n');
      // If no user module frames, include raw stack (first 8 lines) for debugging
      if (!stackLines) {
        stackLines = stack.split('\\n').slice(1, 9).join('\\n');
      }
      var hint = 'A component used in JSX is null or undefined.\\n' +
        'Common causes:\\n' +
        '  - A named export is missing (e.g. import { Foo } but file exports default Foo)\\n' +
        '  - A file has no default export\\n' +
        '  - A circular import returned undefined\\n' +
        '  - A package is not stubbed (check browser DevTools for [rn-web] warnings)';
      var msg = 'React.createElement received ' + type + ' as component type.\\n\\n' + hint;
      if (stackLines) msg += '\\n\\nCall stack (user modules):\\n' + stackLines;
      showError(msg);
      return _origCreateElement('div', props);
    }
    return _origCreateElement.apply(React, arguments);
  };

  // Override console.error to forward React render errors to the IDE console panel
  var _origConsoleError = console.error.bind(console);
  console.error = function() {
    var args = Array.prototype.slice.call(arguments);
    var msg = args.map(function(a) {
      return (a && a.message) ? a.message : (typeof a === 'object' ? JSON.stringify(a) : String(a));
    }).join(' ');
    _origConsoleError.apply(console, args);
    // Filter known non-fatal browser quirks from react-native-web internals
    if (msg.indexOf('CSSStyleDeclaration') !== -1 ||
        msg.indexOf('Indexed property setter') !== -1 ||
        msg.indexOf('indexed property') !== -1) {
      return; // RNW style injection noise — non-fatal, don't surface in error panel
    }
    try { window.parent.postMessage({ type: '__cascade_console__', level: 'error', message: msg }, '*'); } catch(_) {}
    // Surface React minified errors (e.g. #130 "Element type invalid") in the IDE error panel
    if (msg.indexOf('Minified React error') !== -1) {
      showError('React render error: ' + msg + '\\n\\nHint: A component is null/undefined. Check all our imports and make sure every component used in JSX is properly defined and exported.');
    }
  };
  var _origConsoleWarn = console.warn.bind(console);
  console.warn = function() {
    var msg = Array.prototype.slice.call(arguments).join(' ');
    _origConsoleWarn.apply(console, arguments);
    try { window.parent.postMessage({ type: '__cascade_console__', level: 'warn', message: msg }, '*'); } catch(_) {}
  };
  var _origConsoleLog = console.log.bind(console);
  console.log = function() {
    var msg = Array.prototype.slice.call(arguments).map(function(a) {
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ');
    _origConsoleLog.apply(console, arguments);
    try { window.parent.postMessage({ type: '__cascade_console__', level: 'log', message: msg }, '*'); } catch(_) {}
  };

  // CommonJS-style module registry with caller-context-aware path resolution
  var __modules = {};
  var __cache = {};
  // Persistent storage lifted to outer scope so stubs survive multiple require() calls
  var _asyncStore = {};
  var _secureStore = {};

  // Resolve a relative path (from, to) → absolute module key (no leading slash)
  function resolvePath(fromDir, toPath) {
    if (!toPath.startsWith('./') && !toPath.startsWith('../')) return toPath;
    var parts = fromDir ? fromDir.split('/').filter(function(s) { return s !== ''; }) : [];
    var segs = toPath.split('/');
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (seg === '' || seg === '.') { continue; }
      else if (seg === '..') { if (parts.length > 0) parts.pop(); }
      else { parts.push(seg); }
    }
    return parts.join('/');
  }

  // Try base key with various extensions and /index.* variants; returns matched key or null
  function loadModule(base) {
    if (__modules[base]) return base;
    if (__modules[base + '.js']) return base + '.js';
    if (__modules[base + '.jsx']) return base + '.jsx';
    if (__modules[base + '.ts']) return base + '.ts';
    if (__modules[base + '.tsx']) return base + '.tsx';
    if (__modules[base + '/index.js']) return base + '/index.js';
    if (__modules[base + '/index.jsx']) return base + '/index.jsx';
    if (__modules[base + '/index.ts']) return base + '/index.ts';
    if (__modules[base + '/index.tsx']) return base + '/index.tsx';
    return null;
  }

  // Execute a registered module, creating a contextual require bound to its directory
  function executeModule(key) {
    if (__cache[key]) return __cache[key].exports;
    var mod = { exports: {} };
    __cache[key] = mod;
    var dir = key.indexOf('/') >= 0 ? key.split('/').slice(0, -1).join('/') : '';
    __modules[key](mod, mod.exports, makeRequire(dir));
    return mod.exports;
  }

  // Build a require() function that knows it's being called from callerDir
  function makeRequire(callerDir) {
    return function require(name) {
      // ── Core react-native → react-native-web ──
      if (name === 'react-native' || name === 'react-native-web') return RNW;
      // react-native-web subpath imports (e.g. generated by older RNW versions or direct imports)
      if (name.startsWith('react-native-web/')) {
        var subpath = name.slice('react-native-web/'.length).replace(/^dist[/\\\\]exports[/\\\\]/, '').replace(/^dist[/\\\\]cjs[/\\\\]exports[/\\\\]/, '');
        // Map known subpath to the RNW namespace export
        if (RNW[subpath]) return { default: RNW[subpath], [subpath]: RNW[subpath] };
        // AsyncStorage was removed from RNW 0.14+; return a no-op
        if (subpath === 'AsyncStorage') return { default: {
          getItem: function(k) { return Promise.resolve(_asyncStore[k] || null); },
          setItem: function(k, v) { _asyncStore[k] = v; return Promise.resolve(); },
          removeItem: function(k) { delete _asyncStore[k]; return Promise.resolve(); },
          multiGet: function(keys) { return Promise.resolve(keys.map(function(k) { return [k, _asyncStore[k] || null]; })); },
          multiSet: function(pairs) { pairs.forEach(function(p) { _asyncStore[p[0]] = p[1]; }); return Promise.resolve(); },
        }};
        return RNW; // fallback: return full RNW namespace
      }
      if (name === 'react') return React;
      if (name === 'react-dom') return ReactDOM;
      if (name === 'react-dom/client') return ReactDOM;

      // ── Navigation ecosystem ──
      if (name === '@react-navigation/native') return __RNW__.ReactNavigation;
      if (name === '@react-navigation/stack') return __RNW__.ReactNavigationStack;
      if (name === '@react-navigation/bottom-tabs') return __RNW__.ReactNavigationBottomTabs;
      if (name === '@react-navigation/drawer') {
        var DrawerStack = __RNW__.ReactNavigationStack || {};
        return {
          createDrawerNavigator: DrawerStack.createStackNavigator || function() {
            return { Navigator: RNW.View, Screen: function(props) { return props.children || null; } };
          },
        };
      }
      // @react-navigation/native-stack → polyfilled with @react-navigation/stack if available,
      // otherwise falls back to a minimal self-contained implementation
      if (name === '@react-navigation/native-stack') {
        var _NativeStack = __RNW__.ReactNavigationStack;
        if (_NativeStack && _NativeStack.createStackNavigator) {
          return {
            createNativeStackNavigator: _NativeStack.createStackNavigator,
            default: _NativeStack,
          };
        }
        // Self-contained fallback: render only the first child Screen whose name matches
        // the initial route, or just render all screens stacked (simple, no animation)
        return {
          createNativeStackNavigator: function() {
            function Navigator(props) {
              var children = React.Children.toArray(props.children);
              var initialChild = children[0] || null;
              return React.createElement(RNW.View, { style: { flex: 1 } }, initialChild);
            }
            function Screen(props) {
              return React.createElement(RNW.View, { style: { flex: 1 } },
                typeof props.component === 'function'
                  ? React.createElement(props.component, {})
                  : (props.children || null)
              );
            }
            Navigator.displayName = 'NativeStackNavigator';
            Screen.displayName = 'NativeStackScreen';
            return { Navigator: Navigator, Screen: Screen };
          },
        };
      }

      // ── Safe area / screens / gestures / reanimated ──
      if (name === 'react-native-safe-area-context') {
        // Always use our own stub — the vendor-bundled SafeAreaProvider waits for a
        // native onInsetsChange event that never fires in browser, so children never render.
        var _zeroInsets = { top: 0, bottom: 0, left: 0, right: 0 };
        var _InsetsContext = React.createContext(_zeroInsets);
        function SafeAreaProvider(props) {
          return React.createElement(_InsetsContext.Provider, { value: props.initialMetrics?.insets || props.initialSafeAreaInsets || _zeroInsets },
            React.createElement(RNW.View, { style: [{ flex: 1 }, props.style] }, props.children)
          );
        }
        function SafeAreaView(props) {
          return React.createElement(RNW.View, { style: [{ flex: 1 }, props.style] }, props.children);
        }
        return {
          SafeAreaProvider: SafeAreaProvider,
          SafeAreaView: SafeAreaView,
          SafeAreaInsetsContext: _InsetsContext,
          useSafeAreaInsets: function() { return _zeroInsets; },
          useSafeAreaFrame: function() { return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }; },
          initialWindowMetrics: { insets: _zeroInsets, frame: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight } },
          withSafeAreaInsets: function(C) { return C; },
        };
      }
      if (name === 'react-native-screens') return RNW;
      if (name === 'react-native-gesture-handler') {
        var GestureHandler = __RNW__.GestureHandler || {};
        if (!GestureHandler.GestureHandlerRootView) {
          // Passthrough wrapper: renders children, forwards gesture events as no-ops
          function makePassthrough(displayName) {
            function C(props) {
              var ch = props.children;
              return ch ? React.createElement(RNW.View, { style: props.style }, ch) : null;
            }
            C.displayName = displayName;
            return C;
          }
          GestureHandler = Object.assign({}, GestureHandler, {
            GestureHandlerRootView: makePassthrough('GestureHandlerRootView'),
            PanGestureHandler: makePassthrough('PanGestureHandler'),
            TapGestureHandler: makePassthrough('TapGestureHandler'),
            LongPressGestureHandler: makePassthrough('LongPressGestureHandler'),
            PinchGestureHandler: makePassthrough('PinchGestureHandler'),
            RotationGestureHandler: makePassthrough('RotationGestureHandler'),
            FlingGestureHandler: makePassthrough('FlingGestureHandler'),
            NativeViewGestureHandler: makePassthrough('NativeViewGestureHandler'),
            GestureDetector: makePassthrough('GestureDetector'),
            Gesture: {
              Pan: function() { return { onUpdate: function(cb) { return this; }, onEnd: function(cb) { return this; }, onBegin: function(cb) { return this; }, onFinalize: function(cb) { return this; }, minDistance: function() { return this; }, enabled: function() { return this; }  }; },
              Tap: function() { return { onEnd: function(cb) { return this; }, maxDuration: function() { return this; }, enabled: function() { return this; } }; },
              Simultaneous: function() { return {}; },
              Race: function() { return {}; },
              Exclusive: function() { return {}; },
            },
            State: { UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5 },
            Directions: { RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 },
            createNativeWrapper: function(C) { return C; },
            ScrollView: RNW.ScrollView,
            FlatList: RNW.FlatList,
            TextInput: RNW.TextInput,
            Switch: RNW.Switch,
            DrawerLayout: makePassthrough('DrawerLayout'),
          });
        }
        return GestureHandler;
      }
      if (name === 'react-native-reanimated') {
        return {
          default: { View: RNW.View, Text: RNW.Text, ScrollView: RNW.ScrollView, Image: RNW.Image },
          useSharedValue: function(v) { return { value: v }; },
          useAnimatedStyle: function(fn) { return fn(); },
          withTiming: function(v) { return v; },
          withSpring: function(v) { return v; },
          withDelay: function(_, v) { return v; },
          withSequence: function() { return 0; },
          withRepeat: function(v) { return v; },
          runOnJS: function(fn) { return fn; },
          interpolate: function(v, input, output) { return output[0]; },
          Extrapolation: { CLAMP: 'clamp' },
        };
      }

      // ── SVG and native UI stubs ──
      if (name === 'react-native-svg') {
        var SvgNull = function() { return null; };
        var SvgView = function(props) { return React.createElement(RNW.View, { style: [{ overflow: 'hidden' }, props.style] }, props.children); };
        return {
          default: SvgView, Svg: SvgView,
          Circle: SvgNull, Rect: SvgNull, Path: SvgNull, Line: SvgNull,
          Ellipse: SvgNull, Polygon: SvgNull, Polyline: SvgNull,
          G: function(props) { return React.createElement(RNW.View, null, props.children); },
          Defs: SvgNull, ClipPath: SvgNull, LinearGradient: SvgNull,
          Stop: SvgNull, Text: SvgNull, TSpan: SvgNull,
        };
      }
      if (name === '@react-native-picker/picker') {
        var PickerItem = function() { return null; };
        var PickerComp = function(props) {
          return React.createElement('select', {
            value: props.selectedValue,
            onChange: function(e) { if (props.onValueChange) props.onValueChange(e.target.value); },
            style: { height: 40, fontSize: 16 },
          }, props.children);
        };
        PickerComp.Item = PickerItem;
        return { Picker: PickerComp, default: PickerComp };
      }

      // ── Expo packages ──
      if (name === 'expo') return {
        registerRootComponent: function(C) { return C; },
        loadAsync: function() { return Promise.resolve(); },
        default: {},
      };
      if (name === 'expo-status-bar') return __RNW__.ExpoStatusBar;
      if (name === 'expo-constants') return { default: { expoConfig: { name: 'App' } } };
      if (name === 'expo-font') return { useFonts: function() { return [true, null]; }, loadAsync: function() { return Promise.resolve(); } };
      if (name === 'expo-linking') return { createURL: function(p) { return p; } };
      if (name === 'expo-router') return __RNW__.ReactNavigation;
      if (name === 'expo-linear-gradient') {
        return {
          LinearGradient: function(props) {
            return React.createElement(RNW.View, { style: [{ flex: 1 }, props.style] }, props.children);
          },
        };
      }
      if (name === '@expo/vector-icons') {
        var IconStub = function(props) {
          return React.createElement(RNW.Text, {
            style: { fontSize: props.size || 16, color: props.color || '#000' },
          }, props.name || '');
        };
        return {
          Ionicons: IconStub, MaterialIcons: IconStub, FontAwesome: IconStub,
          Feather: IconStub, AntDesign: IconStub, Entypo: IconStub,
          MaterialCommunityIcons: IconStub, FontAwesome5: IconStub,
        };
      }
      if (name === 'expo-image') return { Image: RNW.Image };
      if (name === 'expo-blur') return { BlurView: RNW.View };
      if (name === 'expo-haptics') return {
        impactAsync: function() { return Promise.resolve(); },
        notificationAsync: function() { return Promise.resolve(); },
        selectionAsync: function() { return Promise.resolve(); },
        ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
      };
      if (name === 'expo-camera') return {
        Camera: RNW.View,
        useCameraPermissions: function() { return [{ granted: false }, function() { return Promise.resolve({ granted: false }); }]; },
        CameraType: { front: 'front', back: 'back' },
      };
      if (name === 'expo-location') return {
        requestForegroundPermissionsAsync: function() { return Promise.resolve({ status: 'denied' }); },
        getCurrentPositionAsync: function() { return Promise.resolve({ coords: { latitude: 0, longitude: 0 } }); },
        watchPositionAsync: function() { return Promise.resolve({ remove: function() {} }); },
        Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
      };
      if (name === 'expo-secure-store') return {
        getItemAsync: function(k) { return Promise.resolve(_secureStore[k] || null); },
        setItemAsync: function(k, v) { _secureStore[k] = v; return Promise.resolve(); },
        deleteItemAsync: function(k) { delete _secureStore[k]; return Promise.resolve(); },
      };
      if (name === 'expo-file-system') return {
        documentDirectory: 'file:///document/',
        cacheDirectory: 'file:///cache/',
        readAsStringAsync: function() { return Promise.resolve(''); },
        writeAsStringAsync: function() { return Promise.resolve(); },
        deleteAsync: function() { return Promise.resolve(); },
        getInfoAsync: function() { return Promise.resolve({ exists: false, isDirectory: false }); },
      };
      if (name === 'expo-notifications') return {
        requestPermissionsAsync: function() { return Promise.resolve({ status: 'denied' }); },
        scheduleNotificationAsync: function() { return Promise.resolve(''); },
        cancelAllScheduledNotificationsAsync: function() { return Promise.resolve(); },
        setNotificationHandler: function() {},
        addNotificationReceivedListener: function() { return { remove: function() {} }; },
        addNotificationResponseReceivedListener: function() { return { remove: function() {} }; },
      };

      // ── Async storage ──
      if (name === '@react-native-async-storage/async-storage') {
        return { default: {
          getItem: function(k) { return Promise.resolve(_asyncStore[k] || null); },
          setItem: function(k, v) { _asyncStore[k] = v; return Promise.resolve(); },
          removeItem: function(k) { delete _asyncStore[k]; return Promise.resolve(); },
        }};
      }

      // ── User module resolution (caller-context-aware) ──
      var resolved = (name.startsWith('./') || name.startsWith('../'))
        ? resolvePath(callerDir, name)
        : name;
      var key = loadModule(resolved);
      if (!key) {
        var isUserPath = name.startsWith('./') || name.startsWith('../') || name.startsWith('/');
        if (isUserPath) {
          console.warn('[rn-web] User module not found:', name, '(from:', callerDir || '<root>', ')');
        } else {
          // Unknown third-party package — warn and return a safe stub where every export
          // is a no-op component (function returning null). This prevents React error #130
          // ("Element type is invalid") when the user destructures a component from an
          // unknown package and uses it in JSX.
          console.warn('[rn-web] Unknown package "' + name + '" — stubbing all exports as no-op components.');
        }
        // Return a Proxy-like object: accessing any key returns a no-op component.
        // We implement this with a plain object + Proxy where available (modern browsers).
        var _stubName = name;
        function makeStubModule() {
          var handler = {
            get: function(target, prop) {
              if (prop === '__esModule' || prop === 'default') return target[prop];
              if (prop === Symbol.toPrimitive || prop === Symbol.iterator) return undefined;
              // Return a no-op React component for any named export
              if (!(prop in target)) {
                target[prop] = function StubComponent() { return null; };
                target[prop].displayName = _stubName + '.' + String(prop);
              }
              return target[prop];
            }
          };
          var base = { __esModule: true, default: function StubDefault() { return null; } };
          try { return new Proxy(base, handler); } catch(_) { return base; }
        }
        return makeStubModule();
      }
      return executeModule(key);
    };
  }

  // Top-level require used for entry-point bootstrap
  var require = makeRequire('');

  // Register all transformed modules
  ${moduleCode}

  // Show an error message in the root div and notify the parent frame.
  function showError(msg) {
    var root = document.getElementById('root');
    if (root) root.innerHTML =
      '<div style="padding:20px;color:#ff6b6b;background:#1e1e1e;font-family:monospace;white-space:pre-wrap;height:100%;box-sizing:border-box;overflow:auto">' +
      '<b>Runtime Error</b>\\n\\n' + String(msg) + '</div>';
    try { window.parent.postMessage({ type: '__rn_runtime_error__', message: String(msg) }, '*'); } catch(_) {}
  }

  // ErrorBoundary catches React render errors (React 18 concurrent mode does NOT
  // propagate these to window.onerror — they must be caught via componentDidCatch).
  var ErrorBoundary = (function() {
    function EB(props) {
      React.Component.call(this, props);
      this.state = { hasError: false };
    }
    EB.prototype = Object.create(React.Component.prototype);
    EB.prototype.constructor = EB;
    EB.getDerivedStateFromError = function() { return { hasError: true }; };
    EB.prototype.componentDidCatch = function(error) {
      showError(error && error.message ? error.message : String(error));
    };
    EB.prototype.render = function() {
      if (this.state.hasError) return null;
      return this.props.children;
    };
    return EB;
  })();

  // React 18 concurrent renders are async — errors thrown during render escape a
  // synchronous try/catch. Install a global handler to catch them and surface
  // them in the error panel so the user sees what went wrong.
  window.addEventListener('error', function(ev) {
    if (ev.message && ev.message.indexOf('Indexed property setter') !== -1) return;
    showError(ev.message || String(ev.error));
  });
  window.addEventListener('unhandledrejection', function(ev) {
    showError(ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason));
  });

  // Mount the app
  try {
    var appMod = require(${JSON.stringify(appEntryName)});
    // appMod.default may be the component (Babel adds exports.default = App at top).
    // Fall back to appMod itself for modules that use module.exports = App directly.
    var App = (appMod && appMod.__esModule) ? appMod.default : (appMod.default || appMod);
    if (typeof App !== 'function' && typeof App !== 'object') {
      // Try named exports — pick the first function
      var keys = Object.keys(appMod || {});
      for (var i = 0; i < keys.length; i++) {
        if (typeof appMod[keys[i]] === 'function') { App = appMod[keys[i]]; break; }
      }
    }
    if (typeof App !== 'function' && !(App && App.$$typeof)) {
      throw new Error('No renderable component found in ' + ${JSON.stringify(appEntryName)} + '. Make sure the file has a default export.');
    }

    var root = document.getElementById('root');
    // React 18 createRoot API — required for react-native-web 0.19+
    var rnwRoot = ReactDOM.createRoot(root);
    rnwRoot.render(React.createElement(ErrorBoundary, null, React.createElement(App)));
  } catch(e) {
    showError(e && e.message ? e.message : String(e));
    console.error('[rn-web] Mount error:', e);
  }
})();
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main compile function
// ---------------------------------------------------------------------------

export async function compileRnWeb(
  sourceFiles: Array<{ path: string; content: string }>,
  projectName?: string
): Promise<RnCompilationResult> {
  if (sourceFiles.length > MAX_FILES_PER_REQUEST) {
    return { success: false, buildId: "validation-error", errors: [`Too many files (max ${MAX_FILES_PER_REQUEST})`] };
  }
  const totalBytes = sourceFiles.reduce((s, f) => s + f.content.length, 0);
  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
    return { success: false, buildId: "validation-error", errors: [`Source too large (max ${MAX_TOTAL_SOURCE_BYTES} bytes)`] };
  }

  const sourceHash = hashSources(sourceFiles);

  const cached = artifactCache.get(sourceHash);
  if (cached) return { success: true, buildId: cached.buildId };

  const inflight = inflightCompiles.get(sourceHash);
  if (inflight) return inflight;

  if (activeCompiles >= MAX_CONCURRENT_COMPILES) {
    return { success: false, buildId: "queue-full", errors: ["Compiler busy. Please try again."] };
  }

  if (vendorBuildFailed) {
    return { success: false, buildId: "vendor-error", errors: ["Vendor bundle failed to build at server startup. Check server logs and restart."] };
  }

  if (!existsSync(VENDOR_PATH) && vendorBuildPromise) {
    try {
      await vendorBuildPromise;
    } catch {
      return { success: false, buildId: "vendor-error", errors: ["Vendor bundle is not ready yet — server is still initializing. Try again in a few seconds."] };
    }
  }

  const promise = doCompile(sourceFiles, sourceHash, projectName);
  inflightCompiles.set(sourceHash, promise);
  try {
    return await promise;
  } finally {
    inflightCompiles.delete(sourceHash);
  }
}

async function doCompile(
  sourceFiles: Array<{ path: string; content: string }>,
  sourceHash: string,
  projectName?: string
): Promise<RnCompilationResult> {
  activeCompiles++;
  const buildId = `${sourceHash}-${randomBytes(4).toString("hex")}`;
  const artifactDir = join(tmpdir(), `rn-web-artifacts-${buildId}`);

  try {
    // Ensure vendor bundle exists and read it for inlining
    await ensureVendorBundle();
    const vendorCode = await readFile(VENDOR_PATH, "utf8");

    await mkdir(artifactDir, { recursive: true });

    // Filter to JS/TS/JSX/TSX files only
    const jsFiles = sourceFiles.filter((f) => /\.(tsx?|jsx?)$/.test(f.path));

    if (jsFiles.length === 0) {
      return { success: false, buildId, errors: ["No JavaScript/TypeScript files found in project."] };
    }

    // Transform each file with Babel
    const transformed: Array<{ name: string; code: string }> = [];
    const errors: string[] = [];

    for (const file of jsFiles) {
      const name = file.path.replace(/^\/project\//, "");
      const result = transformFile(file.content, file.path);
      if (result.error) {
        errors.push(`${name}: ${result.error}`);
      } else {
        transformed.push({ name, code: result.code });
      }
    }

    if (errors.length > 0) {
      return { success: false, buildId, errors };
    }

    // Determine entry point: prefer App.tsx > App.js > index.tsx > index.js > first file
    const ENTRY_PRIORITY = ["App.tsx", "App.ts", "App.jsx", "App.js", "index.tsx", "index.ts", "index.jsx", "index.js"];
    let entryName = transformed[0].name;
    for (const candidate of ENTRY_PRIORITY) {
      if (transformed.some((m) => m.name === candidate)) {
        entryName = candidate;
        break;
      }
    }

    const html = buildHtmlShell(transformed, entryName, projectName || "React Native App", vendorCode);
    await writeFile(join(artifactDir, "index.html"), html, "utf8");

    // Evict oldest cache entry if full
    if (artifactCache.size >= MAX_CACHE_ENTRIES) {
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [hash, entry] of Array.from(artifactCache.entries())) {
        if (entry.createdAt < oldestTime) { oldestTime = entry.createdAt; oldest = hash; }
      }
      if (oldest) {
        const old = artifactCache.get(oldest)!;
        rm(old.dir, { recursive: true, force: true }).catch(() => {});
        artifactCache.delete(oldest);
      }
    }

    artifactCache.set(sourceHash, { buildId, dir: artifactDir, createdAt: Date.now() });

    return { success: true, buildId };
  } catch (err: any) {
    await rm(artifactDir, { recursive: true, force: true }).catch(() => {});
    return { success: false, buildId, errors: [err?.message || "Unknown error"] };
  } finally {
    activeCompiles--;
  }
}

// ---------------------------------------------------------------------------
// Artifact lookup (used by the artifact-serving route)
// ---------------------------------------------------------------------------

export function getRnArtifactPath(buildId: string): string | null {
  for (const entry of Array.from(artifactCache.values())) {
    if (entry.buildId === buildId) return entry.dir;
  }
  return null;
}

export function getVendorPath(): string {
  return VENDOR_PATH;
}
