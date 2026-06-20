# Internationalization (i18n) Skill

How to build an app that adapts to language and locale without rewrites: externalize
all user-facing strings, format numbers/dates/currency by locale, handle plurals and
interpolation, and support right-to-left layouts. Retrofitting i18n later is painful —
structure for it from the first string.

## Never hardcode user-facing text

Every visible string comes from a keyed resource, not a literal in JSX/HTML.

```js
// Don't:  <button>Save changes</button>
// Do:     <button>{t("settings.save")}</button>

// en.json
{ "settings": { "save": "Save changes", "saved": "Saved {count} items" } }
// zh.json
{ "settings": { "save": "保存更改", "saved": "已保存 {count} 项" } }
```

- Key by meaning/location (`settings.save`), not by English text.
- Keep one resource file per locale; never concatenate translated fragments
  ("You have " + n + " items") — word order differs across languages. Interpolate
  whole sentences with placeholders instead.

## Plurals & interpolation

Plural rules vary (English has 2 forms, Chinese 1, Russian/Arabic several). Use the
library's plural support or `Intl.PluralRules`, not `n === 1 ? "item" : "items"`.

```js
const pr = new Intl.PluralRules(locale);
const key = pr.select(count); // "one" | "other" | …
// messages: { item: { one: "{n} item", other: "{n} items" } }
```

## Format by locale, not by hardcode

Dates, numbers, and currency formats differ everywhere — use `Intl`, never manual
string building:

```js
new Intl.NumberFormat(locale).format(1234567.89);                 // 1,234,567.89 / 1.234.567,89
new Intl.NumberFormat(locale, {style:"currency",currency:"USD"}).format(9.99);
new Intl.DateTimeFormat(locale, {dateStyle:"medium"}).format(new Date());
new Intl.RelativeTimeFormat(locale).format(-3, "day");            // "3 days ago"
```

Store canonical data (UTC timestamps, ISO dates, raw numbers, minor-unit currency)
and format only at the view layer.

## RTL — layout that flips

Arabic/Hebrew read right-to-left. Don't hardcode `left`/`right`; use logical
properties so the layout mirrors automatically:

```css
/* Instead of margin-left / left / text-align:left */
.card { margin-inline-start: 16px; padding-inline: 12px; text-align: start; }
```

```html
<html lang="ar" dir="rtl">  <!-- set dir from the active locale -->
```

Set `<html lang>` and `dir` from the active locale; icons that imply direction
(back/forward arrows) should flip in RTL.

## Practical structure

- Detect initial locale from the user/profile or `navigator.language`, let the user
  override, and persist the choice.
- Provide a fallback locale for missing keys (usually English) and log misses in dev.
- Allow text expansion: translations can be 30–40% longer than English — don't build
  fixed-width buttons/labels that clip.
- Keep `lang` attributes correct so screen readers and hyphenation work.

## Self-check

- [ ] No hardcoded user-facing strings; all keyed by meaning with a fallback locale.
- [ ] Whole-sentence interpolation; plurals via Intl/library rules, not `n===1`.
- [ ] Numbers/dates/currency via `Intl.*`; canonical values stored, formatted at view.
- [ ] Logical CSS properties + `<html dir>`/`lang` so RTL mirrors correctly.
- [ ] Layout tolerates ~40% text expansion without clipping.
- [ ] Locale detected, user-overridable, and persisted.
