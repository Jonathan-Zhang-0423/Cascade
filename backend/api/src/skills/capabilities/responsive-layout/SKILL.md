# Responsive Layout Skill

How to build layouts that work from a 320px phone to a wide desktop without
per-device hacks: mobile-first defaults, fluid sizing, modern CSS layout, and the
touch/safe-area details that break on real devices.

## Mobile-first: base styles are the small screen

Write the phone layout as the default (no media query), then add complexity upward
with `min-width` queries. This keeps the simplest case unconditional and avoids
overriding desktop styles back down.

```css
.grid { display: grid; gap: 16px; grid-template-columns: 1fr; }      /* phone */
@media (min-width: 640px)  { .grid { grid-template-columns: repeat(2,1fr); } }
@media (min-width: 1024px) { .grid { grid-template-columns: repeat(4,1fr); } }
```

Pick breakpoints from where YOUR content breaks, not device names. Common anchors:
~480 (large phone), ~768 (tablet), ~1024 (laptop), ~1280 (wide).

## Prefer intrinsic layout over breakpoints

The best responsive code has few or no media queries. Let the browser do the math:

```css
/* Auto-fitting card grid — reflows itself, no breakpoints */
.cards { display: grid; gap: 16px;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); }

/* Sidebar that drops below content when space is tight */
.with-sidebar { display: flex; flex-wrap: wrap; gap: 24px; }
.with-sidebar > .main { flex: 1 1 60%; min-width: min(100%, 420px); }
.with-sidebar > .side { flex: 1 1 220px; }
```

`min()/max()/clamp()` replace most width queries:

```css
.container { width: min(100% - 32px, 1100px); margin-inline: auto; }
.hero { font-size: clamp(1.75rem, 1rem + 4vw, 3.5rem); }
```

## Fluid units, not fixed pixels

- Type and spacing that should scale → `rem` + `clamp()`. Fixed hairlines → `px`.
- Widths → `%`, `fr`, `minmax`, `min()`; avoid fixed `width` on containers.
- Never set heights that must contain text in px; let content drive height.

## Container queries — components that adapt to their slot

A card in a sidebar vs a full-width row should differ by its OWN width, not the
viewport. Use container queries for reusable components:

```css
.card-wrap { container-type: inline-size; }
.card { display: grid; gap: 8px; }
@container (min-width: 360px) { .card { grid-template-columns: 96px 1fr; } }
```

## Touch, viewport & safe areas (real-device gotchas)

```css
/* Tap targets ≥ 44×44px */
.btn, a.nav-link { min-height: 44px; min-width: 44px; }

/* Honor notches / home indicators */
.app-bar { padding-top: env(safe-area-inset-top); }
.tabbar  { padding-bottom: env(safe-area-inset-bottom); }
```

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

- Use `100dvh` (dynamic viewport height) instead of `100vh` so mobile browser chrome
  doesn't cut off content.
- Make media fluid: `img, video, svg { max-width: 100%; height: auto; }`.
- Allow horizontal scroll ONLY for intentional carousels/tables (`overflow-x:auto`);
  a page-level horizontal scrollbar is always a bug.

## Tables & overflow on small screens

Wide tables don't fit phones. Wrap them and let the table scroll, or switch to a
stacked card layout under a breakpoint. Keep the header visible.

```css
.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
```

## Self-check

- [ ] Layout written mobile-first; complexity added with `min-width`.
- [ ] No fixed-px container widths; uses `%`/`fr`/`minmax`/`clamp`/`min()`.
- [ ] Auto-fit grids / flex-wrap used instead of breakpoints where possible.
- [ ] No horizontal page scroll at 320px; media capped to `max-width:100%`.
- [ ] Tap targets ≥44px; `dvh` + `safe-area-inset` handled; viewport meta set.
- [ ] Wide tables scroll or restack instead of overflowing the page.
