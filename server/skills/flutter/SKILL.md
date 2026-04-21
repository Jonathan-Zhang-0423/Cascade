# Flutter Skill

## Project Structure
```
/project/
  lib/
    main.dart             # App entry point, runApp(), MaterialApp/CupertinoApp
    app.dart              # App widget with theme, routing
    screens/              # Screen-level widgets (one per route)
    widgets/              # Reusable widget components
    models/               # Data classes / model objects
    services/             # API calls, database helpers
    providers/            # Riverpod providers or ChangeNotifiers
    utils/                # Helper functions, extensions
    constants/            # Colors, sizes, API endpoints
    routes.dart           # Named route or go_router definitions
  pubspec.yaml            # Dependencies and assets
  assets/                 # Images, fonts, JSON data
  test/                   # Widget and unit tests
```

## Essential Dependencies (`pubspec.yaml`)
```yaml
dependencies:
  flutter:
    sdk: flutter
  go_router: ^13.0.0          # Declarative routing
  flutter_riverpod: ^2.x      # State management
  dio: ^5.x                   # HTTP client
  cached_network_image: ^3.x  # Image caching
  shared_preferences: ^2.x    # Key-value storage
  flutter_secure_storage: ^9.x # Secure token storage
  freezed_annotation: ^2.x    # Immutable data classes

dev_dependencies:
  freezed: ^2.x
  build_runner: ^2.x
  flutter_test:
    sdk: flutter
```

## Idiomatic Patterns

### Widget structure
```dart
// Stateless widget — no local mutable state
class UserCard extends StatelessWidget {
  const UserCard({
    super.key,
    required this.user,
    this.onTap,
  });

  final User user;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(user.name, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              Text(user.email, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      ),
    );
  }
}
```

### State management with Riverpod
```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Provider for a data fetch
final usersProvider = FutureProvider<List<User>>((ref) async {
  final repo = ref.read(userRepositoryProvider);
  return repo.getUsers();
});

// StateNotifier for mutable state
@riverpod
class CartNotifier extends _$CartNotifier {
  @override
  List<CartItem> build() => [];

  void add(CartItem item) => state = [...state, item];
  void remove(String id) => state = state.where((i) => i.id != id).toList();
}

// In a ConsumerWidget:
class UsersScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final usersAsync = ref.watch(usersProvider);
    return usersAsync.when(
      loading: () => const CircularProgressIndicator(),
      error: (e, _) => Text('Error: $e'),
      data: (users) => ListView.builder(
        itemCount: users.length,
        itemBuilder: (_, i) => UserCard(user: users[i]),
      ),
    );
  }
}
```

### Navigation with go_router
```dart
final router = GoRouter(
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
    ),
    GoRoute(
      path: '/users/:id',
      builder: (context, state) => UserDetailScreen(
        userId: state.pathParameters['id']!,
      ),
    ),
  ],
);

// Navigate:
context.go('/users/123');          // replace
context.push('/users/123');        // push onto stack
context.pop();                     // pop back
```

### Layout essentials
```dart
// Horizontal layout
Row(
  mainAxisAlignment: MainAxisAlignment.spaceBetween,
  children: [
    Text('Left'),
    Expanded(child: Text('Fills remaining space')),
    Text('Right'),
  ],
)

// Scrollable list
ListView.builder(
  itemCount: items.length,
  itemBuilder: (context, index) => ListTile(title: Text(items[index])),
)

// Responsive sizing
SizedBox(
  width: MediaQuery.of(context).size.width * 0.8,
  child: child,
)
```

### Data classes with Freezed
```dart
// user.dart
import 'package:freezed_annotation/freezed_annotation.dart';
part 'user.freezed.dart';
part 'user.g.dart';

@freezed
class User with _$User {
  const factory User({
    required String id,
    required String name,
    required String email,
    String? avatarUrl,
  }) = _User;

  factory User.fromJson(Map<String, Object?> json) => _$UserFromJson(json);
}

// Generate: dart run build_runner build
```

### HTTP with Dio
```dart
class ApiService {
  final _dio = Dio(BaseOptions(baseUrl: 'https://api.example.com'));

  ApiService() {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        options.headers['Authorization'] = 'Bearer $token';
        handler.next(options);
      },
    ));
  }

  Future<List<User>> getUsers() async {
    final response = await _dio.get('/users');
    return (response.data as List).map((j) => User.fromJson(j)).toList();
  }
}
```

## Common Pitfalls
- Unbounded height inside a `Column` inside a `ListView` — wrap in `Expanded` or set `shrinkWrap: true`.
- Forgetting `const` constructors — Flutter reuses const widgets for performance.
- Mutating state without notifying Riverpod — always update `state = ...` with a new value.
- Using `BuildContext` after an `async` gap without checking `mounted`.
- Nesting `ListView` inside `Column` without `Expanded` — overflow errors.
- Missing `pubspec.yaml` asset declarations — images and fonts must be listed under `flutter.assets`.
- Hot reload doesn't apply changes to `main()` or `initState()` — use hot restart.
- Calling `setState()` after `dispose()` — always check `mounted` in async callbacks.

## Code Style
- File names: `snake_case` for all Dart files (`home_screen.dart`, `user_card.dart`).
- Class names: `PascalCase`.
- Variables and functions: `camelCase`.
- One widget per file for screen/component widgets.
- Use trailing commas in widget trees for cleaner formatting with `dart format`.
- Prefer `const` wherever possible.
- Run `dart format .` and `dart analyze` before committing.
