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
