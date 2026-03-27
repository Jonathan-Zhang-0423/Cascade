# Flutter Skill

## Project Structure
```
/project/
  lib/
    main.dart             # App entry point, runApp(), MaterialApp/CupertinoApp
    screens/              # Screen-level widgets (one per route)
    widgets/              # Reusable widget components
    models/               # Data classes / model objects
    services/             # API calls, database helpers
    providers/            # State management (ChangeNotifier, Riverpod, etc.)
    utils/                # Helper functions, constants
    routes.dart           # Named route definitions
  pubspec.yaml            # Dependencies and assets
  assets/                 # Images, fonts, JSON data
  test/                   # Widget and unit tests
```

## Idiomatic Patterns

### Widget Tree
- Everything is a widget. Build UI by composing small, focused widgets.
- Use `StatelessWidget` for UI that doesn't change. Use `StatefulWidget` when local mutable state is needed.
- Keep the `build()` method clean — extract complex sub-trees into helper methods or separate widgets.

### Navigation
- Use `Navigator.push` / `Navigator.pop` for basic stack navigation.
- Define named routes in `MaterialApp(routes: { ... })` for cleaner navigation.
- Use `go_router` for declarative, URL-based routing (recommended for complex apps).
- Pass data via constructor parameters or route arguments.

### State Management
- For simple local state, use `setState()` inside a `StatefulWidget`.
- For shared state, use `Provider` / `ChangeNotifier` (built-in pattern) or `Riverpod`.
- Avoid deeply nesting `setState` calls — lift state up or use a state management solution.

### Layout
- Use `Column` (vertical), `Row` (horizontal), and `Stack` (layered) for layout.
- Wrap children in `Expanded` or `Flexible` to control how they share available space.
- Use `Padding`, `SizedBox`, and `Container` for spacing and sizing.
- `ListView` and `GridView` for scrollable lists.

### Material / Cupertino
- Use `MaterialApp` + Material widgets for Android-style UI.
- Use `CupertinoApp` + Cupertino widgets for iOS-style UI.
- Use `Platform.isIOS` / `Platform.isAndroid` for platform-specific behavior.
- Wrap screens in `Scaffold` (Material) for app bar, floating action button, drawer, and bottom navigation.

### Data and Networking
- Use the `http` or `dio` package for REST API calls.
- Parse JSON with `jsonDecode()` and map to model classes with `fromJson()` / `toJson()` factory constructors.
- Use `FutureBuilder` or `StreamBuilder` to render async data in the widget tree.

### Theming
- Define a `ThemeData` in `MaterialApp(theme: ...)` for consistent colors, typography, and shapes.
- Access theme values with `Theme.of(context)`.

## Common Pitfalls
- Unbounded height inside a `Column` inside a `ListView` — wrap in `Expanded` or set `shrinkWrap: true`.
- Forgetting `const` constructors — Flutter reuses const widgets for performance.
- Mutating state without calling `setState()` — the UI won't rebuild.
- Using `BuildContext` after an `async` gap — check `mounted` before using context in async callbacks.
- Nesting `ListView` inside `Column` without `Expanded` — causes overflow errors.
- Missing `pubspec.yaml` asset declarations — images and fonts must be listed under `flutter.assets`.
- Hot reload doesn't apply changes to `main()` or `initState()` — use hot restart for those.

## Code Style
- File names: `snake_case` for all Dart files (`home_screen.dart`, `user_card.dart`).
- Class names: `PascalCase` (`HomeScreen`, `UserCard`).
- Variables and functions: `camelCase`.
- One widget per file for top-level screen/component widgets.
- Use trailing commas in widget trees for cleaner formatting.
- Prefer `const` wherever possible for performance.
