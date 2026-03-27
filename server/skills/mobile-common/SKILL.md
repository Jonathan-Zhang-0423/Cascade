# Mobile Common Skill

Cross-framework mobile development concepts and patterns that apply regardless of whether the project uses React Native/Expo, Flutter, SwiftUI, or Kotlin/Jetpack Compose.

## Push Notifications
- Always request notification permissions before attempting to send or schedule notifications.
- Register for remote notifications via the platform push service (APNs for iOS, FCM for Android).
- Handle foreground, background, and killed-state notification delivery differently.
- Store the device push token on the backend and associate it with the user account.
- For local notifications, schedule with the OS notification API and handle tap actions.

## Deep Linking
- Register URL schemes (`myapp://`) and universal/app links (`https://example.com/path`) in the app manifest.
- Parse incoming deep link URLs in the app entry point and route to the correct screen.
- Test deep links with `npx uri-scheme open` (Expo), `adb shell am start -d` (Android), or `xcrun simctl openurl` (iOS Simulator).
- Handle deferred deep links for users who haven't installed the app yet.

## Local Storage
- Use platform-appropriate secure storage for sensitive data (tokens, passwords):
  - Expo: `expo-secure-store`
  - Flutter: `flutter_secure_storage`
  - iOS: Keychain via `KeychainAccess` or Security framework
  - Android: `EncryptedSharedPreferences` or Jetpack `DataStore`
- Use general key-value storage for preferences and non-sensitive data:
  - Expo: `@react-native-async-storage/async-storage`
  - Flutter: `shared_preferences`
  - iOS: `UserDefaults`
  - Android: `DataStore` or `SharedPreferences`
- For structured data, use a local database (SQLite, Room, Core Data, Hive, Drift).

## Camera and Media
- Always request camera and photo library permissions before accessing them.
- Use the platform image picker for selecting photos/videos from the gallery.
- For camera capture, use the camera API and handle both front and rear cameras.
- Compress images before uploading to reduce bandwidth and storage costs.
- Handle orientation metadata — photos may appear rotated without EXIF correction.

## Location Services
- Request location permissions with an explanation of why the app needs them.
- Use "when in use" permission by default; only request "always" if background tracking is necessary.
- Handle permission denial gracefully — show a message and degrade functionality.
- Use approximate location when precise coordinates aren't needed (better for privacy).
- Stop location updates when no longer needed to preserve battery.

## Permissions Best Practices
- Request permissions just-in-time — when the user performs the action that needs them, not at app launch.
- Show a pre-permission dialog explaining why the permission is needed before the system dialog appears.
- Handle all three permission states: granted, denied, and "don't ask again" / restricted.
- On iOS, permissions that are denied require the user to go to Settings — provide a link.
- Declare all required permissions in the manifest (AndroidManifest.xml, Info.plist, app.json).

## Responsive Mobile Design
- Design for multiple screen sizes — use relative sizing (percentages, flex) instead of fixed pixel values.
- Respect safe areas: status bar, notch/dynamic island, home indicator, navigation bar.
- Support both portrait and landscape orientations unless the app explicitly locks orientation.
- Handle keyboard appearance — scroll or resize content so text inputs remain visible.
- Use platform-standard spacing: 8dp grid on Android, 8pt grid on iOS.

## Accessibility
- Add accessibility labels to all interactive elements (buttons, links, inputs, images).
- Ensure touch targets are at least 44×44 points (iOS) / 48×48 dp (Android).
- Support dynamic text sizes (iOS Dynamic Type, Android font scaling).
- Ensure sufficient color contrast (4.5:1 for normal text, 3:1 for large text).
- Test with screen readers: VoiceOver (iOS) and TalkBack (Android).

## App Lifecycle
- Handle app states: active/foreground, inactive/background, terminated.
- Save unsaved user data when the app moves to the background.
- Restore state when the app returns to the foreground.
- Handle "cold start" vs "warm start" — cold starts may need to re-fetch data.
- On Android, handle configuration changes (rotation, locale) without losing state.

## Networking in Mobile
- Always handle offline/no-connection states gracefully — show a message, cache data, or queue actions.
- Use connection status listeners to update UI when connectivity changes.
- Implement retry logic with exponential backoff for failed network requests.
- Cache API responses for offline access when appropriate.
- Use HTTPS for all network requests.
