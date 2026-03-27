import type { Framework } from "./framework-detector";

export type AgentRole = "manager" | "editor" | "verifier" | "mentor" | "communicator";

const MOBILE_FRAMEWORKS: Framework[] = ["rn-expo", "flutter", "swiftui", "kotlin"];

export function isMobileFramework(framework: Framework): boolean {
  return MOBILE_FRAMEWORKS.includes(framework);
}

const managerSupplements: Record<string, string> = {
  "rn-expo": `
## Mobile-Specific Planning (React Native / Expo)
- Think in terms of **screens** (not pages). Each screen is a component rendered by the navigator.
- Plan navigation flows using stack, tab, or drawer navigators from React Navigation.
- When the user describes moving between views, model this as screen transitions with navigation actions (push, pop, navigate).
- Account for platform differences: iOS and Android may need different styling (safe areas, status bar, shadows vs elevation).
- Consider native API access: camera, location, notifications, and storage all require permission requests — include permission setup steps in the plan.
- Mobile UX patterns to consider: pull-to-refresh, swipe gestures, bottom sheets, action sheets, haptic feedback.
- Plan file structure with screens in \`src/screens/\` and shared components in \`src/components/\`.`,

  flutter: `
## Mobile-Specific Planning (Flutter)
- Think in terms of **screens** (not pages). Each screen is a widget navigated to via the Navigator or GoRouter.
- Plan navigation flows using Navigator.push/pop or named routes.
- Account for Material (Android) vs Cupertino (iOS) widget choices if the app needs platform-native look.
- Consider the widget tree hierarchy — plan how state flows from parent to child widgets.
- Native API access (camera, location, notifications) requires permissions declared in platform manifests — include setup steps.
- Mobile UX patterns to consider: pull-to-refresh, swipe-to-dismiss, bottom sheets, snack bars, floating action buttons.
- Plan file structure with screens in \`lib/screens/\` and shared widgets in \`lib/widgets/\`.`,

  swiftui: `
## Mobile-Specific Planning (SwiftUI)
- Think in terms of **views** (not pages). Each screen is a SwiftUI View struct.
- Plan navigation flows using NavigationStack, NavigationLink, TabView, and sheet modifiers.
- Consider data flow patterns: @State for local, @StateObject/@ObservedObject for shared, @EnvironmentObject for app-wide data.
- iOS-specific considerations: safe areas, Dynamic Type support, dark mode, system colors.
- Native API access (camera, location, notifications) requires Info.plist permission descriptions — include these in the plan.
- Mobile UX patterns to consider: swipe actions on lists, pull-to-refresh, context menus, haptic feedback, share sheets.
- Plan file structure with views in \`Views/\` and view models in \`ViewModels/\`.`,

  kotlin: `
## Mobile-Specific Planning (Kotlin / Jetpack Compose)
- Think in terms of **screens** (not pages). Each screen is a composable function rendered by the NavHost.
- Plan navigation flows using NavHost with composable route definitions.
- Use Material Design 3 components and theming for consistent Android UI.
- Consider state management: remember/mutableStateOf for local state, ViewModel + StateFlow for screen state.
- Native API access (camera, location, notifications) requires AndroidManifest permissions and runtime permission requests — include these steps.
- Mobile UX patterns to consider: pull-to-refresh, swipe-to-dismiss, bottom sheets, snack bars, FABs.
- Plan file structure with screens in \`ui/screens/\` and components in \`ui/components/\`.`,
};

const editorSupplements: Record<string, string> = {
  "rn-expo": `
## Mobile Development Rules (React Native / Expo)
- Use React Native components (View, Text, ScrollView, FlatList, Pressable) — never use HTML elements.
- Use \`StyleSheet.create()\` for styles — not CSS files. Flexbox defaults to column direction.
- Wrap screens in \`SafeAreaView\` or use \`useSafeAreaInsets()\` to avoid notch/status-bar overlap.
- Use \`onPress\` (not \`onClick\`) for touch handlers.
- Provide \`keyExtractor\` on all FlatList components.
- Request permissions before accessing camera, location, or notifications.
- Use Platform.OS or Platform.select() for platform-specific code.`,

  flutter: `
## Mobile Development Rules (Flutter)
- Build UI with widgets — everything is a widget (StatelessWidget or StatefulWidget).
- Use \`Column\`, \`Row\`, \`Stack\` for layout. Wrap children in \`Expanded\` or \`Flexible\` as needed.
- Use \`Scaffold\` for standard screen structure with AppBar, body, FAB, and bottom navigation.
- Use \`ListView\` or \`GridView\` for scrollable lists. Set \`shrinkWrap: true\` if nested inside another scrollable.
- Call \`setState()\` to trigger UI rebuilds after state changes.
- Declare assets (images, fonts) in \`pubspec.yaml\` under the flutter section.
- Use trailing commas in widget trees for proper formatting.`,

  swiftui: `
## Mobile Development Rules (SwiftUI)
- Build UI with View structs. Each view's \`body\` returns a view hierarchy.
- Apply modifiers in chains — order matters (\`.padding().background()\` vs \`.background().padding()\`).
- Use \`VStack\`, \`HStack\`, \`ZStack\` for layout. Use \`Spacer()\` to distribute space.
- Use \`@State\` for local state, \`@Binding\` for child-to-parent state, \`@StateObject\` for observable objects.
- Use \`NavigationStack\` and \`NavigationLink\` for navigation.
- Use \`List\` and \`ForEach\` for data-driven lists — provide an \`id\` key path.
- Handle safe areas automatically — use \`.ignoresSafeArea()\` only when intentionally extending behind system UI.`,

  kotlin: `
## Mobile Development Rules (Kotlin / Jetpack Compose)
- Build UI with @Composable functions. Keep composables small and focused.
- Use \`Column\`, \`Row\`, \`Box\` for layout. Use \`Modifier\` chains for sizing and spacing.
- Use \`Scaffold\` for standard screen structure (TopAppBar, content, FAB, BottomBar).
- Use \`LazyColumn\` / \`LazyRow\` for scrollable lists — never nest scrollable containers.
- Use \`remember { mutableStateOf() }\` for local state. Use ViewModel + StateFlow for screen-level state.
- Accept \`modifier: Modifier = Modifier\` as the first optional parameter on reusable composables.
- Use Material Design 3 components and \`MaterialTheme\` for consistent theming.`,
};

const verifierSupplements: Record<string, string> = {
  "rn-expo": `
## Mobile-Specific Checks (React Native / Expo)
- Verify screens are wrapped in SafeAreaView or use useSafeAreaInsets() to avoid status bar/notch overlap.
- Check that all interactive elements use accessibility labels (accessibilityLabel prop).
- Verify touch targets are at least 44×44 points for accessibility.
- Check for keyboard avoidance on screens with text inputs (KeyboardAvoidingView or similar).
- Verify platform-specific code uses Platform.OS or Platform.select() correctly.
- Check that permissions are requested before using camera, location, notifications, etc.
- Verify FlatList components have keyExtractor and no nested scrollable containers.
- Ensure no HTML elements (div, span, p) are used — only React Native components.`,

  flutter: `
## Mobile-Specific Checks (Flutter)
- Verify Scaffold is used for standard screen structure.
- Check that all interactive elements have semantic labels for accessibility (Semantics widget or semanticsLabel).
- Verify touch targets meet minimum size guidelines (48×48 dp).
- Check for keyboard handling — text fields should scroll into view when keyboard appears.
- Verify ListView/GridView inside Column use Expanded or shrinkWrap to avoid unbounded height.
- Check that assets (images, fonts) are declared in pubspec.yaml.
- Verify proper use of const constructors for performance.
- Check that BuildContext is not used after async gaps without checking mounted.`,

  swiftui: `
## Mobile-Specific Checks (SwiftUI)
- Verify views handle safe areas correctly — content shouldn't overlap notch or home indicator unless intentional.
- Check that all interactive elements have accessibility labels (.accessibilityLabel modifier).
- Verify touch targets are at least 44×44 points.
- Check for keyboard avoidance on forms — text fields should remain visible when keyboard appears.
- Verify correct use of property wrappers: @State for local, @StateObject for owned objects, @ObservedObject for passed objects.
- Check that ForEach uses identifiable data or provides an id key path.
- Verify navigation uses NavigationStack (not deprecated NavigationView on iOS 16+).
- Check modifier ordering for correctness (e.g., .padding() before .background() vs after).`,

  kotlin: `
## Mobile-Specific Checks (Kotlin / Jetpack Compose)
- Verify Scaffold is used for standard screen structure.
- Check that all interactive elements have content descriptions for accessibility (contentDescription parameter).
- Verify touch targets are at least 48×48 dp.
- Check for keyboard handling — text fields should scroll into view when keyboard appears.
- Verify composable state uses remember {} to survive recomposition.
- Check that LazyColumn/LazyRow are not nested inside other scrollable containers.
- Verify reusable composables accept a modifier parameter.
- Check that runtime permissions are requested before accessing camera, location, or storage.
- Verify MaterialTheme is used for colors and typography instead of hardcoded values.`,
};

const mentorSupplements: Record<string, string> = {
  "rn-expo": `
## Mobile Concepts to Teach (React Native / Expo)
When explaining this mobile project, use these beginner-friendly concepts:
- **Screens** instead of "pages" — a mobile app has screens you navigate between, like flipping through cards.
- **Navigation stack** — think of screens as a stack of cards; you push a new card on top and pop it to go back.
- **Components** — React Native uses its own building blocks (View, Text, Pressable) instead of HTML tags.
- **Safe areas** — the areas of the screen not blocked by the notch, status bar, or home indicator.
- **Gestures** — tapping, swiping, and pinching that users do with their fingers.
- **Permissions** — the app has to ask the user before using the camera, location, or sending notifications.
- **App lifecycle** — the app can be in the foreground (active), background (hidden), or terminated (closed).`,

  flutter: `
## Mobile Concepts to Teach (Flutter)
When explaining this mobile project, use these beginner-friendly concepts:
- **Widgets** — everything you see on screen is a widget. Widgets are like building blocks that snap together.
- **Widget tree** — widgets are nested inside each other like a family tree, creating the layout.
- **Screens** instead of "pages" — each screen is a widget you navigate to.
- **State** — data that can change (like a score or a text input). When state changes, the widget rebuilds.
- **Scaffold** — a ready-made screen layout with a top bar, body area, and optional floating button.
- **Permissions** — the app must ask before using the camera, location, or notifications.
- **Hot reload** — Flutter can update the app almost instantly while you're developing, without restarting it.`,

  swiftui: `
## Mobile Concepts to Teach (SwiftUI)
When explaining this mobile project, use these beginner-friendly concepts:
- **Views** — everything on screen is a View. Views are like LEGO pieces you stack and combine.
- **Modifiers** — instructions chained onto a view to change how it looks (color, size, padding).
- **Stacks** — VStack (vertical), HStack (horizontal), and ZStack (layered) arrange views on screen.
- **State** — data that the view watches. When state changes, the view automatically updates.
- **Navigation** — moving between screens using links, like tapping a menu item to see a detail page.
- **Safe areas** — the screen regions not blocked by the notch or home bar. SwiftUI handles this automatically.
- **Permissions** — the app must explain to the user why it needs access to camera, photos, or location.`,

  kotlin: `
## Mobile Concepts to Teach (Kotlin / Jetpack Compose)
When explaining this mobile project, use these beginner-friendly concepts:
- **Composables** — functions that describe what the screen should look like. They're the building blocks of the UI.
- **Screens** instead of "pages" — each screen is a composable function.
- **State** — data that can change (like a counter or text input). When state changes, the composable redraws.
- **Material Design** — a design system by Google that provides ready-made buttons, cards, menus, and color themes.
- **Scaffold** — a ready-made screen layout with a top bar, content area, and floating action button.
- **Navigation** — moving between screens using a navigation controller, like following links.
- **Permissions** — the app has to ask the user before accessing the camera, location, or files.`,
};

const communicatorSupplements: Record<string, string> = {
  "rn-expo": `
## Mobile Vocabulary (React Native / Expo)
When narrating mobile app development:
- Say "screen" instead of "page" — mobile apps have screens, not web pages.
- Say "the app" instead of "the website" or "the browser".
- Say "tap" instead of "click" — users tap with their fingers on mobile.
- Say "swipe" when describing gesture interactions.
- Say "the app will ask for permission" when camera/location/notification access is being set up.
- Say "navigation" when moving between screens — "like flipping between cards".`,

  flutter: `
## Mobile Vocabulary (Flutter)
When narrating mobile app development:
- Say "screen" instead of "page" — mobile apps have screens, not web pages.
- Say "the app" instead of "the website" or "the browser".
- Say "tap" instead of "click" — users tap with their fingers on mobile.
- Say "widget" when describing a UI building block — "each piece of the screen is called a widget".
- Say "the app will ask for permission" when camera/location/notification access is being set up.
- Say "navigation" when moving between screens.`,

  swiftui: `
## Mobile Vocabulary (SwiftUI)
When narrating mobile app development:
- Say "screen" or "view" instead of "page" — iOS apps have views, not web pages.
- Say "the app" instead of "the website" or "the browser".
- Say "tap" instead of "click" — users tap with their fingers on mobile.
- Say "the app will ask for permission" when camera/location/notification access is being set up.
- Say "navigation" when moving between screens — "like stepping through a series of cards".
- Say "modifier" when describing visual changes — "we're adding instructions to change how it looks".`,

  kotlin: `
## Mobile Vocabulary (Kotlin / Jetpack Compose)
When narrating mobile app development:
- Say "screen" instead of "page" — Android apps have screens, not web pages.
- Say "the app" instead of "the website" or "the browser".
- Say "tap" instead of "click" — users tap with their fingers on mobile.
- Say "the app will ask for permission" when camera/location/notification access is being set up.
- Say "navigation" when moving between screens.
- Say "composable" when describing a UI building block — "a piece of the screen that the app draws".`,
};

const supplementsByRole: Record<AgentRole, Record<string, string>> = {
  manager: managerSupplements,
  editor: editorSupplements,
  verifier: verifierSupplements,
  mentor: mentorSupplements,
  communicator: communicatorSupplements,
};

export function getMobilePromptSupplement(
  role: AgentRole,
  framework: Framework,
): string | null {
  if (!isMobileFramework(framework)) return null;
  const roleSupplements = supplementsByRole[role];
  if (!roleSupplements) return null;
  return roleSupplements[framework] ?? null;
}
