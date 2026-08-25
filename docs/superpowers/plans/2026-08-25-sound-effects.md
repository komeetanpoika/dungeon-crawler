# Sound Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A procedural (Web Audio) sound-effects layer: combat, items, world events, and UI cues, spatialized around the player, with an `M` mute toggle.

**Architecture:** Gameplay code pushes plain cue records onto a `state.sfx` queue (`renderer/systems/sfx.js`, pure, node-testable — same pattern as `feedback.js`). Once per frame, `renderer/render/audio.js` drains the queue and synthesizes each cue with Web Audio (distance gain + stereo pan). A name→recipe registry is the seam for later file-based sounds.

**Tech Stack:** Vanilla JS ES modules, Web Audio API (`AudioContext`, `StereoPannerNode`), `node:test`, playwright-core for the runtime smoke check. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-sound-effects-design.md`

## Global Constraints

- No Web Audio imports anywhere under `renderer/systems/` — systems stay pure and node-testable without stubs.
- `renderer/render/audio.js` is never imported by files under `renderer/systems/` or by gameplay tests (only `test/audio.test.js` imports its pure exports).
- Audio must never break the game: every playback path wrapped in try/catch; unknown cue name → one console warning per name, cue skipped; `AudioContext` construction failure → module disables itself.
- Spatial constants: full volume within 4 tiles (128 px), silent beyond 14 tiles (448 px), pan clamped to ±0.7, tile size 32 px.
- Voice limits: same cue name at most once per 50 ms; max 12 simultaneous voices (oldest dropped).
- Mute: `M` key (edge-triggered, `e.repeat` filtered), ~20 ms gain ramp, persisted to `localStorage` key `dc-muted`.
- ±5 % random pitch jitter per play.
- Run tests with `npm test` from the repo root (`node --test test/`). All existing tests must stay green after every task.
- Commit messages end with the project's standard Claude trailer (see repo git log).

---

### Task 1: Cue queue — `systems/sfx.js`

**Files:**
- Create: `renderer/systems/sfx.js`
- Test: `test/sfx.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks rely on these exact names):
  - `makeSfx(muted = false)` → `{ cues: [], muted }`
  - `sfx(state, name, pos)` — pushes `{ name, px, py }`; `pos` optional `{ px, py }`; safe no-op when `state.sfx` missing
  - `drainSfx(state)` → array of queued cues, clears the queue; `[]` when `state.sfx` missing
  - `CUE_NAMES` — canonical array of every cue name in this feature

- [ ] **Step 1: Write the failing test**

Create `test/sfx.test.js` (model: `test/feedback.test.js`):

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeSfx, sfx, drainSfx, CUE_NAMES } from '../renderer/systems/sfx.js'

describe('sfx queue', () => {
  it('makeSfx starts empty and unmuted by default', () => {
    assert.deepEqual(makeSfx(), { cues: [], muted: false })
    assert.equal(makeSfx(true).muted, true)
  })

  it('sfx pushes a named cue with position', () => {
    const state = { sfx: makeSfx() }
    sfx(state, 'melee-hit', { px: 96, py: 128 })
    assert.deepEqual(state.sfx.cues, [{ name: 'melee-hit', px: 96, py: 128 }])
  })

  it('sfx without position queues a positionless cue', () => {
    const state = { sfx: makeSfx() }
    sfx(state, 'ui-open')
    assert.equal(state.sfx.cues.length, 1)
    assert.equal(state.sfx.cues[0].name, 'ui-open')
    assert.equal(state.sfx.cues[0].px, undefined)
  })

  it('sfx is a safe no-op when state.sfx is missing', () => {
    assert.doesNotThrow(() => sfx({}, 'pickup'))
    assert.doesNotThrow(() => sfx(null, 'pickup'))
  })

  it('drainSfx returns queued cues and clears the queue', () => {
    const state = { sfx: makeSfx() }
    sfx(state, 'pickup')
    sfx(state, 'heal')
    const drained = drainSfx(state)
    assert.deepEqual(drained.map(c => c.name), ['pickup', 'heal'])
    assert.deepEqual(state.sfx.cues, [])
  })

  it('drainSfx returns [] when state.sfx is missing', () => {
    assert.deepEqual(drainSfx({}), [])
    assert.deepEqual(drainSfx(null), [])
  })

  it('CUE_NAMES covers the starter set', () => {
    for (const name of ['melee-swing', 'melee-hit', 'player-hurt', 'pickup', 'ui-open'])
      assert.ok(CUE_NAMES.includes(name), `${name} missing from CUE_NAMES`)
    assert.equal(new Set(CUE_NAMES).size, CUE_NAMES.length, 'duplicate cue names')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/sfx.test.js`
Expected: FAIL — cannot find module `renderer/systems/sfx.js`.

- [ ] **Step 3: Write the implementation**

Create `renderer/systems/sfx.js`:

```js
// Sound-cue queue — the audio twin of feedback.js. Gameplay pushes plain
// records here; render/audio.js drains and plays them once per frame.
// Systems never import Web Audio, so everything stays node-testable.

export const CUE_NAMES = [
  // combat
  'melee-swing', 'melee-hit', 'ranged-shot', 'projectile-hit',
  'magic-cast', 'fire-burst', 'shockwave',
  'player-hurt', 'player-death', 'enemy-death', 'boss-death',
  // world & items
  'pickup', 'key-pickup', 'heal', 'equip', 'drop',
  'gate-open', 'door-locked', 'descend', 'emerge',
  'stance-switch', 'talent-learned', 'rite',
  // UI (positionless)
  'ui-open', 'ui-close', 'ui-move',
]

export function makeSfx(muted = false) {
  return { cues: [], muted }
}

export function sfx(state, name, pos) {
  if (!state?.sfx) return
  state.sfx.cues.push({ name, px: pos?.px, py: pos?.py })
}

export function drainSfx(state) {
  if (!state?.sfx) return []
  const cues = state.sfx.cues
  state.sfx.cues = []
  return cues
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/sfx.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full suite, then commit**

Run: `npm test` — all green.

```bash
git add renderer/systems/sfx.js test/sfx.test.js
git commit -m "feat(game): sfx cue queue — systems push, renderer will drain"
```

---

### Task 2: Recipes and spatial math — pure part of `render/audio.js`

**Files:**
- Create: `renderer/render/audio.js` (pure exports only in this task)
- Test: `test/audio.test.js`

**Interfaces:**
- Consumes: `CUE_NAMES` from `renderer/systems/sfx.js` (test only).
- Produces:
  - `RECIPES` — `{ [cueName]: recipe }`; every recipe has `kind` ∈ `{blip, burst, swoosh, rumble}`, `dur` (s), `vol` (0..1); blips add `wave`, `f0`, `f1`; bursts add `freq`, `q`; swooshes add `f0`, `f1`; rumbles add `freq`
  - `falloffGain(distPx)` → 1 within 128 px, linear to 0 at 448 px
  - `panFor(dxPx)` → clamped to ±0.7
  - Constants: `TILE_SIZE = 32`, `NEAR_PX = 128`, `FAR_PX = 448`, `PAN_MAX = 0.7`

- [ ] **Step 1: Write the failing test**

Create `test/audio.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RECIPES, falloffGain, panFor, NEAR_PX, FAR_PX, PAN_MAX } from '../renderer/render/audio.js'
import { CUE_NAMES } from '../renderer/systems/sfx.js'

describe('recipe registry', () => {
  it('every cue name has a recipe', () => {
    for (const name of CUE_NAMES)
      assert.ok(RECIPES[name], `no recipe for cue "${name}"`)
  })

  it('every recipe is well-formed', () => {
    for (const [name, r] of Object.entries(RECIPES)) {
      assert.ok(['blip', 'burst', 'swoosh', 'rumble'].includes(r.kind), `${name}: bad kind`)
      assert.ok(r.dur > 0, `${name}: dur must be positive`)
      assert.ok(r.vol > 0 && r.vol <= 1, `${name}: vol out of range`)
    }
  })
})

describe('spatial math', () => {
  it('full volume inside the near radius', () => {
    assert.equal(falloffGain(0), 1)
    assert.equal(falloffGain(NEAR_PX), 1)
  })

  it('silent at and beyond the far radius', () => {
    assert.equal(falloffGain(FAR_PX), 0)
    assert.equal(falloffGain(FAR_PX * 2), 0)
  })

  it('linear falloff between near and far', () => {
    const mid = (NEAR_PX + FAR_PX) / 2
    assert.ok(Math.abs(falloffGain(mid) - 0.5) < 1e-9)
  })

  it('pan is centered at zero offset and clamps to ±PAN_MAX', () => {
    assert.equal(panFor(0), 0)
    assert.equal(panFor(10000), PAN_MAX)
    assert.equal(panFor(-10000), -PAN_MAX)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/audio.test.js`
Expected: FAIL — cannot find module `renderer/render/audio.js`.

- [ ] **Step 3: Write the pure part of the module**

Create `renderer/render/audio.js`:

```js
// Web Audio engine — drains state.sfx cues and synthesizes them.
// The ONLY file that touches Web Audio. Never imported from systems/.
// Pure exports up top (recipes + spatial math) are node-tested; the
// engine below runs only in the real browser/Electron.

export const TILE_SIZE = 32
export const NEAR_PX = TILE_SIZE * 4    // full volume inside this
export const FAR_PX = TILE_SIZE * 14    // silent beyond this
export const PAN_MAX = 0.7
export const THROTTLE_S = 0.05          // per-name minimum gap
export const MAX_VOICES = 12
export const MASTER_VOL = 0.5

// One declarative recipe per cue. kind picks the synth building block:
//   blip   — oscillator, pitch sweeps f0→f1 (wave: square|triangle)
//   burst  — white noise through a bandpass at freq (q = resonance)
//   swoosh — white noise through a bandpass sweeping f0→f1
//   rumble — low sine at freq + filtered noise, longer decay
export const RECIPES = {
  'melee-swing':    { kind: 'swoosh', f0: 900,  f1: 300,  dur: 0.12, vol: 0.5 },
  'melee-hit':      { kind: 'burst',  freq: 700,  q: 1.2,  dur: 0.09, vol: 0.9 },
  'ranged-shot':    { kind: 'swoosh', f0: 1400, f1: 2200, dur: 0.10, vol: 0.5 },
  'projectile-hit': { kind: 'burst',  freq: 900,  q: 1.5,  dur: 0.08, vol: 0.8 },
  'magic-cast':     { kind: 'swoosh', f0: 400,  f1: 1600, dur: 0.25, vol: 0.6 },
  'fire-burst':     { kind: 'rumble', freq: 90,  dur: 0.50, vol: 1.0 },
  'shockwave':      { kind: 'rumble', freq: 70,  dur: 0.35, vol: 0.9 },
  'player-hurt':    { kind: 'burst',  freq: 250,  q: 0.8,  dur: 0.15, vol: 1.0 },
  'player-death':   { kind: 'blip',   wave: 'square',   f0: 440,  f1: 55,   dur: 0.80, vol: 1.0 },
  'enemy-death':    { kind: 'blip',   wave: 'square',   f0: 330,  f1: 90,   dur: 0.25, vol: 0.7 },
  'boss-death':     { kind: 'rumble', freq: 55,  dur: 1.20, vol: 1.0 },
  'pickup':         { kind: 'blip',   wave: 'square',   f0: 660,  f1: 990,  dur: 0.09, vol: 0.6 },
  'key-pickup':     { kind: 'blip',   wave: 'triangle', f0: 660,  f1: 1320, dur: 0.18, vol: 0.7 },
  'heal':           { kind: 'blip',   wave: 'triangle', f0: 440,  f1: 880,  dur: 0.20, vol: 0.6 },
  'equip':          { kind: 'blip',   wave: 'square',   f0: 550,  f1: 660,  dur: 0.07, vol: 0.5 },
  'drop':           { kind: 'blip',   wave: 'square',   f0: 440,  f1: 330,  dur: 0.08, vol: 0.5 },
  'gate-open':      { kind: 'rumble', freq: 80,  dur: 0.80, vol: 0.9 },
  'door-locked':    { kind: 'blip',   wave: 'square',   f0: 220,  f1: 180,  dur: 0.15, vol: 0.6 },
  'descend':        { kind: 'rumble', freq: 65,  dur: 0.90, vol: 0.8 },
  'emerge':         { kind: 'blip',   wave: 'triangle', f0: 330,  f1: 660,  dur: 0.40, vol: 0.6 },
  'stance-switch':  { kind: 'blip',   wave: 'triangle', f0: 500,  f1: 750,  dur: 0.10, vol: 0.5 },
  'talent-learned': { kind: 'blip',   wave: 'triangle', f0: 523,  f1: 1046, dur: 0.50, vol: 0.7 },
  'rite':           { kind: 'rumble', freq: 100, dur: 1.00, vol: 0.7 },
  'ui-open':        { kind: 'blip',   wave: 'square',   f0: 500,  f1: 620,  dur: 0.06, vol: 0.4 },
  'ui-close':       { kind: 'blip',   wave: 'square',   f0: 620,  f1: 500,  dur: 0.06, vol: 0.4 },
  'ui-move':        { kind: 'blip',   wave: 'square',   f0: 700,  f1: 700,  dur: 0.03, vol: 0.3 },
}

export function falloffGain(distPx) {
  if (distPx <= NEAR_PX) return 1
  if (distPx >= FAR_PX) return 0
  return (FAR_PX - distPx) / (FAR_PX - NEAR_PX)
}

export function panFor(dxPx) {
  return Math.max(-1, Math.min(1, dxPx / FAR_PX)) * PAN_MAX
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/audio.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite, then commit**

Run: `npm test` — all green.

```bash
git add renderer/render/audio.js test/audio.test.js
git commit -m "feat(game): sfx recipe registry and spatial falloff math"
```

---

### Task 3: The Web Audio engine — runtime part of `render/audio.js`

**Files:**
- Modify: `renderer/render/audio.js` (append below the pure exports)

**Interfaces:**
- Consumes: `RECIPES`, `falloffGain`, `panFor`, constants (same file).
- Produces (game.js relies on these):
  - `makeAudio()` → engine object; lazy `AudioContext`, one-shot unlock listeners
  - `playCues(audio, cues, player, muted)` — plays each cue spatialized against `player.px/py`; ramps master gain when `muted` changes
  - `registerFile(audio, name, arrayBuffer)` → Promise; decodes and registers a file-based sound that overrides the synth recipe for `name` (the hybrid seam)

No node test — this half needs a real `AudioContext`. It is verified by the audition page (Task 8) and the Electron smoke check (Task 9). The gate for this task: implementation matches this spec, existing suite stays green (proves no accidental import breakage).

- [ ] **Step 1: Append the engine to `renderer/render/audio.js`**

```js
// ---------------------------------------------------------------------------
// Runtime engine — everything below needs a real AudioContext.

export function makeAudio() {
  const audio = {
    ctx: null, master: null, noiseBuf: null,
    files: {},          // name -> AudioBuffer (registered overrides)
    lastPlayed: {},     // name -> ctx.currentTime of last play
    voices: [],         // active { stop } handles, oldest first
    warned: {},         // name -> true (one warning per unknown cue)
    muted: false,
    disabled: false,
  }
  const unlock = () => {
    ensureCtx(audio)
    audio.ctx?.resume?.()
    window.removeEventListener('keydown', unlock)
    window.removeEventListener('pointerdown', unlock)
  }
  window.addEventListener('keydown', unlock)
  window.addEventListener('pointerdown', unlock)
  return audio
}

function ensureCtx(audio) {
  if (audio.ctx || audio.disabled) return
  try {
    audio.ctx = new AudioContext()
    audio.master = audio.ctx.createGain()
    audio.master.gain.value = audio.muted ? 0 : MASTER_VOL
    audio.master.connect(audio.ctx.destination)
    const len = audio.ctx.sampleRate           // 1 s of white noise, shared
    audio.noiseBuf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate)
    const data = audio.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  } catch (err) {
    console.warn('audio disabled:', err)
    audio.disabled = true
  }
}

export async function registerFile(audio, name, arrayBuffer) {
  ensureCtx(audio)
  if (audio.disabled) return
  audio.files[name] = await audio.ctx.decodeAudioData(arrayBuffer)
}

export function playCues(audio, cues, player, muted = false) {
  if (audio.disabled) return
  if (muted !== audio.muted) {
    audio.muted = muted
    if (audio.master) {                        // ~20 ms ramp, no clicks
      const t = audio.ctx.currentTime
      audio.master.gain.cancelScheduledValues(t)
      audio.master.gain.setValueAtTime(audio.master.gain.value, t)
      audio.master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_VOL, t + 0.02)
    }
  }
  if (!cues.length || muted) return
  ensureCtx(audio)
  if (!audio.ctx || audio.ctx.state !== 'running') return   // pre-unlock: drop
  for (const cue of cues) {
    try { playCue(audio, cue, player) }
    catch (err) { console.warn(`sfx "${cue.name}" failed:`, err) }
  }
}

function playCue(audio, cue, player) {
  const recipe = RECIPES[cue.name]
  if (!audio.files[cue.name] && !recipe) {
    if (!audio.warned[cue.name]) {
      console.warn(`sfx: no recipe for cue "${cue.name}"`)
      audio.warned[cue.name] = true
    }
    return
  }
  const now = audio.ctx.currentTime
  if (now - (audio.lastPlayed[cue.name] ?? -Infinity) < THROTTLE_S) return
  audio.lastPlayed[cue.name] = now

  let gain = 1, pan = 0
  if (cue.px !== undefined && player) {
    const dx = cue.px - player.px, dy = cue.py - player.py
    gain = falloffGain(Math.hypot(dx, dy))
    if (gain <= 0) return
    pan = panFor(dx)
  }
  while (audio.voices.length >= MAX_VOICES) audio.voices.shift().stop()

  const out = audio.ctx.createGain()
  const panner = audio.ctx.createStereoPanner()
  panner.pan.value = pan
  out.connect(panner)
  panner.connect(audio.master)

  const file = audio.files[cue.name]
  const stop = file
    ? playFile(audio, file, out, gain)
    : playRecipe(audio, recipe, out, gain)
  const handle = { stop }
  audio.voices.push(handle)
  const dur = file ? file.duration : recipe.dur
  setTimeout(() => {
    const i = audio.voices.indexOf(handle)
    if (i !== -1) audio.voices.splice(i, 1)
  }, dur * 1000 + 100)
}

function playFile(audio, buffer, out, gain) {
  const src = audio.ctx.createBufferSource()
  src.buffer = buffer
  out.gain.value = gain
  src.connect(out)
  src.start()
  return () => { try { src.stop() } catch {} }
}

const jitter = () => 0.95 + Math.random() * 0.1   // ±5 % pitch variance

function playRecipe(audio, r, out, gain) {
  const ctx = audio.ctx
  const t0 = ctx.currentTime
  const t1 = t0 + r.dur
  const j = jitter()
  out.gain.setValueAtTime(gain * r.vol, t0)
  out.gain.exponentialRampToValueAtTime(0.001, t1)
  const started = []

  if (r.kind === 'blip') {
    const osc = ctx.createOscillator()
    osc.type = r.wave
    osc.frequency.setValueAtTime(r.f0 * j, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, r.f1 * j), t1)
    osc.connect(out)
    osc.start(t0); osc.stop(t1)
    started.push(osc)
  } else if (r.kind === 'burst' || r.kind === 'swoosh') {
    const src = ctx.createBufferSource()
    src.buffer = audio.noiseBuf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = r.q ?? 1
    if (r.kind === 'burst') bp.frequency.setValueAtTime(r.freq * j, t0)
    else {
      bp.frequency.setValueAtTime(r.f0 * j, t0)
      bp.frequency.exponentialRampToValueAtTime(Math.max(1, r.f1 * j), t1)
    }
    src.connect(bp); bp.connect(out)
    src.start(t0); src.stop(t1)
    started.push(src)
  } else if (r.kind === 'rumble') {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(r.freq * j, t0)
    const noise = ctx.createBufferSource()
    noise.buffer = audio.noiseBuf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = r.freq * 4
    osc.connect(out)
    noise.connect(lp); lp.connect(out)
    osc.start(t0); osc.stop(t1)
    noise.start(t0); noise.stop(t1)
    started.push(osc, noise)
  }
  return () => started.forEach(n => { try { n.stop() } catch {} })
}
```

- [ ] **Step 2: Verify the suite still passes**

Run: `npm test`
Expected: all green (`test/audio.test.js` imports only the pure exports; the engine code must not execute anything at import time — no top-level `window`/`AudioContext` references outside function bodies).

- [ ] **Step 3: Commit**

```bash
git add renderer/render/audio.js
git commit -m "feat(game): Web Audio engine — synth recipes, spatial pan, voice caps"
```

---

### Task 4: Wire into `game.js` — state, loop, mute key, persistence

**Files:**
- Modify: `renderer/game.js`

**Interfaces:**
- Consumes: `makeSfx`, `sfx`, `drainSfx` from `./systems/sfx.js`; `makeAudio`, `playCues` from `./render/audio.js`.
- Produces: `state.sfx` guaranteed present during play (lazy-ensured in `update()`); `loadMutedPref()` / `saveMutedPref(m)` helpers used by the M-key handler.

Line numbers below are from the current `web-release` head — anchor by the quoted code, not the number, if they have drifted.

- [ ] **Step 1: Add imports**

After the existing feedback import (`renderer/game.js:25`):

```js
import { makeSfx, sfx, drainSfx } from './systems/sfx.js'
import { makeAudio, playCues } from './render/audio.js'
```

- [ ] **Step 2: Create the audio engine and pref helpers**

Near the top, after `const keys = {}` (`renderer/game.js:57`):

```js
const audio = makeAudio()

function loadMutedPref() {
  try { return localStorage.getItem('dc-muted') === '1' } catch { return false }
}
function saveMutedPref(m) {
  try { localStorage.setItem('dc-muted', m ? '1' : '0') } catch {}
}
```

- [ ] **Step 3: Add the M-key mute toggle**

After the inventory `I`-key handler block (`renderer/game.js:69-73`), following the same pattern:

```js
// M toggles sound. The muted flag lives on state.sfx; the audio engine
// ramps its master gain when it sees the flag change in playCues.
window.addEventListener('keydown', e => {
  if ((e.key !== 'm' && e.key !== 'M') || e.repeat) return
  if (!state?.sfx) return
  state.sfx.muted = !state.sfx.muted
  saveMutedPref(state.sfx.muted)
  think(state, state.sfx.muted ? 'Sound muted.' : 'Sound on.')
})
```

- [ ] **Step 4: Lazy-ensure `state.sfx` and drain each frame**

At the very top of `update(delta)` (the main per-frame function — find `function update(delta)`), add as the first line:

```js
if (!state.sfx) state.sfx = makeSfx(loadMutedPref())
```

(Lazy-ensure covers every state-creation path — `beginRun`, arena, caves, respawn, travel — without touching each site; spread-based rebuilds carry `state.sfx` forward automatically.)

In `gameLoop` (`renderer/game.js:468-478`), after the `if (phase === PHASE.PLAYING) { ... }` block and before `rafId = requestAnimationFrame(gameLoop)`, add:

```js
  // Drain sound cues every frame — UI cues fire while PAUSED too.
  if (state?.sfx) playCues(audio, drainSfx(state), state.player, state.sfx.muted)
```

- [ ] **Step 5: Verify suite + quick sanity check**

Run: `npm test` — all green (game.js isn't imported by tests, but the modified systems are).
Sanity: `node -e "import('./renderer/systems/sfx.js').then(m => console.log(Object.keys(m)))"` prints the exports.

- [ ] **Step 6: Commit**

```bash
git add renderer/game.js
git commit -m "feat(game): sfx wired into the loop — drain per frame, M mutes, pref persists"
```

---

### Task 5: Combat cues

**Files:**
- Modify: `renderer/game.js`, `renderer/systems/player-damage.js`
- Test: `test/player-damage.test.js` (extend)

**Interfaces:**
- Consumes: `sfx(state, name, pos)` from Task 1; `makeSfx` in tests.
- Produces: cues `melee-swing`, `melee-hit`, `ranged-shot`, `projectile-hit`, `magic-cast`, `fire-burst`, `shockwave`, `player-hurt`, `player-death`, `enemy-death`, `boss-death` emitted at the sites below.

- [ ] **Step 1: Write the failing test — `player-hurt`**

In `test/player-damage.test.js`, add imports `makeSfx` from `../renderer/systems/sfx.js` and these cases (reuse the file's existing state fixture pattern):

```js
it('queues a player-hurt cue when damage lands', () => {
  const state = freshState()
  state.sfx = makeSfx()
  damagePlayer(state, 3, 'hit')
  assert.deepEqual(state.sfx.cues.map(c => c.name), ['player-hurt'])
  assert.equal(state.sfx.cues[0].px, state.player.px)
})

it('queues no cue when i-frames block the hit', () => {
  const state = freshState()
  state.sfx = makeSfx()
  state.player.invulnTimer = 0.5
  damagePlayer(state, 3, 'hit')
  assert.equal(state.sfx.cues.length, 0)
})
```

(If the file's fixture is named differently, adapt the name; the fixture must include `player: { px, py, hp, invulnTimer }`, `log: []`, `feedback: makeFeedback()`.)

- [ ] **Step 2: Run to verify the new cases fail**

Run: `node --test test/player-damage.test.js`
Expected: the two new cases FAIL (no cue queued); existing cases PASS.

- [ ] **Step 3: Emit `player-hurt` in `player-damage.js`**

In `renderer/systems/player-damage.js`, add `import { sfx } from './sfx.js'` and, inside `damagePlayer` right after the `addFloat(...)` line:

```js
sfx(state, 'player-hurt', { px: player.px, py: player.py })
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/player-damage.test.js` — all PASS.

- [ ] **Step 5: Emit the remaining combat cues in `game.js`**

Each bullet: find the quoted anchor, insert the `sfx(...)` line.

1. **melee-swing** — inside `const swing = (mods) => {` (`renderer/game.js:694`), after `player.attackFacing = player.facing`:
   ```js
   sfx(state, 'melee-swing', { px: player.px, py: player.py })
   ```
2. **melee-hit + enemy/boss deaths from melee** — in the swing's `.map`:
   - Boss branch, after `addFloat(state.feedback, { px: e.px, py: e.py - 10, text: \`-${bossDmg}\`, kind: 'dealt' })` (`renderer/game.js:706`):
     ```js
     sfx(state, 'melee-hit', { px: e.px, py: e.py })
     ```
   - Regular branch, after the `addFloat(...)` at `renderer/game.js:713`:
     ```js
     sfx(state, hitEnemy.hp <= 0 ? 'enemy-death' : 'melee-hit', { px: e.px, py: e.py })
     ```
3. **shockwave** — in the Maunonmiekka `for (const s of struck)` loop (`renderer/game.js:724-729`), after `state.shockwaves.push(...)`:
   ```js
   sfx(state, 'shockwave', { px: s.px, py: s.py })
   ```
4. **magic-cast** — in the gust block (`renderer/game.js:766`), inside `if (cast.ok) {` after `state.shockwaves.push({...})`:
   ```js
   sfx(state, 'magic-cast', { px: player.px, py: player.py })
   ```
5. **ranged-shot** — in `if (attacking && player.attackMode === 'ranged')`, inside `if (shot.ok) {` after `state.projectiles.push(proj)` (`renderer/game.js:797`):
   ```js
   sfx(state, 'ranged-shot', { px: player.px, py: player.py })
   ```
6. **projectile-hit + enemy death from projectile** — in the friendly-projectile `.map`, after the `addFloat(...)` at `renderer/game.js:827`:
   ```js
   sfx(state, e.hp - p.damage <= 0 ? 'enemy-death' : 'projectile-hit', { px: e.px, py: e.py })
   ```
7. **fire-burst + fire kills** — in `detonateFireball` (`renderer/game.js:177`), after `if (!tiles.length) return`:
   ```js
   sfx(state, 'fire-burst', { px, py })
   ```
   and inside the `burst.entities.forEach((e, i) => {` damage check, next to the existing `addFloat`:
   ```js
   if (e.hp <= 0) sfx(state, 'enemy-death', { px: e.px, py: e.py })
   ```
8. **player-death** — in the `if (player.hp <= 0) {` block (`renderer/game.js:1007`), as its first line (fires for both the Adventure respawn and the run-ending death):
   ```js
   sfx(state, 'player-death', { px: player.px, py: player.py })
   ```
9. **boss-death** — in the boss-drop block (`renderer/game.js:1027`), after `state.dropSpawned = true`:
   ```js
   sfx(state, 'boss-death', { px: state.lastBossTile.x * TILE_SIZE, py: state.lastBossTile.y * TILE_SIZE })
   ```

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — all green.

```bash
git add renderer/game.js renderer/systems/player-damage.js test/player-damage.test.js
git commit -m "feat(game): combat sound cues — swings, hits, deaths, casts"
```

---

### Task 6: World & item cues

**Files:**
- Modify: `renderer/game.js`, `renderer/systems/talents.js`
- Test: `test/talents.test.js` (extend)

**Interfaces:**
- Consumes: `sfx` from Task 1.
- Produces: cues `pickup`, `key-pickup`, `heal`, `equip`, `drop`, `gate-open`, `door-locked`, `descend`, `emerge`, `stance-switch`, `talent-learned`, `rite`.

- [ ] **Step 1: Write the failing test — `talent-learned`**

In `test/talents.test.js`, import `makeSfx` from `../renderer/systems/sfx.js` and add (adapting to the file's existing state fixture):

```js
it('queues a talent-learned cue only when newly learned', () => {
  const state = { player: {}, log: [], feedback: makeFeedback(), sfx: makeSfx() }
  grantTalent(state, 'ranged_stance')
  assert.deepEqual(state.sfx.cues.map(c => c.name), ['talent-learned'])
  grantTalent(state, 'ranged_stance')          // already known — no new cue
  assert.equal(state.sfx.cues.length, 1)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/talents.test.js` — new case FAILS.

- [ ] **Step 3: Emit in `talents.js`**

In `renderer/systems/talents.js`, add `import { sfx } from './sfx.js'` and, in `grantTalent` after the `announce(...)` line:

```js
sfx(state, 'talent-learned')
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/talents.test.js` — all PASS.

- [ ] **Step 5: Emit the remaining world cues in `game.js`**

All positionless unless a position is given (these all happen at/near the player):

1. **pickup** — in `grantContents` (`renderer/game.js:197`), just before `return true` at the end (after the `speak(...)` line):
   ```js
   sfx(state, 'pickup')
   ```
2. **key-pickup** — in the key-pickup block, after `speak(state, 'You picked up the key!')` (`renderer/game.js:599`):
   ```js
   sfx(state, 'key-pickup')
   ```
3. **heal** — in `useInventoryItem`, after `speak(state, \`Healed ${healed} HP!\`)` (`renderer/game.js:440`):
   ```js
   sfx(state, 'heal')
   ```
4. **equip** — in `openInventory`'s `onEquip` handler (`renderer/game.js:393-397`), inside the success path:
   ```js
   onEquip: (i) => {
     const r = equipItem(state.player, i)
     if (!r.ok) think(state, EQUIP_FAIL_MESSAGES[r.reason] ?? "Can't equip that.")
     else sfx(state, 'equip')
     afterInventoryChange()
   },
   ```
5. **drop** — in `dropInventoryItem`, after `state.entities.push({...})` (`renderer/game.js:457-464`):
   ```js
   sfx(state, 'drop')
   ```
6. **gate-open** — after `speak(state, 'Water flows — the vined gate grinds open!')` (`renderer/game.js:662`):
   ```js
   sfx(state, 'gate-open')
   ```
7. **door-locked** — after `think(state, 'The door is locked — defeat the boss for its key.')` (`renderer/game.js:628`; the existing `lockedMsgCooldown` already throttles it):
   ```js
   sfx(state, 'door-locked')
   ```
8. **descend** — three sites: in `enterCave` after each of its two `announce(...)` calls (`renderer/game.js:1078` and `:1090`), and in `descendLevel` after `announce(state, \`Level ${next}. Deeper…\`)` (`renderer/game.js:1172`):
   ```js
   sfx(state, 'descend')
   ```
9. **emerge** — in `exitCave` after the `announce(...)` if/else (`renderer/game.js:1099-1101`), one line covering both branches:
   ```js
   sfx(state, 'emerge')
   ```
10. **stance-switch** — after `if (landedStance) think(state, {...}[landedStance])` (`renderer/game.js:676`), extend to:
    ```js
    if (landedStance) {
      think(state, { melee: 'Melee stance.', ranged: 'Ranged stance.', magic: 'Magic stance.' }[landedStance])
      sfx(state, 'stance-switch')
    }
    ```
11. **rite** — where the rite starts, after `state.rite = { t: 0, dur: RITE_DURATION, ... }` (`renderer/game.js:613`):
    ```js
    sfx(state, 'rite', { px: player.px, py: player.py })
    ```

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — all green.

```bash
git add renderer/game.js renderer/systems/talents.js test/talents.test.js
git commit -m "feat(game): world and item sound cues"
```

---

### Task 7: UI cues

**Files:**
- Modify: `renderer/game.js`, `renderer/ui/inventory-panel.js`

**Interfaces:**
- Consumes: `sfx` from Task 1.
- Produces: cues `ui-open`, `ui-close`, `ui-move`.

- [ ] **Step 1: Emit open/close cues in `game.js`**

1. In `openInventory` (`renderer/game.js:389`), after `inventoryOpen = true`:
   ```js
   sfx(state, 'ui-open')
   ```
2. In `closeInventory` (`renderer/game.js:405`), as its first line:
   ```js
   sfx(state, 'ui-close')
   ```
3. In `openSign` (`renderer/game.js:413`), after `setPhase(PHASE.PAUSED)`:
   ```js
   sfx(state, 'ui-open')
   ```
4. In `closeSign` (`renderer/game.js:419`), before `hideSign()`:
   ```js
   sfx(state, 'ui-close')
   ```

- [ ] **Step 2: Emit `ui-move` in the inventory panel**

In `renderer/ui/inventory-panel.js`: add `import { sfx } from '../systems/sfx.js'` at the top. In the `keyHandler` (lines 98-113), the arrow-key branches mutate `selected`; wrap them so a cue fires only when the selection actually moves:

```js
const prev = selected
if (e.key === 'ArrowRight') selected = Math.min(Math.max(0, n - 1), selected + 1)
else if (e.key === 'ArrowLeft') selected = Math.max(0, selected - 1)
else if (e.key === 'ArrowDown') selected = Math.min(Math.max(0, n - 1), selected + cols)
else if (e.key === 'ArrowUp') selected = Math.max(0, selected - cols)
if (selected !== prev) sfx(lastState, 'ui-move')
```

(`lastState` is the module-level state reference the panel already keeps — see its `refreshInventory(lastState)` usage at line 59.)

- [ ] **Step 3: Run the full suite, then commit**

Run: `npm test` — all green (the panel isn't node-tested; the import must not break anything that IS tested — `sfx.js` has no DOM dependencies, so it can't).

```bash
git add renderer/game.js renderer/ui/inventory-panel.js
git commit -m "feat(game): UI sound cues — panel open/close, slot navigation"
```

---

### Task 8: Audition page

**Files:**
- Create: `tools/sfx-audition/index.html`
- Create: `tools/sfx-audition/serve.mjs`

**Interfaces:**
- Consumes: `RECIPES`, `makeAudio`, `playCues` from `renderer/render/audio.js`; `CUE_NAMES` from `renderer/systems/sfx.js` — imported directly by the page, so tuning edits to `audio.js` are auditioned live on refresh.
- Produces: a local page for listening to every cue (with distance/pan sliders). Tuning tool only — not part of the game or the test suite.

- [ ] **Step 1: Write the server**

Create `tools/sfx-audition/serve.mjs` (same pattern as the anim-comparison server — serve the repo root so `renderer/` imports resolve; run from repo root):

```js
// Audition server: node tools/sfx-audition/serve.mjs  → http://localhost:8123
// Serves the repo root so the page can import renderer/ modules directly.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = process.cwd()
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }

createServer(async (req, res) => {
  const path = req.url === '/' ? '/tools/sfx-audition/index.html' : decodeURIComponent(req.url.split('?')[0])
  const file = normalize(join(ROOT, path))
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end() }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404); res.end('not found')
  }
}).listen(8123, () => console.log('sfx audition → http://localhost:8123'))
```

- [ ] **Step 2: Write the page**

Create `tools/sfx-audition/index.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>SFX audition</title>
<style>
  body { font-family: monospace; background: #1a1a1f; color: #ddd; padding: 20px; max-width: 720px }
  h1 { font-size: 16px } h2 { font-size: 13px; color: #8af; margin-top: 20px }
  button { margin: 3px; padding: 6px 10px; background: #2a2a33; color: #ddd; border: 1px solid #444; cursor: pointer }
  button:hover { background: #3a3a46 }
  label { display: block; margin: 8px 0 }
  #hint { color: #888 }
</style>
<h1>SFX audition</h1>
<p id="hint">Click anywhere once to unlock audio, then press buttons. Sliders spatialize the next play.</p>
<label>Distance (tiles): <input id="dist" type="range" min="0" max="16" value="0" step="0.5"> <span id="distv">0</span></label>
<label>Horizontal offset (tiles, − left / + right): <input id="dx" type="range" min="-16" max="16" value="0" step="0.5"> <span id="dxv">0</span></label>
<div id="groups"></div>
<script type="module">
  import { makeAudio, playCues, RECIPES, TILE_SIZE } from '/renderer/render/audio.js'
  import { CUE_NAMES } from '/renderer/systems/sfx.js'

  const audio = makeAudio()
  const player = { px: 0, py: 0 }
  const dist = document.getElementById('dist'), dx = document.getElementById('dx')
  dist.oninput = () => document.getElementById('distv').textContent = dist.value
  dx.oninput = () => document.getElementById('dxv').textContent = dx.value

  const groups = { combat: [], world: [], ui: [] }
  for (const name of CUE_NAMES) {
    const g = name.startsWith('ui-') ? 'ui'
      : ['pickup','key-pickup','heal','equip','drop','gate-open','door-locked','descend','emerge','stance-switch','talent-learned','rite'].includes(name) ? 'world'
      : 'combat'
    groups[g].push(name)
  }
  const root = document.getElementById('groups')
  for (const [title, names] of Object.entries(groups)) {
    const h = document.createElement('h2'); h.textContent = title; root.append(h)
    for (const name of names) {
      const b = document.createElement('button')
      b.textContent = `${name} (${RECIPES[name].kind})`
      b.onclick = () => {
        const dPx = Number(dist.value) * TILE_SIZE
        const dxPx = Number(dx.value) * TILE_SIZE
        const dyPx = Math.sqrt(Math.max(0, dPx * dPx - dxPx * dxPx))
        playCues(audio, [{ name, px: player.px + dxPx, py: player.py + dyPx }], player, false)
      }
      root.append(b)
    }
  }
</script>
```

- [ ] **Step 3: Verify it serves and commit**

Run: `node tools/sfx-audition/serve.mjs` from the repo root, then `curl -s localhost:8123 | head -3` (expect the doctype) and `curl -so /dev/null -w '%{http_code}' localhost:8123/renderer/render/audio.js` (expect `200`). Stop the server. Actual listening/tuning is the human's part — tell them the command.

```bash
git add tools/sfx-audition/
git commit -m "chore(tools): sfx audition page — every cue on a button, spatial sliders"
```

---

### Task 9: Runtime smoke check, docs, final verification

**Files:**
- Create: `tools/sfx-audition/smoke.mjs` (throwaway-grade script, kept for reruns)
- Modify: `/home/lappemikb/CLAUDE.md` (dungeon-crawler architecture paragraph)

**Interfaces:**
- Consumes: the running game via playwright-core `_electron` (works on WSLg with `DISPLAY=:0` — see memory `verify-editor-with-playwright`).
- Produces: evidence the `AudioContext` unlocks and no console errors fire in real gameplay.

- [ ] **Step 1: Write the smoke script**

Create `tools/sfx-audition/smoke.mjs`:

```js
// Launch the game in Electron, press a key, verify the AudioContext unlocks
// and nothing errors. Run from repo root: node tools/sfx-audition/smoke.mjs
import { _electron } from 'playwright-core'

const app = await _electron.launch({ args: ['.'], env: { ...process.env, DISPLAY: ':0' } })
const win = await app.firstWindow()
const errors = []
win.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2000)          // let init() finish
await win.keyboard.press('Enter')       // any gesture unlocks audio
await win.waitForTimeout(500)

const ctxState = await win.evaluate(() =>
  new AudioContext().state)             // same policy gate the engine faces
console.log('AudioContext state after gesture:', ctxState)
console.log('console errors:', errors.length ? errors : 'none')
await app.close()
if (ctxState !== 'running' || errors.length) process.exit(1)
console.log('SMOKE OK')
```

- [ ] **Step 2: Run it (short — do not linger)**

Run: `node tools/sfx-audition/smoke.mjs`
Expected: `SMOKE OK`. Afterwards run `git status renderer/data/` — must be clean (see memory `editor-autosave-data-hazard`); restore if not.

- [ ] **Step 3: Update workspace docs**

In `/home/lappemikb/CLAUDE.md`, dungeon-crawler **Architecture** section: in the `renderer/systems/` list, after the `rites` entry, add `` `sfx` (sound-cue queue — systems push named cues, the audio engine drains them per frame) ``; in the `renderer/render/` list add `` `audio` (Web Audio synthesis: recipes, distance/pan spatialization, M mutes) ``.

- [ ] **Step 4: Full-suite verification and final commit**

Run: `npm test` — all green. Confirm `git status` shows only intended files.

```bash
git add tools/sfx-audition/smoke.mjs /home/lappemikb/CLAUDE.md
git commit -m "chore(game): sfx runtime smoke check + docs"
```

- [ ] **Step 5: Manual listen**

Tell the user: start the game (`npm start`) and play a fight; start the audition page (`node tools/sfx-audition/serve.mjs`) for isolated listening. Collect tuning feedback — recipe tweaks are single-line edits in `RECIPES`.
