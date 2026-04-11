# Design: React Native Browser Simulator — Extended Implementation

**Date:** 2026-04-08
**Status:** Approved for implementation
**Scope:** Extend the existing Babel to react-native-web iframe preview with four improvements

---

## Context

CodeStart has a browser-based React Native preview built on Babel and react-native-web. The architecture works (vendor bundle exports verified at runtime), but four areas need improvement:

1. `process.env` is undefined at module load time — breaks expo-router and several Expo packages
2. expo-router is naively stubbed as `return __RNW__.ReactNavigation` — can't use Stack, Tabs, Link, useRouter
3. 9+ commonly AI-generated packages have no stubs and silently crash apps
4. Runtime errors show garbled generated-code stack traces instead of original file/line

All four changes live in the same two server files with no new dependencies.

---

## Files Modified

- `server/rn-web-compiler.ts` — Process polyfill, eval-based registration, expo-router shim, 9+ package stubs, source map decoding
- `server/rn-vendor-entry.js` — Add SourceMapConsumer export from source-map-js
- `client/src/components/ide/rn-web-preview.tsx` — Handle __rn_source_error__ postMessage

No new npm dependencies. source-map-js is already in node_modules (a Babel transitive dependency).

---

## Change 1: process Polyfill

Add to the first inline script block in buildHtmlShell(), before the vendor bundle:

```
var process = { env: { NODE_ENV: 'production', EXPO_OS: 'web' } };
```

expo-router and several Expo packages check process.env.NODE_ENV at module load time. Without it they throw ReferenceError or load dev-mode code paths that reference Metro-specific APIs.

---

## Change 2: expo-router Shim

Replace `if (name === 'expo-router') return __RNW__.ReactNavigation;` in makeRequire().

Hand-crafted shim exposing the expo-router public API using already-bundled @react-navigation/* from __RNW__:
- Stack -> createNativeStackNavigator() from __RNW__.ReactNavigationStack
- Tabs -> createBottomTabNavigator() from __RNW__.ReactNavigationBottomTabs
- Link -> Pressable that calls navigation.navigate()
- useRouter -> { navigate, back, push, replace, canGoBack }
- useSegments -> path segments array
- usePathname -> current route path string
- Slot -> renders children (used in layouts)
- router -> global singleton

Virtual route context: build inMemoryContext from __modules entries matching app/ paths.
expo-router's RequireContext only needs: ctx.keys(), ctx(key), ctx.resolve(key), ctx.id.
expo-router ships this exact pattern as inMemoryContext() in its testing library (verified).

---

## Change 3: New Package Stubs

Add after existing expo stubs in makeRequire():

expo-av: Audio.Sound.createAsync() returns mock sound with playAsync/pauseAsync/stopAsync/unloadAsync all returning Promise.resolve(). Video renders as RNW.View.

expo-image-picker: launchImageLibraryAsync and launchCameraAsync return { canceled: true, assets: null }. Permission calls return { granted: false }.

react-native-maps: MapView renders gray placeholder View with text. Marker/Polyline/Polygon/Circle/etc render null.

lottie-react-native: LottieView renders transparent View with width/height from props.

react-native-chart-kit: LineChart/BarChart/PieChart/ProgressChart/etc render gray box with "Chart (preview unavailable)" label.

react-native-paper: Proxy stub. Provider/PaperProvider renders children. useTheme returns minimal color object. All other exports render as Views.

react-native-animatable: makeAnimatable(BaseComponent) strips animation props (animation, duration, delay, iterationCount, useNativeDriver) and renders the base component.

@shopify/flash-list: FlashList reimplemented as ScrollView + data.map(renderItem). Full FlatList-compatible surface: data, renderItem, keyExtractor, ItemSeparatorComponent, ListHeaderComponent, ListFooterComponent, ListEmptyComponent, horizontal.

react-native-mmkv: MMKV class backed by in-memory _mmkvStores[id]. Synchronous get/set/contains/delete/getAllKeys/clearAll. Hooks: useMMKVString, useMMKVNumber, useMMKVBoolean.

zustand: Minimal create(fn) with synchronous state, getState(), setState(), subscribe(). Non-reactive (no re-renders on state changes) — sufficient for preview rendering.

@react-native-firebase/*: console.warn + Proxy returning Promise no-ops for all calls.

---

## Change 4: Source Maps and eval-Based Module Registration

### Security context
The dynamic code evaluation happens inside the preview iframe which runs under sandbox="allow-scripts". The code being registered is Babel-transformed user source that is already embedded in the HTML on the server side. This is identical to how CodePen, StackBlitz, and all browser-based transpilers work. No greater risk than the existing inline script approach.

### Server-side (rn-web-compiler.ts)

In transformFile(): change sourceMaps: false to sourceMaps: true. Return { code, map, error }.

In doCompile(): collect result.map per file into sourceMapsRegistry: Record<string, object>.

In buildHtmlShell() signature: add sourceMapsRegistry parameter. Serialize into HTML:
```
var __sourceMaps = JSON.stringify(sourceMapsRegistry);
```

### Vendor bundle (rn-vendor-entry.js)

Add: export { SourceMapConsumer } from 'source-map-js'
Access in HTML shell: var SourceMapConsumer = __RNW__.SourceMapConsumer;

### HTML shell changes

Module registration — use new Function() to register each module so Chrome reports the original filename in stack traces:
```
var _fn = new Function('module', 'exports', 'require', code + '\n//# sourceURL=' + name);
__modules[name] = _fn;
```
new Function() is used over eval() to avoid ESLint no-eval. The code is pre-embedded string content from the server. With new Function(), reportedLine === generatedCodeLine (no line offset needed).

Lazy source map consumer:
```
var __consumers = {};
function getConsumer(filename) {
  if (!__consumers[filename] && __sourceMaps[filename])
    __consumers[filename] = new SourceMapConsumer(__sourceMaps[filename]);
  return __consumers[filename] || null;
}
```

Stack decoder: parse "at Foo (App.tsx:6:10)" from stack string, call consumer.originalPositionFor({ line, column }), replace with original position.

Enhanced error handler: decode stack before showError() and before postMessage. Add new message type __rn_source_error__ with { message, location: { file, line, column } }.

### Frontend (rn-web-preview.tsx)

Existing '__rn_runtime_error__' handler stays. Add handler for '__rn_source_error__' — treat same as runtime error for now. location field available for future editor annotation.

---

## Verification Plan

1. Basic RN app with View/Text/StyleSheet — renders without errors
2. @react-navigation/native-stack with NavigationContainer — screens render and navigate
3. expo-router with app/index.tsx and app/(tabs)/_layout.tsx — virtual context picks up routes
4. Apps using expo-av, react-native-maps, react-native-paper, zustand — no crashes, placeholder UI renders
5. Deliberate throw new Error('test') at line 5 of App.tsx — error panel shows App.tsx:5 not App.tsx:NaN
6. Import expo-constants — no "process is not defined" error
7. Existing web preview (direct iframe) — unchanged, no regression
