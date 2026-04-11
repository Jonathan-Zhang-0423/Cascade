# CodeStart UI/UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a visual-only polish pass to CodeStart's IDE shell, chat components, and preview panel — elevating the dark/light theme to feel premium without changing any logic, store structure, or npm deps.

**Architecture:** Pure className and inline-style edits across 9 files. `index.css` is the foundation task — it introduces CSS custom properties (`--transition-*`, `--shadow-*`) and `@keyframes` that later tasks reference by name. Each subsequent task is fully independent and can be understood file-by-file.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v3, shadcn/ui, Vite, `react-resizable-panels`. No new packages.

**Spec:** `docs/superpowers/specs/2026-04-10-codestart-ui-redesign-design.md`

---

## Context

CodeStart has accumulated visual debt: all `--shadow-*` vars are zeroed out, there are no CSS transition tokens, interactive states lack hover feedback, and components like the action log treat every event with equal visual weight. This plan implements the approved design spec (Sections 1–5) — 9 files, no logic changes, no new npm packages, no emoji.

---

## File Map

| File | What changes |
|---|---|
| `client/src/index.css` | Shadow vars (real values), transition tokens, 3 @keyframes |
| `client/src/components/ide/navbar.tsx` | Height, bg, border, back button, framework label, layout toggle centered, Run button gradient |
| `client/src/components/ide/tools-dock.tsx` | Darker bg, remove border-r, active state glow, inactive opacity, badge text size |
| `client/src/pages/ide.tsx` | Panel border weight, ResizeHandle hover |
| `client/src/components/ide/chat/plan-components.tsx` | Progress bar header, connector lines, step dot sizing, running row tint, step-complete animation |
| `client/src/components/ide/chat/message-components.tsx` | AI narration font/line-height, BuildCompletionCard (pills, summary, SVG checkmark, fade-up) |
| `client/src/components/ide/chat/action-log.tsx` | Write row green styling, thinking row indigo, read-collapse, file-flash + fade-up animations |
| `client/src/components/ide/preview-panel.tsx` | Toolbar height/grouping, icon button sizes, empty/compiling/error states |
| `client/src/components/ide/device-simulator.tsx` | Frame gradient, side button widths, home bar color |

---

## Task 1: Foundation — CSS Tokens & Keyframes (`index.css`)

**Files:**
- Modify: `client/src/index.css`

- [ ] **Step 1: Replace zeroed-out shadow vars in `:root` (light mode)**

Find and replace all `--shadow-*` lines in `:root`:
```css
  --shadow-2xs: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-xs: 0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.03);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04);
  --shadow: 0 1px 3px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08);
  --shadow-xl: 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08);
  --shadow-2xl: 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08);
```

- [ ] **Step 2: Replace zeroed-out shadow vars in `.dark` (dark mode)**

Find and replace all `--shadow-*` lines in `.dark`:
```css
  --shadow-2xs: 0 1px 2px rgba(0,0,0,0.4);
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.4);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.4);
  --shadow: 0 1px 2px rgba(0,0,0,0.4);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.3);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4);
  --shadow-xl: 0 8px 24px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4);
  --shadow-2xl: 0 8px 24px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4);
```

- [ ] **Step 3: Add transition tokens and keyframe animations**

Add the following block at the very end of `index.css` (after the closing `}` of `@layer utilities`):

```css
/* ─── Transition tokens ─────────────────────────────────────────── */
:root {
  --transition-fast:   100ms ease;
  --transition-base:   150ms ease;
  --transition-slow:   250ms ease;
  --transition-spring: 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ─── Keyframe animations ────────────────────────────────────────── */
@keyframes step-complete {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.25); box-shadow: 0 0 0 6px rgba(22, 163, 74, 0.2); }
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

- [ ] **Step 4: Visual check & commit**

Run `npm run dev`, open the IDE, check that panels show subtle depth (look at panel borders and card-within-card). No visual change needed yet — shadows only appear where `shadow-sm` etc. are used. Confirm `npm run check` passes.

```bash
git add client/src/index.css
git commit -m "style: add shadow values, transition tokens, and keyframe animations"
```

---

## Task 2: Navbar (`navbar.tsx`)

**Files:**
- Modify: `client/src/components/ide/navbar.tsx`

The navbar currently has: `h-10`, flat `bg-sidebar`, bare ChevronLeft back button, layout toggle in the right cluster, and a flat `bg-blue-600 h-7` Run button.

- [ ] **Step 1: Update header element classes**

Change line 221:
```tsx
// BEFORE
className="flex items-center justify-between gap-2 px-3 h-10 border-b border-border/50 bg-sidebar shrink-0"

// AFTER
className="flex items-center justify-between gap-2 px-3 h-11 border-b border-border bg-[#111114] dark:bg-[#111114] shrink-0"
```

- [ ] **Step 2: Update back button to icon button style**

Change line 225-233 (the Button wrapping ChevronLeft):
```tsx
// BEFORE
<Button
  size="sm"
  variant="ghost"
  className="gap-1 h-7 px-2 shrink-0"
  onClick={handleBack}
  data-testid="button-back"
>
  <ChevronLeft className="w-3.5 h-3.5" />
</Button>

// AFTER
<button
  className="flex items-center justify-center w-7 h-7 rounded-md bg-muted border border-border text-muted-foreground hover:text-foreground transition-colors shrink-0"
  onClick={handleBack}
  data-testid="button-back"
  aria-label="Back"
>
  <ChevronLeft className="w-3.5 h-3.5" />
</button>
```

- [ ] **Step 3: Add framework label next to project name**

The project store has `framework` on each project. The `Navbar` component already reads `projects` and `projectId`. Add a framework label after the project name.

First, find the project inside the component. After line 98 (`const [isRunning, setIsRunning] = useState(false);`), add:

```tsx
const currentProject = projects.find((p) => p.id === projectId);
const frameworkLabel = currentProject?.framework
  ? currentProject.framework === "rn-expo" ? "React Native"
  : currentProject.framework === "flutter" ? "Flutter"
  : currentProject.framework === "kotlin" ? "Kotlin"
  : currentProject.framework === "swiftui" ? "SwiftUI"
  : currentProject.framework === "web" ? "Web"
  : currentProject.framework
  : "";
```

Then update the project name section (lines 234-241) to add the label:
```tsx
// BEFORE
<div className="flex items-center gap-1.5 min-w-0">
  <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-sm leading-none select-none bg-[#2a2a2b00]" data-testid="emoji-project">
    {getProjectEmoji(projectName)}
  </div>
  <span className="text-sm font-semibold truncate" data-testid="text-project-name">
    {projectName}
  </span>
</div>

// AFTER
<div className="flex items-center gap-1.5 min-w-0">
  <div className="w-[22px] h-[22px] rounded-md flex items-center justify-center shrink-0 text-sm leading-none select-none bg-muted border border-border" data-testid="emoji-project">
    {getProjectEmoji(projectName)}
  </div>
  <span className="text-sm font-semibold truncate" data-testid="text-project-name">
    {projectName}
  </span>
  {frameworkLabel && (
    <>
      <span className="text-muted-foreground/40 shrink-0">·</span>
      <span className="text-[11px] text-muted-foreground/60 shrink-0">{frameworkLabel}</span>
    </>
  )}
</div>
```

- [ ] **Step 4: Move layout toggle to center — restructure JSX**

The current structure is `left-cluster | right-cluster`. Change it to `left-cluster | center-cluster | right-cluster` by wrapping the layout toggle in its own centered div.

Replace the entire return statement's structure (lines 219–316). The key change is: extract the layout toggle group out of the right `<div className="flex items-center gap-2">` and place it as a new sibling div:

```tsx
return (
  <header
    className="flex items-center justify-between gap-2 px-3 h-11 border-b border-border bg-[#111114] dark:bg-[#111114] shrink-0"
    data-testid="navbar"
  >
    {/* Left */}
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <button
        className="flex items-center justify-center w-7 h-7 rounded-md bg-muted border border-border text-muted-foreground hover:text-foreground transition-colors shrink-0"
        onClick={handleBack}
        data-testid="button-back"
        aria-label="Back"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="w-[22px] h-[22px] rounded-md flex items-center justify-center shrink-0 text-sm leading-none select-none bg-muted border border-border" data-testid="emoji-project">
          {getProjectEmoji(projectName)}
        </div>
        <span className="text-sm font-semibold truncate" data-testid="text-project-name">
          {projectName}
        </span>
        {frameworkLabel && (
          <>
            <span className="text-muted-foreground/40 shrink-0">·</span>
            <span className="text-[11px] text-muted-foreground/60 shrink-0">{frameworkLabel}</span>
          </>
        )}
      </div>
    </div>

    {/* Center — layout toggle */}
    <div className="flex items-center rounded-lg border border-border bg-muted p-[3px] gap-[2px]">
      <button
        className={cn(
          "flex items-center gap-1 px-2.5 h-[22px] text-xs rounded-md transition-colors",
          layoutMode === "code"
            ? "bg-muted-foreground/20 text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => setLayoutMode("code")}
        title="Code layout"
        data-testid="button-layout-code"
      >
        <Code2 className="w-3.5 h-3.5" />
      </button>
      <button
        className={cn(
          "flex items-center gap-1 px-2.5 h-[22px] text-xs rounded-md transition-colors",
          layoutMode === "preview"
            ? "bg-muted-foreground/20 text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => setLayoutMode("preview")}
        title="Preview layout"
        data-testid="button-layout-preview"
      >
        <Monitor className="w-3.5 h-3.5" />
      </button>
    </div>

    {/* Right */}
    <div className="flex items-center gap-2 flex-1 justify-end">
      <button
        className={cn(
          "flex items-center justify-center w-7 h-7 rounded-md border border-border transition-colors",
          !codeVisible
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
        onClick={toggleCodeVisible}
        title={codeVisible ? "Hide code" : "Show code"}
        data-testid="button-toggle-code-visible"
      >
        {codeVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
      <Select value={themeId} onValueChange={handleThemeChange}>
        <SelectTrigger className="w-auto h-7 text-xs px-2 min-w-[80px]" data-testid="select-theme">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THEME_LIST.map((th) => (
            <SelectItem key={th.id} value={th.id}>
              {th.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <LangToggle />
      <Button
        size="sm"
        className="gap-1.5 h-[30px] bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white disabled:opacity-60 shadow-[0_1px_3px_rgba(37,99,235,0.4)]"
        data-testid="button-run"
        disabled={isRunning}
        onClick={handleRun}
      >
        {isRunning
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <RefreshCw className="w-3 h-3" />
        }
        {t("navbar.refresh")}
      </Button>
    </div>
  </header>
);
```

- [ ] **Step 5: Visual check & commit**

Run `npm run dev`. Check: navbar is 44px tall, has a darker background, back button is a styled icon button, layout toggle is centered, Run button has a gradient. Toggle layout modes to verify.

```bash
git add client/src/components/ide/navbar.tsx
git commit -m "style: navbar redesign — height, centered layout toggle, gradient run button, framework label"
```

---

## Task 3: Tools Dock (`tools-dock.tsx`)

**Files:**
- Modify: `client/src/components/ide/tools-dock.tsx`

Current: `bg-sidebar border-r border-sidebar-border`, active state = left border strip, inactive icons have no opacity treatment.

- [ ] **Step 1: Update dock container**

Change line 49:
```tsx
// BEFORE
className="flex flex-col items-center justify-between w-11 py-2 bg-sidebar border-r border-sidebar-border shrink-0"

// AFTER
className="flex flex-col items-center justify-between w-11 py-2 bg-[#0f0f12] shrink-0"
```

- [ ] **Step 2: Update DockButton component — replace left-border strip with glow treatment**

Replace the entire `DockButton` function (lines 7–38):
```tsx
function DockButton({
  icon,
  label,
  isActive,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      className={cn(
        "relative flex items-center justify-center w-10 h-10 rounded-lg",
        "transition-opacity",
        isActive
          ? "bg-[#1e2940] ring-1 ring-primary/20 opacity-100"
          : "opacity-25 hover:opacity-70"
      )}
      style={isActive ? { filter: "drop-shadow(0 0 4px rgba(59,130,246,0.5))" } : undefined}
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
    >
      {icon}
    </button>
  );
}
```

- [ ] **Step 3: Update LLM Monitor button — same treatment, update badge text size**

Replace lines 91–111 (the LLM monitor button section):
```tsx
<button
  className={cn(
    "relative flex items-center justify-center w-10 h-10 rounded-lg transition-opacity",
    isMonitorOpen
      ? "bg-[#1e2940] ring-1 ring-primary/20 opacity-100"
      : "opacity-25 hover:opacity-70"
  )}
  style={isMonitorOpen ? { filter: "drop-shadow(0 0 4px rgba(59,130,246,0.5))" } : undefined}
  onClick={toggleMonitor}
  aria-label="LLM Monitor"
  data-testid="dock-llm-monitor"
>
  <Radio className="w-[18px] h-[18px]" />
  {monitorEventCount > 0 && !isMonitorOpen && (
    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-emerald-500 text-[10px] font-bold text-white flex items-center justify-center px-0.5" data-testid="llm-monitor-badge">
      {monitorEventCount > 99 ? "99+" : monitorEventCount}
    </span>
  )}
</button>
```

Note: `text-[9px]` → `text-[10px]` on the badge.

- [ ] **Step 4: Visual check & commit**

Run `npm run dev`. Check: dock is darker than sidebar, active icon has a blue glow tint, inactive icons are dim, hovering brightens them. No border-r line visible.

```bash
git add client/src/components/ide/tools-dock.tsx
git commit -m "style: tools dock — darker bg, glow active state, opacity hover treatment"
```

---

## Task 4: IDE Layout (`ide.tsx`)

**Files:**
- Modify: `client/src/pages/ide.tsx`

- [ ] **Step 1: Update panel border weights**

Change all 4 panel `ResizablePanel` className instances from `border-border/50` to `border-border/60`:

Line 99:
```tsx
// BEFORE
className="bg-background rounded-lg border border-border/50 overflow-hidden"
// AFTER
className="bg-background rounded-lg border border-border/60 overflow-hidden"
```

Line 120:
```tsx
// BEFORE
className="bg-background rounded-lg border border-border/50 overflow-hidden transition-all duration-300"
// AFTER
className="bg-background rounded-lg border border-border/60 overflow-hidden transition-all duration-300"
```

Line 132:
```tsx
// BEFORE
className="bg-background rounded-lg border border-border/50 overflow-hidden"
// AFTER
className="bg-background rounded-lg border border-border/60 overflow-hidden"
```

Line 148:
```tsx
// BEFORE
className="bg-background rounded-lg border border-border/50 overflow-hidden"
// AFTER
className="bg-background rounded-lg border border-border/60 overflow-hidden"
```

- [ ] **Step 2: Add hover state to ResizableHandle**

There are 3 ResizableHandle instances. Update them:

Line 105 (tool-panel handle):
```tsx
// BEFORE
<ResizableHandle className="w-0 bg-transparent" />
// AFTER
<ResizableHandle className="w-[3px] bg-transparent hover:bg-primary/10 transition-colors" />
```

Line 124 (editor/preview handle):
```tsx
// BEFORE
<ResizableHandle className="w-0 bg-transparent" />
// AFTER
<ResizableHandle className="w-[3px] bg-transparent hover:bg-primary/10 transition-colors" />
```

Line 141 (console handle):
```tsx
// BEFORE
<ResizableHandle className="h-0 bg-transparent" />
// AFTER
<ResizableHandle className="h-[3px] bg-transparent hover:bg-primary/10 transition-colors" />
```

- [ ] **Step 3: Visual check & commit**

Run `npm run dev`. Check: panel edges have slightly more visible borders. Drag the resize handles — they should show a subtle blue tint on hover.

```bash
git add client/src/pages/ide.tsx
git commit -m "style: panel border weight and ResizeHandle hover state"
```

---

## Task 5: Plan Card (`plan-components.tsx`)

**Files:**
- Modify: `client/src/components/ide/chat/plan-components.tsx`

Key changes: add progress bar to header, connector lines between steps, bigger status dots, tinted running row, animation on completion.

- [ ] **Step 1: Update StepItem — replace icon-based dots with custom SVG circles**

The current `StepItem` uses Lucide icons (`Circle`, `CheckCircle2`, etc.) for status dots. Replace the `icons` map and the wrapping div (lines 60–101) with explicit custom dots that match the spec:

```tsx
// Replace the entire icons map and the status dot render
const statusDotEl = (() => {
  switch (s) {
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
    case "running":
      return (
        <div className="w-4 h-4 rounded-full border-2 border-blue-400 bg-[#0d1829] flex items-center justify-center shrink-0">
          <div className="w-[6px] h-[6px] rounded-full bg-blue-400" />
        </div>
      );
    case "failed":
      return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
    case "needs-input":
      return <HelpCircle className="w-4 h-4 text-yellow-500 shrink-0" />;
    case "bug":
      return <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />;
    default: // pending
      return (
        <div className="w-4 h-4 rounded-full border border-border/40 bg-transparent shrink-0" />
      );
  }
})();
```

- [ ] **Step 2: Update StepItem row styling**

Replace the StepItem `return` (lines 91–145) with the new layout that includes connector line support. The `StepItem` now needs an `isLast` prop to know whether to show the connector line. Add `isLast?: boolean` to the props interface.

```tsx
// Add isLast to prop type:
// isLast?: boolean;

return (
  <div
    className={cn(
      "flex gap-[10px] items-start py-[6px] px-[6px] rounded-md -mx-1.5",
      "transition-colors",
      isRunning && "bg-[#1e2940]",
    )}
    data-testid={`step-${task.step}`}
  >
    {/* Dot + connector column */}
    <div className="flex flex-col items-center shrink-0" style={{ marginTop: 2 }}>
      {statusDotEl}
      {!isLast && (
        <div className="w-px bg-border/60 mt-[3px]" style={{ height: 18 }} />
      )}
    </div>

    {/* Content */}
    <div className="flex-1 flex items-center flex-wrap gap-x-2 min-w-0">
      {showNumber && (
        <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0 w-4 text-right leading-none">
          {task.step}.
        </span>
      )}
      <span
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
      >
        {task.title}
      </span>
      {isRunning && (
        <span
          className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded px-1.5 py-0.5 shrink-0 font-medium"
          data-testid={`step-building-${task.step}`}
        >
          Building…
        </span>
      )}
      {failureReasonLabel && (
        <span
          className="text-[10px] bg-red-500/15 text-red-400 border border-red-500/30 rounded px-1.5 py-0.5 shrink-0"
          data-testid={`step-failure-reason-${task.step}`}
        >
          {failureReasonLabel}
        </span>
      )}
    </div>
  </div>
);
```

- [ ] **Step 3: Add progress bar to TaskPlanCard header**

Find the `TaskPlanCard` component's card header (line 414: `<div className="px-3 pt-2.5 pb-1.5 border-b border-border/20 flex items-center gap-2">`). After this section's plan summary `<p>`, add the progress bar block. The `doneCount` and `total` variables are already computed in `TaskPlanCard`.

Insert this just before `</div>` that closes the header section (after the `<button onClick={() => setModalOpen(true)...}>` button):

```tsx
{isExecuting && total > 0 && (
  <div className="px-3 pt-1 pb-2 border-b border-border/20">
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[11px] text-primary font-semibold uppercase tracking-wide">
        Plan · {doneCount} of {total}
      </span>
      <span className="text-[11px] text-muted-foreground/60">
        {Math.round((doneCount / total) * 100)}%
      </span>
    </div>
    <div className="h-[2px] rounded-full bg-border/40 overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
        style={{ width: `${(doneCount / total) * 100}%` }}
      />
    </div>
  </div>
)}
```

Note: This block goes after the existing `hasRichSections` header div (after line ~426), before the step list section.

- [ ] **Step 4: Pass `isLast` prop to StepItem render sites**

Find all `<StepItem ... />` render calls and update them to pass `isLast`. There are 4 render sites (lines ~488-497, ~555-563, ~568-579, ~602-614). For each array map:

```tsx
// BEFORE
{visibleSteps.map((task: ManagerSubTask) => (
  <StepItem
    key={task.step}
    task={task}
    status={taskStatuses[String(task.step)]}
    failureReason={taskFailureReasons?.[String(task.step)]}
    isCompleted={isFullyComplete}
    showNumber
  />
))}

// AFTER
{visibleSteps.map((task: ManagerSubTask, idx: number) => (
  <StepItem
    key={task.step}
    task={task}
    status={taskStatuses[String(task.step)]}
    failureReason={taskFailureReasons?.[String(task.step)]}
    isCompleted={isFullyComplete}
    showNumber
    isLast={idx === visibleSteps.length - 1}
  />
))}
```

Apply the same `isLast` change to all 4 `StepItem` render sites (both `showNumber` and non-`showNumber` variants, inside peek step blocks too — for peek steps, always pass `isLast={false}` since there's always a connector).

- [ ] **Step 5: Visual check & commit**

Run `npm run dev`. Start a new plan build cycle. Check: progress bar appears during execution, connector lines link steps, running step has blue tinted row, pending steps are very muted.

```bash
git add client/src/components/ide/chat/plan-components.tsx
git commit -m "style: plan card — progress bar, connector lines, step dot sizing, running row tint"
```

---

## Task 6: Message Components (`message-components.tsx`)

**Files:**
- Modify: `client/src/components/ide/chat/message-components.tsx`

Key changes: AI narration text size, BuildCompletionCard redesign with file pills and summary.

- [ ] **Step 1: Update AI narration font size**

The `MessageBubble` component renders AI messages at `text-[13px]` already (line 312 — already correct). Check `NarrationBubble` in `plan-components.tsx` line 273: `"px-3 text-[13px] leading-relaxed text-foreground"` — also already 13px. 

The only change needed here: ensure the assistant `MessageBubble` uses `leading-[1.65]`:

Change line 312:
```tsx
// BEFORE
className="px-3 text-[13px] leading-relaxed text-foreground"

// AFTER
className="px-3 text-[13px] leading-[1.65] text-foreground"
```

- [ ] **Step 2: Redesign BuildCompletionCard header**

The current header (lines 441–452) has a gradient-bordered card with `CheckCircle2` icon. Replace it:

```tsx
// BEFORE (lines 439-452)
<div
  className="mx-3 mt-2 mb-1 rounded-lg border border-green-500/25 bg-green-500/[0.04] overflow-hidden"
  data-testid="build-completion-card"
>
  <div className="px-3 py-2 border-b border-green-500/15 flex items-start gap-2">
    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
    <span
      className="text-[12.5px] font-semibold text-green-500 leading-snug"
      data-testid="completion-headline"
    >
      {headline}
    </span>
  </div>

// AFTER
<div
  className="mx-3 mt-2 mb-1 rounded-lg border border-green-900/40 bg-[#0d1a0f] overflow-hidden"
  style={{ animation: "fade-up 150ms ease" }}
  data-testid="build-completion-card"
>
  <div className="px-3 py-3 border-b border-green-900/30">
    <div className="flex items-center gap-2 mb-2">
      <div className="w-[22px] h-[22px] rounded-full bg-green-600 flex items-center justify-center shrink-0">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <polyline points="2,5.5 4.5,8 9,2.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <span
        className="text-[14px] font-semibold text-green-400 leading-snug"
        data-testid="completion-headline"
      >
        Done
      </span>
    </div>
    {summary && (
      <p className="text-[13px] text-slate-300 leading-relaxed">
        {summary}
      </p>
    )}
  </div>
```

- [ ] **Step 3: Replace file list with pill chips**

Find the `parsed.fileChanges` section (lines 462–482) and replace it with pills. Also add a footer prompt.

Replace from the `{parsed && parsed.fileChanges.length > 0 && (` block through to the end of the component (before the final `</div>`):

```tsx
{parsed && parsed.fileChanges.length > 0 && (
  <div className="px-3 py-2.5">
    <div className="flex flex-wrap gap-1.5">
      {parsed.fileChanges.map((change, i) => (
        <span
          key={i}
          className="bg-[#0f2415] border border-green-900/40 rounded px-2 py-0.5 text-[11px] font-mono text-green-400"
          data-testid={`file-change-${i}`}
        >
          {change}
        </span>
      ))}
    </div>
  </div>
)}

{parsed && !parsed.fileChanges.length && summary && (
  <div className="px-3 py-2">
    <p className="text-[11.5px] text-foreground/75 leading-relaxed whitespace-pre-wrap">
      {summary}
    </p>
  </div>
)}

{changedFiles.length > 0 && (
  <div className="px-3 py-2 border-t border-green-900/20">
    <div className="flex flex-wrap gap-1.5">
      {changedFiles.map((f, i) => (
        <span
          key={i}
          className="bg-[#0f2415] border border-green-900/40 rounded px-2 py-0.5 text-[11px] font-mono text-green-400"
          data-testid={`changed-file-${i}`}
        >
          {f.split("/").pop() || f}
        </span>
      ))}
    </div>
  </div>
)}

<div className="px-3 py-2 border-t border-green-900/20">
  <p className="text-[12px] text-muted-foreground">What should we build next?</p>
</div>
```

Remove the old `showFiles` state and the toggle button (lines 427–531 original structure) — replace them entirely with the above.

- [ ] **Step 4: Visual check & commit**

Run `npm run dev`. Trigger a build cycle. After it completes, check: the completion card shows a SVG checkmark in a green circle, summary text, file pills, and "What should we build next?" footer. No emoji.

```bash
git add client/src/components/ide/chat/message-components.tsx
git commit -m "style: AI narration line height, BuildCompletionCard pills and fade-up animation"
```

---

## Task 7: Action Log (`action-log.tsx`)

**Files:**
- Modify: `client/src/components/ide/chat/action-log.tsx`

Key changes: write rows get green left-border accent with file-flash animation, thinking row gets indigo treatment with animated dots, consecutive reads are collapsed, all rows get fade-up on mount, font 12px.

- [ ] **Step 1: Update ActionLogLiveRow — write row green styling + animations**

Find `ActionLogLiveRow` (line 90–146). The current row uses `getActionLogColor(entry.type)` for all styling. Add conditional styling for file writes:

```tsx
export function ActionLogLiveRow({
  entry,
  showCodePreview,
}: {
  entry: ActionLogEntry;
  showCodePreview?: boolean;
}) {
  const color = getActionLogColor(entry.type);
  const icon = getActionLogIcon(entry.type);
  const label =
    entry.label.length > 50 ? entry.label.slice(0, 50) + "…" : entry.label;
  const isFileEntry = entry.type === "file_write" || entry.type === "file_read";
  const isWrite = entry.type === "file_write";

  return (
    <div
      className="space-y-0"
      style={{ animation: "fade-up 150ms ease" }}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 py-[5px] text-[12px] rounded-md",
          isWrite
            ? "border-l-2 border-green-500 bg-[#0d1f12] px-2"
            : `${color} px-1`,
          isWrite && "animate-in fade-in duration-200"
        )}
        style={isWrite ? { animation: "file-flash 600ms ease-out, fade-up 150ms ease" } : undefined}
      >
        {icon}
        <span className={cn(
          "truncate leading-tight font-medium",
          isWrite && "text-green-400"
        )}>
          {label}
        </span>
        {isWrite && (
          <span className="ml-auto shrink-0 text-green-600 text-[11px]">
            {entry.filePath ? (entry.label.toLowerCase().includes("creat") ? "created" : "edited") : "written"}
          </span>
        )}
        {!isWrite && isFileEntry && entry.filePath && (
          <span className="ml-auto shrink-0 text-muted-foreground/40 text-[10px] font-mono">
            {entry.filePath}
          </span>
        )}
      </div>
      {showCodePreview && isFileEntry && entry.detail && entry.detail.trim().length > 0 && (
        <div
          className="rounded overflow-hidden text-[10px] font-mono leading-relaxed max-h-[120px] overflow-y-hidden relative"
          style={{ backgroundColor: "#1E1E1E", color: "#D4D4D4" }}
        >
          <div
            className="absolute inset-x-0 bottom-0 h-8 pointer-events-none"
            style={{ background: "linear-gradient(transparent, #1E1E1E)" }}
          />
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <tbody>
              {entry.detail
                .split("\n")
                .slice(0, 20)
                .map((line, li) => (
                  <tr key={li} style={{ height: "17px" }}>
                    <td
                      className="select-none text-right sticky left-0"
                      style={{
                        padding: "0 5px",
                        color: "#858585",
                        width: "32px",
                        minWidth: "32px",
                        borderRight: "1px solid #333",
                        backgroundColor: "#1E1E1E",
                      }}
                    >
                      {li + 1}
                    </td>
                    <td style={{ padding: "0 8px", whiteSpace: "pre" }}>
                      <code>{line}</code>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update ThinkingStream — indigo treatment with animated dots**

Replace `ThinkingStream` (lines 148–173):

```tsx
export function ThinkingStream({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <div
      ref={containerRef}
      className="max-h-[180px] overflow-y-auto rounded-md bg-[#1a1a2e] border border-indigo-900/50 px-3 py-2"
      style={{ animation: "fade-up 150ms ease" }}
      data-testid="thinking-stream"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Brain className="w-3 h-3 shrink-0 text-indigo-400" />
        <span className="text-[11px] font-medium text-indigo-400 uppercase tracking-wide">
          Thinking
        </span>
        <div className="flex gap-[3px] ml-auto items-center">
          <div className="w-[4px] h-[4px] rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: "0ms" }} />
          <div className="w-[4px] h-[4px] rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: "150ms" }} />
          <div className="w-[4px] h-[4px] rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
      <p className="text-[12px] leading-relaxed italic text-muted-foreground/80 whitespace-pre-wrap break-words">
        {text}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Update ActionLogLive — collapse consecutive reads**

The current `ActionLogLive` uses `groupConsecutiveEntries` (already exists). The grouped reads are shown via `GroupedActionRow`. The change: add a "Read N files" collapsed summary row for read-type groups instead of showing them individually.

Update `GroupedActionRow` — when `group.type === "file_read"` and count > 1, render the compact "Read N files" row:

```tsx
function GroupedActionRow({ group }: { group: ActionGroup }) {
  const [expanded, setExpanded] = useState(false);
  const count = group.entries.length;
  const color = getActionLogColor(group.type);

  if (count === 1) {
    return <ActionLogLiveRow entry={group.entries[0]} />;
  }

  // Compact read-collapse row
  if (group.type === "file_read") {
    const fileNames = group.entries
      .map(e => e.filePath?.split("/").pop() || e.label)
      .filter(Boolean)
      .slice(0, 4)
      .join(", ");
    return (
      <div
        className="flex items-center gap-1.5 py-[5px] px-1 text-[12px] rounded-md"
        style={{ animation: "fade-up 150ms ease" }}
      >
        {getActionLogIcon("file_read")}
        <span className="text-muted-foreground/60">Read {count} files</span>
        {fileNames && (
          <span className="text-muted-foreground/30 text-[11px] truncate ml-1">{fileNames}</span>
        )}
      </div>
    );
  }

  const label = getGroupLabel(group.type, count);
  const previewIcons = group.entries.slice(0, 3);

  return (
    <div
      className="border border-border/20 rounded-md overflow-hidden"
      style={{ animation: "fade-up 150ms ease" }}
    >
      <button
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-[5px] text-[12px] hover:bg-muted/30 transition-colors text-left",
          color,
        )}
        onClick={() => setExpanded((e) => !e)}
        data-testid={`grouped-action-row-${group.type}`}
      >
        <div className="flex items-center gap-0.5">
          {previewIcons.map((e, i) => (
            <span key={i} className="opacity-60">{getActionLogIcon(e.type)}</span>
          ))}
        </div>
        <span className="flex-1 truncate leading-tight font-medium">{label}</span>
        <span className="shrink-0 text-muted-foreground/40">
          {expanded ? (
            <ChevronDown className="w-2.5 h-2.5" />
          ) : (
            <ChevronRight className="w-2.5 h-2.5" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/15 px-2 py-1 space-y-0.5">
          {group.entries.map((entry, i) => (
            <ActionLogLiveRow key={i} entry={entry} showCodePreview />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Visual check & commit**

Run `npm run dev`. Trigger a build. Check: thinking row is indigo with animated dots, file write rows have green left border, consecutive reads collapse to "Read N files", new rows fade up.

```bash
git add client/src/components/ide/chat/action-log.tsx
git commit -m "style: action log — write row green accent, indigo thinking, read-collapse, fade-up animations"
```

---

## Task 8: Preview Toolbar (`preview-panel.tsx`)

**Files:**
- Modify: `client/src/components/ide/preview-panel.tsx`

Key changes: toolbar height h-9 → h-[38px], icon buttons unified to `w-7 h-[26px]`, add empty/compiling/error states.

- [ ] **Step 1: Update toolbar container height and add grouping classes**

Change line 336:
```tsx
// BEFORE
<div className="flex items-center gap-1.5 px-2 h-9 border-b border-border/50 shrink-0 flex-wrap">

// AFTER
<div className="flex items-center px-2 h-[38px] border-b border-border shrink-0 gap-2">
```

Remove the Smartphone icon line (337) — the framework badge already identifies the platform. Delete:
```tsx
<Smartphone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
```

- [ ] **Step 2: Update framework badge size**

Change line 340:
```tsx
// BEFORE
className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${getFrameworkColor(framework)}`}

// AFTER
className={`text-[11px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${getFrameworkColor(framework)}`}
```

- [ ] **Step 3: Update platform toggle to pill style**

Replace lines 346–372 (the iOS/Android toggle div):
```tsx
<div className="flex items-center bg-muted border border-border rounded-lg p-[3px] gap-[1px]">
  <button
    className={cn(
      "flex items-center justify-center px-2 h-[20px] text-xs rounded-md transition-colors",
      devicePlatform === "ios"
        ? "bg-muted-foreground/20 text-foreground"
        : "text-muted-foreground hover:text-foreground"
    )}
    onClick={() => handlePlatformChange("ios")}
    data-testid="button-platform-ios"
  >
    iOS
  </button>
  <button
    className={cn(
      "flex items-center justify-center px-2 h-[20px] text-xs rounded-md transition-colors",
      devicePlatform === "android"
        ? "bg-muted-foreground/20 text-foreground"
        : "text-muted-foreground hover:text-foreground"
    )}
    onClick={() => handlePlatformChange("android")}
    data-testid="button-platform-android"
  >
    Android
  </button>
</div>
```

Note: Remove `import { ... Smartphone ... }` from the import list, and remove the `<img src={appleLogoPath}` approach — use text labels instead (no emoji, just text).

- [ ] **Step 4: Unify icon buttons to w-7 h-[26px] size**

Change all `h-6 w-6 shrink-0` icon button sizes on lines 427, 442, 463, 507, 520, 539:
```tsx
// BEFORE (each instance)
className="h-6 w-6 shrink-0"

// AFTER (each instance)
className="h-[26px] w-7 rounded-md bg-muted border border-border shrink-0 hover:bg-muted/80 hover:border-border/80 transition-colors"
```

- [ ] **Step 5: Add empty state placeholder inside DeviceSimulator**

The store provides `previewFile` and `previewOverrideHtml`. An "empty" state means neither has been set (user hasn't pressed Run yet). No store changes — just a conditional UI inside the DeviceSimulator children.

Find the DeviceSimulator children block (line 555). Add the "not yet run" state as the first condition, before the existing `previewMode === "kotlin-wasm"` check:

```tsx
<DeviceSimulator
  deviceSpec={deviceSpec}
  orientation={deviceOrientation}
  frameStyle={deviceFrameStyle}
  platformOverride={devicePlatform}
>
  {/* Empty state — no preview content loaded yet */}
  {!previewOverrideHtml && !previewFile && previewMode === "iframe-preview" ? (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background"
      style={{ animation: "fade-up 150ms ease" }}
    >
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-muted-foreground/20">
        <rect x="4" y="4" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 10l7 4-7 4V10z" fill="currentColor" />
      </svg>
      <p className="text-[12px] text-muted-foreground/40">Run your project to see the preview</p>
    </div>
  ) : previewMode === "kotlin-wasm" || previewMode === "swift-wasm" ? (
    ...rest of existing conditions unchanged...
  )}
</DeviceSimulator>
```

Note: `previewMode` is `"iframe-preview"` for web projects (returned by `getPreviewMode("web")`). For other frameworks (rn-web, flutter-web, etc.) the preview auto-loads without needing Run, so the empty state only applies to `"iframe-preview"` mode. Keep all existing branches intact, just prepend the empty state conditional.

- [ ] **Step 6: Visual check & commit**

Run `npm run dev`. Check: toolbar is 38px, platform toggle is a pill, icon buttons are uniformly sized with border, framework badge is 11px. Navigate to an IDE page without running — check the empty state placeholder appears.

```bash
git add client/src/components/ide/preview-panel.tsx
git commit -m "style: preview toolbar grouping, icon button unification, empty state placeholder"
```

---

## Task 9: Device Simulator (`device-simulator.tsx`)

**Files:**
- Modify: `client/src/components/ide/device-simulator.tsx`

Key changes: frame gradient, side button widths 3px → 2px, home bar color.

- [ ] **Step 1: Update frameBg to gradient and dark frame shadow**

Find line 280:
```tsx
// BEFORE
const frameBg = isDark ? "#1a1a1c" : "#e0e0e4";
```

This variable is used as `backgroundColor` in the inline style on the device frame div. Change it to use a gradient by moving it to the inline style directly:

```tsx
// BEFORE (line 280)
const frameBg = isDark ? "#1a1a1c" : "#e0e0e4";

// AFTER
const frameBg = isDark ? undefined : "#e0e0e4";
const frameGradient = isDark ? "linear-gradient(160deg, #2a2a2e, #111114)" : undefined;
```

Then update the device frame div's `style` (line 303–313) to use `background` instead of `backgroundColor` for dark mode:
```tsx
style={{
  width: totalW,
  height: totalH,
  borderRadius: outerRadius,
  background: frameGradient || frameBg,
  border: `2.5px solid ${frameEdge}`,
  boxShadow: isDark
    ? `0 4px 20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06), 0 30px 90px rgba(0,0,0,0.95), 0 8px 30px rgba(0,0,0,0.7), inset 0 -0.5px 0 rgba(0,0,0,0.3)`
    : `0 2px 12px rgba(0,0,0,0.15), 0 30px 90px rgba(0,0,0,0.2), 0 8px 30px rgba(0,0,0,0.1), inset 0 0.5px 0 rgba(255,255,255,0.9), inset 0 -0.5px 0 rgba(0,0,0,0.05)`,
  transition: "width 0.35s cubic-bezier(0.4, 0, 0.2, 1), height 0.35s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.35s ease",
}}
```

- [ ] **Step 2: Update side button widths from 3px to 2px and color**

In `SideButtons` (line 165–226), update `btnColor` for dark mode and all `width: 3` to `width: 2`:

```tsx
// BEFORE (line 166)
const btnColor = isDark ? "#2a2a2c" : "#b0b0b4";

// AFTER
const btnColor = isDark ? "#3a3a3e" : "#b0b0b4";
```

Then change every `width: 3` inline style and every `right: -3`/`left: -3` to `width: 2`, `right: -2`, `left: -2` in the 4 button divs (lines 172–223).

For example, the first button:
```tsx
// BEFORE
style={{
  right: -3,
  top: height * 0.18,
  width: 3,
  ...
}}

// AFTER
style={{
  right: -2,
  top: height * 0.18,
  width: 2,
  ...
}}
```

Apply this to all 4 SideButtons divs. Also update `border: 2.5px` on the outer frame to `border: 1.5px` for dark mode:

```tsx
border: isDark ? `1.5px solid ${frameEdge}` : `2.5px solid ${frameEdge}`,
```

- [ ] **Step 3: Update home bar opacity**

`IOSHomeIndicator` is at line 124. The bar's `backgroundColor` is currently `rgba(255,255,255,0.3)` for dark mode. Reduce to `rgba(255,255,255,0.15)`:

```tsx
// BEFORE (line 132)
backgroundColor: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)",

// AFTER
backgroundColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)",
```

- [ ] **Step 4: Visual check & commit**

Run `npm run dev`. Open the preview panel. Check: dark frame has a gradient body (lighter at top-left), side buttons are thinner, frame has a subtle top-edge highlight. Toggle light frame style to confirm it still looks clean.

```bash
git add client/src/components/ide/device-simulator.tsx
git commit -m "style: device simulator frame gradient, thinner side buttons, home bar polish"
```

---

## Task 10: Micro-animation Sweep — Transition Token Adoption

**Files:**
- Modify: `client/src/components/ide/navbar.tsx`
- Modify: `client/src/components/ide/tools-dock.tsx`
- Modify: `client/src/components/ide/chat/plan-components.tsx`
- Modify: `client/src/components/ide/chat/action-log.tsx`

This is a sweep pass to replace hardcoded `transition-*` Tailwind classes with CSS var references.

- [ ] **Step 1: Sweep navbar.tsx**

Replace `transition-colors` with `[transition:var(--transition-fast)]` on the back button, layout toggle buttons, and eye toggle button. Replace `transition-all duration-300` on editor-pane (in ide.tsx) with `[transition:var(--transition-slow)]`:

In `navbar.tsx`, change all `transition-colors` in buttons:
```tsx
// Pattern: className="... transition-colors ..."
// Replace with: className="... [transition:var(--transition-fast)] ..."
```

- [ ] **Step 2: Sweep tools-dock.tsx**

Replace `transition-opacity` with `[transition:var(--transition-fast)]` in DockButton and LLM Monitor button.

- [ ] **Step 3: Update ide.tsx panel transition**

In `ide.tsx` line 120:
```tsx
// BEFORE
className="bg-background rounded-lg border border-border/60 overflow-hidden transition-all duration-300"

// AFTER
className="bg-background rounded-lg border border-border/60 overflow-hidden [transition:var(--transition-slow)]"
```

- [ ] **Step 4: Visual check & commit**

Run `npm run dev`. Hover over toolbar buttons — transitions should feel the same as before (just sourced from vars now).

```bash
git add client/src/components/ide/navbar.tsx client/src/components/ide/tools-dock.tsx client/src/pages/ide.tsx
git commit -m "style: adopt CSS transition tokens across interactive elements"
```

---

## Verification

1. **TypeScript check:** `npm run check` — must pass with 0 errors
2. **Dev server:** `npm run dev` — open `http://localhost:5000`
3. **Visual checklist:**
   - [ ] Navbar: 44px tall, darker bg, back button is a box, layout toggle is centered, Run button has gradient
   - [ ] Tools dock: darker bg than sidebar, active icon glows blue, inactive icons are dim at ~25%, hovering brightens
   - [ ] Plan card: progress bar shows during execution, step dots are 16×16px, running step has blue tinted row, pending steps very muted
   - [ ] Build completion: SVG checkmark, file pills, summary text, "What should we build next?" footer, no emoji
   - [ ] Action log: write rows have green left border, thinking row is indigo with dots, consecutive reads collapsed
   - [ ] Preview toolbar: 38px tall, platform toggle is a pill, all icon buttons same size with border
   - [ ] Device frame: gradient body (dark), thinner side buttons
   - [ ] Light/dark toggle: every surface looks intentional in both modes
4. **Trigger full plan + build cycle:** verify plan card animations, action log grouping, completion card
5. **Resize panels:** verify ResizeHandle hover tint visible on drag targets
