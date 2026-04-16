# Multi-Language Code Execution via Run Button

## What & Why
The Run button currently only handles HTML (renders a preview) and silently does nothing for all other file types. The IDE supports ~40 languages — users (especially beginners) expect to click Run and see output in the console. This task wires up real code execution for every language that can meaningfully be run, and gives clear feedback for file types that cannot be run.

## Done looks like
- Clicking Run on any supported script file (JS, TS, Python, Ruby, PHP, Go, Java, C, C++, Rust, Bash, Lua, Perl, R, Dart, Kotlin, Scala, Elixir) executes the code and displays stdout and stderr in the console panel.
- Stdout lines appear as normal log entries; stderr lines appear as error (red) entries.
- A "Running…" indicator appears while execution is in progress.
- Scripts that run too long are killed after 10 seconds and the console shows a "Timed out" message.
- Clicking Run on a non-runnable file type (JSON, YAML, XML, CSS, Markdown, SQL, GraphQL, Dockerfile, etc.) shows a single informative "This file type cannot be run" message in the console — no silent no-op.
- HTML files continue to open in the Preview panel as before.
- The Run button is disabled (with a spinner) while a script is already executing.

## Out of scope
- Streaming output line-by-line while the script runs (all output delivered on completion is fine).
- Stdin / interactive input prompts.
- Persisting run history across page reloads.
- Running multiple files together or projects with build tools (npm install, cargo build, etc.) — single-file execution only.

## Tasks

1. **Install language runtimes via Nix** — Create `replit.nix` adding the following Nix packages: `python3`, `ruby`, `php`, `perl`, `lua`, `R`, `go`, `jdk17` (for Java and Kotlin), `gcc` (for C/C++), `rustc`+`cargo`, `dart`, `kotlin`, `scala`, `elixir`. Node.js and Bash are already available. Note: the `.replit` file already uses the `nodejs-20` module so do not remove that.

2. **Server-side run endpoint** — Add `POST /api/run-file` to `server/routes.ts`. It accepts `{ content: string, extension: string }`. A `RUNNERS` map translates extensions to commands:
   - Interpreted: `py→python3`, `js/mjs/cjs→node`, `ts/tsx→npx tsx`, `rb→ruby`, `php→php`, `pl/pm→perl`, `lua→lua`, `r→Rscript`, `sh/bash/zsh→bash`, `dart→dart run`, `ex/exs→elixir`
   - Compiled: `java→javac + java`, `c→gcc -o tmp + ./tmp`, `cpp/cc/cxx→g++ -o tmp + ./tmp`, `go→go run`, `rs→rustc -o tmp + ./tmp`, `kt/kts→kotlinc + java -jar`, `scala→scala`
   - Unsupported extensions return `{ cannotRun: true }` (no subprocess spawned).
   The route writes content to a unique temp file, spawns the runner, waits up to 10 s, deletes the temp file, and returns `{ stdout, stderr, exitCode }`.

3. **Run button and console integration** — Update the navbar Run button handler to detect the active file's extension. For runnable types: clear the console, show "Running…", call `/api/run-file`, then populate the console with stdout lines (`log`), stderr lines (`error`), and a final exit-code summary line. For `cannotRun` responses: show a single `warn` entry like "`.json` files cannot be run." For HTML: open in Preview as before. Disable the Run button with a spinner while a run is in progress.

## Relevant files
- `client/src/components/ide/navbar.tsx`
- `client/src/components/ide/console-panel.tsx`
- `client/src/stores/ide-store.ts:1272-1310`
- `server/routes.ts`
- `.replit`
