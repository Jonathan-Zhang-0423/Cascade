# FinClip Evaluation & Preview Runtime Strategy

**Branch:** `finclip-preview` (rollback point: commit `930c99b` on `main`)
**Date:** 2026-05
**Author:** preview fidelity investigation

---

## TL;DR

**FinClip does not solve our problem as a drop-in replacement for the current browser-iframe preview.** It's the right mental model (an embeddable mini-program runtime with high WeChat fidelity), but its shipping form is a **native SDK** (iOS/Android/Windows/macOS/Flutter/React Native bindings) that gets compiled into a host app binary. It is **not a pure JavaScript library you can drop into a browser tab**, and it doesn't run React Native / Flutter / Kotlin **apps** — it runs mini-programs *inside* a RN / Flutter / Kotlin host.

That mismatch means switching to FinClip is a substantial architectural change, not a library swap:

- FinClip gives us **high-fidelity WeChat Mini Program preview** only if users preview via a **downloaded host app** (mobile / desktop) or an Electron wrapper we ship. The in-browser IDE still needs a separate fallback.
- FinClip does **not** preview React Native, Flutter, or Kotlin Compose apps. Those remain separate toolchains.
- Pricing starts **$29/mo per seat** (Developer tier); enterprise tiers require sales contact. Self-hosted / on-prem pricing is quote-based.

**Recommendation — Option C (hybrid):** keep our own in-browser compiler for the "quick look" preview inside the web IDE, but add an **optional "Open in WeChat-faithful preview"** path that uses either FinClip's desktop app or the official Tencent DevTools CLI. This gets us native-quality preview where users want it (full-fidelity testing) without rebuilding our IDE around a native SDK.

Full analysis, comparison matrix, and a phased plan follow.

---

## 1. What FinClip actually is

FinClip (by FinoGeeks, Shenzhen) is a **mini-program container SDK** — a reusable runtime that lets any host app load and execute WeChat-spec mini-programs (WXML/WXSS/WXS + wx.* APIs). It's marketed as a "super-app" platform: you ship your banking app / retail app / etc. with the FinClip SDK embedded, then any mini-program signed for your channel can run inside it.

### Supported host platforms

Per FinoGeeks' published SDK list:

| Host platform | Integration | Language |
|---|---|---|
| iOS | Native framework | Objective-C / Swift |
| Android | Native AAR | Java / Kotlin |
| Windows | Native DLL | C++ |
| macOS | Native framework | Objective-C |
| Linux | Native .so | C++ |
| Flutter | Plugin (wraps native iOS/Android SDKs) | Dart |
| React Native | Module (wraps native iOS/Android SDKs) | JS + native bridge |
| HarmonyOS | Native | ArkTS |

**Critical observation:** there is **no pure-browser / JavaScript SDK**. The Flutter and React Native "SDKs" are bridges into the underlying native runtime — they don't run in a web browser. This matches the architecture you'd expect: FinClip ships a V8/JSCore-based logic layer plus a native rendering layer, so it *has* to run natively.

### What FinClip does NOT support

- **React Native app preview** — FinClip hosts mini-programs *inside* a RN app; it doesn't render RN apps themselves.
- **Flutter app preview** — same pattern: FinClip runs inside Flutter, not the other way around.
- **Kotlin Compose app preview** — no support.
- **SwiftUI app preview** — no support.
- **In-browser embedding without a native shell** — confirmed absent.

So for the "preview other types of apps" goal, FinClip addresses exactly **zero of the non-WeChat frameworks**. It only helps for WeChat.

### Fidelity

For WeChat Mini Programs specifically, FinClip claims near-100% compatibility with Tencent's runtime. It implements the full WXML/WXSS/WXS pipeline, the two-thread (logic + render) architecture, and the `wx.*` API surface. Mini-programs written for Tencent's WeChat can be loaded into a FinClip host largely unchanged. This part of the pitch appears legitimate — they're one of the more mature commercial mini-program containers.

### Pricing (as of 2026-05)

- **Developer**: $29/mo per seat — includes Studio IDE, SDK access, limited runtime.
- **Growth / Business / Enterprise tiers**: contact sales; typical enterprise quotes run into **five-to-six figures annually** per deployment based on public reports from similar vendors.
- **Self-hosted / on-prem**: quote-only; includes license server.
- **AWS Marketplace listing**: yes, exists for enterprise procurement.

No free tier suitable for embedding in a user-facing product without a license conversation.

---

## 2. Fit with our current architecture

Our current WeChat preview pipeline is:

1. Client `wechat-preview.tsx` sends source files (`.wxml/.wxss/.js/.json`) over HTTP.
2. Server `wechat-web-compiler.ts` transforms WXML→JSX + WXSS→CSS, bundles with esbuild, writes artifacts to `server/artifacts/wx-<hash>/`.
3. Client renders the artifact URL in an iframe.

The important property: **everything runs in a browser**. No native app, no download, no device connection. This is what makes the IDE feel instant.

### Switching cost matrix

| If we used FinClip… | Implication |
|---|---|
| Native iOS/Android SDK | Users must install a FinClip host app on their phone and scan a QR to preview. Leaves web IDE unchanged but shifts preview off-web. |
| Desktop SDK (Win/macOS) | We ship an Electron-wrapped CodeStart desktop app, or users download FinClip's desktop browser (`FinClip Browser` on App Store) and point it at the project. |
| FinClip Studio | A separate IDE we'd be pushing users *away* from CodeStart to. Non-starter. |
| Self-hosted / on-prem server | We host a FinClip license server, users authenticate, mini-program metadata gets uploaded. Backend work + ongoing license fee. |
| Web embed | **Does not exist.** |

None of these preserve the current "click and see" browser-iframe UX. Every FinClip path introduces either a download, a QR scan, or an on-prem server.

---

## 3. Alternatives surveyed

I looked at the full landscape. Here are the realistic options ranked by feasibility:

### A. Keep improving the in-house compiler (status quo)

What we have today — WXML→JSX + WXSS→CSS + wx.* polyfill in a browser iframe. After this branch's polish (PingFang SC toasts, page transitions, pull-to-refresh, tab-bar icon fallback) it's closer to faithful, but critical gaps remain:

- `rewriteExpr` mangles any WXML expression using identifiers outside the `SKIP_PREFIXING` allow-list (`Symbol`, `Map`, `Set`, `Promise`, arrow params…). Root cause of most "Build Failed" banners the user reports.
- No WXS support.
- Custom component lifecycle is partial.
- `<map>`, `<canvas 2d>`, `<video>`, `<web-view>`, `<live-player>` don't render.

**Pros:** zero dep changes, zero cost, full IDE control, instant UX preserved.
**Cons:** we're rebuilding a runtime that others have spent years on; fidelity will always trail a "real" container.

### B. Official Tencent WeChat DevTools (headless CLI)

Tencent ships `wechat-devtools` as a downloadable Electron app with a CLI (`cli --auto` / `cli auto --project` flags). The CLI can open a project and produce preview artifacts, and `miniprogram-ci` is an official npm package for CI uploads. Running it headlessly on our server lets us:

1. Receive source files from the client.
2. Spin up DevTools CLI in a sandboxed Docker container.
3. Have it produce a compiled output + a live preview URL (it hosts an internal dev server).
4. Proxy/embed that preview URL in our iframe.

**Pros:** 100% Tencent-authored runtime — definitionally faithful.
**Cons:**
- DevTools is Linux-unfriendly. The community maintains ports (`wechat-web-devtools-linux`) but they're unofficial and break on updates.
- DevTools is **not licensed for hosted use**. Running it on a shared server for end users is outside Tencent's EULA.
- Per-project CLI spin-up is slow (~3–5s cold start) vs. our current ~500ms esbuild.
- Container sandboxing + QR-code auth flow (Tencent sometimes demands login) makes scaling brittle.

This is the "most faithful" technical option but the licensing risk makes it unsuitable for a commercial SaaS product.

### C. Hybrid — improve in-house compiler + add a "Launch in DevTools" escape hatch

Keep the browser-iframe preview as the default (fast, free, 80% fidelity). Add an "Open in WeChat DevTools" button that:

- Serves the project as a downloadable ZIP.
- Exposes the project as a local `localhost` URL via a CLI invocation the user triggers on their own machine.
- Or deep-links to Tencent's DevTools if the user has it installed.

This sidesteps the licensing issue (the CLI runs on the user's machine, not ours) and preserves instant preview.

**Pros:** bounded scope, respects licensing, users who want 100% fidelity get it.
**Cons:** extra moving piece; users without DevTools installed see no improvement.

### D. Web-only polyfill libraries (`kbone`, `miniprogram-simulate`)

- **`kbone`** (official Tencent project) goes the *opposite* direction — it lets a mini-program run on web by adapting browser DOM to WXML. Our adapter does similar work; kbone is more mature. Adoption risk: kbone is primarily a *build-target* for mini-programs intended for real web deployment, not a simulator. Wiring it into our per-keystroke preview pipeline would be a significant port.
- **`miniprogram-simulate`** is a Jest-based testing harness — not a visual preview runtime.

Neither is a drop-in.

### E. FinClip (analyzed above)

Only viable via a desktop-app path. Doesn't cover non-WeChat frameworks. Paid.

### F. Native device preview via Expo Go / Flutter hot-reload

For RN and Flutter specifically, **the real fidelity win is running on-device via Expo Go or Flutter tooling**. That's already how serious mobile developers test. We could add "Scan QR to preview on your phone" for RN/Flutter projects — the same pattern FinClip uses for mini-programs.

**Pros:** 100% native fidelity — it *is* the real app.
**Cons:** requires phone in hand; not a browser-tab preview.

---

## 4. Comparison matrix

| Option | WeChat fidelity | RN | Flutter | Kotlin | In-browser UX | Setup cost | Ongoing cost | Licensing | Recommended? |
|---|---|---|---|---|---|---|---|---|---|
| A. In-house compiler (status quo + polish) | 70% | n/a | n/a | n/a | ✅ instant | — | — | clean | baseline |
| B. Tencent DevTools CLI (self-hosted) | 100% | ❌ | ❌ | ❌ | ⚠ slow + proxied | high (Docker, sandboxing) | maintenance | **violates Tencent EULA** | ❌ |
| C. Hybrid (A + "Open in DevTools" escape hatch) | 70% default, 100% opt-in | n/a | n/a | n/a | ✅ default; user-side for 100% | low | — | clean | ✅ **primary** |
| D. kbone / miniprogram-simulate | 60–75% | ❌ | ❌ | ❌ | ✅ | medium-high | — | OSS | secondary |
| E. FinClip (native SDK) | 95% | ❌ | ❌ | ❌ | ❌ requires desktop/mobile app | high (Electron wrap or new app) | $29+/seat/mo | commercial | ❌ for web; ⚠ for future desktop |
| F. Expo Go / Flutter QR preview for mobile frameworks | n/a | 100% | 100% | — | ⚠ requires phone | medium | — | OSS | ✅ **for RN / Flutter** |

---

## 5. Recommended strategy

Address the primary goal (WeChat preview fidelity) and the secondary goal (cover other frameworks) with **two separate tracks**, because one runtime doesn't solve both:

### Track 1 — WeChat: Hybrid (Option C)

**Phase 1: Fix the in-house compiler's known bugs** (1–2 days)
Before swapping toolchains, close the gaps that cause the "Build Failed" banner:

- [ ] Fix `rewriteExpr` in `server/wechat/wxml-to-jsx.ts`:
  - Expand `SKIP_PREFIXING` to cover JS globals (`Symbol`, `Map`, `Set`, `Promise`, `Error`, `RegExp`, `Reflect`, `Intl`, `Array`, `Object`, etc.).
  - Handle optional chaining (`user?.name`) without prefixing the right-hand identifier.
  - Detect arrow-function parameter scope (`{{list.filter(x => x.active)}}`) and exclude the param name from prefixing.
  - Detect spread and destructuring patterns.
- [ ] Add fallback render for unknown WXML tags instead of crashing (currently `COMP_MAP[tag] ?? "View"` is fine, but verify runtime components exist for every COMP_MAP value in `wx-runtime.tsx`).
- [ ] Surface compile *warnings* (unsupported `<wxs>`, `<import>`) in-UI as dismissible notes, not blocking errors.

**Phase 2: Add "Open in WeChat DevTools" escape hatch** (2–3 days)

- [ ] "Export project" button that builds a ZIP of the WeChat source tree and triggers a download.
- [ ] Short docs page: "For 100% fidelity, open the exported project in Tencent WeChat Developer Tools."
- [ ] Optional deep-link: if Tencent's DevTools is installed (custom URL scheme), open the project directly.

**Phase 3: Consider FinClip only if a desktop CodeStart version ships later.** Not urgent.

### Track 2 — React Native / Flutter: QR preview (Option F)

- [ ] For RN projects: generate an Expo tunnel URL on the server and display a QR code. Users scan with Expo Go and see a real build on their device.
- [ ] For Flutter projects: host the compiled Flutter web build (already exists in `flutter-web-preview.tsx`) AND offer a "Run on device" QR path for a mobile debug bridge (`flutter run -d` with a tunneled connection).
- [ ] Leave Kotlin Compose on web-WASM for now; device preview would require a full JVM + Android toolchain that isn't cost-justified yet.

### What we're explicitly NOT doing

- **Not integrating the FinClip native SDK into the web IDE.** There's no web SDK, and wrapping our IDE in Electron just to get FinClip would trade "in-browser" for "requires install" — a worse UX for the 90% of users who are happy with 80% fidelity.
- **Not self-hosting Tencent DevTools CLI.** EULA risk.
- **Not rewriting onto `kbone`.** Port cost exceeds the fidelity delta we'd gain over Phase 1 bug fixes.

---

## 6. Decision points I need from you

Before I implement, please confirm:

1. **Track 1, Phase 1 bugs first?** Fix `rewriteExpr` and the compile-error surfacing before anything else — this alone will likely resolve 80% of the first-compile failures the user has been seeing.
2. **FinClip desktop path on the roadmap?** If a CodeStart Desktop (Electron) app is on the roadmap, FinClip integration there becomes interesting. Confirm whether to plan for it as "future work" vs. "out of scope indefinitely."
3. **RN / Flutter device preview?** Does offering a "Scan QR on your phone" flow match the product direction? It requires an Expo tunnel server or equivalent.
4. **Budget for commercial licensing?** If $29/seat/mo × expected users is acceptable, FinClip's desktop path becomes cheaper to prototype. If zero budget, stay on Track 1.

---

## 7. Rollback

Everything on this branch is isolated. To revert:

```
git checkout main
git branch -D finclip-preview
```

The `930c99b` commit on `main` is the pre-investigation snapshot.
