# 3D & WebGL Web Game Skill

How to build robust 3D / WebGL browser games (Three.js, Babylon, raw WebGL) that
actually run in THIS app's preview — which inlines local scripts into a sandboxed
`srcdoc` iframe. The #1 failure here is `Uncaught SyntaxError: Cannot use import
statement outside a module`. Follow the loading rules below and it won't happen.

## Why `import` breaks here (read this first)

The preview inlines every **local** `<script src="...">` into a plain
`<script>…</script>`, stripping attributes — including `type="module"`. A separate
`game.js` that uses `import` therefore runs as a CLASSIC script and throws
"Cannot use import statement outside a module". Relative imports also have no base
URL to resolve against inside `srcdoc`.

**Rules that avoid it entirely:**
1. Put module code in an **inline** `<script type="module">` in `index.html` —
   inline scripts are NOT rewritten, so the `type="module"` survives.
2. Resolve bare specifiers (`import * as THREE from 'three'`) with an **import map**
   pointing at a CDN ESM build.
3. Load CDN libraries by **absolute https URL** (never a local path/bare name in a
   classic script).
4. Don't split game code into a separate local `.js` that uses `import` — keep ES
   module code inline, or use the classic-global approach below.

## Pattern A — Three.js via ES modules + import map (recommended)

Everything in ONE `index.html`. Note the import map MUST come before the module
script, and include `three/addons/` for loaders/controls.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>html,body{margin:0;height:100%;overflow:hidden;background:#000}canvas{display:block}</style>
  <script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
    }
  }
  </script>
</head>
<body>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    document.body.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.1, 100);
    camera.position.set(0, 1.5, 4);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1); dir.position.set(3,5,2); scene.add(dir);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1,1,1),
      new THREE.MeshStandardMaterial({ color: 0x4f8cff })
    );
    scene.add(mesh);

    const controls = new OrbitControls(camera, renderer.domElement);

    addEventListener('resize', () => {
      camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });

    renderer.setAnimationLoop((t) => {
      mesh.rotation.y = t / 1000;
      controls.update();
      renderer.render(scene, camera);
    });
  </script>
</body>
</html>
```

- Pin a version (`three@0.160.0`) — never an unpinned `three@latest` (breaks unpredictably).
- The `three/addons/` mapping (trailing slash) is required for `OrbitControls`,
  `GLTFLoader`, etc. Without it those imports 404.

## Pattern B — classic global build (no import at all)

If you want to avoid modules entirely, use a UMD/global `<script src>` (absolute CDN
URL) and DON'T write any `import`. `THREE` becomes a global. Works as a classic
script, so inlining can't break it.

```html
<script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>
<script>
  const renderer = new THREE.WebGLRenderer();
  /* …use THREE.* globals, no import … */
</script>
```

Use Pattern A when you need addons (loaders/controls); Pattern B for simple scenes.

## The render loop — robust by construction

- Use `renderer.setAnimationLoop(fn)` (or `requestAnimationFrame`), never `setInterval`.
- Make motion frame-rate independent with a delta time, not a fixed per-frame step:
  ```js
  let prev = 0;
  renderer.setAnimationLoop((now) => { const dt = (now - prev)/1000 || 0; prev = now; update(dt); render(); });
  ```
- Clamp `dt` (e.g. `Math.min(dt, 0.05)`) so a paused tab doesn't teleport objects.
- Cap pixel ratio at 2 (`setPixelRatio(Math.min(devicePixelRatio,2))`) — uncapped on
  retina tanks performance.

## WebGL robustness essentials

- Guard context creation: if `WebGLRenderingContext` is unavailable or the context is
  lost, show a message instead of a blank canvas. Handle `webglcontextlost`/`restored`.
- Dispose what you create when swapping scenes: `geometry.dispose()`,
  `material.dispose()`, `texture.dispose()` — leaked GPU resources crash long sessions.
- Reuse geometries/materials across many meshes; use `InstancedMesh` for thousands of
  identical objects rather than thousands of `Mesh`.
- Load assets (GLTF/textures) asynchronously with a loading state; never block the loop.
- Resize handling: update camera aspect + `updateProjectionMatrix()` + `setSize` on
  `resize`. Without it the scene stretches.

## Input & game feel

- Pointer + keyboard via event listeners that set intent flags; read flags in the
  update step (don't mutate scene objects inside the event handler).
- The preview iframe grants pointer-lock, fullscreen, gamepad, WebXR, and device
  orientation/motion. Use them freely — but ALWAYS request them from a user gesture
  (a click/tap), never on load, or the browser rejects the request.
  - First-person look: call `renderer.domElement.requestPointerLock()` on click;
    show a visible "Click to play" prompt and handle `pointerlockchange` to pause.
  - Fullscreen: `el.requestFullscreen()` from a button; don't auto-enter.
  - Gamepad: poll `navigator.getGamepads()` inside the update loop.
  - Mobile tilt: listen for `deviceorientation`/`devicemotion` (granted).
- Pause the loop on `visibilitychange` (hidden tab) to save battery and avoid dt spikes.

## Self-check (prevents the common crashes)

- [ ] No separate local `.js` using `import`; module code is INLINE `<script type="module">`.
- [ ] Import map present (with `three/addons/`) OR classic global build with zero `import`.
- [ ] All CDN libs loaded by absolute https URL with a pinned version.
- [ ] `setAnimationLoop`/rAF (not setInterval); delta-time, clamped; pixel ratio ≤2.
- [ ] Resize updates camera aspect + projection + renderer size.
- [ ] Dispose geometry/material/texture on teardown; reuse/instance for many objects.
- [ ] WebGL-unavailable / context-lost handled with a visible message, not a blank canvas.
