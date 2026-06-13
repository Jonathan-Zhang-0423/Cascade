# Accessibility Skill

How to build UI that everyone can use — keyboard, screen reader, low vision, motor
and cognitive differences. Most of this is free if you start with semantic HTML;
the rest is a short, concrete checklist. Accessibility is also basic SEO and
keyboard-power-user quality.

## Semantic HTML first — it does the work for you

A real `<button>`, `<a href>`, `<label>`, `<nav>`, `<main>` come with focusability,
keyboard handling, and roles built in. A `<div onclick>` has none of that and must
re-implement everything. Reach for ARIA only when no native element fits.

```html
<!-- Don't -->  <div class="btn" onclick="save()">Save</div>
<!-- Do    -->  <button type="button" onclick="save()">Save</button>
```

Use one `<h1>` per page and don't skip heading levels — headings are how screen
reader users navigate. Landmarks (`<header><nav><main><footer>`) let them jump.

## Keyboard: everything works without a mouse

- Every interactive control must be reachable by Tab and operate with Enter/Space.
- Visible focus ALWAYS — never `outline: none` without a replacement:

```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
```

- Logical tab order = DOM order; don't fix layout with positive `tabindex`.
- Trap focus inside open modals; return focus to the trigger on close; `Esc` closes.
- Provide a "Skip to content" link as the first focusable element.

## Images, icons & labels

- Informative images need real `alt`; decorative ones get `alt=""` (empty, not missing).
- Icon-only buttons need an accessible name: `aria-label="Close"`.
- Associate every input with a `<label for>` (or wrap it). Placeholder ≠ label.
- Don't put essential info only in color/icon — add text.

## Color & contrast

- Body text ≥ **4.5:1** against its background; large text (≥24px or 18px bold) ≥ 3:1.
- UI component boundaries / focus indicators ≥ 3:1.
- Never convey state by color alone (error red + an icon + a message).
- Support `prefers-color-scheme` and don't break at 200% zoom or `prefers-contrast`.

## ARIA — only to fill gaps, and correctly

First rule of ARIA: don't use ARIA if a native element works. When you must:

```html
<button aria-expanded="false" aria-controls="menu">Options</button>
<ul id="menu" hidden>…</ul>           <!-- toggle hidden + aria-expanded together -->

<div role="alert">Saved successfully</div>   <!-- announces immediately -->
<div aria-live="polite">3 results</div>       <!-- announces when idle -->
```

- Keep `aria-*` state in sync with reality on every change.
- Don't override native roles (`<button role="link">` confuses everyone).
- Dynamic updates (toasts, validation, async results) go through a live region or
  they're silent to screen readers.

## Forms & errors (accessible)

- Label every field; mark required with text + `required`, not just an asterisk color.
- Tie error text to its field with `aria-describedby` and set `aria-invalid="true"`.
- Move focus to the first error on submit; summarize errors at the top for long forms.

## Motion, media, timing

- Honor `prefers-reduced-motion` (gate non-essential animation).
- Captions/transcripts for audio/video; don't autoplay sound.
- Avoid content that flashes > 3×/second (seizure risk).
- Don't impose tight time limits; if you must, allow extending.

## Self-check (quick audit)

- [ ] Tab through the whole page: every action reachable, focus always visible, order sane.
- [ ] Native elements used; ARIA only where needed and kept in sync.
- [ ] All inputs labeled; icon buttons have `aria-label`; images have correct `alt`.
- [ ] Text contrast ≥4.5:1; state never color-only; works at 200% zoom.
- [ ] Modals trap + restore focus and close on `Esc`; skip-link present.
- [ ] Async messages/errors use `role="alert"`/`aria-live`; errors linked to fields.
- [ ] `prefers-reduced-motion` respected; no >3Hz flashing; no autoplay audio.
