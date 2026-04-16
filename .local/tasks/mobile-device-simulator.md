# Mobile Device Simulator Preview

## What & Why

Replace the current iframe-based HTML preview (`preview-panel.tsx`) with a mobile device simulator that shows apps inside phone/tablet device frames. This is the foundational UI change for the mobile pivot — users need to see their mobile app as it would appear on a real device.

## Done looks like

- New `DeviceSimulator` component replaces or extends the current `PreviewPanel`
- Device frame chrome showing realistic phone bezels (iPhone, Pixel, iPad, etc.)
- Device selector dropdown with common device sizes
- Portrait/landscape orientation toggle
- Status bar mockup (time, battery, signal) inside the device frame
- Content area renders the app preview (initially web content, later Expo Web)
- Platform toggle (iOS/Android) that adjusts the device frame styling
- Touch-friendly interactions (tap targets sized for mobile)
- Responsive scaling — the device frame scales to fit the available panel space
- Dark/light device frame option

## Out of scope

- Actually running React Native/Expo apps (that's a separate task)
- Real device testing or QR code generation
- The cloud build pipeline

## Depends on

- Task #102 (Roadmap document — defines framework decisions)

## Relevant files

- `client/src/components/ide/preview-panel.tsx`
- `client/src/pages/ide.tsx`
- `client/src/stores/ide-store.ts`
