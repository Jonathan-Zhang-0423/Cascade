# SwiftUI Skill

## Project Structure
```
/project/
  MyApp.swift             # App entry point (@main, WindowGroup)
  ContentView.swift       # Root view
  Views/
    Screens/              # Full-screen views (one per navigation destination)
    Components/           # Reusable sub-views
  Models/                 # Data model structs / Codable types
  ViewModels/             # @Observable classes for screen state
  Services/               # Networking, persistence, API clients
  Extensions/             # Swift type extensions
  Resources/
    Assets.xcassets/      # Images, colors, app icon
    Localizable.strings   # Localization strings
  Info.plist              # App configuration and permissions
```

## Essential Packages (Swift Package Manager)
```
Alamofire (networking)
Kingfisher (image caching)
KeychainAccess (secure storage)
```
Or use native equivalents: `URLSession`, `AsyncImage`, `Keychain` Services API.

## Idiomatic Patterns

### Views and modifiers
```swift
struct UserCard: View {
    let user: User
    var onTap: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(user.name)
                .font(.headline)
            Text(user.email)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture { onTap?() }
    }
}
```

### @Observable view models (iOS 17+)
```swift
import Observation

@Observable
class HomeViewModel {
    var users: [User] = []
    var isLoading = false
    var error: String?

    func loadUsers() async {
        isLoading = true
        defer { isLoading = false }
        do {
            users = try await UserService.shared.fetchUsers()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct HomeScreen: View {
    @State private var vm = HomeViewModel()

    var body: some View {
        Group {
            if vm.isLoading {
                ProgressView()
            } else if let error = vm.error {
                ContentUnavailableView(error, systemImage: "exclamationmark.triangle")
            } else {
                List(vm.users) { user in
                    UserCard(user: user)
                }
            }
        }
        .task { await vm.loadUsers() }
        .navigationTitle("Users")
    }
}
```

### Navigation with NavigationStack (iOS 16+)
```swift
struct AppView: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            HomeScreen()
                .navigationDestination(for: User.self) { user in
                    UserDetailScreen(user: user)
                }
                .navigationDestination(for: String.self) { id in
                    ProfileScreen(userId: id)
                }
        }
    }
}

// Navigate:
path.append(user)            // push UserDetailScreen
path.removeLast()            // pop
path = NavigationPath()      // go to root
```

### Tab navigation
```swift
struct MainTabView: View {
    @State private var selection = 0

    var body: some View {
        TabView(selection: $selection) {
            HomeScreen()
                .tabItem { Label("Home", systemImage: "house") }
                .tag(0)
            ProfileScreen()
                .tabItem { Label("Profile", systemImage: "person") }
                .tag(1)
        }
    }
}
```

### Networking with async/await
```swift
struct UserService {
    static let shared = UserService()
    private let decoder = JSONDecoder()

    func fetchUsers() async throws -> [User] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: "https://api.example.com/users")!)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw APIError.badResponse
        }
        return try decoder.decode([User].self, from: data)
    }
}

// Codable model:
struct User: Identifiable, Codable {
    let id: String
    let name: String
    let email: String
}
```

### Sheets and alerts
```swift
struct ContentView: View {
    @State private var showSheet = false
    @State private var showAlert = false

    var body: some View {
        Button("Open") { showSheet = true }
            .sheet(isPresented: $showSheet) { DetailView() }
            .alert("Delete?", isPresented: $showAlert) {
                Button("Delete", role: .destructive) { performDelete() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This action cannot be undone.")
            }
    }
}
```

### Persistence with UserDefaults
```swift
extension UserDefaults {
    var hasCompletedOnboarding: Bool {
        get { bool(forKey: "hasCompletedOnboarding") }
        set { set(newValue, forKey: "hasCompletedOnboarding") }
    }
}
```

## Common Pitfalls
- Forgetting `@State` or `@Observable` — without property wrappers, the view won't update.
- Overusing `GeometryReader` — it fills all available space and disrupts layouts.
- Using `ObservableObject` without `@Published` properties — views won't re-render.
- Missing `id` in `ForEach` — causes list rendering and animation bugs.
- Placing heavy logic in `body` — keep `body` pure; put async work in `.task {}` or view models.
- Modifier order mistakes — `.frame()` before `.background()` sizes the background differently.
- Not handling nil/optional states in SwiftUI — use `if let` or `??` in view bodies.
- Calling async functions without `await` inside `.task {}` — wrap async calls correctly.
- Using `@StateObject` when you should use `@State private var vm = ViewModel()` (iOS 17+).

## Code Style
- File names: `PascalCase` matching the primary type (`ContentView.swift`, `UserModel.swift`).
- Types and protocols: `PascalCase`.
- Properties, functions, variables: `camelCase`.
- One primary view or model per file.
- Use Swift's trailing closure syntax for view builders.
- Prefer `let` over `var` unless mutation is needed.
- Use `#Preview` macros for Xcode previews.
- Run `swift-format` before committing.
