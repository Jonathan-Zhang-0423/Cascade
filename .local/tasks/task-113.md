---
title: QR Code Phone Preview with Live Reload & Multi-Page Support
---
# QR Code Phone Preview with Live Reload

## What & Why
Add the ability to preview projects on a real phone by scanning a QR code. Currently the preview is entirely client-side (srcDoc iframe), so there's no URL a phone can visit. This feature will serve the project's HTML/CSS/JS over HTTP on a dedicated preview port, generate a QR code pointing to that URL, and support live reload via WebSocket so the phone updates automatically when files change. Multi-page navigation within the preview will also work since the server will resolve internal links against the virtual file system.

## Done looks like
- A QR code button in the preview panel toolbar opens a popover/dialog showing a scannable QR code
- The QR code points to a preview server URL (same Replit domain, dedicated port) that serves the project's HTML with inlined CSS/JS
- Scanning the QR code on a phone opens the project in the phone's browser
- When files change in the IDE, the phone browser auto-reloads via an injected WebSocket connection
- Internal navigation (e.g. `<a href="about.html">`) works — the preview server resolves paths against the project's virtual file system
- The preview server starts on demand when the QR feature is first used and stays running for the session

## Out of scope
- Tunneling/ngrok for external network access (relies on Replit's existing domain routing)
- Authentication or access control on the preview server
- Hot module replacement (full page reload is sufficient)

## Tasks
1. **Preview server endpoint** — Add a new Express route (e.g. `/api/preview-server/start`) that accepts the project's file tree and starts (or updates) an in-memory HTTP server on a dedicated port. The server resolves any requested path against the virtual file tree, inlines CSS/JS the same way the current `inlineExternalFiles` does, and returns the rendered HTML. Inject a small WebSocket client script for live reload.
2. **WebSocket live reload** — Attach a WebSocket server to the preview server. Expose a `/api/preview-server/notify` endpoint that the frontend calls whenever files change, which broadcasts a reload signal to all connected phone clients.
3. **Multi-page routing** — The preview server should handle any path (e.g. `/about.html`, `/pages/contact.html`) by looking up the corresponding file in the virtual file tree (`/project/about.html`, etc.) and serving it with the same inlining logic. Return a simple 404 page for missing paths.
4. **QR code UI** — Add a QR code button to the preview panel toolbar. On click, it calls the start endpoint with the current file tree, then displays a popover/dialog with the generated QR code (use a client-side QR library like `qrcode.react`). The QR code encodes the preview server URL. Show the URL as copyable text below the QR code.
5. **Auto-notify on file changes** — Wire up a `useEffect` in the preview panel (or IDE page) that calls the notify endpoint whenever `files` or `previewRefreshKey` change, so connected phones reload automatically.

## Relevant files
- `client/src/components/ide/preview-panel.tsx`
- `server/routes.ts`
- `client/src/stores/ide-store.ts:248-249,555-556`