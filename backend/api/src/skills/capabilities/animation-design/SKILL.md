# Animation Design Skill

How to add motion that feels intentional and fast: the right properties to animate,
natural easing, enter/exit and list transitions, micro-interactions, and respecting
users who don't want motion. Good motion clarifies cause and effect — it is never
decoration for its own sake.

## Only animate cheap properties

Animate `transform` and `opacity` — they run on the compositor and don't trigger
layout/paint. Animating `width`, `height`, `top`, `left`, `margin` causes reflow and
jank. Need a size change? Use `transform: scale()` or animate `max-height` sparingly.

```css
/* Good: 60fps */ .x { transition: transform .2s ease, opacity .2s ease; }
/* Bad: janky  */ .y { transition: width .2s, top .2s, margin .2s; }
```

Add `will-change: transform` only on elements about to animate, and remove it after —
leaving it on permanently wastes memory.

## Easing & duration — the feel lives here

Linear motion feels robotic. Use ease-out for things entering (fast then settle),
ease-in for things leaving, and a custom curve for personality.

```css
:root {
  --ease-out: cubic-bezier(.16,1,.3,1);     /* snappy entrance */
  --ease-in-out: cubic-bezier(.65,0,.35,1); /* smooth move */
  --dur-fast:120ms; --dur-base:200ms; --dur-slow:320ms;
}
```

Duration guide: micro-feedback (hover/press) 80–150ms; most UI transitions
150–250ms; larger surfaces (modals/sheets) 250–350ms. Anything over ~400ms feels
sluggish. Smaller/closer elements should move faster than larger/farther ones.

## Micro-interactions

Every interactive element confirms input instantly. Press feedback should fire on
`:active`, not wait for the network.

```css
.btn { transition: transform var(--dur-fast) var(--ease-out), background var(--dur-fast); }
.btn:hover  { background: var(--accent-hover); }
.btn:active { transform: scale(.97); }
```

Keyframed attention cues — keep them subtle and short:

```css
@keyframes pop { from { transform: scale(.8); opacity:0 } to { transform: scale(1); opacity:1 } }
.badge-new { animation: pop var(--dur-base) var(--ease-out); }
```

## Enter / exit transitions

Elements should not pop in/out. Fade + small translate (8–16px) reads as "arriving".
For mount/unmount in frameworks, drive a state class and let CSS handle it; in React,
use a library (Framer Motion) or a `data-state` attribute with transitions.

```css
.toast { opacity:0; transform: translateY(12px); transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out); }
.toast[data-state="open"] { opacity:1; transform: translateY(0); }
```

## Lists & shared layout

Stagger list items by a small per-item delay so they cascade instead of flashing
together. Keep total stagger under ~300ms so it never feels slow.

```css
.item { animation: rise var(--dur-base) var(--ease-out) backwards; }
.item:nth-child(1){animation-delay:0ms} .item:nth-child(2){animation-delay:40ms}
.item:nth-child(3){animation-delay:80ms} /* … or set via inline --i */
@keyframes rise { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
```

For reordering/layout changes, prefer the FLIP technique (or a library that does it)
rather than animating layout properties directly.

## Loading & progress motion

Use a skeleton shimmer or a spinner for waits; never a frozen screen. Match the
skeleton shape to the real content so the swap is calm.

```css
@keyframes shimmer { to { background-position-x: -200%; } }
.skeleton { background: linear-gradient(90deg,#eee 25%,#f5f5f5 37%,#eee 63%) 0/200% 100%;
  animation: shimmer 1.2s infinite linear; border-radius: var(--radius-sm); }
```

## Accessibility — honor reduced motion

Some users get motion sickness. Gate non-essential motion behind the media query and
keep a near-instant fallback so the UI still updates.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration:.01ms !important; animation-iteration-count:1 !important;
    transition-duration:.01ms !important; scroll-behavior:auto !important;
  }
}
```

## Self-check

- [ ] Only `transform`/`opacity` animated on hot paths; no layout-triggering transitions.
- [ ] Ease-out for entrances, durations 120–320ms, smaller = faster.
- [ ] Press/hover give instant feedback; loading states are animated, not frozen.
- [ ] Enter/exit use fade + small translate; lists stagger under 300ms total.
- [ ] `prefers-reduced-motion` disables non-essential motion.
- [ ] No infinite distracting loops near text the user is trying to read.
