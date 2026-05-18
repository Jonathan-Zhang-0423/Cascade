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
    stores/             # Zustand or Context state
    services/           # API calls, storage helpers
    utils/              # Helper functions, formatters
    constants/          # Colors, dimensions, API URLs
    types/              # TypeScript type definitions
  package.json
  tsconfig.json
  babel.config.js
```

## Essential Dependencies
```json
{
  "expo": "~51.x",
  "@react-navigation/native": "^6.x",
  "@react-navigation/stack": "^6.x",
  "@react-navigation/bottom-tabs": "^6.x",
  "react-native-safe-area-context": "^4.x",
  "react-native-screens": "^3.x",
  "zustand": "^4.x",
  "@tanstack/react-query": "^5.x",
  "expo-secure-store": "~13.x",
  "expo-image": "~1.x"
}
```

## Idiomatic Patterns

### Navigation setup
```tsx
// src/navigation/index.tsx
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

export type RootStackParamList = {
  Home: undefined;
  Detail: { id: string };
  Profile: { userId: string; edit?: boolean };
};

const Stack = createStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Detail" component={DetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// In a screen component:
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
type Props = NativeStackScreenProps<RootStackParamList, 'Detail'>;

function DetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  // ...
}
```

### Components and Views
- Use React Native core components: `View`, `Text`, `ScrollView`, `FlatList`, `Pressable`, `TextInput`, `Image`.
- Never use HTML elements (`<div>`, `<span>`, `<p>`) — they do not exist in React Native.
- Use `StyleSheet.create()` for styles, not CSS files. All styles use camelCase.
- Flexbox is the layout model — `flexDirection` defaults to `column` (unlike web).

```tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';

function Card({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [
      styles.card,
      pressed && styles.pressed,
    ]}>
      <Text style={styles.title}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  pressed: { opacity: 0.7 },
  title: { fontSize: 16, fontWeight: '600' },
});
```

### State management with Zustand
```tsx
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthStore {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
}

const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'auth', storage: createJSONStorage(() => AsyncStorage) }
  )
);
```

### FlatList for performant lists
```tsx
<FlatList
  data={items}
  keyExtractor={(item) => item.id}
  renderItem={({ item }) => <ItemRow item={item} />}
  ItemSeparatorComponent={() => <View style={styles.separator} />}
  ListEmptyComponent={<EmptyState />}
  onEndReached={loadMore}
  onEndReachedThreshold={0.5}
  refreshControl={
    <RefreshControl refreshing={refreshing} onRefresh={refetch} />
  }
/>
```

### Platform handling
```tsx
import { Platform, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    paddingTop: Platform.OS === 'ios' ? 44 : 24,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1 },
      android: { elevation: 4 },
    }),
  },
});
```

### Safe area handling
```tsx
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

// Wrap app root:
export default function App() {
  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  );
}

// In a screen:
function HomeScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingBottom: insets.bottom }}>
      {/* content */}
    </View>
  );
}
```

### TextInput patterns
```tsx
function SearchBar({ onSearch }: { onSearch: (query: string) => void }) {
  const [query, setQuery] = useState('');
  return (
    <TextInput
      value={query}
      onChangeText={setQuery}
      onSubmitEditing={() => onSearch(query)}
      placeholder="Search..."
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      clearButtonMode="while-editing"  // iOS
    />
  );
}
```

### Expo APIs
| Need | Package |
|------|---------|
| Camera | `expo-camera` |
| Image picker | `expo-image-picker` |
| Location | `expo-location` |
| Notifications | `expo-notifications` |
| Secure storage | `expo-secure-store` |
| Haptics | `expo-haptics` |
| File system | `expo-file-system` |
| Sharing | `expo-sharing` |

## Common Pitfalls
- Using `<div>` or `<span>` instead of `<View>` and `<Text>`.
- Forgetting `SafeAreaView` — content overlaps status bar or notch.
- Using `onClick` instead of `onPress`.
- Nesting `<Text>` incorrectly — only `<Text>` can be nested inside `<Text>`.
- Missing `keyExtractor` on `FlatList` — breaks scrolling performance and animations.
- Not requesting permissions before using camera, location, or notifications.
- Using `float`, `display: grid`, or `box-shadow` CSS — not supported in React Native.
- Nesting `ScrollView` inside `ScrollView` in the same direction — use `FlatList` instead.
- Setting percentage widths/heights without a parent that has a defined size.

## Code Style
- File names: `PascalCase` for components and screens (`HomeScreen.tsx`, `UserCard.tsx`).
- Screens in `src/screens/`, reusable components in `src/components/`.
- Destructure props with TypeScript types at the top of the component.
- Keep screen components thin — extract business logic into hooks or Zustand stores.
- Type all navigation params with `RootStackParamList`.

## Data Fetching with TanStack Query

All server state goes through TanStack Query — never store API data in `useState` or Zustand. Query owns caching, refetching, deduplication, and invalidation for you.

### Setup
```tsx
// App.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>{/* ... */}</NavigationContainer>
    </QueryClientProvider>
  );
}
```

### Typed query hook
```tsx
// src/api/users.ts
export function useUserQuery(id: string) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => fetchUser(id, token!),
    enabled: !!token && !!id,          // don't fire until dependencies ready
    staleTime: 5 * 60_000,              // user profile: 5 min
  });
}

export function useUpdateUserMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UserPatch) => updateUser(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['user', patch.id] });
      const prev = qc.getQueryData<User>(['user', patch.id]);
      qc.setQueryData(['user', patch.id], (old: User) => ({ ...old, ...patch }));
      return { prev };                  // rollback handle
    },
    onError: (_err, patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(['user', patch.id], ctx.prev);
    },
    onSettled: (_d, _e, patch) => qc.invalidateQueries({ queryKey: ['user', patch.id] }),
  });
}
```

### UI branching
- `isPending` + empty cache → render skeleton (first load).
- `isFetching` + has data → pull-to-refresh spinner; keep showing current list.
- `error` → error state with retry (`refetch()`).
- `data?.length === 0` → empty state.
Use `isPending`, not `isLoading` — `isLoading` was deprecated in v5.

### Infinite lists
```tsx
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
  queryKey: ['posts'],
  queryFn: ({ pageParam = 0 }) => fetchPosts(pageParam),
  getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  initialPageParam: 0,
});
const items = data?.pages.flatMap((p) => p.items) ?? [];
// wire onEndReached={hasNextPage && !isFetchingNextPage ? fetchNextPage : undefined}
```

### Stale-time defaults
- **30 s** — feeds, dashboards, notifications.
- **5 min** — user profile, settings, reference data.
- **Infinity** — static config loaded once per session; manually invalidate.

## State Architecture + Navigation

### Decision matrix
| Kind of state | Tool | Example |
|---|---|---|
| Server data | **TanStack Query** | posts, user profile, feed |
| App-wide client state | **Zustand** | auth token, theme, feature flags |
| Feature-scoped ephemeral | **Context** | form context, wizard step, modal open/close |
| Component-local | **`useState`** | input value, expanded/collapsed |

**Anti-pattern:** mirroring server data in Zustand. The cache becomes stale the moment another screen mutates it. Let Query own server state; Zustand holds only client state (theme, token).

### Typed navigation
```tsx
export type RootStackParamList = {
  Home: undefined;
  Detail: { id: string };
  Profile: { userId: string; edit?: boolean };
};
type DetailProps = NativeStackScreenProps<RootStackParamList, 'Detail'>;
export function DetailScreen({ route, navigation }: DetailProps) {
  const { id } = route.params; // fully typed
}
```

### Auth-gate pattern
```tsx
export function RootNavigator() {
  const token = useAuthStore((s) => s.token);
  return (
    <NavigationContainer>
      {token ? <AppStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
```
Swapping the root navigator on logout resets the stack cleanly — no lingering screens with stale auth state.

### Deep linking
```tsx
const linking = {
  prefixes: ['myapp://', 'https://myapp.com'],
  config: {
    screens: {
      Detail: 'detail/:id',
      Profile: 'user/:userId',
    },
  },
};
<NavigationContainer linking={linking}>...</NavigationContainer>
```
Handles push-notification taps and universal links. Test both foreground and cold-start URL opens.

### Back-button & unsaved-form guard
```tsx
// Android hardware back
useEffect(() => {
  const sub = BackHandler.addEventListener('hardwareBackPress', () => {
    if (isDirty) { promptSave(); return true; }
    return false;
  });
  return () => sub.remove();
}, [isDirty]);

// Any navigation (swipe back, nav button, deep link)
useEffect(() => navigation.addListener('beforeRemove', (e) => {
  if (!isDirty) return;
  e.preventDefault();
  Alert.alert('Discard changes?', '', [
    { text: 'Keep editing', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
  ]);
}), [navigation, isDirty]);
```

## Performance + Forms

### Render-path rules
- Wrap pure list items in `React.memo` with a stable key (`item.id`). Without memo, scrolling a 1,000-item list re-renders every row on every parent state change.
- `useCallback` every handler passed to a memoized child — otherwise the prop is a new function every render and memo does nothing.
- `useMemo` only for expensive computations (sorting, filtering large arrays). Don't wrap cheap objects — the memo itself costs more than recreating.
- **No inline style objects or inline arrow functions** in hot-render trees:
  ```tsx
  // Bad — new object + new function every render
  <Pressable style={{ padding: 12 }} onPress={() => onTap(item.id)} />
  // Good
  <Pressable style={styles.row} onPress={handlePress} />
  ```

### Lists
- Use `@shopify/flash-list` (`<FlashList>`) instead of `<FlatList>` for lists with more than ~100 items. 5-10× faster on scroll and lower memory.
- Set `estimatedItemSize` (required by FlashList) to the median row height in pixels.
- `keyExtractor={(item) => item.id}` — always stable, never the array index.
- Precompute `data` outside render. `data={[...a, ...b]}` inline allocates a new array every render and defeats list virtualization.

### Forms with `react-hook-form`
```tsx
import { useForm, Controller } from 'react-hook-form';

type FormValues = { email: string; password: string };

const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>();

<Controller
  control={control}
  name="email"
  rules={{ required: 'Email required', pattern: { value: /^\S+@\S+$/, message: 'Invalid' } }}
  render={({ field: { onChange, onBlur, value } }) => (
    <TextInput value={value} onChangeText={onChange} onBlur={onBlur} />
  )}
/>
{errors.email && <Text style={styles.err}>{errors.email.message}</Text>}

<Pressable onPress={handleSubmit(onSubmit)} disabled={isSubmitting}>...</Pressable>
```

### Keyboard + focus
```tsx
<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
  <ScrollView keyboardShouldPersistTaps="handled">
    <TextInput ref={emailRef} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
    <TextInput ref={passwordRef} returnKeyType="done" secureTextEntry onSubmitEditing={handleSubmit(onSubmit)} />
  </ScrollView>
</KeyboardAvoidingView>
```
Wrap the whole form in `<TouchableWithoutFeedback onPress={Keyboard.dismiss}>` to dismiss on tap-outside.

## Storage, Accessibility & Error Boundaries

### Storage decision tree
| Data | Tool | Notes |
|---|---|---|
| UI prefs, last-viewed cache | `@react-native-async-storage/async-storage` | Plaintext. Fine for non-sensitive. |
| Tokens, credentials, session | `expo-secure-store` | Keychain (iOS) / Keystore (Android) backed. Encrypted at rest. |
| Large / high-frequency | `react-native-mmkv` | ~30× faster than AsyncStorage; supports encryption. |

**Never store auth tokens in AsyncStorage.** If migrating an existing app: read from AsyncStorage, write to SecureStore, then delete the AsyncStorage key.

### Accessibility
- **`accessibilityLabel`** on every interactive element. Icon-only buttons especially — screen readers read nothing useful otherwise.
- **`accessibilityRole`** — `"button"`, `"link"`, `"header"`, `"image"`, `"switch"`, `"tab"`. Tells VoiceOver/TalkBack what kind of element it is.
- **`accessibilityHint`** for non-obvious actions: `"Double tap to open details"`.
- **44×44 pt minimum tap target.** Use `hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}` to expand touchable area for visually small icons without enlarging the graphic.
- Test with **VoiceOver** (iOS Settings → Accessibility) and **TalkBack** (Android) before shipping — at least navigate one screen end-to-end with the screen reader on.

### Error boundaries
Error boundaries are class components (hooks can't catch render errors). Wrap the app root, plus each tabbed screen so one screen crashing doesn't white-screen the rest of the app.
```tsx
class ErrorBoundary extends React.Component<Props, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    Sentry.captureException(err, { contexts: { react: { componentStack: info.componentStack } } });
  }
  render() {
    if (this.state.err) {
      return (
        <View style={styles.err}>
          <Text>Something went wrong.</Text>
          <Pressable onPress={() => this.setState({ err: null })}><Text>Try again</Text></Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}
```

### Crash reporting + logger
- `sentry-expo` (or `@sentry/react-native`) with release/dist tags set from `Constants.expoConfig`.
- Set user context (anonymized id, never email/PII) on login; clear on logout.
- Route all logs through one wrapper (`src/log.ts`) that uses `console.*` in dev and `Sentry.addBreadcrumb` in prod — never sprinkle raw `console.log` through production code.
