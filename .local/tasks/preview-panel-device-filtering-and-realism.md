# Preview Panel: Platform-Filtered Devices & Simulator Realism

## What & Why
Improve the device preview panel so the iOS/Android platform toggle is more prominent (moved to the left), the device dropdown only shows models for the selected platform, includes all Apple models up to the iPhone 17 series, and the simulator frame looks more like a real device (matching the attached reference screenshot showing thick rounded bezels, Dynamic Island, and edge-to-edge screen rendering).

## Done looks like
- The Apple/Android toggle buttons appear to the LEFT of the device model dropdown
- Selecting iOS filters the dropdown to show only Apple device models; selecting Android shows only Android models
- When switching platforms, the selected device auto-switches to the first device of the newly selected platform
- iPhone 17, iPhone 17 Plus, iPhone 17 Pro, and iPhone 17 Pro Max are available in the iOS device list along with iPhone 16 series and other existing models
- The device simulator frame looks significantly more realistic — thicker bezels with proper rounding, a more accurate Dynamic Island, edge-to-edge screen under the status bar, and overall closer match to the reference screenshot

## Out of scope
- Adding new Android device models beyond what already exists
- Landscape-specific simulator styling overhaul
- Adding iPad models beyond the existing one

## Tasks
1. **Reorder toolbar** — Move the iOS/Android platform toggle to the left of the device model Select dropdown in the preview panel toolbar.
2. **Filter device list by platform** — Make the device Select dropdown only show devices matching the currently selected platform (`devicePlatform`). When the platform changes, auto-select the first device of that platform if the current selection doesn't match.
3. **Add iPhone models** — Add iPhone 16, iPhone 16 Plus, iPhone 16 Pro, iPhone 16 Pro Max, iPhone 17, iPhone 17 Plus, iPhone 17 Pro, and iPhone 17 Pro Max to the device specs with accurate dimensions and Dynamic Island flags.
4. **Improve simulator realism** — Rework the DeviceSimulator component to more closely match real iPhone appearance: thicker bezels, more realistic corner radii, refined Dynamic Island shape/positioning, edge-to-edge screen content that flows under the status bar area, improved shadow/depth effects, and side button details matching the reference screenshot.

## Relevant files
- `client/src/components/ide/preview-panel.tsx`
- `client/src/lib/device-specs.ts`
- `client/src/components/ide/device-simulator.tsx`
- `client/src/stores/ide-store.ts:274-282,578-608`
