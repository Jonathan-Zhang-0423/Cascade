# Game Design Skill

How to structure a playable browser game: a deterministic update loop, explicit
game states, responsive input, and the score/lives/level systems that make it
feel like a game.

## Core Architecture

Separate three concerns: **update** (advance the simulation), **render** (draw the
current state), and **input** (record what the player is doing). Never mutate game
state inside render or inside an input event — input sets intent flags, update
reads them.

```
/src/
  game.js       # loop, state machine, wiring
  state.js      # game state object + reset()
  input.js      # keyboard/touch → intent flags
  entities.js   # player, enemies, items (update + collision)
  render.js     # draws state to canvas/DOM
  hud.js        # score, lives, level overlay
```

## The Game Loop — fixed timestep

A `setInterval` loop runs at an uneven rate and ties physics to frame rate. Use
`requestAnimationFrame` with a fixed-step accumulator so the simulation is
deterministic regardless of display refresh:

```js
const STEP = 1000 / 60; // simulate at 60Hz
let last = 0, acc = 0;

function frame(now) {
  if (!last) last = now;
  acc += now - last;
  last = now;
  // Clamp to avoid spiral-of-death after a tab regains focus
  if (acc > 250) acc = 250;
  while (acc >= STEP) {
    update(STEP / 1000); // dt in seconds
    acc -= STEP;
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Use `dt` (delta time in seconds) for all movement: `x += vx * dt`, never `x += vx`.

## State Machine

Drive the whole game from one `phase` so the loop knows what to update and draw:

```js
// 'menu' | 'playing' | 'paused' | 'gameover'
const state = { phase: 'menu', score: 0, lives: 3, level: 1 };

function update(dt) {
  if (state.phase !== 'playing') return; // freeze sim when not playing
  updatePlayer(dt);
  updateEnemies(dt);
  checkCollisions();
  checkLevelComplete();
}

function render() {
  drawWorld();
  if (state.phase === 'menu') drawMenu();
  if (state.phase === 'paused') drawPauseOverlay();
  if (state.phase === 'gameover') drawGameOver(state.score);
}
```

## Input — intent flags, not direct actions

```js
// input.js
export const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'p') togglePause();
  keys.add(e.key);
});
addEventListener('keyup', (e) => keys.delete(e.key));

// Touch: map to the same intent flags so update() doesn't care about source
function bindTouchButton(el, key) {
  const on  = (e) => { e.preventDefault(); keys.add(key); };
  const off = (e) => { e.preventDefault(); keys.delete(key); };
  el.addEventListener('touchstart', on,  { passive: false });
  el.addEventListener('touchend',   off, { passive: false });
}
```

In `update`: `if (keys.has('ArrowLeft')) player.vx = -SPEED;`

## Collision — AABB

```js
function hit(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}
```

For many entities, skip pairwise checks against a spatial grid only if profiling
shows it's needed — a few dozen objects are fine brute-force.

## Score / Lives / Level

Keep them in `state`, mutate through small functions so HUD updates stay in one place:

```js
function addScore(n) { state.score += n; hud.setScore(state.score); }
function loseLife()  { if (--state.lives <= 0) endGame(); hud.setLives(state.lives); }
function nextLevel() { state.level++; spawnLevel(state.level); }
```

## Pause & Restart

Pause = flip `phase` to `'paused'` (loop keeps running, `update` early-returns, so
rendering continues but the sim freezes). Restart = call `reset()` which rebuilds
`state` from defaults and respawns entities — never patch fields one by one.

## Common Pitfalls
- Tying movement to frame rate (no `dt`) — game runs faster on 144Hz monitors.
- Spawning `requestAnimationFrame` more than once — you get a doubled/accelerating loop. Start it exactly once.
- Mutating state in `keydown` handlers — leads to missed/duplicated actions; set a flag and act in `update`.
- Not clamping the accumulator — after the tab is backgrounded, `acc` is huge and the game "fast-forwards".
- Forgetting `e.preventDefault()` on touch — the page scrolls/zooms while playing.
- Reading `canvas.width`/`height` as CSS pixels on HiDPI — scale the context by `devicePixelRatio` for crisp rendering.
- Allocating objects every frame (e.g. `new Vector()` in update) — causes GC stutter; reuse or pool.

## Checklist for a "real" game
- [ ] Start menu → play → game over → restart loop all reachable
- [ ] Pause works and freezes the simulation
- [ ] Score and lives visible and update on the right events
- [ ] At least one win/lose condition
- [ ] Works with keyboard AND touch (if targeting mobile)
- [ ] No console errors during a full play session
