# Empty, Loading & Error States Skill

How to design the states that aren't the happy path — the first-run empty screen, the
wait, and the failure. These are most of what a user hits early, yet they're usually
left blank (which reads as "broken"). Every async surface needs all three designed.

## The four states of any data view

For anything that loads or holds a collection, handle all of these explicitly — never
just the populated case:

```text
loading   → skeleton / spinner that matches the eventual layout
empty      → "nothing yet" + what it is + how to add the first one (CTA)
error      → what went wrong + a retry; keep the user's context
populated  → the real content
```

A blank area while one of these is unhandled reads as a bug.

## Loading — keep layout stable

Prefer a skeleton shaped like the real content over a centered spinner; it reduces
perceived wait and prevents layout shift when data arrives.

```html
<div class="skeleton-row" aria-hidden="true"></div>  <!-- mirrors a list item -->
<div aria-live="polite" class="sr-only">Loading projects…</div>
```

- Reserve the final dimensions so nothing jumps (avoid CLS).
- For very fast loads, delay the spinner ~200ms so it doesn't flash.
- Announce loading to screen readers via a polite live region.

## Empty states — the most-wasted opportunity

A first-run empty state is an onboarding moment, not an error. Make it useful:

- Say what belongs here in plain language ("No projects yet").
- Give the single next action as a button ("Create your first project").
- Optional: a light illustration/icon that matches the art direction — never a broken-image box.

Distinguish the two empties: **no data yet** (show CTA) vs **no results for a
filter/search** (show "No matches for 'xyz'" + a clear-filters action). They need
different copy.

## Error states — say what + how to fix

```text
Bad:  "Error" / "Something went wrong" / blank screen
Good: "Couldn't load projects. Check your connection and try again."  [Retry]
```

- Tell the user what failed and the next step; offer a retry that re-runs just the
  failed request (don't reload the whole app).
- Keep their input/context — never clear a form or lose scroll because one call failed.
- Match severity: inline field error vs a section-level banner vs a full-page error.
- Log the technical detail for developers; show the human message to the user.
- Catch render crashes with an error boundary so one broken widget doesn't white-screen
  the whole app.

```jsx
{isLoading ? <Skeleton/>
 : error ? <ErrorState onRetry={refetch} message="Couldn't load projects."/>
 : items.length === 0 ? <EmptyState onCreate={create}/>
 : <List items={items}/>}
```

## Partial & background states

- Optimistic UI: reflect the action immediately, roll back with a clear message if it fails.
- Stale-while-revalidate: show cached data with a subtle refreshing indicator rather
  than a blocking spinner.
- Offline: detect it and tell the user, queue or disable actions that need the network.

## Self-check

- [ ] Every async view handles loading / empty / error / populated — no unhandled blank.
- [ ] Loading uses a layout-stable skeleton; spinner delayed; announced to AT.
- [ ] Empty state explains what's missing + a primary CTA; "no data" vs "no results" differ.
- [ ] Errors state the cause + a scoped retry; user input/context preserved.
- [ ] Render errors caught by a boundary; one failure doesn't white-screen the app.
- [ ] Optimistic/offline/stale states considered where relevant.
