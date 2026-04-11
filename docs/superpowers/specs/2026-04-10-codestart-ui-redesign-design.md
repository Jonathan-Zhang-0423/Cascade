# CodeStart UI/UX Redesign — Design Spec
**Date:** 2026-04-10  
**Scope:** Full Visual Overhaul (Option C)  
**Theme:** Adaptive — dark mode premium (Vercel/Linear/Raycast), light mode crisp (Notion/Figma)  
**Audience:** Students, indie devs, non-technical founders  
**Constraint:** No emoji anywhere in the UI

---

## Context

CodeStart is an AI-powered IDE for building mobile apps. The current UI is functional but has accumulated visual debt: sub-11px text throughout the chat, zeroed-out shadows, inconsistent border weights, flat interactive states with no hover feedback, and an action log that gives every event equal visual weight. The goal of this redesign is to elevate the UI to feel production-grade without changing any logic or store structure.

---

## Section 1 — Foundation: Tokens & Animations

### 1A — Typography Scale

All text below 11px is eliminated. Minimum sizes:

| Role | Size |
|---|---|
| Metadata, timestamps, labels | 11px |
| Secondary text, log entries | 12px |
| Primary content, narration, messages | 13px |
| Inputs, chat messages | 14px |

**Implementation:** Update Tailwind class names in-place on each component. No CSS vars needed for typography — Tailwind classes are the source of truth.

### 1B — Shadow & Elevation

All `--shadow-*` CSS variables are currently `0px 2px 0px 0px hsl(0 0% 0% / 0.00)`. Replace with:

**Dark mode:**
- Level 1 (cards, panels): `0 1px 2px rgba(0,0,0,0.4)`
- Level 2 (popovers, dropdowns): `0 4px 12px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.3)`
- Level 3 (modals, command palette): `0 8px 24px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4)`

**Light mode:**
- Level 1: `0 1px 3px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)`
- Level 2: `0 4px 12px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06)`
- Level 3: `0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08)`

**File:** `index.css` — update `:root` and `.dark` blocks.

### 1C — Transition Tokens

Add to `index.css`:

```css
--transition-fast:   100ms ease;       /* hover states, icon swaps */
--transition-base:   150ms ease;       /* button presses, tab switches */
--transition-slow:   250ms ease;       /* panel reveals, card expansions */
--transition-spring: 200ms cubic-bezier(0.34, 1.56, 0.64, 1); /* step completion pop */
```

Replace ad-hoc `duration-200` / `transition-all` usages in components with these vars.

### 1D — Keyframe Animations

Add to `index.css`:

```css
@keyframes step-complete {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.25); box-shadow: 0 0 0 6px rgba(22,163,74,0.2); }
  100% { transform: scale(1); box-shadow: none; }
}

@keyframes file-flash {
  0%   { background: #0d1829; border-left-color: #3b82f6; }
  100% { background: #0d1f12; border-left-color: #22c55e; }
}

@keyframes fade-up {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}
```

### 1E — Border Radius

Existing `--radius: 0.5rem` (8px) stays. Use existing Tailwind scale for consistency:
- `rounded-sm` (4px) — badges, chips, code labels
- `rounded-md` (6px) — buttons, icon buttons
- `rounded-lg` (8px) — cards, panels
- `rounded-xl` (12px) — modals, popovers
- `rounded-full` — pills, avatars

No new classes needed.

**Files:** `index.css`, `tailwind.config.ts`

---

## Section 2 — IDE Shell: Navbar, Tools Dock & Layout

### 2A — Navbar

**File:** `client/src/components/ide/navbar.tsx`

| Property | Before | After |
|---|---|---|
| Height | `h-10` (40px) | `h-11` (44px) |
| Background | `bg-sidebar` | `bg-[#111114]` (dark) |
| Bottom border | `border-b border-border/50` | `border-b border-border` |
| Back button | bare `<ChevronLeft>` | icon button: 28×28px, `rounded-md`, `bg-muted`, bordered |
| Project name | emoji + name together | icon box (22×22) + name + separator + framework label |
| Layout toggle | right cluster | **center** of navbar |
| Theme selector | `w-[150px]` Select | compact pill, current theme name only |
| Run button | `bg-blue-600 h-7` | `bg-gradient-to-br from-blue-600 to-blue-700 h-[30px]`, subtle box-shadow |

Framework label (e.g. "React Native") shown at 11px muted color next to project name, separated by a dot.

### 2B — Tools Dock

**File:** `client/src/components/ide/tools-dock.tsx`

- Width stays `w-11` (44px)
- Background: `bg-[#0f0f12]` — slightly darker than sidebar for depth
- Remove `border-r` — background contrast replaces it
- **Active state**: Replace left-border strip (`absolute left-0 w-0.5 bg-primary`) with:
  - Container: `bg-[#1e2940]`, `ring-1 ring-primary/20`
  - Icon: `filter: drop-shadow(0 0 4px rgba(59,130,246,0.5))`
- **Inactive icons**: opacity ~25% at rest, 70% on hover, `transition: var(--transition-fast)`
- Icon size stays `w-[18px] h-[18px]`
- LLM Monitor badge: `text-[10px]` (up from `text-[9px]`), stays `rounded-full bg-emerald-500`

### 2C — Panel Borders & Dividers

Unified border weight system across all panels:
- **Panel dividers** (between major regions): `border-border` — full opacity, 1px
- **Inner card borders**: `border-border/60`
- **Decorative separators**: `border-border/30`
- **ResizeHandle hover state**: subtle blue tint (`hover:bg-primary/10`) on drag target

---

## Section 3 — Chat & Agent Interface

### 3A — Plan Card

**File:** `client/src/components/ide/chat/plan-components.tsx`

Header changes:
- Add progress bar: `h-[2px]` track, `bg-gradient-to-r from-blue-500 to-indigo-500` fill, width = `(completed/total * 100)%`
- Progress label: `"Plan · N of M"` in `text-[11px] text-primary font-semibold uppercase tracking-wide`
- Percentage shown right-aligned at 11px muted

Step list changes:
- Add connector line between steps: `w-px h-[18px] bg-border` centered under each status dot (except last)
- **Done steps**: green filled circle with SVG checkmark, label color `text-muted-foreground` (no strikethrough)
- **Running step**: blue ring + filled dot, row gets `bg-[#1e2940]` tinted background spanning full width, sub-label shows current action (e.g. "Writing store.ts...")
- **Pending steps**: empty circle `border border-border/40`, label `text-muted-foreground/30` (very muted)
- Status dot size: 16×16px (up from 14×14px)

### 3B — Chat Message Bubbles

**File:** `client/src/components/ide/chat/message-components.tsx`

Layout and structure **unchanged** — keep existing bubble design.

Only changes:
- Message font size: `text-[11px]` → `text-[13px]` for both user and AI messages
- AI narration line height: `leading-[1.65]`
- No avatar, no icon added

### 3C — Action Log

**File:** `client/src/components/ide/chat/action-log.tsx`

- Consecutive read operations collapsed into a single "Read N files" row; filenames shown as dimmed secondary text
- File write rows: `border-l-2 border-green-500 bg-[#0d1f12]`, filename in `text-green-400 font-medium`, status label right-aligned
- New file write rows: `animation: file-flash 600ms ease-out` on mount (blue → green transition)
- Thinking row: `bg-[#1a1a2e] border border-indigo-900/50`, label `text-indigo-400 font-medium`, animated dot trio
- All icons: SVG, 12×12px, monochrome — no emoji
- Row padding: `py-[5px]` (from 4px)
- Font size: `text-[12px]` throughout

### 3D — Build Completion Card

**File:** `client/src/components/ide/chat/message-components.tsx` (`BuildCompletionCard`)

- Remove gradient header background
- Add summary sentence above file list at `text-[13px] text-slate-300` — this is the existing `summary` prop already passed to `BuildCompletionCard`
- Files shown as pill chips: `bg-[#0f2415] border border-green-900/40 rounded px-2 py-0.5 text-[11px] font-mono text-green-400`
- Distinguish created vs edited: edited files show a dimmed "edited" label
- Footer: "What should we build next?" at `text-[12px] text-muted-foreground`
- "Done" heading with SVG checkmark in filled green circle (no emoji)
- `animation: fade-up 150ms ease` on card mount

---

## Section 4 — Preview Panel & Device Simulator

### 4A — Preview Toolbar

**File:** `client/src/components/ide/preview-panel.tsx`

Reorganize into three logical groups:

**Left** — Framework badge + Platform toggle  
**Center** — Device selector + Orientation toggle  
**Right** — Frame theme toggle + QR button + Refresh button

Changes:
- Toolbar height: `h-9` → `h-[38px]`
- Platform toggle (iOS/Android): same pill style as navbar layout toggle — `bg-muted border border-border rounded-lg p-[3px]`, active tab `bg-muted-foreground/20 text-foreground`
- All icon buttons unified: `w-7 h-[26px] rounded-md bg-muted border border-border`
- Framework badge: `text-[11px] font-medium`, color-coded per framework (existing logic kept)
- QR and refresh buttons: replace any text labels with SVG icons

### 4B — Device Frame Polish

**File:** `client/src/components/ide/device-simulator.tsx`

Dark frame mode:
- Frame background: `linear-gradient(160deg, #2a2a2e, #111114)` (replaces flat `#1a1a1a`)
- Top-edge highlight: `box-shadow: inset 0 1px 0 rgba(255,255,255,0.06)`
- Overall shadow: `0 4px 20px rgba(0,0,0,0.7)`
- Side buttons: 2px wide (down from 3px), same color as frame (`#3a3a3e`)
- Home bar: `rgba(255,255,255,0.15)` (replaces opaque `#444`)
- Dynamic Island: ensure rendered for all iPhone 14+ presets (logic already exists)

Light frame mode: keep existing silver treatment, add subtle shadow `0 2px 12px rgba(0,0,0,0.15)`.

### 4C — Empty / Loading / Error States

**File:** `client/src/components/ide/preview-panel.tsx`

Replace blank iframe states with three distinct views rendered inside the simulator area:

| State | Treatment |
|---|---|
| Not yet run | Muted play-button SVG (28px) + "Run your project to see the preview" at `text-[12px] text-muted-foreground/40` |
| Compiling | CSS spinner (32px) + "Compiling..." at `text-[12px] text-muted-foreground` |
| Error | Red border `border-red-900/50`, error icon SVG (22px) + "Compile error" + "Check the action log" at `text-[10px]` |

All three use `animation: fade-up 150ms ease` on mount.

---

## Section 5 — Micro-animations & Final Polish

### 5A — Transition token adoption

Sweep all components touched in this spec and replace:
- `transition-all duration-200` → `transition: var(--transition-base)`
- `duration-150` → `var(--transition-fast)`
- `duration-300` → `var(--transition-slow)`

### 5B — Step completion animation

In `plan-components.tsx`, when `status` changes to `"done"`:
- Apply `animation: step-complete 200ms var(--transition-spring)` to the status dot
- Runs once, no loop

### 5C — File write flash

In `action-log.tsx`, new `ActionLogLiveRow` entries for file writes:
- Apply `animation: file-flash 600ms ease-out` on mount
- Transitions from blue highlight → settled green state

### 5D — Fade-in on new rows

Apply `animation: fade-up 150ms ease` to:
- New `ActionLogLiveRow` on mount
- New `StepItem` on mount
- `BuildCompletionCard` on mount

### 5E — Hover / focus state audit

| Component | Idle | Hover |
|---|---|---|
| Dock buttons | 25% opacity | 70% opacity, `--transition-fast` |
| Toolbar icon buttons | `bg-muted border-border` | `bg-muted/80 border-border/80`, `--transition-fast` |
| Plan step rows | — | Pending/done rows get subtle `bg-muted/20` on hover |

---

## Files Modified

| File | Sections |
|---|---|
| `client/src/index.css` | 1A, 1B, 1C, 1D, 1E |
| `tailwind.config.ts` | 1E (verify radius scale) |
| `client/src/components/ide/navbar.tsx` | 2A |
| `client/src/components/ide/tools-dock.tsx` | 2B |
| `client/src/pages/ide.tsx` | 2C (ResizeHandle) |
| `client/src/components/ide/chat/plan-components.tsx` | 3A, 5B, 5D |
| `client/src/components/ide/chat/message-components.tsx` | 3B, 3D, 5D |
| `client/src/components/ide/chat/action-log.tsx` | 3C, 5C, 5D |
| `client/src/components/ide/preview-panel.tsx` | 4A, 4C |
| `client/src/components/ide/device-simulator.tsx` | 4B |

---

## Constraints & Non-Goals

- No logic, store, or API changes
- No new npm packages
- No emoji anywhere in the UI
- No new routes or pages
- Light mode support required throughout (adaptive)
- Existing theme system (14 themes via `next-themes`) must continue to work

---

## Verification

1. Run `npm run dev` — visually inspect all five areas against the before/after mockups
2. Toggle light/dark mode — every surface should look intentional in both
3. Trigger a full plan + build cycle — verify plan card progress, action log grouping, completion card
4. Resize the IDE panels — verify ResizeHandle hover state and border weights
5. Open preview panel — verify toolbar grouping, empty/loading/error states, device frame polish
6. Run `npm run check` — no TypeScript errors
