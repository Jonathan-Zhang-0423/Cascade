# Chat input formatting tweaks

## Changes

### 1. Smart Response icon: Sparkles → Lightbulb
In `client/src/components/ide/chat-panel.tsx`:
- Add `Lightbulb` to the lucide-react import (it is already imported from lucide-react, just add Lightbulb)
- Replace `<Sparkles className="w-3.5 h-3.5" />` inside the Smart Response button with `<Lightbulb className="w-3.5 h-3.5" />`
- Keep `Sparkles` import if used elsewhere in the file; remove if not

### 2. Auto-growing textarea (max 10 lines)
The Textarea currently has `rows={2}` and `max-h-[120px]` which keeps it at a fixed 2-line height regardless of content.

Replace with a dynamic height approach:
- Remove `rows={2}` and `max-h-[120px]` from the Textarea className
- Add a `useEffect` (or inline handler on `onChange`) that auto-resizes the textarea:
  ```ts
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
    el.style.height = Math.min(el.scrollHeight, lineHeight * 10) + "px";
  }, [input]);
  ```
- Set `min-h-[60px]` (2 lines minimum) and no explicit max-h (height is JS-controlled)
- Keep `overflow-y-auto` on the textarea so content beyond 10 lines is still scrollable

## Relevant files
- `client/src/components/ide/chat-panel.tsx`
