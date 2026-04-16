# Unified Theme Selector

## What & Why

Currently the IDE has two separate theme controls — a Monaco editor theme dropdown (Dark+, Light+, High Contrast) and a Moon/Sun dark/light toggle for the overall app. These are independent and can cause inconsistent UX (e.g., dark editor with light app shell). The user wants a single unified theme selector with more VS Code-style themes that automatically determines the overall app light/dark mode based on the selected theme.

## Done looks like

- A single theme selector (Select dropdown) in the IDE navbar replaces both the old editor theme dropdown and the Moon/Sun toggle
- The dashboard page uses a similar unified theme selector instead of the Moon/Sun toggle
- Each theme specifies both the Monaco editor theme and whether the app shell is dark or light
- The Moon/Sun toggle is removed from: navbar, dashboard, command palette
- Additional VS Code-style themes are available:
  - Dark themes: Dark+ (default), Monokai, Dracula, GitHub Dark, Solarized Dark, Abyss, Tomorrow Night Blue, One Dark
  - Light themes: Light+, Quiet Light, Solarized Light, GitHub Light, High Contrast Light
  - High Contrast: High Contrast (dark)
- Custom Monaco themes are defined for the new theme options
- Theme choice persists across sessions (localStorage)
- No regressions: code editor, syntax highlighting, notebook, all work with new themes

## Relevant files

- `client/src/components/theme-provider.tsx` — Global theme context; needs to accept unified theme IDs and derive dark/light from them
- `client/src/stores/ide-store.ts` — IDE store theme state (lines 286, 327, 520, 835); needs to use unified theme type
- `client/src/components/ide/navbar.tsx` — Theme selector UI + Moon/Sun toggle (lines 113-133); replace with unified selector, remove toggle
- `client/src/pages/dashboard.tsx` — Moon/Sun toggle (lines 80-89); replace with unified theme selector
- `client/src/components/ide/command-palette.tsx` — Theme toggle command (lines 110-118); remove or replace
- `client/src/components/ide/code-editor.tsx` — Monaco Editor theme prop (line 85); needs to read the Monaco theme from unified config
- `client/src/components/ide/tools-dock.tsx` — Imports useTheme (unused toggle); clean up

## Implementation approach

1. Create a unified theme config map: `Record<ThemeId, { label, monacoTheme, mode: "dark"|"light", defineTheme?: MonacoThemeData }>`
2. Define custom Monaco themes for Monokai, Dracula, GitHub Dark/Light, Solarized, etc. using `monaco.editor.defineTheme()`
3. Update ThemeProvider to accept a themeId and derive dark/light from the config
4. Update IDE store theme type from `"vs-dark"|"vs-light"|"hc-black"` to unified ThemeId
5. Update navbar to show single expanded Select with all themes, remove Moon/Sun button
6. Update dashboard to show unified theme selector, remove Moon/Sun button  
7. Update command palette to cycle through themes or remove toggle command
8. Update code-editor.tsx to look up the Monaco theme from unified config
9. Clean up tools-dock.tsx unused theme imports
