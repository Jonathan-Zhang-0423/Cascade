# Copywriting & Typography Skill

How to make text carry its weight: clear, concise UI copy with a consistent voice,
and typography (scale, line-height, measure, contrast) that makes it effortless to
read. Words and type are most of what a user actually experiences.

## Voice — write for a person, in their language

- Be concise and concrete. Cut filler ("please note that", "in order to" → "to").
- Address the user as "you"; describe the product as doing the action.
- Match the UI language to the user's input language (a Chinese request → Chinese UI
  copy). Never mix languages in one screen.
- Sentence case for almost everything; reserve Title Case for proper nouns/brand.
- Be specific over generic: "Save changes" beats "Submit"; "Delete 3 files" beats "OK".

## Microcopy that does work

| Surface | Bad | Good |
|---|---|---|
| Button | "Submit" | "Create account" |
| Empty state | "No data" | "No projects yet — create your first one" |
| Error | "Invalid input" | "Email must include an @" |
| Confirm | "Are you sure?" | "Delete this project? This can't be undone." |
| Loading | (blank) | "Generating preview…" |

Always write the empty, loading, and error states — they are not edge cases, they're
the first thing many users see. Errors should say what happened AND how to fix it.

## Type scale — pick a ratio, don't freestyle

Use a modular scale (~1.2–1.25) so sizes relate. Limit a screen to 2–3 sizes.

```css
:root {
  --text-xs:.75rem; --text-sm:.875rem; --text-base:1rem;
  --text-lg:1.25rem; --text-xl:1.563rem; --text-2xl:1.953rem; --text-3xl:2.441rem;
}
```

Fluid headings without breakpoints:

```css
h1 { font-size: clamp(1.75rem, 1.2rem + 2.5vw, 2.75rem); }
```

## Line-height, measure & spacing

Readability is mostly these three:

```css
body { font-size: var(--text-base); line-height: 1.6; }   /* body: 1.5–1.65 */
h1,h2,h3 { line-height: 1.15; letter-spacing: -0.01em; }  /* headings: tighter */
.prose { max-width: 66ch; }                                /* measure: 50–75 chars */
.prose > * + * { margin-top: 1em; }                        /* vertical rhythm */
```

- Body line-height 1.5–1.65; headings 1.1–1.25.
- Line length (measure) 50–75 characters — long lines tire the eye, short ones break flow.
- Tighten letter-spacing slightly on large headings; never letter-space lowercase body.
- Don't justify text on the web (rivers of whitespace); left-align.

## Font choices

- One or two families max: a UI/sans for everything, optionally a mono for code.
- Always supply a system fallback stack so text renders before the webfont loads:
  `font-family: Inter, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif;`
- Load webfonts with `font-display: swap` and preload the critical weight.
- Ship only the weights you use (e.g. 400/600); each weight is bandwidth.

## Hierarchy & scannability

People scan, they don't read. Structure for the eye:

- Front-load the meaningful word in labels and headings.
- Use real headings (`<h1>`–`<h3>`) in order — they're hierarchy AND accessibility.
- Break walls of text into short paragraphs, lists, and subheadings.
- Numerals: tabular figures for tables/data (`font-variant-numeric: tabular-nums`).

## Punctuation & polish

- Use real typographic characters: curly quotes ' ', em dash —, ellipsis … (not `...`).
- Non-breaking space between a number and its unit ("10 MB") to avoid orphans.
- Localize: dates, number grouping, and currency follow the user's locale, not a hardcode.
- Avoid ALL CAPS for sentences (use `text-transform: uppercase` + letter-spacing only for short labels).

## Self-check

- [ ] Button/label text is specific and verb-led; no bare "Submit/OK".
- [ ] Empty, loading, and error states all have purposeful copy; errors say the fix.
- [ ] UI copy matches the user's language; no mixed-language screens.
- [ ] ≤3 type sizes per view from a defined scale; body line-height 1.5–1.65.
- [ ] Measure capped ~66ch; headings use real `<h1–h3>` in order.
- [ ] System font fallback + `font-display: swap`; only used weights loaded.
