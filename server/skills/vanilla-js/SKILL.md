# Vanilla JavaScript Skill

## Project Structure
```
/project/
  index.html          # Entry point and HTML structure
  style.css           # All styles
  app.js              # Main JavaScript logic
  utils.js            # Shared helper functions (optional)
  assets/             # Images, fonts, icons
```

## Idiomatic Patterns

### DOM interaction
- Query elements once at the top and store references: `const btn = document.getElementById('submit-btn');`
- Use `addEventListener` for all event binding — never use inline `onclick` attributes.
- Prefer `element.textContent` over `element.innerHTML` to avoid XSS risks.
- Modify classes with `element.classList.add/remove/toggle` instead of setting `className` directly.

### Modules
- Keep all JS in one `app.js` for small projects. Split into modules for larger ones.
- Use `<script defer src="app.js"></script>` in HTML to ensure the DOM is ready.

### State
- Keep application state in a plain object at the top of `app.js`.
- Write pure functions that take state as input and return new values.
- Call a `render()` function whenever state changes to update the DOM.

### Async
- Use `async/await` with `fetch()` for HTTP requests.
- Always handle errors with `try/catch` around async calls.

## Common Pitfalls
- Running scripts before the DOM is ready (missing `defer` or `DOMContentLoaded`).
- Using `var` — always use `const` or `let`.
- Mutating the DOM inside a loop instead of building a fragment first — causes slow reflows.
- Forgetting to call `e.preventDefault()` on form submit — causes page reload.
- Using `innerHTML` with user data — XSS risk; use `textContent` or DOM methods.
- Not removing event listeners from dynamically created/destroyed elements — memory leak.

## Code Style
- Use `const` by default, `let` only when reassignment is needed.
- Name DOM element variables with a suffix: `btnSubmit`, `inputEmail`, `listItems`.
- Group: element queries → event bindings → helper functions → initial render call.
- Keep functions short and single-purpose. Name them clearly: `renderList`, `handleFormSubmit`.
- Add comments above each function explaining what it does in one sentence.
