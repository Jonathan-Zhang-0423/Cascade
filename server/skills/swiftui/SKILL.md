# SwiftUI Skill

## Project Structure
```
/project/
  MyApp.swift             # App entry point (@main, WindowGroup)
  ContentView.swift       # Root view
  Views/                  # Screen and component views
  Models/                 # Data model structs/classes
  ViewModels/             # ObservableObject classes for state
  Services/               # Networking, persistence, API clients
  Extensions/             # Swift type extensions
  Assets.xcassets/        # Images, colors, app icon
  Info.plist              # App configuration and permissions
```

## Idiomatic Patterns

### Views and Modifiers
- Build UI by composing `View` structs. Each view's `body` property returns a view hierarchy.
- Apply modifiers in a chain: `.padding()`, `.foregroundColor()`, `.font()`, `.frame()`.
- Modifier order matters — `.padding().background(.blue)` differs from `.background(.blue).padding()`.
- Extract reusable views into their own structs conforming to `View`.

### Layout
- Use `VStack` (vertical), `HStack` (horizontal), `ZStack` (layered) for layout.
- Use `Spacer()` to push views apart within stacks.
- Use `ScrollView` for scrollable content and `List` for data-driven scrollable lists.
- Use `LazyVStack` / `LazyHStack` inside `ScrollView` for large datasets (only renders visible items).
- `GeometryReader` provides parent size for responsive layouts.

### Navigation
- Use `NavigationStack` (iOS 16+) with `NavigationLink` for push navigation.
- Use `TabView` for bottom tab navigation.
- Use `.sheet()` or `.fullScreenCover()` for modal presentation.
- Use `.navigationTitle()` and `.toolbar {}` to customize the navigation bar.

### Data Flow
- `@State` — local mutable state owned by one view.
- `@Binding` — two-way reference to a parent's `@State`.
- `@StateObject` — owns an `ObservableObject` (create it here).
- `@ObservedObject` — observes an `ObservableObject` passed from a parent.
- `@EnvironmentObject` — shared object injected via `.environmentObject()`.
- `@Environment(\.keyPath)` — read system environment values (color scheme, locale, etc.).
- Use `@Published` properties inside `ObservableObject` classes to trigger view updates.

### Lists and Collections
- Use `List { ForEach(items) { item in ... } }` for scrollable data lists.
- Provide an `id` key path or conform items to `Identifiable`.
- Use `.onDelete`, `.onMove` for swipe-to-delete and reordering.

### Networking
- Use `URLSession.shared.data(from: url)` with `async/await` for HTTP requests.
- Decode JSON with `JSONDecoder` and `Codable` model structs.
- Call network code inside `.task {}` modifier or in a `Task {}` block.

### Platform Considerations
- Use `SafeAreaInsets` — SwiftUI handles safe areas automatically in most cases.
- Use `.ignoresSafeArea()` only when content should extend behind status bar or home indicator.
- Access device traits via `@Environment(\.horizontalSizeClass)` for adaptive layouts.

## Common Pitfalls
- Forgetting `@State` or `@StateObject` — without property wrappers, the view won't update when data changes.
- Overusing `GeometryReader` — it fills all available space and can cause unexpected layout.
- Using `ObservableObject` without `@Published` on properties — views won't re-render.
- Missing `id` in `ForEach` — causes list rendering and animation bugs.
- Placing heavy logic in `body` — keep `body` pure; move logic to view models or `.onAppear`.
- Modifier order mistakes — `.frame()` before `.background()` sizes the background differently.
- Not handling optional/nil states — use `if let` or `??` to handle missing data in views.

## Code Style
- File names: `PascalCase` matching the primary type (`ContentView.swift`, `UserModel.swift`).
- Types and protocols: `PascalCase`.
- Properties, functions, variables: `camelCase`.
- One primary view/model per file.
- Use Swift's trailing closure syntax for view builders.
- Prefer `let` over `var` unless mutation is needed.
