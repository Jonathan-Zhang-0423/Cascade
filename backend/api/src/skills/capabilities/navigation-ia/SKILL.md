# Navigation & Information Architecture Skill

How to organize an app so users always know where they are, where they can go, and
how to get back: a clear structure, predictable navigation patterns for each screen
size, visible active state, and breadcrumbs/back affordances. Good IA prevents the
"lost in the app" feeling more than any visual polish.

## Structure first — group by the user's mental model

Before building nav, define the hierarchy: top-level sections (5±2 is the sweet spot),
what lives under each, and the one primary action per screen. Name things in the
user's words, not internal jargon. A flat, shallow structure beats deep nesting —
aim for any screen reachable in ≤3 taps.

## Pick the nav pattern per breakpoint

| Context | Pattern |
|---|---|
| Desktop, many sections | Top bar or persistent left sidebar |
| Mobile, ≤5 sections | Bottom tab bar (thumb-reachable) |
| Mobile, many sections | Hamburger → drawer (secondary items only) |
| Sub-sections of a page | Tabs / segmented control |
| Deep hierarchy | Breadcrumbs + back |

Keep the *primary* destinations always visible; bury only secondary items behind a
menu. Don't hide core navigation in a hamburger on desktop where there's room.

## Always show "you are here"

The current location must be visibly marked in the nav — highlight the active item
and reflect it in the document title/URL.

```css
.nav-link[aria-current="page"] { color: var(--accent); font-weight: 600;
  border-bottom: 2px solid var(--accent); }
```

```html
<a href="/projects" aria-current="page">Projects</a>  <!-- a11y + styling hook -->
```

## URLs are navigation state

- Every meaningful view has its own URL — back/forward, refresh, and deep links must
  work. Don't trap state in JS that a refresh wipes.
- Reflect hierarchy in the path (`/projects/42/settings`).
- Restore scroll/selection on back where it helps; sync filters/tabs to query params.

## Back & breadcrumbs

- Provide an explicit in-app back/up affordance for nested screens — never rely on the
  browser button alone (especially in installed/PWA contexts).
- Breadcrumbs for hierarchies ≥3 deep: `Home / Projects / Acme / Settings`, each level
  a link except the current page.

```html
<nav aria-label="Breadcrumb">
  <ol><li><a href="/">Home</a></li><li><a href="/projects">Projects</a></li>
      <li aria-current="page">Settings</li></ol>
</nav>
```

## Don't strand the user

- 404 page with a way back home + search, not a dead end.
- After completing a flow (checkout, save), show clear next steps, not a blank screen.
- Confirm before destructive nav that loses unsaved work.
- Keyboard: nav is reachable by Tab, active item focusable, skip-link to main content.

## Self-check

- [ ] ≤5±2 top-level sections; any screen reachable in ≤3 taps; named in user terms.
- [ ] Nav pattern fits each breakpoint (tabs/sidebar/drawer); core items never hidden on desktop.
- [ ] Active location marked via `aria-current` + styling and reflected in title/URL.
- [ ] Every view has a real URL; back/forward/refresh/deep-link all work.
- [ ] In-app back/up + breadcrumbs for nested screens; 404 routes home.
- [ ] Nav keyboard-accessible; skip-to-content link present.
