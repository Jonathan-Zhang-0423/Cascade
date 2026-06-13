# Form & Input UX Skill

How to build forms people can finish without frustration: clear labels, validation
at the right moment with helpful messages, accessible errors, and submit handling
that prevents double-submits and lost work. Forms are where users give you data —
small friction here costs real conversions.

## Structure & labels

- One visible `<label>` per field, always (placeholder is NOT a label — it vanishes
  on input and fails accessibility). Wrap or use `for`/`id`.
- Group related fields with `<fieldset>`/`<legend>`; one column beats two for flow.
- Mark required fields with text ("Required") or a clearly explained `*`, plus the
  `required` attribute — never color alone.
- Use the right input type + attributes so mobile shows the right keyboard and
  browsers can autofill:

```html
<label for="email">Email</label>
<input id="email" type="email" name="email" autocomplete="email"
       inputmode="email" required>
<input type="tel"  inputmode="numeric" autocomplete="tel">
<input type="password" autocomplete="current-password">
```

## Validate at the right moment

Timing matters more than rules:

- **Don't** validate a field the user hasn't touched yet (no errors on first paint).
- Validate a field on **blur** (after they leave it), and clear the error live as
  they fix it (on `input`).
- Re-validate everything on submit and block if invalid.
- For async checks (username taken), debounce (~400ms) and show a pending state.

```js
input.addEventListener("blur", () => validateField(input));     // first error
input.addEventListener("input", () => { if (input.dataset.touched) validateField(input); });
```

## Error messages that help

- Say what's wrong AND how to fix it: "Password needs 8+ characters" — not "Invalid".
- Put the message inline, right next to the field, not only in a top banner.
- On submit with errors, move focus to the first invalid field; for long forms also
  show a summary list at top with anchor links.
- Tie errors to the field for screen readers:

```html
<input id="pw" aria-invalid="true" aria-describedby="pw-err">
<p id="pw-err" class="error" role="alert">Password needs 8+ characters.</p>
```

## Submit handling — protect the user

- Disable the submit button AND guard in code against double-submit; show a busy state:
  ```js
  btn.disabled = true; btn.setAttribute("aria-busy","true");
  try { await save(); } finally { btn.disabled = false; btn.removeAttribute("aria-busy"); }
  ```
- Keep the user's input on failure — never clear a form because the server 500'd.
- On success, give clear feedback (toast / inline success / navigate), don't just go silent.
- Support Enter-to-submit from text fields; keep a real `<form onsubmit>` so it works.

## Reduce effort

- Autofocus the first field on a dedicated form page (not inside a busy dashboard).
- Use `autocomplete` tokens generously so browsers/password managers fill fields.
- Sensible defaults, smart formatting (mask/format phone, card, dates as they type)
  but store normalized values.
- Don't ask for what you don't need; split long forms into clear steps with progress
  and let users go back without losing data.

## Mobile specifics

- Inputs ≥16px font-size to stop iOS auto-zoom on focus.
- Tap targets ≥44px; enough spacing so fat fingers don't hit the wrong control.
- Right `inputmode`/`type` for numeric/email/tel keyboards.

## Self-check

- [ ] Every field has a real label; correct `type`/`inputmode`/`autocomplete`.
- [ ] No errors before interaction; validate on blur, clear live, re-check on submit.
- [ ] Error text says the fix, sits inline, and is linked via `aria-describedby`+`role="alert"`.
- [ ] Submit disables + shows busy; no double-submit; input preserved on failure.
- [ ] Success gives clear feedback; Enter submits; first error gets focus.
- [ ] Multi-step forms keep back-nav and data; inputs ≥16px on mobile, targets ≥44px.
