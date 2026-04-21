# Kotlin / Jetpack Compose Skill

## Project Structure
```
/project/
  build.gradle.kts            # Project-level Gradle config
  app/build.gradle.kts        # App-level dependencies
  app/src/main/kotlin/
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
      repository/             # Data access layer (Room, Retrofit)
      local/                  # Room database, DAOs
      remote/                 # Retrofit API interfaces
    navigation/
      NavGraph.kt             # Navigation host and route definitions
    viewmodel/                # ViewModel classes
    di/                       # Hilt dependency injection modules
  AndroidManifest.xml         # App manifest, permissions
```

## Essential Dependencies (`app/build.gradle.kts`)
```kotlin
dependencies {
    // Compose
    implementation(platform("androidx.compose:compose-bom:2024.04.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")

    // Navigation
    implementation("androidx.navigation:navigation-compose:2.7.x")

    // ViewModel
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.x")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.x")

    // Hilt (dependency injection)
    implementation("com.google.dagger:hilt-android:2.51.x")
    kapt("com.google.dagger:hilt-compiler:2.51.x")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.x")

    // Networking
    implementation("com.squareup.retrofit2:retrofit:2.11.x")
    implementation("com.squareup.retrofit2:converter-gson:2.11.x")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.x")

    // Room (local database)
    implementation("androidx.room:room-runtime:2.6.x")
    implementation("androidx.room:room-ktx:2.6.x")
    kapt("androidx.room:room-compiler:2.6.x")

    // Image loading
    implementation("io.coil-kt:coil-compose:2.6.x")
}
```

## Idiomatic Patterns

### Composables
```kotlin
@Composable
fun UserCard(
    user: User,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,  // Always accept modifier as optional param
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onTap),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = user.name, style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(4.dp))
            Text(text = user.email, style = MaterialTheme.typography.bodySmall)
        }
    }
}
```

### ViewModel with StateFlow
```kotlin
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val userRepository: UserRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        loadUsers()
    }

    private fun loadUsers() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val users = userRepository.getUsers()
                _uiState.update { it.copy(users = users, isLoading = false) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message, isLoading = false) }
            }
        }
    }
}

data class HomeUiState(
    val users: List<User> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
)
```

### Collecting state in Compose
```kotlin
@Composable
fun HomeScreen(
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    when {
        uiState.isLoading -> CircularProgressIndicator()
        uiState.error != null -> ErrorMessage(uiState.error!!)
        else -> UserList(users = uiState.users)
    }
}
```

### Navigation
```kotlin
// NavGraph.kt
@Composable
fun AppNavGraph(navController: NavHostController) {
    NavHost(navController = navController, startDestination = "home") {
        composable("home") { HomeScreen(navController) }
        composable(
            "detail/{userId}",
            arguments = listOf(navArgument("userId") { type = NavType.StringType })
        ) { backStackEntry ->
            val userId = backStackEntry.arguments?.getString("userId")!!
            DetailScreen(userId = userId)
        }
    }
}

// Navigate:
navController.navigate("detail/$userId")
navController.popBackStack()
```

### LazyColumn for lists
```kotlin
LazyColumn(
    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp),
) {
    items(users, key = { it.id }) { user ->
        UserCard(user = user, onTap = { navController.navigate("detail/${user.id}") })
    }
}
```

### Room database
```kotlin
@Entity(tableName = "users")
data class UserEntity(
    @PrimaryKey val id: String,
    val name: String,
    val email: String,
)

@Dao
interface UserDao {
    @Query("SELECT * FROM users ORDER BY name ASC")
    fun getAllUsers(): Flow<List<UserEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertUser(user: UserEntity)
}
```

### Hilt dependency injection
```kotlin
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides @Singleton
    fun provideRetrofit(): Retrofit = Retrofit.Builder()
        .baseUrl("https://api.example.com/")
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    @Provides @Singleton
    fun provideApiService(retrofit: Retrofit): ApiService =
        retrofit.create(ApiService::class.java)
}
```

## Common Pitfalls
- Forgetting `remember` — state resets on every recomposition without it.
- Performing heavy work inside a composable body — use `LaunchedEffect` or move to ViewModel.
- Using `mutableListOf` without `mutableStateListOf` — Compose won't detect list mutations.
- Missing `modifier: Modifier = Modifier` on reusable composables — prevents caller customization.
- Hardcoding colors/sizes instead of using `MaterialTheme` values.
- Nesting `LazyColumn` inside `Column` with `verticalScroll` — causes crashes. Use `item {}` blocks inside `LazyColumn` instead.
- Not requesting runtime permissions on Android 6+ before accessing camera, location, or storage.
- Using `collectAsState()` instead of `collectAsStateWithLifecycle()` — the latter respects lifecycle for battery efficiency.

## Code Style
- File names: `PascalCase` for Kotlin files (`HomeScreen.kt`, `UserCard.kt`).
- Composable functions: `PascalCase` (`GreetingCard`, `ProfileHeader`).
- Non-composable functions and variables: `camelCase`.
- One primary composable per file for screens; group small related composables.
- Use trailing lambda syntax for content blocks.
- Add `@Preview` composables for all screen-level and complex composables.
- Run `./gradlew ktlintCheck` before committing.
