---
title: Expand IDE language support to cover major programming languages
---
---
title: "Expand IDE language support to cover major programming languages"
---

# Expand IDE language support to cover major programming languages

## What & Why
CodeStart IDE currently only recognizes ~8 file extensions for editing and syntax highlighting. Leading online IDEs like Replit support 50+ languages. To make CodeStart more competitive and useful, we need to expand the editor to properly handle many more programming languages — providing correct syntax highlighting, file icons, and language detection for all major languages.

This is purely a frontend editing/display enhancement. The AI agents already generate code in any language — this task makes the editor properly display and highlight that code.

## Done looks like
- Monaco Editor correctly recognizes and applies syntax highlighting for 25+ file extensions
- PrismJS in the Notebook panel highlights code blocks in all supported languages
- File tree shows appropriate icons and colors for all new file types
- The `normalizeLang` mapping in notebook-panel.tsx handles all new languages for Prism
- Everything works seamlessly with existing features (no regressions)

## Implementation Details

### 1. Expand `getFileLanguage()` in `client/src/stores/ide-store.ts`
Add Monaco language IDs for new extensions. Monaco has built-in support for most of these — no packages needed.

Current map (8 entries):
```
html→html, css→css, js/jsx→javascript, ts/tsx→typescript, json→json, md→markdown, py→python
```

Expand to include (Monaco language IDs):
- `.py` → `python` (already exists)
- `.java` → `java`
- `.c`, `.h` → `c`
- `.cpp`, `.cc`, `.cxx`, `.hpp` → `cpp`
- `.cs` → `csharp`
- `.go` → `go`
- `.rs` → `rust`
- `.rb` → `ruby`
- `.php` → `php`
- `.swift` → `swift`
- `.kt`, `.kts` → `kotlin`
- `.r`, `.R` → `r`
- `.lua` → `lua`
- `.pl`, `.pm` → `perl`
- `.sh`, `.bash` → `shell`
- `.sql` → `sql`
- `.yaml`, `.yml` → `yaml`
- `.xml`, `.svg` → `xml`
- `.dart` → `dart`
- `.scala` → `scala`
- `.ex`, `.exs` → `elixir` (Monaco uses plaintext, map to closest)
- `.vue` → `html` (closest Monaco match)
- `.svelte` → `html` (closest Monaco match)
- `.toml` → `plaintext`
- `.ini`, `.cfg` → `ini`
- `.dockerfile`, `Dockerfile` → `dockerfile`
- `.graphql`, `.gql` → `graphql`

### 2. Expand `getFileIcon()` in `client/src/components/ide/file-tree.tsx`
Add icon+color mappings for all new file types. Use lucide-react icons already imported or add minimal new ones. Group by color families:
- **Yellow**: `.js`, `.jsx`, `.py`
- **Blue**: `.ts`, `.tsx`, `.css`, `.go`, `.dart`, `.docker`
- **Orange**: `.html`, `.svelte`, `.vue`, `.rs`, `.swift`, `.kt`
- **Green**: `.json`, `.yaml`, `.yml`, `.xml`, `.toml`
- **Purple**: `.cs`, `.php`, `.graphql`
- **Red**: `.java`, `.rb`, `.scala`
- **Gray**: `.sh`, `.bash`, `.sql`, `.md`, `.txt`
- **Teal**: `.c`, `.cpp`, `.h`, `.hpp`

### 3. Expand PrismJS language loading in `client/src/lib/prism.ts`
Load additional Prism grammar components for notebook syntax highlighting:
- `prism-python`, `prism-java`, `prism-c`, `prism-cpp`, `prism-csharp`
- `prism-go`, `prism-rust`, `prism-ruby`, `prism-php`
- `prism-swift`, `prism-kotlin`, `prism-r`, `prism-lua`, `prism-perl`
- `prism-bash`, `prism-sql`, `prism-yaml`, `prism-xml-doc` (if not covered by markup)
- `prism-dart`, `prism-scala`, `prism-elixir`, `prism-graphql`, `prism-docker`

### 4. Expand `normalizeLang()` in `client/src/components/ide/notebook-panel.tsx`
Map all new language names to their Prism grammar identifiers. This function bridges the AI's language labels to Prism's grammar keys.

Add mappings like:
- `python`/`py` → `python`
- `java` → `java`
- `c` → `c`
- `cpp`/`c++` → `cpp`
- `csharp`/`c#` → `csharp`
- `go`/`golang` → `go`
- `rust`/`rs` → `rust`
- `ruby`/`rb` → `ruby`
- `php` → `php`
- `swift` → `swift`
- `kotlin`/`kt` → `kotlin`
- `bash`/`shell`/`sh` → `bash`
- `sql` → `sql`
- `yaml`/`yml` → `yaml`
- `xml` → `xml`
- `dart` → `dart`
- `scala` → `scala`
- `elixir` → `elixir`
- `graphql`/`gql` → `graphql`
- `docker`/`dockerfile` → `docker`
- `r` → `r`
- `lua` → `lua`
- `perl` → `perl`

## Relevant files
- `client/src/stores/ide-store.ts` — `getFileLanguage()` function
- `client/src/components/ide/file-tree.tsx` — `getFileIcon()` function
- `client/src/lib/prism.ts` — PrismJS language loading
- `client/src/components/ide/notebook-panel.tsx` — `normalizeLang()` function