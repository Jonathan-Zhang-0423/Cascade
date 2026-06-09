# Frontend Design Skill

How to make a UI look intentional instead of default: visual hierarchy, a spacing
and color system, readable typography, responsive layout, and interaction feedback —
plus the accessibility basics that come for free when you build it right.

## Design Tokens — decide once, reuse everywhere

Never hardcode random pixel and hex values. Define a small scale and pull from it.
A consistent scale is what separates "designed" from "thrown together".

```css
:root {
  /* Spacing — 4px base, used for margin/padding/gap everywhere */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px; --space-12: 48px;

  /* Type scale — ~1.25 ratio */
  --text-sm: 0.875rem; --text-base: 1rem; --text-lg: 1.25rem;
  --text-xl: 1.5rem;   --text-2xl: 2rem;  --text-3xl: 2.5rem;

  /* Color — one accent, neutrals, semantic states */
  --bg: #ffffff;       --surface: #f7f7f8;  --border: #e4e4e7;
  --text: #18181b;     --text-muted: #71717a;
  --accent: #4f46e5;   --accent-hover: #4338ca;
  --danger: #dc2626;   --success: #16a34a;

  --radius: 8px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.06);
  --shadow-md: 0 4px 12px rgba(0,0,0,.10);
}
```

## Visual Hierarchy

Guide the eye by contrast in **size, weight, and color** — not by adding more
decoration. One clear primary action per screen.

- Headings large + bold; body text `--text-base`; secondary info `--text-muted` and smaller.
- Limit to 2–3 font sizes per view. Limit weights to regular (400) and semibold (600).
- Give the primary button the accent fill; secondary actions get an outline or ghost style.
- Use whitespace to group related things and separate unrelated ones (proximity > borders).

## Layout — flex and grid

```css
/* Stack with consistent rhythm */
.stack { display: flex; flex-direction: column; gap: var(--space-4); }
/* Row that wraps */
.row   { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
/* Responsive card grid — no media query needed */
.grid  { display: grid; gap: var(--space-4);
         grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
/* Constrain reading width */
.container { max-width: 1100px; margin-inline: auto; padding-inline: var(--space-4); }
```

## Responsive

Mobile-first: base styles target small screens, `min-width` queries add complexity up.

```css
.sidebar-layout { display: grid; grid-template-columns: 1fr; gap: var(--space-6); }
@media (min-width: 768px) {
  .sidebar-layout { grid-template-columns: 260px 1fr; }
}
```

Use relative units (`rem`, `%`, `fr`, `clamp()`) for anything that should scale.
`font-size: clamp(1.5rem, 4vw, 2.5rem)` gives fluid headings without breakpoints.

## Interaction Feedback

Every interactive element needs visible states. Silence feels broken.

```css
.btn {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius);
  background: var(--accent); color: #fff; border: 0;
  cursor: pointer;
  transition: background .15s ease, transform .05s ease;
}
.btn:hover  { background: var(--accent-hover); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn[aria-busy="true"] { pointer-events: none; opacity: .7; }
```

Show loading, empty, and error states — not just the happy path (a blank screen
reads as a bug). Animate transitions at 150–250ms; longer feels sluggish.

## Accessibility basics (built in, not bolted on)

- Use semantic elements: `<button>` for actions, `<a>` for navigation, `<nav>/<main>/<header>`, one `<h1>` then logical heading order.
- Every input needs a `<label>` (or `aria-label`). Every meaningful image needs `alt`.
- Body text contrast ≥ 4.5:1 against its background. Don't convey state by color alone — pair with text/icon.
- Keyboard: everything clickable must be focusable and operable with Enter/Space, with a visible `:focus-visible` ring.
- Respect `prefers-reduced-motion` — disable non-essential animation.

```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

## Common Pitfalls
- Random magic numbers (`margin: 13px`) instead of the spacing scale — looks noisy and inconsistent.
- Pure black `#000` on pure white — harsh; use `#18181b` on `#fff`.
- Removing focus outlines (`outline: none`) without a replacement — breaks keyboard nav.
- Too many accent colors — pick one accent and lean on neutrals.
- Fixed pixel widths that overflow on mobile — use `max-width` + `%`/`fr`.
- Low-contrast muted text (light gray on white) — fails readability.
- Divs with click handlers instead of `<button>` — loses keyboard + screen-reader support.

## Code Style
- Centralize tokens in `:root`; reference with `var(--token)`.
- Compose layout with utility classes (`.stack`, `.row`, `.grid`) over one-off rules.
- Keep specificity flat — prefer single classes over deep selectors.
