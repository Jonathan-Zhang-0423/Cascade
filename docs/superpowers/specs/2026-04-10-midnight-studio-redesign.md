# CodeStart — Midnight Studio Redesign Spec
**Date:** 2026-04-10  
**Status:** Approved for implementation  
**Scope:** Pure visual/CSS redesign — zero logic or store changes

---

## 1. Design Direction

**Aesthetic:** Midnight Studio — darker and more refined than the current design. Inspired by Zed editor meets Linear. Serious, focused, developer-native.

**Font:** Geist (single font family, all weights 300–600) for all UI text. Geist Mono for code in the editor. Loaded via Google Fonts.

**Accent:** Electric blue `#4f82ff` with gradient `linear-gradient(135deg, #5585ff, #2a5ce0)` for interactive surfaces. Secondary: indigo `#818cf8` for thinking/planning states, green `#34d68a` for success/writes.

---

## 2. Color Token System

Replace all current hardcoded hex values and HSL variables with this token set:

```css
/* Background layers — true midnight, blue-shifted */
--bg-base:   #06060a;   /* root page background */
--bg-dock:   #080810;   /* tools dock */
--bg-nav:    #08080e;   /* navbar */
--bg-1:      #0c0c14;   /* panels (chat, editor, preview) */
--bg-2:      #101018;   /* tab bars, secondary surfaces */
--bg-3:      #14141e;   /* elevated cards, plan card */
--bg-4:      #1a1a26;   /* input fields, tool buttons */
--bg-5:      #20202e;   /* hover states */

/* Borders */
--border-1:  rgba(255,255,255,0.04);  /* subtle dividers */
--border-2:  rgba(255,255,255,0.07);  /* default panel borders */
--border-3:  rgba(255,255,255,0.11);  /* emphasized borders */

/* Text */
--text-1:    #eeeef6;   /* primary content */
--text-2:    #8888a8;   /* secondary / AI narration */
--text-3:    #484860;   /* muted labels */
--text-4:    #2e2e42;   /* disabled / pending */

/* Accent */
--blue:      #4f82ff;
--blue-dim:  rgba(79,130,255,0.10);
--blue-glow: rgba(79,130,255,0.28);
--indigo:    #818cf8;
--indigo-dim: rgba(129,140,248,0.08);
--green:     #34d68a;
--green-dim: rgba(52,214,138,0.08);
--red:       #f87171;

/* Typography */
--font-ui:   'Geist', system-ui, sans-serif;
--font-mono: 'Geist Mono', 'Menlo', monospace;  /* editor code only */

/* Radii */
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 9px;
--radius-xl: 12px;
```

**File:** `client/src/index.css` — replace the existing `:root` / `.dark` variable blocks. Add Geist font import via `@import` or `<link>` in `index.html`.

---

## 3. Component Changes

### 3.1 Navbar (`client/src/components/ide/navbar.tsx`)

| Element | Current | New |
|---|---|---|
| Container bg | `bg-[#111114]` | `bg-[#08080e]` (use `--bg-nav`) |
| Container border | `border-b border-border` | `border-b border-[--border-2]` |
| Container height | `h-11` (44px) | `h-11` — keep |
| Back button | `bg-muted border-border` | `bg-[--bg-1] border-[--border-2]`, `hover:bg-[--bg-3]` |
| Emoji badge | `bg-muted border-border` | same pattern — `bg-[--bg-1] border-[--border-2]` |
| Project name | `text-sm font-semibold` | `text-[13px] font-semibold tracking-[-0.02em]` |
| Framework label | `text-[11px] text-muted-foreground/60` | `text-[11px] text-[--text-2]` |
| Eye/toggle button | `bg-accent` active, `hover:bg-muted/50` | `bg-[--bg-1] border-[--border-2]`, active: `bg-[--blue-dim] border-[--blue]/20 text-[--blue]` |
| Theme select | existing trigger styles | `h-[26px] text-[11px] bg-[--bg-1] border-[--border-2]` |
| Run button | `from-blue-600 to-blue-700 shadow-[0_1px_3px_...]` | `bg-gradient-to-br from-[#5585ff] to-[#2a5ce0] shadow-[0_1px_10px_rgba(79,130,255,0.42),inset_0_1px_0_rgba(255,255,255,0.13)]` |

### 3.2 Tools Dock (`client/src/components/ide/tools-dock.tsx`)

| Element | Current | New |
|---|---|---|
| Container bg | `bg-[#0f0f12]` | `bg-[#080810]` (use `--bg-dock`) |
| Container border | none | `border-r border-[--border-1]` |
| Inactive btn | `opacity-25` | `opacity-[0.18]`, `hover:opacity-55` |
| Active btn bg | `bg-[#1e2940]` | `bg-[#141d34]` |
| Active btn ring | `ring-1 ring-primary/20` | `ring-1 ring-[--blue]/18` |
| Active btn glow | `drop-shadow(0 0 4px rgba(59,130,246,0.5))` | `drop-shadow(0 0 5px rgba(79,130,255,0.40))` |
| Monitor badge | `bg-emerald-500` | `bg-[#22c55e]` — same, keep |

### 3.3 Chat Panel + Chat Input (`client/src/components/ide/chat-panel.tsx`, `ChatInputArea.tsx`)

**Panel container:** `bg-[--bg-1] border border-[--border-1] rounded-[--radius-lg]`

**Chat header:** `h-[34px] px-[11px] border-b border-[--border-1] text-[11px] font-medium text-[--text-2]`

**User message bubble:**
- bg: `bg-[#141e36]`
- border: `border border-[rgba(79,130,255,0.14)]`
- border-radius: `rounded-[--radius-lg] rounded-br-[2px]`
- font: `text-[11px] text-[--text-1]`

**AI message:**
- `text-[11px] text-[--text-2] leading-[1.65]`

**Chat input box (`ChatInputArea.tsx`):**
- Remove outer rounded bordered box
- Textarea: `text-[13px] bg-transparent border-0 shadow-none px-3 pt-3 pb-1`
- Toolbar row: stays as-is but send button gets gradient treatment
- Send button: `bg-gradient-to-br from-[#5585ff] to-[#2a5ce0] shadow-[0_1px_6px_rgba(79,130,255,0.30),inset_0_1px_0_rgba(255,255,255,0.12)]`
- Focus ring on container: `ring-2 ring-[--blue]/40 border-[--blue]`

### 3.4 Plan Card (`client/src/components/ide/chat/plan-components.tsx`)

**Card container:** `bg-[--bg-3] border border-[--border-2] rounded-[--radius-md]`

**Header:**
- Progress row: `"Plan · N of M"` label in `text-[9px] font-semibold text-[--blue] uppercase tracking-[0.06em]`
- Percentage: `text-[9px] text-[--text-3]`
- Plan title: `text-[13px] font-semibold text-[--text-1] tracking-[-0.01em]`
- Progress bar track: `h-[2px] bg-[--border-2] rounded-full`
- Progress bar fill: `bg-gradient-to-r from-[--blue] to-[--indigo]`

**Step rows:**
- Done dot: `w-[16px] h-[16px] rounded-full bg-[#1a5e3a] border border-[rgba(52,214,138,0.25)]` with SVG checkmark `stroke="#34d68a"`
- Running dot: `w-[16px] h-[16px] rounded-full border-2 border-[--blue] bg-[#0d1422]` with inner filled dot
- Pending dot: `w-[16px] h-[16px] rounded-full border border-[--border-2]`
- Connector line between dots: `w-[1px] h-[18px] bg-[--border-2]`
- Running row highlight: `bg-[#121a2e] rounded-[7px] mx-[-8px] px-[8px]`
- Done step text: `text-[12px] text-[--text-3]`
- Running step text: `text-[12px] font-medium text-[--text-1]`
- Pending step text: `text-[12px] text-[--text-4]`
- Running sub-label (e.g. "Writing store.ts..."): `text-[11px] text-[--blue]`

### 3.5 Action Log (`client/src/components/ide/chat/action-log.tsx` or inline)

**Thinking row:**
- `bg-[--indigo-dim] border border-[rgba(129,140,248,0.12)] rounded-[--radius-md] px-[10px] py-[6px]`
- Text: `text-[12px] text-[--indigo] font-medium`
- Animated dots: 3× `w-[4px] h-[4px] rounded-full bg-[--indigo]` with staggered opacity

**Read row (collapsed):**
- No background, `px-[8px] py-[5px]`
- Icon + `text-[12px] text-[--text-3]`
- File list: `text-[11px] text-[--text-4] ml-auto`

**Write row:**
- `bg-[--green-dim] border-l-2 border-[--green] rounded-r-[--radius-sm] px-[10px] py-[5px]`
- Filename: `text-[12px] font-medium text-[#4ddc96] font-mono`
- Status badge: `text-[11px] text-[#2a7a4e]`

### 3.6 Build Completion Card

**Container:** `bg-[#0a150e] border border-[rgba(52,214,138,0.10)] rounded-[--radius-lg]`

**Title row:**
- Checkmark circle: `w-[22px] h-[22px] rounded-full bg-[#1a6640] border border-[rgba(52,214,138,0.25)]`
- "Done" text: `text-[14px] font-semibold text-[#5fe8a0] tracking-[-0.01em]`

**Summary:** `text-[13px] text-[--text-2] leading-[1.6]`

**File pills:** `bg-[rgba(52,214,138,0.06)] border border-[rgba(52,214,138,0.12)] rounded-[--radius-sm] px-[8px] py-[3px] text-[11px] font-mono text-[#4ade80]`

**Footer:** `text-[12px] text-[--text-3] border-t border-[rgba(52,214,138,0.06)] px-[16px] py-[10px]` — "What should we build next?"

### 3.7 Preview Panel Toolbar (`client/src/components/ide/preview-panel.tsx`)

**Container:** `h-[38px] px-2 border-b border-[--border-2] bg-[--bg-2]` — keep height

**Framework badge:** `text-[11px] font-medium px-[6px] py-[1px] rounded border` — keep existing `getFrameworkColor()` logic, just update base background to `--bg-1`

**Platform toggle pill:**
- Container: `bg-[--bg-3] border border-[--border-2] rounded-[6px] p-[2px] gap-[1px]`
- Active btn: `bg-[rgba(255,255,255,0.08)] text-[--text-1] rounded-[4px]`
- Inactive btn: `text-[--text-3] hover:text-[--text-2]`

**All icon buttons (rotate, theme, QR, refresh, console):**
- Unified: `h-[26px] w-7 rounded-[--radius-md] bg-[--bg-3] border border-[--border-2] text-[--text-3] hover:text-[--text-2] hover:bg-[--bg-4]`
- Active (console open): `bg-[--blue-dim] border-[--blue]/20 text-[--blue]`

### 3.8 Device Frame (`client/src/components/ide/device-simulator.tsx`)

**Phone frame (dark style):**
- `background: linear-gradient(160deg, #2a2a30, #0d0d10)`
- `border: 1.5px solid #383840`
- `box-shadow: 0 4px 24px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.06)`
- Side buttons: `width: 2px`, `background: #38383e`
- Home bar: `background: rgba(255,255,255,0.14)` (was `#444`)
- Dynamic Island: add pill `width: 24px height: 8px bg-black rounded-full` for iPhone 14+ models

---

## 4. Typography Scale

All text uses Geist. No text below 11px in the UI.

| Size | Weight | Use |
|---|---|---|
| 14px / 600 | semibold | Chat input placeholder, user messages |
| 13px / 400 | regular | AI narration, primary content, leading-[1.65] |
| 12px / 400 | regular | Action log entries, step titles, secondary UI |
| 11px / 500 | medium | Metadata, labels, timestamps, framework badges |
| 10px / 400 | regular | Line numbers, step counts (Geist Mono in editor only) |

---

## 5. Files to Change

| File | Changes |
|---|---|
| `client/src/index.css` | Replace all CSS variables with new token set; add Geist font import |
| `client/index.html` | Add Google Fonts `<link>` for Geist + Geist Mono |
| `client/src/components/ide/navbar.tsx` | Update all bg/border/button classes per §3.1 |
| `client/src/components/ide/tools-dock.tsx` | Update dock bg, active/inactive states per §3.2 |
| `client/src/components/ide/chat-panel.tsx` | Update panel bg, header, bubble styles per §3.3 |
| `client/src/components/ide/chat/ChatInputArea.tsx` | Update input box, send button per §3.3 |
| `client/src/components/ide/chat/plan-components.tsx` | Full plan card restyle per §3.4 |
| `client/src/components/ide/chat/action-log.tsx` | Update thinking/read/write rows per §3.5 |
| `client/src/components/ide/chat/ChatMessageList.tsx` | Update build completion card per §3.6 |
| `client/src/components/ide/preview-panel.tsx` | Update toolbar, badges, icon buttons per §3.7 |
| `client/src/components/ide/device-simulator.tsx` | Update phone frame styles per §3.8 |

**Constraint:** Zero changes to TypeScript logic, state, hooks, or stores. CSS/Tailwind classes only.

---

## 6. Non-Goals

- No changes to layout structure (column widths, panel arrangement)
- No new components or features
- No changes to routing, stores, or API
- No changes to light mode (app appears to be dark-mode primary)
- No animation additions beyond what's already present
