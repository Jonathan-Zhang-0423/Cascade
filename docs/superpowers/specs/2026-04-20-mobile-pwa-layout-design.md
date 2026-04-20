# Mobile PWA Layout Design

## Goal

Make Cascade AI work as an installable PWA on mobile phones while keeping the existing desktop IDE layout completely unchanged. Mobile users get a two-panel app (Chat ↔ Preview) with swipe navigation and a floating pill shortcut. Desktop users see no difference.

## Architecture

**Approach: CSS breakpoint split.** `IDEPage` gains a `useIsMobile()` hook that gates which component tree renders. On mobile (≤768px) it mounts `MobileIDE`; on desktop it mounts the existing layout unchanged. Both share the same Zustand store — no state sync needed.

**Tech Stack:** React, Tailwind CSS, Zustand (existing), `vite-plugin-pwa` (new). Swipe uses native touch events — no new gesture library.

---

## Component Architecture

### New files

| File | Responsibility |
|------|----------------|
| `client/src/hooks/useIsMobile.ts` | Returns `true` when `window.innerWidth ≤ 768`. Updates on resize via `ResizeObserver`. |
| `client/src/components/mobile/MobileIDE.tsx` | Root mobile shell. Owns swipe gesture state, renders header with top tab indicators, mounts active panel. |
| `client/src/components/mobile/MobileChatPanel.tsx` | Full-height chat tab. Reuses `ChatMessageList` + message input. Floating "▶ Preview" pill shown when build completes. |
| `client/src/components/mobile/MobilePreviewPanel.tsx` | Full-bleed preview tab. Reuses preview iframe logic from `PreviewPanel`, strips device frame chrome. "← Chat" strip at bottom. |
| `public/manifest.json` | PWA manifest — name, icons, theme color, `display: standalone`. |

### Modified files

| File | Change |
|------|--------|
| `client/src/components/ide/ide.tsx` | Import `useIsMobile` and `MobileIDE`. If `isMobile`, render `<MobileIDE />` instead of the existing panel layout. |
| `client/index.html` | Add iOS PWA meta tags and manifest link. |
| `vite.config.ts` | Add `vite-plugin-pwa` with manifest and workbox config. |
| `package.json` | Add `vite-plugin-pwa` dependency. |

---

## Mobile Layout Detail

### Header (always visible)

```
[ ← Back ]  [ Project Name ]  [ Framework tag ]  [ ⋯ ]
            [ Chat  |  Preview ]  ← tab indicators
```

- Fixed height, same midnight background as desktop navbar (`#0c0c14`)
- Tab indicators: active tab has `color: #2563eb` + `border-bottom: 2px solid #2563eb`
- `⋯` menu: refresh preview (reloads iframe) — v1 scope only

### Chat panel (default active tab)

- Full height below header, full width
- Renders `ChatMessageList` (existing component, no changes)
- Message input pinned to bottom (existing input component)
- **Floating pill:** `position: fixed`, bottom `80px`, centered. Appears only when `buildComplete` state is true (last build finished without error). Label: `▶ Preview`. Tapping switches to Preview tab.
- When a build is running, pill is replaced by the existing `CascadeLoader` in the chat stream

### Preview panel

- Full bleed — iframe fills 100% width and height below the header
- No device frame chrome (unlike desktop PreviewPanel which shows a phone frame)
- Reuses the same iframe `src` logic from `PreviewPanel` (reads `session.previewUrl` from store)
- Bottom strip: `height: 44px`, `background: #0c0c14`, centered "← Chat" text/button that switches back to Chat tab
- Refresh icon in header `⋯` menu reloads the iframe

### Swipe gesture

- `touchstart` records `startX`
- `touchend` computes `deltaX = endX - startX`
- `|deltaX| ≥ 40px` triggers tab switch (left swipe → Preview, right swipe → Chat)
- Vertical scrolling (`|deltaY| > |deltaX|`) cancels the gesture — chat scroll unaffected
- No animation required for v1 (instant switch); can add CSS slide transition later

---

## PWA Configuration

### `public/manifest.json`

```json
{
  "name": "Cascade AI",
  "short_name": "Cascade",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#08080e",
  "theme_color": "#08080e",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### `client/index.html` additions

```html
<link rel="manifest" href="/manifest.json" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Cascade" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

### `vite-plugin-pwa` (vite.config.ts)

```ts
VitePWA({
  registerType: 'autoUpdate',
  manifest: false, // we provide our own manifest.json
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    navigateFallback: '/index.html',
    runtimeCaching: [
      {
        urlPattern: /^\/api\//,
        handler: 'NetworkFirst',
        options: { cacheName: 'api-cache', networkTimeoutSeconds: 10 },
      },
    ],
  },
})
```

---

## State & Data Flow

- `useIsMobile()` — pure presentation gate, no store changes
- `MobileIDE` reads `projectId` from router params, same as desktop `IDEPage`
- `MobileChatPanel` reads `chatMessages`, `managerMessages`, `_nextSeq` — same as `ChatMessageList`
- Build-complete pill visibility: derive from existing `taskStatuses` in store — show pill when all tasks are `completed` and none are `error`
- `MobilePreviewPanel` reads `previewUrl` from store — same field desktop `PreviewPanel` uses (check `client/src/stores/ide-store.ts` for exact field name)

No new store fields needed.

---

## Icons

Two PNG icons required: `public/icons/icon-192.png` and `public/icons/icon-512.png`. Use the existing Cascade logo/branding. If icons don't exist yet, placeholder solid-color PNGs are acceptable for v1.

---

## Out of Scope

- Code editor on mobile (hidden entirely — not a v1 goal)
- File tree on mobile
- Tablet layout (treat tablet as desktop at >768px)
- Offline AI inference (service worker caches shell only; API calls require network)
- Push notifications
- Background sync
