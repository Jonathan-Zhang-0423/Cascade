import type { Framework } from "../../compiler/framework-detector";

export type AgentRole = "manager" | "editor" | "verifier" | "communicator";

const MOBILE_FRAMEWORKS: Framework[] = ["rn-expo", "flutter", "swiftui", "kotlin", "wechat"];

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

  wechat: `
## WeChat Mini Program Planning
- Think in terms of **pages** (not web pages). Each page lives in its own folder under \`pages/\` with four files: \`.wxml\`, \`.wxss\`, \`.js\`, \`.json\`.
- ALL pages must be registered in \`app.json\` under the \`"pages"\` array — the first entry is the launch page.
- Plan navigation using \`wx.navigateTo\` (push), \`wx.redirectTo\` (replace), \`wx.navigateBack\` (pop), or \`wx.switchTab\` (tab bar).
- Use \`rpx\` units for all sizes — 750rpx equals the full screen width on any device.
- Plan data flow using page \`data\` + \`this.setData()\` — this is the only way to update the view.
- Consider WeChat-specific UX patterns: pull-to-refresh (\`enablePullDownRefresh\`), tab bar (\`tabBar\` in app.json), loading states (\`wx.showLoading\`), toast feedback (\`wx.showToast\`).
- Use \`wx.request\` for all HTTP calls — no fetch or XMLHttpRequest.
- Custom components live in a \`components/\` folder and must be registered in the page's \`.json\` file.
- Plan file structure: \`app.js\`, \`app.json\`, \`app.wxss\` at root; pages in \`pages/<name>/<name>.{wxml,wxss,js,json}\`.`,
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

  wechat: `
## WeChat Mini Program Development Rules
- WXML uses XML syntax — all tags must be properly closed. Never use bare HTML elements (div, span, p, etc.).
- Core layout components: \`<view>\` (block container), \`<text>\` (inline text — only component that can directly wrap text nodes), \`<image>\` (images), \`<scroll-view>\` (scrollable area), \`<swiper>\` (carousel).
- Form components: \`<input>\`, \`<textarea>\`, \`<button>\`, \`<checkbox>\`, \`<radio>\`, \`<picker>\`, \`<switch>\`, \`<slider>\`.
- Navigation: \`<navigator url="/pages/detail/detail">\` in WXML, or \`wx.navigateTo({ url: '/pages/detail/detail' })\` in JS.
- Always use \`rpx\` for sizes — 750rpx is full width. Do NOT use px, em, rem, %, or vw in WXSS.
- Data binding: \`{{ variableName }}\` in WXML, updated only via \`this.setData({ key: value })\` in JS.
- List rendering: \`<view wx:for="{{ list }}" wx:key="id">\` — always provide \`wx:key\`.
- Conditionals: \`wx:if\`, \`wx:elif\`, \`wx:else\` on elements.
- Event binding: \`bindtap\`, \`bindinput\`, \`bindchange\` — handler name only, no parentheses: \`bindtap="handleTap"\`.
- HTTP requests: \`wx.request({ url, method, data, success, fail })\` — no fetch/axios.
- Storage: \`wx.setStorageSync(key, value)\` / \`wx.getStorageSync(key)\` for simple sync access.
- Every new page must be added to the \`"pages"\` array in \`app.json\` or it won't be accessible.
- Custom components: define in \`components/<name>/\`, register in page's \`.json\` as \`{ "usingComponents": { "my-comp": "/components/name/name" } }\`.
- Page lifecycle: \`onLoad(options)\`, \`onShow()\`, \`onReady()\`, \`onHide()\`, \`onUnload()\`.
- WXSS global styles go in \`app.wxss\`; page-specific styles in the page's \`.wxss\` file.`,
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

  wechat: `
## WeChat Mini Program Checks
- Verify every page referenced via \`wx.navigateTo\` / \`<navigator>\` is registered in \`app.json\` pages array.
- Check all WXML tags are properly closed (XML rules, not HTML5 rules).
- Verify no bare HTML elements are used — only WXML components (view, text, image, etc.).
- Verify all sizes use \`rpx\` — flag any use of px/em/rem/vw in WXSS.
- Check all \`wx:for\` loops have a \`wx:key\` attribute.
- Verify event handlers use \`bind*\` prefix and reference method names only (no inline expressions).
- Check \`this.setData()\` is used — never directly mutate \`this.data\`.
- Verify \`wx.request\` is used for HTTP (not fetch/axios/XHR).
- Check that custom components are declared in the page's \`.json\` \`usingComponents\` before use.
- Verify page JS files export a valid \`Page({...})\` call and app root exports \`App({...})\`.`,
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

  wechat: `
## Mini Program Vocabulary (WeChat)
When narrating WeChat Mini Program development:
- Say "mini program" or "小程序" — not "website" or "app".
- Say "page" for each screen in the mini program (WeChat uses "page", not "screen").
- Say "tap" instead of "click" — users tap on mobile.
- Say "WXML" when referring to the markup/template layer.
- Say "WXSS" when referring to the style layer.
- Say "the page's data" when referring to state managed via setData.
- Say "navigate to" when moving between pages.`,
};

const supplementsByRole: Record<AgentRole, Record<string, string>> = {
  manager: managerSupplements,
  editor: editorSupplements,
  verifier: verifierSupplements,
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
