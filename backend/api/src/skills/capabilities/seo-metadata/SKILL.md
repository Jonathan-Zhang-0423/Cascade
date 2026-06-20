# SEO & Metadata Skill

How to make a page discoverable and shareable: correct title/meta tags, semantic
structure, Open Graph/Twitter cards for link previews, structured data, and the
crawlability basics. Most SEO wins are just well-formed HTML in the `<head>`.

## The essential `<head>`

Every page needs a unique, descriptive title and description — not a generic
site-wide one. Title ~50–60 chars, description ~150–160.

```html
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Specific Page Title — Site Name</title>
  <meta name="description" content="One clear sentence describing this page's content.">
  <link rel="canonical" href="https://example.com/this-page">
</head>
```

- One `<title>` and one `<meta description>` per page, each unique.
- `canonical` prevents duplicate-content penalties when a page is reachable by
  multiple URLs (query params, trailing slash).
- Don't block indexing by accident: ship `<meta name="robots" content="index,follow">`
  (or omit it — that's the default) and only use `noindex` deliberately.

## Open Graph & Twitter — control the link preview

When a link is shared (Slack, iMessage, social), these decide the card. Missing OG
tags = an ugly, blank preview.

```html
<meta property="og:title" content="Specific Page Title">
<meta property="og:description" content="Same idea as meta description.">
<meta property="og:image" content="https://example.com/og.png"> <!-- 1200×630 -->
<meta property="og:url" content="https://example.com/this-page">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
```

Use an absolute `og:image` URL (relative paths don't resolve for crawlers), ~1200×630.

## Semantic structure = free SEO

Crawlers read structure the same way screen readers do:

- Exactly one `<h1>` stating the page topic; `<h2>/<h3>` in order for sections.
- Use `<nav>`, `<main>`, `<article>`, `<footer>` — not `<div>` soup.
- Descriptive link text ("View pricing"), never "click here".
- `alt` text on meaningful images (also an SEO + a11y signal).

## Structured data (rich results)

Add JSON-LD for content types search engines render richly (articles, products,
recipes, FAQs, breadcrumbs). Keep it accurate to the visible content.

```html
<script type="application/ld+json">
{ "@context":"https://schema.org", "@type":"Article",
  "headline":"…", "author":{"@type":"Person","name":"…"},
  "datePublished":"2026-01-01" }
</script>
```

## Crawlability & performance

- Provide `sitemap.xml` and a sane `robots.txt`; reference the sitemap from robots.
- Clean, readable URLs (`/blog/seo-basics`, not `/p?id=92`).
- For SPAs: ensure content is server-rendered or pre-rendered — crawlers may not run
  heavy client JS, so a blank `<div id="root">` indexes as empty.
- Core Web Vitals (LCP/INP/CLS) are ranking signals — fast pages rank better.
- Mobile-friendly is required: responsive layout + correct viewport meta.

## Self-check

- [ ] Unique `<title>` (~55 chars) and `<meta description>` (~155) per page.
- [ ] `canonical` set; no accidental `noindex`/robots block.
- [ ] OG + Twitter tags with an absolute 1200×630 image.
- [ ] One ordered `<h1>`…`<h3>`; semantic landmarks; descriptive links + alt text.
- [ ] JSON-LD where a rich result applies, matching visible content.
- [ ] sitemap.xml + robots.txt; clean URLs; SPA content is pre/server-rendered.
