# Data Visualization Skill

How to turn numbers into a chart people read correctly at a glance: choosing the
right chart type, rendering it well (SVG/Canvas/library), labeling axes and legends,
staying colorblind-safe, and handling empty/loading/responsive states.

## Pick the chart for the question, not the dataset

| Question | Chart |
|---|---|
| Compare values across categories | Bar (horizontal if labels are long) |
| Trend over time | Line / area |
| Part-to-whole (≤5 parts) | Stacked bar > pie; avoid pie for >5 slices |
| Relationship between two vars | Scatter |
| Distribution | Histogram / box plot |
| Magnitude over 2 dimensions | Heatmap |

Default to a bar chart when unsure — it's the hardest to misread. Avoid 3D, dual
y-axes, and donut charts with many slices; they mislead more than inform.

## Render: SVG vs Canvas vs library

- **< ~1,000 points / interactive / crisp at any zoom →** SVG (DOM nodes, easy
  hover/`<title>` tooltips, accessible).
- **Thousands+ points / realtime →** Canvas (one bitmap, no per-point DOM cost).
- **Don't hand-roll complex charts** — reach for a library (Recharts/Chart.js/ECharts
  /D3) when you need axes, scales, legends, and tooltips. Hand-draw only simple
  sparklines/bars.

```js
// Always scale data → pixels with an explicit domain→range map.
const x = (v) => (v - min) / (max - min) * (W - pad*2) + pad;
const y = (v) => H - pad - (v / yMax) * (H - pad*2);
```

## Axes, scales & labels make it truthful

- **Bar charts MUST start the value axis at 0** — a truncated baseline exaggerates
  differences and is misleading. Line charts may use a focused range (label it).
- Label both axes with units; format ticks for humans (`1.2k`, `$3M`, `12%`).
- Pick ~4–7 ticks; don't crowd. Rotate or truncate long category labels, or go horizontal.
- Sort categorical bars by value (not alphabetically) unless order is meaningful.

## Color & legend

- Encode with as few colors as possible; if one series matters, gray the rest.
- Use a **colorblind-safe** categorical palette (e.g. Okabe-Ito); never rely on
  red/green alone — add labels, patterns, or direct labeling.
- Sequential data → a single-hue gradient; diverging data → a two-hue diverging scale
  with a neutral midpoint.
- Prefer direct labels on lines/bars over a separate legend when there are ≤4 series.

## Interaction & tooltips

Show exact values on hover/focus; the chart gives the shape, the tooltip gives the
number. Make tooltips keyboard-reachable for SVG (`<g tabindex="0">` + `<title>`).
Snap to the nearest point rather than requiring pixel-perfect hover.

## States: empty, loading, sparse

```text
no data      → "No data for this range" placeholder, not an empty axis box
1 data point → show the value as a number/stat card, not a 1-point line
loading      → skeleton of the chart area, keep the axes/frame stable
error        → message + retry, never a blank canvas
```

## Responsive & retina

- Make the SVG fluid with a `viewBox` and `width:100%`; recompute scales on container
  resize (`ResizeObserver`), debounced.
- For Canvas, scale the backing store by `devicePixelRatio` so it isn't blurry:

```js
const dpr = devicePixelRatio || 1;
canvas.width = cssW * dpr; canvas.height = cssH * dpr;
ctx.scale(dpr, dpr);
```

## Accessibility

A chart is not just pixels. Provide a text alternative: a `<figure>` with a caption
summarizing the takeaway, and/or an accessible data `<table>` (visually hidden) so
screen-reader and keyboard users get the data. Give the SVG `role="img"` + `aria-label`.

## Self-check

- [ ] Chart type matches the question; no pie >5 slices, no 3D/dual-axis.
- [ ] Bar value axis starts at 0; axes labeled with units; ticks human-formatted.
- [ ] Colorblind-safe palette; meaning never carried by color alone.
- [ ] Tooltip/hover gives exact values and is keyboard reachable.
- [ ] Empty / single-point / loading / error states handled.
- [ ] Responsive via `viewBox`/`ResizeObserver`; Canvas scaled for DPR.
- [ ] Text alternative (caption or hidden table) present.
