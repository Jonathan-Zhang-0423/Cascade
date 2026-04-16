# Mobile Device Simulator Preview

## What & Why

Upgrade the existing device simulator skeleton into a production-quality mobile preview experience. The current implementation uses emoji status bars, crude rectangle bezels, and fixed pixel dimensions that overflow the preview panel. Users need a polished, realistic device frame that properly scales to fit the available space, supports all 7 spec devices plus custom dimensions, and provides the visual context of a real phone/tablet.

## Done looks like

- Device frame looks realistic: proper Dynamic Island notch on modern iPhones, clean bezel radius, native-looking status bar with time/battery/signal rendered as SVG/CSS (no emoji), iOS home indicator bar, Android triangle/circle/square navigation buttons
- Frame automatically scales down to fit within the preview panel — no overflow or scrollbars, even for iPad (810×1080)
- Device selector dropdown lists all 7 predefined devices plus a "Custom" option that reveals width/height number inputs
- Orientation toggle (portrait/landscape) rotates the frame and its content smoothly
- Platform toggle button in the toolbar switches the device frame chrome between iOS and Android styles (wired to existing `devicePlatform` store field)
- Light/dark frame style toggle works (already functional, just needs visual polish)
- Cursor changes to a touch-pointer (finger) icon when hovering over the simulator screen area
- Device state (selectedDevice, orientation, platform, frameStyle) persists across sessions via localStorage
- All existing preview behavior preserved: iframe rendering, console capture via postMessage, refresh button

## Out of scope

- Expo Web preview or framework-specific rendering (that comes later with framework detection)
- Actual device testing or remote simulator connections
- Drag-to-resize the device frame manually
- Multiple simultaneous device previews (side-by-side comparison)

## Tasks

1. **Responsive frame scaling** — Wrap the device frame in a container that measures available space and computes a CSS scale factor so the frame always fits within the preview panel without overflow, maintaining aspect ratio.

2. **Realistic iOS device chrome** — Replace the emoji status bar with SVG/CSS rendering of time, cellular bars, Wi-Fi icon, and battery. Implement a proper Dynamic Island notch shape for modern iPhones (15/15 Pro Max) and a classic notch for iPhone SE. Refine the home indicator bar proportions.

3. **Realistic Android device chrome** — Replace the rectangle navigation buttons with proper back (triangle), home (circle), and recent (square) SVG icons. Render the Android-style status bar with time, signal, battery, and notification icons area.

4. **Custom dimensions input** — Add a "Custom" option to the device selector. When selected, show width and height number inputs in the toolbar. Store custom dimensions in the device state.

5. **Platform toggle in toolbar** — Add a toggle button (or segmented control) that switches between iOS and Android chrome styles, wired to the existing `devicePlatform` field in the store. Changing the toggle re-renders the frame chrome without changing the device size.

6. **Touch cursor hint** — Apply a CSS cursor style inside the simulator screen area that shows a pointer/finger icon when hovering, reinforcing the mobile context.

7. **Persist device state** — Add `selectedDevice`, `deviceOrientation`, `devicePlatform`, and `deviceFrameStyle` to the `persistState` function and restore them in `loadProject` / `getPersistedState`.

## Relevant files

- `client/src/components/ide/device-simulator.tsx`
- `client/src/lib/device-specs.ts`
- `client/src/components/ide/preview-panel.tsx`
- `client/src/stores/ide-store.ts:489-510`
- `client/src/stores/ide-store.ts:632-672`
