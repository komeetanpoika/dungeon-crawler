# Monster Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rig-based monster pipeline — parametric quadruped rig, monster JSON definitions, game loader wired into spawn/AI/render, and a browser-based monster lab (dev server + tuner UI) — proving one monster end to end.

**Architecture:** Rigs are pure canvas renderers in `renderer/render/monster-rigs/` exporting `PARAM_SCHEMA` + `drawMonster(ctx, params, pose, S)`. Monsters are JSON in `renderer/data/monsters/` loaded at startup by `renderer/systems/monsters.js`, which registers them into the existing AI/spawn/draw seams. The lab (`tools/monster-lab/`) is a zero-dependency node server serving the repo root so the tuner imports the game's own rig modules, with SSE live reload.

**Tech Stack:** Vanilla JS ES modules (no bundler), node `http`, `node --test`, canvas 2D.

**Spec:** `docs/superpowers/specs/2026-08-31-monster-generator-design.md`

## Global Constraints

- No new npm dependencies; the lab server uses only node built-ins.
- Renderer code is browser ESM — no `fs`, no Electron imports in `renderer/`.
- Rig modules are pure functions of `(ctx, params, pose, S)`: no game imports, no entity reads.
- Monster/rig names sanitize to `[a-z0-9_]+`; Kenney/game files are never overwritten.
- Generated monsters are NEVER added to `CREATURE_TYPES` (membership diverts brain/strike/draw).
- One-way data flow: lab → `renderer/data/monsters/*.json` → game reads at startup.
- A bad monster file may cost that monster, never the game (warn + skip, no throw).
- `window.prompt()` is unsupported in Electron renderers; it is fine in the browser-only lab, but the future Electron port must swap it for the `tools/tile-editor/text-prompt.js` pattern.
- Tests are `node:test` files in `test/`, run with `npm test` (`node --test test/`).
- Commit after every task with a conventional-commit message.

---

### Task 1: Param schema helpers

**Files:**
- Create: `renderer/render/monster-rigs/schema.js`
- Test: `test/monster-schema.test.js`

**Interfaces:**
- Produces: `schemaErrors(schema) -> string[]` (empty = valid), `defaultParams(schema) -> object`, `clampParams(schema, params, warn?) -> object` (clamped copy over defaults; `warn(msg)` called per problem).

- [ ] **Step 1: Write the failing tests**

```js
// test/monster-schema.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams, clampParams } from '../renderer/render/monster-rigs/schema.js'

const GOOD = [
  { key: 'legLength', label: 'Leg length', group: 'legs', type: 'range', min: 0.4, max: 2.2, step: 0.05, default: 1.0 },
  { key: 'hideColor', label: 'Hide', group: 'skin', type: 'color', default: '#7c4a24' },
  { key: 'horns', label: 'Horns', group: 'head', type: 'toggle', default: false },
]

describe('schemaErrors', () => {
  it('accepts a valid schema', () => assert.deepEqual(schemaErrors(GOOD), []))
  it('rejects non-array', () => assert.equal(schemaErrors('nope').length, 1))
  it('flags duplicate keys, bad types, min>=max, default out of range', () => {
    const errs = schemaErrors([
      { key: 'a', label: 'A', group: 'g', type: 'range', min: 2, max: 1, step: 0.1, default: 3 },
      { key: 'a', label: 'A2', group: 'g', type: 'slider', default: 0 },
      { key: 'c', label: 'C', group: 'g', type: 'color', default: 'red' },
      { key: 'b', label: 'B', group: 'g', type: 'toggle', default: 'yes' },
    ])
    assert.ok(errs.some(e => e.includes('min >= max')))
    assert.ok(errs.some(e => e.includes('duplicate')))
    assert.ok(errs.some(e => e.includes('unknown type')))
    assert.ok(errs.some(e => e.includes('#rrggbb')))
    assert.ok(errs.some(e => e.includes('boolean')))
  })
})

describe('defaultParams', () => {
  it('collects defaults by key', () =>
    assert.deepEqual(defaultParams(GOOD), { legLength: 1.0, hideColor: '#7c4a24', horns: false }))
})

describe('clampParams', () => {
  it('clamps out-of-range, keeps valid, defaults the rest, warns per problem', () => {
    const warnings = []
    const out = clampParams(GOOD, { legLength: 99, horns: true, ghost: 1 }, m => warnings.push(m))
    assert.deepEqual(out, { legLength: 2.2, hideColor: '#7c4a24', horns: true })
    assert.equal(warnings.length, 2) // clamp + unknown key
  })
  it('rejects bad colors and non-numbers back to defaults', () => {
    const out = clampParams(GOOD, { hideColor: 'javascript:', legLength: 'wide' }, () => {})
    assert.deepEqual(out, defaultParams(GOOD))
  })
  it('handles null params', () => assert.deepEqual(clampParams(GOOD, null), defaultParams(GOOD)))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/monster-schema.test.js`
Expected: FAIL — cannot find module `schema.js`.

- [ ] **Step 3: Implement**

```js
// renderer/render/monster-rigs/schema.js
// PARAM_SCHEMA helpers shared by rigs, the game loader, and the monster lab.
// A schema is an ordered array of { key, label, group, type, ... } where type
// is 'range' (min/max/step/default numbers), 'color' (#rrggbb default) or
// 'toggle' (boolean default). Pure — no DOM, no game imports.
const TYPES = new Set(['range', 'color', 'toggle'])
const COLOR_RE = /^#[0-9a-f]{6}$/i

export function schemaErrors(schema) {
  if (!Array.isArray(schema)) return ['schema is not an array']
  const errs = [], seen = new Set()
  schema.forEach((p, i) => {
    if (!p || typeof p.key !== 'string' || !p.key) { errs.push(`#${i}: missing key`); return }
    if (seen.has(p.key)) errs.push(`${p.key}: duplicate key`)
    seen.add(p.key)
    if (!TYPES.has(p.type)) errs.push(`${p.key}: unknown type "${p.type}"`)
    if (typeof p.label !== 'string' || !p.label) errs.push(`${p.key}: missing label`)
    if (typeof p.group !== 'string' || !p.group) errs.push(`${p.key}: missing group`)
    if (p.type === 'range') {
      if (![p.min, p.max, p.step, p.default].every(Number.isFinite)) errs.push(`${p.key}: min/max/step/default must be numbers`)
      else {
        if (p.min >= p.max) errs.push(`${p.key}: min >= max`)
        if (p.default < p.min || p.default > p.max) errs.push(`${p.key}: default out of range`)
      }
    }
    if (p.type === 'color' && !COLOR_RE.test(p.default ?? '')) errs.push(`${p.key}: default must be #rrggbb`)
    if (p.type === 'toggle' && typeof p.default !== 'boolean') errs.push(`${p.key}: default must be boolean`)
  })
  return errs
}

export function defaultParams(schema) {
  return Object.fromEntries(schema.map(p => [p.key, p.default]))
}

export function clampParams(schema, params, warn = () => {}) {
  const out = defaultParams(schema)
  const byKey = new Map(schema.map(p => [p.key, p]))
  for (const [k, v] of Object.entries(params ?? {})) {
    const p = byKey.get(k)
    if (!p) { warn(`unknown param "${k}" ignored`); continue }
    if (p.type === 'range') {
      if (!Number.isFinite(v)) { warn(`param "${k}" is not a number — default kept`); continue }
      const c = Math.max(p.min, Math.min(p.max, v))
      if (c !== v) warn(`param "${k}" clamped ${v} -> ${c}`)
      out[k] = c
    } else if (p.type === 'color') {
      if (COLOR_RE.test(v)) out[k] = v
      else warn(`param "${k}" is not #rrggbb — default kept`)
    } else out[k] = !!v
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/monster-schema.test.js` — expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/monster-rigs/schema.js test/monster-schema.test.js
git commit -m "feat(monsters): param schema helpers for monster rigs"
```

---

### Task 2: Quadruped rig

**Files:**
- Create: `renderer/render/monster-rigs/quadruped.js`
- Test: `test/monster-rigs.test.js`

**Interfaces:**
- Consumes: `schemaErrors` from Task 1.
- Produces: `RIG_ID = 'quadruped'`, `PARAM_SCHEMA` (array per Task 1 format), `drawMonster(ctx, params, pose, S)` where `pose = { t, state, stateT, facing, speed01, seed }` and `state ∈ idle|walk|attack|hit|death`. Drawn around origin, `-y` forward after rotating by `pose.facing + Math.PI/2` (dragonboss convention).

This is a *baseline* — visual refinement happens later, live in the lab. It must be complete, animated, and distinct per state, not beautiful.

- [ ] **Step 1: Write the failing tests**

```js
// test/monster-rigs.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { RIG_ID, PARAM_SCHEMA, drawMonster } from '../renderer/render/monster-rigs/quadruped.js'

// Recording 2D-context stand-in: every method call is logged, every property
// set is accepted, gradients are inert. Lets us assert "drew something" and
// "states differ" without a real canvas.
function recordingCtx() {
  const target = { ops: [], createLinearGradient: () => ({ addColorStop: () => {} }),
                   createRadialGradient: () => ({ addColorStop: () => {} }) }
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k]
      return (...a) => { t.ops.push([k, ...a]) }
    },
    set(t, k, v) { t[k] = v; return true },
  })
}

const STATES = ['idle', 'walk', 'attack', 'hit', 'death']
const pose = (state, over = {}) =>
  ({ t: 1.25, state, stateT: 0.1, facing: 0.3, speed01: state === 'walk' ? 1 : 0, seed: 7, ...over })
const extremes = which => Object.fromEntries(PARAM_SCHEMA.map(p =>
  [p.key, p.type === 'range' ? p[which] : p.default]))

describe('quadruped schema', () => {
  it('is a valid PARAM_SCHEMA', () => assert.deepEqual(schemaErrors(PARAM_SCHEMA), []))
  it('exports its rig id', () => assert.equal(RIG_ID, 'quadruped'))
})

describe('quadruped drawMonster', () => {
  for (const state of STATES) {
    it(`draws ops in state "${state}" at defaults, all-min and all-max`, () => {
      for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
        const ctx = recordingCtx()
        assert.doesNotThrow(() => drawMonster(ctx, params, pose(state), 32))
        assert.ok(ctx.ops.length > 10, `state ${state}: only ${ctx.ops.length} ops`)
      }
    })
  }
  it('is balanced save/restore', () => {
    const ctx = recordingCtx()
    drawMonster(ctx, defaultParams(PARAM_SCHEMA), pose('walk'), 32)
    const saves = ctx.ops.filter(o => o[0] === 'save').length
    const restores = ctx.ops.filter(o => o[0] === 'restore').length
    assert.equal(saves, restores)
  })
  it('renders states distinctly (idle vs death op streams differ)', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('idle'), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('death', { stateT: 0.4 }), 32)
    assert.notDeepEqual(a.ops, b.ops)
  })
  it('is deterministic for identical inputs', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('walk'), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('walk'), 32)
    assert.deepEqual(a.ops, b.ops)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/monster-rigs.test.js` — expected: FAIL, module not found.

- [ ] **Step 3: Implement the rig**

```js
// renderer/render/monster-rigs/quadruped.js
// Baseline top-down quadruped rig. Pure: draws around origin from
// (params, pose, S) only. -y is forward after rotating by pose.facing + PI/2
// (same convention as render/dragonboss.js). Every pose.state renders:
// hit = white flash, death = collapse + fade.
export const RIG_ID = 'quadruped'

export const PARAM_SCHEMA = [
  { key: 'bodyLength', label: 'Body length', group: 'body', type: 'range', min: 0.8, max: 3.0, step: 0.05, default: 1.6 },
  { key: 'bodyWidth',  label: 'Body width',  group: 'body', type: 'range', min: 0.5, max: 2.0, step: 0.05, default: 0.9 },
  { key: 'bulge',      label: 'Belly bulge', group: 'body', type: 'range', min: 0.0, max: 0.6, step: 0.02, default: 0.2 },
  { key: 'legLength',  label: 'Leg length',  group: 'legs', type: 'range', min: 0.3, max: 1.6, step: 0.05, default: 0.7 },
  { key: 'legThick',   label: 'Leg thickness', group: 'legs', type: 'range', min: 0.08, max: 0.5, step: 0.02, default: 0.18 },
  { key: 'headSize',   label: 'Head size',   group: 'head', type: 'range', min: 0.3, max: 1.2, step: 0.05, default: 0.55 },
  { key: 'snout',      label: 'Snout length', group: 'head', type: 'range', min: 0.0, max: 0.9, step: 0.05, default: 0.35 },
  { key: 'eyeSize',    label: 'Eye size',    group: 'head', type: 'range', min: 0.04, max: 0.3, step: 0.01, default: 0.1 },
  { key: 'horns',      label: 'Horns',       group: 'head', type: 'toggle', default: false },
  { key: 'tailLength', label: 'Tail length', group: 'tail', type: 'range', min: 0.0, max: 2.0, step: 0.05, default: 0.8 },
  { key: 'tailTaper',  label: 'Tail taper',  group: 'tail', type: 'range', min: 0.1, max: 1.0, step: 0.05, default: 0.5 },
  { key: 'hideColor',  label: 'Hide',        group: 'skin', type: 'color', default: '#7c4a24' },
  { key: 'bellyColor', label: 'Belly',       group: 'skin', type: 'color', default: '#c9a06a' },
  { key: 'eyeColor',   label: 'Eyes',        group: 'skin', type: 'color', default: '#ffd23a' },
  { key: 'scales',     label: 'Scale texture', group: 'skin', type: 'toggle', default: false },
  { key: 'gaitFreq',   label: 'Gait frequency', group: 'motion', type: 'range', min: 2, max: 14, step: 0.5, default: 7 },
  { key: 'bob',        label: 'Body bob',    group: 'motion', type: 'range', min: 0.0, max: 0.3, step: 0.01, default: 0.08 },
]

function hash(i, j) { const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453; return s - Math.floor(s) }
function shade(hex, d) {
  const n = parseInt(hex.slice(1), 16)
  const c = v => Math.max(0, Math.min(255, v + d))
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`
}

export function drawMonster(ctx, p, pose, S) {
  const { t, state, stateT, seed } = pose
  const jit = 0.92 + 0.16 * hash(seed, 1)
  const bl = p.bodyLength * S * jit, bw = p.bodyWidth * S * jit
  const dead = state === 'death'
  const deathK = dead ? Math.min(1, stateT / 0.5) : 0
  const gait = dead ? 0 : pose.speed01

  ctx.save()
  ctx.rotate(pose.facing + Math.PI / 2)
  ctx.globalAlpha *= 1 - deathK * 0.8
  ctx.scale(1, 1 - deathK * 0.6)
  ctx.translate(0, Math.sin(t * p.gaitFreq) * p.bob * S * gait)
  const lunge = state === 'attack' ? -Math.sin(Math.min(stateT, 0.3) / 0.3 * Math.PI) * S * 0.35 : 0

  // legs first (under the body): stubs out the sides, swinging along y with the gait
  const ll = p.legLength * S, lw = Math.max(1, p.legThick * S)
  ctx.strokeStyle = shade(p.hideColor, -30); ctx.lineWidth = lw; ctx.lineCap = 'round'
  const anchors = [[-1, -bl * 0.3, 0], [1, -bl * 0.3, Math.PI], [-1, bl * 0.32, Math.PI], [1, bl * 0.32, 0]]
  for (const [sx, y, phase] of anchors) {
    const swing = Math.sin(t * p.gaitFreq + phase) * 0.6 * gait
    const x0 = sx * bw * 0.45
    ctx.beginPath(); ctx.moveTo(x0, y)
    ctx.lineTo(x0 + sx * ll * 0.55, y + swing * ll * 0.5); ctx.stroke()
  }

  // tail: chain of shrinking discs swinging behind (+y)
  const segs = 5, tl = p.tailLength * S
  let tx = 0, ty = bl * 0.48, ang = Math.PI / 2
  ctx.fillStyle = shade(p.hideColor, -15)
  for (let i = 0; i < segs && tl > 0; i++) {
    ang += dead ? 0 : Math.sin(t * 2.1 - i * 0.8) * 0.25
    tx += Math.cos(ang) * tl / segs; ty += Math.sin(ang) * tl / segs
    const r = Math.max(1, bw * 0.22 * (1 - (i / segs) * (1 - p.tailTaper)))
    ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI * 2); ctx.fill()
  }

  // body + belly
  ctx.fillStyle = p.hideColor
  ctx.beginPath(); ctx.ellipse(0, lunge * 0.3, bw * (1 + p.bulge * 0.4), bl * 0.5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = p.bellyColor
  ctx.beginPath(); ctx.ellipse(0, bl * 0.08 + lunge * 0.3, bw * 0.55 * (1 + p.bulge), bl * 0.3, 0, 0, Math.PI * 2); ctx.fill()
  if (p.scales) {
    ctx.strokeStyle = shade(p.hideColor, -40); ctx.lineWidth = 1
    for (let i = 0; i < 14; i++) {
      const sx = (hash(seed, i * 2) - 0.5) * bw * 1.4
      const sy = (hash(seed, i * 2 + 1) - 0.5) * bl * 0.8
      ctx.beginPath(); ctx.arc(sx, sy + lunge * 0.3, bw * 0.12, 0.2, Math.PI - 0.2); ctx.stroke()
    }
  }

  // head at the front (-y), lunging forward on attack
  const hs = p.headSize * S, hy = -bl * 0.5 - hs * 0.4 + lunge
  if (p.horns) {
    ctx.strokeStyle = '#d8c8a6'; ctx.lineWidth = Math.max(1.5, hs * 0.14); ctx.lineCap = 'round'
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(s * hs * 0.5, hy)
      ctx.quadraticCurveTo(s * hs * 1.1, hy - hs * 0.3, s * hs * 0.9, hy - hs * 1.0); ctx.stroke()
    }
  }
  ctx.fillStyle = p.hideColor
  ctx.beginPath(); ctx.ellipse(0, hy, hs * 0.8, hs * 0.7, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = shade(p.hideColor, 12) // snout
  ctx.beginPath(); ctx.ellipse(0, hy - hs * 0.5 - p.snout * S * 0.5, hs * 0.35, hs * 0.35 + p.snout * S * 0.5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = p.eyeColor
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(s * hs * 0.4, hy - hs * 0.15, p.eyeSize * S, p.eyeSize * S * 0.7, 0, 0, Math.PI * 2); ctx.fill()
  }

  // hit flash on top of everything
  if (state === 'hit') {
    ctx.globalAlpha *= 0.7; ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 1.1, bl * 0.55, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/monster-rigs.test.js` — expected: PASS. Note the "states distinct" test compares idle vs death (death changes alpha/scale ops); if it fails, the recording proxy is dropping property sets — `set` must store on the target.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/monster-rigs/quadruped.js test/monster-rigs.test.js
git commit -m "feat(monsters): baseline quadruped rig with param schema"
```

---

### Task 3: AI row registration

**Files:**
- Modify: `renderer/data/enemy-ai.js` (add one export; `BASE` is a module-level const object — mutating its entries is fine)
- Test: `test/enemy-ai.test.js` (append a describe block)

**Interfaces:**
- Produces: `registerMonsterAI(name, row)` — merges `row` over beast defaults and stores as `BASE[name]`, so the existing `getAIConfig({ type: name })` lookup just works.

- [ ] **Step 1: Write the failing test** (append to `test/enemy-ai.test.js`, matching its existing import style)

```js
describe('registerMonsterAI', () => {
  it('registered rows resolve through getAIConfig with beast defaults', () => {
    registerMonsterAI('boarhound', { speed: 85, sightRange: 260, combat: 'strafe' })
    const cfg = getAIConfig({ type: 'boarhound' })
    assert.equal(cfg.speed, 85)
    assert.equal(cfg.sightRange, 260)
    assert.equal(cfg.combat, 'strafe')
    assert.equal(cfg.taxon, 'beast')
    assert.equal(cfg.fleeHp, 0)          // beast default: fights to the death
    assert.equal(cfg.half, 8)            // default half when row omits it
  })
  it('an unregistered type still falls back to BASE.monster', () => {
    assert.equal(getAIConfig({ type: 'nosuch' }).speed, 80)
  })
})
```

Add `registerMonsterAI` to the file's existing import from `../renderer/data/enemy-ai.js`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/enemy-ai.test.js` — expected: FAIL, `registerMonsterAI` not exported.

- [ ] **Step 3: Implement** — add to `renderer/data/enemy-ai.js` after the `BASE` definition:

```js
// Generated monsters (systems/monsters.js) register their behavior rows here
// at load; getAIConfig then resolves them like any built-in type.
export function registerMonsterAI(name, row = {}) {
  BASE[name] = { taxon: 'beast', speed: 70, wanderSpeed: 25, half: 8,
                 sightRange: 200, stopRange: 16, ...row }
}
```

- [ ] **Step 4: Run tests** — `node --test test/enemy-ai.test.js` — expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/enemy-ai.js test/enemy-ai.test.js
git commit -m "feat(monsters): registerMonsterAI rows resolve via getAIConfig"
```

---

### Task 4: Monster registry and loader

**Files:**
- Create: `renderer/systems/monsters.js`
- Test: `test/monsters.test.js`

**Interfaces:**
- Consumes: `clampParams` (Task 1), `registerMonsterAI` (Task 3), `creatureAlpha` from `renderer/systems/creatures.js`.
- Produces (all used by Tasks 7–8 and the lab):
  - `registerMonsters(defs, { loadRig, loadHooks, warn }) -> Promise<number>` (count loaded)
  - `clearMonsters()` (test/reload helper)
  - `getMonsterDef(name) -> def | null` where `def = { name, rigId, rig, params, stats, behavior, spawn }`
  - `monsterNames() -> string[]`
  - `monstersForDepth(depth) -> [{ name, weight }]`
  - `makeMonsterFromDef(name, x, y) -> entity | null` (entity: `{ type: name, x, y, hp, maxHp, damage, inCombat: false }`)
  - `updateMonsterPose(e, delta)` (mutates `e.pose`)
  - `entityPose(e) -> { t, state, stateT, facing, speed01, seed }`
  - `drawGeneratedMonster(ctx, e, cx, cy, S, state)`

- [ ] **Step 1: Write the failing tests**

```js
// test/monsters.test.js
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerMonsters, clearMonsters, getMonsterDef, monsterNames, monstersForDepth,
         makeMonsterFromDef, updateMonsterPose, entityPose } from '../renderer/systems/monsters.js'
import { getAIConfig } from '../renderer/data/enemy-ai.js'
import { CREATURE_TYPES } from '../renderer/systems/creatures.js'

const FAKE_RIG = {
  RIG_ID: 'fakerig',
  PARAM_SCHEMA: [{ key: 'size', label: 'Size', group: 'body', type: 'range', min: 0, max: 2, step: 0.1, default: 1 }],
  drawMonster: () => {},
}
const rigLoader = table => async id => { if (!table[id]) throw new Error('no rig'); return table[id] }
const DEF = { name: 'boarhound', rig: 'fakerig', params: { size: 5 },
              stats: { hp: 30, dmg: 8, speed: 85, half: 10 },
              behavior: { sightRange: 260 }, spawn: { depths: [3, 5], weight: 2 } }
const load = (defs, opts = {}) =>
  registerMonsters(defs, { loadRig: rigLoader({ fakerig: FAKE_RIG }), loadHooks: async () => {}, warn: () => {}, ...opts })

describe('registerMonsters', () => {
  beforeEach(clearMonsters)
  it('loads a def: clamped params, stat defaults, AI row, spawn pool', async () => {
    assert.equal(await load([DEF]), 1)
    const d = getMonsterDef('boarhound')
    assert.equal(d.params.size, 2)                       // clamped 5 -> max 2
    assert.equal(d.stats.hp, 30)
    assert.deepEqual(monsterNames(), ['boarhound'])
    assert.equal(getAIConfig({ type: 'boarhound' }).sightRange, 260)
    assert.equal(getAIConfig({ type: 'boarhound' }).speed, 85)  // stats.speed feeds the row
    assert.deepEqual(monstersForDepth(4), [{ name: 'boarhound', weight: 2 }])
    assert.deepEqual(monstersForDepth(6), [])
  })
  it('skips a def whose rig is missing, warns, loads the rest', async () => {
    const warnings = []
    const n = await load([{ ...DEF, rig: 'ghost' }, { ...DEF, name: 'ok' }], { warn: m => warnings.push(m) })
    assert.equal(n, 1)
    assert.equal(getMonsterDef('boarhound'), null)
    assert.ok(getMonsterDef('ok'))
    assert.ok(warnings.some(w => w.includes('ghost')))
  })
  it('rejects bad names', async () => {
    assert.equal(await load([{ ...DEF, name: '../evil' }]), 0)
  })
  it('a failing hooks module is non-fatal and never touches CREATURE_TYPES', async () => {
    const before = [...CREATURE_TYPES]
    const n = await registerMonsters([{ ...DEF, hooks: true }],
      { loadRig: rigLoader({ fakerig: FAKE_RIG }), loadHooks: async () => { throw new Error('boom') }, warn: () => {} })
    assert.equal(n, 1)
    assert.ok(getMonsterDef('boarhound'))
    assert.deepEqual([...CREATURE_TYPES], before)
  })
})

describe('makeMonsterFromDef', () => {
  beforeEach(async () => { clearMonsters(); await load([DEF]) })
  it('builds the entity from stats', () => {
    assert.deepEqual(makeMonsterFromDef('boarhound', 4, 5),
      { type: 'boarhound', x: 4, y: 5, hp: 30, maxHp: 30, damage: 8, inCombat: false })
  })
  it('null for unknown names', () => assert.equal(makeMonsterFromDef('nosuch', 0, 0), null))
})

describe('updateMonsterPose / entityPose', () => {
  beforeEach(async () => { clearMonsters(); await load([DEF]) })
  const ent = () => ({ ...makeMonsterFromDef('boarhound', 2, 3), px: 80, py: 112 })
  it('starts idle, seeds deterministically from the spawn tile', () => {
    const a = ent(), b = ent()
    updateMonsterPose(a, 0.016); updateMonsterPose(b, 0.016)
    assert.equal(entityPose(a).state, 'idle')
    assert.equal(entityPose(a).seed, entityPose(b).seed)
  })
  it('movement -> walk with speed01 and facing from velocity', () => {
    const e = ent()
    updateMonsterPose(e, 0.016)
    e.px += 85 * 0.016            // one frame at full configured speed, +x
    updateMonsterPose(e, 0.016)
    const p = entityPose(e)
    assert.equal(p.state, 'walk')
    assert.ok(p.speed01 > 0.9 && p.speed01 <= 1)
    assert.ok(Math.abs(p.facing) < 0.01)
  })
  it('hp drop -> hit for a flash, then back; attack flag -> attack; hp<=0 -> death', () => {
    const e = ent()
    updateMonsterPose(e, 0.016)
    e.hp -= 5
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).state, 'hit')
    updateMonsterPose(e, 0.5)                 // flash expires
    assert.equal(entityPose(e).state, 'idle')
    e.attack = { swing: 1 }
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).state, 'attack')
    delete e.attack; e.hp = 0
    updateMonsterPose(e, 0.016)
    assert.equal(entityPose(e).state, 'death')
  })
  it('stateT accumulates within a state and resets on change', () => {
    const e = ent()
    updateMonsterPose(e, 0.016); updateMonsterPose(e, 0.016)
    assert.ok(entityPose(e).stateT > 0.016)
    e.hp -= 1; updateMonsterPose(e, 0.016)
    assert.ok(entityPose(e).stateT <= 0.016)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `node --test test/monsters.test.js` — expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```js
// renderer/systems/monsters.js
// Registry + loader for generated monsters (rig-drawn, JSON-defined).
// Generated monsters are normal enemies: they run the brain, take the normal
// strike path, and are NEVER added to CREATURE_TYPES (membership would divert
// brain/strike/draw — see the design spec). Their optional hook modules
// register into CREATURE_HIT/UPDATE/ALPHA keyed by monster name; game.js
// dispatches those explicitly for registry types.
import { clampParams } from '../render/monster-rigs/schema.js'
import { registerMonsterAI } from '../data/enemy-ai.js'
import { creatureAlpha } from './creatures.js'

const REGISTRY = {}
const NAME_RE = /^[a-z0-9_]+$/
const HIT_FLASH = 0.18

const defaultLoadRig = id => import(`../render/monster-rigs/${id}.js`)
const defaultLoadHooks = name => import(`./monsters/${name}.js`)

export async function registerMonsters(defs, opts = {}) {
  const { loadRig = defaultLoadRig, loadHooks = defaultLoadHooks, warn = console.warn } = opts
  let loaded = 0
  for (const raw of defs ?? []) {
    if (!raw || typeof raw.name !== 'string' || !NAME_RE.test(raw.name)) {
      warn(`monsters: bad name "${raw?.name}" — skipped`); continue
    }
    let rig
    try {
      rig = await loadRig(raw.rig)
      if (typeof rig.drawMonster !== 'function' || !Array.isArray(rig.PARAM_SCHEMA)) throw new Error('not a rig')
    } catch {
      warn(`monsters: ${raw.name}: rig "${raw.rig}" missing or invalid — skipped`); continue
    }
    const params = clampParams(rig.PARAM_SCHEMA, raw.params ?? {}, m => warn(`monsters: ${raw.name}: ${m}`))
    const stats = { hp: 10, dmg: 1, speed: 70, half: 8, ...(raw.stats ?? {}) }
    REGISTRY[raw.name] = { name: raw.name, rigId: raw.rig, rig, params, stats,
                          behavior: raw.behavior ?? {}, spawn: raw.spawn ?? null }
    registerMonsterAI(raw.name, { speed: stats.speed, half: stats.half, ...(raw.behavior ?? {}) })
    if (raw.hooks) {
      try { await loadHooks(raw.name) }
      catch (err) { warn(`monsters: ${raw.name}: hooks failed (${err.message}) — default behavior`) }
    }
    loaded++
  }
  return loaded
}

export function clearMonsters() { for (const k of Object.keys(REGISTRY)) delete REGISTRY[k] }
export function getMonsterDef(name) { return REGISTRY[name] ?? null }
export function monsterNames() { return Object.keys(REGISTRY) }

export function monstersForDepth(depth) {
  return Object.values(REGISTRY)
    .filter(d => Array.isArray(d.spawn?.depths) && depth >= d.spawn.depths[0] && depth <= d.spawn.depths[1])
    .map(d => ({ name: d.name, weight: d.spawn.weight ?? 1 }))
}

export function makeMonsterFromDef(name, x, y) {
  const d = REGISTRY[name]
  if (!d) return null
  return { type: name, x, y, hp: d.stats.hp, maxHp: d.stats.hp, damage: d.stats.dmg, inCombat: false }
}

// Per-frame pose bookkeeping, stored on the entity. Called from the enemy
// update loop after brain+act so px/py deltas reflect this frame's movement.
export function updateMonsterPose(e, delta) {
  const p = e.pose ?? (e.pose = {
    t: 0, state: 'idle', stateT: 0, facing: 0, speed01: 0,
    seed: (((e.x ?? 0) * 31 + (e.y ?? 0) * 17) & 1023),
    prevPx: e.px, prevPy: e.py, hpSeen: e.hp, hitT: 0,
  })
  p.t += delta
  const dx = e.px - p.prevPx, dy = e.py - p.prevPy
  p.prevPx = e.px; p.prevPy = e.py
  const speed = delta > 0 ? Math.hypot(dx, dy) / delta : 0
  const max = REGISTRY[e.type]?.stats.speed || 70
  p.speed01 = Math.max(0, Math.min(1, speed / max))
  if (speed > max * 0.05) p.facing = Math.atan2(dy, dx)
  if (e.hp < p.hpSeen) p.hitT = HIT_FLASH
  p.hpSeen = e.hp
  if (p.hitT > 0) p.hitT -= delta
  const next = e.hp <= 0 ? 'death'
    : p.hitT > 0 ? 'hit'
    : e.attack ? 'attack'
    : p.speed01 > 0.05 ? 'walk' : 'idle'
  if (next !== p.state) { p.state = next; p.stateT = 0 } else p.stateT += delta
}

export function entityPose(e) {
  const p = e.pose ?? { t: 0, state: 'idle', stateT: 0, facing: 0, speed01: 0, seed: 0 }
  return { t: p.t, state: p.state, stateT: p.stateT, facing: p.facing, speed01: p.speed01, seed: p.seed }
}

// Draw dispatch for the canvas entity loop: translate to the entity's screen
// centre and hand off to the rig. creatureAlpha honors any registered
// CREATURE_ALPHA hook (defaults to 1 for unhooked types).
export function drawGeneratedMonster(ctx, e, cx, cy, S, state) {
  const d = REGISTRY[e.type]
  if (!d) return
  const alpha = creatureAlpha(e, state)
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(cx, cy)
  d.rig.drawMonster(ctx, d.params, entityPose(e), S)
  ctx.restore()
}
```

- [ ] **Step 4: Run tests** — `node --test test/monsters.test.js` — expected: PASS. Also run `node --test test/enemy-ai.test.js` (registration mutates `BASE`; both must stay green).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/monsters.js test/monsters.test.js
git commit -m "feat(monsters): registry, loader, pose tracking, draw dispatch"
```

---

### Task 5: Shared monster-file IO

**Files:**
- Create: `tools/monster-lab/monster-files.cjs` (CJS so both `main.cjs` and the lab's `server.mjs` can use it)
- Test: `test/monster-files.test.js`

**Interfaces:**
- Produces: `readMonsters(dir) -> { defs: object[], warnings: string[] }`, `writeMonster(dir, name, data) -> { ok: true, name }` (throws on invalid name), `NAME_RE`.

- [ ] **Step 1: Write the failing tests**

```js
// test/monster-files.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const { readMonsters, writeMonster } = createRequire(import.meta.url)('../tools/monster-lab/monster-files.cjs')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'monfiles-'))

describe('writeMonster', () => {
  it('writes <name>.json and maintains a sorted index.json', () => {
    const dir = tmp()
    writeMonster(dir, 'zeta', { rig: 'quadruped' })
    writeMonster(dir, 'alpha', { rig: 'quadruped' })
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')), ['alpha', 'zeta'])
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'alpha.json'), 'utf8')).name, 'alpha')
  })
  it('overwrites without duplicating the index entry', () => {
    const dir = tmp()
    writeMonster(dir, 'a', { rig: 'x' }); writeMonster(dir, 'a', { rig: 'y' })
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')), ['a'])
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf8')).rig, 'y')
  })
  it('rejects path-escaping and uppercase names', () => {
    const dir = tmp()
    assert.throws(() => writeMonster(dir, '../evil', {}))
    assert.throws(() => writeMonster(dir, 'Bad', {}))
    assert.throws(() => writeMonster(dir, 'a/b', {}))
  })
})

describe('readMonsters', () => {
  it('round-trips what writeMonster wrote', () => {
    const dir = tmp()
    writeMonster(dir, 'boarhound', { rig: 'quadruped', stats: { hp: 30 } })
    const { defs, warnings } = readMonsters(dir)
    assert.equal(defs.length, 1)
    assert.equal(defs[0].name, 'boarhound')
    assert.deepEqual(warnings, [])
  })
  it('no index.json -> empty with a warning, never a throw', () => {
    const { defs, warnings } = readMonsters(tmp())
    assert.deepEqual(defs, [])
    assert.equal(warnings.length, 1)
  })
  it('skips index entries whose file is missing or invalid', () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(['ghost', 'bad']))
    fs.writeFileSync(path.join(dir, 'bad.json'), '{nope')
    const { defs, warnings } = readMonsters(dir)
    assert.deepEqual(defs, [])
    assert.equal(warnings.length, 2)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `node --test test/monster-files.test.js` — expected: FAIL.

- [ ] **Step 3: Implement**

```js
// tools/monster-lab/monster-files.cjs
// Read/write for renderer/data/monsters/. CJS so both the Electron main
// process (load-monsters IPC) and the lab dev server share one implementation.
const fs = require('fs')
const path = require('path')

const NAME_RE = /^[a-z0-9_]+$/

function readMonsters(dir) {
  const warnings = []
  let names
  try { names = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) }
  catch { return { defs: [], warnings: ['monsters: no readable index.json'] } }
  if (!Array.isArray(names)) return { defs: [], warnings: ['monsters: index.json is not an array'] }
  const defs = []
  for (const name of names) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) { warnings.push(`monsters: bad index name "${name}" — skipped`); continue }
    try { defs.push(JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'))) }
    catch { warnings.push(`monsters: ${name}.json missing or invalid — skipped`) }
  }
  return { defs, warnings }
}

function atomicWrite(file, text) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

function writeMonster(dir, name, data) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error(`invalid monster name "${name}"`)
  fs.mkdirSync(dir, { recursive: true })
  atomicWrite(path.join(dir, name + '.json'), JSON.stringify({ ...data, name }, null, 2))
  const idx = path.join(dir, 'index.json')
  let names = []
  try { names = JSON.parse(fs.readFileSync(idx, 'utf8')) } catch {}
  if (!Array.isArray(names)) names = []
  if (!names.includes(name)) names.push(name)
  names.sort()
  atomicWrite(idx, JSON.stringify(names, null, 2))
  return { ok: true, name }
}

module.exports = { readMonsters, writeMonster, NAME_RE }
```

- [ ] **Step 4: Run tests** — `node --test test/monster-files.test.js` — expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/monster-lab/monster-files.cjs test/monster-files.test.js
git commit -m "feat(monsters): shared monster-file IO (read, atomic write, index)"
```

---

### Task 6: Seed monster + Electron load wiring

**Files:**
- Create: `renderer/data/monsters/index.json`, `renderer/data/monsters/boarhound.json`
- Modify: `main.cjs` (new IPC handler next to `load-rulesets`, main.cjs:63), `preload.cjs` (new bridge fn, preload.cjs:9), `renderer/game.js` (startup registration next to `rulesets` load, game.js:1701; imports at top)

**Interfaces:**
- Consumes: `readMonsters` (Task 5), `registerMonsters` (Task 4).
- Produces: `window.saveAPI.loadMonsters() -> def[]`; the seed monster `boarhound` for every later task's end-to-end checks.

- [ ] **Step 1: Author the seed data**

`renderer/data/monsters/index.json`:

```json
["boarhound"]
```

`renderer/data/monsters/boarhound.json`:

```json
{
  "name": "boarhound",
  "rig": "quadruped",
  "params": {
    "bodyLength": 1.4, "bodyWidth": 0.8, "bulge": 0.25,
    "legLength": 0.8, "legThick": 0.2,
    "headSize": 0.6, "snout": 0.5, "eyeSize": 0.09, "horns": true,
    "tailLength": 0.6, "tailTaper": 0.4,
    "hideColor": "#5d3a1e", "bellyColor": "#b08a5a", "eyeColor": "#e33",
    "gaitFreq": 9, "bob": 0.1
  },
  "stats": { "hp": 6, "dmg": 1, "speed": 85, "half": 8 },
  "behavior": { "taxon": "beast", "sightRange": 260, "stopRange": 18 },
  "spawn": { "depths": [3, 5], "weight": 1 }
}
```

- [ ] **Step 2: Wire main.cjs** — after the `load-rulesets` handler (main.cjs:63):

```js
const { readMonsters } = require('./tools/monster-lab/monster-files.cjs')
const MONSTERS_DIR = path.join(__dirname, 'renderer', 'data', 'monsters')
ipcMain.handle('load-monsters', () => {
  const { defs, warnings } = readMonsters(MONSTERS_DIR)
  for (const w of warnings) console.warn(w)
  return defs
})
```

(The `require` goes with the other requires at the top of `main.cjs`; reuse its existing `path` import.)

- [ ] **Step 3: Wire preload.cjs** — next to `loadRulesets` (preload.cjs:9):

```js
  loadMonsters: () => ipcRenderer.invoke('load-monsters'),
```

- [ ] **Step 4: Wire game startup** — in `renderer/game.js`, add to the imports:

```js
import { registerMonsters, getMonsterDef, makeMonsterFromDef, updateMonsterPose } from './systems/monsters.js'
```

and next to the rulesets load (game.js:1701):

```js
  await registerMonsters((await window.saveAPI.loadMonsters?.()) ?? [])
```

(Optional-chained so a saveAPI shim without the method — e.g. the web build — degrades to zero monsters, not a crash.)

- [ ] **Step 5: Verify**

Run: `npm test` — expected: full suite PASS (no behavior change yet — nothing consumes the registry in-game until Tasks 7–8).
Run: `node -e "const{readMonsters}=require('./tools/monster-lab/monster-files.cjs');const r=readMonsters('renderer/data/monsters');console.log(JSON.stringify(r.warnings),r.defs[0].name)"` — expected: `[] boarhound`.

- [ ] **Step 6: Commit**

```bash
git add renderer/data/monsters/ main.cjs preload.cjs renderer/game.js
git commit -m "feat(monsters): seed boarhound + load-monsters IPC and startup registration"
```

---

### Task 7: Spawn integration (level pool + arena gate)

**Files:**
- Modify: `renderer/systems/map.js` (import registry fns; extract + use `pickMonsterSpawn` in the monster loop at map.js:751-762; widen the `ENEMY_KINDS` gate in `buildArena` at map.js:507-509)
- Test: `test/monster-spawns.test.js`

**Interfaces:**
- Consumes: `monstersForDepth`, `getMonsterDef`, `clearMonsters`, `registerMonsters` (Task 4).
- Produces: `pickMonsterSpawn(cfg, depth, i, guaranteed, genPool, rand?) -> { kind, variant? }` (exported from `map.js` for tests). Pool rule per spec: generated `weight: 1` counts as one built-in monster type's share of the roll; guaranteed slots are untouched; behavior with an empty `genPool` is byte-identical to today.

- [ ] **Step 1: Write the failing tests**

```js
// test/monster-spawns.test.js
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { pickMonsterSpawn, buildArena } from '../renderer/systems/map.js'
import { registerMonsters, clearMonsters } from '../renderer/systems/monsters.js'

const FAKE_RIG = { RIG_ID: 'r', PARAM_SCHEMA: [], drawMonster: () => {} }
const loadOpts = { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} }

describe('pickMonsterSpawn', () => {
  it('guaranteed slots always win', () => {
    const r = pickMonsterSpawn({}, 3, 0, ['strong'], [{ name: 'gen', weight: 9 }], () => 0)
    assert.deepEqual(r, { kind: 'monster', variant: 'strong' })
  })
  it('empty genPool reproduces the built-in variant logic exactly', () => {
    assert.deepEqual(pickMonsterSpawn({}, 3, 0, [], [], () => 0.6), { kind: 'monster', variant: 'weak' })
    assert.deepEqual(pickMonsterSpawn({}, 3, 0, [], [], () => 0.8), { kind: 'monster', variant: 'medium' })
    assert.deepEqual(pickMonsterSpawn({ variantPool: ['boss'] }, 3, 0, [], [], () => 0.99),
                     { kind: 'monster', variant: 'boss' })
  })
  it('weight 1 vs the 2 default built-in types -> generated share is 1/3', () => {
    const gen = [{ name: 'boarhound', weight: 1 }]
    // rand() drawn first for the pool split: below 1/3 -> generated
    assert.deepEqual(pickMonsterSpawn({}, 3, 0, [], gen, () => 0.32), { kind: 'boarhound' })
    assert.equal(pickMonsterSpawn({}, 3, 0, [], gen, () => 0.35).kind, 'monster')
  })
  it('weighted choice among several generated monsters', () => {
    const gen = [{ name: 'a', weight: 1 }, { name: 'b', weight: 3 }]
    // split roll 0 -> generated branch; second roll 0.9 * 4 = 3.6 lands in b
    const seq = [0, 0.9]
    const r = pickMonsterSpawn({}, 3, 0, [], gen, () => seq.shift())
    assert.equal(r.kind, 'b')
  })
})

describe('buildArena generated-monster gate', () => {
  beforeEach(clearMonsters)
  it('accepts a registered monster kind and still rejects unknowns', async () => {
    await registerMonsters([{ name: 'boarhound', rig: 'r', stats: { hp: 5 } }], loadOpts)
    const warnings = []
    const { entitySpawns } = buildArena(
      { enemies: [{ kind: 'boarhound' }, { kind: 'nosuch' }] }, m => warnings.push(m))
    assert.deepEqual(entitySpawns.map(s => s.kind), ['boarhound'])
    assert.ok(warnings.some(w => w.includes('nosuch')))
  })
})
```

- [ ] **Step 2: Run to verify failure** — `node --test test/monster-spawns.test.js` — expected: FAIL, `pickMonsterSpawn` not exported.

- [ ] **Step 3: Implement in `renderer/systems/map.js`**

Add to imports: `import { monstersForDepth, getMonsterDef } from './monsters.js'`.

Add the exported helper (near the monster loop):

```js
// One monster-spawn roll. Built-in behavior is unchanged when genPool is
// empty. With generated monsters, first split the roll between built-ins
// (share = number of built-in variant types, 2 for the depth defaults) and
// the generated pool (share = summed weights), then pick within the branch.
export function pickMonsterSpawn(cfg, depth, i, guaranteed, genPool, rand = Math.random) {
  if (i < guaranteed.length) return { kind: 'monster', variant: guaranteed[i] }
  const genWeight = genPool.reduce((a, m) => a + (m.weight ?? 1), 0)
  const builtins = cfg.variantPool?.length ?? 2
  if (genWeight > 0 && rand() < genWeight / (builtins + genWeight)) {
    let r = rand() * genWeight
    for (const m of genPool) { r -= m.weight ?? 1; if (r <= 0) return { kind: m.name } }
    return { kind: genPool[genPool.length - 1].name }
  }
  const r = rand()
  const variant = cfg.variantPool?.length
    ? cfg.variantPool[Math.floor(rand() * cfg.variantPool.length)]
    : depth <= 5
      ? (r < 0.7 ? 'weak' : 'medium')
      : depth <= 7
        ? (r < 0.4 ? 'medium' : 'strong')
        : (r < 0.5 ? 'strong' : 'boss')
  return { kind: 'monster', variant }
}
```

Replace the body of the monster loop (map.js:751-762) with:

```js
    const genPool = monstersForDepth(depth)
    for (let i = 0; i < monsterCount && idx < farTiles.length; i++, idx++) {
      entitySpawns.push({ ...pickMonsterSpawn(cfg, depth, i, guaranteed, genPool), ...farTiles[idx] })
    }
```

(The old inline `r`/`variant` logic moves verbatim into `pickMonsterSpawn` — delete it from the loop.)

Widen the arena gate (map.js:509):

```js
    if (!e || (!ENEMY_KINDS.has(e.kind) && !getMonsterDef(e.kind))) { warn(`arena: unknown enemy kind "${e?.kind}" — skipped`); continue }
```

- [ ] **Step 4: Run tests** — `node --test test/monster-spawns.test.js` and `npm test` (map.js is heavily covered; the refactor must keep every existing test green). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/map.js test/monster-spawns.test.js
git commit -m "feat(monsters): generated monsters join the depth spawn pool and arena"
```

---

### Task 8: Game-loop and render wiring

**Files:**
- Modify: `renderer/game.js` — `buildEntities` default case (game.js:387), enemy update loop (after the `act(...)` call at game.js:1285), strike gates (game.js:1052 and game.js:1230)
- Modify: `renderer/render/canvas.js` — entity loop margin + draw branch (canvas.js:962-973), imports

**Interfaces:**
- Consumes: `getMonsterDef`, `makeMonsterFromDef`, `updateMonsterPose` (imported into game.js in Task 6), `drawGeneratedMonster` (Task 4), `CREATURE_HIT`/`CREATURE_UPDATE` from `renderer/systems/creatures.js`.
- Produces: boarhound (and any future monster JSON) spawns, thinks, moves, is drawn by its rig, takes hits, and dies through the standard enemy pipeline.

`renderer/game.js` has no unit tests by design (see the comment in `test/creatures.test.js`); this task is verified by the full suite staying green plus the live arena check in Task 13.

- [ ] **Step 1: buildEntities default case** — replace `default: return []` (game.js:387) with:

```js
      default: {
        const gen = makeMonsterFromDef(s.kind, s.x, s.y)
        return gen ? [hpOverride({ ...gen, px: cx, py: cy, ...aiInit() })] : []
      }
```

- [ ] **Step 2: Enemy update loop** — game.js:1272 area currently reads:

```js
    if (isCreature(e)) { updateCreature(e, state, delta); continue }
    if (!isEnemy(e)) continue
    ...
    if (canMove) act(e, state, delta, updateBrain(e, state, delta))
```

After the `act(...)` line, add:

```js
    if (getMonsterDef(e.type)) { updateMonsterPose(e, delta); CREATURE_UPDATE[e.type]?.(e, state, delta) }
```

Extend the creatures import at game.js:41 with `CREATURE_UPDATE, CREATURE_HIT`.

- [ ] **Step 3: Strike gates** — at game.js:1052 and game.js:1230, change

```js
        if (isCreature(e)) {
```

to

```js
        if (isCreature(e) || (CREATURE_HIT[e.type] && getMonsterDef(e.type))) {
```

so a hooked generated monster resolves its own hit (via `strikeCreature`'s per-type dispatch) while hook-less ones keep the plain enemy damage path.

- [ ] **Step 4: Canvas draw branch** — in `renderer/render/canvas.js` add to imports:

```js
import { getMonsterDef, drawGeneratedMonster } from '../systems/monsters.js'
```

At the margin line (canvas.js:962) prepend a generated case:

```js
      const margin = getMonsterDef(e.type) ? 3 : e.type === 'dragon' ? 5 : e.type === 'dragon_boss' ? 6 : e.type === 'cyclops' ? 2 : 0
```

And in the branch chain (canvas.js:967-973), before the final `else drawEntity(...)`:

```js
      else if (getMonsterDef(e.type)) drawGeneratedMonster(ctx, e, epx + S / 2, epy + S / 2, S, state)
```

- [ ] **Step 5: Verify** — `npm test` — full suite PASS. Then a quick live smoke: launch with `npm start`, use the `level3` title cheat, and confirm no console errors on a depth-3 map (a boarhound may or may not roll — errors are what this step checks; real verification is Task 13).

- [ ] **Step 6: Commit**

```bash
git add renderer/game.js renderer/render/canvas.js
git commit -m "feat(monsters): spawn, update, strike and render wiring for generated monsters"
```

---

### Task 9: Lab dev server

**Files:**
- Create: `tools/monster-lab/server.mjs`
- Modify: `package.json` (add `"monster-lab": "node tools/monster-lab/server.mjs"` to scripts)
- Test: `test/monster-lab-server.test.js`

**Interfaces:**
- Consumes: `readMonsters`, `writeMonster` (Task 5).
- Produces: `createLabServer({ root, monstersDir, rigsDir }) -> http.Server` (exported for tests); routes `GET /api/monsters`, `PUT /api/monsters/<name>`, `GET /api/rigs`, `GET /api/events` (SSE), static files under the repo root, `/` → `/tools/monster-lab/index.html`. Default port 5180.

- [ ] **Step 1: Write the failing tests**

```js
// test/monster-lab-server.test.js
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLabServer } from '../tools/monster-lab/server.mjs'

let server, base, dir
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-'))
  server = createLabServer({ root: process.cwd(), monstersDir: dir,
                             rigsDir: path.join(process.cwd(), 'renderer/render/monster-rigs') })
  await new Promise(r => server.listen(0, r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

describe('lab server API', () => {
  it('GET /api/rigs lists rig modules without schema.js', async () => {
    const rigs = await (await fetch(`${base}/api/rigs`)).json()
    assert.ok(rigs.includes('quadruped'))
    assert.ok(!rigs.includes('schema'))
  })
  it('PUT then GET /api/monsters round-trips', async () => {
    const put = await fetch(`${base}/api/monsters/testmon`, {
      method: 'PUT', body: JSON.stringify({ rig: 'quadruped', stats: { hp: 5 } }) })
    assert.equal(put.status, 200)
    const { defs } = await (await fetch(`${base}/api/monsters`)).json()
    assert.equal(defs.length, 1)
    assert.equal(defs[0].name, 'testmon')
  })
  it('PUT with a bad name is rejected 400 and writes nothing', async () => {
    const res = await fetch(`${base}/api/monsters/..%2Fevil`, { method: 'PUT', body: '{}' })
    assert.equal(res.status, 400)
    assert.ok(!fs.existsSync(path.join(dir, '..', 'evil.json')))
  })
  it('PUT with invalid JSON is rejected 400', async () => {
    assert.equal((await fetch(`${base}/api/monsters/ok`, { method: 'PUT', body: '{nope' })).status, 400)
  })
})

describe('lab server static', () => {
  it('serves renderer modules with a JS content type', async () => {
    const res = await fetch(`${base}/renderer/render/monster-rigs/quadruped.js`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /javascript/)
  })
  it('blocks path traversal', async () => {
    assert.equal((await fetch(`${base}/../etc/passwd`)).status, 404)
  })
  it('/api/events answers as an SSE stream', async () => {
    const ac = new AbortController()
    const res = await fetch(`${base}/api/events`, { signal: ac.signal })
    assert.match(res.headers.get('content-type'), /text\/event-stream/)
    ac.abort()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `node --test test/monster-lab-server.test.js` — expected: FAIL.

- [ ] **Step 3: Implement**

```js
// tools/monster-lab/server.mjs
// Zero-dependency dev server for the monster lab. Serves the repo root (so
// the lab page imports the game's own renderer modules), a small monsters/
// rigs API, and an SSE endpoint that fires when rig or monster files change.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { readMonsters, writeMonster, NAME_RE } = require('./monster-files.cjs')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULTS = {
  root: path.resolve(HERE, '../..'),
  monstersDir: path.resolve(HERE, '../../renderer/data/monsters'),
  rigsDir: path.resolve(HERE, '../../renderer/render/monster-rigs'),
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
               '.svg': 'image/svg+xml', '.wav': 'audio/wav' }

export function createLabServer(opts = {}) {
  const { root, monstersDir, rigsDir } = { ...DEFAULTS, ...opts }
  const sseClients = new Set()
  const notify = (dir, file) => {
    const msg = `data: ${JSON.stringify({ dir, file })}\n\n`
    for (const res of sseClients) res.write(msg)
  }
  for (const [label, watched] of [['rigs', rigsDir], ['monsters', monstersDir]]) {
    try { fs.watch(watched, (_ev, file) => notify(label, file)) } catch { /* dir may not exist yet */ }
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(body) }

    if (u.pathname === '/api/monsters' && req.method === 'GET')
      return send(200, JSON.stringify(readMonsters(monstersDir)))
    if (u.pathname.startsWith('/api/monsters/') && req.method === 'PUT') {
      const name = decodeURIComponent(u.pathname.slice('/api/monsters/'.length))
      if (!NAME_RE.test(name)) return send(400, JSON.stringify({ error: 'invalid name' }))
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        try { send(200, JSON.stringify(writeMonster(monstersDir, name, JSON.parse(body)))) }
        catch (err) { send(400, JSON.stringify({ error: err.message })) }
      })
      return
    }
    if (u.pathname === '/api/rigs' && req.method === 'GET') {
      const rigs = fs.readdirSync(rigsDir).filter(f => f.endsWith('.js') && f !== 'schema.js').map(f => f.slice(0, -3))
      return send(200, JSON.stringify(rigs))
    }
    if (u.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(':ok\n\n')
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }

    // static: repo-root files, '/' -> the lab page; refuse anything escaping root
    const rel = u.pathname === '/' ? '/tools/monster-lab/index.html' : u.pathname
    const file = path.normalize(path.join(root, decodeURIComponent(rel)))
    if (!file.startsWith(root + path.sep)) return send(404, 'not found', 'text/plain')
    fs.readFile(file, (err, data) => {
      if (err) return send(404, 'not found', 'text/plain')
      send(200, data, MIME[path.extname(file)] ?? 'application/octet-stream')
    })
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 5180
  createLabServer().listen(port, () => console.log(`monster lab: http://localhost:${port}`))
}
```

- [ ] **Step 4: Add the npm script** — in `package.json` scripts, after `"bake"`:

```json
    "monster-lab": "node tools/monster-lab/server.mjs"
```

- [ ] **Step 5: Run tests** — `node --test test/monster-lab-server.test.js` — expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/monster-lab/server.mjs package.json test/monster-lab-server.test.js
git commit -m "feat(monster-lab): zero-dependency dev server with monsters/rigs API and SSE"
```

---

### Task 10: Lab UI — shell, stage, pose simulator

**Files:**
- Create: `tools/monster-lab/index.html`, `tools/monster-lab/lab.css`, `tools/monster-lab/io.js`, `tools/monster-lab/stage.js`, `tools/monster-lab/main.js`

**Interfaces:**
- Consumes: server routes (Task 9), rig module exports (Task 2), `defaultParams` (Task 1).
- Produces: `io.js` adapter — `listMonsters()`, `saveMonster(name, data)`, `listRigs()`, `loadRig(rigId)`, `onFilesChanged(cb)` (the ONLY module allowed to `fetch`/`EventSource`/dynamic-import URLs; the future Electron build swaps this file for a preload-bridge version). `stage.js` — `makeStage(canvas, simBar)` returning `{ setRig(mod), setParams(p), setHalf(n), sim }`. `main.js` boots and exposes `window.lab = { stage, io }` for later tasks and debugging.

- [ ] **Step 1: `io.js`**

```js
// tools/monster-lab/io.js
// The lab's ONLY gateway to persistence and module loading. The future
// Electron integration replaces this file with a preload-bridge version
// exposing the same five functions; nothing else in the lab may fetch.
export async function listMonsters() { return (await fetch('/api/monsters')).json() }  // -> {defs, warnings}
export async function saveMonster(name, data) {
  const res = await fetch(`/api/monsters/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) })
  if (!res.ok) throw new Error((await res.json()).error ?? `save failed (${res.status})`)
}
export async function listRigs() { return (await fetch('/api/rigs')).json() }
export function loadRig(rigId) {
  return import(`/renderer/render/monster-rigs/${rigId}.js?t=${Date.now()}`)  // cache-busted for live reload
}
export function onFilesChanged(cb) {
  const es = new EventSource('/api/events')
  es.onmessage = ev => cb(JSON.parse(ev.data))
  return () => es.close()
}
```

- [ ] **Step 2: `stage.js`**

```js
// tools/monster-lab/stage.js
// Preview canvas + pose simulator. Runs its own rAF loop; renders the current
// rig with the current params at the sim's pose. Backdrop and collision
// overlay are toggles. Pure UI — persistence lives in io.js.
const STATES = ['idle', 'walk', 'attack', 'hit', 'death']

export function makeStage(canvas, simBar) {
  const ctx = canvas.getContext('2d')
  const st = { rig: null, params: {}, half: 8, zoom: 2, backdrop: true, overlay: false,
               sim: { state: 'idle', speed01: 0, seed: 7, paused: false, t: 0, stateT: 0 } }

  // sim bar: state buttons, speed slider, seed reroll, pause
  for (const s of STATES) {
    const b = document.createElement('button')
    b.textContent = s
    b.onclick = () => { st.sim.state = s; st.sim.stateT = 0; refresh() }
    b.dataset.state = s
    simBar.append(b)
  }
  const speed = Object.assign(document.createElement('input'),
    { type: 'range', min: 0, max: 1, step: 0.05, value: 0, title: 'speed01' })
  speed.oninput = () => { st.sim.speed01 = Number(speed.value) }
  const reroll = Object.assign(document.createElement('button'), { textContent: '🎲 seed' })
  reroll.onclick = () => { st.sim.seed = Math.floor(Math.random() * 1024) }
  const pause = Object.assign(document.createElement('button'), { textContent: '⏸' })
  pause.onclick = () => { st.sim.paused = !st.sim.paused; pause.textContent = st.sim.paused ? '▶' : '⏸' }
  simBar.append(speed, reroll, pause)
  const refresh = () => { for (const b of simBar.querySelectorAll('button[data-state]'))
    b.classList.toggle('active', b.dataset.state === st.sim.state) }
  refresh()

  let last = performance.now()
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now
    if (!st.sim.paused) { st.sim.t += dt; st.sim.stateT += dt }
    const S = 32 * st.zoom, W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    if (st.backdrop) {                       // simple checker floor
      for (let y = 0; y < H; y += S) for (let x = 0; x < W; x += S) {
        ctx.fillStyle = ((x + y) / S) % 2 ? '#2a2d33' : '#26292f'
        ctx.fillRect(x, y, S, S)
      }
    }
    if (st.rig) {
      ctx.save(); ctx.translate(W / 2, H / 2)
      st.rig.drawMonster(ctx, st.params,
        { t: st.sim.t, state: st.sim.state, stateT: st.sim.stateT,
          facing: -Math.PI / 2, speed01: st.sim.state === 'walk' ? Math.max(0.6, st.sim.speed01) : st.sim.speed01,
          seed: st.sim.seed }, S)
      ctx.restore()
    }
    if (st.overlay) {
      ctx.strokeStyle = '#4caf50'; ctx.setLineDash([4, 3])
      ctx.beginPath(); ctx.arc(W / 2, H / 2, st.half * st.zoom, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([])
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  return {
    sim: st.sim,
    setRig: mod => { st.rig = mod },
    setParams: p => { st.params = p },
    setHalf: n => { st.half = n },
    set zoom(z) { st.zoom = z }, get zoom() { return st.zoom },
    set backdrop(v) { st.backdrop = v }, set overlay(v) { st.overlay = v },
  }
}
```

- [ ] **Step 3: `index.html` + `lab.css`**

```html
<!-- tools/monster-lab/index.html -->
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Monster Lab</title>
<link rel="stylesheet" href="/tools/monster-lab/lab.css">
</head>
<body>
<div id="layout">
  <aside id="library"><h2>Monsters</h2><ul id="monster-list"></ul><button id="new-monster">+ New monster</button></aside>
  <main id="stagecol">
    <canvas id="stage" width="640" height="480"></canvas>
    <div id="simbar"></div>
    <div id="stagebar">
      <label>zoom <input id="zoom" type="range" min="1" max="4" step="0.5" value="2"></label>
      <label><input id="backdrop" type="checkbox" checked> floor</label>
      <label><input id="overlay" type="checkbox"> hitbox</label>
    </div>
    <div id="pins"></div>
  </main>
  <aside id="controls">
    <div id="params"></div>
    <div id="editors"></div>
    <button id="save" disabled>Save</button>
  </aside>
</div>
<script type="module" src="/tools/monster-lab/main.js"></script>
</body>
</html>
```

```css
/* tools/monster-lab/lab.css — tile-editor-flavored dark chrome */
* { box-sizing: border-box; }
body { margin: 0; background: #1b1d22; color: #cfd2d8; font: 13px/1.4 system-ui, sans-serif; }
#layout { display: grid; grid-template-columns: 200px 1fr 300px; gap: 8px; height: 100vh; padding: 8px; }
aside, main { background: #24272e; border: 1px solid #33363e; border-radius: 6px; padding: 10px; overflow-y: auto; }
h2 { margin: 0 0 8px; font-size: 14px; color: #e8b04b; }
button { background: #2f333b; color: #cfd2d8; border: 1px solid #444956; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
button:hover { background: #3a3f49; }
button.active { background: #e8b04b; color: #1b1d22; border-color: #e8b04b; }
#stage { background: #202329; border: 1px solid #33363e; border-radius: 4px; display: block; margin: 0 auto; }
#simbar, #stagebar { display: flex; gap: 6px; justify-content: center; margin-top: 8px; flex-wrap: wrap; align-items: center; }
#monster-list { list-style: none; margin: 0 0 8px; padding: 0; }
#monster-list li { padding: 4px 6px; border-radius: 4px; cursor: pointer; }
#monster-list li:hover { background: #2f333b; }
#monster-list li.active { background: #3a3f49; color: #e8b04b; }
#monster-list li.dirty::after { content: ' •'; color: #e8b04b; }
.group { border-top: 1px solid #33363e; margin-top: 8px; padding-top: 4px; }
.group h3 { margin: 2px 0 4px; font-size: 12px; text-transform: uppercase; color: #8b909b; cursor: pointer; }
.group.closed .rows { display: none; }
.row { display: grid; grid-template-columns: 90px 1fr 44px; gap: 6px; align-items: center; margin: 3px 0; }
.row input[type=range] { width: 100%; }
#save { width: 100%; margin-top: 10px; background: #3c6e3c; }
#save:disabled { opacity: 0.4; cursor: default; }
#pins { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
#pins canvas { border: 1px solid #33363e; border-radius: 4px; cursor: pointer; }
```

- [ ] **Step 4: `main.js` (boot only — the library/params/save wiring lands in Task 11)**

```js
// tools/monster-lab/main.js
import * as io from './io.js'
import { makeStage } from './stage.js'
import { defaultParams } from '/renderer/render/monster-rigs/schema.js'

const stage = makeStage(document.getElementById('stage'), document.getElementById('simbar'))
document.getElementById('zoom').oninput = e => { stage.zoom = Number(e.target.value) }
document.getElementById('backdrop').onchange = e => { stage.backdrop = e.target.checked }
document.getElementById('overlay').onchange = e => { stage.overlay = e.target.checked }

async function boot() {
  const rigs = await io.listRigs()
  const rig = await io.loadRig(rigs[0])
  stage.setRig(rig)
  stage.setParams(defaultParams(rig.PARAM_SCHEMA))
}
boot()
window.lab = { stage, io }
```

- [ ] **Step 5: Verify** — `npm run monster-lab`, open `http://localhost:5180`: the default quadruped animates on the checker floor; state buttons switch pose; speed slider drives the gait; pause freezes. Also verify headlessly (chromium via playwright-core, per the anim-comparison precedent) with a scratchpad script that opens the page, waits 1s, screenshots, and asserts no console errors; view the screenshot.

- [ ] **Step 6: Commit**

```bash
git add tools/monster-lab/index.html tools/monster-lab/lab.css tools/monster-lab/io.js tools/monster-lab/stage.js tools/monster-lab/main.js
git commit -m "feat(monster-lab): lab shell with live stage and pose simulator"
```

---

### Task 11: Lab UI — params panel, editors, library, save

**Files:**
- Create: `tools/monster-lab/params-panel.js`
- Modify: `tools/monster-lab/main.js` (replace the Task 10 boot with the full wiring below)

**Interfaces:**
- Consumes: `PARAM_SCHEMA` control types (Task 1), io adapter (Task 10), stage (Task 10).
- Produces: `buildParamsPanel(container, schema, params, onChange)` — rebuilds `container` with grouped controls; `onChange(key, value)` fires per edit. `main.js` holds the working-copy state: `{ name, rigId, params, stats, behavior, spawn, dirty }`.

- [ ] **Step 1: `params-panel.js`**

```js
// tools/monster-lab/params-panel.js
// Schema -> DOM controls. Groups are collapsible; range rows show the value.
export function buildParamsPanel(container, schema, params, onChange) {
  container.innerHTML = ''
  const groups = new Map()
  for (const p of schema) {
    if (!groups.has(p.group)) {
      const g = document.createElement('div'); g.className = 'group'
      const h = document.createElement('h3'); h.textContent = p.group
      const rows = document.createElement('div'); rows.className = 'rows'
      h.onclick = () => g.classList.toggle('closed')
      g.append(h, rows); container.append(g)
      groups.set(p.group, rows)
    }
    const row = document.createElement('div'); row.className = 'row'
    const label = document.createElement('label'); label.textContent = p.label
    let input, val = null
    if (p.type === 'range') {
      input = Object.assign(document.createElement('input'),
        { type: 'range', min: p.min, max: p.max, step: p.step, value: params[p.key] })
      val = document.createElement('span'); val.textContent = params[p.key]
      input.oninput = () => { val.textContent = input.value; onChange(p.key, Number(input.value)) }
    } else if (p.type === 'color') {
      input = Object.assign(document.createElement('input'), { type: 'color', value: params[p.key] })
      input.oninput = () => onChange(p.key, input.value)
    } else {
      input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: params[p.key] })
      input.onchange = () => onChange(p.key, input.checked)
    }
    row.append(label, input, val ?? document.createElement('span'))
    groups.get(p.group).append(row)
  }
}

// Plain numeric/JSON field editors for stats / behavior / spawn.
export function buildFieldEditors(container, work, markDirty) {
  container.innerHTML = ''
  const section = (title, obj, fields) => {
    const g = document.createElement('div'); g.className = 'group'
    const h = document.createElement('h3'); h.textContent = title; g.append(h)
    const rows = document.createElement('div'); rows.className = 'rows'; g.append(rows)
    for (const [key, parse] of fields) {
      const row = document.createElement('div'); row.className = 'row'
      const label = document.createElement('label'); label.textContent = key
      const input = Object.assign(document.createElement('input'),
        { type: 'text', value: obj[key] ?? '' })
      input.onchange = () => { const v = parse(input.value); if (v !== undefined) obj[key] = v; else delete obj[key]; markDirty() }
      row.append(label, input, document.createElement('span'))
      rows.append(row)
    }
    container.append(g)
  }
  const num = s => { const n = Number(s); return s !== '' && Number.isFinite(n) ? n : undefined }
  const str = s => s || undefined
  const numPair = s => { const m = s.match(/^\s*(\d+)\s*[-,]\s*(\d+)\s*$/); return m ? [Number(m[1]), Number(m[2])] : undefined }
  section('stats', work.stats, [['hp', num], ['dmg', num], ['speed', num], ['half', num]])
  section('behavior', work.behavior, [['taxon', str], ['sightRange', num], ['stopRange', num],
                                      ['combat', str], ['fleeHp', num], ['wanderSpeed', num]])
  work.spawn ??= {}
  section('spawn', work.spawn, [['depths', numPair], ['weight', num]])
}
```

- [ ] **Step 2: Rewrite `main.js` with library + save wiring**

```js
// tools/monster-lab/main.js
import * as io from './io.js'
import { makeStage } from './stage.js'
import { buildParamsPanel, buildFieldEditors } from './params-panel.js'
import { defaultParams, clampParams } from '/renderer/render/monster-rigs/schema.js'
import { toast } from '/tools/tile-editor/toast.js'

const stage = makeStage(document.getElementById('stage'), document.getElementById('simbar'))
document.getElementById('zoom').oninput = e => { stage.zoom = Number(e.target.value) }
document.getElementById('backdrop').onchange = e => { stage.backdrop = e.target.checked }
document.getElementById('overlay').onchange = e => { stage.overlay = e.target.checked }

const els = { list: document.getElementById('monster-list'), params: document.getElementById('params'),
              editors: document.getElementById('editors'), save: document.getElementById('save'),
              newBtn: document.getElementById('new-monster') }

let rigMod = null
let work = null          // { name, rigId, params, stats, behavior, spawn, hooks, dirty }
let saved = []           // defs from the server

function markDirty() {
  work.dirty = true
  els.save.disabled = false
  renderLibrary()
}

async function setWork(w) {
  work = w
  rigMod = await io.loadRig(w.rigId)
  work.params = clampParams(rigMod.PARAM_SCHEMA, work.params)
  stage.setRig(rigMod)
  stage.setParams(work.params)
  stage.setHalf(work.stats.half ?? 8)
  buildParamsPanel(els.params, rigMod.PARAM_SCHEMA, work.params,
    (k, v) => { work.params[k] = v; markDirty() })
  buildFieldEditors(els.editors, work, () => { stage.setHalf(work.stats.half ?? 8); markDirty() })
  els.save.disabled = !work.dirty
  renderLibrary()
}

function renderLibrary() {
  els.list.innerHTML = ''
  for (const d of saved) {
    const li = document.createElement('li')
    li.textContent = d.name
    li.classList.toggle('active', work?.name === d.name)
    li.classList.toggle('dirty', work?.name === d.name && work.dirty)
    li.onclick = () => setWork({ name: d.name, rigId: d.rig, params: { ...(d.params ?? {}) },
      stats: { ...(d.stats ?? {}) }, behavior: { ...(d.behavior ?? {}) },
      spawn: d.spawn ? { ...d.spawn } : null, hooks: d.hooks ?? false, dirty: false })
    els.list.append(li)
  }
}

els.newBtn.onclick = async () => {
  const rigs = await io.listRigs()
  const name = (window.prompt ?? (() => null))('monster name ([a-z0-9_])') // browser page: prompt is fine here
  if (!name || !/^[a-z0-9_]+$/.test(name)) return toast?.('invalid name') ?? alert('invalid name')
  await setWork({ name, rigId: rigs[0], params: defaultParams((await io.loadRig(rigs[0])).PARAM_SCHEMA),
                  stats: { hp: 10, dmg: 1, speed: 70, half: 8 }, behavior: {}, spawn: null, hooks: false, dirty: true })
}

els.save.onclick = async () => {
  const { name, rigId, params, stats, behavior, spawn, hooks } = work
  const clean = { rig: rigId, params, stats, behavior,
                  ...(spawn?.depths ? { spawn } : {}), ...(hooks ? { hooks: true } : {}) }
  try {
    await io.saveMonster(name, clean)
    work.dirty = false
    els.save.disabled = true
    await refreshList()
    toast?.('saved') ?? console.log('saved')
  } catch (err) { alert(`save failed: ${err.message}`) }
}

async function refreshList() {
  saved = (await io.listMonsters()).defs
  renderLibrary()
}

async function boot() {
  await refreshList()
  if (saved.length) els.list.firstChild.click()
  else {
    const rigs = await io.listRigs()
    const mod = await io.loadRig(rigs[0])
    await setWork({ name: 'untitled', rigId: rigs[0], params: defaultParams(mod.PARAM_SCHEMA),
                    stats: { hp: 10, dmg: 1, speed: 70, half: 8 }, behavior: {}, spawn: null, hooks: false, dirty: false })
  }
}
boot()
window.lab = { stage, io, get work() { return work } }
```

Note: if `tools/tile-editor/toast.js` exports a different shape than `toast(msg)`, adapt the import to its actual export (read the file first); it is a plain module with no Electron imports, served fine from the repo root.

- [ ] **Step 3: Verify** — with the server running: boarhound appears in the library and loads with its saved params (sliders reflect the JSON, not defaults); editing a slider animates the stage immediately and marks the row dirty; Save persists (`git diff renderer/data/monsters/` shows the change; **revert it after checking**: `git checkout renderer/data/monsters/`); creating a new monster with a bad name is rejected.

- [ ] **Step 4: Commit**

```bash
git add tools/monster-lab/params-panel.js tools/monster-lab/main.js
git commit -m "feat(monster-lab): schema-driven params panel, field editors, library, save"
```

---

### Task 12: Lab UI — variant pins + SSE live reload

**Files:**
- Create: `tools/monster-lab/compare.js`
- Modify: `tools/monster-lab/main.js` (wire pins + reload; ~15 lines)

**Interfaces:**
- Consumes: stage sim clock (Task 10), `io.onFilesChanged` + `io.loadRig` (Task 10), work state (Task 11).
- Produces: `makePinStrip(container, getRig, getSim, onRestore)` returning `{ pin(params), redraw() }`. Pins share the live sim clock (dragon-tuner style side-by-side).

- [ ] **Step 1: `compare.js`**

```js
// tools/monster-lab/compare.js
// Pinned param snapshots rendered side by side on the SAME sim clock as the
// main stage, so variants animate in lockstep. Click a pin to restore it.
export function makePinStrip(container, getRig, getSim, onRestore) {
  const pins = []   // { params, canvas }
  const strip = container

  function pin(params) {
    const snap = JSON.parse(JSON.stringify(params))
    const canvas = document.createElement('canvas')
    canvas.width = 120; canvas.height = 120
    canvas.title = 'click: restore · right-click: remove'
    canvas.onclick = () => onRestore(JSON.parse(JSON.stringify(snap)))
    canvas.oncontextmenu = e => {
      e.preventDefault()
      const i = pins.findIndex(p => p.canvas === canvas)
      if (i >= 0) { pins.splice(i, 1); canvas.remove() }
    }
    strip.append(canvas)
    pins.push({ params: snap, canvas })
  }

  function redraw() {
    const rig = getRig(), sim = getSim()
    if (!rig) return
    for (const p of pins) {
      const ctx = p.canvas.getContext('2d')
      ctx.clearRect(0, 0, 120, 120)
      ctx.save(); ctx.translate(60, 60)
      rig.drawMonster(ctx, p.params,
        { t: sim.t, state: sim.state, stateT: sim.stateT, facing: -Math.PI / 2,
          speed01: sim.speed01, seed: sim.seed }, 24)
      ctx.restore()
    }
  }
  const loop = () => { redraw(); requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
  return { pin, redraw }
}
```

- [ ] **Step 2: Wire into `main.js`** — add imports and, after the stage setup:

```js
import { makePinStrip } from './compare.js'
```

```js
const pinBtn = Object.assign(document.createElement('button'), { textContent: '📌 pin variant' })
document.getElementById('stagebar').append(pinBtn)
const pinStrip = makePinStrip(document.getElementById('pins'),
  () => rigMod, () => stage.sim,
  params => { Object.assign(work.params, params); stage.setParams(work.params)
              buildParamsPanel(els.params, rigMod.PARAM_SCHEMA, work.params,
                (k, v) => { work.params[k] = v; markDirty() }); markDirty() })
pinBtn.onclick = () => work && pinStrip.pin(work.params)

// live reload: a rig edit re-imports the module in place; a monster-file
// change refreshes the library (params of the open, dirty monster are kept)
io.onFilesChanged(async ({ dir, file }) => {
  if (dir === 'rigs' && work && file === `${work.rigId}.js`) {
    rigMod = await io.loadRig(work.rigId)
    stage.setRig(rigMod)
    buildParamsPanel(els.params, rigMod.PARAM_SCHEMA, work.params,
      (k, v) => { work.params[k] = v; markDirty() })
  } else if (dir === 'monsters') await refreshList()
})
```

- [ ] **Step 3: Verify** — pin two variants with different slider values: both animate in sync with the stage and differ visibly; clicking a pin restores its params to the sliders; right-click removes. Edit `quadruped.js` in the terminal (e.g. change a color constant) — the stage updates within ~1s without a page refresh and with slider state intact. Revert the test edit.

- [ ] **Step 4: Commit**

```bash
git add tools/monster-lab/compare.js tools/monster-lab/main.js
git commit -m "feat(monster-lab): variant pin strip and SSE live reload"
```

---

### Task 13: Docs, full verification, live arena check

**Files:**
- Modify: `~/CLAUDE.md` (dungeon-crawler section: add the monster generator to the architecture bullet list and `npm run monster-lab` to the commands block)
- No code changes expected; fixes discovered here get their own commits.

- [ ] **Step 1: Full suite** — `npm test` — every test green. Fix anything red before proceeding.

- [ ] **Step 2: Live arena check (time-boxed — keep it short)** — use the `arena-test` skill with a level-0 arena config spawning `{ kind: 'boarhound' }`. Verify in one run: it renders via the rig (not a sprite), chases the player, walk gait animates, a sword hit flashes it white, it dies and is removed. This is the "full loop" acceptance check for the v1 monster.

- [ ] **Step 3: Depth spawn sanity** — launch `npm start`, title-cheat `level3`, walk until a boarhound rolls or ~2 minutes elapse (density is low; a no-show after the arena check passes is acceptable — the pool math is unit-tested).

- [ ] **Step 4: Update CLAUDE.md** — in the dungeon-crawler commands block add:

```bash
npm run monster-lab # monster tuner at http://localhost:5180
```

and to the architecture description a sentence naming: `renderer/render/monster-rigs/` (parametric rigs, `PARAM_SCHEMA` + `drawMonster`), `renderer/data/monsters/` (JSON defs + index), `renderer/systems/monsters.js` (loader/registry/pose), `tools/monster-lab/` (browser tuner, spec `docs/superpowers/specs/2026-08-31-monster-generator-design.md`).

- [ ] **Step 5: Commit**

```bash
git add ~/CLAUDE.md
git commit -m "docs: monster generator commands and architecture notes"
```

---

## Post-plan follow-ups (not in this plan)

- More rigs (serpent, blob, flyer) — each is: new module in `monster-rigs/` passing the Task 2 contract tests, nothing else.
- Electron editor integration — replace `tools/monster-lab/io.js` with a preload-bridge implementation (use `text-prompt.js`, not `window.prompt`).
- First bespoke hook module under `renderer/systems/monsters/<name>.js` when a monster needs one (registers `CREATURE_HIT`/`CREATURE_UPDATE`/`CREATURE_ALPHA` — never `CREATURE_TYPES`).
