# Fireball Wand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deep-tier Fireball Wand whose projectile detonates (on enemy hit, wall hit, or after 10 tiles) into a gas-like 16-tile flood-fill fire dealing 4 burst damage plus 1 dmg/s ticks for 3 s — to enemies **and** the player.

**Architecture:** Pure logic in a new `renderer/systems/fire.js` (flood fill, burst, tick zones), mirroring how `shockwave.js` works. `game.js` wires detonation triggers into the existing projectile loop and applies damage results; `canvas.js` draws flames and reuses the shockwave ring (with a color override) as the blast flash. Weapon definition/loot slot piggyback on the existing ranged-weapon plumbing (`entities.js`, `ranged.js`, `loot.js`).

**Tech Stack:** Electron + vanilla JS (ES modules, no bundler), `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-07-24-fireball-wand-design.md`

## Global Constraints

- Weapon stats exactly: `damage: 4, maxAmmo: 5, cooldown: 1.0, color: '#f97316', kind: 'wand', explodes: true`; name `'Fireball Wand'`; loot key `firewand`; **deep pool only** (depth ≥ 3).
- Detonation range: **10 tiles** (`10 * 32` px). Blast: **up to 16 tiles**, 4-neighbor BFS through walkable tiles only. Burst: **4** damage. Fire zone: **3.0 s** duration, **1** damage per **1.0 s** tick.
- Friendly fire is full: burst and ticks hit the player. Burst uses `damagePlayer(state, 4, 'hit', …)`; ticks use `'dot'`.
- Dragon boss keeps total ranged immunity (projectile passes over without detonating; burst and ticks skip it). A shielded wizard blocks the direct projectile hit but **takes** burst and tick damage.
- All existing tests must stay green after each task's commit (`npm test` from repo root).
- New modules are pure: `fire.js` must not import from `game.js` or touch `state`.

## File map

- Create: `renderer/systems/fire.js` (pure blast/fire logic), `test/fire.test.js`
- Modify: `renderer/systems/entities.js` (weapon def + `makeRangedContents`), `renderer/systems/ranged.js` (`tryFire` passthrough), `renderer/systems/loot.js` (deep pool), `renderer/game.js` (detonation wiring, fire-zone update, state init), `renderer/render/canvas.js` (flames + ring color)
- Modify tests: `test/ranged.test.js`, `test/loot.test.js`

---

### Task 1: `fire.js` — flood-fill blast shape

**Files:**
- Create: `renderer/systems/fire.js`
- Create: `test/fire.test.js`

**Interfaces:**
- Consumes: `isWalkable(tileId, tileObj)` and `TILE` from `renderer/systems/entities.js`. Map cells are objects `{ tile: TILE.X, … }`, indexed `map[y][x]`; `isWalkable` already rejects `WALL`, `COLUMN`, and cells with `voidZone: true`.
- Produces: `computeBlastTiles(map, tileX, tileY, count = BLAST_TILES) → [{x, y}, …]` in BFS order (`[]` if origin unwalkable); constants `FIREBALL_RANGE_TILES = 10`, `BLAST_TILES = 16`, `BURST_DAMAGE = 4`, `FIRE_DURATION = 3.0`, `FIRE_TICK_INTERVAL = 1.0`, `FIRE_TICK_DAMAGE = 1`. Tasks 2 and 4 rely on these exact names.

- [ ] **Step 1: Write the failing tests**

Create `test/fire.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TILE } from '../renderer/systems/entities.js'
import { computeBlastTiles, BLAST_TILES } from '../renderer/systems/fire.js'

// Build a map from ASCII rows: '#' wall, '.' floor, 'v' floor with a void zone.
function grid(rows) {
  return rows.map(r => [...r].map(ch => ({
    tile: ch === '#' ? TILE.WALL : TILE.FLOOR,
    ...(ch === 'v' ? { voidZone: true } : {}),
  })))
}
const key = t => `${t.x},${t.y}`

describe('computeBlastTiles', () => {
  it('fills a BFS diamond in the open — 16 tiles, all of manhattan radius 2 included', () => {
    const map = grid(['.........', '.........', '.........', '.........',
                      '.........', '.........', '.........', '.........', '.........'])
    const tiles = computeBlastTiles(map, 4, 4)
    assert.equal(tiles.length, BLAST_TILES)
    assert.deepEqual(tiles[0], { x: 4, y: 4 }, 'origin first in BFS order')
    const keys = new Set(tiles.map(key))
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        if (Math.abs(dx) + Math.abs(dy) <= 2)
          assert.ok(keys.has(`${4 + dx},${4 + dy}`), `manhattan-2 tile ${dx},${dy} burns`)
    for (const t of tiles)
      assert.ok(Math.abs(t.x - 4) + Math.abs(t.y - 4) <= 3, 'never farther than ring 3')
  })

  it('spills around walls like a gas and truncates when the space runs out', () => {
    // Two chambers joined only by the gap at row 3. Straight-line distance to
    // the right chamber is short, but fire must walk around through the gap.
    const map = grid([
      '#######',
      '#..#..#',
      '#..#..#',
      '#.....#',
      '#######',
    ])
    const tiles = computeBlastTiles(map, 1, 1)
    const keys = new Set(tiles.map(key))
    assert.equal(tiles.length, 13, 'all 13 reachable tiles burn — closet truncation under 16')
    assert.ok(keys.has('4,1'), 'spilled through the gap into the right chamber')
    assert.ok(!keys.has('3,1'), 'wall tile never burns')
  })

  it('respects void zones and refuses an unwalkable origin', () => {
    const map = grid(['....', '.v..', '....'])
    const keys = new Set(computeBlastTiles(map, 0, 0).map(key))
    assert.ok(!keys.has('1,1'), 'void-zone tile excluded')
    assert.deepEqual(computeBlastTiles(grid(['#..']), 0, 0), [], 'wall origin → no blast')
  })

  it('honors a custom count', () => {
    const map = grid(['.....', '.....', '.....'])
    assert.equal(computeBlastTiles(map, 2, 1, 4).length, 4)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fire.test.js`
Expected: FAIL — `Cannot find module '.../renderer/systems/fire.js'`

- [ ] **Step 3: Implement `computeBlastTiles`**

Create `renderer/systems/fire.js`:

```js
// Fireball wand: blast flood-fill, burst damage, and lingering fire zones.
// Pure logic — game.js owns detonation wiring, player damage application
// (damagePlayer), and visuals (canvas.js draws state.fireZones).
import { isWalkable } from './entities.js'

const TILE_SIZE = 32

export const FIREBALL_RANGE_TILES = 10 // projectile detonates after this many tiles
export const BLAST_TILES = 16          // flood-fill size
export const BURST_DAMAGE = 4
export const FIRE_DURATION = 3.0       // seconds a zone burns
export const FIRE_TICK_INTERVAL = 1.0
export const FIRE_TICK_DAMAGE = 1

// 4-neighbor BFS from the detonation tile through walkable tiles, gas-like:
// blocked by walls, spills around corners. Returns up to `count` {x, y}
// tiles in BFS order ([] if the origin itself is unwalkable).
export function computeBlastTiles(map, tileX, tileY, count = BLAST_TILES) {
  const origin = map[tileY]?.[tileX]
  if (!origin || !isWalkable(origin.tile, origin)) return []
  const tiles = []
  const seen = new Set([`${tileX},${tileY}`])
  const queue = [{ x: tileX, y: tileY }]
  while (queue.length && tiles.length < count) {
    const t = queue.shift()
    tiles.push(t)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = t.x + dx, ny = t.y + dy
      const k = `${nx},${ny}`
      if (seen.has(k)) continue
      seen.add(k)
      const cell = map[ny]?.[nx]
      if (cell && isWalkable(cell.tile, cell)) queue.push({ x: nx, y: ny })
    }
  }
  return tiles
}
```

(`TILE_SIZE` is unused until Task 2 — that's fine.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/fire.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/fire.js test/fire.test.js
git commit -m "feat(fire): flood-fill blast shape for the fireball wand"
```

---

### Task 2: `fire.js` — burst damage and lingering fire zones

**Files:**
- Modify: `renderer/systems/fire.js`
- Modify: `test/fire.test.js`

**Interfaces:**
- Consumes: constants from Task 1; entities are `{ type, px, py, hp, … }` (pixel positions, tile = `floor(px/32)`); player likewise has `px/py`.
- Produces (Task 4 relies on these exact signatures):
  - `applyBurst(entities, player, tiles) → { entities, playerBurned, hitCount }` — burst kills removed from `entities`, `playerBurned` boolean.
  - `makeFireZone(tiles) → { tiles, age: 0, tickTimer: 1.0 }`
  - `updateFireZones(zones, entities, player, delta) → { zones, entities, playerDamage }` — expired zones dropped, tick kills removed, `playerDamage` = total tick damage to the player this frame.

- [ ] **Step 1: Write the failing tests**

Append to `test/fire.test.js` (extend the import line first):

```js
import { computeBlastTiles, BLAST_TILES, applyBurst, makeFireZone, updateFireZones,
         BURST_DAMAGE, FIRE_DURATION, FIRE_TICK_INTERVAL } from '../renderer/systems/fire.js'
```

```js
// Entities/player on a 32px grid: tile (tx, ty) → pixel center.
const at = (tx, ty, extra = {}) => ({ type: 'monster', px: tx * 32 + 16, py: ty * 32 + 16, hp: 10, ...extra })
const TILES = [{ x: 1, y: 1 }, { x: 2, y: 1 }]

describe('applyBurst', () => {
  it('deals 4 to everyone on a blast tile, spares everyone off it, removes kills', () => {
    const inside = at(1, 1)
    const outside = at(5, 5)
    const weakling = at(2, 1, { hp: 3 })
    const { entities, playerBurned, hitCount } =
      applyBurst([inside, outside, weakling], at(1, 1), TILES)
    assert.equal(hitCount, 2)
    assert.equal(entities.find(e => e.px === inside.px).hp, 10 - BURST_DAMAGE)
    assert.equal(entities.find(e => e.px === outside.px).hp, 10, 'outside untouched')
    assert.ok(!entities.some(e => e.hp <= 0), 'burst kill removed')
    assert.equal(playerBurned, true)
  })

  it('spares the dragon boss and non-enemies, burns shielded wizards, misses a distant player', () => {
    const boss = at(1, 1, { type: 'dragon_boss', hp: 18 })
    const chest = at(2, 1, { type: 'chest', hp: undefined })
    const shielded = at(2, 1, { type: 'wizard', hp: 6, shieldTimer: 2 })
    const { entities, playerBurned, hitCount } =
      applyBurst([boss, chest, shielded], at(9, 9), TILES)
    assert.equal(hitCount, 1, 'only the wizard counts')
    assert.equal(entities.find(e => e.type === 'dragon_boss').hp, 18)
    assert.equal(entities.find(e => e.type === 'chest').hp, undefined)
    assert.equal(entities.find(e => e.type === 'wizard').hp, 6 - BURST_DAMAGE, 'shield is no fire protection')
    assert.equal(playerBurned, false)
  })
})

describe('fire zones', () => {
  it('makeFireZone starts fresh with a full tick timer', () => {
    assert.deepEqual(makeFireZone(TILES), { tiles: TILES, age: 0, tickTimer: FIRE_TICK_INTERVAL })
  })

  it('ticks 1 damage per second — 3 ticks over a full 3 s lifetime, then expires', () => {
    let zones = [makeFireZone(TILES)]
    let entities = [at(1, 1), at(5, 5)]
    const player = at(2, 1)
    let playerTotal = 0
    for (let i = 0; i < 6; i++) {           // 6 × 0.5 s = 3.0 s
      const r = updateFireZones(zones, entities, player, 0.5)
      zones = r.zones; entities = r.entities; playerTotal += r.playerDamage
    }
    assert.equal(entities.find(e => e.px === 48).hp, 10 - 3, 'standing enemy took 3 ticks')
    assert.equal(entities.find(e => e.px === 176).hp, 10, 'distant enemy untouched')
    assert.equal(playerTotal, 3, 'player standing in fire took 3 ticks')
    assert.equal(zones.length, 0, 'zone burned out at 3.0 s')
  })

  it('does not tick before the first full second', () => {
    const r = updateFireZones([makeFireZone(TILES)], [at(1, 1)], at(9, 9), 0.9)
    assert.equal(r.entities[0].hp, 10)
    assert.equal(r.playerDamage, 0)
    assert.equal(r.zones.length, 1)
  })

  it('skips the dragon boss and removes tick kills', () => {
    const boss = at(1, 1, { type: 'dragon_boss', hp: 18 })
    const dying = at(2, 1, { hp: 1 })
    const r = updateFireZones([makeFireZone(TILES)], [boss, dying], at(9, 9), 1.0)
    assert.equal(r.entities.find(e => e.type === 'dragon_boss').hp, 18)
    assert.ok(!r.entities.some(e => e.type === 'monster'), 'tick kill removed')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fire.test.js`
Expected: FAIL — `applyBurst` is not exported

- [ ] **Step 3: Implement burst + zones**

Append to `renderer/systems/fire.js`:

```js
// dragon_boss is deliberately absent — it keeps full ranged immunity.
const BURNABLE = new Set(['guard', 'monster', 'dragon', 'cyclops', 'wizard', 'crab'])

const tileKey = e => `${Math.floor(e.px / TILE_SIZE)},${Math.floor(e.py / TILE_SIZE)}`
const keySet = tiles => new Set(tiles.map(t => `${t.x},${t.y}`))
const cullDead = entities => entities.filter(e => !BURNABLE.has(e.type) || e.hp > 0)

// Initial detonation damage to everything standing on a blast tile. The
// wizard's shield does NOT protect — the fireball is the counter-tool.
export function applyBurst(entities, player, tiles) {
  const keys = keySet(tiles)
  let hitCount = 0
  const updated = entities.map(e => {
    if (!BURNABLE.has(e.type) || e.px === undefined || !keys.has(tileKey(e))) return e
    hitCount++
    return { ...e, hp: e.hp - BURST_DAMAGE, inCombat: true }
  })
  return { entities: cullDead(updated), playerBurned: keys.has(tileKey(player)), hitCount }
}

export function makeFireZone(tiles) {
  return { tiles, age: 0, tickTimer: FIRE_TICK_INTERVAL }
}

// Advance all zones by `delta`. Each zone ticks independently every
// FIRE_TICK_INTERVAL, damaging everything standing on its tiles. Returns
// surviving zones, the updated entity list (tick kills removed), and the
// total damage the player took (game.js applies it via damagePlayer 'dot').
export function updateFireZones(zones, entities, player, delta) {
  let playerDamage = 0
  let updated = entities
  const live = []
  for (const z of zones) {
    const zone = { ...z, age: z.age + delta, tickTimer: z.tickTimer - delta }
    while (zone.tickTimer <= 0) {
      zone.tickTimer += FIRE_TICK_INTERVAL
      const keys = keySet(zone.tiles)
      updated = updated.map(e => {
        if (!BURNABLE.has(e.type) || e.px === undefined || !keys.has(tileKey(e))) return e
        return { ...e, hp: e.hp - FIRE_TICK_DAMAGE, inCombat: true }
      })
      if (keys.has(tileKey(player))) playerDamage += FIRE_TICK_DAMAGE
    }
    if (zone.age < FIRE_DURATION) live.push(zone)
  }
  return { zones: live, entities: cullDead(updated), playerDamage }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/fire.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/fire.js test/fire.test.js
git commit -m "feat(fire): burst damage and lingering tick zones"
```

---

### Task 3: Weapon definition, `tryFire` passthrough, loot pool

**Files:**
- Modify: `renderer/systems/entities.js:31-46` (`RANGED_WEAPON_TYPES`, `makeRangedContents`)
- Modify: `renderer/systems/ranged.js:11-23` (`tryFire`)
- Modify: `renderer/systems/loot.js:6` (`RANGED_POOLS`)
- Modify: `test/ranged.test.js`, `test/loot.test.js`

**Interfaces:**
- Consumes: existing `RANGED_WEAPON_TYPES` / `makeRangedContents` / `tryFire` / `RANGED_POOLS` shapes.
- Produces: `RANGED_WEAPON_TYPES.firewand` with `explodes: true`; `makeRangedContents('firewand')` and `tryFire(...)` results carry `explodes: true` **only** for exploding weapons (other weapons' result objects must be byte-identical to today — existing `deepEqual` tests depend on it). Task 4 reads `shot.explodes`.

- [ ] **Step 1: Update the two existing tests that the change will break, and add new ones**

In `test/ranged.test.js`:

Replace the roster assertion (line 8):

```js
      assert.deepEqual(Object.keys(RANGED_WEAPON_TYPES), ['shortbow', 'longbow', 'sparkwand', 'stormwand', 'firewand'])
```

In `'bows are bows and wands are wands'`, add:

```js
      assert.equal(RANGED_WEAPON_TYPES.firewand.kind, 'wand')
```

Add to the `makeRangedContents` describe block:

```js
  it('firewand carries the explodes flag; others stay flag-free', () => {
    const c = makeRangedContents('firewand')
    assert.equal(c.explodes, true)
    assert.deepEqual(
      { name: c.name, damage: c.damage, ammo: c.ammo, cooldown: c.cooldown },
      { name: 'Fireball Wand', damage: 4, ammo: 5, cooldown: 1.0 })
    assert.ok(!('explodes' in makeRangedContents('stormwand')))
  })
```

Add to the `tryFire` describe block:

```js
  it('firewand shots are exploding bolts', () => {
    const p = armedPlayer({ ranged: makeRangedContents('firewand') })
    assert.deepEqual(tryFire(p), { ok: true, damage: 4, color: '#f97316', shape: 'bolt', explodes: true })
  })
```

In `test/loot.test.js`, the deep pool grows to 3 entries, so `pick`'s index math shifts: replace the two ranged lines of the `'deep (depth >= 3) draws from the heavy pools'` test with:

```js
    assert.equal(rollChestLoot(5, seq(0.99, 0.0)).weaponType, 'longbow')
    assert.equal(rollChestLoot(5, seq(0.99, 0.5)).weaponType, 'stormwand')
    assert.equal(rollChestLoot(5, seq(0.99, 0.99)).weaponType, 'firewand')
```

And add to the shallow-tier test:

```js
    assert.notEqual(rollChestLoot(2, seq(0.99, 0.99)).weaponType, 'firewand', 'no fireballs above depth 3')
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/ranged.test.js test/loot.test.js`
Expected: FAIL — roster deepEqual (no `firewand` key), `makeRangedContents('firewand')` falls back to shortbow, deep-pool `seq(0.99, 0.99)` still yields `stormwand`

- [ ] **Step 3: Implement**

`renderer/systems/entities.js` — add to `RANGED_WEAPON_TYPES` after the `stormwand` line:

```js
  firewand:  { name: 'Fireball Wand', damage: 4, maxAmmo: 5,  cooldown: 1.0,  color: '#f97316', kind: 'wand', explodes: true },
```

`renderer/systems/entities.js` — in `makeRangedContents`, extend the returned object:

```js
  return {
    type: 'ranged', weaponType: wt, name: def.name, damage: def.damage,
    ammo: def.maxAmmo, maxAmmo: def.maxAmmo, cooldown: def.cooldown,
    color: def.color, kind: def.kind,
    ...(def.explodes ? { explodes: true } : {}),
  }
```

`renderer/systems/ranged.js` — extend `tryFire`'s success return:

```js
  return {
    ok: true,
    damage: player.ranged.damage,
    color: player.ranged.color,
    shape: player.ranged.kind === 'bow' ? 'arrow' : 'bolt',
    ...(player.ranged.explodes ? { explodes: true } : {}),
  }
```

`renderer/systems/loot.js` — line 6:

```js
const RANGED_POOLS = { shallow: ['shortbow', 'sparkwand'], deep: ['longbow', 'stormwand', 'firewand'] }
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — including the untouched `deepEqual` tests for stormwand contents and shortbow `tryFire` (no stray `explodes` key)

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/entities.js renderer/systems/ranged.js renderer/systems/loot.js test/ranged.test.js test/loot.test.js
git commit -m "feat(fire): Fireball Wand weapon def, explodes passthrough, deep loot pool"
```

---

### Task 4: `game.js` detonation wiring and fire-zone update

**Files:**
- Modify: `renderer/game.js` — imports (~line 25), projectile spawn (~line 485), projectile update loop (~lines 494-525), new `detonateFireball` helper (below `isEnemy`, ~line 156), state init (~line 238 and ~line 730 — both have `projectiles: [], shockwaves: [],`)

**Interfaces:**
- Consumes: `computeBlastTiles`, `applyBurst`, `makeFireZone`, `updateFireZones`, `BURST_DAMAGE`, `FIREBALL_RANGE_TILES` from Task 1/2; `shot.explodes` from Task 3; existing `damagePlayer(state, amount, kind, message)`, `TILE_SIZE = 32`, module-level `state`.
- Produces: `state.fireZones` (array of zones) and orange entries in `state.shockwaves` carrying a `color` field — Task 5 renders both.

There are no direct unit tests for `game.js` (repo convention — it's the orchestrator); Task 6's arena run covers it live. The full suite still gates the commit.

- [ ] **Step 1: Add the import**

After line 25 (`import { rollChestLoot } …`):

```js
import { computeBlastTiles, applyBurst, makeFireZone, updateFireZones, BURST_DAMAGE, FIREBALL_RANGE_TILES } from './systems/fire.js'
```

- [ ] **Step 2: Add the detonation helper**

Directly below the `isEnemy` function (~line 156):

```js
// Fireball detonation: flood-fill the blast, burst everyone standing in it
// (player included — full friendly fire), light the tiles, flash a ring.
function detonateFireball(px, py) {
  const tx = Math.floor(px / TILE_SIZE), ty = Math.floor(py / TILE_SIZE)
  const tiles = computeBlastTiles(state.map, tx, ty)
  if (!tiles.length) return
  const burst = applyBurst(state.entities, state.player, tiles)
  state.entities = burst.entities
  if (burst.playerBurned) damagePlayer(state, BURST_DAMAGE, 'hit', `The blast engulfs you! (-${BURST_DAMAGE} HP)`)
  state.fireZones.push(makeFireZone(tiles))
  state.shockwaves.push({ px: tx * TILE_SIZE + TILE_SIZE / 2, py: ty * TILE_SIZE + TILE_SIZE / 2,
    t: 0, dur: 0.35, maxRadius: TILE_SIZE * 2.5, color: '#f97316' })
  state.log = [...state.log, 'The fireball erupts!'].slice(-5)
}
```

- [ ] **Step 3: Stamp exploding projectiles at spawn**

Replace the spawn push inside `if (keys[' '] && player.attackMode === 'ranged')` (~line 485):

```js
    if (shot.ok) {
      const dir = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] }[player.facing]
      const proj = { px: player.px, py: player.py,
        dx: dir[0]*PROJECTILE_SPEED, dy: dir[1]*PROJECTILE_SPEED,
        damage: shot.damage, color: shot.color, shape: shot.shape, friendly: true }
      if (shot.explodes) {
        proj.explodes = true
        proj.maxDist = FIREBALL_RANGE_TILES * TILE_SIZE
        proj.distTraveled = 0
        proj.lastPx = player.px; proj.lastPy = player.py   // last walkable spot, for wall detonations
      }
      state.projectiles.push(proj)
    } else if (…unchanged…)
```

- [ ] **Step 4: Detonate on the three termination conditions**

In the projectile update loop (~lines 494-525), three surgical edits:

Max-distance expiry (line 500) becomes:

```js
    if (p.maxDist !== undefined) {
      p.distTraveled = (p.distTraveled ?? 0) + stepDist
      if (p.distTraveled >= p.maxDist) {
        if (p.explodes) detonateFireball(p.px, p.py)
        continue
      }
    }
```

Wall hit (lines 501-502) becomes (detonate at the last walkable spot, then remember the current one):

```js
    const tile = map[Math.floor(p.py / TILE_SIZE)]?.[Math.floor(p.px / TILE_SIZE)]
    if (!tile || !isWalkable(tile.tile, tile)) {
      if (p.explodes) detonateFireball(p.lastPx ?? p.px, p.lastPy ?? p.py)
      continue
    }
    if (p.explodes) { p.lastPx = p.px; p.lastPy = p.py }
```

Enemy hit — after the friendly-branch entity mapping and dead-filter (line 516), before `} else {`:

```js
      if (hit && p.explodes) detonateFireball(p.px, p.py)
```

The dragon boss branch (`if (e.type === 'dragon_boss') return e`) is untouched: the projectile never registers a hit on it, so it flies over without detonating — its blast lands on whatever stops the projectile later. The shielded-wizard branch sets `hit = true`, so the blocked hit still detonates, and `applyBurst` burns the wizard.

- [ ] **Step 5: Tick fire zones each frame**

Immediately after `state.projectiles = liveProjectiles` (~line 525):

```js
  // Lingering fireball flames — tick everyone standing in them
  if (state.fireZones?.length) {
    const fz = updateFireZones(state.fireZones, state.entities, player, delta)
    state.fireZones = fz.zones
    state.entities = fz.entities
    if (fz.playerDamage > 0) damagePlayer(state, fz.playerDamage, 'dot', "You're burning! (-1 HP)")
  }
```

- [ ] **Step 6: Initialize `state.fireZones` in both state constructions**

In the new-run state object (~line 238) and the `descendLevel` state object (~line 730), after `projectiles: [],` add:

```js
    fireZones: [],
```

(Descending clears any burning fire, same as projectiles.)

- [ ] **Step 7: Verify**

Run: `node --check renderer/game.js && npm test`
Expected: syntax OK, full suite PASS

- [ ] **Step 8: Commit**

```bash
git add renderer/game.js
git commit -m "feat(fire): wire fireball detonation and fire-zone ticks into the game loop"
```

---

### Task 5: Rendering — flames and blast flash

**Files:**
- Modify: `renderer/render/canvas.js` — projectile/effects section (~lines 719-744)

**Interfaces:**
- Consumes: `state.fireZones` (`[{ tiles: [{x, y}], age, tickTimer }]`, 3.0 s lifetime) and `state.shockwaves` entries with optional `color` — both produced by Task 4. `S` is the tile size in screen px, `camX/camY` the camera offset, both in scope in `render()`.
- Produces: nothing consumed later — pure drawing.

- [ ] **Step 1: Let shockwave rings carry a color**

In the shockwave loop (~line 737), replace the hardcoded stroke:

```js
      ctx.strokeStyle = w.color ?? '#dc2626'
```

- [ ] **Step 2: Draw burning tiles**

Insert between the projectile loop and the shockwave loop (after ~line 731):

```js
    // Fireball zones: flickering flames per burning tile. Deterministic
    // flicker seeded by zone age + tile coords (no wall-clock), fading over
    // the final 0.7 s of the zone's 3 s life.
    for (const z of state.fireZones ?? []) {
      const fade = Math.max(0, Math.min(1, (3.0 - z.age) / 0.7))
      for (const t of z.tiles) {
        const fx = Math.round(t.x * S - camX), fy = Math.round(t.y * S - camY)
        const phase = z.age * 10 + t.x * 7 + t.y * 13
        const flick = 0.75 + 0.25 * Math.sin(phase)
        ctx.save()
        ctx.globalAlpha = 0.35 * fade * flick
        ctx.fillStyle = '#ef4444'
        ctx.fillRect(fx + 2, fy + 2, S - 4, S - 4)
        ctx.globalAlpha = 0.7 * fade * flick
        ctx.fillStyle = '#f97316'
        const h = S * 0.5 * (0.7 + 0.3 * Math.sin(phase * 1.7))
        ctx.fillRect(fx + 6, fy + S - 6 - h, S - 12, h)
        ctx.globalAlpha = 0.8 * fade
        ctx.fillStyle = '#fbbf24'
        const h2 = S * 0.28 * (0.7 + 0.3 * Math.sin(phase * 2.3 + 1))
        ctx.fillRect(fx + 10, fy + S - 6 - h2, S - 20, h2)
        ctx.restore()
      }
    }
```

- [ ] **Step 3: Verify**

Run: `node --check renderer/render/canvas.js && npm test`
Expected: syntax OK, full suite PASS (including `test/canvas.test.js`)

- [ ] **Step 4: Commit**

```bash
git add renderer/render/canvas.js
git commit -m "feat(fire): render burning tiles and orange blast ring"
```

---

### Task 6: Full verification + short arena run

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS, zero failures

- [ ] **Step 2: One short live arena run**

Invoke the **arena-test skill** (it manages the journal question/criteria discipline). Keep it time-boxed — one run, per the user's standing preference for short live checks. Scenario: spawn an arena with a `chest` containing the firewand (or grant via cheat if the skill supports it), a corridor wall, and 2-3 monsters. Checks:

1. Fireball detonates on a wall and the fire spills around the corner (flood fill visible).
2. Enemies in the zone take the burst, then visibly burn down over ~3 s.
3. Standing in your own fire damages the player ("You're burning!" in the log).
4. Ammo counts down from 5; at 0 the "Out of ammo!" message fires.

Anything not reachable in one short run (10-tile air detonation, boss immunity) stays unit-covered — do not extend the run for it.

**Post-run:** check `git status renderer/data/` — automated editor/game runs can autosave `painter-maps.json`; restore it if dirty.

- [ ] **Step 3: Final commit (journal + any test-run artifacts)**

```bash
git status   # review — only intended files
git add docs/ test/
git commit -m "test(arena): fireball wand live checks — detonation, spill, self-burn"
```

Then use the **superpowers:finishing-a-development-branch** skill to decide merge/PR handling.

---

## Self-review notes

- **Spec coverage:** weapon def + loot (Task 3), three detonation triggers (Task 4 step 4), flood fill (Task 1), burst incl. shield/boss rules (Task 2), 3 s / 1 dmg ticks with friendly fire (Tasks 2+4), rendering (Task 5), tests incl. the two pre-existing assertions that must change (Task 3 step 1), short arena run (Task 6). No gaps found.
- **Type consistency:** `shot.explodes` (Task 3) → `proj.explodes` (Task 4); `updateFireZones` return `{ zones, entities, playerDamage }` used identically in Tasks 2 and 4; `state.fireZones` shape matches Task 5's reader.
- **Known accepted behaviors:** burst uses `'hit'` kind, so player i-frames can absorb a burst that lands within 0.8 s of another hit (spec-mandated funnel); overlapping zones tick independently (spec accepts).
