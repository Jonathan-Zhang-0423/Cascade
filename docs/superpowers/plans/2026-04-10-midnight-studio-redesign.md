# Midnight Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visually redesign the CodeStart IDE with a "Midnight Studio" aesthetic — true near-black backgrounds, Geist font throughout, electric blue #4f82ff accent — pure CSS/Tailwind class changes, zero logic changes.

**Architecture:** Replace all colour tokens in `index.css` with a new midnight palette, load Geist via the already-present Google Fonts link in `index.html`, then update Tailwind classes component-by-component. Every change is a class-string edit with no TypeScript logic touched.

**Tech Stack:** React, Tailwind CSS, Geist (Google Fonts — already loaded in `index.html`)

---

## File Map

| File | What changes |
|---|---|
| `client/src/index.css` | Replace `:root` + `.dark` colour tokens; add `--font-ui` Geist variable; update `body` font |
| `client/src/components/ide/navbar.tsx` | bg, border, button, Run button classes |
| `client/src/components/ide/tools-dock.tsx` | dock bg, active/inactive btn classes |
| `client/src/components/ide/chat-panel.tsx` | panel bg, header classes |
| `client/src/components/ide/chat/ChatInputArea.tsx` | send button gradient, focus ring |
| `client/src/components/ide/chat/plan-components.tsx` | step dot colours, running row, connector |
| `client/src/components/ide/chat/action-log.tsx` | thinking row, write row, read row colours |
| `client/src/components/ide/chat/ChatMessageList.tsx` | build completion card |
| `client/src/components/ide/preview-panel.tsx` | toolbar bg, icon buttons, platform toggle |
| `client/src/components/ide/device-simulator.tsx` | phone frame gradient, home bar, side buttons |

---

## Task 1: CSS Foundation — Tokens + Font

**Files:**
- Modify: `client/src/index.css`

- [ ] **Step 1: Replace the `:root` block with the midnight token set**

Open `client/src/index.css`. Replace the entire `:root { ... }` block (lines 6–88) with:

```css
:root {
  /* ── Midnight Studio palette ── */
  --bg-base:   #06060a;
  --bg-dock:   #080810;
  --bg-nav:    #08080e;
  --bg-1:      #0c0c14;
  --bg-2:      #101018;
  --bg-3:      #14141e;
  --bg-4:      #1a1a26;
  --bg-5:      #20202e;

  --border-1:  rgba(255,255,255,0.04);
  --border-2:  rgba(255,255,255,0.07);
  --border-3:  rgba(255,255,255,0.11);

  --text-1:    #eeeef6;
  --text-2:    #8888a8;
  --text-3:    #484860;
  --text-4:    #2e2e42;

  --blue:      #4f82ff;
  --blue-dim:  rgba(79,130,255,0.10);
  --blue-glow: rgba(79,130,255,0.28);
  --indigo:    #818cf8;
  --indigo-dim: rgba(129,140,248,0.08);
  --green:     #34d68a;
  --green-dim: rgba(52,214,138,0.08);
  --red:       #f87171;

  --font-ui:   'Geist', system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'Menlo', monospace;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 9px;
  --radius-xl: 12px;

  /* shadcn/ui compatibility — keep these so UI components don't break */
  --background: 240 6% 4%;
  --foreground: 240 10% 95%;
  --card: 240 7% 7%;
  --card-foreground: 240 10% 95%;
  --popover: 240 7% 9%;
  --popover-foreground: 240 10% 95%;
  --primary: 222 100% 65%;
  --primary-foreground: 0 0% 100%;
  --secondary: 240 5% 14%;
  --secondary-foreground: 240 10% 90%;
  --muted: 240 5% 14%;
  --muted-foreground: 240 5% 55%;
  --accent: 240 5% 18%;
  --accent-foreground: 240 10% 90%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 5% 12%;
  --input: 240 5% 18%;
  --ring: 222 100% 65%;
  --radius: 0.5rem;

  /* shadows */
  --shadow-2xs: 0 1px 2px rgba(0,0,0,0.5);
  --shadow-xs:  0 1px 3px rgba(0,0,0,0.5);
  --shadow-sm:  0 1px 3px rgba(0,0,0,0.6);
  --shadow:     0 1px 3px rgba(0,0,0,0.6);
  --shadow-md:  0 4px 12px rgba(0,0,0,0.7), 0 1px 3px rgba(0,0,0,0.4);
  --shadow-lg:  0 8px 24px rgba(0,0,0,0.8), 0 2px 6px rgba(0,0,0,0.5);
  --shadow-xl:  0 16px 40px rgba(0,0,0,0.85), 0 4px 12px rgba(0,0,0,0.6);
  --shadow-2xl: 0 24px 60px rgba(0,0,0,0.9), 0 8px 20px rgba(0,0,0,0.7);
}
```

- [ ] **Step 2: Remove the entire `.dark { ... }` block**

Delete lines 90–166 (the `.dark { ... }` block). The app uses `class="dark"` on the html element, but since we're now targeting a single midnight theme, the `:root` values above replace it. The shadcn compatibility vars are neutral enough to not need a separate dark override.

- [ ] **Step 3: Update the `body` font in the `@layer base` block**

Find this block (around line 168):
```css
@layer base {
  * {
    @apply border-border;
  }

  body {
    @apply font-sans antialiased bg-background text-foreground;
  }
}
```

Replace with:
```css
@layer base {
  * {
    @apply border-border;
  }

  body {
    font-family: 'Geist', system-ui, sans-serif;
    @apply antialiased bg-background text-foreground;
  }
}
```

- [ ] **Step 4: Verify visually**

Run `npm run dev` and open the app. The IDE should now appear with very deep near-black backgrounds. The overall layout will look darker but potentially unstyled in some areas — that's expected. This task only lays the token foundation.

- [ ] **Step 5: Commit**

```bash
git add client/src/index.css
git commit -m "style: midnight studio — replace CSS tokens, Geist font, deep bg palette"
```

---

## Task 2: Navbar

**Files:**
- Modify: `client/src/components/ide/navbar.tsx`

- [ ] **Step 1: Update the `<header>` container**

Find line 229:
```tsx
className="flex items-center justify-between gap-2 px-3 h-11 border-b border-border bg-[#111114] dark:bg-[#111114] shrink-0"
```
Replace with:
```tsx
className="flex items-center justify-between gap-2 px-3 h-11 border-b border-[rgba(255,255,255,0.07)] bg-[#08080e] shrink-0"
```

- [ ] **Step 2: Update the back button**

Find line 235:
```tsx
className="flex items-center justify-center w-7 h-7 rounded-md bg-muted border border-border text-muted-foreground hover:text-foreground [transition:var(--transition-fast)] shrink-0"
```
Replace with:
```tsx
className="flex items-center justify-center w-7 h-7 rounded-md bg-[#0c0c14] border border-[rgba(255,255,255,0.07)] text-[#8888a8] hover:text-[#eeeef6] hover:bg-[#14141e] [transition:var(--transition-fast)] shrink-0"
```

- [ ] **Step 3: Update the emoji badge**

Find line 243:
```tsx
className="w-[22px] h-[22px] rounded-md flex items-center justify-center shrink-0 text-sm leading-none select-none bg-muted border border-border"
```
Replace with:
```tsx
className="w-[22px] h-[22px] rounded-md flex items-center justify-center shrink-0 text-sm leading-none select-none bg-[#0c0c14] border border-[rgba(255,255,255,0.07)]"
```

- [ ] **Step 4: Update the project name and framework label**

Find line 246:
```tsx
<span className="text-sm font-semibold truncate" data-testid="text-project-name">
```
Replace with:
```tsx
<span className="text-[13px] font-semibold tracking-[-0.02em] truncate" data-testid="text-project-name">
```

Find line 251 (the separator dot):
```tsx
<span className="text-muted-foreground/40 shrink-0">·</span>
```
Replace with:
```tsx
<span className="text-[#2e2e42] shrink-0">·</span>
```

Find line 252 (framework label):
```tsx
<span className="text-[11px] text-muted-foreground/60 shrink-0">{frameworkLabel}</span>
```
Replace with:
```tsx
<span className="text-[11px] text-[#8888a8] shrink-0">{frameworkLabel}</span>
```

- [ ] **Step 5: Update the eye/code-visibility toggle button**

Find lines 261–269 (the eye button `className` with `cn(...)`):
```tsx
className={cn(
  "flex items-center justify-center w-7 h-7 rounded-md border border-border [transition:var(--transition-fast)]",
  !codeVisible
    ? "bg-accent text-foreground"
    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
)}
```
Replace with:
```tsx
className={cn(
  "flex items-center justify-center w-7 h-7 rounded-md border [transition:var(--transition-fast)]",
  !codeVisible
    ? "bg-[rgba(79,130,255,0.10)] border-[rgba(79,130,255,0.20)] text-[#4f82ff]"
    : "bg-[#0c0c14] border-[rgba(255,255,255,0.07)] text-[#8888a8] hover:text-[#eeeef6] hover:bg-[#14141e]"
)}
```

- [ ] **Step 6: Update the theme SelectTrigger**

Find line 274:
```tsx
<SelectTrigger className="w-auto h-7 text-xs px-2 min-w-[80px]" data-testid="select-theme">
```
Replace with:
```tsx
<SelectTrigger className="w-auto h-[26px] text-[11px] px-2 min-w-[80px] bg-[#0c0c14] border-[rgba(255,255,255,0.07)] text-[#8888a8]" data-testid="select-theme">
```

- [ ] **Step 7: Update the Run button**

Find line 287–290:
```tsx
className="gap-1.5 h-[30px] bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white disabled:opacity-60 shadow-[0_1px_3px_rgba(37,99,235,0.4)]"
```
Replace with:
```tsx
className="gap-1.5 h-[27px] bg-gradient-to-br from-[#5585ff] to-[#2a5ce0] hover:from-[#6693ff] hover:to-[#3b6de8] text-white disabled:opacity-60 shadow-[0_1px_10px_rgba(79,130,255,0.42),inset_0_1px_0_rgba(255,255,255,0.13)] tracking-[0.01em]"
```

- [ ] **Step 8: Verify and commit**

Check the navbar visually — deeper background, refined buttons, gradient run button. Then:
```bash
git add client/src/components/ide/navbar.tsx
git commit -m "style: navbar — midnight bg, refined buttons, stronger run gradient"
```

---

## Task 3: Tools Dock

**Files:**
- Modify: `client/src/components/ide/tools-dock.tsx`

- [ ] **Step 1: Update the dock container**

Find line 48:
```tsx
className="flex flex-col items-center justify-between w-11 py-2 bg-[#0f0f12] shrink-0"
```
Replace with:
```tsx
className="flex flex-col items-center justify-between w-11 py-2 bg-[#080810] border-r border-[rgba(255,255,255,0.04)] shrink-0"
```

- [ ] **Step 2: Update the `DockButton` active/inactive classes**

Find lines 22–30 (the `className` inside `DockButton`):
```tsx
className={cn(
  "relative flex items-center justify-center w-10 h-10 rounded-lg",
  "[transition:var(--transition-fast)]",
  isActive
    ? "bg-[#1e2940] ring-1 ring-primary/20 opacity-100"
    : "opacity-25 hover:opacity-70"
)}
```
Replace with:
```tsx
className={cn(
  "relative flex items-center justify-center w-10 h-10 rounded-lg",
  "[transition:var(--transition-fast)]",
  isActive
    ? "bg-[#141d34] ring-1 ring-[rgba(79,130,255,0.18)] opacity-100"
    : "opacity-[0.18] hover:opacity-55"
)}
```

- [ ] **Step 3: Update the active glow filter**

Find line 29 (the `style` prop on the button):
```tsx
style={isActive ? { filter: "drop-shadow(0 0 4px rgba(59,130,246,0.5))" } : undefined}
```
Replace with:
```tsx
style={isActive ? { filter: "drop-shadow(0 0 5px rgba(79,130,255,0.40))" } : undefined}
```

- [ ] **Step 4: Update the LLM Monitor button (bottom of dock)**

Find lines 77–84 (the monitor button `className`):
```tsx
className={cn(
  "relative flex items-center justify-center w-10 h-10 rounded-lg [transition:var(--transition-fast)]",
  isMonitorOpen
    ? "bg-[#1e2940] ring-1 ring-primary/20 opacity-100"
    : "opacity-25 hover:opacity-70"
)}
```
Replace with:
```tsx
className={cn(
  "relative flex items-center justify-center w-10 h-10 rounded-lg [transition:var(--transition-fast)]",
  isMonitorOpen
    ? "bg-[#141d34] ring-1 ring-[rgba(79,130,255,0.18)] opacity-100"
    : "opacity-[0.18] hover:opacity-55"
)}
```

And its glow style on line 83:
```tsx
style={isMonitorOpen ? { filter: "drop-shadow(0 0 4px rgba(59,130,246,0.5))" } : undefined}
```
Replace with:
```tsx
style={isMonitorOpen ? { filter: "drop-shadow(0 0 5px rgba(79,130,255,0.40))" } : undefined}
```

- [ ] **Step 5: Verify and commit**

The dock should be notably darker, inactive icons more ghosted, active icon has stronger blue glow.
```bash
git add client/src/components/ide/tools-dock.tsx
git commit -m "style: dock — deeper bg, stronger blue glow active state, lower inactive opacity"
```

---

## Task 4: Chat Panel

**Files:**
- Modify: `client/src/components/ide/chat-panel.tsx`
- Modify: `client/src/components/ide/chat/ChatInputArea.tsx`

- [ ] **Step 1: Find where the chat panel container is rendered**

In `chat-panel.tsx`, search for where the outer panel div is rendered. It will be a `flex flex-col h-full` wrapper. Update the overall panel container className to use the midnight token. Look for the outermost container div in the return and ensure it uses:
```tsx
className="flex flex-col h-full"
```
This is inherited from the IDE layout — no change needed here. The background comes from the IDE layout panel that wraps it.

- [ ] **Step 2: Update the chat header in `chat-panel.tsx`**

Search for the chat panel header (contains `Sparkles` icon and "Chat" text). Find its className — something like:
```tsx
className="flex items-center gap-1.5 px-3 h-9 border-b border-border/50 shrink-0"
```
Replace with:
```tsx
className="flex items-center gap-1.5 px-3 h-[34px] border-b border-[rgba(255,255,255,0.04)] shrink-0 text-[11px] font-medium text-[#8888a8]"
```

- [ ] **Step 3: Update the Send button in `ChatInputArea.tsx`**

Find the send button (the non-busy state, has `ArrowUp` icon), around line 252:
```tsx
<Button
  size="icon"
  className="h-7 w-7 rounded-lg shrink-0"
  onClick={onSend}
  ...
>
```
Replace the `className`:
```tsx
<Button
  size="icon"
  className="h-7 w-7 rounded-lg shrink-0 bg-gradient-to-br from-[#5585ff] to-[#2a5ce0] hover:from-[#6693ff] hover:to-[#3b6de8] border-0 shadow-[0_1px_6px_rgba(79,130,255,0.30),inset_0_1px_0_rgba(255,255,255,0.12)]"
  onClick={onSend}
  ...
>
```

- [ ] **Step 4: Update the input container focus ring in `ChatInputArea.tsx`**

Find lines 116–121 (the `inputBoxRef` div with focus ring):
```tsx
className={cn(
  "rounded-xl border bg-background overflow-hidden transition-[border-color,box-shadow]",
  inputFocused
    ? "border-primary ring-2 ring-primary/40"
    : "border-border/60",
)}
```
Replace with:
```tsx
className={cn(
  "rounded-xl border bg-background overflow-hidden transition-[border-color,box-shadow]",
  inputFocused
    ? "border-[#4f82ff] ring-2 ring-[rgba(79,130,255,0.25)]"
    : "border-[rgba(255,255,255,0.07)]",
)}
```

- [ ] **Step 5: Verify and commit**

```bash
git add client/src/components/ide/chat-panel.tsx client/src/components/ide/chat/ChatInputArea.tsx
git commit -m "style: chat panel — midnight header border, send button gradient, blue focus ring"
```

---

## Task 5: Plan Card Steps

**Files:**
- Modify: `client/src/components/ide/chat/plan-components.tsx`

- [ ] **Step 1: Update the done step dot**

Find line 63–72 (the `case "done":` dot element):
```tsx
case "done":
  return (
    <div
      className="w-4 h-4 rounded-full bg-green-600 flex items-center justify-center shrink-0"
      style={!isCompleted ? { animation: "step-complete 200ms var(--transition-spring)" } : undefined}
    >
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
        <polyline points="1.5,4.5 3.5,6.5 7.5,2.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
```
Replace with:
```tsx
case "done":
  return (
    <div
      className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
      style={{
        background: "#1a5e3a",
        border: "1px solid rgba(52,214,138,0.25)",
        ...((!isCompleted) ? { animation: "step-complete 200ms var(--transition-spring)" } : {}),
      }}
    >
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
        <polyline points="1.5,4.5 3.5,6.5 7.5,2.5" stroke="#34d68a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
```

- [ ] **Step 2: Update the running step dot**

Find line 74–78 (the `case "running":` dot):
```tsx
case "running":
  return (
    <div className="w-4 h-4 rounded-full border-2 border-blue-400 bg-[#0d1829] flex items-center justify-center shrink-0">
      <div className="w-[6px] h-[6px] rounded-full bg-blue-400" />
    </div>
  );
```
Replace with:
```tsx
case "running":
  return (
    <div className="w-4 h-4 rounded-full border-2 border-[#4f82ff] bg-[#0d1422] flex items-center justify-center shrink-0">
      <div className="w-[6px] h-[6px] rounded-full bg-[#4f82ff]" />
    </div>
  );
```

- [ ] **Step 3: Update the pending step dot**

Find line 86–88 (the `default:` pending dot):
```tsx
default: // pending
  return (
    <div className="w-4 h-4 rounded-full border border-border/40 bg-transparent shrink-0" />
  );
```
Replace with:
```tsx
default: // pending
  return (
    <div className="w-4 h-4 rounded-full border border-[rgba(255,255,255,0.07)] bg-transparent shrink-0" />
  );
```

- [ ] **Step 4: Update the running row highlight**

Find line 107–109 (the running row container `cn(...)`):
```tsx
className={cn(
  "flex gap-[10px] items-start py-[6px] px-[6px] rounded-md -mx-1.5",
  "transition-colors",
  isRunning && "bg-[#1e2940]",
)}
```
Replace with:
```tsx
className={cn(
  "flex gap-[10px] items-start py-[6px] px-[6px] rounded-md -mx-1.5",
  "transition-colors",
  isRunning && "bg-[#121a2e]",
)}
```

- [ ] **Step 5: Update the connector line between dots**

Find line 114–116 (the connector div):
```tsx
{!isLast && (
  <div className="w-px bg-border/60 mt-[3px]" style={{ height: 18 }} />
)}
```
Replace with:
```tsx
{!isLast && (
  <div className="w-px bg-[rgba(255,255,255,0.07)] mt-[3px]" style={{ height: 18 }} />
)}
```

- [ ] **Step 6: Update the step text colours**

Find lines 127–142 (the step title `cn(...)` span):
```tsx
className={cn(
  "text-[12px] leading-snug flex-1",
  isCompleted
    ? "text-muted-foreground/40"
    : isDone
      ? "text-muted-foreground/60"
      : s === "failed"
        ? "text-red-400"
        : isRunning
          ? "text-foreground font-medium"
          : s === "needs-input"
            ? "text-yellow-500"
            : s === "bug"
              ? "text-orange-500"
              : "text-muted-foreground/30",
)}
```
Replace with:
```tsx
className={cn(
  "text-[12px] leading-snug flex-1",
  isCompleted
    ? "text-[#2e2e42]"
    : isDone
      ? "text-[#484860]"
      : s === "failed"
        ? "text-red-400"
        : isRunning
          ? "text-[#eeeef6] font-medium"
          : s === "needs-input"
            ? "text-yellow-500"
            : s === "bug"
              ? "text-orange-500"
              : "text-[#2e2e42]",
)}
```

- [ ] **Step 7: Update the "Building…" badge on running steps**

Find line 148–152:
```tsx
<span
  className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded px-1.5 py-0.5 shrink-0 font-medium"
  data-testid={`step-building-${task.step}`}
>
  Building…
</span>
```
Replace with:
```tsx
<span
  className="text-[10px] bg-[rgba(79,130,255,0.12)] text-[#4f82ff] border border-[rgba(79,130,255,0.25)] rounded px-1.5 py-0.5 shrink-0 font-medium"
  data-testid={`step-building-${task.step}`}
>
  Building…
</span>
```

- [ ] **Step 8: Verify and commit**

Start a build and confirm the plan card steps show: green-tinted done dot, blue running dot, ghosted pending dot, darker running row highlight.
```bash
git add client/src/components/ide/chat/plan-components.tsx
git commit -m "style: plan card — midnight step dots, darker running row, updated connector"
```

---

## Task 6: Action Log

**Files:**
- Modify: `client/src/components/ide/chat/action-log.tsx`

- [ ] **Step 1: Update the write row styling in `ActionLogLiveRow`**

Find lines 96–106 (the `className` of the write/read row div):
```tsx
className={cn(
  "flex items-center gap-1.5 py-[5px] text-[12px]",
  isWrite
    ? "border-l-2 border-green-500 bg-[#0d1f12] px-2"
    : color,
)}
```
Replace with:
```tsx
className={cn(
  "flex items-center gap-1.5 py-[5px] text-[12px]",
  isWrite
    ? "border-l-2 border-[#34d68a] bg-[rgba(52,214,138,0.05)] px-2 rounded-r-[4px]"
    : color,
)}
```

- [ ] **Step 2: Update the write row text colour**

Find line 105:
```tsx
<span className={cn("truncate leading-tight font-medium", isWrite ? "text-green-400 font-medium" : "")}>
```
Replace with:
```tsx
<span className={cn("truncate leading-tight font-medium", isWrite ? "text-[#4ddc96] font-medium" : "")}>
```

- [ ] **Step 3: Update the write status label colour**

Find line 108–110:
```tsx
{isWrite && writeStatusLabel && (
  <span className="ml-auto shrink-0 text-green-600 text-[11px]">{writeStatusLabel}</span>
)}
```
Replace with:
```tsx
{isWrite && writeStatusLabel && (
  <span className="ml-auto shrink-0 text-[#2a7a4e] text-[11px]">{writeStatusLabel}</span>
)}
```

- [ ] **Step 4: Update the `ThinkingStream` container**

Find lines 171–178:
```tsx
<div
  ref={containerRef}
  className="max-h-[180px] overflow-y-auto rounded-md bg-[#1a1a2e] border border-indigo-900/50 px-3 py-2"
  data-testid="thinking-stream"
  style={{ animation: "fade-up 150ms ease" }}
>
  <div className="flex items-center gap-1.5 mb-1.5">
    <Brain className="w-3 h-3 shrink-0 text-indigo-400" />
    <span className="text-[11px] font-medium text-indigo-400 uppercase tracking-wide flex-1">
```
Replace the container and header span:
```tsx
<div
  ref={containerRef}
  className="max-h-[180px] overflow-y-auto rounded-md px-3 py-2"
  style={{
    background: "rgba(129,140,248,0.06)",
    border: "1px solid rgba(129,140,248,0.12)",
    animation: "fade-up 150ms ease",
  }}
  data-testid="thinking-stream"
>
  <div className="flex items-center gap-1.5 mb-1.5">
    <Brain className="w-3 h-3 shrink-0 text-[#818cf8]" />
    <span className="text-[11px] font-medium text-[#818cf8] uppercase tracking-wide flex-1">
```

- [ ] **Step 5: Verify and commit**

Trigger a build step and confirm: write rows have green-left-border + dim green bg, thinking stream is indigo-tinted.
```bash
git add client/src/components/ide/chat/action-log.tsx
git commit -m "style: action log — richer write row green, indigo thinking stream"
```

---

## Task 7: Build Completion Card

**Files:**
- Modify: `client/src/components/ide/chat/message-components.tsx`

The `BuildCompletionCard` component lives in `message-components.tsx` starting at line 412.

- [ ] **Step 1: Update the card container (line 427)**

Find:
```tsx
className="mx-3 mt-2 mb-1 rounded-lg border border-green-900/40 bg-[#0d1a0f] overflow-hidden"
```
Replace with:
```tsx
className="mx-3 mt-2 mb-1 rounded-lg border border-[rgba(52,214,138,0.10)] bg-[#0a150e] overflow-hidden"
```

- [ ] **Step 2: Update the header border (line 431)**

Find:
```tsx
<div className="px-3 py-3 border-b border-green-900/30">
```
Replace with:
```tsx
<div className="px-3 py-3 border-b border-[rgba(52,214,138,0.08)]">
```

- [ ] **Step 3: Update the checkmark circle (line 433)**

Find:
```tsx
<div className="w-[22px] h-[22px] rounded-full bg-green-600 flex items-center justify-center shrink-0">
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <polyline points="2,5.5 4.5,8 9,2.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
</div>
```
Replace with:
```tsx
<div
  className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0"
  style={{ background: "#1a6640", border: "1px solid rgba(52,214,138,0.25)" }}
>
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <polyline points="2,5.5 4.5,8 9,2.5" stroke="#5fe8a0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
</div>
```

- [ ] **Step 4: Update the "Done" title text (line 438–443)**

Find:
```tsx
<span
  className="text-[14px] font-semibold text-green-400 leading-snug"
  data-testid="completion-headline"
>
```
Replace with:
```tsx
<span
  className="text-[14px] font-semibold text-[#5fe8a0] tracking-[-0.01em] leading-snug"
  data-testid="completion-headline"
>
```

- [ ] **Step 5: Update summary text (line 446)**

Find:
```tsx
<p className="text-[13px] text-slate-300 leading-relaxed">
```
Replace with:
```tsx
<p className="text-[13px] text-[#8888a8] leading-relaxed">
```

- [ ] **Step 6: Update both sets of file pill chips (lines 458 and 474)**

There are two sets of pill chips — one from `parsed.fileChanges` and one from `changedFiles`. Both share the same className. Find:
```tsx
className="bg-[#0f2415] border border-green-900/40 rounded px-2 py-0.5 text-[11px] font-mono text-green-400"
```
Replace both instances with:
```tsx
className="bg-[rgba(52,214,138,0.06)] border border-[rgba(52,214,138,0.12)] rounded px-2 py-0.5 text-[11px] font-mono text-[#4ade80]"
```

- [ ] **Step 7: Update the section divider borders (lines 469, 484)**

Find:
```tsx
<div className="px-3 py-2 border-t border-green-900/20">
```
Replace both instances with:
```tsx
<div className="px-3 py-2 border-t border-[rgba(52,214,138,0.06)]">
```

- [ ] **Step 8: Update footer text (line 485)**

Find:
```tsx
<p className="text-[12px] text-muted-foreground">What should we build next?</p>
```
Replace with:
```tsx
<p className="text-[12px] text-[#484860]">What should we build next?</p>
```

- [ ] **Step 9: Verify and commit**

Complete a build to see the card. It should have a dark near-black green tint, refined checkmark with green stroke, and monospace file pills.
```bash
git add client/src/components/ide/chat/message-components.tsx
git commit -m "style: build completion card — midnight green tint, refined checkmark, pill chips"
```

---

## Task 8: Preview Panel Toolbar

**Files:**
- Modify: `client/src/components/ide/preview-panel.tsx`

- [ ] **Step 1: Update the toolbar container**

Find line 338:
```tsx
<div className="flex items-center gap-1.5 px-2 h-[38px] border-b border-border shrink-0 flex-wrap">
```
Replace with:
```tsx
<div className="flex items-center gap-1.5 px-2 h-[38px] border-b border-[rgba(255,255,255,0.07)] bg-[#101018] shrink-0 flex-wrap">
```

- [ ] **Step 2: Update the platform toggle pill container**

Find line 346:
```tsx
<div className="flex items-center bg-muted border border-border rounded-lg p-[3px] gap-[1px]">
```
Replace with:
```tsx
<div className="flex items-center bg-[#14141e] border border-[rgba(255,255,255,0.07)] rounded-lg p-[3px] gap-[1px]">
```

- [ ] **Step 3: Update the platform toggle buttons (iOS active)**

Find line 347–355 (iOS button):
```tsx
className={cn(
  "flex items-center justify-center px-2 h-[20px] text-xs rounded-md transition-colors",
  devicePlatform === "ios"
    ? "bg-muted-foreground/20 text-foreground"
    : "text-muted-foreground hover:text-foreground"
)}
```
Replace with:
```tsx
className={cn(
  "flex items-center justify-center px-2 h-[20px] text-xs rounded-md transition-colors",
  devicePlatform === "ios"
    ? "bg-[rgba(255,255,255,0.08)] text-[#eeeef6]"
    : "text-[#484860] hover:text-[#8888a8]"
)}
```

- [ ] **Step 4: Update the Android button (same pattern)**

Find line 356–364 (Android button):
```tsx
className={cn(
  "flex items-center justify-center px-2 h-[20px] text-xs rounded-md transition-colors",
  devicePlatform === "android"
    ? "bg-muted-foreground/20 text-foreground"
    : "text-muted-foreground hover:text-foreground"
)}
```
Replace with:
```tsx
className={cn(
  "flex items-center justify-center px-2 h-[20px] text-xs rounded-md transition-colors",
  devicePlatform === "android"
    ? "bg-[rgba(255,255,255,0.08)] text-[#eeeef6]"
    : "text-[#484860] hover:text-[#8888a8]"
)}
```

- [ ] **Step 5: Update all icon buttons (orientation, frame style, QR, console toggle)**

There are multiple icon buttons with this current pattern:
```tsx
className="h-[26px] w-7 rounded-md bg-muted border border-border hover:bg-muted/80 hover:border-border/80 transition-colors shrink-0 flex items-center justify-center"
```
Replace every instance of this pattern with:
```tsx
className="h-[26px] w-7 rounded-md bg-[#14141e] border border-[rgba(255,255,255,0.07)] hover:bg-[#1a1a26] hover:text-[#8888a8] transition-colors shrink-0 flex items-center justify-center text-[#484860]"
```

- [ ] **Step 6: Update the console toggle button active state**

Find the console button which conditionally applies active styles. It currently uses `bg-accent` when active. Update the active variant to:
```tsx
// When isConsoleOpen is true:
"bg-[rgba(79,130,255,0.10)] border-[rgba(79,130,255,0.20)] text-[#4f82ff]"
// When isConsoleOpen is false — use the standard icon button from Step 5
```

Find the console `<button>` element and update its `className` using `cn(...)`:
```tsx
className={cn(
  "h-[26px] w-7 rounded-md border transition-colors shrink-0 flex items-center justify-center",
  isConsoleOpen
    ? "bg-[rgba(79,130,255,0.10)] border-[rgba(79,130,255,0.20)] text-[#4f82ff]"
    : "bg-[#14141e] border-[rgba(255,255,255,0.07)] hover:bg-[#1a1a26] text-[#484860] hover:text-[#8888a8]"
)}
```

- [ ] **Step 7: Verify and commit**

Check the preview panel toolbar — darker background, consistent icon buttons, blue-active console toggle.
```bash
git add client/src/components/ide/preview-panel.tsx
git commit -m "style: preview toolbar — midnight bg, unified icon buttons, blue console active"
```

---

## Task 9: Device Frame

**Files:**
- Modify: `client/src/components/ide/device-simulator.tsx`

- [ ] **Step 1: Read the device simulator to find the phone frame styles**

Run a search to find the dark frame styles:
```bash
grep -n "1a1a1a\|#333\|border-radius.*px\|home.*bar\|side.*btn\|linear-gradient" client/src/components/ide/device-simulator.tsx | head -40
```

- [ ] **Step 2: Update the dark phone frame background**

Find the inline style or className that sets the dark frame background (currently something like `background: #1a1a1a` or a similar dark colour). Replace the dark frame style object with:
```tsx
style={{
  background: "linear-gradient(160deg, #2a2a30, #0d0d10)",
  border: "1.5px solid #383840",
  boxShadow: "0 4px 24px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.06)",
}}
```

- [ ] **Step 3: Update the home bar colour**

Find where the home bar is styled. It will have a dark background like `background: #444` or a similar value. Replace with:
```tsx
style={{ background: "rgba(255,255,255,0.14)", borderRadius: 2 }}
```

- [ ] **Step 4: Update the side button**

Find the side button element (a thin vertical bar on the phone's right side). Update its width and colour:
```tsx
style={{ width: 2, background: "#38383e", borderRadius: "0 2px 2px 0" }}
```

- [ ] **Step 5: Verify and commit**

The phone frame in the preview panel should now show a gradient dark body with a subtle top highlight, thinner side button, and translucent home bar.
```bash
git add client/src/components/ide/device-simulator.tsx
git commit -m "style: device frame — gradient body, translucent home bar, refined side button"
```

---

## Task 10: Final Polish Pass

**Files:**
- Modify: `client/src/index.css` (transition tokens, if any)

- [ ] **Step 1: Verify Geist is rendering**

Open the app and inspect the `body` element in DevTools. Confirm computed font is `Geist` not `Open Sans` or `system-ui`. If not, confirm `index.html` has the Geist font link (it already does — line 15 includes `family=Geist:wght@100..900`).

- [ ] **Step 2: Spot-check all 8 components**

Walk through each component visually:
- [ ] Navbar: deep bg, gradient run button
- [ ] Dock: very dark, blue glow on active
- [ ] Chat panel: midnight-tinted, gradient send button
- [ ] Plan card: green done dot, blue running dot, dark running row
- [ ] Action log: green-left-border writes, indigo thinking
- [ ] Build card: dark green tint card
- [ ] Preview toolbar: dark bg, consistent icon buttons
- [ ] Device frame: gradient body, translucent home bar

- [ ] **Step 3: Fix any visual regressions**

Common issues to look for:
- White backgrounds unexpectedly showing (check shadcn component overrides)
- `border-border` still referencing old HSL values — replace any remaining instances with `border-[rgba(255,255,255,0.07)]`
- Text too dark to read — check `text-muted-foreground` instances and confirm they resolve to `#8888a8` with new tokens

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "style: midnight studio — final polish pass, verify all components"
```
