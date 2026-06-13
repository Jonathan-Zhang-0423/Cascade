# Art Direction Skill

How to give an app a deliberate visual identity instead of default-framework
grey: a cohesive color palette, a consistent style mood, unified iconography and
imagery, and light/dark theming that stays on-brand.

## Start from a mood, then derive tokens

Pick ONE adjective set before touching colors (e.g. "calm / trustworthy / minimal"
vs "bold / playful / energetic"). Every later choice — palette, radius, shadow,
motion — should reinforce it. Inconsistency, not ugliness, is what reads as amateur.

## Build a palette with roles, not just hues

A palette is a small set of named roles. Derive tints/shades from one accent rather
than picking unrelated colors. Keep neutrals slightly tinted toward the accent for
cohesion (e.g. cool greys with a blue accent).

```css
:root {
  /* One brand accent + a ramp */
  --accent-50:#eef2ff; --accent-100:#e0e7ff; --accent-500:#6366f1;
  --accent-600:#4f46e5; --accent-700:#4338ca;

  /* Neutrals (tinted toward accent) */
  --n-0:#ffffff; --n-50:#f8f8fb; --n-100:#f1f1f6; --n-200:#e5e5ee;
  --n-500:#71717a; --n-800:#27272f; --n-900:#18181b;

  /* Semantic */
  --success:#16a34a; --warning:#d97706; --danger:#dc2626; --info:#0ea5e9;
}
```

Rules of thumb: 1 dominant, 1 accent, neutrals for the other ~70% of surface area
(the 60-30-10 split). Use semantic colors ONLY for their meaning, never decoration.

## Theming — design dark mode in, don't invert

Map roles to a theme layer so components never reference raw hues. Dark mode is a
re-mapping of roles, not `filter: invert()`. In dark themes lower surface contrast
(elevated surfaces get *lighter*, not white) and slightly desaturate accents.

```css
:root { --bg:var(--n-0); --surface:var(--n-50); --text:var(--n-900); --text-muted:var(--n-500); }
:root[data-theme="dark"] {
  --bg:#0b0b0f; --surface:#16161d; --text:#ececf1; --text-muted:#9a9aa6;
  --accent-600:#818cf8; /* lift accent so it reads on dark */
}
* { color: var(--text); background-color: transparent; }
```

Respect the OS default once, then let the user override and persist the choice:

```js
const saved = localStorage.getItem("theme");
const theme = saved ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
document.documentElement.dataset.theme = theme;
```

## Iconography — one family, one weight

Pick a single icon set (e.g. Lucide, Heroicons) and stick to it; mixing filled +
outline + emoji looks broken. Keep a consistent stroke width and size scale
(16 / 20 / 24). Icons should share the line weight of your type. Always pair an icon
with a text label or an `aria-label` — never an icon alone for an action.

## Imagery & illustration

- Treat all images consistently: same corner radius, same aspect ratios, optional
  duotone/overlay to unify a mixed photo set.
- Provide a real empty/placeholder state — a tinted block or simple illustration —
  not a broken-image icon.
- Constrain to a few aspect ratios (`16/9`, `4/3`, `1/1`) and use `object-fit: cover`.
- For decorative SVGs/illustrations, reuse the palette variables so art shifts with theme.

```css
.media { aspect-ratio: 16/9; border-radius: var(--radius); overflow: hidden; background: var(--surface); }
.media img { width: 100%; height: 100%; object-fit: cover; display: block; }
```

## Depth, shape & texture

Define radius and shadow scales once and reuse them — they carry brand as much as
color. Soft, low-contrast shadows read modern; hard offset shadows read retro/playful.
Pick a lane and keep radii consistent across buttons, cards, inputs, and images.

```css
:root { --radius:10px; --radius-sm:6px;
  --shadow-sm:0 1px 2px rgba(16,16,24,.06);
  --shadow-md:0 6px 20px rgba(16,16,24,.10); }
```

## Self-check before calling it done

- [ ] Every color/radius/shadow comes from a token — no stray hex or px.
- [ ] One icon family, one stroke weight, one size scale.
- [ ] Light AND dark themes both legible; accents adjusted per theme, not inverted.
- [ ] Images share radius + aspect ratios; empty states are designed.
- [ ] Body text meets 4.5:1 contrast against its surface in both themes.
- [ ] The result visibly matches the chosen mood adjectives.
