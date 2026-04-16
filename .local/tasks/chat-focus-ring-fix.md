# Fix inconsistent focus ring on chat input box

## What & Why
The chat input box shows an uneven glow when focused. The current shadow
`shadow-[0_0_0_2px_hsl(var(--primary)/0.1)]` uses 0 blur radius, which
creates a hard hairline ring. This ring looks visible against the dark
message area at the top but vanishes against the lighter panel background
at the sides and bottom, making the focus style look broken/inconsistent.

## Done looks like
- The focus ring looks uniform on all four sides of the input box
- The glow is visible regardless of what sits above, below, or beside the box

## Implementation
In `client/src/components/ide/chat-panel.tsx`, change the focused state
class string inside the `cn()` call on `inputBoxRef`'s div from:

```
"border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.1)] bg-background/80"
```

to:

```
"border-primary ring-2 ring-primary/20 bg-background/80"
```

Tailwind's `ring` utilities render as CSS `box-shadow` with proper offset
and are not clipped by `overflow: hidden`, giving perfectly even coverage
on all four sides.

## Relevant files
- `client/src/components/ide/chat-panel.tsx` (~line 2274)
