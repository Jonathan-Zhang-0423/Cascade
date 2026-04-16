---
title: Mobile Device Simulator Preview (MP-1)
---

# Mobile Device Simulator Preview

## What & Why

Replace the current iframe-based HTML preview with a mobile device simulator that renders apps inside realistic phone and tablet device frames. This is the foundational UX for the mobile pivot — users need to see their apps in a device context, not a raw web view.

## Done looks like

- DeviceSimulator component wraps the preview content inside a realistic phone/tablet frame
  - iPhone SE (375×667), iPhone 15 (390×844), iPhone 15 Pro Max (430×932)
  - iPad (810×1080), Pixel 7 (412×915), Pixel Fold (884×1104), Samsung Galaxy S24 (360×780)
  - Custom dimensions input
- Device selector dropdown in preview panel header
- Orientation toggle (portrait/landscape) that re-renders the frame
- Platform toggle (iOS/Android) adjusting chrome accordingly
- Dark/light device frame options
- Frame scales responsively to fit panel
- Content area (iframe) renders inside the frame
- Device state persisted to ide-store.ts
- Touch interaction visual hints (cursor → finger icon)
- Preview panel layout updated to accommodate device simulator
- All existing preview functionality (HTML rendering, console capture, etc.) still works inside the device frame

## Out of scope

- Expo Web preview (that comes in MP-2 when we add framework detection)
- Framework-specific rendering (still HTML/web content for now)
- Actual device testing (just visual framing)

## Tasks

1. Create `client/src/components/ide/device-simulator.tsx`
   - DeviceSimulator wrapper component
   - Realistic device frames (bezels, notch, status bar, home indicator)
   - Device selection and orientation state
   - Responsive frame scaling

2. Create `client/src/lib/device-specs.ts`
   - Device dimensions and specs data
   - Frame generation utilities (bezels, notches, corners)
   - Platform-specific chrome styles

3. Update `client/src/stores/ide-store.ts`
   - Add selectedDevice (device name or custom)
   - Add orientation ("portrait" | "landscape")
   - Add platformMode ("ios" | "android")
   - Add deviceFrameStyle ("light" | "dark")
   - Persist these to localStorage

4. Update `client/src/components/ide/preview-panel.tsx`
   - Wrap iframe content with DeviceSimulator
   - Add device selector dropdown
   - Add orientation toggle
   - Add platform toggle
   - Add frame style toggle
   - Pass device state to DeviceSimulator

5. Update `client/src/pages/ide.tsx`
   - Ensure layout accommodates device simulator frame properly

6. Add styling
   - Tailwind classes for device frames
   - Realistic bezels, notches, status bars
   - Touch cursor hints
   - Responsive scaling CSS

## Relevant files

- `client/src/components/ide/preview-panel.tsx` — current preview implementation
- `client/src/stores/ide-store.ts` — state management
- `client/src/pages/ide.tsx` — layout
- `references/visual_style_and_contrast.md` — for frame styling
