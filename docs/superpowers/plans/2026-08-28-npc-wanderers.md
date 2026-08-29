# NPC Wanderers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Villagers and animals wander the three forest Adventure maps, react to the F/blue button, flee or fight back when hit, provoke village-wide wrath, and reset on player death.

**Architecture:** A new `npc` entity type driven by a priority list of goals (`renderer/systems/npc.js`); every goal emits a movement intent that the existing `act()` executes. Hostile NPCs delegate to the existing enemy brain and melee-attack framework and satisfy `isEnemy`. Spawns are sampled in `openmap.js` from a per-map `npcs` population; dead/hostile state lives in adventure save v4 and is wiped on player death.

**Tech Stack:** Vanilla JS ES modules (no bundler), Electron renderer, `node:test` + `node:assert/strict`, `playwright-core` for the runtime check.

**Spec:** `docs/superpowers/specs/2026-08-28-npc-wanderers-design.md`

## Global Constraints

- Vanilla JS ESM under `renderer/`; **no new npm dependencies**. Systems under `renderer/systems/` and data under `renderer/data/` must stay DOM/canvas-free so `node --test` can import them.
- Tile size is 32 px (`S = 32`); entity pixel centre is `px = x * 32 + 16`.
- Only the forest maps (depths 7, 8, 9) get NPCs. Dungeon Rush and caves are untouched.
- No emoji icons in UI; sprites are atlas PNGs under `renderer/assets/tiles/` (see the `ui-feedback-design-philosophy` memory).
- `renderer/data/open-maps.js` is **generated** — never hand-edit; change `tools/static-overworld/export-game-maps.mjs` and run `node export-game-maps.mjs` from that directory.
- Run the full suite with `npm test` (= `node --test test/`) before every commit; everything must stay green.
- Commit after every task. Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0145GUz8i7BMgPBG97pbMtge
  ```

---

## File map

| File | Responsibility |
|---|---|
| `renderer/data/npcs.js` (new) | `NPC_SPECIES` table — stats, goals, lines, sprites |
| `renderer/data/enemy-ai.js` | `npc` row: merge species speed/fleeHp into the AI config |
| `renderer/systems/npc.js` (new) | `makeNpc`, `GOALS`, `updateNpc`, `onNpcHit`, `interactNpc`, timing constants |
| `renderer/systems/openmap.js` | `npcSpawnsForMap` sampling; `buildOpenMap(data, opts)` emits them |
| `renderer/systems/adventure.js` | save v4 `npcs` field; `npcRecordFor` helper |
| `renderer/systems/enemy-attack.js` | `fists` weapon, `npc: 'fists'` |
| `renderer/systems/fire.js`, `shockwave.js` | admit `npc` to the hittable sets |
| `renderer/systems/feedback.js` | `speakFrom(state, entity, text)` — bubble with `anchorId` |
| `renderer/systems/sfx.js`, `renderer/render/audio.js` | `npc-*` cues + recipes |
| `renderer/systems/map.js` | `generateLevel` passes `npcs` opts through to `buildOpenMap` |
| `renderer/game.js` | `case 'npc'`, `isHittable`, damage sites, update loop, F-key branch, persistence, death reset |
| `renderer/render/canvas.js` | `npc` draw branch, anchored bubble |
| `renderer/render/sprites.js` | `npc_*` entries |
| `tools/png-write.mjs` (new) | minimal PNG encoder for the sprite tools |
| `tools/npc-placeholders.mjs` (new) | draws 16×16 placeholder `npc_chicken.png` / `npc_deer.png` |
| `tools/extract-npc-sprites.mjs` (new) | crops Tiny Creatures cells into `npc_*.png` when the zip is present |
| `tools/static-overworld/export-game-maps.mjs` | per-map `npcs` population |
| `test/npcs-data.test.js`, `test/npc.test.js`, `test/openmap.test.js`, `test/adventure.test.js`, `test/enemy-attack.test.js`, `test/feedback.test.js`, `test/sfx.test.js` | tests |

---

### Task 1: Species table and AI config row

**Files:**
- Create: `renderer/data/npcs.js`
- Modify: `renderer/data/enemy-ai.js`
- Test: `test/npcs-data.test.js`, `test/enemy-ai.test.js`

**Interfaces:**
- Produces: `NPC_SPECIES[name]` with fields `faction, sprite, walker?, hp, onHit, fleeHp, speed, wanderSpeed, roam, startle?, react?, priorities, lines?`; `getAIConfig({ type: 'npc', species })` returns `{ speed, wanderSpeed, fleeHp, half: 4, sightRange: 200, stopRange: 20, taxon }`.

- [ ] **Step 1: Write the failing tests**

`test/npcs-data.test.js`:
```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NPC_SPECIES } from '../renderer/data/npcs.js'

const GOAL_NAMES = new Set(['flee_hurt', 'attack_hostile', 'startle', 'go_to', 'wander'])

describe('NPC_SPECIES', () => {
  it('defines the five first-iteration species', () => {
    assert.deepEqual(Object.keys(NPC_SPECIES).sort(), ['chicken', 'deer', 'elder', 'mouse', 'villager'])
  })

  it('every species has the fields the goal loop reads', () => {
    for (const [name, s] of Object.entries(NPC_SPECIES)) {
      assert.ok(['village', 'wild'].includes(s.faction), `${name} faction`)
      assert.ok(['fight', 'flee'].includes(s.onHit), `${name} onHit`)
      assert.ok(s.hp >= 1 && s.speed > 0 && s.wanderSpeed > 0 && s.roam >= 1, `${name} numbers`)
      assert.ok(s.fleeHp >= 0 && s.fleeHp <= 1, `${name} fleeHp`)
      assert.ok(typeof s.sprite === 'string', `${name} sprite`)
      assert.ok(s.priorities.length && s.priorities.at(-1) === 'wander', `${name} ends in wander`)
      for (const g of s.priorities) assert.ok(GOAL_NAMES.has(g), `${name} goal ${g}`)
    }
  })

  it('villagers speak, animals react', () => {
    for (const s of Object.values(NPC_SPECIES)) {
      if (s.faction === 'village') assert.ok(s.lines.length >= 2 && s.walker === true)
      else assert.ok(s.startle > 0 && ['hop', 'bolt', 'scurry'].includes(s.react))
    }
  })

  it('fight species have attack_hostile in their list; flee species do not', () => {
    for (const s of Object.values(NPC_SPECIES))
      assert.equal(s.priorities.includes('attack_hostile'), s.onHit === 'fight')
  })
})
```

Append to `test/enemy-ai.test.js` inside the `describe('getAIConfig')` block:
```js
  it('npc rows merge the species speed and fleeHp', () => {
    const c = getAIConfig({ type: 'npc', species: 'villager' })
    assert.equal(c.speed, 70)
    assert.equal(c.wanderSpeed, 40)
    assert.equal(c.fleeHp, 0.3)
    assert.equal(c.half, 4)
    assert.equal(c.taxon, 'humanoid')
    assert.equal(getAIConfig({ type: 'npc', species: 'deer' }).speed, 130)
    assert.equal(getAIConfig({ type: 'npc', species: 'deer' }).fleeHp, 1)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/npcs-data.test.js test/enemy-ai.test.js`
Expected: FAIL — `Cannot find module '.../renderer/data/npcs.js'` and the npc row assertion.

- [ ] **Step 3: Write `renderer/data/npcs.js`**

```js
// Friendly-creature species (data, not code). Consumed by systems/npc.js.
//   faction     'village' shares wrath: hurt one, every fight-capable villager on
//               the map turns hostile. 'wild' animals are each for themselves.
//   onHit       'fight' -> hostile; 'flee' -> timed flee.
//   fleeHp      hp fraction at/below which flee_hurt may take over (1 = any hit).
//   roam        tiles from the home tile that wander may pick points in.
//   startle     px radius at which a wild animal bolts even if untouched.
//   react       what the interact button does to an animal (villagers speak).
//   walker      draw through drawWalker + tickWalk (humanoids).
//   priorities  ordered goal names; first goal whose `when` holds runs.
export const NPC_SPECIES = {
  villager: {
    faction: 'village', sprite: 'npc_villager', walker: true,
    hp: 3, onHit: 'fight', fleeHp: 0.3,
    speed: 70, wanderSpeed: 40, roam: 6,
    priorities: ['flee_hurt', 'attack_hostile', 'go_to', 'wander'],
    lines: ['Fine weather for it.', 'Mind the caves, stranger.', 'Aspengrove keeps to itself.', 'Lost something? Check the caches.'],
  },
  elder: {
    faction: 'village', sprite: 'npc_elder', walker: true,
    hp: 2, onHit: 'flee', fleeHp: 1,
    speed: 50, wanderSpeed: 25, roam: 3,
    priorities: ['flee_hurt', 'go_to', 'wander'],
    lines: ['These woods were older than the village once.', 'Rest a while, traveller.', 'The mushrooms hum at dusk.'],
  },
  chicken: {
    faction: 'wild', sprite: 'npc_chicken',
    hp: 1, onHit: 'flee', fleeHp: 1, startle: 48, react: 'hop',
    speed: 90, wanderSpeed: 30, roam: 3,
    priorities: ['flee_hurt', 'startle', 'go_to', 'wander'],
  },
  deer: {
    faction: 'wild', sprite: 'npc_deer',
    hp: 2, onHit: 'flee', fleeHp: 1, startle: 96, react: 'bolt',
    speed: 130, wanderSpeed: 35, roam: 8,
    priorities: ['flee_hurt', 'startle', 'go_to', 'wander'],
  },
  mouse: {
    faction: 'wild', sprite: 'npc_mouse',
    hp: 1, onHit: 'flee', fleeHp: 1, startle: 40, react: 'scurry',
    speed: 110, wanderSpeed: 40, roam: 4,
    priorities: ['flee_hurt', 'startle', 'go_to', 'wander'],
  },
}
```

- [ ] **Step 4: Add the `npc` row to `renderer/data/enemy-ai.js`**

Add the import at the top and the row + merge:
```js
import { NPC_SPECIES } from './npcs.js'
```
In `BASE`, after `cyclops`:
```js
  // npc: speed/wanderSpeed/fleeHp come from the species (see getAIConfig)
  npc:         { taxon: 'humanoid', speed: 70, wanderSpeed: 40, half: 4,  sightRange: 200, stopRange: 20 },
```
Replace the body of `getAIConfig` with:
```js
export function getAIConfig(e) {
  const base = BASE[e.type] ?? BASE.monster
  let merged = e.type === 'monster' ? { ...base, ...(VARIANTS[e.variant] ?? {}) } : { ...base }
  if (e.type === 'npc') {
    const sp = NPC_SPECIES[e.species]
    if (sp) merged = { ...merged, speed: sp.speed, wanderSpeed: sp.wanderSpeed, fleeHp: sp.fleeHp,
                       taxon: sp.walker ? 'humanoid' : 'mammal' }
  }
  if (merged.fleeHp === undefined) merged.fleeHp = fleeDefault(merged.taxon)
  return merged
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/npcs-data.test.js test/enemy-ai.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add renderer/data/npcs.js renderer/data/enemy-ai.js test/npcs-data.test.js test/enemy-ai.test.js
git commit -m "feat(npc): species table and AI config row"
```

---

### Task 2: NPC core — `makeNpc`, goal loop, `wander`, `go_to`

**Files:**
- Create: `renderer/systems/npc.js`
- Test: `test/npc.test.js`

**Interfaces:**
- Consumes: `NPC_SPECIES` (Task 1); `act`, `buildNavGrid`, `findPath`, `passable`, `nearestPassable`, `hasLineOfSight`, `getAIConfig`.
- Produces:
  - `makeNpc({ species, id, x, y, hostile })` → entity `{ type: 'npc', species, id, faction, x, y, px, py, hp, maxHp, hostile, home: {x,y}, objective: null, facing: 'east', inCombat: false, damageCooldown: 0, aiHalf: 4, ai: { current: null, goals: {}, fleeTimer: 0, startleTimer: 0, reactTimer: 0 } }`
  - `GOALS` registry: `{ [name]: { when(e, ctx), enter?(e, ctx), run(e, ctx, delta) → intent } }`
  - `buildCtx(e, state, delta)` → `{ state, delta, def, cfg, playerDist, canSeePlayer, hpFrac }`
  - `selectGoal(e, ctx)` → goal name (runs `enter` on change)
  - `updateNpc(e, state, delta)` → runs the goal and `act()`, updates facing
  - constants `FLEE_TIME = 3`, `STARTLE_TIME = 2`, `REACT_TIME = 0.5`, `WANDER_DWELL = [1, 4]`, `VILLAGER_DWELL_MAX = 6`

- [ ] **Step 1: Write the failing tests**

`test/npc.test.js`:
```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeNpc, GOALS, buildCtx, selectGoal, updateNpc, FLEE_TIME, STARTLE_TIME } from '../renderer/systems/npc.js'
import { buildNavGrid, findPath } from '../renderer/systems/nav.js'

const S = 32
// 20x14 open field with a solid 3x3 block at (10..12, 5..7)
function field() {
  const map = createMap(20, 14)
  for (let y = 1; y < 13; y++) for (let x = 1; x < 19; x++) map[y][x].tile = TILE.FLOOR
  for (let y = 5; y <= 7; y++) for (let x = 10; x <= 12; x++) map[y][x].tile = TILE.WALL
  return map
}
function makeState(map, playerTile, entities = []) {
  const player = { type: 'player', x: playerTile.x, y: playerTile.y,
    px: playerTile.x * S + S / 2, py: playerTile.y * S + S / 2, maxHp: 10, hp: 10 }
  return { map, player, entities, feedback: null, log: [], sfx: { cues: [], muted: false } }
}
const npcAt = (species, x, y, extra = {}) => makeNpc({ species, id: `npc:test:${x},${y}`, x, y, hostile: false, ...extra })

describe('makeNpc', () => {
  it('shapes an entity from its species', () => {
    const e = npcAt('villager', 3, 4)
    assert.equal(e.type, 'npc')
    assert.equal(e.faction, 'village')
    assert.equal(e.hp, 3); assert.equal(e.maxHp, 3)
    assert.equal(e.px, 3 * S + S / 2); assert.equal(e.py, 4 * S + S / 2)
    assert.deepEqual(e.home, { x: 3, y: 4 })
    assert.equal(e.hostile, false)
    assert.equal(e.objective, null)
    assert.equal(e.id, 'npc:test:3,4')
  })
  it('honours a hostile spawn flag', () => {
    assert.equal(npcAt('villager', 3, 4, { hostile: true }).hostile, true)
  })
  it('returns null for an unknown species', () => {
    assert.equal(makeNpc({ species: 'griffin', id: 'x', x: 1, y: 1 }), null)
  })
})

describe('goal selection', () => {
  it('falls through to wander when nothing else applies', () => {
    const map = field()
    const e = npcAt('villager', 3, 3)
    const ctx = buildCtx(e, makeState(map, { x: 17, y: 11 }, [e]), 1 / 60)
    assert.equal(selectGoal(e, ctx), 'wander')
    assert.equal(e.ai.current, 'wander')
  })
  it('go_to beats wander while an objective is set', () => {
    const map = field()
    const e = npcAt('villager', 3, 3)
    e.objective = { x: 8, y: 3 }
    const ctx = buildCtx(e, makeState(map, { x: 17, y: 11 }, [e]), 1 / 60)
    assert.equal(selectGoal(e, ctx), 'go_to')
  })
  it('enter fires once on a goal switch, not every frame', () => {
    const map = field()
    const e = npcAt('villager', 3, 3)
    const state = makeState(map, { x: 17, y: 11 }, [e])
    let enters = 0
    const orig = GOALS.wander.enter
    GOALS.wander.enter = (...a) => { enters++; return orig(...a) }
    try {
      selectGoal(e, buildCtx(e, state, 1 / 60))
      selectGoal(e, buildCtx(e, state, 1 / 60))
      assert.equal(enters, 1)
    } finally { GOALS.wander.enter = orig }
  })
})

describe('go_to', () => {
  it('emits a patrol intent toward the objective and clears it on arrival', () => {
    const map = field()
    const e = npcAt('villager', 3, 3)
    e.objective = { x: 8, y: 3 }
    const state = makeState(map, { x: 17, y: 11 }, [e])
    const ctx = buildCtx(e, state, 1 / 60)
    selectGoal(e, ctx)
    const intent = GOALS.go_to.run(e, ctx, 1 / 60)
    assert.equal(intent.mode, 'patrol')
    assert.deepEqual(intent.target, { x: 8, y: 3 })
    e.x = 8; e.y = 3; e.px = 8 * S + S / 2; e.py = 3 * S + S / 2
    const done = GOALS.go_to.run(e, buildCtx(e, state, 1 / 60), 1 / 60)
    assert.equal(done.mode, 'hold')
    assert.equal(e.objective, null)
  })
})

describe('wander', () => {
  it('picks points within roam of home that are reachable from it', () => {
    const map = field()
    const nav = buildNavGrid(map)
    const e = npcAt('chicken', 3, 3)          // roam 3
    const state = makeState(map, { x: 17, y: 11 }, [e])
    for (let i = 0; i < 40; i++) {
      e.ai.wanderPt = null; e.ai.dwell = 0
      const ctx = buildCtx(e, state, 1 / 60)
      selectGoal(e, ctx)
      GOALS.wander.run(e, ctx, 5)             // a long dt burns any dwell
      const pt = e.ai.wanderPt
      if (!pt) continue
      assert.ok(Math.abs(pt.x - 3) <= 3 && Math.abs(pt.y - 3) <= 3, `point ${pt.x},${pt.y} outside roam`)
      assert.ok(findPath(nav, 3, 3, pt.x, pt.y, 1), 'unreachable point')
    }
  })
  it('moves the NPC over time', () => {
    const map = field()
    const e = npcAt('deer', 4, 4)
    const state = makeState(map, { x: 17, y: 11 }, [e])
    const start = { px: e.px, py: e.py }
    for (let i = 0; i < 600; i++) updateNpc(e, state, 1 / 60)   // 10 s
    assert.ok(Math.hypot(e.px - start.px, e.py - start.py) > S, 'deer never moved')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/npc.test.js`
Expected: FAIL — `Cannot find module '.../renderer/systems/npc.js'`.

- [ ] **Step 3: Write `renderer/systems/npc.js` (core only; hit/interact come in Task 3/7)**

```js
// Friendly creatures: villagers and animals that go about their business.
// A species carries an ordered list of goal names; every frame the first goal
// whose `when` holds runs and returns a movement intent for act(). Hostile
// NPCs hand the decision to the enemy brain, so they chase and fight like a
// guard. Pure logic — no DOM.
import { NPC_SPECIES } from '../data/npcs.js'
import { getAIConfig } from '../data/enemy-ai.js'
import { hasLineOfSight } from './entities.js'
import { buildNavGrid, findPath, passable } from './nav.js'
import { act } from './act.js'
import { updateBrain } from './brain.js'
import { tryStartEnemyAttack } from './enemy-attack.js'

const S = 32
export const FLEE_TIME = 3          // s a hit `flee` species keeps running
export const STARTLE_TIME = 2       // s a startled animal keeps running
export const REACT_TIME = 0.5       // s an animal's interact hop/bounce lasts
export const WANDER_DWELL = [1, 4]  // s paused at each wander point
export const VILLAGER_DWELL_MAX = 6 // villagers linger longer
const THREAT_RANGE = 240            // px inside which a hurt NPC bothers fleeing
const WANDER_TRIES = 10             // rejected candidate points before a rest

export function makeNpc({ species, id, x, y, hostile = false }) {
  const def = NPC_SPECIES[species]
  if (!def) { console.warn(`npc: unknown species "${species}"`); return null }
  return {
    type: 'npc', species, id, faction: def.faction,
    x, y, px: x * S + S / 2, py: y * S + S / 2,
    hp: def.hp, maxHp: def.hp, hostile: !!hostile,
    home: { x, y }, objective: null, facing: 'east', inCombat: false,
    damageCooldown: 0, aiHalf: 4,
    ai: { current: null, goals: {}, fleeTimer: 0, startleTimer: 0, reactTimer: 0 },
  }
}

export function buildCtx(e, state, delta) {
  const { player, map } = state
  const def = NPC_SPECIES[e.species]
  return {
    state, delta, def, cfg: getAIConfig(e),
    playerDist: Math.hypot(player.px - e.px, player.py - e.py),
    canSeePlayer: hasLineOfSight(map, e.y, e.x, player.y, player.x),
    hpFrac: e.maxHp ? e.hp / e.maxHp : 1,
  }
}

const atTile = (e, t) => Math.hypot(t.x * S + S / 2 - e.px, t.y * S + S / 2 - e.py) < S * 0.6
const rand = (lo, hi) => lo + Math.random() * (hi - lo)

// Pick a wander point within `roam` of home, reachable from the NPC's tile.
function pickWanderPoint(e, ctx) {
  const nav = buildNavGrid(ctx.state.map)
  const r = ctx.def.roam
  for (let i = 0; i < WANDER_TRIES; i++) {
    const x = e.home.x + Math.round(rand(-r, r))
    const y = e.home.y + Math.round(rand(-r, r))
    if (x === e.x && y === e.y) continue
    if (!passable(nav, x, y, 1)) continue
    if (!findPath(nav, e.x, e.y, x, y, 1)) continue
    return { x, y }
  }
  return null
}

export const GOALS = {
  flee_hurt: {
    when: (e, ctx) => e.ai.fleeTimer > 0 ||
      (e.hp < e.maxHp && ctx.hpFrac <= ctx.def.fleeHp && ctx.playerDist < THREAT_RANGE),
    enter: e => { e.ai.fleeTimer = Math.max(e.ai.fleeTimer, FLEE_TIME) },
    run: (e, ctx, dt) => { e.ai.fleeTimer = Math.max(0, e.ai.fleeTimer - dt); return { mode: 'flee', speed: ctx.cfg.speed } },
  },
  attack_hostile: {
    when: e => e.hostile,
    run: (e, ctx) => {
      const intent = updateBrain(e, ctx.state, ctx.delta)
      tryStartEnemyAttack(e, ctx.state)
      return intent
    },
  },
  startle: {
    when: (e, ctx) => !!ctx.def.startle && (e.ai.startleTimer > 0 || ctx.playerDist < ctx.def.startle),
    enter: e => { e.ai.startleTimer = Math.max(e.ai.startleTimer, STARTLE_TIME) },
    run: (e, ctx, dt) => { e.ai.startleTimer = Math.max(0, e.ai.startleTimer - dt); return { mode: 'flee', speed: ctx.cfg.speed } },
  },
  go_to: {
    when: e => !!e.objective,
    run: (e, ctx) => {
      if (atTile(e, e.objective)) { e.objective = null; return { mode: 'hold' } }
      // act() leaves ai.path === null for an unpathable target; give up after a while
      const unpathable = e.ai.path === null && e.ai.pathTarget &&
        e.ai.pathTarget.x === e.objective.x && e.ai.pathTarget.y === e.objective.y
      if (unpathable) {
        e.ai.giveUp = (e.ai.giveUp ?? 0) + ctx.delta
        if (e.ai.giveUp >= 3) { e.ai.giveUp = 0; e.objective = null; return { mode: 'hold' } }
      }
      return { mode: 'patrol', target: e.objective, speed: ctx.cfg.speed }
    },
  },
  wander: {
    when: () => true,
    enter: e => { e.ai.wanderPt = null; e.ai.dwell = 0 },
    run: (e, ctx, dt) => {
      const ai = e.ai
      if (ai.dwell > 0) { ai.dwell = Math.max(0, ai.dwell - dt); return { mode: 'hold' } }
      if (!ai.wanderPt) {
        ai.wanderPt = pickWanderPoint(e, ctx)
        if (!ai.wanderPt) { ai.dwell = WANDER_DWELL[0]; return { mode: 'hold' } }
      }
      const stuck = ai.path === null && ai.pathTarget &&
        ai.pathTarget.x === ai.wanderPt.x && ai.pathTarget.y === ai.wanderPt.y
      if (atTile(e, ai.wanderPt) || stuck) {
        ai.wanderPt = null
        const max = ctx.def.walker ? VILLAGER_DWELL_MAX : WANDER_DWELL[1]
        ai.dwell = rand(WANDER_DWELL[0], max)
        return { mode: 'hold' }
      }
      return { mode: 'patrol', target: ai.wanderPt, speed: ctx.cfg.wanderSpeed }
    },
  },
}

// First goal in the species list whose `when` holds. Runs `enter` on a change.
export function selectGoal(e, ctx) {
  const def = ctx.def
  let chosen = 'wander'
  for (const name of def.priorities) {
    const g = GOALS[name]
    if (g && g.when(e, ctx)) { chosen = name; break }
  }
  if (e.ai.current !== chosen) {
    e.ai.current = chosen
    GOALS[chosen].enter?.(e, ctx)
  }
  return chosen
}

export function updateNpc(e, state, delta) {
  if (!NPC_SPECIES[e.species]) return
  e.damageCooldown = Math.max(0, (e.damageCooldown ?? 0) - delta)
  e.ai.reactTimer = Math.max(0, (e.ai.reactTimer ?? 0) - delta)
  if (e.stunTimer > 0) { e.stunTimer -= delta; return }
  const ctx = buildCtx(e, state, delta)
  const name = selectGoal(e, ctx)
  const intent = GOALS[name].run(e, ctx, delta)
  const prevPx = e.px
  if (intent) act(e, state, delta, intent)
  const movedX = e.px - prevPx
  if (Math.abs(movedX) > 0.1) e.facing = movedX > 0 ? 'east' : 'west'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/npc.test.js`
Expected: PASS (the "moves over time" test relies on `act()`'s A* — the field map is open, so the deer walks).

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test` — expected all green.
```bash
git add renderer/systems/npc.js test/npc.test.js
git commit -m "feat(npc): entity factory, goal registry, wander and go_to goals"
```

---

### Task 3: Hit response, wrath, flee, startle, hostile attack

**Files:**
- Modify: `renderer/systems/npc.js`, `renderer/systems/enemy-attack.js`
- Test: `test/npc.test.js`, `test/enemy-attack.test.js`

**Interfaces:**
- Consumes: Task 2's `GOALS`, `buildCtx`, `selectGoal`, `updateNpc`.
- Produces:
  - `onNpcHit(e, state)` → `{ hostile: boolean, wrath: boolean }` — mutates `e` (flee timer or hostile), flips village and sets `state.npcWrath`; returns `wrath: true` only on the frame the village first turns.
  - `WEAPONS.fists = { sprite: null, style: 'snap', marks: null, damage: 1, windup: 0, duration: 0.2, reach: 26 }`; `ENEMY_MELEE.npc = 'fists'`.

- [ ] **Step 1: Write the failing tests**

Append to `test/npc.test.js`:
```js
import { onNpcHit } from '../renderer/systems/npc.js'
import { getEnemyWeapon } from '../renderer/systems/enemy-attack.js'

describe('onNpcHit', () => {
  it('a flee species runs and stays peaceful', () => {
    const map = field()
    const e = npcAt('chicken', 3, 3)
    const state = makeState(map, { x: 4, y: 3 }, [e])
    e.hp -= 1
    const r = onNpcHit(e, state)
    assert.equal(e.hostile, false)
    assert.equal(e.ai.fleeTimer, FLEE_TIME)
    assert.deepEqual(r, { hostile: false, wrath: false })
    assert.equal(selectGoal(e, buildCtx(e, state, 1 / 60)), 'flee_hurt')
  })
  it('a fight species turns hostile and the whole village follows', () => {
    const map = field()
    const a = npcAt('villager', 3, 3), b = npcAt('villager', 15, 10), old = npcAt('elder', 5, 5), hen = npcAt('chicken', 8, 8)
    const state = makeState(map, { x: 4, y: 3 }, [a, b, old, hen])
    a.hp -= 1
    const r = onNpcHit(a, state)
    assert.deepEqual(r, { hostile: true, wrath: true })
    assert.equal(a.hostile, true)
    assert.equal(b.hostile, true, 'far villager joins the wrath')
    assert.equal(old.hostile, false, 'elders flee, they do not fight')
    assert.equal(hen.hostile, false, 'wild animals are not villagers')
    assert.equal(state.npcWrath, true)
    assert.equal(onNpcHit(b, state).wrath, false, 'wrath announces once')
  })
  it('hitting a fleeing elder still provokes the village', () => {
    const map = field()
    const old = npcAt('elder', 5, 5), v = npcAt('villager', 3, 3)
    const state = makeState(map, { x: 6, y: 5 }, [old, v])
    old.hp -= 1
    const r = onNpcHit(old, state)
    assert.equal(old.hostile, false)
    assert.equal(old.ai.fleeTimer, FLEE_TIME)
    assert.equal(v.hostile, true)
    assert.equal(r.wrath, true)
  })
  it('hitting a wild animal provokes nobody else', () => {
    const map = field()
    const deer = npcAt('deer', 5, 5), v = npcAt('villager', 3, 3)
    const state = makeState(map, { x: 6, y: 5 }, [deer, v])
    deer.hp -= 1
    onNpcHit(deer, state)
    assert.equal(v.hostile, false)
    assert.equal(state.npcWrath, undefined)
  })
})

describe('startle and hostile goals', () => {
  it('a deer bolts inside its startle radius and not outside', () => {
    const map = field()
    const e = npcAt('deer', 5, 5)          // startle 96 px = 3 tiles
    const near = makeState(map, { x: 7, y: 5 }, [e])
    assert.equal(selectGoal(e, buildCtx(e, near, 1 / 60)), 'startle')
    assert.equal(e.ai.startleTimer, STARTLE_TIME)
    const e2 = npcAt('deer', 5, 5)
    const far = makeState(map, { x: 12, y: 11 }, [e2])
    assert.equal(selectGoal(e2, buildCtx(e2, far, 1 / 60)), 'wander')
  })
  it('a hostile villager approaches the player through the enemy brain', () => {
    const map = field()
    const e = npcAt('villager', 3, 3, { hostile: true })
    const state = makeState(map, { x: 6, y: 3 }, [e])
    const ctx = buildCtx(e, state, 1 / 60)
    assert.equal(selectGoal(e, ctx), 'attack_hostile')
    const intent = GOALS.attack_hostile.run(e, ctx, 1 / 60)
    assert.equal(intent.mode, 'approach')
    assert.equal(e.ai.mode, 'chase')
  })
  it('hostile villagers fight with fists', () => {
    const w = getEnemyWeapon({ type: 'npc', species: 'villager' })
    assert.equal(w.id, 'fists')
    assert.equal(w.damage, 1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/npc.test.js`
Expected: FAIL — `onNpcHit` is not exported; fists weapon missing.

- [ ] **Step 3: Add `fists` to `renderer/systems/enemy-attack.js`**

In `WEAPONS`, after `pincer`:
```js
  fists:       { sprite: null,           style: 'snap',  marks: null,     damage: 1, windup: 0, duration: 0.20, reach: 26 },
```
In `ENEMY_MELEE`:
```js
  npc:     'fists',
```

- [ ] **Step 4: Add `onNpcHit` to `renderer/systems/npc.js`**

Append:
```js
// Called by every damage site right after an NPC's hp drops. Flee species run;
// fight species turn hostile; any blow on a villager rouses the village.
export function onNpcHit(e, state) {
  const def = NPC_SPECIES[e.species]
  if (!def) return { hostile: false, wrath: false }
  e.inCombat = true
  if (def.onHit === 'fight') e.hostile = true
  else e.ai.fleeTimer = Math.max(e.ai.fleeTimer ?? 0, FLEE_TIME)
  let wrath = false
  if (def.faction === 'village') {
    for (const o of state.entities) {
      if (o.type !== 'npc' || o.faction !== 'village') continue
      if (NPC_SPECIES[o.species]?.onHit === 'fight') o.hostile = true
    }
    if (!state.npcWrath) { state.npcWrath = true; wrath = true }
  }
  return { hostile: e.hostile, wrath }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/npc.test.js test/enemy-attack.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite and commit**

```bash
npm test
git add renderer/systems/npc.js renderer/systems/enemy-attack.js test/npc.test.js
git commit -m "feat(npc): hit response, village wrath, startle, fists"
```

---

### Task 4: Spawn sampling and per-map population

**Files:**
- Modify: `renderer/systems/openmap.js`, `tools/static-overworld/export-game-maps.mjs`, `renderer/systems/map.js`
- Regenerate: `renderer/data/open-maps.js`
- Test: `test/openmap.test.js`

**Interfaces:**
- Consumes: map data `{ pois, walk, w, h, playerSpawn, name, npcs? }`.
- Produces:
  - `npcSpawnsForMap(data, { record = null, rng = Math.random } = {})` → `[{ kind: 'npc', species, x, y, id, hostile }]`
  - `buildOpenMap(data, { npcs = null, rng = Math.random } = {})` — emits those spawns into `entitySpawns`; `record` shape is `{ dead: string[], hostile: boolean }` (Task 5).
  - `generateLevel(depth, w, h, { ..., npcs })` forwards `npcs` to `buildOpenMap`.
  - `OPEN_MAPS[d].npcs = { village: string[], wild: string[] }` for depths 7–9.
- Constants: `WILD_MIN_FROM_VILLAGE = 12`, `WILD_MIN_FROM_CAVE = 4`, `SAMPLE_TRIES = 200`.

- [ ] **Step 1: Add the population to `tools/static-overworld/export-game-maps.mjs`**

Extend the three forest rows in `EXPORTS`:
```js
  { depth: 7,  file: 'forest-1-clearings.json',    title: 'Clearings',       caveDepths: [1, 2], exitPoi: 'forest shrine',
    npcs: { village: ['villager', 'villager', 'villager', 'elder', 'chicken', 'chicken'], wild: ['deer', 'deer', 'mouse', 'mouse', 'chicken'] } },
  { depth: 8,  file: 'forest-2-river.json',        title: 'River Split',     caveDepths: [2],    exitPoi: 'river shrine',
    npcs: { village: ['villager', 'villager', 'chicken'], wild: ['deer', 'deer', 'deer', 'mouse', 'mouse'] } },
  { depth: 9,  file: 'forest-3-autumn.json',       title: 'Autumn Highland', caveDepths: [2, 3], exitPoi: 'stone circle',
    npcs: { village: ['villager', 'elder'], wild: ['deer', 'deer', 'mouse', 'mouse', 'mouse'] } },
```
In the `maps[e.depth] = { ... }` object add:
```js
    npcs: e.npcs ?? null,
```
Regenerate: `cd tools/static-overworld && node export-game-maps.mjs && cd ../..`
Verify: `node -e "import('./renderer/data/open-maps.js').then(m => console.log(Object.entries(m.OPEN_MAPS).map(([d, x]) => d + ':' + JSON.stringify(x.npcs))))"` — depths 7–9 show the lists, 10–15 show `null`.

- [ ] **Step 2: Write the failing tests**

Append to `test/openmap.test.js`:
```js
import { npcSpawnsForMap } from '../renderer/systems/openmap.js'

// Deterministic LCG so sampling tests are reproducible.
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

describe('npcSpawnsForMap', () => {
  for (const depth of [7, 8, 9]) {
    const data = OPEN_MAPS[depth]
    it(`${data.name}: spawns the declared population on walkable, distinct tiles`, () => {
      const spawns = npcSpawnsForMap(data, { rng: lcg(1) })
      assert.equal(spawns.length, data.npcs.village.length + data.npcs.wild.length)
      const seen = new Set()
      for (const s of spawns) {
        assert.equal(s.kind, 'npc')
        assert.equal(data.walk[s.y][s.x], '1', `${s.id} on a blocked tile`)
        assert.ok(!seen.has(`${s.x},${s.y}`), `${s.id} shares a tile`); seen.add(`${s.x},${s.y}`)
        assert.ok(!(s.x === data.playerSpawn.x && s.y === data.playerSpawn.y), 'on the player spawn')
        assert.equal(s.hostile, false)
      }
    })
    it(`${data.name}: village homes sit within roam of the anchor, wild homes keep their distance`, () => {
      const anchor = data.pois.find(p => p.kind === 'village' || p.kind === 'camp')
      const caves = data.pois.filter(p => p.kind === 'dungeon_entrance')
      const spawns = npcSpawnsForMap(data, { rng: lcg(2) })
      const nVillage = data.npcs.village.length
      spawns.slice(0, nVillage).forEach(s => assert.ok(cheb(s, anchor) <= 8, `${s.id} far from village`))
      spawns.slice(nVillage).forEach(s => {
        assert.ok(cheb(s, anchor) >= 12, `${s.id} too close to the village`)
        for (const c of caves) assert.ok(cheb(s, c) >= 4, `${s.id} clogs ${c.label}`)
      })
    })
  }
  it('ids are stable across rngs; homes are not', () => {
    const a = npcSpawnsForMap(OPEN_MAPS[7], { rng: lcg(3) })
    const b = npcSpawnsForMap(OPEN_MAPS[7], { rng: lcg(4) })
    assert.deepEqual(a.map(s => s.id), b.map(s => s.id))
    assert.equal(a[0].id, 'npc:forest-1-clearings:0')
    assert.ok(a.some((s, i) => s.x !== b[i].x || s.y !== b[i].y))
  })
  it('honours a saved record: dead ids are skipped, a hostile village spawns hostile', () => {
    const record = { dead: ['npc:forest-1-clearings:0', 'npc:forest-1-clearings:7'], hostile: true }
    const spawns = npcSpawnsForMap(OPEN_MAPS[7], { record, rng: lcg(5) })
    assert.equal(spawns.length, 11 - 2)
    assert.ok(!spawns.some(s => record.dead.includes(s.id)))
    for (const s of spawns) assert.equal(s.hostile, s.species === 'villager' || s.species === 'elder')
  })
  it('a map without npcs yields nothing', () => {
    assert.deepEqual(npcSpawnsForMap(OPEN_MAPS[10], { rng: lcg(6) }), [])
  })
  it('buildOpenMap emits the npc spawns and forwards the record', () => {
    const record = { dead: ['npc:forest-1-clearings:0'], hostile: false }
    const { entitySpawns } = buildOpenMap(OPEN_MAPS[7], { npcs: record, rng: lcg(7) })
    const npcs = entitySpawns.filter(s => s.kind === 'npc')
    assert.equal(npcs.length, 10)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/openmap.test.js`
Expected: FAIL — `npcSpawnsForMap` not exported.

- [ ] **Step 4: Implement sampling in `renderer/systems/openmap.js`**

Add after the `startsWithAny` helper:
```js
import { NPC_SPECIES } from '../data/npcs.js'

export const WILD_MIN_FROM_VILLAGE = 12
export const WILD_MIN_FROM_CAVE = 4
const SAMPLE_TRIES = 200
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))

// Homes for the map's declared NPC population. Village NPCs cluster on the
// village/camp POI within their species' roam; wild ones keep clear of the
// village and every cave mouth. Ids index the concatenated village+wild list,
// so they are stable while the homes reroll on every spawn.
export function npcSpawnsForMap(data, { record = null, rng = Math.random } = {}) {
  if (!data.npcs) return []
  const walkable = (x, y) => x >= 1 && y >= 1 && x < data.w - 1 && y < data.h - 1 && data.walk[y][x] === '1'
  const taken = new Set([`${data.playerSpawn.x},${data.playerSpawn.y}`])
  const anchor = data.pois.find(p => p.kind === 'village' || p.kind === 'camp') ?? null
  const caves = data.pois.filter(p => p.kind === 'dungeon_entrance')
  const dead = new Set(record?.dead ?? [])
  const spawns = []
  const place = (species, i, pick) => {
    const id = `npc:${data.name}:${i}`
    if (dead.has(id)) return
    const def = NPC_SPECIES[species]
    if (!def) { console.warn(`npc: unknown species "${species}" on ${data.name}`); return }
    const t = pick(def)
    if (!t) { console.warn(`npc: no home found for ${id}`); return }
    taken.add(`${t.x},${t.y}`)
    spawns.push({ kind: 'npc', species, x: t.x, y: t.y, id,
      hostile: !!(record?.hostile && def.faction === 'village') })
  }
  const free = (x, y) => walkable(x, y) && !taken.has(`${x},${y}`)
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  // village: uniform in the roam box around the anchor, expanding if crowded
  const pickVillage = def => {
    if (!anchor) return null
    for (let r = def.roam, tries = 0; tries < SAMPLE_TRIES; tries++, r += tries % 20 === 0 ? 1 : 0) {
      const x = anchor.x + ri(-r, r), y = anchor.y + ri(-r, r)
      if (free(x, y)) return { x, y }
    }
    return null
  }
  // wild: anywhere, then relax the village distance, then anywhere free
  const pickWild = () => {
    for (const minV of [WILD_MIN_FROM_VILLAGE, 6, 0]) {
      for (let tries = 0; tries < SAMPLE_TRIES; tries++) {
        const x = ri(1, data.w - 2), y = ri(1, data.h - 2)
        if (!free(x, y)) continue
        if (anchor && cheb(x, y, anchor.x, anchor.y) < minV) continue
        if (caves.some(c => cheb(x, y, c.x, c.y) < WILD_MIN_FROM_CAVE)) continue
        return { x, y }
      }
    }
    return null
  }
  const village = anchor ? data.npcs.village ?? [] : []
  village.forEach((sp, i) => place(sp, i, pickVillage))
  ;(data.npcs.wild ?? []).forEach((sp, i) => place(sp, village.length + i, pickWild))
  return spawns
}
```
Change the `buildOpenMap` signature and append the spawns before `return`:
```js
export function buildOpenMap(data, { npcs = null, rng = Math.random } = {}) {
  ...
  entitySpawns.push(...npcSpawnsForMap(data, { record: npcs, rng }))
  return { ... }
```
Note the village-group test allows Chebyshev ≤ 8 (roam 6 plus the expansion). If a forest-2 `camp` anchor sits in dense props, the expansion handles it; if a test still fails, the expansion step (`r += 1` every 20 tries) is the knob.

- [ ] **Step 5: Forward the option through `generateLevel` in `renderer/systems/map.js`**

```js
export function generateLevel(depth, width = MAP_W, height = MAP_H, { skipProps = false, structures = {}, arena = null, npcs = null } = {}) {
  if (depth === 0) return buildArena({ size: { w: width, h: height }, ...(arena ?? {}) })
  if (depth === OVERWORLD_DEPTH) return generateOverworld(width, height, { structures })
  if (OPEN_MAPS[depth]) return buildOpenMap(OPEN_MAPS[depth], { npcs })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/openmap.test.js test/adventure.test.js test/map.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite and commit**

```bash
npm test
git add renderer/systems/openmap.js renderer/systems/map.js tools/static-overworld/export-game-maps.mjs renderer/data/open-maps.js test/openmap.test.js
git commit -m "feat(npc): per-map population and home sampling on the forest maps"
```

---

### Task 5: Adventure save v4 — `npcs` record

**Files:**
- Modify: `renderer/systems/adventure.js`
- Test: `test/adventure.test.js`

**Interfaces:**
- Produces:
  - `normalizeAdventureSave(raw)` → adds `npcs: {}`.
  - `npcRecordFor(save, mapName)` → `{ dead: [], hostile: false }` (a fresh default, never undefined).
  - `recordNpcState(save, mapName, spawnIds, entities, wrath)` → writes `save.npcs[mapName] = { dead, hostile }` where `dead` = ids in `spawnIds` with no living `npc` entity of that id.
  - `resetNpcs(save)` → `save.npcs = {}`.

- [ ] **Step 1: Write the failing tests**

Append to `test/adventure.test.js` (add `npcRecordFor, recordNpcState, resetNpcs` to the import):
```js
describe('npc persistence (save v4)', () => {
  it('migrates older saves with an empty npcs map', () => {
    assert.deepEqual(normalizeAdventureSave({ caves: {}, progress: freshProgress() }).npcs, {})
    assert.deepEqual(normalizeAdventureSave(null).npcs, {})
    const kept = normalizeAdventureSave({ caves: {}, progress: freshProgress(), npcs: { a: { dead: ['x'], hostile: true } } })
    assert.deepEqual(kept.npcs, { a: { dead: ['x'], hostile: true } })
  })
  it('npcRecordFor defaults to alive and peaceful', () => {
    const save = normalizeAdventureSave(null)
    assert.deepEqual(npcRecordFor(save, 'forest-1-clearings'), { dead: [], hostile: false })
  })
  it('recordNpcState lists the ids that no longer live and the wrath flag', () => {
    const save = normalizeAdventureSave(null)
    const ids = ['npc:m:0', 'npc:m:1', 'npc:m:2']
    const entities = [{ type: 'npc', id: 'npc:m:1', hp: 2 }, { type: 'chest' }]
    recordNpcState(save, 'm', ids, entities, true)
    assert.deepEqual(save.npcs.m, { dead: ['npc:m:0', 'npc:m:2'], hostile: true })
  })
  it('resetNpcs forgets every map', () => {
    const save = normalizeAdventureSave(null)
    recordNpcState(save, 'm', ['npc:m:0'], [], false)
    resetNpcs(save)
    assert.deepEqual(save.npcs, {})
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/adventure.test.js`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement in `renderer/systems/adventure.js`**

Update the comment and `normalizeAdventureSave`, then append the helpers:
```js
// Save-file shapes: v1 was the bare caves map ({mapName: {label: instance}});
// v2 added { caves, progress }; v3 adds learned talents and the traveling
// body (hands + sack); v4 adds npcs ({mapName: {dead, hostile}}) — wiped on
// player death. Migration is additive — missing fields default.
export function normalizeAdventureSave(raw) {
  ...
  base.gates ??= {}
  base.npcs ??= {}
  return base
}

export function npcRecordFor(save, mapName) {
  const r = save.npcs?.[mapName]
  return { dead: [...(r?.dead ?? [])], hostile: !!r?.hostile }
}

// dead = every declared spawn id with no living npc entity behind it.
export function recordNpcState(save, mapName, spawnIds, entities, wrath) {
  const alive = new Set(entities.filter(e => e.type === 'npc').map(e => e.id))
  save.npcs[mapName] = { dead: spawnIds.filter(id => !alive.has(id)), hostile: !!wrath }
}

// Groundhog Day: the player's death forgets every map's dead and wrath.
export function resetNpcs(save) {
  save.npcs = {}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/adventure.test.js` — PASS.

- [ ] **Step 5: Commit**

```bash
npm test
git add renderer/systems/adventure.js test/adventure.test.js
git commit -m "feat(npc): adventure save v4 npc record"
```

---

### Task 6: Game wiring — build, update, damage, persistence, death reset

**Files:**
- Modify: `renderer/game.js`, `renderer/systems/fire.js`, `renderer/systems/shockwave.js`
- Test: `test/fire.test.js`, `test/shockwave.test.js` (small additions); the rest is verified at runtime in Task 10.

**Interfaces:**
- Consumes: `makeNpc`, `updateNpc`, `onNpcHit` (Tasks 2–3); `npcSpawnsForMap` (Task 4); `npcRecordFor`, `recordNpcState`, `resetNpcs` (Task 5).
- Produces in `game.js`: `isHittable(e)`, `state.npcWrath`, `state.npcSpawnIds`, `respawnNpcs()`.

- [ ] **Step 1: Admit `npc` to the fire and shockwave sets, with tests**

`renderer/systems/fire.js`: `const BURNABLE = new Set(['guard', 'monster', 'dragon', 'cyclops', 'wizard', 'crab', 'npc'])`
`renderer/systems/shockwave.js`: `const SPLASHABLE = new Set(['guard', 'monster', 'dragon', 'cyclops', 'wizard', 'crab', 'npc'])`

Append to `test/fire.test.js` (match the file's existing imports — it already imports `applyBurst`):
```js
describe('npc burnability', () => {
  it('a fireball burst hurts an npc standing on a blast tile', () => {
    const npc = { type: 'npc', id: 'n', hp: 3, maxHp: 3, px: 48, py: 48 }
    const r = applyBurst([npc], { px: 400, py: 400 }, [{ x: 1, y: 1 }])
    assert.equal(r.entities[0].hp, 3 - BURST_DAMAGE)
  })
})
```
(Import `BURST_DAMAGE` if the file does not already.) Run `node --test test/fire.test.js` — PASS.

- [ ] **Step 2: Imports and predicates in `renderer/game.js`**

Add imports:
```js
import { makeNpc, updateNpc, onNpcHit, interactNpc } from './systems/npc.js'
import { npcSpawnsForMap } from './systems/openmap.js'
import { dungeonLabels, markCleared, isMapComplete, nextMapDepth, normalizeAdventureSave, npcRecordFor, recordNpcState, resetNpcs } from './systems/adventure.js'
```
(`interactNpc` lands in Task 7 — export a stub `export function interactNpc() { return null }` from `npc.js` in this task so the import resolves; Task 7 replaces it.)

Replace `isEnemy`:
```js
function isEnemy(e) {
  return e.type === 'guard' || e.type === 'monster' || e.type === 'dragon'
      || e.type === 'cyclops' || e.type === 'wizard' || e.type === 'crab'
      || e.type === 'dragon_boss' || (e.type === 'npc' && e.hostile)
}
// Things the player's weapons can hurt: every enemy plus peaceful NPCs.
function isHittable(e) { return isEnemy(e) || e.type === 'npc' }

// A blow landed on an npc: species reaction + village wrath (once).
function npcStruck(e) {
  if (e.type !== 'npc') return
  const r = onNpcHit(e, state)
  if (r.wrath) { announce(state, 'The village turns on you!'); sfx(state, 'npc-wrath') }
}
```

- [ ] **Step 3: `case 'npc'` in `buildEntities`**

After `case 'wild_mushroom'`:
```js
      case 'npc': { const n = makeNpc(s); return n ? [n] : [] }
```

- [ ] **Step 4: Thread the save record into both map builds and record the spawn ids**

In `startNewRun` (line ~322) change the `generateLevel` call:
```js
    generateLevel(depth, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures, arena: arenaCfg,
      npcs: OPEN_MAPS[depth] ? npcRecordFor(savedAdventure, OPEN_MAPS[depth].name) : null })
```
and in the state object add, beside `signs: signs ?? []`:
```js
    npcWrath: !!(OPEN_MAPS[depth] && npcRecordFor(savedAdventure, OPEN_MAPS[depth].name).hostile),
    npcSpawnIds: entitySpawns.filter(s => s.kind === 'npc').map(s => s.id),
```
`npcSpawnIds` must include dead ids too, or a dead NPC would be forgotten on the next persist. So instead compute it from the full declared list:
```js
    npcSpawnIds: OPEN_MAPS[depth] ? npcSpawnsForMap(OPEN_MAPS[depth]).map(s => s.id) : [],
```
(`npcSpawnsForMap` without a record yields every id; the homes it rolls are discarded.)

In `travelToMap` make the same two changes: the `generateLevel` call gets `npcs: npcRecordFor(savedAdventure, OPEN_MAPS[depth].name)`, and the new state gets `npcWrath: npcRecordFor(savedAdventure, mapName).hostile, npcSpawnIds: npcSpawnsForMap(OPEN_MAPS[depth]).map(s => s.id)`.

- [ ] **Step 5: Persist**

In `persistAdventure`, after the gates line:
```js
  if (mapName) recordNpcState(savedAdventure, mapName, surface.npcSpawnIds ?? [], surface.entities, surface.npcWrath)
```

- [ ] **Step 6: Update loop**

In the enemy AI loop (`for (const e of [...state.entities]) { if (!isEnemy(e)) continue ...`), insert **before** the `isEnemy` guard:
```js
    if (e.type === 'npc') { updateNpc(e, state, delta); continue }
```
(`updateNpc` handles both peaceful and hostile NPCs — hostile ones run the enemy brain inside `attack_hostile`; the loop must not run them twice.)

In the walk-tick loop:
```js
    if (e.type === 'guard' || e.type === 'wizard' || (e.type === 'npc' && NPC_SPECIES[e.species]?.walker)) tickWalk(e, delta)
```
with `import { NPC_SPECIES } from './data/npcs.js'`.

- [ ] **Step 7: Damage sites — hittable + `npcStruck`**

Player melee (`state.entities = state.entities.map(e => { if (!isEnemy(e)) return e ...`):
- change the guard to `if (!isHittable(e)) return e`
- after `const hitEnemy = { ...e, hp: e.hp - dmg, inCombat: true }` add `npcStruck(hitEnemy)`
- the trailing filter becomes `.filter(e => !isHittable(e) || e.hp > 0)`

Projectiles (`if (p.friendly) { state.entities = state.entities.map(e => { if (!isEnemy(e) || hit) return e ...`):
- guard → `if (!isHittable(e) || hit) return e`
- replace `return { ...e, hp: e.hp - p.damage, inCombat: true }` with
  ```js
          const struck = { ...e, hp: e.hp - p.damage, inCombat: true }
          npcStruck(struck)
          return struck
  ```
- the filter → `.filter(e => !isHittable(e) || e.hp > 0)`

Fireball burst (`detonateFireball`): change `if (isEnemy(e) && before[i] && e.hp < before[i].hp)` to `isHittable(e)` and add `npcStruck(e)` inside that block.

Gust/shockwave slam loop (`if (slam && isEnemy(e) && ...)`): change to `isHittable(e)` and add `npcStruck(e)` after `e.inCombat = true`. The filter two lines below → `!isHittable(e) || e.hp > 0`.

Maunonmiekka shockwave: `applyShockwave` already returns culled entities via `SPLASHABLE` (now including `npc`); after `state.entities = ...` from it, add:
```js
      for (const e of state.entities) if (e.type === 'npc' && e.inCombat && e.hp < e.maxHp && !e._struck) { e._struck = true; npcStruck(e) }
```
Simpler and sufficient: since shockwave-struck NPCs get `inCombat: true`, call `npcStruck` for every npc whose hp dropped compared to the pre-shockwave snapshot — mirror the `before[i]` pattern used by `detonateFireball`. Use that pattern, not the `_struck` flag.

Death cue: where the code chooses `'enemy-death'` vs `'melee-hit'` for a killed target, NPC animals should use `'npc-death'`:
```js
const deathCue = e => e.type === 'npc' && !NPC_SPECIES[e.species]?.walker ? 'npc-death' : 'enemy-death'
```
and use `deathCue(hitEnemy)` in the melee and projectile sites.

- [ ] **Step 8: Death reset**

In the player-death branch, before `state = adventureRespawn(...)`:
```js
      resetNpcs(savedAdventure)
      state = adventureRespawn(state, mapData.playerSpawn)
      respawnNpcs()
      persistAdventure()
```
and add the helper near `buildEntities`:
```js
// Groundhog Day: every NPC on the current surface returns, alive and calm.
function respawnNpcs() {
  const data = OPEN_MAPS[state.level]
  if (!data) return
  state.entities = state.entities.filter(e => e.type !== 'npc')
  state.entities.push(...buildEntities(npcSpawnsForMap(data), state.map, state.level))
  state.npcWrath = false
}
```

- [ ] **Step 9: Sanity run**

Run: `npm test` — all green. Then `node --check renderer/game.js` — no syntax errors. Launch `npm start`, pick Adventure, confirm villagers/animals appear around Aspengrove and move; hit one with the dagger and watch the village turn (banner + villagers approach). Close the app.

- [ ] **Step 10: Commit**

```bash
git add renderer/game.js renderer/systems/fire.js renderer/systems/shockwave.js renderer/systems/npc.js test/fire.test.js
git commit -m "feat(npc): wire NPCs into build, update, damage, persistence and death reset"
```

---

### Task 7: Interaction — F key, anchored bubble, sound cues

**Files:**
- Modify: `renderer/systems/npc.js`, `renderer/systems/feedback.js`, `renderer/systems/sfx.js`, `renderer/render/audio.js`, `renderer/render/canvas.js`, `renderer/game.js`
- Test: `test/npc.test.js`, `test/feedback.test.js`, `test/sfx.test.js`, `test/audio.test.js`

**Interfaces:**
- Produces:
  - `speakFrom(state, entity, text)` in `feedback.js` — bubble `{ text, kind: 'speech', t: 0, anchorId: entity.id }`.
  - `interactNpc(state, e, rng = Math.random)` in `npc.js` → `{ kind: 'speech', text } | { kind: 'react', react } | null` (null for hostile).
  - `nearestPeacefulNpc(state, maxPx = 48)` in `npc.js`.
  - cues `npc-chicken`, `npc-deer`, `npc-mouse`, `npc-hurt`, `npc-death`, `npc-wrath` in `CUE_NAMES` and `RECIPES`.

- [ ] **Step 1: Write the failing tests**

Append to `test/npc.test.js`:
```js
import { interactNpc, nearestPeacefulNpc, REACT_TIME } from '../renderer/systems/npc.js'
import { makeFeedback } from '../renderer/systems/feedback.js'

describe('interactNpc', () => {
  it('a villager faces the player, lingers and speaks a species line', () => {
    const map = field()
    const e = npcAt('villager', 5, 5)
    const state = makeState(map, { x: 4, y: 5 }, [e]); state.feedback = makeFeedback()
    const r = interactNpc(state, e, () => 0)
    assert.equal(r.kind, 'speech')
    assert.equal(r.text, 'Fine weather for it.')
    assert.equal(e.facing, 'west')
    assert.ok(e.ai.dwell >= 3)
    assert.equal(state.feedback.bubble.anchorId, e.id)
    assert.equal(state.feedback.bubble.text, r.text)
  })
  it('an animal reacts per species and queues its cue', () => {
    const map = field()
    const hen = npcAt('chicken', 5, 5), deer = npcAt('deer', 9, 9)
    const state = makeState(map, { x: 6, y: 5 }, [hen, deer])
    assert.deepEqual(interactNpc(state, hen), { kind: 'react', react: 'hop' })
    assert.equal(hen.ai.reactTimer, REACT_TIME)
    assert.deepEqual(interactNpc(state, deer), { kind: 'react', react: 'bolt' })
    assert.equal(deer.ai.startleTimer, STARTLE_TIME)
    assert.deepEqual(state.sfx.cues.map(c => c.name), ['npc-chicken', 'npc-deer'])
  })
  it('hostile NPCs ignore the button', () => {
    const e = npcAt('villager', 5, 5, { hostile: true })
    assert.equal(interactNpc(makeState(field(), { x: 4, y: 5 }, [e]), e), null)
  })
  it('nearestPeacefulNpc finds the closest peaceful npc within reach', () => {
    const map = field()
    const near = npcAt('chicken', 5, 5), far = npcAt('deer', 9, 9), mad = npcAt('villager', 4, 4, { hostile: true })
    const state = makeState(map, { x: 4, y: 5 }, [far, mad, near])
    assert.equal(nearestPeacefulNpc(state), near)
    assert.equal(nearestPeacefulNpc(makeState(map, { x: 15, y: 12 }, [near])), null)
  })
})
```

Append to `test/feedback.test.js`:
```js
import { speakFrom } from '../renderer/systems/feedback.js'
describe('speakFrom', () => {
  it('anchors the bubble to the speaker and logs the line', () => {
    const state = { log: [], feedback: makeFeedback() }
    speakFrom(state, { id: 'npc:x:1' }, 'Hello.')
    assert.deepEqual(state.feedback.bubble, { text: 'Hello.', kind: 'speech', t: 0, anchorId: 'npc:x:1' })
    assert.deepEqual(state.log, ['Hello.'])
  })
})
```
(Use the file's existing `makeFeedback` import.)

In `test/sfx.test.js`, extend the "starter set" list with `'npc-chicken', 'npc-deer', 'npc-mouse', 'npc-hurt', 'npc-death', 'npc-wrath'`. `test/audio.test.js` already asserts every `CUE_NAMES` entry has a recipe (check; if not, add):
```js
it('every cue name has a recipe', () => { for (const n of CUE_NAMES) assert.ok(RECIPES[n], n) })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/npc.test.js test/feedback.test.js test/sfx.test.js test/audio.test.js` — FAIL on the new cases.

- [ ] **Step 3: `speakFrom` in `renderer/systems/feedback.js`**

```js
// A speech bubble above another entity (an NPC). The renderer resolves
// anchorId against state.entities and falls back to the player.
export function speakFrom(state, entity, text) {
  log(state, text)
  if (state.feedback) state.feedback.bubble = { text, kind: 'speech', t: 0, anchorId: entity.id }
}
```

- [ ] **Step 4: Cues**

`renderer/systems/sfx.js` `CUE_NAMES` — add a group:
```js
  // npcs
  'npc-chicken', 'npc-deer', 'npc-mouse', 'npc-hurt', 'npc-death', 'npc-wrath',
```
`renderer/render/audio.js` `RECIPES` — add:
```js
  'npc-chicken':    { kind: 'blip',   wave: 'square',   f0: 880,  f1: 1320, dur: 0.10, vol: 0.5 },
  'npc-deer':       { kind: 'swoosh', f0: 600,  f1: 200,  dur: 0.18, vol: 0.4 },
  'npc-mouse':      { kind: 'blip',   wave: 'triangle', f0: 1500, f1: 2200, dur: 0.06, vol: 0.4 },
  'npc-hurt':       { kind: 'burst',  freq: 500,  q: 1.0,  dur: 0.08, vol: 0.6 },
  'npc-death':      { kind: 'blip',   wave: 'triangle', f0: 600,  f1: 200,  dur: 0.20, vol: 0.5 },
  'npc-wrath':      { kind: 'rumble', freq: 110, dur: 0.60, vol: 0.8 },
```

- [ ] **Step 5: `interactNpc` / `nearestPeacefulNpc` in `renderer/systems/npc.js`**

Replace the Task 6 stub:
```js
import { speakFrom } from './feedback.js'
import { sfx } from './sfx.js'

export function nearestPeacefulNpc(state, maxPx = 48) {
  const { player } = state
  let best = null, bestD = maxPx
  for (const e of state.entities) {
    if (e.type !== 'npc' || e.hostile) continue
    const d = Math.hypot(e.px - player.px, e.py - player.py)
    if (d < bestD) { best = e; bestD = d }
  }
  return best
}

// The interact button on a peaceful NPC. Villagers turn, linger and speak;
// animals do their species reaction with a cue. Hostile NPCs ignore it.
export function interactNpc(state, e, rng = Math.random) {
  const def = NPC_SPECIES[e.species]
  if (!def || e.hostile) return null
  const { player } = state
  if (def.lines) {
    e.facing = player.px < e.px ? 'west' : 'east'
    e.ai.wanderPt = null
    e.ai.dwell = Math.max(e.ai.dwell ?? 0, 3)
    const text = def.lines[Math.floor(rng() * def.lines.length)]
    speakFrom(state, e, text)
    return { kind: 'speech', text }
  }
  sfx(state, `npc-${e.species}`, { px: e.px, py: e.py })
  if (def.react === 'hop') e.ai.reactTimer = REACT_TIME
  else e.ai.startleTimer = Math.max(e.ai.startleTimer, def.react === 'bolt' ? STARTLE_TIME : 1)
  return { kind: 'react', react: def.react }
}
```

- [ ] **Step 6: F-key branch in `renderer/game.js`**

In the F handler, after `const sign = basin ? null : signNearby(...)` and before `if (sign)`:
```js
    const npc = (basin || sign) ? null : nearestPeacefulNpc(state)
    if (npc) { interactNpc(state, npc); return }
```
Add `nearestPeacefulNpc` to the `npc.js` import.

- [ ] **Step 7: Anchored bubble in `renderer/render/canvas.js`**

Where the bubble is drawn (`if (fb.bubble) this._drawBubble(state.player, fb.bubble)`):
```js
    if (fb.bubble) {
      const anchor = (fb.bubble.anchorId && state.entities.find(e => e.id === fb.bubble.anchorId)) || state.player
      this._drawBubble(anchor, fb.bubble)
    }
```
`_drawBubble` already reads `anchor.px/py` (named `player`); rename the parameter to `anchor` for clarity.

- [ ] **Step 8: Run the tests, then commit**

```bash
node --test test/npc.test.js test/feedback.test.js test/sfx.test.js test/audio.test.js
npm test
git add renderer/systems/npc.js renderer/systems/feedback.js renderer/systems/sfx.js renderer/render/audio.js renderer/render/canvas.js renderer/game.js test/npc.test.js test/feedback.test.js test/sfx.test.js test/audio.test.js
git commit -m "feat(npc): interact button — villager speech bubbles, animal reactions, cues"
```

---

### Task 8: Sprites — registry, placeholders, draw branch

**Files:**
- Create: `tools/png-write.mjs`, `tools/npc-placeholders.mjs`, `renderer/assets/tiles/npc_chicken.png`, `renderer/assets/tiles/npc_deer.png`
- Modify: `renderer/render/sprites.js`, `renderer/render/canvas.js`, `renderer/systems/npc.js`
- Test: `test/sprites.test.js`, `test/png-read.test.js` (round-trip)

**Interfaces:**
- Produces: `writePng(path, width, height, rgba: Uint8Array)` in `tools/png-write.mjs`; sprite keys `npc_villager`, `npc_villager_2`, `npc_villager_3`, `npc_elder`, `npc_mouse`, `npc_chicken`, `npc_deer`; `spriteKeyFor(e)` in `npc.js`.

- [ ] **Step 1: Write the PNG encoder with a round-trip test**

`tools/png-write.mjs`:
```js
// Minimal 8-bit RGBA PNG writer (no deps) — the twin of png-read.mjs.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0                       // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}
export function writePng(path, width, height, rgba) { writeFileSync(path, encodePng(width, height, rgba)) }
```
Append to `test/png-read.test.js` (check the shape `readPng` returns — it is `{ width, height, data }` or similar; adapt the property names to what the existing tests use):
```js
import { encodePng } from '../tools/png-write.mjs'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
describe('png-write round trip', () => {
  it('readPng decodes what encodePng wrote', () => {
    const w = 3, h = 2
    const rgba = new Uint8Array([255,0,0,255, 0,255,0,255, 0,0,255,255, 0,0,0,0, 255,255,255,255, 10,20,30,40])
    const p = join(mkdtempSync(join(tmpdir(), 'png-')), 'rt.png')
    writeFileSync(p, encodePng(w, h, rgba))
    const img = readPng(p)
    assert.equal(img.width, w); assert.equal(img.height, h)
    assert.deepEqual([...img.data], [...rgba])
  })
})
```
Run: `node --test test/png-read.test.js` — PASS.

- [ ] **Step 2: Placeholder sprites**

`tools/npc-placeholders.mjs` — 16×16 pixel-art placeholders in the tileset's dark-outline style (`#1c1917` outline). Run once; commit the PNGs. Re-running is idempotent.
```js
// Draw 16x16 placeholder animal sprites until real art lands (see
// extract-npc-sprites.mjs). Usage: node tools/npc-placeholders.mjs
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { writePng } from './png-write.mjs'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer/assets/tiles')
const O = [28, 25, 23, 255]   // outline
const T = [0, 0, 0, 0]

function paint(rows, pal) {
  const rgba = new Uint8Array(16 * 16 * 4)
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = ch === '.' ? T : ch === '#' ? O : pal[ch]
    rgba.set(c, (y * 16 + x) * 4)
  }))
  return rgba
}
const CHICKEN = paint([
  '................', '................', '.......##.......', '......#rr#......',
  '.....##ww##.....', '....#wwwwww#....', '...#wwwwwwww#...', '...#wwwwwwww#..#',
  '..#wwwwwwwwww##.', '..#wwwwwwwwww#..', '..#wwwwwwwww#...', '...#wwwwwww#....',
  '....########....', '.....#y##y#.....', '.....#..#.......', '................',
], { r: [220, 60, 60, 255], w: [240, 236, 220, 255], y: [230, 170, 50, 255] })
const DEER = paint([
  '..#.........#...', '..##..#..#..##..', '...#..#..#..#...', '...##.####.##...',
  '....#bbbbbb#....', '....#bwbbwb#....', '...#bbbbbbbb#...', '..#bbbbbbbbbb#..',
  '.#bbbbbbbbbbbb#.', '.#bbbbbbbbbbbb#.', '..#bbbbbbbbbb#..', '..#b#b####b#b#..',
  '..#b#.#..#.#b#..', '..#b#.#..#.#b#..', '..##..##.##.##..', '................',
], { b: [150, 100, 60, 255], w: [245, 235, 215, 255] })

for (const [name, px] of [['npc_chicken', CHICKEN], ['npc_deer', DEER]]) {
  const p = path.join(OUT, `${name}.png`)
  if (process.argv.includes('--force') || !existsSync(p)) { writePng(p, 16, 16, px); console.log('wrote', p) }
  else console.log('kept', p)
}
```
Run: `node tools/npc-placeholders.mjs`. Verify with `node -e "import('./tools/png-read.mjs').then(m => console.log(m.readPng('renderer/assets/tiles/npc_chicken.png').width))"` → `16`.

- [ ] **Step 3: Registry entries in `renderer/render/sprites.js`**

After `crab:`:
```js
  // npcs — villagers rotate through three faces by spawn index (npc.js)
  npc_villager:   'tile_0098',
  npc_villager_2: 'tile_0086',
  npc_villager_3: 'tile_0099',
  npc_elder:      'tile_0100',
  npc_mouse:      'tile_0124',
  npc_chicken:    'npc_chicken',   // placeholder art until extract-npc-sprites.mjs runs
  npc_deer:       'npc_deer',
```
Append to `test/sprites.test.js` (it already imports `SPRITES` — check; add if missing):
```js
it('registers every npc species sprite', () => {
  for (const k of ['npc_villager', 'npc_villager_2', 'npc_villager_3', 'npc_elder', 'npc_mouse', 'npc_chicken', 'npc_deer'])
    assert.ok(SPRITES[k], k)
})
```

- [ ] **Step 4: `spriteKeyFor` in `renderer/systems/npc.js` with a test**

```js
// Villagers rotate faces by their spawn index so a village is not clones.
export function spriteKeyFor(e) {
  const def = NPC_SPECIES[e.species]
  if (!def) return null
  if (e.species !== 'villager') return def.sprite
  const idx = Number(e.id?.split(':').at(-1)) || 0
  return ['npc_villager', 'npc_villager_2', 'npc_villager_3'][idx % 3]
}
```
Test (append to `test/npc.test.js`, import `spriteKeyFor`):
```js
describe('spriteKeyFor', () => {
  it('rotates villager faces by spawn index and uses the species sprite otherwise', () => {
    assert.equal(spriteKeyFor(npcAt('villager', 1, 1, { id: 'npc:m:0' })), 'npc_villager')
    assert.equal(spriteKeyFor(npcAt('villager', 1, 1, { id: 'npc:m:1' })), 'npc_villager_2')
    assert.equal(spriteKeyFor(npcAt('villager', 1, 1, { id: 'npc:m:5' })), 'npc_villager_3')
    assert.equal(spriteKeyFor(npcAt('deer', 1, 1)), 'npc_deer')
  })
})
```

- [ ] **Step 5: Draw branch in `renderer/render/canvas.js`**

Import at the top: `import { spriteKeyFor, REACT_TIME } from '../systems/npc.js'` and `import { NPC_SPECIES } from '../data/npcs.js'`.
In `drawEntity`, before the `if (entity.type === 'crab')` block:
```js
  if (entity.type === 'npc') {
    const def = NPC_SPECIES[entity.species]
    const key = spriteKeyFor(entity)
    const s = (entity.hostile && def?.walker ? sprites.guard_alert : null) ?? sprites[key]
    if (!s) return
    const flip = entity.facing === 'west'
    if (def?.walker) { drawWalker(ctx, s, px, py, S, flip, walkTilt(entity)); return }
    const rt = entity.ai?.reactTimer ?? 0
    const hop = rt > 0 ? Math.round(6 * Math.sin(Math.PI * (1 - rt / REACT_TIME))) : 0
    drawImg(ctx, s, px, py - hop, S, S, flip)
    return
  }
```
Health bars: `drawHealthBars` already shows a bar for any entity with `inCombat` — a struck peaceful NPC is `inCombat`, so it shows; hostile ones are enemies. Nothing to change.

- [ ] **Step 6: Tests + commit**

```bash
npm test
git add tools/png-write.mjs tools/npc-placeholders.mjs renderer/assets/tiles/npc_chicken.png renderer/assets/tiles/npc_deer.png renderer/render/sprites.js renderer/render/canvas.js renderer/systems/npc.js test/png-read.test.js test/sprites.test.js test/npc.test.js
git commit -m "feat(npc): sprites — registry, placeholder animals, draw branch"
```

---

### Task 9: Tiny Creatures extractor

**Files:**
- Create: `tools/extract-npc-sprites.mjs`
- Test: manual (script skips cleanly when the zip is absent)

**Interfaces:**
- Consumes: `readPng` (`tools/png-read.mjs`), `writePng` (Task 8).
- Input: `tools/static-overworld/vendor/tiny-creatures/` — the user unzips `tiny-creatures.zip` there by hand (itch.io blocks scripted downloads; CC0 licence, https://clintbellanger.itch.io/tiny-creatures).

- [ ] **Step 1: Ask the user for the zip (do not block)**

Message the user: "Please download https://clintbellanger.itch.io/tiny-creatures (CC0, pay-what-you-want — £0 is fine) and unzip it into `tools/static-overworld/vendor/tiny-creatures/`. Until then the placeholders stay." Continue with the script regardless.

- [ ] **Step 2: Write the script**

`tools/extract-npc-sprites.mjs`:
```js
// Crop chosen 16x16 cells from the Tiny Creatures sheet (CC0, Clint
// Bellanger) into renderer/assets/tiles/npc_*.png. Skips with a note when the
// pack has not been unzipped into vendor/tiny-creatures/.
// Usage: node tools/extract-npc-sprites.mjs [--list]   (--list prints a contact sheet index)
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VENDOR = path.join(HERE, 'static-overworld/vendor/tiny-creatures')
const OUT = path.join(HERE, '../renderer/assets/tiles')
const CELL = 16

// Which sheet cell is which animal. Fill these in after running --list and
// eyeballing the sheet (cell index = row * columns + col).
const PICKS = {
  npc_chicken: { file: 'tiny-creatures.png', col: 0, row: 0 },
  npc_deer:    { file: 'tiny-creatures.png', col: 1, row: 0 },
}

if (!fs.existsSync(VENDOR)) {
  console.log(`tiny-creatures not found at ${VENDOR} — keeping placeholder sprites`)
  process.exit(0)
}
const sheets = fs.readdirSync(VENDOR, { recursive: true }).filter(f => f.endsWith('.png'))
if (process.argv.includes('--list')) {
  for (const f of sheets) {
    const img = readPng(path.join(VENDOR, f))
    console.log(f, `${img.width}x${img.height}`, `${img.width / CELL} cols x ${img.height / CELL} rows`)
  }
  process.exit(0)
}
for (const [name, pick] of Object.entries(PICKS)) {
  const rel = sheets.find(f => f.endsWith(pick.file))
  if (!rel) { console.warn(`${name}: sheet ${pick.file} not in the pack`); continue }
  const img = readPng(path.join(VENDOR, rel))
  const out = new Uint8Array(CELL * CELL * 4)
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const sx = pick.col * CELL + x, sy = pick.row * CELL + y
    const si = (sy * img.width + sx) * 4
    out.set(img.data.subarray(si, si + 4), (y * CELL + x) * 4)
  }
  writePng(path.join(OUT, `${name}.png`), CELL, CELL, out)
  console.log('wrote', name)
}
```
The `PICKS` coordinates are a **first guess**; when the pack is present, run `--list`, open the sheet, and set the real `col`/`row` for a chicken and a deer (any hooved animal is fine). The renderer needs no change — the file names are the same as the placeholders.

- [ ] **Step 3: Run it without the pack**

Run: `node tools/extract-npc-sprites.mjs` — prints the "not found — keeping placeholder sprites" line and exits 0.

- [ ] **Step 4: If the pack is present, extract and eyeball**

Run `node tools/extract-npc-sprites.mjs --list`, set `PICKS`, run the script, then view the PNGs (Read tool on `renderer/assets/tiles/npc_chicken.png` — the harness renders images).

- [ ] **Step 5: Commit**

```bash
git add tools/extract-npc-sprites.mjs renderer/assets/tiles/npc_chicken.png renderer/assets/tiles/npc_deer.png
git commit -m "tools(npc): Tiny Creatures sprite extractor"
```

---

### Task 10: Runtime verification (time-boxed) and wrap-up

**Files:**
- Create: `tools/verify-npcs.mjs` (throwaway-style check, kept for reruns)
- Modify: `CLAUDE.md` (dungeon-crawler architecture line) — one clause.

- [ ] **Step 1: Write the Playwright check**

Follow the pattern of `tools/verify-touch.mjs` (launch Electron via `playwright-core`'s `_electron` with `DISPLAY=:0`, per the `verify-editor-with-playwright` memory). The check:
```js
// Boots the game, starts Adventure, and asserts NPCs exist, move, and speak.
// Usage: DISPLAY=:0 node tools/verify-npcs.mjs   (≈15 s)
import { _electron as electron } from 'playwright-core'
const app = await electron.launch({ args: ['.'] })
const page = await app.firstWindow()
await page.waitForFunction(() => window.__dc?.state || document.querySelector('canvas'))
// Start Adventure through the menu (Enter selects the first item).
await page.keyboard.press('Enter')
await page.waitForTimeout(1500)
const snap = async () => page.evaluate(() => {
  const s = window.__dc?.state
  return s ? s.entities.filter(e => e.type === 'npc').map(e => ({ id: e.id, px: e.px, py: e.py, hostile: e.hostile })) : null
})
const a = await snap()
if (!a || !a.length) throw new Error('no npcs on the surface')
await page.waitForTimeout(5000)
const b = await snap()
const moved = a.filter((e, i) => Math.hypot(e.px - b[i].px, e.py - b[i].py) > 8).length
console.log(`npcs: ${a.length}, moved in 5s: ${moved}`)
if (moved === 0) throw new Error('no npc moved')
await app.close()
```
`window.__dc.state` — if the game does not already expose state for tooling, check how `tools/verify-touch.mjs` reaches it and mirror that (grep `window.__dc` / `globalThis` in `game.js`). If nothing is exposed, add `if (window.__dcDebug) window.__dc = { get state() { return state } }` guarded by an env flag the launcher sets — the smallest hook that keeps production untouched.

- [ ] **Step 2: Run it (once, ≤ 30 s), then a manual pass**

Run: `DISPLAY=:0 timeout 60 node tools/verify-npcs.mjs` — expect `npcs: 11, moved in 5s: N>0`.
Then a short manual session (`npm start`): walk up to a villager and press F (bubble above them), press F beside a chicken (hop + cue), stab a chicken (it runs), stab a villager (banner, mob), die to the mob → wake in Aspengrove with everyone alive and calm. Close the game.
Per the `editor-autosave-data-hazard` memory, run `git status renderer/data/` afterwards and restore anything an automated run touched.

- [ ] **Step 3: Note the subsystem in `CLAUDE.md`**

In the dungeon-crawler architecture bullet for `renderer/systems/`, add: `` `npc` (friendly villagers/animals on the forest maps — priority-list goals in front of the enemy brain; hostile NPCs become enemies; save v4 `npcs` record, wiped on player death) ``.

- [ ] **Step 4: Full suite, commit**

```bash
npm test
git add tools/verify-npcs.mjs CLAUDE.md renderer/game.js
git commit -m "test(npc): runtime verification script; document the npc system"
```

---

## Self-review

**Spec coverage**
- §1 data → Task 1. Per-map population → Task 4.
- §2 spawning (anchor, wild distances, ids, dead/hostile, rng, unknown species dropped) → Task 4. `case 'npc'` + `makeNpc` → Tasks 2, 6.
- §3 goals (registry, ctx, enter-on-switch, go_to hook, wander, startle, flee_hurt, attack_hostile) → Tasks 2–3. Interaction (F, bubble anchored, animal react + cues) → Task 7.
- §4 combat (`isHittable`, `onNpcHit`, wrath once, fists, death cues) → Tasks 3, 6, 7.
- §5 persistence (v4, record, death reset, caves untouched) → Tasks 5, 6.
- §6 rendering (walker/animal, alert face when hostile, hop offset, sprites, placeholders, extractor) → Tasks 8, 9. HP bar rule — covered by existing `inCombat` behaviour (Task 8 step 5).
- §7 error handling: unknown species (Tasks 2, 4), sampler relaxation (Task 4), wander retries (Task 2), unreachable objective give-up (Task 2).
- §8 tests: all listed; runtime check → Task 10.
- Spec's "scurry = zig-zag" is simplified to a 1 s flee (Task 7) — a deliberate YAGNI cut; note it in the PR.

**Placeholder scan** — Task 9's `PICKS` coordinates are explicitly a first guess to be set once the pack exists; the script is complete. No TBDs.

**Type consistency** — `makeNpc({ species, id, x, y, hostile })`, `onNpcHit(e, state) → { hostile, wrath }`, `npcSpawnsForMap(data, { record, rng })`, `buildOpenMap(data, { npcs, rng })`, `npcRecordFor / recordNpcState / resetNpcs`, `interactNpc(state, e, rng)`, `nearestPeacefulNpc(state, maxPx)`, `speakFrom(state, entity, text)`, `spriteKeyFor(e)` are used with the same names and shapes across Tasks 2–10.
