# Performance Optimization Skill

How to make a web app load fast and stay smooth: ship less, load it lazily, render
efficiently, and keep the main thread free. Optimize what users feel (Core Web
Vitals) — don't micro-optimize blindly.

## Measure first, then fix the biggest thing

Don't guess. Profile with DevTools (Performance, Lighthouse, Network) and target the
metric that's actually bad. The user-facing targets:

- **LCP** (largest contentful paint) < 2.5s — usually the hero image or main text.
- **INP** (interaction to next paint) < 200ms — main-thread responsiveness.
- **CLS** (layout shift) < 0.1 — reserve space so things don't jump.

## Ship less JavaScript

JS is the most expensive byte (download + parse + execute). 

- Code-split by route and lazy-load heavy/rarely-used chunks:
  ```js
  const Editor = React.lazy(() => import("./Editor")); // loads on demand
  ```
- Import only what you use; avoid pulling a whole library for one function. Prefer
  tree-shakeable named imports (`import { debounce } from "lodash-es"`).
- Drop big dependencies when a few lines of native code do the job (dates, fetch).
- Defer non-critical scripts: `<script defer>` / load analytics after interaction.

## Images & media — usually the heaviest payload

- Use modern formats (AVIF/WebP) with a fallback; compress aggressively.
- Always set `width`/`height` (or `aspect-ratio`) to reserve space → prevents CLS.
- `loading="lazy"` for below-the-fold images; eager-load only the LCP image.
- Serve responsive sizes via `srcset`/`sizes` so phones don't download desktop images.

```html
<img src="hero.avif" width="1200" height="630" fetchpriority="high" alt="…">
<img src="thumb.webp" width="320" height="200" loading="lazy" decoding="async" alt="…">
```

## Render & main-thread cost

- Throttle/debounce high-frequency handlers (scroll, resize, input, mousemove):
  ```js
  addEventListener("scroll", throttle(onScroll, 100), { passive: true });
  ```
- Batch DOM reads then writes; never read layout (`offsetWidth`) inside a write loop
  (layout thrashing). Use `requestAnimationFrame` for visual updates.
- Virtualize long lists (render only visible rows) instead of mounting thousands of nodes.
- In React: stable keys, `memo`/`useMemo` for expensive renders, move work out of render.
- Animate only `transform`/`opacity` (compositor) — see animation guidance.

## Network & caching

- Fetch in parallel, not waterfalls; preconnect/preload critical origins and assets.
- Cache static assets with long max-age + content hashing; use a Service Worker for
  repeat visits/offline where it fits.
- Deduplicate and cache API calls (SWR/React Query style); avoid refetching on every render.
- Paginate or stream large responses instead of loading everything at once.

## Perceived performance

Speed is also a feeling. Show skeletons immediately, stream content as it arrives,
optimistically update on action, and keep layout stable so nothing jumps. A fast-
feeling app that's technically slower often beats the reverse.

## Self-check

- [ ] Profiled with Lighthouse/DevTools; fixing the actual worst metric, not guessing.
- [ ] Routes/heavy components code-split; no giant single bundle; unused deps removed.
- [ ] Images compressed, sized (no CLS), lazy below the fold, responsive `srcset`.
- [ ] Scroll/input/resize handlers throttled & `passive`; long lists virtualized.
- [ ] No layout thrashing; visual updates via rAF; only transform/opacity animated.
- [ ] Static assets hashed + long-cached; API calls deduped/cached; no request waterfalls.
- [ ] Skeletons/optimistic UI keep it feeling fast.
