# Timewarp Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three leap creatures onto the monster-rig pipeline with real fade/sink/death transitions, turn the Echo into a companion ghost, and rewrite the fold and hermit puzzles so wolves and fire, not the player's sword, resolve them.

**Architecture:** The creatures become registry monsters (`renderer/data/monsters/*.json` + hook modules under `renderer/systems/monsters/`) drawn by two new rigs plus the quadruped. A tiny `fade.js` and `dying.js` give every creature smoothed alpha and a death pose before the cull. `systems/echo.js` drives one trailing Echo per map. Wolves get a `hunt_prey` NPC goal; the Sammunut burns only in the light of fires built from a new `deadwood` item.

**Tech Stack:** Vanilla ES modules in Electron, `node:test` (`node --test test/`), canvas 2D, the existing monster-lab (`npm run monster-lab`).

**Spec:** `docs/superpowers/specs/2026-09-03-timewarp-refinement-design.md`

## Global Constraints

- Systems under `renderer/systems/` stay **pure**: no DOM, no Electron, no `window`. Renderer code lives under `renderer/render/`.
- Rigs draw **rect-only** art through `withPixelStage` from `renderer/render/monster-rigs/pixel.js`; every rig exports `RIG_ID`, `PARAM_SCHEMA`, `drawMonster(ctx, params, pose, S)`, `hitHalf(params)`.
- Creature damage goes through `hurtCreature` (Task 6) only; kills are recorded in `state.creatureKills[type]` there and nowhere else.
- No change to runestone rules, leap flag names, or the Timewarp save shape.
- Tile size constant is `32`; art px per tile is `TILE_ART_PX = 16`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011rUoRtSgtBQooBPLP7GiJn
  ```
- Work on branch `timewarp-refinement` (already created; the spec is its first commit).
- Run the full suite (`node --test test/`) before every commit; it must be green.

---

## File map

| File | Responsibility |
|---|---|
| `renderer/systems/fade.js` (new) | `stepFade` — smoothed alpha toward a target |
| `renderer/systems/dying.js` (new) | death phase: `beginDying`, `cullDead`, `tickDying`, `dyingAlpha` |
| `renderer/systems/factions.js` | `isEnemy`/`isHittable`/`isDead` honour `dying`, registry `passive` |
| `renderer/systems/creatures.js` | hook registries, `strikeCreature(e, state, dmg, opts)`, `hurtCreature` |
| `renderer/systems/monsters.js` | registry; `isStoryCreature`; pose channels; dying alpha in draw |
| `renderer/systems/monsters/{nakki,maahinen,sammunut}.js` (moved) | creature hooks with lazy init |
| `renderer/data/monsters/{nakki,maahinen,sammunut}.json` (new) | defs |
| `renderer/render/monster-rigs/{lurker,wraith}.js` (new), `quadruped.js` | rigs |
| `renderer/systems/echo.js` (new) | Echo follow / visibility / speech |
| `renderer/systems/leap.js`, `renderer/data/leaps.js` | one-Echo spawn, `tame`, new lines |
| `renderer/systems/npc.js`, `renderer/data/npcs.js` | `hunt_prey` goal, wolf `prey` |
| `renderer/systems/openmap.js` | tame species spawn non-hostile |
| `renderer/systems/campfire.js`, `lumber.js`, `inventory.js` | deadwood fuel, `drop` |
| `renderer/systems/episodes/{ferry,fold,hermit}.js` | spawn kinds, deadwood hearth, leaving Näkki |
| `renderer/game.js`, `renderer/render/canvas.js` | wiring, Echo look, grey fire |
| `tools/npc-placeholders.mjs`, `renderer/assets/tiles/` | `item_deadwood.png`, delete custom creature tiles |

---

### Task 1: Fade helper

**Files:**
- Create: `renderer/systems/fade.js`
- Test: `test/fade.test.js`

**Interfaces:**
- Produces: `stepFade(e, target, delta, { inTime = 0.5, outTime = 0.35 } = {}) → number` — mutates and returns `e.fadeA`.

- [ ] **Step 1: Write the failing test**

```js
// test/fade.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stepFade } from '../renderer/systems/fade.js'

describe('stepFade', () => {
  it('starts at the target when the entity has no fadeA yet', () => {
    assert.equal(stepFade({}, 0, 0.016), 0)
    assert.equal(stepFade({}, 1, 0.016), 1)
  })
  it('rises toward 1 at 1/inTime per second and clamps', () => {
    const e = { fadeA: 0 }
    stepFade(e, 1, 0.25, { inTime: 0.5 })
    assert.ok(Math.abs(e.fadeA - 0.5) < 1e-9)
    stepFade(e, 1, 5, { inTime: 0.5 })
    assert.equal(e.fadeA, 1)
  })
  it('falls toward 0 at 1/outTime per second', () => {
    const e = { fadeA: 1 }
    stepFade(e, 0, 0.175, { outTime: 0.35 })
    assert.ok(Math.abs(e.fadeA - 0.5) < 1e-9)
    stepFade(e, 0, 5, { outTime: 0.35 })
    assert.equal(e.fadeA, 0)
  })
  it('returns the new value', () => {
    const e = { fadeA: 0.2 }
    assert.equal(stepFade(e, 0.2, 1), 0.2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/fade.test.js`
Expected: FAIL — cannot find module `fade.js`.

- [ ] **Step 3: Implement**

```js
// renderer/systems/fade.js
// Smoothed visibility for creatures and the Echo: every frame a hook asks
// for a target alpha (0 or 1) and fadeA eases toward it at a fixed rate.
// Pure — no browser imports.
export function stepFade(e, target, delta, { inTime = 0.5, outTime = 0.35 } = {}) {
  if (!Number.isFinite(e.fadeA)) e.fadeA = target
  const rate = target > e.fadeA ? 1 / inTime : 1 / outTime
  const step = Math.max(-rate * delta, Math.min(rate * delta, target - e.fadeA))
  e.fadeA = Math.max(0, Math.min(1, e.fadeA + step))
  return e.fadeA
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/fade.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/fade.js test/fade.test.js
git commit -m "feat(systems): stepFade — smoothed alpha toward a target"
```

---

### Task 2: Dying phase for registry monsters

**Files:**
- Create: `renderer/systems/dying.js`
- Modify: `renderer/systems/factions.js`, `renderer/systems/monsters.js` (drawGeneratedMonster), `renderer/game.js` (three cull sites, enemy loop)
- Test: `test/dying.test.js`, `test/factions.test.js`

**Interfaces:**
- Produces: `DEATH_TIME = 0.7`, `beginDying(e)`, `cullDead(entities, hasDeathPose)`, `tickDying(entities, delta)`, `dyingAlpha(e)`.
- `factions.isEnemy/isHittable/isDead` all return `false` for `e.dying > 0`.

- [ ] **Step 1: Write the failing tests**

```js
// test/dying.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEATH_TIME, beginDying, cullDead, tickDying, dyingAlpha } from '../renderer/systems/dying.js'
import { isEnemy, isHittable, isDead } from '../renderer/systems/factions.js'

const rig = e => e.type === 'rigged'

describe('dying phase', () => {
  it('a rigged monster at 0 hp enters dying instead of being culled', () => {
    const m = { type: 'rigged', hp: 0, attack: { t: 0 } }
    const out = cullDead([m, { type: 'guard', hp: 0 }, { type: 'guard', hp: 3 }], rig)
    assert.deepEqual(out.map(e => e.type), ['rigged', 'guard'])
    assert.equal(m.dying, DEATH_TIME)
    assert.equal(m.attack, null)
  })
  it('does not restart a phase already running', () => {
    const m = { type: 'rigged', hp: -2, dying: 0.2 }
    cullDead([m], rig)
    assert.equal(m.dying, 0.2)
  })
  it('tickDying counts down and drops the expired', () => {
    const m = { type: 'rigged', hp: 0, dying: 0.1 }
    assert.equal(tickDying([m], 0.05).length, 1)
    assert.ok(Math.abs(m.dying - 0.05) < 1e-9)
    assert.equal(tickDying([m], 0.05).length, 0)
  })
  it('a dying monster is neither hittable, an enemy nor dead', () => {
    const m = { type: 'guard', hp: 0, dying: 0.3 }
    assert.equal(isHittable(m), false)
    assert.equal(isEnemy(m), false)
    assert.equal(isDead(m), false)
  })
  it('dyingAlpha holds 1 then ramps to 0 over the last 40 %', () => {
    assert.equal(dyingAlpha({}), 1)
    assert.equal(dyingAlpha({ dying: DEATH_TIME }), 1)
    assert.ok(Math.abs(dyingAlpha({ dying: DEATH_TIME * 0.2 }) - 0.5) < 1e-9)
    assert.equal(dyingAlpha({ dying: 0 }), 0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/dying.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `dying.js`**

```js
// renderer/systems/dying.js
// The death phase: a rig-drawn monster that reaches 0 hp stays in the
// entity list for DEATH_TIME playing its 'death' pose and fading, instead
// of vanishing on the frame it dies. Dependency-free so game.js, factions
// and the monster registry can all import it without cycles: the caller
// says which entities have a death pose.
import { isDead } from './factions.js'

export const DEATH_TIME = 0.7

export function beginDying(e) {
  e.dying = DEATH_TIME
  e.attack = null
}

// The frame's cull: entities with a death pose enter dying at 0 hp and are
// kept; everything else that isDead is dropped, as before.
export function cullDead(entities, hasDeathPose) {
  return entities.filter(e => {
    if (e.dying > 0) return true
    if (hasDeathPose(e) && Number.isFinite(e.hp) && e.hp <= 0) { beginDying(e); return true }
    return !isDead(e)
  })
}

// Once per frame: advance every dying timer, drop the expired.
export function tickDying(entities, delta) {
  return entities.filter(e => {
    if (!(e.dying > 0)) return true
    e.dying -= delta
    return e.dying > 0
  })
}

// 1 for most of the phase, then a linear ramp to 0 over its last 40 %.
export function dyingAlpha(e) {
  if (!Number.isFinite(e.dying)) return 1
  return Math.max(0, Math.min(1, e.dying / (DEATH_TIME * 0.4)))
}
```

- [ ] **Step 4: Gate the faction predicates on `dying`**

In `renderer/systems/factions.js` replace the three exported functions:

```js
export function isEnemy(e) {
  if (e.dying > 0) return false
  const def = getMonsterDef(e.type)
  return e.type === 'guard' || e.type === 'monster' || e.type === 'dragon'
      || e.type === 'cyclops' || e.type === 'wizard' || e.type === 'crab'
      || e.type === 'dragon_boss' || e.type === 'maahinen' || e.type === 'sammunut'
      || (e.type === 'npc' && e.hostile)
      || (!!def && !def.behavior?.passive)
}

// Things the player's weapons can hurt: every enemy, peaceful NPCs, nakki,
// and every registry monster (passive ones included).
export function isHittable(e) {
  if (e.dying > 0) return false
  return isEnemy(e) || e.type === 'npc' || e.type === 'nakki' || !!getMonsterDef(e.type)
}

export function isDead(e) {
  if (e.dying > 0) return false
  return isHittable(e) && Number.isFinite(e.hp) && e.hp <= 0
}
```

(The `maahinen`/`sammunut`/`nakki` literals go away in Task 7.)

- [ ] **Step 5: Fade the dying monster in `drawGeneratedMonster`**

In `renderer/systems/monsters.js` add `import { dyingAlpha } from './dying.js'` and change the alpha line:

```js
  const alpha = creatureAlpha(e, state) * dyingAlpha(e)
```

- [ ] **Step 6: Wire `game.js`**

Add the import: `import { cullDead, tickDying } from './systems/dying.js'`.

Replace the three `state.entities = state.entities.filter(e => !isDead(e))` sites and the melee `.filter(e => !isDead(e))` chain end (around lines 1122, 1300, 1558) with `cullDead(...)`:

```js
      .filter(e => !isDead(e))
```
→ (melee, it is a chain; assign after the chain instead)
```js
    state.entities = cullDead(state.entities, e => !!getMonsterDef(e.type))
```
and the two `state.entities = state.entities.filter(e => !isDead(e))` → `state.entities = cullDead(state.entities, e => !!getMonsterDef(e.type))`.

At the top of the enemy-AI loop (just before `for (const e of [...state.entities])`):

```js
  state.entities = tickDying(state.entities, delta)
```

Inside that loop, right after the `npc` line and before `isCreature`:

```js
    if (e.dying > 0) { if (getMonsterDef(e.type)) updateMonsterPose(e, delta); continue }
```

- [ ] **Step 7: Run the suite**

Run: `node --test test/`
Expected: PASS. If `test/factions.test.js` asserts `isHittable({type:'npc', dying: …})`-style cases, none exist; otherwise fix any assertion that assumed registry monsters are always enemies.

- [ ] **Step 8: Commit**

```bash
git add renderer/systems/dying.js renderer/systems/factions.js renderer/systems/monsters.js renderer/game.js test/dying.test.js
git commit -m "feat(monsters): dying phase — death pose and fade before the cull"
```

---

### Task 3: Pose channels + quadruped sink

**Files:**
- Modify: `renderer/systems/monsters.js` (`entityPose`), `renderer/render/monster-rigs/quadruped.js`
- Test: `test/monsters.test.js`, `test/monster-rigs.test.js`

**Interfaces:**
- `entityPose(e)` gains `sink`, `burn`, `flicker` read from `e.sink`, `e.burn`, `e.flicker` (default 0).
- Quadruped shrinks and dims with `pose.sink`.

- [ ] **Step 1: Failing tests**

Append to `test/monsters.test.js`:

```js
describe('entityPose channels', () => {
  it('passes sink/burn/flicker through from the entity, defaulting to 0', () => {
    assert.deepEqual([entityPose({}).sink, entityPose({}).burn, entityPose({}).flicker], [0, 0, 0])
    const p = entityPose({ sink: 0.5, burn: 0.25, flicker: 1 })
    assert.deepEqual([p.sink, p.burn, p.flicker], [0.5, 0.25, 1])
  })
})
```

Append to `test/monster-rigs.test.js` inside `describe('quadruped drawMonster')`:

```js
  it('sink shrinks the figure (a scale op appears) and stays balanced', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('idle'), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('idle', { sink: 0.8 }), 32)
    const scales = ops => ops.filter(o => o[0] === 'scale').length
    assert.ok(scales(b.ops) > scales(a.ops))
    assert.equal(b.ops.filter(o => o[0] === 'save').length, b.ops.filter(o => o[0] === 'restore').length)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/monsters.test.js test/monster-rigs.test.js`
Expected: the two new tests FAIL.

- [ ] **Step 3: Implement**

`renderer/systems/monsters.js` `entityPose`:

```js
export function entityPose(e) {
  const p = e.pose ?? { t: 0, state: 'idle', stateT: 0, facing: 0, speed01: 0, seed: 0 }
  return { t: p.t, state: p.state, stateT: p.stateT, facing: p.facing, speed01: p.speed01, seed: p.seed,
           headAim: p.headAim, eyeGlow: p.eyeGlow ?? 0,
           // hook-written channels live on the entity (a hook may run before
           // the first pose update): how far it has sunk, burned, flickers
           sink: e.sink ?? 0, burn: e.burn ?? 0, flicker: e.flicker ?? 0 }
}
```

`quadruped.js` `drawMonster`, right after `c.save()` and the death line:

```js
    const sink = Math.max(0, Math.min(1, pose.sink ?? 0))
    if (sink > 0) { const k = 1 - 0.75 * sink; c.scale(k, k); c.globalAlpha *= 1 - 0.5 * sink }
```

- [ ] **Step 4: Run tests**

Run: `node --test test/monsters.test.js test/monster-rigs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/monsters.js renderer/render/monster-rigs/quadruped.js test/monsters.test.js test/monster-rigs.test.js
git commit -m "feat(rigs): sink/burn/flicker pose channels; quadruped sinks"
```

---

### Task 4: `lurker` rig (Näkki)

**Files:**
- Create: `renderer/render/monster-rigs/lurker.js`
- Test: `test/rig-lurker.test.js`

**Interfaces:**
- Produces: `RIG_ID = 'lurker'`, `PARAM_SCHEMA`, `drawMonster`, `hitHalf`.

- [ ] **Step 1: Failing test**

```js
// test/rig-lurker.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf } from '../renderer/render/monster-rigs/lurker.js'

function recordingCtx() {
  const target = { ops: [], createLinearGradient: () => ({ addColorStop: () => {} }),
                   createRadialGradient: () => ({ addColorStop: () => {} }) }
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { t.ops.push([k, ...a]) } },
    set(t, k, v) { t[k] = v; return true },
  })
}
const pose = (state, over = {}) => ({ t: 1.25, state, stateT: 0.1, facing: 0, speed01: 0, seed: 3, sink: 0, burn: 0, flicker: 0, ...over })
const extremes = which => Object.fromEntries(PARAM_SCHEMA.map(p => [p.key, p.type === 'range' ? p[which] : p.default]))

describe('lurker rig', () => {
  it('has a valid schema and id', () => {
    assert.deepEqual(schemaErrors(PARAM_SCHEMA), [])
    assert.equal(RIG_ID, 'lurker')
  })
  for (const state of ['idle', 'hit', 'walk', 'attack', 'death']) {
    it(`draws in state ${state} at defaults, min and max`, () => {
      for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
        const ctx = recordingCtx()
        assert.doesNotThrow(() => drawMonster(ctx, params, pose(state), 32))
        assert.ok(ctx.ops.length > 10)
        assert.equal(ctx.ops.filter(o => o[0] === 'save').length, ctx.ops.filter(o => o[0] === 'restore').length)
      }
    })
  }
  it('sinking clips: fully sunk draws fewer fill ops than surfaced', () => {
    const up = recordingCtx(), down = recordingCtx()
    drawMonster(up, defaultParams(PARAM_SCHEMA), pose('idle'), 32)
    drawMonster(down, defaultParams(PARAM_SCHEMA), pose('idle', { sink: 1 }), 32)
    const fills = ops => ops.filter(o => o[0] === 'fillRect').length
    assert.ok(fills(down.ops) < fills(up.ops))
    assert.ok(down.ops.some(o => o[0] === 'clip'))
  })
  it('flips when facing west', () => {
    const ctx = recordingCtx()
    drawMonster(ctx, defaultParams(PARAM_SCHEMA), pose('idle', { facing: Math.PI }), 32)
    assert.ok(ctx.ops.some(o => o[0] === 'scale' && o[1] === -1))
  })
  it('hitHalf stays within the nav-supported range', () => {
    for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
      const h = hitHalf(params)
      assert.ok(h >= 8 && h <= 28, String(h))
    }
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/rig-lurker.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement the rig**

```js
// renderer/render/monster-rigs/lurker.js
// 16-bit pixel water lurker: a dome head with wide eyes breaking the
// waterline, weed hair hanging off the crown, a low body band at the surface
// and a ripple ring around it. Upright art — it never rotates with facing,
// only flips. `pose.sink` (0..1) pulls the whole figure under the waterline
// (clipped), which is how the Näkki submerges without a fade.
import { TILE_ART_PX, palette, frameOf, withPixelStage } from './pixel.js'

export const RIG_ID = 'lurker'

export const PARAM_SCHEMA = [
  { key: 'headWidth',  label: 'Head width',   group: 'head', type: 'range', min: 0.6, max: 2.0, step: 0.05, default: 1.2 },
  { key: 'headHeight', label: 'Head height',  group: 'head', type: 'range', min: 0.4, max: 1.4, step: 0.05, default: 0.7 },
  { key: 'eyeSize',    label: 'Eye size',     group: 'head', type: 'range', min: 0.06, max: 0.3, step: 0.01, default: 0.12 },
  { key: 'eyeGap',     label: 'Eye gap',      group: 'head', type: 'range', min: 0.2, max: 0.9, step: 0.05, default: 0.5 },
  { key: 'weedLength', label: 'Weed length',  group: 'weed', type: 'range', min: 0.0, max: 1.2, step: 0.05, default: 0.5 },
  { key: 'weedCount',  label: 'Weed strands', group: 'weed', type: 'range', min: 2, max: 9, step: 1, default: 5 },
  { key: 'sway',       label: 'Sway',         group: 'weed', type: 'range', min: 0.0, max: 1.0, step: 0.05, default: 0.5 },
  { key: 'rippleSize', label: 'Ripple size',  group: 'water', type: 'range', min: 0.5, max: 2.0, step: 0.05, default: 1.2 },
  { key: 'skinColor',   label: 'Skin',   group: 'skin', type: 'color', default: '#3f5a3a' },
  { key: 'weedColor',   label: 'Weed',   group: 'skin', type: 'color', default: '#2c3f26' },
  { key: 'eyeColor',    label: 'Eyes',   group: 'skin', type: 'color', default: '#d8e86a' },
  { key: 'rippleColor', label: 'Ripple', group: 'skin', type: 'color', default: '#6f9fbf' },
]

const R = Math.round
const WHITE = '#f8f8f8'
const WATER = 2   // art px below the stage centre where the surface lies
const ceilTile = v => Math.max(TILE_ART_PX, Math.ceil(v / TILE_ART_PX) * TILE_ART_PX)

function dims(p) {
  const headW = 2 * Math.max(3, R(p.headWidth * 8))
  const headH = Math.max(3, R(p.headHeight * 10))
  const eye = Math.max(1, R(p.eyeSize * 8))
  const gap = Math.max(1, R(p.eyeGap * headW / 4))
  const weedLen = R(p.weedLength * 10)
  const weeds = R(p.weedCount)
  const ripple = Math.max(3, R(p.rippleSize * 10))
  return { headW, headH, eye, gap, weedLen, weeds, ripple,
           artW: ceilTile(Math.max(headW + 6, 2 * ripple + 6)),
           artH: ceilTile(2 * (headH + 8)) }
}

export function hitHalf(p) {
  const d = dims(p)
  return Math.max(8, Math.min(28, R(d.headW * 0.6)))
}

export function drawMonster(ctx, p, pose, S) {
  const d = dims(p)
  const { state } = pose
  const hit = state === 'hit'
  const pal = hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(p.skinColor)
  const weed = hit ? WHITE : palette(p.weedColor).outline
  const eye = hit ? WHITE : palette(p.eyeColor).light
  const rippleCol = hit ? WHITE : palette(p.rippleColor).light
  const sink = Math.max(0, Math.min(1, pose.sink ?? 0))
  const flip = Math.cos(pose.facing ?? 0) < 0
  const F = frameOf(pose.t, 1 + p.sway * 4, 2)

  withPixelStage(ctx, d.artW, d.artH, 0, S, c => {
    c.save()
    if (flip) c.scale(-1, 1)

    // ripple ring on the surface — never clipped, fades once mostly under
    if (sink < 0.5) {
      const ph = frameOf(pose.t, 3.3, 4) / 3
      const rw = Math.max(3, R(d.ripple * (0.6 + 0.4 * ph)))
      c.save()
      c.globalAlpha *= 1 - ph * 0.7
      c.fillStyle = rippleCol
      c.fillRect(-rw, WATER, 2 * rw, 1)
      c.fillRect(-rw - 1, WATER + 1, 1, 1)
      c.fillRect(rw, WATER + 1, 1, 1)
      c.restore()
    }

    // everything below is clipped at the waterline and slides under with sink
    c.beginPath()
    c.rect(-d.artW / 2, -d.artH / 2, d.artW, d.artH / 2 + WATER)
    c.clip()
    c.translate(0, R(sink * (d.headH + d.weedLen + 6)))

    const hw = d.headW / 2
    const top = WATER - d.headH
    // body band at the surface
    c.fillStyle = pal.outline
    c.fillRect(-hw - 2, WATER - 2, d.headW + 4, 2)
    // head: outline ring, base fill, dome corners, a light crown row
    c.fillStyle = pal.outline
    c.fillRect(-hw - 1, top - 1, d.headW + 2, d.headH + 2)
    c.fillStyle = pal.base
    c.fillRect(-hw, top, d.headW, d.headH)
    c.fillStyle = pal.outline
    c.fillRect(-hw, top, 1, 1); c.fillRect(hw - 1, top, 1, 1)
    c.fillStyle = pal.light
    c.fillRect(-hw + 1, top + 1, d.headW - 2, 1)
    // eyes
    const ey = top + 2
    c.fillStyle = eye
    c.fillRect(-d.gap - d.eye, ey, d.eye, d.eye)
    c.fillRect(d.gap, ey, d.eye, d.eye)
    c.fillStyle = pal.outline
    c.fillRect(-d.gap - 1, ey + d.eye - 1, 1, 1)
    c.fillRect(d.gap + d.eye - 1, ey + d.eye - 1, 1, 1)
    // weed strands hanging from the crown, swaying by frame
    if (d.weedLen > 0) {
      c.fillStyle = weed
      for (let i = 0; i < d.weeds; i++) {
        const x = -hw + 1 + R(i * Math.max(1, d.headW - 3) / Math.max(1, d.weeds - 1))
        const wig = (i + F) % 2 ? 1 : 0
        c.fillRect(x + wig, top - 1, 1, d.weedLen + 2)
      }
    }
    c.restore()
  })
}
```

- [ ] **Step 4: Run test**

Run: `node --test test/rig-lurker.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/monster-rigs/lurker.js test/rig-lurker.test.js
git commit -m "feat(rigs): lurker rig — waterline head, weed hair, ripple, sink clip"
```

---

### Task 5: `wraith` rig (Sammunut)

**Files:**
- Create: `renderer/render/monster-rigs/wraith.js`
- Test: `test/rig-wraith.test.js`

- [ ] **Step 1: Failing test**

```js
// test/rig-wraith.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf } from '../renderer/render/monster-rigs/wraith.js'

function recordingCtx() {
  const target = { ops: [], createLinearGradient: () => ({ addColorStop: () => {} }),
                   createRadialGradient: () => ({ addColorStop: () => {} }) }
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { t.ops.push([k, ...a]) } },
    set(t, k, v) { t[k] = v; return true },
  })
}
const pose = (state, over = {}) => ({ t: 0.9, state, stateT: 0.3, facing: 0, speed01: 0, seed: 11, sink: 0, burn: 0, flicker: 0, ...over })
const extremes = which => Object.fromEntries(PARAM_SCHEMA.map(p => [p.key, p.type === 'range' ? p[which] : p.default]))
const fills = ops => ops.filter(o => o[0] === 'fillRect').length

describe('wraith rig', () => {
  it('has a valid schema and id', () => {
    assert.deepEqual(schemaErrors(PARAM_SCHEMA), [])
    assert.equal(RIG_ID, 'wraith')
  })
  for (const state of ['idle', 'walk', 'hit', 'attack', 'death']) {
    it(`draws in state ${state} at defaults, min and max, balanced`, () => {
      for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
        const ctx = recordingCtx()
        assert.doesNotThrow(() => drawMonster(ctx, params, pose(state), 32))
        assert.ok(ctx.ops.length > 10)
        assert.equal(ctx.ops.filter(o => o[0] === 'save').length, ctx.ops.filter(o => o[0] === 'restore').length)
      }
    })
  }
  it('burn shortens the body (fewer fills at burn 1 than 0)', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('idle'), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('idle', { burn: 1 }), 32)
    assert.ok(fills(b.ops) < fills(a.ops))
  })
  it('death scatters embers: the op stream differs from idle', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('idle'), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('death', { stateT: 0.4 }), 32)
    assert.notDeepEqual(a.ops, b.ops)
  })
  it('hitHalf stays within the nav-supported range', () => {
    for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
      const h = hitHalf(params)
      assert.ok(h >= 8 && h <= 28, String(h))
    }
  })
})
```

- [ ] **Step 2: Verify failure** — `node --test test/rig-wraith.test.js` → FAIL.

- [ ] **Step 3: Implement**

```js
// renderer/render/monster-rigs/wraith.js
// 16-bit pixel wraith: rounded cowl, hollow face with ember eyes, a body
// that tapers into tatters fluttering on a 4-frame loop. Upright, flips
// with facing. Channels: `flicker` jitters alpha per frame (the Sammunut
// shuddering at the edge of the light), `burn` shortens the body from the
// tatters up and spreads the ember tint. Death: tatters lift off as ember
// pixels while the cowl collapses and fades.
import { TILE_ART_PX, palette, frameOf, withPixelStage } from './pixel.js'

export const RIG_ID = 'wraith'

export const PARAM_SCHEMA = [
  { key: 'height',       label: 'Height',        group: 'body', type: 'range', min: 0.8, max: 2.5, step: 0.05, default: 1.6 },
  { key: 'width',        label: 'Width',         group: 'body', type: 'range', min: 0.5, max: 1.6, step: 0.05, default: 0.9 },
  { key: 'cowl',         label: 'Cowl',          group: 'body', type: 'range', min: 0.0, max: 1.0, step: 0.05, default: 0.6 },
  { key: 'tatterCount',  label: 'Tatters',       group: 'tatters', type: 'range', min: 2, max: 6, step: 1, default: 4 },
  { key: 'tatterLength', label: 'Tatter length', group: 'tatters', type: 'range', min: 0.2, max: 1.5, step: 0.05, default: 0.7 },
  { key: 'flutterFreq',  label: 'Flutter',       group: 'tatters', type: 'range', min: 2, max: 12, step: 0.5, default: 6 },
  { key: 'eyeSize',      label: 'Eye size',      group: 'face', type: 'range', min: 0.05, max: 0.3, step: 0.01, default: 0.12 },
  { key: 'cloakColor',   label: 'Cloak',  group: 'skin', type: 'color', default: '#3a3550' },
  { key: 'emberColor',   label: 'Ember',  group: 'skin', type: 'color', default: '#ff7a2a' },
  { key: 'eyeColor',     label: 'Eyes',   group: 'skin', type: 'color', default: '#ffb040' },
]

const R = Math.round
const WHITE = '#f8f8f8'
const clamp01 = v => Math.max(0, Math.min(1, v ?? 0))
const ceilTile = v => Math.max(TILE_ART_PX, Math.ceil(v / TILE_ART_PX) * TILE_ART_PX)

function dims(p) {
  const bodyW = 2 * Math.max(2, R(p.width * 6))
  const bodyH = Math.max(8, R(p.height * 14))
  const cowlH = Math.max(2, R(p.cowl * 6))
  const faceH = Math.max(3, R(bodyH * 0.3))
  const tatters = R(p.tatterCount)
  const tatLen = Math.max(2, R(p.tatterLength * 8))
  const eye = Math.max(1, R(p.eyeSize * 8))
  return { bodyW, bodyH, cowlH, faceH, tatters, tatLen, eye,
           artW: ceilTile(bodyW + 8),
           artH: ceilTile(bodyH + 2 * cowlH + 2 * tatLen + 12) }
}

export function hitHalf(p) {
  const d = dims(p)
  return Math.max(8, Math.min(28, R((d.bodyW + d.bodyH / 2) * 0.5)))
}

export function drawMonster(ctx, p, pose, S) {
  const d = dims(p)
  const { state, stateT, seed } = pose
  const hit = state === 'hit'
  const cloak = hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(p.cloakColor)
  const ember = hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(p.emberColor)
  const eye = hit ? WHITE : palette(p.eyeColor).light
  const burn = clamp01(pose.burn)
  const flick = clamp01(pose.flicker)
  const flip = Math.cos(pose.facing ?? 0) < 0
  const F = frameOf(pose.t, p.flutterFreq, 4)

  withPixelStage(ctx, d.artW, d.artH, 0, S, c => {
    c.save()
    if (flip) c.scale(-1, 1)
    if (flick > 0) {
      const r = (((seed ?? 0) + Math.floor(pose.t * 30)) * 7919 % 13) / 13
      c.globalAlpha *= 1 - flick * (0.25 + 0.6 * r)
    }
    const top = -d.bodyH / 2
    const bottom = d.bodyH / 2

    if (state === 'death') {
      const k = Math.min(1, stateT / 0.7)
      c.fillStyle = ember.light
      for (let i = 0; i < d.tatters + 2; i++) {
        const x = -d.bodyW / 2 + R(i * d.bodyW / (d.tatters + 1))
        const y = bottom - R(k * (d.bodyH + 12)) - (i % 3) * 2
        c.fillRect(x, y, 1, 1)
      }
      c.globalAlpha *= 1 - k
      c.translate(0, R(k * d.bodyH * 0.4))
      c.scale(1, Math.max(0.05, 1 - k * 0.8))
    }

    // body: tapering rows, the lowest rows ember-tinted as it burns
    const visH = Math.max(2, R(d.bodyH * (1 - 0.5 * burn)))
    const emberRows = R(burn * 6)
    for (let y = 0; y < visH; y++) {
      const w = 2 * Math.max(1, R((d.bodyW / 2) * (1 - 0.4 * y / d.bodyH)))
      c.fillStyle = cloak.outline
      c.fillRect(-w / 2 - 1, top + y, w + 2, 1)
      c.fillStyle = (emberRows > 0 && y >= visH - emberRows) ? ember.base : cloak.base
      c.fillRect(-w / 2, top + y, w, 1)
    }

    // tatters trailing below the visible body
    const tatLen = Math.max(1, R(d.tatLen * (1 - burn)))
    for (let i = 0; i < d.tatters; i++) {
      const x = -d.bodyW / 2 + 1 + R(i * Math.max(1, d.bodyW - 3) / Math.max(1, d.tatters - 1))
      const dy = [0, 1, 0, -1][(F + i) % 4]
      c.fillStyle = i % 2 ? cloak.base : cloak.outline
      c.fillRect(x, top + visH + dy, 2, tatLen)
    }

    // cowl: rounded rows widening downward, a light rim
    for (let r = 0; r < d.cowlH; r++) {
      const w = 2 * Math.max(1, R((d.bodyW / 2 + 1) * Math.sqrt((r + 1) / d.cowlH)))
      c.fillStyle = cloak.outline
      c.fillRect(-w / 2 - 1, top - d.cowlH + r, w + 2, 1)
      c.fillStyle = cloak.light
      c.fillRect(-w / 2, top - d.cowlH + r, w, 1)
    }

    // hollow face and ember eyes
    c.fillStyle = cloak.outline
    c.fillRect(-d.bodyW / 2 + 1, top, d.bodyW - 2, d.faceH)
    c.fillStyle = eye
    c.fillRect(-R(d.bodyW / 4) - Math.floor(d.eye / 2), top + 1, d.eye, d.eye)
    c.fillRect(R(d.bodyW / 4) - Math.floor(d.eye / 2), top + 1, d.eye, d.eye)

    c.restore()
  })
}
```

- [ ] **Step 4: Run test** — `node --test test/rig-wraith.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/monster-rigs/wraith.js test/rig-wraith.test.js
git commit -m "feat(rigs): wraith rig — cowl, tatters, flicker/burn channels, ember death"
```

---

### Task 6: `hurtCreature`, strike options, `isStoryCreature`

**Files:**
- Modify: `renderer/systems/creatures.js`, `renderer/systems/monsters.js`
- Test: `test/creatures.test.js`, `test/monsters.test.js`

**Interfaces:**
- `strikeCreature(e, state, dmg, opts = {})` → hook receives `(e, state, dmg, opts)`; result may carry `think`.
- `hurtCreature(state, e, dmg, opts = {}) → { absorbed, cue, think, killed }` — mutates `e` in place, records `state.creatureKills[e.type]` on the first kill.
- `isStoryCreature(e)` in `monsters.js`: registry def with `behavior.driver === 'hook'`.

- [ ] **Step 1: Failing tests**

Append to `test/creatures.test.js` (add `hurtCreature` to the import):

```js
describe('hurtCreature', () => {
  it('applies the hook result in place and passes opts to the hook', () => {
    let seen = null
    CREATURE_HIT.probe = (e, state, dmg, opts) => { seen = opts; return { entity: { ...e, hp: e.hp - dmg }, absorbed: false, cue: 'melee-hit' } }
    const e = { type: 'probe', hp: 5 }
    const state = { creatureKills: {} }
    const r = hurtCreature(state, e, 2, { source: 'wolf' })
    assert.equal(e.hp, 3)
    assert.deepEqual(seen, { source: 'wolf' })
    assert.deepEqual(r, { absorbed: false, cue: 'melee-hit', think: undefined, killed: false })
    delete CREATURE_HIT.probe
  })
  it('records the first kill and cues enemy-death exactly once', () => {
    const e = { type: 'maahinen', hp: 1, maxHp: 24 }
    const state = {}
    const r1 = hurtCreature(state, e, 3)
    assert.equal(r1.killed, true)
    assert.equal(r1.cue, 'enemy-death')
    assert.equal(state.creatureKills.maahinen, true)
    const r2 = hurtCreature(state, e, 3)
    assert.equal(r2.killed, false)
  })
  it('an absorbed hit never kills or records', () => {
    CREATURE_HIT.wall = e => ({ entity: e, absorbed: true, cue: 'chop', think: 'Nope.' })
    const state = {}
    const r = hurtCreature(state, { type: 'wall', hp: 0 }, 9)
    assert.deepEqual(r, { absorbed: true, cue: 'chop', think: 'Nope.', killed: false })
    assert.equal(state.creatureKills, undefined)
    delete CREATURE_HIT.wall
  })
})
```

Append to `test/monsters.test.js` (add `isStoryCreature` to the import; `load` helper already exists):

```js
describe('isStoryCreature', () => {
  beforeEach(clearMonsters)
  it('is true only for a registry def with behavior.driver === "hook"', async () => {
    await load([{ ...DEF, name: 'hooked', behavior: { driver: 'hook' } }, { ...DEF, name: 'plain' }])
    assert.equal(isStoryCreature({ type: 'hooked' }), true)
    assert.equal(isStoryCreature({ type: 'plain' }), false)
    assert.equal(isStoryCreature({ type: 'guard' }), false)
  })
})
```

- [ ] **Step 2: Verify failure** — `node --test test/creatures.test.js test/monsters.test.js` → FAIL.

- [ ] **Step 3: Implement**

`renderer/systems/creatures.js` — replace `strikeCreature` and add `hurtCreature`:

```js
// The one place player/wolf/fire damage to a creature is decided. Registered
// types resolve their own hook (which also sees `opts`, e.g. { source });
// everything else takes plain damage. Returns a fresh entity, never mutates.
export function strikeCreature(e, state, dmg, opts = {}) {
  const hook = CREATURE_HIT[e.type]
  if (hook) return hook(e, state, dmg, opts)
  return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: 'melee-hit' }
}

// Strike and apply: mutates the live entity with the hook's result and
// records the kill on state.creatureKills the first time hp reaches 0. The
// episodes read that record — never a creature's absence — as the death.
export function hurtCreature(state, e, dmg, opts = {}) {
  const r = strikeCreature(e, state, dmg, opts)
  if (r.entity !== e) Object.assign(e, r.entity)
  const dead = !r.absorbed && Number.isFinite(e.hp) && e.hp <= 0
  const killed = dead && !state.creatureKills?.[e.type]
  if (killed) state.creatureKills = { ...(state.creatureKills ?? {}), [e.type]: true }
  return { absorbed: r.absorbed, cue: killed ? 'enemy-death' : r.cue, think: r.think, killed }
}
```

`renderer/systems/monsters.js` — add after `getMonsterDef`:

```js
// A registry monster whose hook module owns its movement (behavior.driver
// 'hook'): the enemy loop skips brain/act for it, gust/slam ignore it, and
// it is updated even when it is not an enemy (the passive Näkki).
export function isStoryCreature(e) { return getMonsterDef(e.type)?.behavior?.driver === 'hook' }
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/creatures.js renderer/systems/monsters.js test/creatures.test.js test/monsters.test.js
git commit -m "feat(creatures): hurtCreature applies hits in place and records kills; isStoryCreature"
```

---

### Task 7: Migrate the three creatures to registry monsters

This is the big structural task. It moves the hook modules, adds the defs, rewires game/canvas, deletes the tile path, and updates every test that referenced the old API. Behaviour stays what it was (transitions come in Tasks 8–11).

**Files:**
- Move: `renderer/systems/nakki.js` → `renderer/systems/monsters/nakki.js`; same for `maahinen.js`, `sammunut.js`
- Create: `renderer/data/monsters/nakki.json`, `maahinen.json`, `sammunut.json`
- Modify: `renderer/data/monsters/index.json`, `renderer/systems/creatures.js`, `renderer/systems/monsters.js` (RESERVED_NAMES, `makeMonsterFromDef`), `renderer/systems/factions.js`, `renderer/game.js`, `renderer/render/canvas.js`, `renderer/render/sprites.js`, `renderer/systems/episodes/{ferry,fold,hermit}.js`, `tools/npc-placeholders.mjs`
- Delete: `renderer/assets/tiles/custom_{nakki,maahinen,sammunut}_{00,01,10,11}.png`
- Tests: `test/creatures.test.js`, `test/nakki.test.js`, `test/maahinen.test.js`, `test/sammunut.test.js`, `test/episodes-*.test.js`, `test/canvas.test.js`, `test/monsters.test.js`, `test/factions.test.js`, `test/sprites.test.js` (if it enumerates tiles)

**Interfaces:**
- Each hook module exports `ensure<Name>(e)` (lazy init, idempotent) and `make<Name>(x, y)` (test/episode helper = `ensure` on a bare entity), plus its existing update/feed/etc. exports.
- Episodes spawn with `{ kind: 'nakki' | 'maahinen' | 'sammunut', x, y }`.

- [ ] **Step 1: Move the hook modules**

```bash
git mv renderer/systems/nakki.js renderer/systems/monsters/nakki.js
git mv renderer/systems/maahinen.js renderer/systems/monsters/maahinen.js
git mv renderer/systems/sammunut.js renderer/systems/monsters/sammunut.js
```

Fix their relative imports (`'./x.js'` → `'../x.js'`, e.g. `'../player-damage.js'`, `'../sfx.js'`, `'../knockback.js'`, `'../inventory.js'`, `'../creatures.js'`, `'../entities.js'`, `'../enemy-attack.js'`, `'../brain.js'`, `'../act.js'`, `'../stamina.js'`).

- [ ] **Step 2: Lazy init in each hook**

`monsters/nakki.js` — replace `makeNakki` and drop the `CREATURE_MAKE` line:

```js
// makeMonsterFromDef gives every registry monster hp/maxHp; the Näkki has
// neither (it never dies, and no hp bar must ever show), so the first
// touch strips them and stamps the lurker state. Idempotent.
export function ensureNakki(e) {
  if (e.lurk) return e
  delete e.hp; delete e.maxHp
  Object.assign(e, { lurk: true, state: 'surfaced', timer: 0, dragCooldown: 0, pierEnd: e.pierEnd ?? null })
  return e
}
export function makeNakki(x, y) {
  return ensureNakki({ type: 'nakki', x, y, px: x * S + 16, py: y * S + 16 })
}
```
and at the top of `updateNakki`: `ensureNakki(e)`.

`monsters/maahinen.js`:

```js
export function ensureMaahinen(e) {
  if (e.burrow) return e
  Object.assign(e, {
    burrow: true, state: 'submerged', timer: 0, weaponId: 'maul',
    damageCooldown: 0, inCombat: false, facing: 'east', home: { x: e.x, y: e.y },
    hp: e.hp ?? 36, maxHp: e.maxHp ?? 36,
  })
  return e
}
export function makeMaahinen(x, y) {
  return ensureMaahinen({ type: 'maahinen', x, y, px: x * S + S / 2, py: y * S + S / 2 })
}
```
Top of `updateMaahinen`: `ensureMaahinen(e)`. Remove `aiHalf: 28` (the registry row supplies `half`). Drop `CREATURE_MAKE.maahinen`.

`monsters/sammunut.js`:

```js
export function ensureSammunut(e) {
  if (e.wisp) return e
  Object.assign(e, { wisp: true, target: null, wanderT: 0, touchT: 0, inCombat: false,
                     hp: e.hp ?? 18, maxHp: e.maxHp ?? 18 })
  return e
}
export function makeSammunut(x, y) {
  return ensureSammunut({ type: 'sammunut', x, y, px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2 })
}
```
Top of `updateSammunut`: `ensureSammunut(e)`. Drop `CREATURE_MAKE.sammunut`.

- [ ] **Step 3: Defs**

`renderer/data/monsters/nakki.json`:
```json
{
  "name": "nakki",
  "rig": "lurker",
  "params": { "headWidth": 1.2, "headHeight": 0.7, "eyeSize": 0.12, "eyeGap": 0.5,
              "weedLength": 0.6, "weedCount": 5, "sway": 0.5, "rippleSize": 1.2,
              "skinColor": "#3f5a3a", "weedColor": "#2c3f26", "eyeColor": "#d8e86a", "rippleColor": "#6f9fbf" },
  "stats": { "hp": 1, "dmg": 1, "speed": 0, "half": 12 },
  "behavior": { "taxon": "beast", "driver": "hook", "passive": true, "sightRange": 0 },
  "spawn": null,
  "hooks": true
}
```
`maahinen.json`:
```json
{
  "name": "maahinen",
  "rig": "quadruped",
  "params": { "bodyLength": 1.3, "bodyWidth": 1.4, "bulge": 0.4, "legLength": 0.35, "legThick": 0.3,
              "headSize": 0.7, "snout": 0.8, "eyeSize": 0.06, "horns": false,
              "tailLength": 0.15, "tailTaper": 0.3,
              "hideColor": "#4a3324", "bellyColor": "#7a5a40", "eyeColor": "#2a1a10", "scales": false,
              "gaitFreq": 8, "bob": 0.05 },
  "stats": { "hp": 36, "dmg": 2, "speed": 70, "half": 20 },
  "behavior": { "taxon": "beast", "driver": "hook", "sightRange": 300, "stopRange": 20 },
  "spawn": null,
  "hooks": true
}
```
`sammunut.json`:
```json
{
  "name": "sammunut",
  "rig": "wraith",
  "params": { "height": 1.6, "width": 0.9, "cowl": 0.6, "tatterCount": 4, "tatterLength": 0.7,
              "flutterFreq": 6, "eyeSize": 0.12,
              "cloakColor": "#3a3550", "emberColor": "#ff7a2a", "eyeColor": "#ffb040" },
  "stats": { "hp": 18, "dmg": 0, "speed": 80, "half": 10 },
  "behavior": { "taxon": "beast", "driver": "hook", "sightRange": 0 },
  "spawn": null,
  "hooks": true
}
```
`index.json` → `["boarhound", "podeboo", "rappeluu", "nakki", "maahinen", "sammunut"]`.

- [ ] **Step 4: Registry and creatures cleanup**

`renderer/systems/monsters.js`: remove `import { creatureAlpha, CREATURE_TYPES } from './creatures.js'` → `import { creatureAlpha } from './creatures.js'`; drop `...CREATURE_TYPES,` from `RESERVED_NAMES` (keep `'creature'` and `'echo'`).

`renderer/systems/creatures.js`: delete `CREATURE_TYPES`, `isCreature`, `CREATURE_MAKE`, `makeCreature`, `updateCreature` stays. Update the header comment: "the leap creatures are registry monsters whose hook modules (systems/monsters/*.js) register into these tables".

`renderer/systems/factions.js`: remove the `|| e.type === 'maahinen' || e.type === 'sammunut'` literals from `isEnemy` and `|| e.type === 'nakki'` from `isHittable` (registry membership covers them now).

- [ ] **Step 5: game.js wiring**

Imports: replace the creatures import with
```js
import { strikeCreature, hurtCreature, CREATURE_UPDATE, CREATURE_HIT } from './systems/creatures.js'
import { registerMonsters, getMonsterDef, makeMonsterFromDef, updateMonsterPose, isStoryCreature } from './systems/monsters.js'
```
(remove `isCreature`, `updateCreature`, `makeCreature`; keep `strikeCreature` only if still referenced — it should not be after this step, so drop it.)

Delete `recordCreatureKill`. The two player strike sites become:

```js
        if (CREATURE_HIT[e.type] && getMonsterDef(e.type)) {
          const r = hurtCreature(state, e, dmg, { source: 'player' })
          if (r.cue) sfx(state, r.cue, { px: e.px, py: e.py })
          if (r.think) think(state, r.think)
          if (!r.absorbed) addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${dmg}`, kind: 'dealt' })
          return e
        }
```
(projectile site: `p.damage` instead of `dmg`.)

`buildEntities`: delete the `case 'creature'` line.

Enemy loop: replace `if (isCreature(e)) { updateCreature(e, state, delta); continue }` with

```js
    if (isStoryCreature(e)) { CREATURE_UPDATE[e.type]?.(e, state, delta); updateMonsterPose(e, delta); continue }
```
(placed before the `isEnemy` gate — passive creatures must tick.)

Slam: `!isCreature(e)` → `!isStoryCreature(e)`.

- [ ] **Step 6: canvas.js**

- Import `isStoryCreature` from `'../systems/monsters.js'`; drop the `isCreature` import (keep `creatureAlpha` if still used by the HP-bar skip on line ~735: change that line to `if (isStoryCreature(e) && creatureAlpha(e, state) === 0) continue`).
- `ERUPT_TIME` import path → `'../systems/monsters/maahinen.js'`.
- Delete `CREATURE_SPRITES` and `drawCreature`.
- Entity loop: replace the `if (isCreature(e)) {...}` branch so registry monsters draw first:

```js
      if (getMonsterDef(e.type)) {
        drawGeneratedMonster(ctx, e, epx + S / 2, epy + S / 2, S, state)
        if (e.state === 'erupting') drawEruptRing(ctx, e, camX, camY)
      }
      else if (e.type === 'dragon_boss') drawBossBySkin(ctx, e, camX, camY, S, sprites)
      else drawEntity(ctx, e, epx, epy, S, sprites)
```
- Entity-loop margin: `getMonsterDef(e.type) ? 3 : …` already first — fine.

`renderer/render/sprites.js`: delete the twelve `custom_<creature>_XY` entries.

- [ ] **Step 7: Episodes spawn by kind**

`ferry.js` `spawnNakki`: `ctx.spawn([{ kind: 'nakki', x: spot.x, y: spot.y }])`.
`fold.js` `spawnMaahinen`: `ctx.spawn([{ kind: 'maahinen', x: spot.x, y: spot.y }])`.
`hermit.js` `spawnWraith`: `ctx.spawn([{ kind: 'sammunut', x: spot.x, y: spot.y }])`.

- [ ] **Step 8: Delete the tiles and the placeholder generator block**

```bash
git rm renderer/assets/tiles/custom_nakki_0{0,1}.png renderer/assets/tiles/custom_nakki_1{0,1}.png \
       renderer/assets/tiles/custom_maahinen_0{0,1}.png renderer/assets/tiles/custom_maahinen_1{0,1}.png \
       renderer/assets/tiles/custom_sammunut_0{0,1}.png renderer/assets/tiles/custom_sammunut_1{0,1}.png
```
In `tools/npc-placeholders.mjs` delete `NAKKI_32`, `MAAHINEN_32`, `SAMMUNUT_32`, their `_PAL`s, `CREATURES`, `CREATURE_TILES`, the `quad` helper, and `...CREATURE_TILES` from the output list.

- [ ] **Step 9: Update tests**

- `test/creatures.test.js`: drop `isCreature`/`updateCreature` assertions (keep `updateCreature` no-op test if the function stays).
- `test/nakki.test.js`, `test/maahinen.test.js`, `test/sammunut.test.js`: import paths → `../renderer/systems/monsters/<name>.js`. `makeNakki` etc. still exist.
- `test/episodes-ferry.test.js`, `test/episodes-fold.test.js`, `test/episodes-hermit.test.js`: replace `makeCreature('x', …)` with `makeNakki/makeMaahinen/makeSammunut` from the hook modules; the `ctx.spawn` stubs must accept `{ kind: 'nakki' }` etc. (search each test's spawn stub for `s.creature` and switch to `s.kind`). Update `import '../renderer/systems/maahinen.js'` side-effect imports to the new path.
- `test/monsters.test.js`: drop the `CREATURE_TYPES` import and any reserved-name assertion for `nakki`; add:
  ```js
  it('the three story creature defs on disk load against their rigs', async () => {
    const fs = await import('node:fs')
    const defs = ['nakki', 'maahinen', 'sammunut'].map(n => JSON.parse(fs.readFileSync(`renderer/data/monsters/${n}.json`, 'utf8')))
    const rigs = { quadruped: await import('../renderer/render/monster-rigs/quadruped.js'),
                   lurker: await import('../renderer/render/monster-rigs/lurker.js'),
                   wraith: await import('../renderer/render/monster-rigs/wraith.js') }
    assert.equal(await registerMonsters(defs, { loadRig: async id => rigs[id], loadHooks: async () => {}, warn: m => { throw new Error(m) } }), 3)
    assert.equal(getMonsterDef('nakki').behavior.passive, true)
    assert.equal(isStoryCreature({ type: 'maahinen' }), true)
  })
  ```
- `test/factions.test.js`: the nakki/no-hp test stays valid (an unregistered `nakki` is simply not hittable, so not dead); add `isEnemy({type:'x'})`-style passive check via `registerMonsters` if desired.
- `test/canvas.test.js`: delete the `drawCreature` describe and its import.
- `test/sprites.test.js`: if it enumerates SPRITES against files, nothing else to do (entries and files were removed together).

- [ ] **Step 10: Run the full suite**

Run: `node --test test/`
Expected: PASS. Then boot the game once (`npm start`), type `level8` on the title, and confirm the console shows no `monsters:` warnings and the Näkki draws after ringing the bell.

- [ ] **Step 11: Commit**

```bash
git add -A renderer test tools/npc-placeholders.mjs
git commit -m "refactor(creatures): leap creatures become registry monsters on lurker/quadruped/wraith rigs"
```

---

### Task 8: Näkki sink / rise / leaving

**Files:**
- Modify: `renderer/systems/monsters/nakki.js`, `renderer/systems/episodes/ferry.js`, `renderer/systems/sfx.js`, `renderer/render/audio.js`
- Test: `test/nakki.test.js`, `test/episodes-ferry.test.js`

**Interfaces:**
- States: `surfaced → sinking (SINK_TIME 0.6) → submerged (SUBMERGE_TIME 4) → rising (0.6) → surfaced`. `e.sink` 0..1. `e.leaving = true` → removal at the end of `sinking`.
- Cue `sink` added.

- [ ] **Step 1: Failing tests** (replace the sink-related tests in `test/nakki.test.js`)

```js
describe('nakki sink cycle', () => {
  it('a hit starts sinking with the sink channel rising, then submerges, rises and surfaces', () => {
    const n = makeNakki(3, 4)
    const state = makeState(n, makePlayer())
    const r = strikeCreature(n, state, 5)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, 'sink')
    assert.equal(r.entity.state, 'sinking')
    Object.assign(n, r.entity)
    updateNakki(n, state, SINK_TIME / 2)
    assert.ok(Math.abs(n.sink - 0.5) < 1e-6)
    updateNakki(n, state, SINK_TIME / 2 + 0.001)
    assert.equal(n.state, 'submerged')
    assert.equal(CREATURE_ALPHA.nakki(n, state), 0)
    updateNakki(n, state, SUBMERGE_TIME + 0.001)
    assert.equal(n.state, 'rising')
    updateNakki(n, state, SINK_TIME / 2)
    assert.ok(n.sink > 0 && n.sink < 1)
    updateNakki(n, state, SINK_TIME / 2 + 0.001)
    assert.equal(n.state, 'surfaced')
    assert.equal(n.sink, 0)
  })
  it('a leaving nakki removes itself from state.entities when the sink completes', () => {
    const n = makeNakki(3, 4)
    const state = makeState(n, makePlayer())
    sinkNakki(n); n.leaving = true
    updateNakki(n, state, SINK_TIME + 0.001)
    assert.equal(state.entities.includes(n), false)
  })
  it('feeding only works surfaced and starts a sink', () => {
    const n = makeNakki(3, 4)
    const p = makePlayer({ inventory: [makeItem('cooked_meat', 1)] })
    assert.equal(feedNakki(n, p), true)
    assert.equal(n.state, 'sinking')
    assert.equal(feedNakki(n, p), false)
  })
})
```
Import `SINK_TIME`, `CREATURE_ALPHA` (from `../renderer/systems/creatures.js`) and `makeItem` (from `../renderer/systems/inventory.js`) at the top.

In `test/episodes-ferry.test.js`, where the third feed is asserted to remove the Näkki, assert instead that the entity has `leaving === true` and `state === 'sinking'`, and that after `updateNakki(n, state, SINK_TIME + 0.001)` it is gone from `state.entities`.

- [ ] **Step 2: Verify failure** — `node --test test/nakki.test.js test/episodes-ferry.test.js` → FAIL.

- [ ] **Step 3: Implement**

`monsters/nakki.js`:

```js
import { stepFade } from '../fade.js'
export const SINK_TIME = 0.6

export function sinkNakki(e) {
  if (e.state === 'sinking' || e.state === 'submerged') return
  e.state = 'sinking'
  e.timer = SINK_TIME
}

export function updateNakki(e, state, delta) {
  ensureNakki(e)
  const { player } = state
  if (e.pose) e.pose.facing = player.px < e.px ? Math.PI : 0

  if (e.state === 'sinking') {
    e.timer = Math.max(0, e.timer - delta)
    e.sink = 1 - e.timer / SINK_TIME
    if (e.timer <= 0) {
      if (e.leaving) { state.entities = state.entities.filter(x => x !== e); return }
      e.state = 'submerged'; e.timer = SUBMERGE_TIME
    }
  } else if (e.state === 'submerged') {
    e.timer = Math.max(0, e.timer - delta)
    if (e.timer <= 0) { e.state = 'rising'; e.timer = SINK_TIME }
  } else if (e.state === 'rising') {
    e.timer = Math.max(0, e.timer - delta)
    e.sink = e.timer / SINK_TIME
    if (e.timer <= 0) { e.state = 'surfaced'; e.sink = 0 }
  }
  stepFade(e, e.state === 'submerged' ? 0 : 1, delta, { inTime: 0.1, outTime: 0.1 })
  if (e.state !== 'surfaced') return

  if (!e.pierEnd || player.x !== e.pierEnd.x || player.y !== e.pierEnd.y) return
  e.dragCooldown -= delta
  if (e.dragCooldown <= 0) {
    if (damagePlayer(state, 1, 'hit', 'The lake pulls at you!')) {
      sfx(state, 'drag', { px: player.px, py: player.py })
      startKnockback(player, player.px - e.px, player.py - e.py, DRAG_DISTANCE)
    }
    e.dragCooldown = DRAG_INTERVAL
  }
}

CREATURE_HIT.nakki = (e) => { const entity = { ...e }; sinkNakki(entity); return { entity, absorbed: true, cue: 'sink' } }
CREATURE_ALPHA.nakki = e => e.fadeA ?? 1
```
`ensureNakki` also stamps `sink: 0, fadeA: 1`.

`ferry.js` `removeNakki`:
```js
function removeNakki(ctx) {
  const n = ctx.state.entities.find(e => e.type === 'nakki')
  if (!n) return
  n.leaving = true
  sinkNakki(n)
}
```
(import `sinkNakki` from `'../monsters/nakki.js'`; `feedNakki` import path likewise.)

`sfx.js`: add `'sink'` to the leap cue list. `audio.js`: `'sink': { kind: 'swoosh', f0: 500, f1: 120, dur: 0.45, vol: 0.5 },`.

- [ ] **Step 4: Run** — `node --test test/nakki.test.js test/episodes-ferry.test.js test/sfx.test.js test/audio.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/monsters/nakki.js renderer/systems/episodes/ferry.js renderer/systems/sfx.js renderer/render/audio.js test/nakki.test.js test/episodes-ferry.test.js
git commit -m "feat(nakki): sink/rise cycle on the sink channel; leaving removes after the sink"
```

---

### Task 9: Maahinen — sink channel, fade, hit sources, leash 24

**Files:**
- Modify: `renderer/systems/monsters/maahinen.js`
- Test: `test/maahinen.test.js`

**Interfaces:**
- `LEASH_TILES = 24`. `CREATURE_HIT.maahinen(e, state, dmg, { source })`: `'player'` → damage + immediate submerge (`think: 'It just dives.'`); `'wolf'` → damage only. `e.sink`/`e.fadeA` driven per state.

- [ ] **Step 1: Failing tests** (append to `test/maahinen.test.js`; import `CREATURE_HIT`, `CREATURE_ALPHA` from creatures.js, `LEASH_TILES`, `SUBMERGE_TIME`, `ERUPT_TIME` from the hook)

```js
describe('maahinen hit sources', () => {
  it('a player hit wounds it and forces an immediate dive', () => {
    const m = { ...makeMaahinen(5, 5), state: 'surfaced' }
    const r = CREATURE_HIT.maahinen(m, {}, 3, { source: 'player' })
    assert.equal(r.absorbed, false)
    assert.equal(r.entity.hp, 33)
    assert.equal(r.entity.state, 'submerging')
    assert.equal(r.think, 'It just dives.')
  })
  it('a wolf bite wounds it without a dive', () => {
    const m = { ...makeMaahinen(5, 5), state: 'surfaced' }
    const r = CREATURE_HIT.maahinen(m, {}, 2, { source: 'wolf' })
    assert.equal(r.entity.hp, 34)
    assert.equal(r.entity.state, 'surfaced')
  })
  it('a killing player blow does not dive (it dies on the surface)', () => {
    const m = { ...makeMaahinen(5, 5), state: 'surfaced', hp: 2 }
    const r = CREATURE_HIT.maahinen(m, {}, 3, { source: 'player' })
    assert.equal(r.entity.state, 'surfaced')
    assert.ok(r.entity.hp <= 0)
  })
  it('leash is 24 tiles', () => assert.equal(LEASH_TILES, 24))
})

describe('maahinen sink channel', () => {
  it('submerging drives sink 0 → 1 then fades out; erupting rises over its last 0.3 s', () => {
    const m = { ...makeMaahinen(5, 5), state: 'submerging', timer: SUBMERGE_TIME, sink: 0, fadeA: 1 }
    const state = { player: { x: 5, y: 12, px: 5 * 32 + 16, py: 12 * 32 + 16 }, map: openMap(), entities: [], sfx: makeSfx() }
    updateMaahinen(m, state, SUBMERGE_TIME / 2)
    assert.ok(Math.abs(m.sink - 0.5) < 1e-6)
    updateMaahinen(m, state, SUBMERGE_TIME)
    assert.equal(m.state, 'submerged')
    assert.equal(m.sink, 1)
    updateMaahinen(m, state, 1)
    assert.equal(CREATURE_ALPHA.maahinen(m, state), 0)
    Object.assign(m, { state: 'erupting', timer: ERUPT_TIME })
    updateMaahinen(m, state, ERUPT_TIME - 0.15)
    assert.ok(Math.abs(m.sink - 0.5) < 0.05)
    updateMaahinen(m, state, 0.2)
    assert.equal(m.state, 'surfaced')
    assert.equal(m.sink, 0)
    assert.ok(CREATURE_ALPHA.maahinen(m, state) > 0.9)
  })
})
```
`openMap()` is whatever helper the file already uses to make an all-floor map (reuse it; if none exists, build one with `createMap` from `map.js` and `TILE.FLOOR` like `test/episodes-fold.test.js` does).

- [ ] **Step 2: Verify failure** → FAIL.

- [ ] **Step 3: Implement**

In `monsters/maahinen.js`:

```js
import { stepFade } from '../fade.js'
export const LEASH_TILES = 24
const RISE_TIME = 0.3

function eruptingTick(e, delta) {
  e.timer = Math.max(0, e.timer - delta)
  e.sink = Math.min(1, e.timer / RISE_TIME)
  if (e.timer <= 0) { e.state = 'surfaced'; e.sink = 0 }
}

function submergingTick(e, state, delta) {
  const { player, map } = state
  e.timer = Math.max(0, e.timer - delta)
  e.sink = 1 - e.timer / SUBMERGE_TIME
  if (e.timer <= 0) {
    const tile = ringSearch(map, player.x, player.y, 4, 6)
    if (tile) { e.x = tile.x; e.y = tile.y; e.px = tile.x * S + S / 2; e.py = tile.y * S + S / 2 }
    e.state = 'submerged'
    e.sink = 1
    e.timer = RESURFACE_DELAY
  }
}

export function updateMaahinen(e, state, delta) {
  ensureMaahinen(e)
  if (e.state === 'submerged') submergedTick(e, state, delta)
  else if (e.state === 'erupting') eruptingTick(e, delta)
  else if (e.state === 'surfaced') surfacedTick(e, state, delta)
  else if (e.state === 'submerging') submergingTick(e, state, delta)
  stepFade(e, e.state === 'submerged' ? 0 : 1, delta, { inTime: 0.1, outTime: 0.25 })
}

const dive = e => { e.state = 'submerging'; e.timer = SUBMERGE_TIME; e.attack = null }

CREATURE_HIT.maahinen = (e, state, dmg, { source = 'player' } = {}) => {
  if (e.state === 'submerged' || e.state === 'submerging') return { entity: { ...e }, absorbed: true, cue: null }
  const entity = { ...e, hp: e.hp - dmg, inCombat: true }
  if (source === 'player' && entity.hp > 0) { dive(entity); return { entity, absorbed: false, cue: 'melee-hit', think: 'It just dives.' } }
  return { entity, absorbed: false, cue: 'melee-hit' }
}
CREATURE_ALPHA.maahinen = e => e.fadeA ?? 1
```
`surfacedTick`'s two threshold dives use `dive(e)` and keep setting `e.dived` / `e.dived2`. `submergedTick` sets `e.sink = 1` when it erupts is not needed (erupting sets it from the timer). `ensureMaahinen` stamps `sink: 1, fadeA: 0`.

- [ ] **Step 4: Run** — `node --test test/maahinen.test.js test/episodes-fold.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/monsters/maahinen.js test/maahinen.test.js
git commit -m "feat(maahinen): sink channel + fade, player hits force a dive, leash 24"
```

---

### Task 10: Deadwood item and grey campfires

**Files:**
- Modify: `renderer/systems/inventory.js`, `renderer/render/icons.js`, `renderer/render/sprites.js`, `renderer/systems/lumber.js`, `renderer/systems/campfire.js`, `renderer/ui/inventory-panel.js`, `renderer/game.js` (harvest drop, `buildCampfire`), `renderer/render/canvas.js` (grey flame), `renderer/systems/sfx.js`, `renderer/render/audio.js`, `tools/npc-placeholders.mjs`
- Create: `renderer/assets/tiles/item_deadwood.png` (generated)
- Test: `test/campfire.test.js`, `test/lumber.test.js`, `test/inventory.test.js`, `test/canvas.test.js`

**Interfaces:**
- Item kind `deadwood` ("Grey Wood").
- `HARVEST[key].drop` (`'lumber'` default, `'deadwood'` for `ow_deadtree_*`); `harvest()` returns `drop`.
- `canBuildCampfire(player, fuel = 'lumber')`, `spendLumber(player, fuel = 'lumber')`, `makeCampfire(x, y, { eternal, fuel })` → `fire.fuel === 'deadwood'` on grey fires; `isDeadwoodFire(e)`.
- Cue `grey-fire`.

- [ ] **Step 1: Failing tests**

Append to `test/campfire.test.js`:
```js
describe('deadwood fuel', () => {
  it('builds from three deadwood and stamps fuel on the fire', () => {
    const p = { inventory: [makeItem('deadwood', 3)], maxInventory: 10 }
    assert.equal(canBuildCampfire(p, 'deadwood').ok, true)
    assert.equal(canBuildCampfire(p, 'lumber').ok, false)
    spendLumber(p, 'deadwood')
    assert.equal(p.inventory.length, 0)
    const f = makeCampfire(2, 3, { fuel: 'deadwood' })
    assert.equal(f.fuel, 'deadwood')
    assert.equal(isDeadwoodFire(f), true)
    assert.equal('fuel' in makeCampfire(2, 3), false)
    assert.equal(isDeadwoodFire(makeCampfire(2, 3)), false)
  })
})
```
Append to `test/lumber.test.js`:
```js
it('dead trees drop deadwood, other trees lumber', () => {
  assert.equal(HARVEST.ow_deadtree_0.drop, 'deadwood')
  assert.equal(HARVEST.ow_tree_small.drop ?? 'lumber', 'lumber')
  const map = createMap(5, 5)
  for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) map[y][x].tile = TILE.FLOOR
  map[2][2].overlay = 'ow_deadtree_1'
  const r = harvest(map, 2, 2, { chop: 2 })
  assert.equal(r.felled, true)
  assert.equal(r.drop, 'deadwood')
})
```
(Use the file's existing imports for `createMap`/`TILE`; add them if missing.)
Append to `test/inventory.test.js`: `it('deadwood is a stackable kind', () => assert.equal(makeItem('deadwood', 2).count, 2))`.
Append to `test/canvas.test.js`:
```js
describe('drawEntity — grey campfire', () => {
  it('applies a filter for deadwood fires and restores it', () => {
    const ctx = recordingCtx(); ctx.filter = 'none'
    drawEntity(ctx, { type: 'campfire', t: 0, fuel: 'deadwood' }, 0, 0, 32, { prop_campfire: 'F' })
    assert.ok(ctx.ops.some(o => o[0] === 'drawImage'))
    assert.equal(ctx.filter, 'none')
  })
})
```
(`recordingCtx` — reuse the file's own stub helper name.)

- [ ] **Step 2: Verify failure** → FAIL.

- [ ] **Step 3: Implement**

`inventory.js` STACKABLE_KINDS: `deadwood: { name: 'Grey Wood', emoji: '🪵', extra: {} },  // dead-tree wood (systems/lumber.js); the hermit's fuel`.
`icons.js` KIND_ICONS: `deadwood: 'item_deadwood'`.
`sprites.js`: `item_deadwood: 'item_deadwood',  // placeholders drawn by tools/npc-placeholders.mjs`.
`lumber.js`: `ow_deadtree_0: { hp: 2, yield: 1, cells: 1, drop: 'deadwood' }` (and `_1`); `harvest()` returns `{ felled: true, yield: def.yield, kind, drop: def.drop ?? 'lumber' }` (and `drop: null` on the early returns).
`campfire.js`:
```js
export const FUELS = ['lumber', 'deadwood']
const fuelCount = (player, fuel) => player.inventory.filter(i => i.kind === fuel).reduce((n, i) => n + (i.count ?? 1), 0)
export function canBuildCampfire(player, fuel = 'lumber') {
  return fuelCount(player, fuel) >= CAMPFIRE_COST ? { ok: true } : { ok: false, reason: 'lumber' }
}
export function spendLumber(player, fuel = 'lumber') { /* same loop with i.kind !== fuel */ }
export function makeCampfire(x, y, { eternal = false, fuel = 'lumber' } = {}) {
  const fire = { type: 'campfire', x, y, px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2, t: 0 }
  if (eternal) fire.eternal = true
  if (fuel === 'deadwood') fire.fuel = 'deadwood'   // grey fire: the wraith cannot snuff it and burns in its light
  return fire
}
export const isDeadwoodFire = e => e?.type === 'campfire' && e.fuel === 'deadwood'
```
`inventory-panel.js` `primaryAction`: `if (item.kind === 'lumber' || item.kind === 'deadwood') return { label: 'Build fire', fn: 'onBuild' }`.
`game.js`: `onBuild: slot => buildCampfire(state.player.inventory[slot]?.kind ?? 'lumber')`, and
```js
function buildCampfire(fuel = 'lumber') {
  const gate = canBuildCampfire(state.player, fuel)
  if (!gate.ok) { think(state, 'Not enough wood.'); return }
  const spot = buildSpot(state.map, state.entities, state.player)
  if (!spot) { think(state, 'No room for a fire here.'); return }
  spendLumber(state.player, fuel)
  const fire = makeCampfire(spot.x, spot.y, { fuel })
  state.entities.push(fire)
  sfx(state, fuel === 'deadwood' ? 'grey-fire' : 'campfire-light', { px: fire.px, py: fire.py })
  if (inventoryOpen) closeInventory()
  afterInventoryChange()
}
```
Harvest drop: `contents: { type: res.drop ?? 'lumber', count: res.yield }`.
`canvas.js` campfire branch:
```js
  if (entity.type === 'campfire') {
    const s = sprites.prop_campfire
    if (!s) return
    const prev = ctx.globalAlpha, prevF = ctx.filter
    ctx.globalAlpha = prev * campfireAlpha(entity)
    if (entity.fuel === 'deadwood') ctx.filter = 'hue-rotate(185deg) saturate(0.45) brightness(1.25)'
    ctx.drawImage(s, px, py, S, S)
    ctx.filter = prevF; ctx.globalAlpha = prev
    return
  }
```
`sfx.js`: add `'grey-fire'` to the lumber & campfire cue list. `audio.js`: `'grey-fire': { kind: 'swoosh', f0: 200, f1: 900, dur: 0.45, vol: 0.5 },`.
`tools/npc-placeholders.mjs`: hoist the lumber rows into `const LUMBER_ROWS = [...]`, `const LUMBER = paint(LUMBER_ROWS, {...})`, and add
```js
// Grey wood — the same log, ash-grey: the hermit's dead-tree fuel.
const DEADWOOD = paint(LUMBER_ROWS, { b: [112, 112, 106, 255], c: [176, 176, 168, 255], r: [140, 140, 134, 255] })
```
plus `['item_deadwood', DEADWOOD]` in the output list. Run `node tools/npc-placeholders.mjs` (writes only the missing file) and commit the PNG.

- [ ] **Step 4: Run** — `node --test test/` → PASS (sprites test must see the new PNG).

- [ ] **Step 5: Commit**

```bash
git add -A renderer tools/npc-placeholders.mjs test
git commit -m "feat(campfire): deadwood item from dead trees; grey fires built from it"
```

---

### Task 11: Sammunut — fade/flicker, deadwood-fire burn, flee and shun, hit rule

**Files:**
- Modify: `renderer/systems/monsters/sammunut.js`, `renderer/systems/sfx.js`, `renderer/render/audio.js`
- Test: `test/sammunut.test.js`

**Interfaces:**
- Exports: `BURN_DPS = 4`, `BURN_STAGES = [12, 6]`, `FLEE_SPEED = 160`, `FLEE_TIME = 3`, `HOVER = 24`, `inDeadwoodLight(entities, px, py)`, `startFlee(e, fromPx, fromPy)`.
- `e.shun` (bool), `e.burnStage` (0..2), `e.state` `'drift' | 'fleeing'`, `e.burn`, `e.flicker`, `e.fadeA`.
- Cue `wraith-burn`.

- [ ] **Step 1: Failing tests** (append to `test/sammunut.test.js`; the file's helpers `makePlayer`/`makeState` exist — extend `makeState` to accept extra entities. Import `makeCampfire` from campfire.js, `CREATURE_HIT`, `CREATURE_ALPHA`, `hurtCreature` from creatures.js.)

```js
const fireAt = (x, y, fuel) => makeCampfire(x, y, { fuel })

describe('sammunut and deadwood fire', () => {
  it('drifts to an ordinary fire and snuffs it, clearing shun', () => {
    const w = { ...makeSammunut(10, 10), shun: true }
    const fire = fireAt(10, 11)
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [fire])
    for (let i = 0; i < 60; i++) updateSammunut(w, state, 0.05)
    assert.equal(state.entities.includes(fire), false)
    assert.equal(w.shun, false)
  })
  it('cannot snuff a deadwood fire; hovers at it and burns, driving the burn channel', () => {
    const w = makeSammunut(10, 10)
    const fire = fireAt(10, 11, 'deadwood')
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [fire])
    updateSammunut(w, state, 0.5)
    assert.equal(state.entities.includes(fire), true)
    assert.ok(w.hp < 18)
    assert.ok(Math.abs(w.hp - (18 - BURN_DPS * 0.5)) < 1e-6)
    assert.ok(Math.abs(w.burn - (1 - w.hp / 18)) < 1e-6)
  })
  it('crossing a third makes it flee and shun deadwood fires', () => {
    const w = { ...makeSammunut(10, 10), hp: 12.1 }
    const fire = fireAt(10, 11, 'deadwood')
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [fire])
    updateSammunut(w, state, 0.1)
    assert.equal(w.state, 'fleeing')
    assert.equal(w.shun, true)
    assert.equal(w.burnStage, 1)
    const before = Math.hypot(w.px - fire.px, w.py - fire.py)
    updateSammunut(w, state, 0.5)
    assert.ok(Math.hypot(w.px - fire.px, w.py - fire.py) > before)
    for (let i = 0; i < 80; i++) updateSammunut(w, state, 0.05)
    assert.equal(w.state, 'drift')
    assert.equal(w.shun, true)          // still shunning: no ordinary fire snuffed yet
  })
  it('a shunning wraith ignores deadwood fires but not ordinary ones', () => {
    const w = { ...makeSammunut(10, 10), shun: true }
    const grey = fireAt(10, 11, 'deadwood'), plain = fireAt(20, 10)
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [grey, plain])
    updateSammunut(w, state, 0.1)
    assert.equal(w.target, plain)
  })
  it('burning to 0 records the kill through hurtCreature', () => {
    const w = { ...makeSammunut(10, 10), hp: 0.1, burnStage: 2 }
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [fireAt(10, 11, 'deadwood')])
    updateSammunut(w, state, 0.1)
    assert.equal(state.creatureKills.sammunut, true)
  })
})

describe('sammunut player hits', () => {
  it('outside deadwood light hits are absorbed with a dull cue and a thought', () => {
    const w = makeSammunut(10, 10)
    const state = makeState(w, makePlayer(), [fireAt(10, 11)])   // ordinary fire: visible, not vulnerable
    const r = CREATURE_HIT.sammunut(w, state, 5)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, 'chop')
    assert.equal(r.think, 'Your blade passes through it.')
  })
  it('inside deadwood light a hit is a flat 1 and makes it flee and shun', () => {
    const w = makeSammunut(10, 10)
    const state = makeState(w, makePlayer(), [fireAt(10, 11, 'deadwood')])
    const r = CREATURE_HIT.sammunut(w, state, 5, { source: 'player' })
    assert.equal(r.absorbed, false)
    assert.equal(r.entity.hp, 17)
    assert.equal(r.entity.state, 'fleeing')
    assert.equal(r.entity.shun, true)
  })
  it('fire damage is plain damage', () => {
    const r = CREATURE_HIT.sammunut(makeSammunut(1, 1), { entities: [] }, 0.4, { source: 'fire' })
    assert.ok(Math.abs(r.entity.hp - 17.6) < 1e-9)
    assert.equal(r.absorbed, false)
  })
})

describe('sammunut visibility fade', () => {
  it('fades in inside firelight and out beyond it instead of snapping', () => {
    const w = makeSammunut(10, 10)
    const fire = fireAt(10, 11)
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [fire])
    updateSammunut(w, state, 0.1)
    const a1 = CREATURE_ALPHA.sammunut(w, state)
    assert.ok(a1 > 0 && a1 < 0.85, String(a1))
    state.entities = state.entities.filter(e => e !== fire)
    w.fadeA = 1
    updateSammunut(w, state, 0.1)
    const a2 = CREATURE_ALPHA.sammunut(w, state)
    assert.ok(a2 > 0 && a2 < 0.85, String(a2))
    assert.ok(w.flicker > 0)
  })
})
```
Existing tests that assert `CREATURE_ALPHA.sammunut === 0.85 / 0` immediately should be changed to run one long update (`updateSammunut(w, state, 2)`) first, or to assert `fadeA` targets.

- [ ] **Step 2: Verify failure** → FAIL.

- [ ] **Step 3: Implement** — rewrite `monsters/sammunut.js`'s update and hit:

```js
import { stepFade } from '../fade.js'
import { hurtCreature } from '../creatures.js'
import { isDeadwoodFire } from '../campfire.js'

export const BURN_DPS = 4
export const BURN_STAGES = [12, 6]   // hp thresholds: crossing one → flee + shun
export const FLEE_SPEED = 160
export const FLEE_TIME = 3
export const HOVER = 24              // px it holds off a fire it cannot snuff

export function ensureSammunut(e) {
  if (e.wisp) return e
  Object.assign(e, { wisp: true, target: null, wanderT: 0, touchT: 0, inCombat: false,
                     hp: e.hp ?? 18, maxHp: e.maxHp ?? 18,
                     state: 'drift', shun: false, burnStage: 0, fleeT: 0, burn: 0, flicker: 0 })
  return e
}

// Fires this wraith will go to: every ordinary fire, deadwood ones only
// while it is not shunning them.
export function nearestFire(entities, e) {
  let best = null, bestDist = Infinity
  for (const f of entities) {
    if (f.type !== 'campfire') continue
    if (isDeadwoodFire(f) && e.shun) continue
    const d = Math.hypot(f.px - e.px, f.py - e.py)
    if (d < bestDist) { bestDist = d; best = f }
  }
  return best
}

export function inFirelight(entities, px, py) {
  return entities.some(f => f.type === 'campfire' && Math.hypot(f.px - px, f.py - py) <= FIRELIGHT)
}
export function inDeadwoodLight(entities, px, py) {
  return entities.some(f => isDeadwoodFire(f) && Math.hypot(f.px - px, f.py - py) <= FIRELIGHT)
}
const nearestDeadwoodInLight = (entities, e) =>
  entities.filter(f => isDeadwoodFire(f) && Math.hypot(f.px - e.px, f.py - e.py) <= FIRELIGHT)
          .sort((a, b) => Math.hypot(a.px - e.px, a.py - e.py) - Math.hypot(b.px - e.px, b.py - e.py))[0] ?? null

export function startFlee(e, fromPx, fromPy) {
  const dx = e.px - fromPx, dy = e.py - fromPy
  const d = Math.hypot(dx, dy)
  e.fleeDir = d > 1e-6 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 }
  e.state = 'fleeing'
  e.fleeT = FLEE_TIME
  e.shun = true
  e.wanderPoint = null
}

function fleeTick(e, delta, map) {
  const w = map[0].length, h = map.length
  e.px = clamp(e.px + e.fleeDir.x * FLEE_SPEED * delta, TILE_SIZE, (w - 1) * TILE_SIZE)
  e.py = clamp(e.py + e.fleeDir.y * FLEE_SPEED * delta, TILE_SIZE, (h - 1) * TILE_SIZE)
  e.fleeT -= delta
  if (e.fleeT <= 0) e.state = 'drift'
}

function burnTick(e, state, delta) {
  const fire = nearestDeadwoodInLight(state.entities, e)
  if (!fire) return
  hurtCreature(state, e, BURN_DPS * delta, { source: 'fire' })
  e.burn = Math.max(0, 1 - e.hp / e.maxHp)
  if (e.pose) e.pose.hpSeen = e.hp          // a slow burn is not a hit flash
  e.burnCue = (e.burnCue ?? 0) - delta
  if (e.burnCue <= 0) { sfx(state, 'wraith-burn', { px: e.px, py: e.py }); e.burnCue = 0.6 }
  if (e.burnStage < BURN_STAGES.length && e.hp <= BURN_STAGES[e.burnStage]) {
    e.burnStage++
    startFlee(e, fire.px, fire.py)
  }
}

export function updateSammunut(e, state, delta) {
  ensureSammunut(e)
  const { entities, map, player } = state
  const prevPx = e.px, prevPy = e.py

  if (e.state === 'fleeing') {
    e.target = null
    fleeTick(e, delta, map)
  } else {
    const target = nearestFire(entities, e)
    e.target = target
    if (target) {
      e.wanderPoint = null
      const dist = Math.hypot(target.px - e.px, target.py - e.py)
      if (isDeadwoodFire(target)) {
        if (dist > HOVER) driftToward(e, target.px, target.py, delta, map)
      } else {
        driftToward(e, target.px, target.py, delta, map)
        if (dist < 16) {
          state.entities = entities.filter(f => f !== target)
          e.shun = false
          sfx(state, 'campfire-out', { px: target.px, py: target.py })
        }
      }
    } else {
      e.wanderT = (e.wanderT ?? 0) - delta
      if (!e.wanderPoint || e.wanderT <= 0) { e.wanderPoint = pickWanderPoint(map, e.rng ?? Math.random); e.wanderT = WANDER_REPICK }
      driftToward(e, e.wanderPoint.px, e.wanderPoint.py, delta, map)
    }
    burnTick(e, state, delta)
  }

  e.x = Math.floor(e.px / TILE_SIZE)
  e.y = Math.floor(e.py / TILE_SIZE)

  e.touchCue = Math.max(0, (e.touchCue ?? 0) - delta)
  if (Math.hypot(player.px - e.px, player.py - e.py) <= TOUCH) {
    spendStamina(player, DRAIN_PER_S * delta)
    e.touchT = TOUCH_TIME
    if (e.touchCue <= 0) { sfx(state, 'wraith-touch', { px: e.px, py: e.py }); e.touchCue = TOUCH_TIME }
  }
  e.touchT = Math.max(0, (e.touchT ?? 0) - delta)

  const visible = sammunutVisible(e, state)
  stepFade(e, visible ? 1 : 0, delta)
  const moving = Math.hypot(e.px - prevPx, e.py - prevPy) > 0.01
  e.flicker = moving ? 1 - e.fadeA : 0
  if (!visible) e.inCombat = false
}

CREATURE_HIT.sammunut = (e, state, dmg, { source = 'player' } = {}) => {
  if (source === 'fire') return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: null }
  const fire = nearestDeadwoodInLight(state.entities ?? [], e)
  if (!fire) return { entity: e, absorbed: true, cue: 'chop', think: 'Your blade passes through it.' }
  const entity = { ...e, hp: e.hp - 1, inCombat: true, touchT: TOUCH_TIME }
  startFlee(entity, fire.px, fire.py)
  return { entity, absorbed: false, cue: 'melee-hit' }
}
CREATURE_ALPHA.sammunut = e => (e.fadeA ?? 0) * 0.85
```
`sfx.js`: add `'wraith-burn'`. `audio.js`: `'wraith-burn': { kind: 'burst', freq: 1800, q: 0.7, dur: 0.30, vol: 0.35 },`.

Note `sammunutVisible` (unchanged) still reads `inFirelight` for any fire, so it is visible at ordinary fires and vulnerable only at deadwood ones.

- [ ] **Step 4: Run** — `node --test test/sammunut.test.js test/episodes-hermit.test.js test/sfx.test.js test/audio.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/monsters/sammunut.js renderer/systems/sfx.js renderer/render/audio.js test/sammunut.test.js
git commit -m "feat(sammunut): burns only in deadwood firelight, flees and shuns by thirds; fades instead of snapping"
```

---

### Task 12: The Echo — companion ghost

**Files:**
- Create: `renderer/systems/echo.js`
- Modify: `renderer/systems/leap.js` (`echoSpawns`, drop `echoAdjacent`), `renderer/game.js` (spawn, tick), `renderer/render/canvas.js` (draw)
- Test: `test/echo.test.js`, `test/leap.test.js`, `test/canvas.test.js`

**Interfaces:**
- `echoSpawns(mapData, at) → [{ kind: 'echo', x, y }]`.
- `buildEntities` `'echo'` → `{ type: 'echo', id: 'echo', x, y, px, py, fadeA: 0, t: 0, trail: [], said: null }`.
- `updateEcho(echo, state, { episode, mapData, flags, ctx }, delta)`, `ECHO_RANGE = 160`, `echoTarget(player)`, `activeSpot(...)`.

- [ ] **Step 1: Failing tests**

```js
// test/echo.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { updateEcho, echoTarget, activeSpot, ECHO_RANGE } from '../renderer/systems/echo.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const mapData = { pois: [{ label: 'runestone', x: 10, y: 10 }, { label: 'bell', x: 30, y: 10 }] }
const episode = { echoSpots: [
  { fromPoi: 'runestone', lines: [{ when: f => f.done, text: 'Done.' }, { when: () => true, text: 'Start.' }] },
  { fromPoi: 'bell', lines: [{ when: () => true, text: 'Bell.' }] },
] }
const player = (x, y, facing = 'east') => ({ x, y, px: x * S + 16, py: y * S + 16, facing })
const echo = () => ({ type: 'echo', id: 'echo', x: 0, y: 0, px: 16, py: 16, fadeA: 0, t: 0, trail: [], said: null })
const stateWith = p => ({ player: p, entities: [], log: [], sfx: makeSfx(), feedback: { bubble: null } })
const ep = flags => ({ episode, mapData, flags, ctx: {} })

describe('echo follow', () => {
  it('targets one tile behind the player, six px up', () => {
    assert.deepEqual(echoTarget(player(5, 5, 'east')), { px: 5 * S + 16 - S, py: 5 * S + 16 - 6 })
    assert.deepEqual(echoTarget(player(5, 5, 'north')), { px: 5 * S + 16, py: 5 * S + 16 + S - 6 })
  })
  it('eases toward the target and keeps a trail', () => {
    const e = echo(), st = stateWith(player(5, 5))
    updateEcho(e, st, ep({}), 0.1)
    const t = echoTarget(st.player)
    assert.ok(e.px > 16 && e.px < t.px)
    for (let i = 0; i < 30; i++) updateEcho(e, st, ep({}), 0.1)
    assert.ok(Math.abs(e.px - t.px) < 1 && Math.abs(e.py - t.py) < 1)
    assert.equal(e.trail.length, 3)
    assert.equal(e.x, Math.floor(e.px / S))
  })
})

describe('echo visibility and speech', () => {
  it('is invisible with no spot in range', () => {
    const e = echo(), st = stateWith(player(50, 50))
    updateEcho(e, st, ep({}), 1)
    assert.equal(e.fadeA, 0)
    assert.equal(st.feedback.bubble, null)
  })
  it('fades in near a spot and speaks that spot line once', () => {
    const e = echo(), st = stateWith(player(11, 10))
    updateEcho(e, st, ep({}), 0.1)
    assert.ok(e.fadeA > 0 && e.fadeA < 1)
    assert.equal(st.feedback.bubble.text, 'Start.')
    assert.equal(st.sfx.cues.filter(c => c.name === 'echo').length, 1)
    st.feedback.bubble = null
    updateEcho(e, st, ep({}), 0.1)
    assert.equal(st.feedback.bubble, null)
  })
  it('re-speaks when the line changes while in range, and again after leaving and returning', () => {
    const e = echo(), st = stateWith(player(11, 10))
    const flags = {}
    updateEcho(e, st, ep(flags), 0.1)
    flags.done = true
    updateEcho(e, st, ep(flags), 0.1)
    assert.equal(st.feedback.bubble.text, 'Done.')
    st.player = player(50, 50)
    updateEcho(e, st, ep(flags), 2)
    assert.equal(e.fadeA, 0)
    st.feedback.bubble = null
    st.player = player(11, 10)
    updateEcho(e, st, ep(flags), 0.1)
    assert.equal(st.feedback.bubble.text, 'Done.')
  })
  it('activeSpot picks the nearest spot within range that has a line', () => {
    assert.equal(activeSpot(episode, mapData, {}, {}, 10 * S, 10 * S).i, 0)
    assert.equal(activeSpot(episode, mapData, {}, {}, 20 * S, 10 * S), null)
    assert.equal(ECHO_RANGE, 5 * S)
  })
})
```
In `test/leap.test.js`: change the `echoSpawns` assertions to `assert.deepEqual(echoSpawns(mapData, { x: 3, y: 4 }), [{ kind: 'echo', x: 3, y: 4 }])` and `echoSpawns(nonLeapMap, …)` → `[]`; delete `echoAdjacent` tests and import.
In `test/canvas.test.js` (`drawEntity — echo`): draw `{ type: 'echo', fadeA: 1, t: 0.3, px: 100, py: 100, trail: [{ px: 96, py: 100 }, { px: 92, py: 100 }, { px: 88, py: 100 }] }` and assert three `drawImage` ops plus one `ellipse`; and that `{ type: 'echo', fadeA: 0 }` draws nothing.

- [ ] **Step 2: Verify failure** → FAIL.

- [ ] **Step 3: Implement**

`renderer/systems/echo.js`:

```js
// The Echo — the spectral guide only the player sees. One per leap map, it
// trails a tile behind the player, invisible until the player nears an
// echo spot (a POI with something to say right now), fades in, speaks the
// spot's current line once, and fades out as the player leaves. Pure.
import { poiCell, echoLine } from './leap.js'
import { speakFrom } from './feedback.js'
import { sfx } from './sfx.js'
import { stepFade } from './fade.js'

const S = 32
export const ECHO_RANGE = 5 * S
export const ECHO_TRAIL_DT = 0.08
export const ECHO_TRAIL_LEN = 3
const BEHIND = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }

export function echoTarget(player) {
  const [dx, dy] = BEHIND[player.facing] ?? [0, 1]
  return { px: player.px + dx * S, py: player.py + dy * S - 6 }
}

// Nearest echo spot within ECHO_RANGE of (px, py) whose line ladder yields
// a text right now; null when there is nothing to say nearby.
export function activeSpot(episode, mapData, flags, ctx, px, py) {
  let best = null
  ;(episode?.echoSpots ?? []).forEach((s, i) => {
    const c = poiCell(mapData, s.fromPoi)
    if (!c) return
    const d = Math.hypot(c.x * S + S / 2 - px, c.y * S + S / 2 - py)
    if (d > ECHO_RANGE || (best && d >= best.d)) return
    const text = echoLine(episode, i, flags, ctx)
    if (text) best = { i, text, d }
  })
  return best
}

export function updateEcho(echo, state, { episode, mapData, flags, ctx }, delta) {
  const { player } = state
  echo.t = (echo.t ?? 0) + delta
  const tgt = echoTarget(player)
  const k = Math.min(1, 6 * delta)
  echo.px += (tgt.px - echo.px) * k
  echo.py += (tgt.py - echo.py) * k
  echo.x = Math.floor(echo.px / S)
  echo.y = Math.floor(echo.py / S)
  echo.trailT = (echo.trailT ?? 0) + delta
  if (echo.trailT >= ECHO_TRAIL_DT) {
    echo.trailT = 0
    echo.trail = [{ px: echo.px, py: echo.py }, ...(echo.trail ?? [])].slice(0, ECHO_TRAIL_LEN)
  }
  const spot = activeSpot(episode, mapData, flags, ctx, player.px, player.py)
  stepFade(echo, spot ? 1 : 0, delta, { inTime: 0.5, outTime: 0.8 })
  if (!spot) { echo.said = null; return }
  const key = `${spot.i}:${spot.text}`
  if (echo.said === key) return
  echo.said = key
  speakFrom(state, echo, spot.text)
  sfx(state, 'echo', { px: echo.px, py: echo.py })
}
```

`leap.js`: replace `echoSpawns`/`echoAdjacent` with
```js
// One Echo per leap map, spawned on the player's arrival cell; it follows
// from there (systems/echo.js). Non-leap maps get none.
export function echoSpawns(mapData, at) {
  return episodeFor(mapData) ? [{ kind: 'echo', x: at.x, y: at.y }] : []
}
```

`game.js`:
- `buildEntities` `'echo'` case: `return [{ type: 'echo', id: 'echo', x: s.x, y: s.y, px: cx, py: cy, fadeA: 0, t: 0, trail: [], said: null }]`.
- `arriveOnMap`: `state.entities.push(...buildEntities(echoSpawns(mapData, state.player), state.map, state.level))`; delete `state.echoHold = null`.
- Surface tick: replace the `echoAdjacent … state.echoHold = echo` block with
```js
    const echo = state.entities.find(e => e.type === 'echo')
    if (echo) updateEcho(echo, state, { episode: state.episode, mapData: state.epCtx.mapData, flags: state.epCtx.flags,
                                        ctx: ruleCtx(activeSave, state.epCtx.mapData) }, delta)
```
- Imports: add `updateEcho` from `'./systems/echo.js'`; drop `echoAdjacent`, `echoLine` from the leap import.

`canvas.js` echo branch:
```js
  if (entity.type === 'echo') {
    const s = sprites.player_magic
    const fade = entity.fadeA ?? 0
    if (!s || fade <= 0) return
    const bob = Math.round(Math.sin((entity.t ?? 0) * 2.2 * Math.PI * 2) * 3)
    const prevA = ctx.globalAlpha, prevF = ctx.filter
    ctx.fillStyle = `rgba(120,200,255,${(0.18 * fade).toFixed(3)})`
    ctx.beginPath()
    ctx.ellipse(px + S / 2, py + S - 2, S * 0.45, S * 0.18, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.filter = 'hue-rotate(160deg) saturate(0.6)'
    const trail = entity.trail ?? []
    for (const [j, a] of [[2, 0.12], [1, 0.25]]) {
      const tr = trail[j]
      if (!tr) continue
      ctx.globalAlpha = prevA * 0.55 * fade * a
      ctx.drawImage(s, px + Math.round(tr.px - entity.px), py + Math.round(tr.py - entity.py) + bob, S, S)
    }
    ctx.globalAlpha = prevA * 0.55 * fade
    ctx.drawImage(s, px, py + bob, S, S)
    ctx.filter = prevF; ctx.globalAlpha = prevA
    return
  }
```

- [ ] **Step 4: Run** — `node --test test/` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/echo.js renderer/systems/leap.js renderer/game.js renderer/render/canvas.js test/echo.test.js test/leap.test.js test/canvas.test.js
git commit -m "feat(echo): companion ghost — trails the player, fades in at spots, speaks once per entry"
```

---

### Task 13: Fold — tame wolves that hunt the Maahinen

**Files:**
- Modify: `renderer/data/leaps.js` (`tame`), `renderer/systems/openmap.js`, `renderer/data/npcs.js`, `renderer/systems/npc.js`
- Test: `test/openmap.test.js`, `test/npc.test.js`

**Interfaces:**
- `EPISODES['highland-2-fold'].tame = ['wolf']` → `npcSpawnsForMap` emits those species with `hostile: false`.
- `NPC_SPECIES.wolf.prey = ['maahinen']`, priorities `['flee_hurt', 'hunt_prey', 'attack_hostile', 'go_to', 'wander']`.
- `GOALS.hunt_prey`, `HUNT_RANGE = 8 * 32`, `BITE_REACH = 30`, `BITE_INTERVAL = 0.8`, `BITE_DMG = 2`, `findPrey(e, ctx)`.

- [ ] **Step 1: Failing tests**

Append to `test/openmap.test.js` (use the file's existing minimal map-data helper, or build one: `{ name: 'highland-2-fold', w: 12, h: 12, walk: […all '1' rows…], playerSpawn: {x:1,y:1}, pois: [{ kind: 'landmark', label: 'den', x: 6, y: 6 }], npcs: { at: { den: ['wolf'] } } }`):
```js
it('tame species on a leap map spawn non-hostile', () => {
  const data = foldData()   // name 'highland-2-fold', den POI, npcs.at.den = ['wolf']
  const s = npcSpawnsForMap(data).find(x => x.species === 'wolf')
  assert.equal(s.hostile, false)
  const elsewhere = npcSpawnsForMap({ ...data, name: 'forest-1-clearings' }).find(x => x.species === 'wolf')
  assert.equal(elsewhere.hostile, true)
})
```
Append to `test/npc.test.js`:
```js
describe('hunt_prey', () => {
  const S = 32
  const openState = (wolf, prey) => {
    const map = createMap(30, 30)
    for (let y = 1; y < 29; y++) for (let x = 1; x < 29; x++) map[y][x].tile = TILE.FLOOR
    return { map, player: { x: 1, y: 1, px: 48, py: 48, hp: 10 }, entities: [wolf, prey], sfx: makeSfx(), feedback: { floats: [] } }
  }
  it('a tame wolf chooses hunt_prey for a surfaced maahinen in sight and walks at it', () => {
    const wolf = makeNpc({ species: 'wolf', id: 'w', x: 5, y: 5, hostile: false })
    const prey = { type: 'maahinen', state: 'surfaced', hp: 36, maxHp: 36, x: 10, y: 5, px: 10 * S + 16, py: 5 * S + 16 }
    const state = openState(wolf, prey)
    const ctx = buildCtx(wolf, state, 0.05)
    assert.equal(selectGoal(wolf, ctx), 'hunt_prey')
    const intent = GOALS.hunt_prey.run(wolf, ctx, 0.05)
    assert.deepEqual(intent, { mode: 'patrol', target: { x: 10, y: 5 }, speed: ctx.cfg.speed })
  })
  it('ignores a submerged or dying maahinen and one out of range', () => {
    const wolf = makeNpc({ species: 'wolf', id: 'w', x: 5, y: 5, hostile: false })
    for (const prey of [
      { type: 'maahinen', state: 'submerged', hp: 36, x: 10, y: 5, px: 10 * S + 16, py: 5 * S + 16 },
      { type: 'maahinen', state: 'surfaced', hp: 0, dying: 0.5, x: 10, y: 5, px: 10 * S + 16, py: 5 * S + 16 },
      { type: 'maahinen', state: 'surfaced', hp: 36, x: 25, y: 5, px: 25 * S + 16, py: 5 * S + 16 },
    ]) assert.equal(selectGoal(wolf, buildCtx(wolf, openState(wolf, prey), 0.05)), 'wander')
  })
  it('within reach it bites every BITE_INTERVAL for BITE_DMG through hurtCreature', () => {
    const wolf = makeNpc({ species: 'wolf', id: 'w', x: 5, y: 5, hostile: false })
    const prey = { type: 'maahinen', state: 'surfaced', hp: 36, maxHp: 36, x: 5, y: 5, px: wolf.px + 20, py: wolf.py }
    const state = openState(wolf, prey)
    const ctx = buildCtx(wolf, state, 0.05)
    selectGoal(wolf, ctx)
    assert.deepEqual(GOALS.hunt_prey.run(wolf, ctx, 0.05), { mode: 'hold' })
    assert.equal(prey.hp, 36 - BITE_DMG)
    GOALS.hunt_prey.run(wolf, ctx, 0.05)
    assert.equal(prey.hp, 36 - BITE_DMG)
    GOALS.hunt_prey.run(wolf, ctx, BITE_INTERVAL)
    assert.equal(prey.hp, 36 - 2 * BITE_DMG)
    assert.ok(state.sfx.cues.some(c => c.name === 'melee-hit'))
  })
})
```
(Imports needed: `makeNpc, buildCtx, selectGoal, GOALS, BITE_DMG, BITE_INTERVAL` from npc.js, `createMap` from map.js, `TILE` from entities.js, `makeSfx` from sfx.js. Import `'../renderer/systems/monsters/maahinen.js'` for its hit hook.)

- [ ] **Step 2: Verify failure** → FAIL.

- [ ] **Step 3: Implement**

`data/leaps.js` fold entry: add `tame: ['wolf'],   // spawn non-hostile here: the wolves are innocent` next to `kit`.

`openmap.js`: `import { EPISODES } from '../data/leaps.js'`; in `npcSpawnsForMap` before `place`: `const tame = new Set(EPISODES[data.name]?.tame ?? [])`; in `place`:
```js
    spawns.push({ kind: 'npc', species, x: t.x, y: t.y, id,
      hostile: !tame.has(species) && !!(def.hostile || (record?.hostile && def.faction === 'village' && def.onHit === 'fight')) })
```
`npc.js` `makeNpc`: `hostile: hostile ?? !!def.hostile` → but callers pass `hostile: false` explicitly for tame wolves, and `false || def.hostile` would re-arm them. Change the line to:
```js
    hp: def.hp, maxHp: def.hp, hostile: hostile === undefined ? !!def.hostile : !!hostile,
```
and the signature default `hostile = undefined`.

`data/npcs.js` wolf: add `prey: ['maahinen'],` and priorities `['flee_hurt', 'hunt_prey', 'attack_hostile', 'go_to', 'wander']`.

`npc.js`:
```js
import { hurtCreature } from './creatures.js'
export const HUNT_RANGE = 8 * S
export const BITE_REACH = 30
export const BITE_INTERVAL = 0.8
export const BITE_DMG = 2

// A species with `prey` hunts the nearest surfaced, living prey entity it
// can see within HUNT_RANGE — the fold's wolves versus the Maahinen.
export function findPrey(e, ctx) {
  const prey = ctx.def.prey
  if (!prey) return null
  let best = null, bestD = HUNT_RANGE
  for (const p of ctx.state.entities) {
    if (!prey.includes(p.type) || p.state !== 'surfaced' || p.dying > 0 || !(p.hp > 0)) continue
    const d = Math.hypot(p.px - e.px, p.py - e.py)
    if (d > bestD || !hasLineOfSight(ctx.state.map, e.y, e.x, p.y, p.x)) continue
    best = p; bestD = d
  }
  return best
}
```
and in `GOALS`, before `attack_hostile`:
```js
  hunt_prey: {
    when: (e, ctx) => !!findPrey(e, ctx),
    enter: e => { e.ai.biteT = 0 },
    run: (e, ctx, dt) => {
      const prey = findPrey(e, ctx)
      if (!prey) return { mode: 'hold' }
      e.ai.biteT = Math.max(0, (e.ai.biteT ?? 0) - dt)
      if (Math.hypot(prey.px - e.px, prey.py - e.py) > BITE_REACH)
        return { mode: 'patrol', target: { x: prey.x, y: prey.y }, speed: ctx.cfg.speed }
      e.facing = prey.px < e.px ? 'west' : 'east'
      if (e.ai.biteT <= 0) {
        e.ai.biteT = BITE_INTERVAL
        const r = hurtCreature(ctx.state, prey, BITE_DMG, { source: 'wolf' })
        if (r.cue) sfx(ctx.state, r.cue, { px: prey.px, py: prey.py })
      }
      return { mode: 'hold' }
    },
  },
```

- [ ] **Step 4: Run** — `node --test test/` → PASS. Note `test/npcs-data.test.js` may assert priorities per species; update it for the wolf.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/leaps.js renderer/data/npcs.js renderer/systems/openmap.js renderer/systems/npc.js test/openmap.test.js test/npc.test.js test/npcs-data.test.js
git commit -m "feat(fold): den wolves spawn tame and hunt a surfaced Maahinen"
```

---

### Task 14: Hermit — the deadwood hearth

**Files:**
- Modify: `renderer/systems/episodes/hermit.js`, `renderer/data/leaps.js` (hermit `houses` pickups)
- Test: `test/episodes-hermit.test.js`

**Interfaces:**
- `hearth_lit` only from a `fuel === 'deadwood'` campfire within 1 tile of the hearth; a lumber fire there thinks "It gutters. Not his wood." once per fire (`fire.gutterSaid`).
- `relightHearth` makes `{ eternal: true, fuel: 'deadwood' }`.
- Woodpile pickups: `{ type: 'deadwood', count: 3 }`.

- [ ] **Step 1: Failing tests** (in `test/episodes-hermit.test.js`, adjust the existing hearth test and add)

```js
it('a lumber fire on the hearth gutters: no hearth_lit, one thought per fire', () => {
  const { ctx, state } = setup()           // the file's helper that builds ctx/state
  const fire = makeCampfire(HEARTH.x, HEARTH.y)
  state.entities.push(fire)
  tick(ctx, 0.1); tick(ctx, 0.1)
  assert.equal(ctx.flags.hearth_lit, undefined)
  assert.equal(state.log.filter(l => /gutters/.test(l.text ?? l)).length, 1)
})
it('a deadwood fire on the hearth lights it and becomes eternal', () => {
  const { ctx, state } = setup()
  state.entities.push(makeCampfire(HEARTH.x, HEARTH.y, { fuel: 'deadwood' }))
  tick(ctx, 0.1)
  assert.equal(ctx.flags.hearth_lit, true)
  const fire = hearthFireAt(state.entities, HEARTH)
  assert.equal(fire.eternal, true)
  assert.equal(fire.fuel, 'deadwood')
})
it('relighting on arrival re-derives a deadwood eternal fire', () => {
  const { ctx, state } = setup({ hearth_lit: true })
  onArrive(ctx)
  const fire = hearthFireAt(state.entities, HEARTH)
  assert.deepEqual([fire.eternal, fire.fuel], [true, 'deadwood'])
})
it("the hermit's woodpile carries deadwood", () => {
  assert.deepEqual(EPISODES['marsh-3-hermit'].houses['hermit hut'].pickups.find(p => p.type === 'deadwood'), { type: 'deadwood', count: 3 })
})
```
(Match the log assertion to however `log()` in `feedback.js` stores entries — check `state.log` shape in that file and adjust.)

- [ ] **Step 2: Verify failure** → FAIL.

- [ ] **Step 3: Implement**

`hermit.js` `tickHearth`:
```js
function tickHearth(ctx) {
  const { state, mapData, flags } = ctx
  if (flags.hearth_lit) return
  const hearth = poiCell(mapData, 'hearth')
  const fire = hearth && hearthFireAt(state.entities, hearth)
  if (!fire) return
  if (fire.fuel !== 'deadwood') {
    if (!fire.gutterSaid) { fire.gutterSaid = true; think(state, 'It gutters. Not his wood.') }
    return
  }
  ctx.set('hearth_lit')
  fire.eternal = true
  … (unchanged placement, cue, think, persist)
}
```
`relightHearth`: `state.entities.push(makeCampfire(hearth.x, hearth.y, { eternal: true, fuel: 'deadwood' }))`.
`leaps.js` hermit `houses['hermit hut'].pickups`: replace `{ type: 'lumber', count: 3 }` with `{ type: 'deadwood', count: 3 }`. (Verify `renderer/systems/houses.js` `attachPickups` accepts any stackable type via `itemFromContents` — it does.)

- [ ] **Step 4: Run** — `node --test test/episodes-hermit.test.js test/houses.test.js test/leap.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/episodes/hermit.js renderer/data/leaps.js test/episodes-hermit.test.js
git commit -m "feat(hermit): only a deadwood fire lights the hearth; woodpile holds grey wood"
```

---

### Task 15: Echo lines, cues, docs

**Files:**
- Modify: `renderer/data/leaps.js` (all `echoSpots` texts), `/home/lappemikb/CLAUDE.md` (dungeon-crawler section), `docs/superpowers/specs/2026-08-29-leap-episodes-design.md` (one pointer line at the top)
- Test: `test/leap.test.js` (line-ladder test still passes)

- [ ] **Step 1: Replace the echo lines verbatim from spec §6**

Ferry runestone ladder (`when` order unchanged):
```js
        { when: f => f.nakki_gone, text: "The lake's gone flat. Oh boy — that's a wrap." },
        { when: f => f.bell_hung, text: "Ziggy says whatever's out there isn't angry. It's hungry." },
        { when: f => f.clapper, text: "The bell's been silent a long time. Toivo never let it." },
        { when: () => true, text: 'Oh boy. They call you Toivo. Ferryman. Something out on that pier has stopped.' },
```
Ferry bell:
```js
        { when: f => f.fed >= 1 && !f.nakki_gone, text: 'It liked that. Ziggy says Toivo never served anything raw.' },
        { when: f => f.bell_hung, text: "It's watching the end of the pier. It looks hungry." },
        { when: () => true, text: 'No clapper. Ziggy is oddly fond of the islet.' },
```
Ferry hut: `'A fish rack, and a cold hearth. He fed the lake every dusk.'`

Fold runestone:
```js
        { when: (f, c) => f.maahinen_dead && c.wolvesAlive < 1, text: "It's gone, and so are they. Ziggy's at 0 %, Sam. That isn't the fix." },
        { when: f => f.maahinen_dead, text: 'Quiet night at the fold. Oh boy.' },
        { when: f => f.fleece_shown, text: "Torches are down. Whatever's under the ridge keeps to its own ground — Ziggy thinks it dislikes company." },
        { when: f => f.burn >= 3, text: "They're burning toward the den. Ziggy gives the wolves 40 %." },
        { when: () => true, text: "Oh boy. You're Aino. They blame the wolves. Ziggy puts that at 12 %." },
```
Fold den: `"Wolves. No bones, no wool. Ziggy says they'd fight anything that came near their pups."`
Fold burrow:
```js
        { when: f => f.fleece_shown, text: "Break the rocks and it'll come up after you. Somewhere with teeth would be nice." },
        { when: () => true, text: "Lamb's fleece, and the prospector's mess. The elder should see this." },
```
Hermit runestone:
```js
        { when: f => f.wraith_dead, text: 'Hearths are lit. The old man is talking again. Oh boy.' },
        { when: f => f.hearth_lit, text: "That fire it can't put out. It hates it, and it can't leave a flame alone." },
        { when: () => true, text: "Oh boy. You're Lauri. Something walks through here and eats the fires. Ziggy says only his own wood ever burned on that hearth." },
```
Hermit hearth:
```js
        { when: f => f.hearth_lit, text: "Stay in the light. Out there you can't touch it, and it drains you." },
        { when: () => true, text: 'His hearth. The grey trees on the knoll were his woodpile.' },
```
Hermit ring: `'The ring. A trance shows you where it walks, even in the dark.'`

- [ ] **Step 2: Docs**

- `/home/lappemikb/CLAUDE.md`, dungeon-crawler section: in the `renderer/systems/` bullet replace the `creatures.js` sentence with: "`renderer/systems/creatures.js` holds the per-type hit/update/alpha registries plus `hurtCreature` (the one damage path, records `state.creatureKills`); the three leap creatures are registry monsters (`data/monsters/{nakki,maahinen,sammunut}.json`, hooks in `systems/monsters/`) on the `lurker`, `quadruped` and `wraith` rigs, with `fade.js`/`dying.js` giving every creature smoothed alpha and a death pose; `echo.js` drives the one Echo per leap map that trails the player and fades in at echo spots." Also update the Echo description in the leap bullet, and note the fold/hermit solutions (wolves hunt the Maahinen; deadwood fires burn the Sammunut).
- Top of `docs/superpowers/specs/2026-08-29-leap-episodes-design.md`: add `> Superseded in part by 2026-09-03-timewarp-refinement-design.md (creature art, Echo, fold/hermit resolution).`

- [ ] **Step 3: Run** — `node --test test/` → PASS.

- [ ] **Step 4: Commit**

```bash
git add renderer/data/leaps.js docs/superpowers/specs/2026-08-29-leap-episodes-design.md
git commit -m "feat(leaps): vaguer Echo lines for all three episodes"
```
(Commit `CLAUDE.md` in the home directory separately if it is under its own repo; otherwise leave it edited.)

---

### Task 16: Live verification

**Files:** none (verification only). Time-box: 20 minutes total. Use the `arena-test` skill's journal discipline: write the questions first, then run.

- [ ] **Step 1: Boot each episode via the title cheat** (`npm start`, type `level8` / `level9` / `level10`; Timewarp episode-select also works). Check the console for `monsters:` warnings — there must be none.

- [ ] **Step 2: Ferry** — ring the bell (clapper from the islet cache): the Näkki rises out of the water with a ripple; a sword hit sinks it (no snap); feeding cooked meat three times sinks it for good and the pier opens. The Echo trails you, fades in near the runestone/bell/hut and speaks the new lines once.

- [ ] **Step 3: Fold** — walk past the den: wolves ignore you. Open the burrow with the pick; when the Maahinen erupts it rises from a shrinking dot; lead it to the den: wolves chase and bite it (white flashes, `-2` floats), it dives at half HP and resurfaces near you; repeat until the runestone hums with wolves alive. Hitting it yourself makes it dive with "It just dives."

- [ ] **Step 4: Hermit** — chop a knoll dead tree: grey wood drops. A lumber fire on the hearth gutters (thought); a grey-wood fire lights it (pale flame). The wraith comes, burns (ember tint), flees; lure it back twice with lumber fires; it dissolves into embers, hearths light, the hermit speaks.

- [ ] **Step 5: Monster lab** — `npm run monster-lab`: `nakki`, `maahinen`, `sammunut` load against `lurker`/`quadruped`/`wraith` with their params editable.

- [ ] **Step 6: Record findings** in the journal; fix anything broken as its own commit; then run `node --test test/` one last time.

---

## Self-review notes

- Spec §1 (defs, driver/passive, removals) → Task 7 (+ Task 6 for `isStoryCreature`).
- Spec §2 (rigs, channels) → Tasks 3, 4, 5.
- Spec §3 (fade, dying, per-creature exits) → Tasks 1, 2, 8, 9, 11.
- Spec §4 (Echo) → Task 12.
- Spec §5.1 → Task 8 (leaving) + Task 15 (lines). §5.2 → Tasks 9, 13. §5.3 → Tasks 10, 11, 14.
- Spec §6 → Task 15. §7 cues → Tasks 8, 10, 11. §8 tests → each task. Live → Task 16.
- Deviation from spec: the quadruped `sink` uses a uniform shrink plus dim (rotation-independent) rather than a y-only squash; the wolf bite has no swing animation (the prey's hit flash and cue carry it). Both are noted here so the spec reader is not surprised.
