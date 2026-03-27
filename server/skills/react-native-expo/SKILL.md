# React Native / Expo Skill

## Project Structure
```
/project/
  App.tsx               # Root component, navigation container
  app.json              # Expo configuration (name, slug, sdkVersion, permissions)
  assets/               # Images, fonts, splash screen
  src/
    screens/            # Screen-level components (one per route)
    components/         # Reusable UI components
    navigation/         # Stack/Tab/Drawer navigator setup
    hooks/              # Custom hooks
    utils/              # Helper functions
    constants/          # Colors, dimensions, API URLs
    services/           # API calls, storage helpers
  package.json
  tsconfig.json
  babel.config.js
```

## Idiomatic Patterns

### Navigation
- Use `@react-navigation/native` with stack, tab, or drawer navigators.
- Define a root navigator in `src/navigation/` and render it inside `<NavigationContainer>` in `App.tsx`.
- Pass data between screens via `route.params`; type params with `RootStackParamList`.
- Use `useNavigation()` and `useRoute()` hooks for programmatic navigation.

### Components and Views
- Use React Native core components: `View`, `Text`, `ScrollView`, `FlatList`, `Pressable`, `TextInput`, `Image`.
- Never use HTML elements (`<div>`, `<span>`, `<p>`) — they do not exist in React Native.
- Use `StyleSheet.create()` for styles, not CSS files. Styles use camelCase properties.
- Flexbox is the layout model — `flexDirection` defaults to `column` (unlike web).

### State Management
- Use `useState` / `useReducer` for local state.
- For global state, use React Context or a lightweight library like Zustand.
- For async data, use `@tanstack/react-query` or `useSWR`.

### Platform Handling
- Use `Platform.OS` to check `"ios"` or `"android"`.
- Use `Platform.select({ ios: value, android: value })` for platform-specific values.
- Wrap content in `SafeAreaView` (or `useSafeAreaInsets()`) to avoid notch/status-bar overlap.

### Lists
- Use `FlatList` for long scrollable lists (virtualized). Always provide a `keyExtractor`.
- Use `SectionList` for grouped data with headers.

### Touch and Gestures
- Use `Pressable` (preferred) or `TouchableOpacity` for tappable elements.
- Ensure touch targets are at least 44×44 points for accessibility.
- For complex gestures, use `react-native-gesture-handler`.

### Expo APIs
- Camera: `expo-camera`
- Location: `expo-location` (request permissions first)
- Notifications: `expo-notifications`
- Storage: `expo-secure-store` for sensitive data, `@react-native-async-storage/async-storage` for general data.
- Images: `expo-image-picker`
- Haptics: `expo-haptics`

## Common Pitfalls
- Using `<div>` or `<span>` instead of `<View>` and `<Text>` — React Native has no DOM.
- Forgetting `SafeAreaView` causes content to overlap the status bar or notch.
- Using `onClick` instead of `onPress` — React Native uses `onPress`.
- Nesting `<Text>` incorrectly — only `<Text>` can be nested inside `<Text>`.
- Missing `keyExtractor` on `FlatList` breaks scrolling performance.
- Not requesting permissions before using camera, location, or notifications.
- Using CSS properties that don't exist in React Native (e.g., `float`, `display: grid`, `box-shadow`). Use `elevation` (Android) and `shadowOffset/shadowColor/shadowOpacity/shadowRadius` (iOS) for shadows.
- Setting percentage widths/heights without a parent that has a defined size.

## Code Style
- File names: `PascalCase` for components and screens (`HomeScreen.tsx`, `UserCard.tsx`).
- Screens live in `src/screens/`, reusable components in `src/components/`.
- Destructure props at the top of the component.
- Use TypeScript for type safety; define navigation param types.
- Keep screen components thin — extract business logic into hooks or utils.
