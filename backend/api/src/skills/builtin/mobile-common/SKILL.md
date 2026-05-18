# Mobile Common Skill

Cross-framework mobile development concepts and patterns that apply regardless of whether the project uses React Native/Expo, Flutter, SwiftUI, or Kotlin/Jetpack Compose.

## Push Notifications
- Always request notification permissions before attempting to send or schedule notifications.
- Register for remote notifications via the platform push service (APNs for iOS, FCM for Android).
- Handle foreground, background, and killed-state notification delivery differently.
- Store the device push token on the backend and associate it with the user account.
- For local notifications, schedule with the OS notification API and handle tap actions.

**Setup by platform:**
| Platform | Package / API |
|----------|--------------|
| React Native | `expo-notifications` |
| Flutter | `firebase_messaging` + `flutter_local_notifications` |
| iOS (SwiftUI) | `UNUserNotificationCenter` + APNs |
| Android (Compose) | `NotificationCompat` + FCM |

## Deep Linking
- Register URL schemes (`myapp://`) and universal/app links (`https://example.com/path`) in the app manifest.
- Parse incoming deep link URLs in the app entry point and route to the correct screen.
- Test deep links:
  - Expo: `npx uri-scheme open "myapp://screen" --ios`
  - Android: `adb shell am start -d "myapp://screen"`
  - iOS Simulator: `xcrun simctl openurl booted "myapp://screen"`
- Handle deferred deep links for users who haven't installed the app yet.

## Local Storage

Use **secure storage** for sensitive data (tokens, passwords):
| Platform | Package |
|----------|---------|
| React Native | `expo-secure-store` |
| Flutter | `flutter_secure_storage` |
| iOS | Keychain Services / `KeychainAccess` package |
| Android | `EncryptedSharedPreferences` or Jetpack `DataStore` |

Use **general key-value storage** for preferences and non-sensitive data:
| Platform | Package |
|----------|---------|
| React Native | `@react-native-async-storage/async-storage` |
| Flutter | `shared_preferences` |
| iOS | `UserDefaults` |
| Android | `DataStore` or `SharedPreferences` |

For **structured/relational data**, use a local database:
| Platform | Package |
|----------|---------|
| React Native | `expo-sqlite` |
| Flutter | `drift` (SQLite ORM) or `isar` |
| iOS | Core Data or SQLite |
| Android | Room (SQLite ORM) |

## Camera and Media
- Always request camera and photo library permissions before accessing them.
- Use the platform image picker for selecting photos/videos from the gallery.
- For camera capture, use the camera API and handle both front and rear cameras.
- Compress images before uploading to reduce bandwidth and storage costs.
- Handle EXIF orientation metadata — photos may appear rotated without correction.

```
React Native: expo-camera, expo-image-picker
Flutter: image_picker, camera
iOS: PhotosUI (PHPhotoPicker), AVFoundation
Android: ActivityResultContracts.TakePicture, ContentResolver
```

## Location Services
- Request location permissions with an explanation of why the app needs them.
- Use "when in use" permission by default; only request "always" if background tracking is required.
- Handle permission denial gracefully — show a message and degrade functionality.
- Use approximate location when precise coordinates aren't needed (better for privacy).
- Stop location updates when no longer needed to preserve battery.

## Permissions Best Practices
- Request permissions **just-in-time** — when the user performs the action that needs them, not at app launch.
- Show a **pre-permission dialog** explaining why the permission is needed before the system dialog appears.
- Handle all three states: granted, denied, and "don't ask again" / restricted.
- On iOS, denied permissions require the user to go to Settings — provide a link with `UIApplication.openSettingsURLString`.
- Declare all required permissions in the manifest (`AndroidManifest.xml`, `Info.plist`, `app.json`).

## Responsive Mobile Design
- Use relative sizing (percentages, flex fractions) instead of fixed pixel values.
- Respect safe areas: status bar, notch/dynamic island, home indicator, navigation bar.
- Support both portrait and landscape orientations unless the app locks orientation intentionally.
- Handle keyboard appearance — scroll or resize content so text inputs remain visible when the keyboard opens.
- Target standard spacing grids: 8dp grid on Android, 8pt grid on iOS.

**Keyboard avoidance:**
- React Native: `KeyboardAvoidingView` with `behavior="padding"` on iOS, `"height"` on Android.
- Flutter: `resizeToAvoidBottomInset: true` on `Scaffold`.
- SwiftUI: `.ignoresSafeArea(.keyboard, edges: .bottom)` or use `ScrollViewReader`.
- Compose: `WindowInsets.ime` with `Modifier.imePadding()`.

## Accessibility
- Add accessibility labels to all interactive elements (buttons, links, inputs, images).
- Ensure touch targets are at least **44×44 pt** (iOS) / **48×48 dp** (Android).
- Support dynamic text sizes: iOS Dynamic Type, Android font scaling.
- Ensure sufficient color contrast: 4.5:1 for normal text, 3:1 for large text.
- Test with screen readers: **VoiceOver** (iOS) and **TalkBack** (Android).

**Quick wins:**
- React Native: `accessibilityLabel`, `accessibilityRole`, `accessibilityHint` props.
- Flutter: `Semantics` widget wrapping interactive elements.
- SwiftUI: `.accessibilityLabel()`, `.accessibilityHint()` modifiers.
- Compose: `semantics { contentDescription = "..." }` modifier.

## App Lifecycle
- Handle app states: active/foreground, inactive, background, terminated.
- Save unsaved user data when the app moves to background.
- Restore state when the app returns to foreground.
- On Android, handle configuration changes (rotation, locale) without losing state — use `ViewModel`.
- Cold start vs warm start: cold starts may need to re-initialize data sources.

## Networking in Mobile
- Always handle offline/no-connection states gracefully — show a message, use cached data, or queue actions.
- Use connection status listeners to update UI when connectivity changes.
- Implement retry logic with **exponential backoff** for failed network requests.
- Cache API responses for offline access when appropriate (React Query / Riverpod / Room for offline-first).
- Use HTTPS for all network requests. Pin certificates for high-security apps.
- Set reasonable timeouts: 10–30 seconds for most requests.

## Authentication Patterns
- Store auth tokens in **secure storage** (never AsyncStorage or SharedPreferences without encryption).
- Implement token refresh: automatically retry requests with a new access token when a 401 is received.
- Clear all stored credentials on logout — delete from secure storage and clear any in-memory caches.
- Support biometric authentication (Face ID, fingerprint) for re-auth flows.

```
React Native: expo-local-authentication
Flutter: local_auth
iOS: LAContext (LocalAuthentication)
Android: BiometricPrompt
```

## Performance Checklist
- Use virtualized/lazy lists for all data-driven scrollable views.
- Avoid heavy computations on the main thread — use background isolates/threads.
- Compress and resize images before upload; use thumbnail URLs in lists.
- Minimize re-renders: memoize callbacks, use stable keys, avoid anonymous functions in render.
- Profile with: React DevTools, Flutter DevTools, Instruments (iOS), Android Profiler.
