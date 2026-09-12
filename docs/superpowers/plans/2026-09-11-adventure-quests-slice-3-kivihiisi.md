# Adventure Quests — Slice 3: *Kivihiisi*, the Hiisi of the Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Mountain Pass's lair boss — mine the capstone off a giant's oven, fight the Kivihiisi whose stone cladding re-grows only while boulders still stand around the oven, and take Ukonvasara, Ukko's hammer, which calls lightning down on what it strikes.

**Architecture:** Rides the story engine slice 1 shipped (`systems/story.js` → `systems/quests.js`): a declaration in `data/quests.js`, a module `systems/quests/pass.js` exporting `onArrive`/`tick`, registered in `systems/quests/index.js`. The arena is stamped at runtime — a capstone boulder on the kiuas cell and up to six ring boulders, all ordinary `ow_mtn_rock_N` cells that `systems/lumber.js`'s `HARVEST` already mines. The Kivihiisi is a registry monster on the `quadruped` rig driven by the ordinary brain, with a `CREATURE_HIT` hook that owns its cladding; the quest module counts standing boulders in a flag and ticks the re-clad. Ukonvasara is a `WEAPON_TYPES` row with a `lightning` field; `spells/lightning.js` gains `markStrike`, and `game.js`'s melee block calls it beside the Maunonmiekka's shockwave hook.

**Tech Stack:** Vanilla ES modules, `node:test`, no bundler. Electron on desktop, `web-shim.js` on the web release (registry monsters load there via `loadMonsters`).

**Spec:** `docs/superpowers/specs/2026-09-10-adventure-quests-design.md` §4 (quest), §5 (creature, weapon), §7 (map data), §8 (tests). Slice 1's module `renderer/systems/quests/clearings.js` and hook `renderer/systems/monsters/hirvi.js` are the models.

## Global Constraints

- Quests are **optional**: never touch `isMapComplete`, `waystoneDestinations` or `nextMapDepth`.
- Every new POI is `kind: 'landmark'`; never reuse a rite label. **Not the stone circle** (84,22): it is this map's `exitPoi`, the waystone stands there.
- Depth 12's POIs come from `gen-forest.mjs`'s `autumn()` builder; its terrain from `mountain.mjs`. `node tools/static-overworld/gen-forest.mjs` is **byte-reproducible for every map but the hand-painted river** (verified 2026-09-11) — add the POI to the builder, regenerate, re-export, and `git diff --stat` must show only `forest-3-autumn.json` and `open-maps.js`.
- Registry-monster names match `^[a-z0-9_]+$` and collide with nothing in `RESERVED_NAMES` (`systems/monsters.js`).
- **A registry monster with no `weaponId` cannot melee** (`enemy-attack.js` resolves `e.weaponId ?? ENEMY_MELEE[e.type]`, and `makeMonsterFromDef` never stamps one). `ensureKivihiisi` stamps `weaponId: 'maul'` at spawn — the quest module calls it right after `ctx.spawn`.
- The boulder count `stones` is the truth, not the map: a module-stamped boulder is not in the map JSON, so `applyFelled` cannot restore its cleared state on the next build and a re-stamp that trusted `save.felled` would regrow the ring. The stray `cleared: 'rock'` entries the mine leaves in `save.felled` are harmless.
- Every code task is TDD; `npm test` green at every commit; a lone SIGSEGV with all tests passing is Node's runner on this WSL box — re-run.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TrZDgRjkMKNomd7sYjBJFq
  ```

---

## File Structure

| File | Responsibility |
|---|---|
| `renderer/systems/entities.js` (modify) | `WEAPON_TYPES.ukonvasara`; `weaponContents` carries `lightning` |
| `renderer/systems/spells/lightning.js` (modify) | `markStrike(state, x, y)` — one mark at a cell; `castLightning` uses it |
| `renderer/game.js` (modify) | the melee block collects struck enemies for a `lightning` weapon and calls `markStrike` on a player cooldown; the cooldown ticks down beside `rangedCooldown` |
| `renderer/data/monsters/kivihiisi.json` (create), `index.json` (modify) | the creature's def |
| `renderer/systems/monsters/kivihiisi.js` (create) | `ensureKivihiisi`, `tickClad`, the `CREATURE_HIT` cladding hook |
| `tools/static-overworld/gen-forest.mjs` (modify), regenerate `out/maps/forest-3-autumn.json` + `renderer/data/open-maps.js` | the `hiidenkiuas` POI |
| `renderer/data/quests.js` (modify) | the `forest-3-autumn` declaration |
| `renderer/systems/quests/pass.js` (create) | the module: arena stamping, the wake, the stone count, the kill, the hammer |
| `renderer/systems/quests/index.js` (modify) | register |
| `test/entities.test.js`, `test/lightning.test.js`, `test/monsters.test.js`, `test/adventure-quest-maps.test.js`, `test/quests.test.js` (extend); `test/kivihiisi.test.js`, `test/quest-pass.test.js` (create) | coverage |

---

### Task 1: Ukonvasara and `markStrike`

**Files:**
- Modify: `renderer/systems/entities.js` (`WEAPON_TYPES` at line 16-27; `weaponContents` at line 33-38)
- Modify: `renderer/systems/spells/lightning.js:99-114` (`castLightning`)
- Test: `test/entities.test.js`, `test/lightning.test.js`

**Interfaces:**
- Produces: `WEAPON_TYPES.ukonvasara = { name: 'Ukonvasara', damage: 5, heavy: true, lightning: { cooldown: 4 } }`; `weaponContents('ukonvasara').lightning` deep-equals `{ cooldown: 4 }`; `markStrike(state, x, y)` pushes `{ x, y, t: 0, delay: LIGHTNING.delay, struck: false }` onto `state.lightning`, plays `crackle`, returns the mark.

- [ ] **Step 1: Write the failing tests**

Append to `test/entities.test.js` (import `WEAPON_TYPES` and `weaponContents` from entities if the file does not already):

```js
describe('ukonvasara', () => {
  it('is a heavy weapon that calls lightning on a 4 s cooldown', () => {
    const d = WEAPON_TYPES.ukonvasara
    assert.equal(d.name, 'Ukonvasara')
    assert.equal(d.damage, 5)
    assert.equal(d.heavy, true)
    assert.deepEqual(d.lightning, { cooldown: 4 })
  })
  it('weaponContents carries the lightning field, and an ordinary sword has none', () => {
    assert.deepEqual(weaponContents('ukonvasara').lightning, { cooldown: 4 })
    assert.equal(weaponContents('sword').lightning, undefined)
  })
})
```

Append to `test/lightning.test.js` (add `markStrike` to the lightning import and `import { makeSfx } from '../renderer/systems/sfx.js'`). The `castLightning` describe builds its state with a local `openState()` — map, player, entities, **no `sfx`** (the `sfx()` helper is a no-op without one) — so this fixture adds a real `sfx` for the crackle assertion. Put the new describe directly after the `castLightning` one so `openState` is in scope, or lift `openState` to file scope:

```js
describe('markStrike', () => {
  const withSfx = () => ({ ...openState(), sfx: makeSfx() })
  it('places one mark at the named cell with the standard delay, and plays the crackle', () => {
    const state = withSfx()
    const mark = markStrike(state, 4, 5)
    assert.deepEqual(state.lightning, [{ x: 4, y: 5, t: 0, delay: LIGHTNING.delay, struck: false }])
    assert.equal(mark, state.lightning[0])
    assert.ok(state.sfx.cues.some(c => c.name === 'crackle'))
  })
  it('stacks: two calls are two marks — the caller owns any cooldown', () => {
    const state = withSfx()
    markStrike(state, 4, 5)
    markStrike(state, 4, 5)
    assert.equal(state.lightning.length, 2)
  })
})
```

The existing `castLightning` tests keep passing through the refactor: `markStrike` appends one mark per hit in the same order, so `deepEqual(state.lightning, marks)` and the appended-in-flight case both hold.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/entities.test.js test/lightning.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"`
Expected: `WEAPON_TYPES.ukonvasara` undefined; `markStrike` is not exported.

- [ ] **Step 3: Implement**

`renderer/systems/entities.js` — add to `WEAPON_TYPES` after `maunonmiekka`:

```js
  // Kivihiisi's reward (systems/quests/pass.js): Ukko's hammer. On hit,
  // game.js marks a lightning strike on the struck cell, `lightning.cooldown`
  // seconds apart (spells/lightning.js markStrike).
  ukonvasara:   { name: 'Ukonvasara',   damage: 5, heavy: true, lightning: { cooldown: 4 } },
```

and in `weaponContents` extend the spread list:

```js
    ...(def.heavy && { heavy: true }), ...(def.chop && { chop: def.chop }), ...(def.mine && { mine: def.mine }),
    ...(def.lightning && { lightning: def.lightning }) }
```

`renderer/systems/spells/lightning.js` — add above `castLightning`:

```js
// One strike mark at a cell: the mark-push castLightning does, callable at
// an arbitrary tile — Ukonvasara marks the enemy it struck. tickLightning
// resolves it after LIGHTNING.delay like any other mark. No dedupe: a caller
// that must not stack marks (the hammer) keeps its own cooldown.
export function markStrike(state, x, y) {
  const mark = { x, y, t: 0, delay: LIGHTNING.delay, struck: false }
  state.lightning = [...(state.lightning ?? []), mark]
  sfx(state, 'crackle', tileCentre({ x, y }))
  return mark
}
```

and in `castLightning` replace the two lines inside the loop that build the mark and play the crackle, plus the `state.lightning = [...]` line after the loop, with a call per hit:

```js
    taken.add(key(hit.x, hit.y))
    marks.push(markStrike(state, hit.x, hit.y))
  }
  return { marks }
```

- [ ] **Step 4: Run to verify green**

Run: `node --test test/entities.test.js test/lightning.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"` → `# fail 0` (the existing `castLightning` tests must still pass — same marks, same order).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/entities.js renderer/systems/spells/lightning.js test/entities.test.js test/lightning.test.js
git commit -m "feat: add Ukonvasara and a callable lightning mark"
```

---

### Task 2: The hammer's strike in the melee block

**Files:**
- Modify: `renderer/game.js:1301-1350` (the melee block: `miekka`, `struck`, the registry-creature branch, the shockwave loop) and `:1264` (cooldown tick)

This is `game.js` wiring with no unit seam — it is verified by the live check in Task 8, and by keeping the change a mirror of the Maunonmiekka hook beside it.

- [ ] **Step 1: Collect struck enemies for a lightning weapon too**

At line ~1301, after `const miekka = meleeWT === 'maunonmiekka'`:

```js
    const hammer = player.weapon?.lightning ?? null   // Ukonvasara: a strike on the struck cell
    const collect = miekka || (hammer && (player.hammerT ?? 0) <= 0)
```

Every `if (miekka) struck.push(...)` in the block becomes `if (collect) struck.push(...)` — the boss hit (line ~1314), the ordinary enemy hit (line ~1334). The registry-creature branch (line ~1319-1325) returns `e` without pushing; add `if (collect) struck.push(e)` before its `return e`, **regardless of `r.absorbed`** — the strike lands on a clad Hiisi too (its own hook absorbs the strike's damage while clad).

- [ ] **Step 2: Fire the strike beside the shockwave**

The shockwave loop `if (struck.length) { ... }` becomes `if (miekka && struck.length) { ... }`. Directly after it:

```js
    // Ukonvasara: one strike on the first struck enemy's cell, then the
    // hammer rests. tickLightning already runs every frame, so the delayed
    // strike, the flash and the thunder all come for free.
    if (hammer && struck.length && (player.hammerT ?? 0) <= 0) {
      const s = struck[0]
      markStrike(state, Math.floor(s.px / TILE_SIZE), Math.floor(s.py / TILE_SIZE))
      player.hammerT = hammer.cooldown
    }
```

Import `markStrike` from `./systems/spells/lightning.js` beside the existing `castLightning`/`tickLightning` import.

- [ ] **Step 3: Tick the cooldown**

At line ~1264, beside `player.rangedCooldown = Math.max(0, player.rangedCooldown - delta)`:

```js
  player.hammerT = Math.max(0, (player.hammerT ?? 0) - delta)
```

- [ ] **Step 4: Run the suite and commit**

`npm test` — green (nothing here is unit-tested; the suite proves nothing else broke).

```bash
git add renderer/game.js
git commit -m "feat: Ukonvasara calls lightning on the enemy it strikes"
```

---

### Task 3: The Kivihiisi — def and cladding hook

**Files:**
- Create: `renderer/data/monsters/kivihiisi.json`; Modify: `renderer/data/monsters/index.json`
- Create: `renderer/systems/monsters/kivihiisi.js`
- Test: `test/monsters.test.js` (extend), `test/kivihiisi.test.js` (create)

**Interfaces:**
- Produces: `ensureKivihiisi(e, stones = CLAD_MAX)` stamps `clad = min(CLAD_MAX, stones)`, `recladT = 0`, `weaponId = 'maul'` once; `tickClad(e, delta, stones)` caps `clad` at `min(CLAD_MAX, stones)` and every `RECLAD_EVERY` (6) s adds one layer below the cap, returning `true` when it did; `CREATURE_HIT.kivihiisi`: frozen → cladding to 0 and the blow lands with `shatterBonus`; `clad > 0` → absorbed, one layer stripped, cue `wall-slam`; else an ordinary hit. `CLAD_MAX = 3`, `RECLAD_EVERY = 6`.

- [ ] **Step 1: Write the failing tests**

Append to `test/monsters.test.js`:

```js
describe('kivihiisi def', () => {
  const def = JSON.parse(fs.readFileSync(new URL('../renderer/data/monsters/kivihiisi.json', import.meta.url), 'utf8'))
  const index = JSON.parse(fs.readFileSync(new URL('../renderer/data/monsters/index.json', import.meta.url), 'utf8'))
  it('is a brain-driven quadruped with hooks, never a random spawn', () => {
    assert.match(def.name, /^[a-z0-9_]+$/)
    assert.equal(def.rig, 'quadruped')
    assert.equal(def.params.horns, true)
    assert.deepEqual(def.stats, { hp: 40, dmg: 3, speed: 45 })
    assert.notEqual(def.behavior.driver, 'hook', 'the ordinary brain chases and attacks')
    assert.equal(def.behavior.fleeHp, 0)
    assert.equal(def.spawn, null)
    assert.equal(def.hooks, true)
  })
  it('is listed in the index', () => { assert.ok(index.includes('kivihiisi')) })
})
```

(The file already has `import fs from 'node:fs'` at line 3.)

Create `test/kivihiisi.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ensureKivihiisi, tickClad, CLAD_MAX, RECLAD_EVERY } from '../renderer/systems/monsters/kivihiisi.js'
import { CREATURE_HIT, hurtCreature } from '../renderer/systems/creatures.js'
import { applyFreeze } from '../renderer/systems/status.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const mk = () => ({ type: 'kivihiisi', x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 40, maxHp: 40, damage: 3 })
const mkState = e => ({ entities: [e], feedback: makeFeedback(), sfx: makeSfx(), player: { x: 4, y: 5, px: 4 * S + 16, py: 5 * S + 16, hp: 10 } })

describe('lazy init', () => {
  it('stamps full cladding capped by the standing stones, and arms it', () => {
    const e = ensureKivihiisi(mk(), 6)
    assert.equal(e.clad, CLAD_MAX)
    assert.equal(e.weaponId, 'maul')
    const two = ensureKivihiisi(mk(), 2)
    assert.equal(two.clad, 2)
  })
  it('never re-stamps', () => {
    const e = ensureKivihiisi(mk(), 6)
    e.clad = 1
    ensureKivihiisi(e, 6)
    assert.equal(e.clad, 1)
  })
  it('registers its hit hook', () => { assert.equal(typeof CREATURE_HIT.kivihiisi, 'function') })
})

describe('cladding', () => {
  it('absorbs a hit and strips one layer while clad', () => {
    const e = ensureKivihiisi(mk(), 6)
    const r = hurtCreature(mkState(e), e, 9)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, 'wall-slam')
    assert.equal(e.hp, 40)
    assert.equal(e.clad, 2)
  })
  it('three hits strip it bare; the fourth lands', () => {
    const e = ensureKivihiisi(mk(), 6)
    const state = mkState(e)
    for (let i = 0; i < 3; i++) hurtCreature(state, e, 5)
    assert.equal(e.clad, 0)
    const r = hurtCreature(state, e, 5)
    assert.equal(r.absorbed, false)
    assert.equal(e.hp, 35)
  })
  it('a frozen Hiisi loses every layer on the next hit, which lands with the shatter bonus and thaws it', () => {
    const e = ensureKivihiisi(mk(), 6)
    applyFreeze(e, 2)
    const r = hurtCreature(mkState(e), e, 5)
    assert.equal(r.absorbed, false)
    assert.equal(e.clad, 0)
    assert.equal(e.hp, 40 - 5 - 2)
    assert.equal(e.frozen, false)
  })
  it('a killing blow records the kill', () => {
    const e = ensureKivihiisi(mk(), 0)
    const state = mkState(e)
    const r = hurtCreature(state, e, 99)
    assert.equal(r.killed, true)
    assert.equal(state.creatureKills.kivihiisi, true)
  })
})

describe('re-clad', () => {
  it('adds one layer every RECLAD_EVERY seconds, never above the standing stones', () => {
    const e = ensureKivihiisi(mk(), 6)
    e.clad = 0
    assert.equal(tickClad(e, RECLAD_EVERY - 0.1, 6), false)
    assert.equal(e.clad, 0)
    assert.equal(tickClad(e, 0.2, 6), true)
    assert.equal(e.clad, 1)
    for (let t = 0; t < RECLAD_EVERY * 5; t += 0.5) tickClad(e, 0.5, 2)
    assert.equal(e.clad, 2, 'capped by two standing stones')
  })
  it('zero stones means no cladding at all, and strips any it still wears', () => {
    const e = ensureKivihiisi(mk(), 6)
    tickClad(e, 0.1, 0)
    assert.equal(e.clad, 0)
    for (let t = 0; t < RECLAD_EVERY * 3; t += 0.5) tickClad(e, 0.5, 0)
    assert.equal(e.clad, 0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/monsters.test.js test/kivihiisi.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)|Error" | head`
Expected: `ENOENT` on the JSON; `ERR_MODULE_NOT_FOUND` on the hook.

- [ ] **Step 3: Implement**

`renderer/data/monsters/kivihiisi.json`:

```json
{
  "name": "kivihiisi",
  "rig": "quadruped",
  "params": { "bodyLength": 1.6, "bodyWidth": 1.8, "bulge": 0.5, "legLength": 0.3, "legThick": 0.45,
              "headSize": 0.9, "snout": 0.5, "eyeSize": 0.07, "horns": true,
              "tailLength": 0.1, "tailTaper": 0.3,
              "hideColor": "#6e6a63", "bellyColor": "#8f8a80", "eyeColor": "#e0b040", "scales": false,
              "gaitFreq": 4, "bob": 0.03 },
  "stats": { "hp": 40, "dmg": 3, "speed": 45 },
  "behavior": { "taxon": "beast", "sightRange": 320, "stopRange": 26, "fleeHp": 0, "wanderSpeed": 0 },
  "spawn": null,
  "hooks": true
}
```

Add `"kivihiisi"` to `renderer/data/monsters/index.json` (keep the list alphabetical: after `"hirvi"`).

`renderer/systems/monsters/kivihiisi.js`:

```js
// Kivihiisi, the Hiisi of the Pass — the Mountain Pass quest's boss
// (docs/superpowers/specs/2026-09-10-adventure-quests-design.md §4). The
// ordinary brain chases and swings; this hook owns only its stone cladding:
// `clad` layers (0-3) each eat one hit, and it re-clads a layer every
// RECLAD_EVERY seconds — never above the boulders still standing in the ring
// (the quest module passes that count). Mine the ring out and the fight is
// fair. Frozen, the rime takes every layer with it on the next blow.
// Pure — no browser/Electron imports.
import { CREATURE_HIT } from '../creatures.js'
import { shatterBonus } from '../status.js'

export const CLAD_MAX = 3
export const RECLAD_EVERY = 6   // s between layers

// A registry spawn arrives with only type/x/y/px/py/hp, so the first touch
// stamps the cladding and — the contract makeMonsterFromDef does not enforce
// — the weapon, without which enemy-attack.js could never land a hit.
export function ensureKivihiisi(e, stones = CLAD_MAX) {
  if (e.clad !== undefined) return e
  Object.assign(e, { clad: Math.min(CLAD_MAX, stones), recladT: 0, weaponId: 'maul' })
  return e
}

// Returns true when a layer went back on.
export function tickClad(e, delta, stones) {
  ensureKivihiisi(e, stones)
  const cap = Math.min(CLAD_MAX, stones)
  if (e.clad > cap) e.clad = cap
  e.recladT += delta
  if (e.recladT < RECLAD_EVERY) return false
  e.recladT = 0
  if (e.clad >= cap) return false
  e.clad++
  return true
}

CREATURE_HIT.kivihiisi = (e, state, dmg) => {
  ensureKivihiisi(e)
  if (e.frozen) {
    // shatterBonus clears `frozen` as it reads it — take it before the copy,
    // or the copy carries frozen: true back over hurtCreature's assign.
    const bonus = shatterBonus(e)
    e.clad = 0
    return { entity: { ...e, hp: e.hp - dmg - bonus, inCombat: true }, absorbed: false, cue: 'melee-hit' }
  }
  if (e.clad > 0) { e.clad--; return { entity: e, absorbed: true, cue: 'wall-slam' } }
  return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: 'melee-hit' }
}
```

- [ ] **Step 4: Run to verify green**

Run: `node --test test/monsters.test.js test/kivihiisi.test.js 2>&1 | grep -E "^    not ok|# (pass|fail)"` → `# fail 0`. Then `npm test` — the registry's own def-validation tests must accept the new JSON.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/monsters/kivihiisi.json renderer/data/monsters/index.json renderer/systems/monsters/kivihiisi.js test/monsters.test.js test/kivihiisi.test.js
git commit -m "feat: add the Kivihiisi and its stone cladding"
```

---

### Task 4: The `hiidenkiuas` POI

**Files:**
- Modify: `tools/static-overworld/gen-forest.mjs` (`autumn()`, after `b.poi('village', ..., 'hermit hut')` at line ~232)
- Regenerate: `tools/static-overworld/out/maps/forest-3-autumn.json`, `renderer/data/open-maps.js`
- Test: `test/adventure-quest-maps.test.js`

**Interfaces:**
- Produces: landmark POI `hiidenkiuas` at (38,30) on `OPEN_MAPS[12]`.

- [ ] **Step 1: Write the failing test**

Append to `test/adventure-quest-maps.test.js` (use literals now; switch to `KIUAS` and `RING` from `../renderer/systems/quests/pass.js` in Task 6):

```js
describe('the Mountain Pass hiidenkiuas', () => {
  const pass = OPEN_MAPS[12]
  const pp = label => pass.pois.find(p => p.label === label)
  const w = (x, y) => pass.walk[y]?.[x] === '1'
  it('is a landmark on walkable ground', () => {
    const k = pp('hiidenkiuas')
    assert.ok(k, 'missing hiidenkiuas')
    assert.equal(k.kind, 'landmark')
    assert.deepEqual({ x: k.x, y: k.y }, { x: 38, y: 30 })
    assert.ok(w(k.x, k.y))
  })
  it('its six ring cells are all walkable, so every boulder can be stamped and mined', () => {
    const k = pp('hiidenkiuas')
    for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [3, 3], [-3, -3], [3, -3]]) assert.ok(w(k.x + dx, k.y + dy), `${dx},${dy}`)
  })
  it('is not the stone circle, and leaves the mines and the hut alone', () => {
    assert.deepEqual({ x: pp('stone circle').x, y: pp('stone circle').y }, { x: 84, y: 22 })
    assert.equal(pass.pois.filter(p => p.kind === 'dungeon_entrance').length, 2)
    assert.equal(pass.pois.filter(p => p.kind === 'village' || p.kind === 'camp').length, 1)
  })
  it('takes no label a rite already claims', () => {
    const riteLabels = new Set((MAP_RITES[pass.name] ?? []).map(r => r.fromPoi))
    assert.equal(riteLabels.has('hiidenkiuas'), false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

`node --test test/adventure-quest-maps.test.js` → `missing hiidenkiuas`.

- [ ] **Step 3: Add the POI to the builder and regenerate**

In `gen-forest.mjs`'s `autumn()`, directly after the hermit-hut `b.poi('village', ...)` line:

```js
  // The Kivihiisi's hiidenkiuas (renderer/systems/quests/pass.js): a fixed,
  // verified-walkable bowl west of the pass, POI only — no terrain.
  b.poi('landmark', 38, 30, 'hiidenkiuas')
```

```bash
(cd tools/static-overworld && node gen-forest.mjs && node export-game-maps.mjs)
git diff --stat tools/static-overworld/out/maps/ renderer/data/open-maps.js
```

Expected: exactly `forest-3-autumn.json` and `open-maps.js`, one line each. Anything else changed → `git checkout -- tools/static-overworld/out/maps/ renderer/data/open-maps.js` and investigate before continuing (the generator is byte-reproducible; a drift means an unrelated edit).

- [ ] **Step 4: Run to verify green**

`node --test test/adventure-quest-maps.test.js` → `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add tools/static-overworld/gen-forest.mjs tools/static-overworld/out/maps/forest-3-autumn.json renderer/data/open-maps.js test/adventure-quest-maps.test.js
git commit -m "feat: add the hiidenkiuas to the Mountain Pass"
```

---

### Task 5: The quest declaration

**Files:**
- Modify: `renderer/data/quests.js`
- Test: `test/quests.test.js`

**Interfaces:**
- Produces: `QUESTS['forest-3-autumn'] = { title: 'Kivihiisi', villagerLines, rule: f => !!f.hiisi_dead }`. The hut's roster is `villager, elder, sheep, goat` — the spec's "hermit's line" is the hut's `villager`/`elder`; there is no `hermit` species on this map.

- [ ] **Step 1: Write the failing test**

Append to `test/quests.test.js`:

```js
describe('the Mountain Pass declaration', () => {
  const pass = OPEN_MAPS[12]
  const quest = QUESTS['forest-3-autumn']
  it('is found for depth 12 and is done only on hiisi_dead', () => {
    assert.equal(questFor(pass), quest)
    assert.equal(quest.title, 'Kivihiisi')
    assert.equal(quest.rule({ hiisi_woken: true, stones: 0 }), false)
    assert.equal(quest.rule({ hiisi_dead: true }), true)
  })
  it('stages the hut\'s lines: opening, woken, dead', () => {
    const open = questLines(quest, {})
    const woken = questLines(quest, { hiisi_woken: true })
    const dead = questLines(quest, { hiisi_dead: true })
    for (const s of [open, woken, dead]) { assert.ok(s.villager?.length); assert.ok(s.elder?.length) }
    assert.notDeepEqual(open, woken)
    assert.notDeepEqual(woken, dead)
    assert.match(open.elder.join(' '), /pick/i, 'the opening line says a pick opens the capstone')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `quest` undefined.

- [ ] **Step 3: Implement** — add to `QUESTS`:

```js
  'forest-3-autumn': {
    title: 'Kivihiisi',
    villagerLines: [
      { when: f => f.hiisi_dead, by: {
        villager: ['The goats came back on their own. They know.'],
        elder:    ["Ukko's own hammer. Do not swing it near the hut."],
      } },
      { when: f => f.hiisi_woken, by: {
        villager: ['You woke it? Then break its stones. It wears them.'],
        elder:    ['Every boulder standing round that oven is a skin it can put back on.'],
      } },
      { when: () => true, by: {
        villager: ["The goats are gone and the door is boarded. There is a hiidenkiuas west of the pass — a giant's oven."],
        elder:    ['Nothing but a pick opens that capstone. The old mines hand them out.'],
      } },
    ],
    rule: f => !!f.hiisi_dead,
  },
```

- [ ] **Step 4: Run to verify green** — `node --test test/quests.test.js` → `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add renderer/data/quests.js test/quests.test.js
git commit -m "feat: declare Kivihiisi, the Mountain Pass quest"
```

---

### Task 6: The Pass module — the arena, from flags

**Files:**
- Create: `renderer/systems/quests/pass.js`
- Test: `test/quest-pass.test.js` (create)

**Interfaces:**
- Consumes: `poiCell` from `../quests.js`; `markTileDirty`; `TILE`, `weaponContents` from `../entities.js`; `ensureKivihiisi`, `tickClad` from `../monsters/kivihiisi.js`; `queueToast`, `think`; `sfx`.
- Produces: `KIUAS = 'hiidenkiuas'`, `RING` (six `[dx, dy]`), `RING_STONES = 6`, `CAPSTONE = 'ow_mtn_rock_0'`, `HAMMER = 'ukonvasara'`, `FOUND_TILES = 6`, `stampBoulder(map, cell, skin)`, `onArrive(ctx)`, `tick(ctx, delta)`. Flags: `kiuas_found`, `hiisi_woken`, `stones` (6 → 0, absent means 6), `hiisi_dead`. Per-visit fields on the ctx: `ctx.ringStamped` (how many ring cells this visit stamped), `ctx.ringCounted` (a `Set` of ring indices already subtracted).

- [ ] **Step 1: Write the failing tests**

Create `test/quest-pass.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { onArrive, tick, KIUAS, RING, RING_STONES, CAPSTONE, HAMMER, stampBoulder } from '../renderer/systems/quests/pass.js'
import { makeQuestCtx, questFlags } from '../renderer/systems/quests.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { ensureKivihiisi, CLAD_MAX } from '../renderer/systems/monsters/kivihiisi.js'
import { harvest } from '../renderer/systems/lumber.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE, weaponContents } from '../renderer/systems/entities.js'
import { itemFromContents } from '../renderer/systems/inventory.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const N = 40
const KC = { x: 20, y: 20 }
const HUT = { x: 5, y: 5 }
const PICK = { weaponType: 'pick', name: 'Pick', damage: 2, mine: 3 }

const mapData = {
  name: 'forest-3-autumn', w: N, h: N,
  pois: [{ kind: 'village', x: HUT.x, y: HUT.y, label: 'hermit hut' }, { kind: 'landmark', x: KC.x, y: KC.y, label: KIUAS }],
  npcs: { village: ['villager', 'elder'], wild: [] },
}

function makeMap() {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) { map[y][x].tile = TILE.FLOOR; map[y][x].skin = 'ow_mtn_ground_0' }
  return map
}

function spawnInto(state) {
  return spawns => {
    for (const s of spawns) {
      if (s.kind === 'kivihiisi') state.entities.push({ type: 'kivihiisi', x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16, hp: 40, maxHp: 40, damage: 3 })
      else if (s.kind === 'floating_pickup') state.entities.push({ type: 'floating_item', contents: s.contents, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16, progress: 1 })
    }
  }
}

function build({ flags = {}, at = HUT, inventory = [], entities = [], weapon = null } = {}) {
  const save = normalizeAdventureSave(null)
  Object.assign(questFlags(save, mapData.name), flags)
  const state = {
    map: makeMap(), entities: [...entities], feedback: makeFeedback(), sfx: makeSfx(),
    player: { x: at.x, y: at.y, px: at.x * S + 16, py: at.y * S + 16, hp: 10, talents: [], inventory, maxInventory: 10, weapon },
  }
  const calls = { persist: 0, refreshInventory: 0, flags: [] }
  const ctx = makeQuestCtx({
    getState: () => state, save, mapData,
    persist: () => { calls.persist++ }, refreshInventory: () => { calls.refreshInventory++ },
    spawn: spawnInto(state), onFlag: f => calls.flags.push(f),
  })
  return { ctx, state, save, calls }
}

const ringCell = i => ({ x: KC.x + RING[i][0], y: KC.y + RING[i][1] })
const cellAt = (state, c) => state.map[c.y][c.x]
const isBoulder = cell => cell.tile === TILE.WALL && String(cell.overlay).startsWith('ow_mtn_rock_')
const boulders = state => RING.map((_, i) => isBoulder(cellAt(state, ringCell(i)))).filter(Boolean).length
const hiisiOf = state => state.entities.find(e => e.type === 'kivihiisi') ?? null
const hammerOf = state => state.entities.find(e => e.type === 'floating_item' && e.contents?.weaponType === HAMMER) ?? null
// Mines a cell to the ground the way game.js does: repeated harvest() swings with a pick.
const mineOut = (state, c) => { for (let i = 0; i < 5; i++) harvest(state.map, c.x, c.y, PICK) }

describe('stampBoulder', () => {
  it('makes a mineable WALL boulder that clearRock can take back down', () => {
    const { state } = build()
    stampBoulder(state.map, ringCell(0), 'ow_mtn_rock_2')
    assert.ok(isBoulder(cellAt(state, ringCell(0))))
    mineOut(state, ringCell(0))
    assert.equal(cellAt(state, ringCell(0)).tile, TILE.FLOOR)
    assert.equal(cellAt(state, ringCell(0)).cleared, 'rock')
  })
})

describe('arrival stamps the arena from the flags', () => {
  it('a fresh map: the capstone on the kiuas and all six ring boulders, no Hiisi', () => {
    const { ctx, state } = build()
    onArrive(ctx)
    assert.equal(cellAt(state, KC).overlay, CAPSTONE)
    assert.equal(cellAt(state, KC).tile, TILE.WALL)
    assert.equal(boulders(state), RING_STONES)
    assert.equal(hiisiOf(state), null)
  })
  it('is idempotent', () => {
    const { ctx, state } = build()
    onArrive(ctx); onArrive(ctx)
    assert.equal(boulders(state), RING_STONES)
  })
  it('honours stones: only that many ring boulders come back', () => {
    const { ctx, state } = build({ flags: { hiisi_woken: true, stones: 2 } })
    onArrive(ctx)
    assert.equal(boulders(state), 2)
    assert.notEqual(cellAt(state, KC).overlay, CAPSTONE, 'no capstone once woken')
  })
  it('a woken Hiisi is re-spawned at the kiuas with cladding capped by stones, armed', () => {
    const { ctx, state } = build({ flags: { hiisi_woken: true, stones: 1 } })
    onArrive(ctx)
    const h = hiisiOf(state)
    assert.deepEqual({ x: h.x, y: h.y }, KC)
    assert.equal(h.clad, 1)
    assert.equal(h.weaponId, 'maul')
    onArrive(ctx)
    assert.equal(state.entities.filter(e => e.type === 'kivihiisi').length, 1, 'never doubled')
  })
  it('after the kill: no arena changes, the hammer waits at the kiuas unless carried', () => {
    const { ctx, state } = build({ flags: { hiisi_dead: true } })
    onArrive(ctx)
    assert.equal(hiisiOf(state), null)
    assert.deepEqual({ x: hammerOf(state).x, y: hammerOf(state).y }, KC)
    assert.equal(itemFromContents(hammerOf(state).contents)?.payload?.weaponType, HAMMER)
    onArrive(ctx)
    assert.equal(state.entities.filter(e => e.type === 'floating_item').length, 1)
    const held = build({ flags: { hiisi_dead: true }, weapon: weaponContents(HAMMER) })
    onArrive(held.ctx)
    assert.equal(hammerOf(held.state), null)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `ERR_MODULE_NOT_FOUND` for `pass.js`.

- [ ] **Step 3: Create the module — arrival only**

`renderer/systems/quests/pass.js`:

```js
// Kivihiisi, the Hiisi of the Pass — the Mountain Pass quest (docs/superpowers/
// specs/2026-09-10-adventure-quests-design.md §4). A giant's oven west of the
// pass, capped with a boulder and ringed with six more; mine the capstone and
// the thing under it gets up, wearing the ring as its skin. The creature's own
// cladding lives in systems/monsters/kivihiisi.js; this module owns the story:
// the arena, the standing-boulder count, the wake, the kill and the hammer.
//
// `stones` (a flag, 6 down to 0) is the truth about the ring, not the map: a
// module-stamped boulder is not in the map JSON, so applyFelled cannot restore
// its cleared state on the next build. onArrive re-stamps exactly `stones`
// boulders; the mined ones stay mined by count.
// onArrive is idempotent and does not run on a cave return (game.js gates the
// tick on !state.cave). Pure — no browser/Electron imports.
import { poiCell } from '../quests.js'
import { markTileDirty } from '../tile-dirty.js'
import { TILE, weaponContents } from '../entities.js'
import { ensureKivihiisi, tickClad } from '../monsters/kivihiisi.js'
import { queueToast, think } from '../feedback.js'
import { sfx } from '../sfx.js'

export const KIUAS = 'hiidenkiuas'
// Six fixed cells at radius 3 — all walkable on the real map, none on the
// mountain to the north (38,27 is a mass cell).
export const RING = [[3, 0], [-3, 0], [0, 3], [3, 3], [-3, -3], [3, -3]]
export const RING_STONES = RING.length
export const CAPSTONE = 'ow_mtn_rock_0'
export const HAMMER = 'ukonvasara'
export const FOUND_TILES = 6     // Chebyshev tiles: how close reads the oven

const S = 32
const centre = c => ({ px: c.x * S + S / 2, py: c.y * S + S / 2 })
const boulderSkin = i => `ow_mtn_rock_${(i + 1) % 6}`   // the ring never reuses the capstone's skin
const stonesOf = flags => flags.stones ?? RING_STONES
const ringCell = (kiuas, i) => ({ x: kiuas.x + RING[i][0], y: kiuas.y + RING[i][1] })
const isBoulder = cell => typeof cell?.overlay === 'string' && cell.overlay.startsWith('ow_mtn_rock_')
const hiisiOf = state => state.entities.find(e => e.type === 'kivihiisi') ?? null
const hasHammer = player => player.weapon?.weaponType === HAMMER || player.inventory.some(i => i.kind === 'weapon' && i.payload?.weaponType === HAMMER)
const hammerOnGround = state => state.entities.some(e => e.type === 'floating_item' && e.contents?.weaponType === HAMMER)

// An ordinary Mountain Pass boulder: blocked, mineable by HARVEST (tool
// 'mine'), cleared by clearRock. Any leftover `cleared`/`chopHp` from an
// earlier mining of this cell is wiped so it counts as standing again.
export function stampBoulder(map, c, skin) {
  const cell = map[c.y]?.[c.x]
  if (!cell) return
  cell.tile = TILE.WALL
  cell.overlay = skin
  delete cell.cleared
  delete cell.chopHp
  markTileDirty(map, c.x, c.y)
}

function stampArena(ctx) {
  const { state, flags } = ctx
  const kiuas = poiCell(ctx.mapData, KIUAS)
  if (!kiuas) return
  if (!flags.hiisi_woken && !isBoulder(state.map[kiuas.y]?.[kiuas.x])) stampBoulder(state.map, kiuas, CAPSTONE)
  const n = stonesOf(flags)
  for (let i = 0; i < n; i++) {
    const c = ringCell(kiuas, i)
    if (!isBoulder(state.map[c.y]?.[c.x])) stampBoulder(state.map, c, boulderSkin(i))
  }
  ctx.ringStamped = n
  ctx.ringCounted = new Set()
}

function spawnHiisi(ctx) {
  const { state, flags } = ctx
  if (hiisiOf(state)) return
  const kiuas = poiCell(ctx.mapData, KIUAS)
  if (!kiuas) return
  ctx.spawn([{ kind: 'kivihiisi', x: kiuas.x, y: kiuas.y }])
  const h = hiisiOf(state)
  if (h) ensureKivihiisi(h, stonesOf(flags))
}

// The hammer falls where the Hiisi fell (`at`); the kiuas is the fallback for
// a re-drop on arrival after it was lost. Never duplicated.
function dropHammer(ctx, at = null) {
  const { state } = ctx
  if (hasHammer(state.player) || hammerOnGround(state)) return
  at ??= poiCell(ctx.mapData, KIUAS)
  if (at) ctx.spawn([{ kind: 'floating_pickup', contents: { type: 'weapon', ...weaponContents(HAMMER) }, x: at.x, y: at.y }])
}

export function onArrive(ctx) {
  const { flags } = ctx
  if (flags.hiisi_dead) { dropHammer(ctx); return }
  stampArena(ctx)
  if (flags.hiisi_woken) spawnHiisi(ctx)
}

export function tick(ctx, delta) {}
```

- [ ] **Step 4: Run to verify green** — `node --test test/quest-pass.test.js` → `# fail 0`.

- [ ] **Step 5: Switch the map test to the module's constants and commit**

In `test/adventure-quest-maps.test.js` replace the `'hiidenkiuas'` literal and the inline ring array from Task 4 with `KIUAS` and `RING` imported from `../renderer/systems/quests/pass.js`. Green.

```bash
git add renderer/systems/quests/pass.js test/quest-pass.test.js test/adventure-quest-maps.test.js
git commit -m "feat: add the Mountain Pass module — the kiuas arena stamped from flags"
```

---

### Task 7: The wake, the stones, the kill

**Files:**
- Modify: `renderer/systems/quests/pass.js` (`tick`)
- Test: `test/quest-pass.test.js`

**Interfaces:**
- Produces: within `FOUND_TILES` of the kiuas, `kiuas_found` and a thought, once; the capstone cell mined (`cleared === 'rock'`) → `hiisi_woken`, the Hiisi spawned and armed, `erupt`, a toast; a mined ring cell decrements `stones` once (thought per stone); `tickClad` runs every tick against `stones`; `creatureKills.kivihiisi` → `hiisi_dead`, the hammer at the corpse, a toast.

- [ ] **Step 1: Write the failing tests**

Append to `test/quest-pass.test.js`:

```js
const moveTo = (state, c) => { state.player.x = c.x; state.player.y = c.y; state.player.px = c.x * S + 16; state.player.py = c.y * S + 16 }

describe('the wake', () => {
  it('coming near the oven marks it found, once', () => {
    const { ctx, state, save, calls } = build()
    onArrive(ctx)
    moveTo(state, { x: KC.x - 4, y: KC.y })
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).kiuas_found, true)
    const n = calls.persist
    tick(ctx, 0.1)
    assert.equal(calls.persist, n)
  })
  it('mining the capstone wakes the Hiisi at the kiuas, armed and fully clad, with a toast', () => {
    const { ctx, state, save } = build()
    onArrive(ctx)
    mineOut(state, KC)
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).hiisi_woken, true)
    const h = hiisiOf(state)
    assert.deepEqual({ x: h.x, y: h.y }, KC)
    assert.equal(h.clad, CLAD_MAX)
    assert.equal(h.weaponId, 'maul')
    assert.equal(state.feedback.toasts.length, 1)
    assert.ok(state.sfx.cues.some(c => c.name === 'erupt'))
  })
  it('a standing capstone wakes nothing', () => {
    const { ctx, state, save } = build()
    onArrive(ctx)
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).hiisi_woken, undefined)
    assert.equal(hiisiOf(state), null)
  })
})

describe('the standing stones', () => {
  it('a mined ring boulder comes off the count, once', () => {
    const { ctx, state, save, calls } = build({ flags: { hiisi_woken: true } })
    onArrive(ctx)
    mineOut(state, ringCell(2))
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).stones, 5)
    const n = calls.persist
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).stones, 5)
    assert.equal(calls.persist, n)
  })
  it('the Hiisi cannot wear more stone than stands; mine the ring out and it wears none', () => {
    const { ctx, state, save } = build({ flags: { hiisi_woken: true } })
    onArrive(ctx)
    const h = hiisiOf(state)
    assert.equal(h.clad, 3)
    for (let i = 0; i < RING_STONES; i++) mineOut(state, ringCell(i))
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).stones, 0)
    assert.equal(h.clad, 0)
    for (let t = 0; t < 30; t += 0.5) tick(ctx, 0.5)
    assert.equal(h.clad, 0, 'no re-clad with nothing standing')
  })
  it('re-clads a layer every six seconds while stones stand', () => {
    const { ctx, state } = build({ flags: { hiisi_woken: true } })
    onArrive(ctx)
    const h = hiisiOf(state)
    h.clad = 0
    for (let t = 0; t < 6.5; t += 0.5) tick(ctx, 0.5)
    assert.equal(h.clad, 1)
  })
})

describe('the kill and the hammer', () => {
  it('a recorded kill sets the flag, drops the hammer where the Hiisi fell, and toasts — once', () => {
    const { ctx, state, save, calls } = build({ flags: { hiisi_woken: true, stones: 0 } })
    onArrive(ctx)
    const h = hiisiOf(state)
    h.x = KC.x + 5; h.y = KC.y + 1; h.px = h.x * S + 16; h.py = h.y * S + 16   // kited off the oven
    h.hp = 0; h.dying = 0.7
    state.creatureKills = { kivihiisi: true }
    tick(ctx, 0.1)
    assert.equal(questFlags(save, mapData.name).hiisi_dead, true)
    assert.deepEqual({ x: hammerOf(state).x, y: hammerOf(state).y }, { x: KC.x + 5, y: KC.y + 1 })
    assert.equal(state.feedback.toasts.length, 1)
    const n = calls.persist
    tick(ctx, 0.1)
    assert.equal(calls.persist, n)
  })
  it('a finished quest ticks quietly', () => {
    const { ctx, calls } = build({ flags: { hiisi_dead: true } })
    tick(ctx, 0.1)
    assert.equal(calls.persist, 0)
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `tick` is a no-op: `kiuas_found` undefined, no Hiisi, `stones` undefined, `hiisi_dead` undefined.

- [ ] **Step 3: Implement `tick`**

Replace `export function tick(ctx, delta) {}` in `pass.js`:

```js
export function tick(ctx, delta) {
  const { state, flags } = ctx
  if (flags.hiisi_dead) return
  const kiuas = poiCell(ctx.mapData, KIUAS)
  if (!kiuas) return

  // creatureKills is per-visit; the flag is the durable record.
  if (state.creatureKills?.kivihiisi) {
    ctx.set('hiisi_dead')
    const corpse = hiisiOf(state)   // still here this frame, dying; the hammer falls where it fell
    dropHammer(ctx, corpse && { x: corpse.x, y: corpse.y })
    queueToast(state, { title: 'The Hiisi is down', lines: ["Ukko's own hammer lay under the oven.", 'Take it.'] })
    ctx.persist()
    return
  }

  if (!flags.hiisi_woken) {
    const near = Math.max(Math.abs(kiuas.x - state.player.x), Math.abs(kiuas.y - state.player.y)) <= FOUND_TILES
    if (near && !flags.kiuas_found) {
      ctx.set('kiuas_found')
      think(state, "A giant's oven. Something breathes under the capstone.")
      ctx.persist()
    }
    if (state.map[kiuas.y]?.[kiuas.x]?.cleared !== 'rock') return
    ctx.set('hiisi_woken')
    spawnHiisi(ctx)
    sfx(state, 'erupt', centre(kiuas))
    queueToast(state, { title: 'Kivihiisi', lines: ['The oven was its bed.', 'Its skin is the stones around you.'] })
    ctx.persist()
    return
  }

  // Standing boulders: a mined ring cell comes off the count, once per cell
  // per visit. The stamped indices are this visit's, not `stones` (which
  // shrinks as they fall).
  ctx.ringCounted ??= new Set()
  for (let i = 0; i < (ctx.ringStamped ?? 0); i++) {
    if (ctx.ringCounted.has(i)) continue
    if (state.map[ringCell(kiuas, i).y]?.[ringCell(kiuas, i).x]?.cleared !== 'rock') continue
    ctx.ringCounted.add(i)
    ctx.set('stones', Math.max(0, stonesOf(flags) - 1))
    think(state, flags.stones === 0 ? 'Nothing left for it to hide in.' : 'One less stone for its skin.')
    ctx.persist()
  }

  const h = hiisiOf(state)
  if (h && tickClad(h, delta, stonesOf(flags))) sfx(state, 'wall-slam', { px: h.px, py: h.py })
}
```

- [ ] **Step 4: Run to verify green, then the suite** — `node --test test/quest-pass.test.js` → `# fail 0`; `npm test` green.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/quests/pass.js test/quest-pass.test.js
git commit -m "feat: wake the Kivihiisi, count its stones, and drop Ukonvasara where it falls"
```

---

### Task 8: Wire it in and see it run

**Files:**
- Modify: `renderer/systems/quests/index.js`
- Test: `test/quests.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/quests.test.js`:

```js
it('the Mountain Pass has a registered module with onArrive and tick', () => {
  const m = QUEST_MODULES['forest-3-autumn']
  assert.equal(typeof m?.onArrive, 'function')
  assert.equal(typeof m?.tick, 'function')
})
```

- [ ] **Step 2: Run to verify it fails** — `m` undefined.

- [ ] **Step 3: Register**

```js
import { onArrive as passArrive, tick as passTick } from './pass.js'
// ...
  'forest-3-autumn':    { onArrive: passArrive,      tick: passTick },
```

- [ ] **Step 4: `npm test` green, then a short live check**

Same driver recipe as slice 2's Task 8 (`--dcdebug` copy of the driver, deleted after; `git status --porcelain renderer/data/` clean).

1. Title → `level12`. `eval`: `state.map[30][38].overlay === 'ow_mtn_rock_0'` and `.tile === 1`; six ring cells at the `RING` offsets are boulders. Screenshot the bowl.
2. Give a pick: `state.player.weapon = { weaponType: 'pick', name: 'Pick', damage: 2, mine: 3 }`; teleport beside the capstone (39,30), face west, `press Space` twice → `flags.hiisi_woken === true`, a `kivihiisi` entity at 38,30 with `clad: 3`, `weaponId: 'maul'`, the toast.
3. `player.invulnTimer = 99999`. Swing at it: three `wall-slam` cues and `clad` 3→0 with hp 40 unchanged; the fourth swing takes hp. Wait ≥ 6 s: `clad` is 1 again.
4. Mine two ring boulders → `flags.stones === 4`; mine all six → `stones === 0` and `clad` stays 0 through a 10 s wait.
5. `eval` `state.entities.find(e=>e.type==='kivihiisi').hp = 1`, one swing → `hiisi_dead`, a `floating_item` with `weaponType: 'ukonvasara'` at the corpse cell, the toast.
6. Walk onto it: with Might it equips; swing at any enemy (spawn a `guard` beside you via `state.entities.push(...)` if none is near) → `state.lightning` gains one mark, `crackle` then `thunder`, a 3×3 strike; a second swing inside 4 s marks nothing.
7. Reload → `level12`: the ring re-stamped to `stones`, the hammer not duplicated, the hut's villager on the resolved line.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/quests/index.js test/quests.test.js
git commit -m "feat: run Kivihiisi on the Mountain Pass"
```

---

## Notes for whoever executes this

- **The ring's positions shuffle after a re-arrival; the count does not.** `onArrive` stamps the first `stones` ring indices whatever was mined before. That is the spec's choice ("the count is the truth") — do not try to persist which cells were mined.
- **`weaponId` is stamped by `ensureKivihiisi`, and the quest module calls it right after `ctx.spawn`.** A Hiisi that chases and never swings means that call was skipped.
- **The frozen branch takes `shatterBonus(e)` before building the entity copy.** `shatterBonus` clears `e.frozen` as it reads it; a copy taken first would carry `frozen: true` back over `hurtCreature`'s `Object.assign`.
- **The hammer's strike is marked even on an absorbed (clad) hit**, on purpose; the strike's own damage goes back through the cladding hook.
- **`game.js` (Task 2) has no unit seam.** Keep it a mirror of the Maunonmiekka hook beside it and prove it in the live check.
- **The spec calls the hut's speaker "the hermit".** The depth-12 roster is `villager, elder, sheep, goat`; there is no `hermit` species there. Lines are keyed on `villager` and `elder`.
- **`npm test` occasionally dies with a lone SIGSEGV while every test passes.** Node's runner on this WSL box, ~1 run in 12. Re-run.
