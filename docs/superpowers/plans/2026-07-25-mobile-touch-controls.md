# Mobile Touch Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web release playable on phones: floating virtual joystick + HUD action buttons dispatching synthetic keyboard events, plus mobile display fixes (viewport meta, DPR-sharp canvas, safe areas, rotate overlay).

**Architecture:** A new self-contained touch layer (`renderer/ui/touch-input.js` pure math + `renderer/ui/touch-controls.js` DOM/pointer handling) dispatches synthetic `KeyboardEvent`s on `window`; the game's existing keydown/keyup listeners (`renderer/game.js:70-100`) translate them into the polled `keys{}` map, so game logic is untouched. Static markup/CSS live in `renderer/index.html` (the codebase pattern — HUD and menu markup live there too). The only change to existing code is DPR-aware `Renderer.resize()`.

**Tech Stack:** Vanilla ES modules (no bundler, no new dependencies), Pointer Events, `node:test`, `playwright-core` (chromium already in `~/.cache/ms-playwright`) for a manual verification script.

**Spec:** `docs/superpowers/specs/2026-07-25-mobile-touch-controls-design.md`

## Global Constraints

- Zero changes to game input logic: `renderer/game.js` and `renderer/systems/` must not be modified.
- Desktop web and Electron behavior unchanged: controls exist only under `@media (pointer: coarse)` / `matchMedia('(pointer: coarse)')`.
- Landscape only; portrait shows a CSS-only rotate overlay (`@media (orientation: portrait) and (pointer: coarse)`).
- Vanilla JS, no bundler, no new runtime dependencies. ES modules like the rest of `renderer/`.
- Synthetic keys used: `w a s d` (move), `' '` (attack), `Shift` (stance), `f` (fountain), `Escape` (pause).
- Buttons are `<div>`s, not `<button>`s — buttons take focus on pointerdown and a focused button + Space would re-click it.
- Run tests with `npm test` from the repo root (`node --test test/`).
- Commit after every task; work on branch `web-release`.

---

### Task 1: Joystick math (pure module)

**Files:**
- Create: `renderer/ui/touch-input.js`
- Test: `test/touch-input.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `joystickDirs(dx, dy, deadZone = 12) -> string[]` — subset of `['w','a','s','d']` for a drag vector (screen coords, +y = down), `[]` inside the dead zone; `diffDirs(prev, next) -> { press: string[], release: string[] }` — set difference between two dir arrays. Task 4 imports both.

- [ ] **Step 1: Write the failing test**

Create `test/touch-input.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { joystickDirs, diffDirs } from '../renderer/ui/touch-input.js'

describe('joystickDirs', () => {
  it('returns [] inside the dead zone', () => {
    assert.deepEqual(joystickDirs(0, 0), [])
    assert.deepEqual(joystickDirs(5, 5), [])
    assert.deepEqual(joystickDirs(-11, 0), [])
  })

  it('activates at the dead-zone radius', () => {
    assert.deepEqual(joystickDirs(12, 0), ['d'])
  })

  it('maps the four cardinals (screen coords: +y is down/south)', () => {
    assert.deepEqual(joystickDirs(40, 0), ['d'])   // east
    assert.deepEqual(joystickDirs(0, 40), ['s'])   // south
    assert.deepEqual(joystickDirs(-40, 0), ['a'])  // west
    assert.deepEqual(joystickDirs(0, -40), ['w'])  // north
  })

  it('maps the four diagonals', () => {
    assert.deepEqual(joystickDirs(40, 40), ['d', 's'])
    assert.deepEqual(joystickDirs(-40, 40), ['s', 'a'])
    assert.deepEqual(joystickDirs(-40, -40), ['a', 'w'])
    assert.deepEqual(joystickDirs(40, -40), ['d', 'w'])
  })

  it('quantizes to the nearest of 8 sectors (45° each)', () => {
    // 15° below east -> still east; 30° below east -> southeast diagonal
    assert.deepEqual(joystickDirs(100, Math.tan(Math.PI / 12) * 100), ['d'])
    assert.deepEqual(joystickDirs(100, Math.tan(Math.PI / 6) * 100), ['d', 's'])
  })

  it('honors a custom dead zone', () => {
    assert.deepEqual(joystickDirs(20, 0, 30), [])
    assert.deepEqual(joystickDirs(35, 0, 30), ['d'])
  })
})

describe('diffDirs', () => {
  it('reports newly pressed and released dirs', () => {
    assert.deepEqual(diffDirs(['d'], ['d', 's']), { press: ['s'], release: [] })
    assert.deepEqual(diffDirs(['d', 's'], ['s']), { press: [], release: ['d'] })
    assert.deepEqual(diffDirs(['a'], ['d']), { press: ['d'], release: ['a'] })
  })

  it('is empty for identical sets and for empty-to-empty', () => {
    assert.deepEqual(diffDirs(['w'], ['w']), { press: [], release: [] })
    assert.deepEqual(diffDirs([], []), { press: [], release: [] })
  })

  it('handles full press from rest and full release to rest', () => {
    assert.deepEqual(diffDirs([], ['d', 's']), { press: ['d', 's'], release: [] })
    assert.deepEqual(diffDirs(['d', 's'], []), { press: [], release: ['d', 's'] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/touch-input.test.js` (or `node --test test/touch-input.test.js`)
Expected: FAIL — `Cannot find module '.../renderer/ui/touch-input.js'`

- [ ] **Step 3: Write minimal implementation**

Create `renderer/ui/touch-input.js`:

```js
// Pure joystick math for the mobile touch layer. Screen coordinates:
// +x is east, +y is south (down). No DOM, no game imports.

// Drag vector -> movement keys, quantized to 8 sectors of 45°.
export function joystickDirs(dx, dy, deadZone = 12) {
  if (Math.hypot(dx, dy) < deadZone) return []
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
  switch (sector) {
    case 0: return ['d']
    case 1: return ['d', 's']
    case 2: return ['s']
    case 3: return ['s', 'a']
    case -1: return ['d', 'w']
    case -2: return ['w']
    case -3: return ['a', 'w']
    default: return ['a'] // sector ±4 (west wraps around atan2's ±π seam)
  }
}

// Which dirs changed between two joystickDirs results.
export function diffDirs(prev, next) {
  return {
    press: next.filter(k => !prev.includes(k)),
    release: prev.filter(k => !next.includes(k)),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/touch-input.test.js`
Expected: PASS — all tests, 0 failures. Then run the full suite: `npm test` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add renderer/ui/touch-input.js test/touch-input.test.js
git commit -m "feat(touch): pure joystick math — 8-way quantization and dir diffing"
```

---

### Task 2: DPR-sharp canvas

**Files:**
- Modify: `renderer/render/canvas.js:622-660` (constructor, `resize`, `updateCamera`, `render` head)
- Test: `test/canvas.test.js` (append a new `describe`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Renderer.viewW` / `Renderer.viewH` — logical (CSS-pixel) view size, set by `resize()`. All camera/view math uses these instead of `canvas.width/height`. `resize()` reads `globalThis.devicePixelRatio ?? 1` (works headless in node tests). No caller changes — `game.js:809` and `game.js:818` call `resize()` exactly as before.

- [ ] **Step 1: Write the failing test**

Append to `test/canvas.test.js` (it already imports from `../renderer/render/canvas.js`; add `Renderer` to that import list):

```js
describe('Renderer DPR-aware resize', () => {
  function fakeCanvas(w, h) {
    const ctx = {
      transforms: [],
      setTransform(...args) { this.transforms.push(args) },
      imageSmoothingEnabled: true,
    }
    return { offsetWidth: w, offsetHeight: h, width: 0, height: 0, getContext: () => ctx, ctx }
  }

  it('scales the backing store by devicePixelRatio, keeps logical view size', () => {
    const prev = globalThis.devicePixelRatio
    globalThis.devicePixelRatio = 2
    const c = fakeCanvas(400, 300)
    const r = new Renderer(c)
    r.resize()
    assert.equal(c.width, 800)
    assert.equal(c.height, 600)
    assert.equal(r.viewW, 400)
    assert.equal(r.viewH, 300)
    assert.deepEqual(c.ctx.transforms.at(-1), [2, 0, 0, 2, 0, 0])
    assert.equal(c.ctx.imageSmoothingEnabled, false)
    globalThis.devicePixelRatio = prev
  })

  it('defaults to dpr 1 when devicePixelRatio is undefined', () => {
    const prev = globalThis.devicePixelRatio
    delete globalThis.devicePixelRatio
    const c = fakeCanvas(400, 300)
    const r = new Renderer(c)
    r.resize()
    assert.equal(c.width, 400)
    assert.equal(r.viewW, 400)
    globalThis.devicePixelRatio = prev
  })

  it('centers the camera using logical size, not backing-store size', () => {
    const prev = globalThis.devicePixelRatio
    globalThis.devicePixelRatio = 2
    const c = fakeCanvas(400, 300)
    const r = new Renderer(c)
    r.resize()
    r.updateCamera({ px: 1000, py: 500 }, 0)
    assert.equal(r.camX, 1000 - 200)  // viewW/2, not canvas.width/2
    assert.equal(r.camY, 500 - 150)
    globalThis.devicePixelRatio = prev
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/canvas.test.js`
Expected: FAIL — `c.width` is 400 not 800 (no DPR scaling yet) and `r.viewW` is undefined.

- [ ] **Step 3: Implement**

In `renderer/render/canvas.js`, constructor (`canvas.js:623-632`) — add logical size fields after `this.S = TILE_SIZE`:

```js
    this.viewW = canvas.width
    this.viewH = canvas.height
```

Replace `resize()` (`canvas.js:638-642`):

```js
  resize() {
    // Backing store at devicePixelRatio for crisp rendering; all camera/view
    // math stays in logical CSS pixels via viewW/viewH.
    const dpr = globalThis.devicePixelRatio ?? 1
    this.viewW = this.canvas.offsetWidth
    this.viewH = this.canvas.offsetHeight
    this.canvas.width = Math.round(this.viewW * dpr)
    this.canvas.height = Math.round(this.viewH * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.ctx.imageSmoothingEnabled = false
  }
```

In `updateCamera` (`canvas.js:644-650`), replace the two `this.canvas.width|height` reads:

```js
    this.camX = px - this.viewW / 2 + o.x
    this.camY = py - this.viewH / 2 + o.y
```

In `render` (`canvas.js:659`), replace:

```js
    const W = this.viewW, H = this.viewH
```

These are the only three `canvas.width/height` read sites in the codebase (verified by grep), so nothing else changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/canvas.test.js` — PASS. Then `npm test` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/canvas.js test/canvas.test.js
git commit -m "feat(render): devicePixelRatio-sharp canvas with logical view size"
```

---

### Task 3: Mobile page scaffolding — viewport meta, CSS, markup, rotate overlay

**Files:**
- Modify: `renderer/index.html`

**Interfaces:**
- Consumes: nothing.
- Produces: DOM ids Task 4 wires up: `#touch-controls` (root, hidden unless coarse pointer), `#joystick-zone`, `#joystick-base`, `#joystick-nub`, `#touch-stance`, `#touch-attack`, `#touch-fountain`, `#touch-pause`; `#rotate-overlay` (pure CSS, no JS). Also the `<script>` tag loading `ui/touch-controls.js` (created in Task 4 — the 404 until then is harmless because module scripts fail silently, but Task 4 follows immediately).

- [ ] **Step 1: Add the viewport meta tag**

In `renderer/index.html` `<head>`, after the charset meta (`index.html:4`):

```html
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
```

- [ ] **Step 2: Add mobile CSS**

Append inside the existing `<style>` block (`index.html:6-40`), after the `.menu-btn:hover` rule:

```css
    /* --- Mobile touch layer (coarse-pointer devices only) --- */
    body { overscroll-behavior: none; }
    canvas { touch-action: none; }
    #touch-controls { display: none; }
    @media (pointer: coarse) { #touch-controls { display: block; } }
    #joystick-zone {
      position: fixed; left: 0; bottom: 0; width: 50vw; height: 70vh;
      z-index: 5; touch-action: none;
    }
    #joystick-base {
      position: fixed; width: 96px; height: 96px; margin: -48px 0 0 -48px;
      border-radius: 50%; border: 2px solid rgba(255,255,255,0.35);
      background: rgba(255,255,255,0.08); display: none;
      pointer-events: none; z-index: 6;
    }
    #joystick-nub {
      position: absolute; left: 50%; top: 50%; width: 44px; height: 44px;
      margin: -22px 0 0 -22px; border-radius: 50%;
      background: rgba(255,255,255,0.35);
    }
    #touch-actions {
      position: fixed;
      right: max(16px, env(safe-area-inset-right));
      bottom: max(16px, env(safe-area-inset-bottom));
      display: flex; flex-direction: column; gap: 14px; align-items: center;
      z-index: 5;
    }
    .touch-btn {
      width: 68px; height: 68px; border-radius: 50%;
      background: rgba(26,26,34,0.55); border: 1px solid rgba(232,184,75,0.5);
      color: #ccc; font-size: 28px;
      display: flex; align-items: center; justify-content: center;
      touch-action: none; user-select: none; -webkit-user-select: none;
    }
    .touch-btn.active { background: rgba(232,184,75,0.35); }
    #touch-attack { width: 84px; height: 84px; font-size: 34px; }
    #touch-fountain { width: 48px; height: 48px; font-size: 20px; opacity: 0.55; }
    #touch-pause {
      position: fixed; width: 44px; height: 44px; font-size: 18px;
      top: max(34px, env(safe-area-inset-top));
      right: max(12px, env(safe-area-inset-right));
    }
    #rotate-overlay {
      position: fixed; inset: 0; z-index: 20; display: none;
      align-items: center; justify-content: center; text-align: center;
      background: #0d0d0d; color: #ccc; font-size: 18px; line-height: 1.6;
    }
    @media (orientation: portrait) and (pointer: coarse) {
      #rotate-overlay { display: flex; }
    }
```

- [ ] **Step 3: Add markup and script tag**

In `renderer/index.html` `<body>`, after `<div id="menu-overlay"></div>` (`index.html:54`):

```html
  <div id="touch-controls">
    <div id="joystick-zone"></div>
    <div id="joystick-base"><div id="joystick-nub"></div></div>
    <div id="touch-actions">
      <div id="touch-stance" class="touch-btn">🗡</div>
      <div id="touch-attack" class="touch-btn">⚔</div>
      <div id="touch-fountain" class="touch-btn">⛲</div>
    </div>
    <div id="touch-pause" class="touch-btn">⏸</div>
  </div>
  <div id="rotate-overlay">Rotate your device ↺<br>This dungeon is landscape-only</div>
```

And after the `web-shim.js` script tag (`index.html:55`), before `game.js`:

```html
  <script type="module" src="ui/touch-controls.js"></script>
```

- [ ] **Step 4: Verify desktop is unaffected**

Run: `npm test`
Expected: full suite green.

Run: `npm run web` in the background, then:

```bash
curl -s localhost:8080 | grep -q 'name="viewport"' && curl -s localhost:8080 | grep -q 'id="touch-controls"' && echo ok
```

Expected: `ok`. Stop the server.

Desktop browsers report `pointer: fine`, so `#touch-controls` stays `display: none` and the rotate overlay never matches — no visual change.

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html
git commit -m "feat(web): mobile page scaffolding — viewport meta, touch CSS, rotate overlay"
```

---

### Task 4: Touch controls behavior module

**Files:**
- Create: `renderer/ui/touch-controls.js`

**Interfaces:**
- Consumes: `joystickDirs(dx, dy)` and `diffDirs(prev, next)` from `./touch-input.js` (Task 1); DOM ids from Task 3.
- Produces: synthetic `KeyboardEvent('keydown'/'keyup')` on `window` with `key` ∈ `w a s d ' ' Shift f Escape` — consumed by the game's existing listeners. No exports consumed by other code; the module self-initializes on import and is a no-op when `matchMedia('(pointer: coarse)')` doesn't match.

- [ ] **Step 1: Write the module**

Create `renderer/ui/touch-controls.js`:

```js
// Mobile touch layer: floating joystick + action buttons. Emits synthetic
// KeyboardEvents on window so the game's existing key listeners and keys{}
// map work unchanged. Self-gating: does nothing on fine-pointer devices.
import { joystickDirs, diffDirs } from './touch-input.js'

const NUB_RADIUS = 34   // px the nub may travel from the anchor

function initTouchControls() {
  if (!matchMedia('(pointer: coarse)').matches) return

  const held = new Set()
  const press = key => {
    if (held.has(key)) return
    held.add(key)
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  }
  const release = key => {
    if (!held.delete(key)) return
    window.dispatchEvent(new KeyboardEvent('keyup', { key }))
  }
  const releaseAll = () => { for (const k of [...held]) release(k) }

  // --- Joystick: anchor under the first touch in the zone, 8-way quantized ---
  const zone = document.getElementById('joystick-zone')
  const base = document.getElementById('joystick-base')
  const nub = document.getElementById('joystick-nub')
  let stickId = null
  let originX = 0, originY = 0
  let dirs = []

  const setDirs = next => {
    const { press: p, release: r } = diffDirs(dirs, next)
    r.forEach(release)
    p.forEach(press)
    dirs = next
  }

  zone.addEventListener('pointerdown', e => {
    if (stickId !== null) return   // one stick pointer at a time
    stickId = e.pointerId
    originX = e.clientX
    originY = e.clientY
    zone.setPointerCapture(e.pointerId)
    base.style.left = `${originX}px`
    base.style.top = `${originY}px`
    base.style.display = 'block'
    nub.style.transform = 'translate(0, 0)'
  })
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return
    const dx = e.clientX - originX
    const dy = e.clientY - originY
    const len = Math.hypot(dx, dy) || 1
    const clamp = Math.min(len, NUB_RADIUS) / len
    nub.style.transform = `translate(${dx * clamp}px, ${dy * clamp}px)`
    setDirs(joystickDirs(dx, dy))
  })
  const endStick = e => {
    if (e.pointerId !== stickId) return
    stickId = null
    base.style.display = 'none'
    setDirs([])
  }
  zone.addEventListener('pointerup', endStick)
  zone.addEventListener('pointercancel', endStick)

  // --- Buttons: hold = key held; tap = short press+release (same path) ---
  const bindHold = (el, key) => {
    let activeId = null
    el.addEventListener('pointerdown', e => {
      if (activeId !== null) return
      activeId = e.pointerId
      el.setPointerCapture(e.pointerId)
      el.classList.add('active')
      press(key)
    })
    const end = e => {
      if (e.pointerId !== activeId) return
      activeId = null
      el.classList.remove('active')
      release(key)
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }
  bindHold(document.getElementById('touch-attack'), ' ')
  bindHold(document.getElementById('touch-stance'), 'Shift')
  bindHold(document.getElementById('touch-fountain'), 'f')
  bindHold(document.getElementById('touch-pause'), 'Escape')

  // --- Stance button doubles as a status icon. The HUD already renders the
  // active stance ('▶ ' prefix on #hud-ranged); mirror it instead of
  // reaching into game state. ---
  const rangedEl = document.getElementById('hud-ranged')
  const stanceBtn = document.getElementById('touch-stance')
  new MutationObserver(() => {
    stanceBtn.textContent = rangedEl.textContent.startsWith('▶') ? '🏹' : '🗡'
  }).observe(rangedEl, { childList: true, characterData: true, subtree: true })

  // --- Never leave keys stuck when the page loses the pointer/focus ---
  window.addEventListener('blur', () => { stickId = null; base.style.display = 'none'; dirs = []; releaseAll() })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stickId = null; base.style.display = 'none'; dirs = []; releaseAll() }
  })
}

initTouchControls()
```

Notes for the implementer:
- `dirs = []` before `releaseAll()` in the blur/hidden handlers keeps the joystick state machine consistent with the emptied `held` set.
- Synthetic events dispatched on `window` reach all three game keydown listeners (`game.js:70`, `72`, `81`) and the cheat-buffer listener (`game.js:90`) — the latter is harmless, `wasdf` letters can never spell `mauno`.
- `KeyboardEvent.repeat` defaults to `false`, so the edge-triggered Shift handler (`game.js:82`) toggles once per tap. The fountain poll (`game.js:421`) self-clears `keys['f']`, so hold duration doesn't matter.

- [ ] **Step 2: Verify no regressions and the module parses**

Run: `npm test`
Expected: full suite green.

Run: `node --input-type=module -e "await import('./renderer/ui/touch-input.js'); console.log('imports ok')"`
Expected: `imports ok` (the DOM module itself can't import under node — it's exercised in Task 5).

- [ ] **Step 3: Commit**

```bash
git add renderer/ui/touch-controls.js
git commit -m "feat(touch): joystick + action buttons dispatching synthetic key events"
```

---

### Task 5: Integration verification script (Playwright touch emulation)

**Files:**
- Create: `tools/verify-touch.mjs`

**Interfaces:**
- Consumes: the running web build (`tools/web-server.mjs`), DOM ids from Task 3, synthetic key events from Task 4.
- Produces: an on-demand verification script (`node tools/verify-touch.mjs`), not part of `npm test` — browser boots are too slow/flaky for the unit suite, and the user prefers time-boxed runtime checks.

- [ ] **Step 1: Write the script**

Create `tools/verify-touch.mjs`:

```js
// On-demand mobile-layout verification for the web release.
// Usage: node tools/verify-touch.mjs   (from the repo root)
// Boots the static server on :8123, drives chromium in three contexts:
// mobile landscape (controls work), mobile portrait (rotate overlay),
// desktop (no controls). Exits 0 on success, 1 on any failure.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const PORT = 8123
const URL = `http://localhost:${PORT}`
let failures = 0

function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures++
}

const server = spawn('node', ['tools/web-server.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
})
await new Promise(r => setTimeout(r, 800))

const browser = await chromium.launch()
try {
  // --- Mobile landscape: controls visible, joystick + attack emit keys ---
  const mobile = await browser.newContext({
    viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true,
  })
  const page = await mobile.newPage()
  await page.goto(URL)
  await page.waitForSelector('#game-canvas')
  // #touch-controls is a zero-height wrapper (children are position:fixed),
  // so visibility checks must target a sized child like the joystick zone.
  check('mobile: joystick zone visible',
    await page.locator('#joystick-zone').isVisible())
  check('mobile: rotate overlay hidden in landscape',
    !(await page.locator('#rotate-overlay').isVisible()))

  // The title menu overlay (z-index 10) sits above the controls (z-index 5)
  // and would swallow the drag — hide it; the touch layer dispatches key
  // events regardless of game phase.
  await page.evaluate(() => { document.getElementById('menu-overlay').style.display = 'none' })
  // Record every keydown the touch layer dispatches.
  await page.evaluate(() => {
    window.__keys = []
    window.addEventListener('keydown', e => window.__keys.push(e.key))
  })
  // Drag right inside the joystick zone (pointer events; the module accepts
  // any pointerType, so mouse-driven pointers are fine for verification).
  await page.mouse.move(150, 300)
  await page.mouse.down()
  await page.mouse.move(210, 300, { steps: 5 })
  await page.mouse.up()
  // Press the attack button.
  const attack = await page.locator('#touch-attack').boundingBox()
  await page.mouse.click(attack.x + attack.width / 2, attack.y + attack.height / 2)
  const keys = await page.evaluate(() => window.__keys)
  check("mobile: joystick drag right dispatched 'd'", keys.includes('d'))
  check("mobile: attack button dispatched Space", keys.includes(' '))
  await mobile.close()

  // --- Mobile portrait: rotate overlay shown ---
  const portrait = await browser.newContext({
    viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true,
  })
  const p2 = await portrait.newPage()
  await p2.goto(URL)
  check('portrait: rotate overlay visible',
    await p2.locator('#rotate-overlay').isVisible())
  await portrait.close()

  // --- Desktop: no controls, no overlay ---
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const p3 = await desktop.newPage()
  await p3.goto(URL)
  check('desktop: touch controls hidden',
    !(await p3.locator('#joystick-zone').isVisible()))
  check('desktop: rotate overlay hidden',
    !(await p3.locator('#rotate-overlay').isVisible()))
  await desktop.close()
} finally {
  await browser.close()
  server.kill()
}

console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
```

- [ ] **Step 2: Run it**

Run: `node tools/verify-touch.mjs`
Expected output (order may vary slightly):

```
PASS  mobile: joystick zone visible
PASS  mobile: rotate overlay hidden in landscape
PASS  mobile: joystick drag right dispatched 'd'
PASS  mobile: attack button dispatched Space
PASS  portrait: rotate overlay visible
PASS  desktop: touch controls hidden
PASS  desktop: rotate overlay hidden
All checks passed.
```

If a check fails, debug with `superpowers:systematic-debugging` before proceeding — likely suspects: pointer-capture on `#joystick-zone` (drag must start inside the zone: left half, bottom 70% of the viewport) and the script-tag path (`ui/touch-controls.js` relative to `renderer/`).

- [ ] **Step 3: Full suite one last time**

Run: `npm test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add tools/verify-touch.mjs
git commit -m "test(touch): playwright verification script for the mobile layout"
```

---

## Deploy note (post-plan, user-triggered)

The web release redeploys to Cloud Run from the `web-release` branch (see memory: `web-release-cloud-run`). Deploying is **not** part of this plan — after the user has tried the build locally (`npm run web`, open from a phone on the LAN or via chromium device emulation), they decide when to redeploy.
