# Kotlin / Jetpack Compose Skill

## Project Structure
```
/project/
  build.gradle.kts            # Project-level Gradle config
  src/main/kotlin/
    MainActivity.kt           # Entry point, setContent { }
    ui/
      screens/                # Screen-level composables
      components/             # Reusable composable components
      theme/
        Theme.kt              # MaterialTheme, color scheme, typography
        Color.kt              # Color definitions
        Type.kt               # Typography definitions
    data/
      models/                 # Data classes
      repository/             # Data access layer
    navigation/
      NavGraph.kt             # Navigation host and route definitions
    viewmodel/                # ViewModel classes
  src/main/res/               # Resources (drawables, strings, etc.)
  AndroidManifest.xml         # App manifest, permissions
```

## Idiomatic Patterns

### Composables
- Build UI with `@Composable` functions. Each composable describes a piece of the UI.
- Keep composables small and focused. Extract reusable pieces into `ui/components/`.
- Composable function names use `PascalCase`: `HomeScreen()`, `UserCard()`.
- Accept data and callbacks as parameters — composables should be stateless when possible.

### Layout
- Use `Column` (vertical), `Row` (horizontal), `Box` (layered) for layout.
- Use `Modifier` chain for sizing, padding, alignment: `.fillMaxWidth()`, `.padding(16.dp)`, `.align()`.
- Use `LazyColumn` / `LazyRow` for scrollable lists (virtualized, like RecyclerView).
- Use `Spacer(modifier = Modifier.weight(1f))` to distribute space.
- Use `Scaffold` for standard screen structure (top bar, bottom bar, FAB, drawer).

### Navigation
- Use `androidx.navigation.compose` with `NavHost` and `composable()` route definitions.
- Define routes as string constants or a sealed class.
- Navigate with `navController.navigate("route")`.
- Pass arguments via route parameters: `"detail/{id}"` and `backStackEntry.arguments`.

### State Management
- `remember { mutableStateOf(value) }` for local composable state.
- `rememberSaveable` to survive configuration changes (screen rotation).
- Use `ViewModel` with `StateFlow` or `mutableStateOf` for screen-level state.
- Collect flows in composables with `.collectAsStateWithLifecycle()`.
- State hoisting: move state up to the caller, pass value + onValueChange callbacks down.

### Material Design 3
- Use `MaterialTheme` for consistent theming: `MaterialTheme.colorScheme`, `MaterialTheme.typography`.
- Standard components: `Button`, `TextField`, `Card`, `TopAppBar`, `BottomNavigation`, `FloatingActionButton`.
- Use `Surface` as a styled container with elevation and color from the theme.
- Dynamic color is available on Android 12+ via `dynamicDarkColorScheme` / `dynamicLightColorScheme`.

### Data and Networking
- Use Retrofit or Ktor for HTTP requests.
- Define data classes with `@Serializable` (kotlinx.serialization) or Gson annotations.
- Repository pattern: ViewModel calls Repository, Repository calls API/database.
- Use `Room` for local database persistence.

### Lifecycle
- Use `LaunchedEffect(key)` to run suspend functions when a composable enters composition or key changes.
- Use `DisposableEffect` for setup/teardown (e.g., listeners, callbacks).
- Use `SideEffect` for non-suspend side effects that run on every recomposition.

## Common Pitfalls
- Forgetting `remember` — state resets on every recomposition without it.
- Performing heavy work inside a composable body — use `LaunchedEffect` or move to ViewModel.
- Using `mutableListOf` without `mutableStateListOf` — Compose won't detect list mutations.
- Missing `Modifier` parameter on reusable composables — always accept `modifier: Modifier = Modifier` as the first optional parameter.
- Hardcoding colors/sizes instead of using `MaterialTheme` — makes theming inconsistent.
- Nesting scrollable containers (`LazyColumn` inside `Column` with `verticalScroll`) — causes crashes. Use `item {}` blocks inside `LazyColumn` instead.
- Not requesting runtime permissions before accessing camera, location, or storage.

## Code Style
- File names: `PascalCase` for files containing a primary composable or class (`HomeScreen.kt`).
- Composable functions: `PascalCase` (`GreetingCard`, `ProfileHeader`).
- Non-composable functions and variables: `camelCase`.
- Data classes: `PascalCase` with concise property names.
- One primary composable per file for screens; group small related composables together.
- Use trailing lambda syntax for composable content blocks.
