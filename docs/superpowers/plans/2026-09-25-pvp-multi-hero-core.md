# PvP Multi-hero Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A DOM-free PvP arena simulation that steps 2–6 heroes from input intents at a fixed 30 Hz, playable locally against bots through a `pvp` title cheat, with single-player behaviour unchanged.

**Architecture:** New `renderer/pvp/` modules (`combat`, `hero`, `attacks`, `pickups`, `sim`, `bots`, `local`) compose the existing systems. Heroes are `type: 'hero'` entities, so projectiles, lightning and the hammer reach them through the paths they already use. The ~10 shared functions that read `state.player` get an optional trailing hero/caster argument defaulting to `state.player`, and `game.js` only gains a thin PvP branch in its loop.

**Tech Stack:** Vanilla ES modules (no bundler), Electron + web build, `node:test` + `node:assert/strict`, `playwright-core` for the live check.

**Spec:** `docs/superpowers/specs/2026-09-25-pvp-multi-hero-core-design.md` (roadmap: `docs/superpowers/specs/2026-09-25-pvp-roadmap.md`)

## Global Constraints

- Nothing under `renderer/pvp/` may reference `document`, `window`, the `keys` object or `render/*`, except `renderer/pvp/local.js`, which may take `keys` as a *parameter* but imports no DOM either. `renderer/ui/pvp-hud.js` touches the DOM only inside functions, never at import.
- Every PvP tuning number lives in `renderer/data/pvp.js`.
- Shared-system seams are optional trailing parameters defaulting to `state.player`. Existing single-player call sites are not edited, and the existing suite must pass unchanged.
- Fixed tick `PVP.tick = 1/30` s; `stepMatch` clamps a frame's `dt` to 0.25 s.
- Numbers from the spec: `MATCH_LENGTH 240`, `RESPAWN_DELAY 3`, `SPAWN_PROTECT 1.5`, `CREDIT_WINDOW 5`, `PVP_CC_MUL 0.5`, hero HP 10, plate protect override 1, flask +4 HP / 20 s, quiver +12 arrows / 15 s (Archer only), rune first at 45 s / 60 s after pickup / lasts 30 s, local bots 3.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Run the suite with `npm test`. A lone SIGSEGV from Node's runner on WSL is a known flake: re-run, don't chase it.

**Deliberate narrowing vs. the spec** (every item keeps the spec's behaviour; these only drop code no PvP kit can reach):
- No fire or bramble seams. No PvP kit fires a fireball, lays bramble or shoots an incendiary arrow, so `fire.js` and `zones.js` stay untouched and the sim's `detonate` hook is a no-op. "No self-damage" holds trivially.
- The arena's spawn and pickup points live in `renderer/data/pvp-arenas.js` and are read by the sim directly. `buildArena` is only used for the walled map with `columns`, so `map.js` is not edited.
- Offhand-blade alternation and draw bows are not ported; no kit has either.
- Crowd-control halving is applied by the sim after each tick, scaling any *increase* in `stunTimer`/`slowTimer`/`rootTimer` by `PVP.ccMul`. That catches every source (lightning stun, crossbow knockback-stun, thunderclap slow) without editing `status.js`.

## Review Focus

The five uncovered inputs most likely to bite a player, each pinned by a test in the task named:
1. **A frame hitch** (backgrounded tab, 5 s gap) should not fast-forward the match or freeze the tab; `stepMatch` clamps dt → Task 8 test "a 5 s hitch runs at most 8 ticks".
2. **Two heroes killing each other on the same tick** should both die, and both kills should count → Task 8 test "simultaneous kills both count".
3. **An arrow still in flight when its archer dies** should still credit the (dead) archer on a kill → Task 8 test "a dead owner's arrow still credits the owner".
4. **Dying while holding the rune or mid-charge** should mean respawning with the kit weapon and no stale charge → Task 8 test "death ends the rune and clears the charge".
5. **Pressing I / M / Escape / Q / Shift during a local PvP match** should not throw (`state` is null there) → Task 11 guards plus the Task 12 live check presses each key and asserts no page errors.

---

## File Structure

| File | Responsibility |
|---|---|
| `renderer/systems/factions.js` (edit) | `'hero'` counts as an enemy, so heroes are spell targets |
| `renderer/systems/hitbox.js` (edit) | `'hero'` uses `PLAYER_SHAPE` |
| `renderer/systems/player-damage.js` (edit) | `damagePlayer(..., hero = state.player)` |
| `renderer/systems/shield.js` (edit) | `tryBlock(state, from, player = state.player)` |
| `renderer/systems/spells.js` (edit) | `tryCast(..., { caster })`; primitives take the caster; bolts carry `owner` |
| `renderer/systems/magic.js` (edit) | `castCone(state, t, p = state.player)` skips the caster |
| `renderer/systems/spells/lightning.js` (edit) | `castLightning(state, tier, p)`; marks carry `owner`; a strike spares its owner and reports `owner` to `hurt` |
| `renderer/systems/hammer.js` (edit) | `applyChain(state, nodes, hooks, p = state.player)` |
| `renderer/systems/projectiles.js` (edit) | a projectile skips its `owner`; chain candidates exclude the owner |
| `renderer/systems/movement.js` (new) | `canMoveTo`, `moveEntity`, `PLAYER_HALF`, `PLAYER_SPEED`, `TILE_SIZE` (moved from game.js) |
| `renderer/systems/loadout.js` (new) | `applyLoadout`, `handPayload` (moved from game.js) |
| `renderer/data/pvp.js` (new) | all PvP tuning, kits, pickups, rune powers |
| `renderer/data/pvp-arenas.js` (new) | the `pillars` arena: size, columns, spawns, pickups |
| `renderer/pvp/combat.js` (new) | `heroById`, `isTargetable`, `foesOf`, `refreshTargets`, `hurtHero` |
| `renderer/pvp/hero.js` (new) | `makeHero`, `applyKit`, `placeHero`, `tickHeroStatus`, `tickHero`, `NEUTRAL_INPUT` |
| `renderer/pvp/attacks.js` (new) | `swing`, `castSpell`, `loose` |
| `renderer/pvp/pickups.js` (new) | `makePickups`, `tickPickups`, `grantRune`, `endRune`, `tickRunes` |
| `renderer/pvp/sim.js` (new) | `makeMatch`, `stepMatch`, `setClass`, `standings`, `farthestSpawn` |
| `renderer/pvp/bots.js` (new) | `botInput`, `nextStep` |
| `renderer/pvp/local.js` (new) | `LOCAL_ID`, `inputFromKeys`, `makeLocalMatch`, `localInputs`, `viewOf` |
| `renderer/ui/pvp-hud.js` (new) | `pvpHudModel` (pure), `updatePvpHud`, `hidePvpHud` |
| `renderer/render/canvas.js` (edit) | `drawHero` extraction, `otherHeroes`, hero/pickup drawing, name tags, rune glow |
| `renderer/systems/cheats.js`, `renderer/ui/menu.js`, `renderer/game.js` (edit) | the `pvp` cheat, class picker, results screen, loop branch |
| `tools/perf/trace.mjs` (edit) | accepts `pvp` as the level argument |
| `test/pvp-helpers.js` (new, not a test file) | `openMap`, `testMatch` for the PvP unit tests |
| `test/pvp-{seams,arena,hero,attacks,pickups,sim,bots,soak,render,ui}.test.js` (new) | tests |

---

### Task 1: Hero-aware damage, block, faction and hitbox seams

**Files:**
- Modify: `renderer/systems/factions.js` (`isEnemy`)
- Modify: `renderer/systems/hitbox.js` (`localShape`)
- Modify: `renderer/systems/player-damage.js` (`damagePlayer`)
- Modify: `renderer/systems/shield.js` (`tryBlock`)
- Test: `test/pvp-seams.test.js`

**Interfaces:**
- Produces: `damagePlayer(state, amount, kind, from = null, hero = state.player) → boolean`; `tryBlock(state, from, player = state.player) → boolean`; `isEnemy({type:'hero'}) === true`; `hitShape({type:'hero', px, py}).r === 12`.

- [ ] **Step 1: Write the failing tests**

Create `test/pvp-seams.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { damagePlayer } from '../renderer/systems/player-damage.js'
import { tryBlock } from '../renderer/systems/shield.js'
import { isEnemy, isHittable, isSpellTarget } from '../renderer/systems/factions.js'
import { hitShape, PLAYER_SHAPE } from '../renderer/systems/hitbox.js'
import { makeFeedback } from '../renderer/systems/feedback.js'

const hero = (over = {}) => ({ type: 'hero', id: 'h', px: 100, py: 100, hp: 10, maxHp: 10, facing: 'east',
  attackMode: 'melee', gear: { melee: { off: null, outfit: null }, ranged: { off: null, outfit: null }, magic: { off: null, outfit: null } },
  stamina: 100, ...over })

describe('seam: damagePlayer hero argument', () => {
  it('damages the given hero, not state.player', () => {
    const player = hero({ id: 'p' }), target = hero({ id: 't' })
    const state = { player, feedback: makeFeedback() }
    assert.equal(damagePlayer(state, 3, 'hit', null, target), true)
    assert.equal(target.hp, 7)
    assert.equal(player.hp, 10)
  })
  it('defaults to state.player when no hero is passed', () => {
    const state = { player: hero(), feedback: makeFeedback() }
    damagePlayer(state, 2, 'hit')
    assert.equal(state.player.hp, 8)
  })
  it("reads the given hero's outfit protect", () => {
    const target = hero()
    target.gear.melee.outfit = { outfitType: 'plate', protect: 1 }
    const state = { player: hero({ id: 'p' }), feedback: makeFeedback() }
    damagePlayer(state, 2, 'hit', null, target)
    assert.equal(target.hp, 9)
  })
})

describe('seam: tryBlock player argument', () => {
  it("blocks with the given hero's shield, not state.player's", () => {
    const target = hero({ blocking: true })
    target.gear.melee.off = { kind: 'shield', weaponType: 'buckler', blockCost: 8 }
    const state = { player: hero({ id: 'p' }) }
    assert.equal(tryBlock(state, { px: 130, py: 100 }, target), true)
    assert.equal(target.stamina, 92)
    assert.equal(target.blockedHit, true)
  })
  it('damagePlayer passes its hero to tryBlock (frontal hit blocked, rear hit lands)', () => {
    const target = hero({ blocking: true })
    target.gear.melee.off = { kind: 'shield', weaponType: 'buckler', blockCost: 8 }
    const state = { player: hero({ id: 'p' }), feedback: makeFeedback() }
    assert.equal(damagePlayer(state, 2, 'hit', { px: 130, py: 100 }, target), false)
    assert.equal(target.hp, 10)
    assert.equal(damagePlayer(state, 2, 'hit', { px: 70, py: 100 }, target), true)
    assert.equal(target.hp, 8)
  })
})

describe('seam: heroes are enemies and use the player shape', () => {
  it('a hero is an enemy, hittable and a spell target', () => {
    const h = hero()
    assert.equal(isEnemy(h), true)
    assert.equal(isHittable(h), true)
    assert.equal(isSpellTarget(h), true)
  })
  it('a hero hit shape is PLAYER_SHAPE', () => {
    assert.equal(hitShape(hero()).r, PLAYER_SHAPE.r)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/pvp-seams.test.js`
Expected: FAIL. `damagePlayer` damages `state.player`, `tryBlock` ignores its third argument, `isEnemy(hero)` is false, and the hero shape is r 8.

- [ ] **Step 3: Implement the seams**

`renderer/systems/player-damage.js`: replace the function header and its first line:

```js
export function damagePlayer(state, amount, kind, from = null, hero = state.player) {
  const player = hero
  if (kind === 'hit' && (player.invulnTimer ?? 0) > 0) return false
  if (kind === 'hit' && tryBlock(state, from, player)) return false
```
(the rest of the body is unchanged). Update the header comment's first line to: `// Single funnel for all player damage — for state.player, or any hero passed as the fifth argument (PvP).`

`renderer/systems/shield.js`, in `tryBlock`:

```js
export function tryBlock(state, from, player = state.player) {
  if (!player.blocking || !inBlockArc(player, from)) return false
```
(delete the old `const player = state.player` line.)

`renderer/systems/factions.js`, in `isEnemy`, add `|| e.type === 'hero'` after the `dragon_boss` line, and add this comment line above the function body's `return`: `// PvP heroes (renderer/pvp/) are every other hero's enemy.`

`renderer/systems/hitbox.js`, in `localShape`:

```js
  if (e.type === 'player' || e.type === 'hero') return PLAYER_SHAPE
```

- [ ] **Step 4: Run the new tests and the full suite**

Run: `node --test test/pvp-seams.test.js && npm test`
Expected: all PASS (the existing `player-damage`, `shield`, `factions` and `hitbox` tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/{player-damage,shield,factions,hitbox}.js test/pvp-seams.test.js
git commit -m "feat(pvp): hero-aware damage, block, faction and hit-shape seams

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Caster and owner seams in spells, cones, lightning, hammer and projectiles

**Files:**
- Modify: `renderer/systems/spells.js` (`castBolt`, `castZone`, `castSelf`, `tryCast`)
- Modify: `renderer/systems/magic.js` (`castCone`)
- Modify: `renderer/systems/spells/lightning.js` (`markStrike`, `castLightning`, `strike`)
- Modify: `renderer/systems/hammer.js` (`applyChain`)
- Modify: `renderer/systems/projectiles.js` (friendly branch)
- Test: `test/pvp-seams.test.js` (append)

**Interfaces:**
- Consumes: Task 1 (`isSpellTarget` includes heroes).
- Produces:
  - `tryCast(state, spellId, tier, { modules, hand, caster = state.player })`. A bolt spec carries `owner: caster.id` when the caster has an id. A module is called `module(state, tier, caster)`.
  - `castCone(state, t, p = state.player)`
  - `castLightning(state, tier = 'tap', p = state.player)`; `markStrike(state, x, y, owner)`. Marks carry `owner`, a strike skips `e.id === mark.owner`, and `hooks.hurt(e, dmg, { source: 'lightning', owner })`.
  - `applyChain(state, nodes, hooks, p = state.player)`
  - `stepProjectiles` skips entities with `e.id === p.owner` and excludes them from chain candidates.

- [ ] **Step 1: Append the failing tests**

Append to `test/pvp-seams.test.js`:

```js
import { tryCast } from '../renderer/systems/spells.js'
import { castCone } from '../renderer/systems/magic.js'
import { castLightning, tickLightning, LIGHTNING } from '../renderer/systems/spells/lightning.js'
import { applyChain } from '../renderer/systems/hammer.js'
import { stepProjectiles } from '../renderer/systems/projectiles.js'
import { TILE } from '../renderer/systems/entities.js'

const floor = (w = 20, h = 20) => Array.from({ length: h }, () => Array.from({ length: w }, () => ({ tile: TILE.FLOOR })))
const robed = over => {
  const h = hero({ attackMode: 'magic', ...over })
  h.gear.magic.outfit = { outfitType: 'robe', loadout: 'magic', protect: 0 }
  return h
}
const at = (x, y, over) => hero({ px: x * 32 + 16, py: y * 32 + 16, x, y, ...over })

describe('seam: tryCast caster', () => {
  it('a bolt from an explicit caster carries its owner and bills its tank', () => {
    const caster = robed({ id: 'm' })
    const state = { map: floor(), entities: [], player: hero({ id: 'p', stamina: 0 }) }
    const cast = tryCast(state, 'spark', 'tap', { caster })
    assert.equal(cast.ok, true)
    assert.equal(cast.projectiles[0].owner, 'm')
    assert.equal(caster.stamina, 92)
  })
  it('blink moves the caster, not state.player', () => {
    const caster = robed({ id: 'm', px: 5 * 32 + 16, py: 5 * 32 + 16, x: 5, y: 5, facing: 'east' })
    const state = { map: floor(), entities: [], player: hero({ id: 'p', px: 16, py: 16 }) }
    tryCast(state, 'blink', 'tap', { caster })
    assert.equal(caster.x, 9)
    assert.equal(state.player.px, 16)
  })
  it('without a caster the single-player bolt has no owner', () => {
    const state = { map: floor(), entities: [], player: robed({ id: undefined }) }
    const cast = tryCast(state, 'spark', 'tap')
    assert.equal('owner' in cast.projectiles[0], false)
  })
})

describe('seam: castCone caster', () => {
  it('the cone never catches its own caster and stuns the foe in front', () => {
    const caster = at(5, 5, { id: 'a', facing: 'east' })
    const foe = at(6, 5, { id: 'b' })
    const state = { entities: [caster, foe] }
    castCone(state, { mul: 1, stun: 1, knockback: 0, bossKnockback: 0 }, caster)
    assert.equal(foe.stunTimer, 1)
    assert.equal(caster.stunTimer, undefined)
  })
})

describe('seam: lightning owner', () => {
  it('marks carry the caster id; the strike spares the owner and names it to hurt', () => {
    const caster = at(5, 5, { id: 'a', facing: 'east' })
    const foe = at(8, 5, { id: 'b' })
    const state = { map: floor(), entities: [caster, foe], lightning: [], strikes: [] }
    const { marks } = castLightning(state, 'tap', caster)
    assert.equal(marks[0].owner, 'a')
    caster.px = foe.px; caster.py = foe.py   // the caster walks into its own strike
    const hits = []
    tickLightning(state, LIGHTNING.delay + 0.01, { hurt: (e, d, info) => hits.push([e.id, d, info.owner]) })
    assert.deepEqual(hits, [['b', LIGHTNING.damage, 'a']])
  })
})

describe('seam: applyChain caster', () => {
  it('arcs start at the given caster', () => {
    const caster = at(1, 1, { id: 'a' }), foe = at(3, 1, { id: 'b' })
    const state = { player: at(9, 9, { id: 'p' }), arcs: [] }
    applyChain(state, [{ e: foe, damage: 4 }], { hurt: () => {} }, caster)
    assert.equal(state.arcs[0].x0, caster.px)
  })
})

describe('seam: projectile owner', () => {
  const hooks = hits => ({ isHittable: () => true, hurt: (e, d) => { hits.push(e.id); return e }, detonate() {}, damagePlayer() {}, cull: es => es })
  it('flies through its owner and hits the next hero', () => {
    const a = at(5, 5, { id: 'a' }), b = at(7, 5, { id: 'b' })
    const state = { map: floor(), entities: [a, b], player: null,
      projectiles: [{ px: a.px, py: a.py, dx: 280, dy: 0, damage: 2, friendly: true, owner: 'a' }] }
    const hits = []
    for (let i = 0; i < 20 && state.projectiles.length; i++) stepProjectiles(state, 1 / 30, hooks(hits))
    assert.deepEqual(hits, ['b'])
  })
  it('a chaining bolt never arcs back to its owner', () => {
    const a = at(5, 5, { id: 'a' }), b = at(6, 5, { id: 'b' })
    const state = { map: floor(), entities: [a, b], player: null,
      projectiles: [{ px: b.px - 4, py: b.py, dx: 340, dy: 0, damage: 2, friendly: true, owner: 'a', chain: { left: 2, range: 96 } }] }
    const hits = []
    for (let i = 0; i < 30 && state.projectiles.length; i++) stepProjectiles(state, 1 / 30, hooks(hits))
    assert.deepEqual(hits, ['b'])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/pvp-seams.test.js`
Expected: the new describes FAIL. `owner` is missing, the caster argument is ignored, the strike hits the owner, and the arc starts at `state.player`.

- [ ] **Step 3: Implement**

`renderer/systems/spells.js`:
- `function castBolt(state, t, p = state.player) {` and delete its `const p = state.player`. After building `spec`, add `if (p.id !== undefined) spec.owner = p.id`.
- `function castZone(state, t, p = state.player) {` and delete its `const p = state.player`.
- `function castSelf(state, t, p = state.player) {` and delete its `const p = state.player`.
- `tryCast`:

```js
export function tryCast(state, spellId, tier = 'tap', { modules, hand = 'main', caster = state.player } = {}) {
  const p = caster
```
  and the dispatch:

```js
    case 'bolt': result = castBolt(state, t, p); break
    case 'cone': result = castCone(state, t, p); break
    case 'zone': result = castZone(state, t, p); break
    case 'self': result = castSelf(state, t, p); break
    default:     result = module(state, paid, p); break
```
  Extend the comment above `tryCast` with: `// `caster` defaults to state.player; PvP passes the hero casting.`

`renderer/systems/magic.js`, `castCone`:

```js
export function castCone(state, t, p = state.player) {
```
  Delete `const p = state.player`, and change the skip line to:

```js
    if (!e.hp || e.type === 'player' || e === p || isStoryCreature(e)) continue
```

`renderer/systems/spells/lightning.js`:
- `export function markStrike(state, x, y, owner) {` and `const mark = { x, y, t: 0, delay: LIGHTNING.delay, struck: false, ...(owner !== undefined && { owner }) }`.
- `export function castLightning(state, tier = 'tap', p = state.player) {`, delete `const p = state.player`, and call `markStrike(state, hit.x, hit.y, p?.id)`.
- In `strike`, first line of the loop body: `if (mark.owner !== undefined && e.id === mark.owner) continue`. Change the hurt call to `hooks?.hurt?.(e, LIGHTNING.damage, { source: 'lightning', owner: mark.owner })`.

`renderer/systems/hammer.js`, `applyChain`:

```js
export function applyChain(state, nodes, hooks = {}, p = state.player) {
```
  and delete `const p = state.player`.

`renderer/systems/projectiles.js`, friendly branch:
- In the target loop, after `if (!hooks.isHittable(e)) continue`, add: `if (p.owner !== undefined && e.id === p.owner) continue // PvP: a shot never hits its shooter`.
- In the chain candidates filter: `isSpellTarget(e) && e.type !== 'dragon_boss' && (p.owner === undefined || e.id !== p.owner))`.

- [ ] **Step 4: Run the new tests and the full suite**

Run: `node --test test/pvp-seams.test.js && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/{spells,magic,hammer,projectiles}.js renderer/systems/spells/lightning.js test/pvp-seams.test.js
git commit -m "feat(pvp): caster and owner seams for spells, lightning, hammer chain and projectiles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Move `canMoveTo`/`moveEntity` and `applyLoadout` out of game.js

**Files:**
- Create: `renderer/systems/movement.js`, `renderer/systems/loadout.js`
- Modify: `renderer/game.js`. Remove `const PLAYER_SPEED = 120` and `const PLAYER_HALF = 6` (lines ~81 and ~85), `function canMoveTo` and `function moveEntity` (lines ~320-340), `function applyLoadout` and `const handPayload` (lines ~659-705), then add imports.
- Test: `test/pvp-seams.test.js` (append)

**Interfaces:**
- Produces: `movement.js` exports `TILE_SIZE = 32`, `PLAYER_HALF = 6`, `PLAYER_SPEED = 120`, `canMoveTo(map, px, py, half = PLAYER_HALF) → boolean`, `moveEntity(e, dx, dy, map, half = PLAYER_HALF, boss = null)`. `loadout.js` exports `applyLoadout(player, po, warn = console.warn)` and `handPayload(contents)`.

- [ ] **Step 1: Append failing tests**

```js
import { canMoveTo, moveEntity, PLAYER_HALF } from '../renderer/systems/movement.js'
import { applyLoadout } from '../renderer/systems/loadout.js'
import { makePlayer } from '../renderer/systems/entities.js'

describe('movement.js', () => {
  it('canMoveTo refuses a box overlapping a wall', () => {
    const map = floor(5, 5); map[2][3].tile = TILE.WALL
    assert.equal(canMoveTo(map, 2 * 32 + 16, 2 * 32 + 16), true)
    assert.equal(canMoveTo(map, 3 * 32 - PLAYER_HALF + 1, 2 * 32 + 16), false)
  })
  it('moveEntity slides per axis and updates the tile', () => {
    const map = floor(5, 5); map[2][3].tile = TILE.WALL
    const e = { px: 2 * 32 + 16, py: 2 * 32 + 16 }
    moveEntity(e, 20, 20, map)
    assert.equal(e.px, 2 * 32 + 16)          // east blocked by the wall
    assert.equal(e.py, 2 * 32 + 36)          // south free
    assert.equal(e.y, 3)
  })
})

describe('loadout.js', () => {
  it('applies weapon, outfit and shield offhand', () => {
    const p = makePlayer(0, 0)
    applyLoadout(p, { weaponType: 'sword', outfits: ['plate'], offhand: { type: 'shield', weaponType: 'buckler' } }, () => {})
    assert.equal(p.weapon.weaponType, 'sword')
    assert.equal(p.gear.melee.outfit.outfitType, 'plate')
    assert.equal(p.gear.melee.off.kind, 'shield')
  })
  it('warns through the injected warn for an unknown weapon', () => {
    const warned = []
    applyLoadout(makePlayer(0, 0), { weaponType: 'nope' }, m => warned.push(m))
    assert.equal(warned.length, 1)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/pvp-seams.test.js`
Expected: FAIL. `Cannot find module .../movement.js`.

- [ ] **Step 3: Create the modules and rewire game.js**

`renderer/systems/movement.js`:

```js
// Hero movement against the map: the four-corner box test and the per-axis
// slide every walker uses. Lifted out of game.js so the PvP simulation
// (renderer/pvp/) steps heroes with the same rules. Pure: no DOM.
import { isWalkable } from './entities.js'
import { coreBlocks } from './capsules.js'

export const TILE_SIZE = 32
export const PLAYER_HALF = 6
export const PLAYER_SPEED = 120

export function canMoveTo(map, px, py, half = PLAYER_HALF) {
  const corners = [
    [px - half, py - half],
    [px + half, py - half],
    [px - half, py + half],
    [px + half, py + half],
  ]
  return corners.every(([cx, cy]) => {
    const tile = map[Math.floor(cy / TILE_SIZE)]?.[Math.floor(cx / TILE_SIZE)]
    return tile && isWalkable(tile.tile, tile)
  })
}

export function moveEntity(e, dx, dy, map, half = PLAYER_HALF, boss = null) {
  const free = (px, py) => canMoveTo(map, px, py, half) && !(boss && coreBlocks(px, py, half, boss))
  if (dx !== 0 && free(e.px + dx, e.py)) e.px += dx
  if (dy !== 0 && free(e.px, e.py + dy)) e.py += dy
  e.x = Math.floor(e.px / TILE_SIZE)
  e.y = Math.floor(e.py / TILE_SIZE)
}
```

`renderer/systems/loadout.js`: move `applyLoadout` and `handPayload` verbatim from game.js, with these changes:
- the signature becomes `export function applyLoadout(player, po, warn = console.warn)`;
- every `console.warn(` inside it becomes `warn(`;
- `export const handPayload = contents => { const { type, ...payload } = contents; return payload }`;
- add the imports the body needs:

```js
// Apply a loadout override — an arena config's `player`, a timewarp
// episode's kit, or a PvP class kit (renderer/data/pvp.js), all the same
// shape. Lifted out of game.js so the PvP simulation can import it.
import { WEAPON_TYPES, RANGED_WEAPON_TYPES, WAND_TYPES, SHIELD_TYPES, OUTFIT_TYPES,
  weaponContents, makeRangedContents, makeWandContents, makeShieldContents, makeOutfitContents,
  emptyAmmo } from './entities.js'
import { gearOf } from './inventory.js'
import { wearOutfit, RETIRED_TALENT_OUTFITS } from './outfits.js'
import { TALENTS } from './talents.js'
```
  Keep the original comment block above `applyLoadout`.

In `renderer/game.js`: delete the moved definitions and the two constants, then add

```js
import { canMoveTo, moveEntity, PLAYER_HALF, PLAYER_SPEED } from './systems/movement.js'
import { applyLoadout, handPayload } from './systems/loadout.js'
```
Leave every existing call site unchanged. Run `grep -n "canMoveTo\|moveEntity\|applyLoadout\|handPayload\|PLAYER_HALF\|PLAYER_SPEED" renderer/game.js` to confirm every use resolves to the imports (no local definitions left).

- [ ] **Step 4: Run tests and a syntax check of game.js**

Run: `node --test test/pvp-seams.test.js && npm test && node --check renderer/game.js`
Expected: all PASS; `node --check` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/movement.js renderer/systems/loadout.js renderer/game.js test/pvp-seams.test.js
git commit -m "refactor: movement and applyLoadout move from game.js into systems/

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: PvP tuning data and the arena

**Files:**
- Create: `renderer/data/pvp.js`, `renderer/data/pvp-arenas.js`
- Test: `test/pvp-arena.test.js`

**Interfaces:**
- Produces: `PVP`, `KITS`, `CLASSES`, `OUTFIT_OVERRIDES`, `PICKUPS`, `RUNE_POWER` (data/pvp.js); `PVP_ARENAS.pillars = { size:{w,h}, columns:[{x,y}], spawns:[{x,y}×6], pickups:[{kind,x,y}] }` (data/pvp-arenas.js).

- [ ] **Step 1: Write the failing test**

`test/pvp-arena.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PVP_ARENAS } from '../renderer/data/pvp-arenas.js'
import { KITS, CLASSES, RUNE_POWER, PVP } from '../renderer/data/pvp.js'
import { buildArena } from '../renderer/systems/map.js'
import { isWalkable } from '../renderer/systems/entities.js'

const arena = PVP_ARENAS.pillars
const { map } = buildArena({ size: arena.size, columns: arena.columns, enemies: [], chests: [] }, () => {})
const walk = ({ x, y }) => isWalkable(map[y]?.[x]?.tile, map[y]?.[x])

describe('pillars arena', () => {
  it('builds at its configured size', () => {
    assert.equal(map.length, arena.size.h)
    assert.equal(map[0].length, arena.size.w)
  })
  it('has six walkable spawns and walkable pickups', () => {
    assert.equal(arena.spawns.length, 6)
    for (const s of arena.spawns) assert.ok(walk(s), `spawn ${s.x},${s.y}`)
    for (const p of arena.pickups) assert.ok(walk(p), `${p.kind} ${p.x},${p.y}`)
  })
  it('has 2 flasks, 2 quivers and 1 rune', () => {
    const n = k => arena.pickups.filter(p => p.kind === k).length
    assert.deepEqual([n('flask'), n('quiver'), n('rune')], [2, 2, 1])
  })
  it('every spawn and pickup is reachable from the first spawn', () => {
    const seen = new Set([`${arena.spawns[0].x},${arena.spawns[0].y}`])
    const queue = [arena.spawns[0]]
    while (queue.length) {
      const c = queue.shift()
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: c.x + dx, y: c.y + dy }
        const k = `${n.x},${n.y}`
        if (!seen.has(k) && walk(n)) { seen.add(k); queue.push(n) }
      }
    }
    for (const p of [...arena.spawns, ...arena.pickups]) assert.ok(seen.has(`${p.x},${p.y}`), `${p.x},${p.y} unreachable`)
  })
  it('the columns really block (at least 40 column cells)', () => {
    assert.ok(arena.columns.length >= 40)
  })
})

describe('pvp data', () => {
  it('has a kit and a rune power for every class', () => {
    assert.deepEqual(CLASSES, ['warrior', 'archer', 'mage'])
    for (const c of CLASSES) { assert.ok(KITS[c]); assert.ok(RUNE_POWER[c]) }
  })
  it('matches the spec numbers', () => {
    assert.equal(PVP.matchLength, 240)
    assert.equal(PVP.ccMul, 0.5)
    assert.equal(PVP.creditWindow, 5)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/pvp-arena.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Create the data files**

`renderer/data/pvp.js`:

```js
// Every PvP tuning number (spec 2026-09-25-pvp-multi-hero-core-design.md).
// Sub-project 2 balances these; nothing else in renderer/pvp/ hard-codes one.
export const PVP = {
  tick: 1 / 30,          // s — the fixed simulation step (the server will run the same)
  maxFrame: 0.25,        // s — a longer frame is clamped, so a hitch never fast-forwards the match
  matchLength: 240,      // s
  respawnDelay: 3,       // s dead before respawning
  spawnProtect: 1.5,     // s untargetable after a respawn; attacking ends it early
  creditWindow: 5,       // s — the last hero to hurt you within this gets the kill
  ccMul: 0.5,            // every stun/slow/root on a hero lasts this fraction
  hp: 10,
  arrowSpeed: 280,       // px/s, as game.js PROJECTILE_SPEED
  blinkTrailDur: 0.2,    // s, as canvas.js BLINK_DUR
  localBots: 3,
}

export const CLASSES = ['warrior', 'archer', 'mage']

// One outfit per kit, so one loadout per life. `loadout` is applyLoadout's shape.
export const KITS = {
  warrior: { stance: 'melee',  loadout: { weaponType: 'sword', outfits: ['plate'], offhand: { type: 'shield', weaponType: 'buckler' } } },
  archer:  { stance: 'ranged', loadout: { rangedType: 'shortbow', outfits: ['ranger'], ammo: { arrow: 24 } } },
  mage:    { stance: 'magic',  loadout: { wandType: 'sparkwand', outfits: ['robe'], offhand: { type: 'wand', weaponType: 'blinkwand' } } },
}

// Plate's protect 2 would make every 1-2 damage weapon near-useless on the
// Warrior; in a match it is 1. Single-player's OUTFIT_TYPES stays as it is.
export const OUTFIT_OVERRIDES = { plate: { protect: 1 } }

export const PICKUPS = {
  flask:  { heal: 4, respawn: 20 },
  quiver: { arrows: 12, respawn: 15 },
  rune:   { firstSpawn: 45, respawn: 60, duration: 30 },
}

// What the rune turns each class's main hand into, for its duration.
export const RUNE_POWER = {
  warrior: { weaponType: 'ukonvasara' },
  archer:  { rangedType: 'crossbow', bolts: 10 },
  mage:    { wandType: 'stormwand' },
}
```

`renderer/data/pvp-arenas.js`:

```js
// Hand-authored PvP arenas. buildArena makes the walled room and its
// `columns`; the sim reads `spawns` and `pickups` itself. 32×24 tiles:
// interior x 1..30, y 1..22.
const rect = (x, y, w, h) => {
  const cells = []
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: x + dx, y: y + dy })
  return cells
}

export const PVP_ARENAS = {
  // Four corner pillars, wall segments on each side for cover, four posts
  // ringing the exposed centre where the rune sits.
  pillars: {
    size: { w: 32, h: 24 },
    columns: [
      ...rect(6, 5, 2, 2), ...rect(24, 5, 2, 2), ...rect(6, 17, 2, 2), ...rect(24, 17, 2, 2),
      ...rect(13, 4, 6, 1), ...rect(13, 19, 6, 1),
      ...rect(4, 9, 1, 6), ...rect(27, 9, 1, 6),
      ...rect(11, 9, 2, 1), ...rect(19, 9, 2, 1), ...rect(11, 14, 2, 1), ...rect(19, 14, 2, 1),
      ...rect(9, 11, 1, 2), ...rect(22, 11, 1, 2),
    ],
    spawns: [{ x: 2, y: 2 }, { x: 29, y: 2 }, { x: 2, y: 21 }, { x: 29, y: 21 }, { x: 15, y: 2 }, { x: 16, y: 21 }],
    pickups: [
      { kind: 'flask', x: 7, y: 12 }, { kind: 'flask', x: 24, y: 11 },
      { kind: 'quiver', x: 15, y: 6 }, { kind: 'quiver', x: 16, y: 17 },
      { kind: 'rune', x: 16, y: 12 },
    ],
  },
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/pvp-arena.test.js`
Expected: PASS. (The columns list 16 + 12 + 12 + 8 + 4 = 52 cells.)

- [ ] **Step 5: Commit**

```bash
git add renderer/data/pvp.js renderer/data/pvp-arenas.js test/pvp-arena.test.js
git commit -m "feat(pvp): tuning data, class kits and the pillars arena

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Heroes: combat helpers, kits, status and movement

**Files:**
- Create: `renderer/pvp/combat.js`, `renderer/pvp/hero.js`, `test/pvp-helpers.js`
- Test: `test/pvp-hero.test.js`

**Interfaces:**
- Consumes: Tasks 1, 3, 4.
- Produces:
  - `combat.js`:
    - `heroById(match, id) → hero|null`
    - `isTargetable(h) → boolean` (a living hero without spawn protection)
    - `foesOf(match, hero) → hero[]`
    - `refreshTargets(match)`, which sets `match.entities` to the targetable heroes
    - `hurtHero(match, target, amount, { kind = 'hit', by = null, from = null, melee = false }) → boolean`. It records `target.lastHitBy = { id, t: match.clock }`, pushes a `{ type:'hit' }` event, and on a blocked melee hit shoves `by` back `BLOCK_SHOVE`.
  - `hero.js`:
    - `NEUTRAL_INPUT`; `HeroInput = { move:{x,y}, facing: 'north'|'south'|'east'|'west'|null, attack, alt, sprint }`
    - `makeHero({ id, name, cls }) → hero`, `applyKit(hero, cls)`, `placeHero(hero, {x, y})`
    - `tickHeroStatus(hero, dt)`
    - `tickHero(match, hero, input, dt)`. This task implements timers, shield, facing, movement and walk; attacks are wired in Task 6 through the `tickMelee`/`tickMagic`/`tickRanged` stubs defined here.
  - Hero fields added on top of `makePlayer`: `type:'hero', id, name, cls, pendingCls, kills, deaths, dead, respawnT, spawnProtect, lastHitBy, rune, needRelease, prevAlt, blinkTrail`.
  - `test/pvp-helpers.js`: `openMap(w, h)`, `testMatch(heroes, map?)`.

- [ ] **Step 1: Write the helpers and the failing tests**

`test/pvp-helpers.js`:

```js
// Shared fixtures for the PvP unit tests (not itself a test file).
import { TILE } from '../renderer/systems/entities.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { refreshTargets } from '../renderer/pvp/combat.js'

export const openMap = (w = 20, h = 20) => Array.from({ length: h }, (_, y) =>
  Array.from({ length: w }, (_, x) => ({ tile: x === 0 || y === 0 || x === w - 1 || y === h - 1 ? TILE.WALL : TILE.FLOOR })))

export function testMatch(heroes, map = openMap()) {
  const match = { map, heroes, entities: [], projectiles: [], lightning: [], strikes: [], arcs: [],
    shockwaves: [], zones: [], fireZones: [], feedback: makeFeedback(), sfx: null, pickups: [],
    clock: 0, acc: 0, ended: false, events: [], inputs: {} }
  refreshTargets(match)
  return match
}
```

`test/pvp-hero.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeHero, placeHero, tickHero, tickHeroStatus, NEUTRAL_INPUT, applyKit } from '../renderer/pvp/hero.js'
import { hurtHero, foesOf, isTargetable } from '../renderer/pvp/combat.js'
import { PVP } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })
const hero = (id, cls, cell = { x: 5, y: 5 }) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const dt = PVP.tick

describe('makeHero / applyKit', () => {
  it('a warrior wears plate at protect 1, holds a sword and a buckler, fights as melee', () => {
    const h = makeHero({ id: 'w', name: 'W', cls: 'warrior' })
    assert.equal(h.type, 'hero')
    assert.equal(h.attackMode, 'melee')
    assert.equal(h.weapon.weaponType, 'sword')
    assert.equal(h.gear.melee.outfit.protect, 1)
    assert.equal(h.gear.melee.off.kind, 'shield')
    assert.equal(h.hp, 10)
  })
  it('an archer has a shortbow and 24 arrows; a mage a spark wand and a blink offhand', () => {
    const a = makeHero({ id: 'a', name: 'A', cls: 'archer' })
    assert.equal(a.ranged.weaponType, 'shortbow')
    assert.equal(a.ammo.arrow, 24)
    const m = makeHero({ id: 'm', name: 'M', cls: 'mage' })
    assert.equal(m.wand.weaponType, 'sparkwand')
    assert.equal(m.gear.magic.off.weaponType, 'blinkwand')
  })
  it('applyKit fully resets a hero to a new class', () => {
    const h = makeHero({ id: 'x', name: 'X', cls: 'warrior' })
    h.hp = 1; h.stunTimer = 2
    applyKit(h, 'archer')
    assert.equal(h.cls, 'archer')
    assert.equal(h.weapon, null)
    assert.equal(h.gear.melee.outfit, null)
    assert.equal(h.hp, 10)
    assert.equal(h.stunTimer, 0)
  })
  it('rejects an unknown class', () => {
    assert.throws(() => makeHero({ id: 'x', name: 'X', cls: 'bard' }), /unknown class/)
  })
})

describe('tickHero movement', () => {
  it('walks at PLAYER_SPEED and faces the input facing', () => {
    const h = hero('a', 'archer'); const m = testMatch([h])
    const x0 = h.px
    tickHero(m, h, input({ move: { x: 1, y: 0 }, facing: 'east' }), dt)
    assert.ok(Math.abs(h.px - x0 - 120 * dt) < 1e-6)
    assert.equal(h.facing, 'east')
  })
  it('a stunned hero neither moves nor turns', () => {
    const h = hero('a', 'archer'); const m = testMatch([h]); h.stunTimer = 1
    const x0 = h.px
    tickHero(m, h, input({ move: { x: 1, y: 0 }, facing: 'north' }), dt)
    assert.equal(h.px, x0); assert.equal(h.facing, 'south')
  })
  it('a rooted hero does not move; a slowed one moves at slowMul', () => {
    const r = hero('r', 'archer'); const m = testMatch([r]); r.rootTimer = 1
    const x0 = r.px
    tickHero(m, r, input({ move: { x: 1, y: 0 } }), dt)
    assert.equal(r.px, x0)
    const s = hero('s', 'archer'); s.slowTimer = 1; s.slowMul = 0.5
    const x1 = s.px
    tickHero(testMatch([s]), s, input({ move: { x: 1, y: 0 } }), dt)
    assert.ok(Math.abs(s.px - x1 - 60 * dt) < 1e-6)
  })
  it('holding alt raises the warrior shield and halves speed', () => {
    const h = hero('w', 'warrior'); const m = testMatch([h])
    const x0 = h.px
    tickHero(m, h, input({ move: { x: 1, y: 0 }, alt: true }), dt)
    assert.equal(h.blocking, true)
    assert.ok(Math.abs(h.px - x0 - 60 * dt) < 1e-6)
  })
  it('a dead hero is not ticked', () => {
    const h = hero('a', 'archer'); const m = testMatch([h]); h.dead = true
    const x0 = h.px
    tickHero(m, h, input({ move: { x: 1, y: 0 } }), dt)
    assert.equal(h.px, x0)
  })
  it('spawn protection counts down', () => {
    const h = hero('a', 'archer'); const m = testMatch([h]); h.spawnProtect = 1
    tickHero(m, h, NEUTRAL_INPUT, 0.5)
    assert.equal(h.spawnProtect, 0.5)
  })
})

describe('tickHeroStatus', () => {
  it('counts stun, slow and root down and thaws a freeze', () => {
    const h = hero('a', 'archer'); h.stunTimer = 1; h.slowTimer = 1; h.rootTimer = 1; h.frozen = true
    tickHeroStatus(h, 1)
    assert.equal(h.stunTimer, 0); assert.ok(h.slowTimer <= 0); assert.ok(h.rootTimer <= 0); assert.equal(h.frozen, false)
  })
})

describe('combat helpers', () => {
  it('hurtHero damages, records the attacker and emits a hit event', () => {
    const a = hero('a', 'archer', { x: 4, y: 5 }), b = hero('b', 'archer'); const m = testMatch([a, b]); m.clock = 7
    assert.equal(hurtHero(m, b, 2, { by: a }), true)
    assert.equal(b.hp, 8)
    assert.deepEqual(b.lastHitBy, { id: 'a', t: 7 })
    assert.deepEqual(m.events[0], { type: 'hit', target: 'b', by: 'a', amount: 2 })
  })
  it('never hurts the attacker itself, a dead hero or a spawn-protected one', () => {
    const a = hero('a', 'archer'); const m = testMatch([a])
    assert.equal(hurtHero(m, a, 2, { by: a }), false)
    a.spawnProtect = 1
    assert.equal(hurtHero(m, a, 2, {}), false)
    a.spawnProtect = 0; a.dead = true
    assert.equal(hurtHero(m, a, 2, {}), false)
    assert.equal(a.hp, 10)
  })
  it('a blocked melee hit shoves the attacker back', () => {
    const a = hero('a', 'archer', { x: 6, y: 5 }), w = hero('w', 'warrior'); const m = testMatch([a, w])
    w.facing = 'east'; w.blocking = true
    assert.equal(hurtHero(m, w, 2, { by: a, melee: true }), false)
    assert.ok(a.knockback && a.knockback.vx > 0)
  })
  it('foesOf skips the hero itself and untargetable heroes', () => {
    const a = hero('a', 'archer'), b = hero('b', 'archer'), c = hero('c', 'archer'); c.spawnProtect = 1
    const m = testMatch([a, b, c])
    assert.deepEqual(foesOf(m, a).map(h => h.id), ['b'])
    assert.equal(isTargetable(c), false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/pvp-hero.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement `combat.js` and `hero.js`**

`renderer/pvp/combat.js`:

```js
// Hero-vs-hero damage for the PvP simulation. Every hit on a hero goes
// through hurtHero, which hands it to damagePlayer — so shield blocks, outfit
// protect and i-frames are exactly single-player's — and records who dealt it
// for kill credit. Pure: no DOM.
import { damagePlayer } from '../systems/player-damage.js'
import { startKnockback } from '../systems/knockback.js'
import { BLOCK_SHOVE } from '../systems/shield.js'

export const heroById = (match, id) => id == null ? null : match.heroes.find(h => h.id === id) ?? null

export const isTargetable = h => h?.type === 'hero' && !h.dead && !(h.spawnProtect > 0)

export const foesOf = (match, hero) => match.heroes.filter(h => h !== hero && isTargetable(h))

// match.entities is what stepProjectiles, lightning and cones sweep: the
// targetable heroes only. Rebuilt whenever a hero dies, respawns or loses
// its spawn protection.
export function refreshTargets(match) {
  match.entities = match.heroes.filter(isTargetable)
}

export function hurtHero(match, target, amount, { kind = 'hit', by = null, from = null, melee = false } = {}) {
  if (!isTargetable(target)) return false
  if (by && by === target) return false
  const at = from ?? (by ? { px: by.px, py: by.py } : null)
  const landed = damagePlayer(match, amount, kind, at, target)
  if (!landed) {
    // A shield took a melee blow: the striker is pushed back, as enemies are.
    if (melee && by && target.blockedHit) startKnockback(by, by.px - target.px, by.py - target.py, BLOCK_SHOVE)
    return false
  }
  if (by) target.lastHitBy = { id: by.id, t: match.clock }
  match.events.push({ type: 'hit', target: target.id, by: by?.id ?? null, amount })
  return true
}
```

`renderer/pvp/hero.js`:

```js
// One PvP hero: a makePlayer body with an id, a class kit and match
// bookkeeping, stepped from an input intent rather than from keys. The
// per-hero slice of game.js's update() (movement, shield, cooldowns, the
// charge/tap logic of each loadout), ported so it runs headless.
import { makePlayer, defaultGear, emptyAmmo, DIRS } from '../systems/entities.js'
import { applyLoadout } from '../systems/loadout.js'
import { gearOf, outfitOf, STANCES } from '../systems/inventory.js'
import { moveEntity, PLAYER_HALF, PLAYER_SPEED, TILE_SIZE } from '../systems/movement.js'
import { tickShield, BLOCK_SPEED_MUL } from '../systems/shield.js'
import { tickStamina, spendStamina, sprintProfile, STAMINA_MAX } from '../systems/stamina.js'
import { tickStatus } from '../systems/status.js'
import { tickRain, rainSlow } from '../systems/hammer.js'
import { tickWalk } from '../systems/walk.js'
import { chargeMoveFactor } from '../systems/melee.js'
import { GUST_CHARGE } from '../systems/magic.js'
import { KITS, OUTFIT_OVERRIDES, PVP } from '../data/pvp.js'

export const NEUTRAL_INPUT = Object.freeze({ move: Object.freeze({ x: 0, y: 0 }), facing: null, attack: false, alt: false, sprint: false })

export function makeHero({ id, name, cls }) {
  const h = makePlayer(0, 0)
  Object.assign(h, {
    type: 'hero', id, name, cls, pendingCls: null,
    kills: 0, deaths: 0, dead: false, respawnT: 0, spawnProtect: 0, lastHitBy: null,
    rune: null, needRelease: false, prevAlt: false, blinkTrail: null,
    facing: 'south', attackTimer: 0, attackDuration: 0.2, attackStyle: 'arc', attackFacing: 'south',
  })
  applyKit(h, cls)
  return h
}

// Strip the hero back to a fresh body and dress it in `cls`'s kit. Called at
// creation and at every respawn, so nothing from the last life survives.
export function applyKit(hero, cls) {
  const kit = KITS[cls]
  if (!kit) throw new Error(`pvp: unknown class "${cls}"`)
  hero.cls = cls
  hero.weapon = null; hero.ranged = null; hero.wand = null
  hero.ammo = emptyAmmo(); hero.gear = defaultGear(); hero.talents = []
  applyLoadout(hero, kit.loadout)
  hero.attackMode = kit.stance
  for (const stance of STANCES) {
    const o = gearOf(hero, stance).outfit
    if (o && OUTFIT_OVERRIDES[o.outfitType]) Object.assign(o, OUTFIT_OVERRIDES[o.outfitType])
  }
  hero.maxHp = PVP.hp; hero.hp = PVP.hp
  hero.stamina = STAMINA_MAX; hero.maxStamina = STAMINA_MAX; hero.staminaRegenT = 0; hero.staminaRefusedT = 0
  hero.charging = null; hero.rune = null; hero.shock = undefined; hero.rain = undefined
  hero.stunTimer = 0; hero.slowTimer = 0; hero.slowMul = 1; hero.rootTimer = 0; hero.frozen = false
  hero.knockback = null; hero.invulnTimer = 0; hero.blocking = false; hero.shieldDropT = 0; hero.blockedHit = false
  hero.meleeCooldown = 0; hero.rangedCooldown = 0; hero.magicCooldown = 0; hero.offCooldown = 0
  hero.needRelease = false; hero.blinkTrail = null
}

export function placeHero(hero, { x, y }) {
  hero.x = x; hero.y = y
  hero.px = x * TILE_SIZE + TILE_SIZE / 2
  hero.py = y * TILE_SIZE + TILE_SIZE / 2
  hero._wpx = hero.px; hero._wpy = hero.py   // no walk sway from the teleport
}

// Status timers. The sim runs this for every hero before the CC snapshot, so
// only CC applied *during* the tick is scaled by PVP.ccMul.
export function tickHeroStatus(hero, dt) {
  hero.stunTimer = Math.max(0, (hero.stunTimer ?? 0) - dt)
  tickStatus(hero, dt)
}

export function tickHero(match, hero, input = NEUTRAL_INPUT, dt) {
  if (hero.dead) return
  hero.meleeCooldown = Math.max(0, hero.meleeCooldown - dt)
  hero.rangedCooldown = Math.max(0, hero.rangedCooldown - dt)
  hero.attackTimer = Math.max(0, hero.attackTimer - dt)
  hero.invulnTimer = Math.max(0, hero.invulnTimer - dt)
  hero.magicCooldown = Math.max(0, hero.magicCooldown - dt)
  hero.offCooldown = Math.max(0, hero.offCooldown - dt)
  hero.staminaRefusedT = Math.max(0, hero.staminaRefusedT - dt)
  hero.spawnProtect = Math.max(0, hero.spawnProtect - dt)
  tickStamina(hero, dt)
  tickRain(hero, dt)
  if (hero.blinkTrail) {
    hero.blinkTrail.t += dt
    if (hero.blinkTrail.t >= PVP.blinkTrailDur) hero.blinkTrail = null
  }

  const stunned = hero.stunTimer > 0
  if (stunned) hero.charging = null
  // After a release the attack must be let go before it can wind up again
  // (game.js does this by clearing keys[' ']).
  if (!input.attack) hero.needRelease = false
  const altEdge = !!input.alt && !hero.prevAlt
  hero.prevAlt = !!input.alt
  hero.blockedHit = false
  const blocking = tickShield(hero, !!input.alt && !stunned, dt)
  if (blocking) hero.charging = null
  if (!stunned && input.facing && DIRS[input.facing]) hero.facing = input.facing

  let vx = Math.sign(input.move?.x ?? 0), vy = Math.sign(input.move?.y ?? 0)
  if (vx !== 0 && vy !== 0) { vx /= Math.SQRT2; vy /= Math.SQRT2 }
  const moving = vx !== 0 || vy !== 0
  const profile = sprintProfile(hero.attackMode, { drainMul: outfitOf(hero, hero.attackMode)?.sprintDrain ?? 1 })
  const sprinting = moving && !!input.sprint && !hero.charging && !blocking && hero.stamina > 0
  const chargeFactor = hero.charging
    ? (hero.charging.kind === 'spell' ? GUST_CHARGE.moveFactor : chargeMoveFactor(hero.weapon?.weaponType))
    : 1
  const slow = hero.slowTimer > 0 ? hero.slowMul : 1
  const speed = PLAYER_SPEED * chargeFactor * rainSlow(hero) * slow *
    (blocking ? BLOCK_SPEED_MUL : 1) * (sprinting ? profile.speedMul : 1)
  if (sprinting) spendStamina(hero, profile.drain * dt)
  if (!stunned && !(hero.rootTimer > 0)) moveEntity(hero, vx * speed * dt, vy * speed * dt, match.map, PLAYER_HALF)
  tickWalk(hero, dt)

  if (stunned) return
  const attacking = !!input.attack && !hero.needRelease && !blocking
  if (hero.attackMode === 'melee') tickMelee(match, hero, input, attacking, dt)
  else if (hero.attackMode === 'magic') tickMagic(match, hero, input, attacking, altEdge, dt)
  else if (hero.attackMode === 'ranged') tickRanged(match, hero, attacking)
}

// Attacks land in Task 6 (renderer/pvp/attacks.js).
function tickMelee() {}
function tickMagic() {}
function tickRanged() {}
```

Check before running: `STANCES` and `STAMINA_MAX` are exported (`inventory.js:97`, `stamina.js:4`). `sprintProfile(mode, opts)` returns `{ speedMul, drain }`; confirm with `sed -n 79,88p renderer/systems/stamina.js`.

- [ ] **Step 4: Run tests**

Run: `node --test test/pvp-hero.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/pvp/combat.js renderer/pvp/hero.js test/pvp-helpers.js test/pvp-hero.test.js
git commit -m "feat(pvp): heroes — class kits, status, movement and hero-vs-hero damage

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Hero attacks: melee, spells and the bow

**Files:**
- Create: `renderer/pvp/attacks.js`
- Modify: `renderer/pvp/hero.js` (replace the three stubs)
- Test: `test/pvp-attacks.test.js`

**Interfaces:**
- Consumes: `hurtHero`, `foesOf` (Task 5); seams from Task 2.
- Produces: `swing(match, hero, mods)`, `castSpell(match, hero, spellId, tier, hand) → cast`, `loose(match, hero) → shot`. Every successful attack sets `hero.spawnProtect = 0`. Projectiles carry `owner: hero.id`. A full-tier hammer hit sets `target.shock.owner`. An over-tier hammer never hits its wielder, and a whiff rains on the wielder.

- [ ] **Step 1: Write the failing tests**

`test/pvp-attacks.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeHero, placeHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { swing } from '../renderer/pvp/attacks.js'
import { resolveCharge } from '../renderer/systems/melee.js'
import { weaponContents, makeWandContents } from '../renderer/systems/entities.js'
import { PVP } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })
const hero = (id, cls, cell) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const dt = PVP.tick

describe('melee', () => {
  it('a sword tap hits the foe in front for 2, knocks it back and credits the swinger', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 })
    w.facing = 'east'
    const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)
    assert.equal(a.hp, 8)
    assert.equal(a.lastHitBy.id, 'w')
    assert.ok(a.knockback)
    assert.ok(w.meleeCooldown > 0)
  })
  it('misses a foe behind the swinger', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 4, y: 5 })
    const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)
    assert.equal(a.hp, 10)
  })
  it('attacking ends spawn protection', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); w.spawnProtect = 1
    tickHero(testMatch([w]), w, input({ attack: true, facing: 'east' }), dt)
    assert.equal(w.spawnProtect, 0)
  })
  it('an overcharged hammer chains 4/3 over two foes and never zaps its wielder', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); w.facing = 'east'
    w.weapon = weaponContents('ukonvasara')
    const a = hero('a', 'archer', { x: 6, y: 5 }), b = hero('b', 'archer', { x: 8, y: 5 })
    const m = testMatch([w, a, b])
    swing(m, w, resolveCharge('ukonvasara', 5))
    assert.equal(a.hp, 6)
    assert.equal(b.hp, 7)
    assert.equal(w.hp, 10)
    assert.equal(m.arcs.length, 2)
  })
  it('an overcharged whiff rains on the wielder and hurts nobody', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); w.facing = 'east'
    w.weapon = weaponContents('ukonvasara')
    const m = testMatch([w])
    swing(m, w, resolveCharge('ukonvasara', 5))
    assert.ok(w.rain)
    assert.equal(w.hp, 10)
  })
  it("a full hammer blow shocks the foe with the wielder's name on it", () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); w.facing = 'east'
    w.weapon = weaponContents('ukonvasara')
    const a = hero('a', 'archer', { x: 6, y: 5 })
    swing(testMatch([w, a]), w, resolveCharge('ukonvasara', 0.6))
    assert.equal(a.shock.owner, 'w')
  })
})

describe('magic', () => {
  it('holding then releasing attack casts a spark bolt owned by the mage', () => {
    const mg = hero('m', 'mage', { x: 5, y: 5 })
    const m = testMatch([mg])
    tickHero(m, mg, input({ attack: true, facing: 'east' }), dt)
    assert.equal(mg.charging?.kind, 'spell')
    tickHero(m, mg, input({ attack: false }), dt)
    assert.equal(m.projectiles.length, 1)
    assert.equal(m.projectiles[0].owner, 'm')
    assert.equal(mg.charging, null)
  })
  it('a held attack auto-releases once and waits for a let-go before charging again', () => {
    const mg = hero('m', 'mage', { x: 5, y: 5 })
    const m = testMatch([mg])
    for (let i = 0; i < 90; i++) tickHero(m, mg, input({ attack: true, facing: 'east' }), dt)
    assert.equal(m.projectiles.length, 1)
    assert.equal(mg.charging, null)
  })
  it('an alt press blinks the mage four tiles along its facing, once per press', () => {
    const mg = hero('m', 'mage', { x: 5, y: 5 })
    const m = testMatch([mg])
    tickHero(m, mg, input({ alt: true, facing: 'east' }), dt)
    assert.equal(mg.x, 9)
    assert.ok(mg.blinkTrail)
    tickHero(m, mg, input({ alt: true, facing: 'east' }), dt)
    assert.equal(mg.x, 9)
  })
  it('a storm wand marks lightning owned by the mage', () => {
    const mg = hero('m', 'mage', { x: 5, y: 5 }); mg.wand = makeWandContents('stormwand')
    const m = testMatch([mg])
    tickHero(m, mg, input({ attack: true, facing: 'east' }), dt)
    tickHero(m, mg, input({ attack: false }), dt)
    assert.equal(m.lightning[0].owner, 'm')
  })
})

describe('ranged', () => {
  it('holding attack streams arrows on the bow cooldown, each owned by the archer', () => {
    const ar = hero('a', 'archer', { x: 5, y: 5 })
    const m = testMatch([ar])
    for (let i = 0; i < 30; i++) tickHero(m, ar, input({ attack: true, facing: 'east' }), dt)
    assert.equal(m.projectiles.length, 2)   // shortbow cooldown 0.6 s over 1 s
    assert.ok(m.projectiles.every(p => p.owner === 'a' && p.dx > 0))
    assert.equal(ar.ammo.arrow, 22)
  })
  it('no arrows, no shot', () => {
    const ar = hero('a', 'archer', { x: 5, y: 5 }); ar.ammo.arrow = 0
    const m = testMatch([ar])
    tickHero(m, ar, input({ attack: true, facing: 'east' }), dt)
    assert.equal(m.projectiles.length, 0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/pvp-attacks.test.js`
Expected: FAIL. `attacks.js` is not found, and the stubs do nothing.

- [ ] **Step 3: Implement**

`renderer/pvp/attacks.js`:

```js
// A hero's three ways to hurt another: the melee swing (sword, and the
// rune's Ukonvasara with its shock, clap and chain), a spell cast from
// either hand, and a bow shot. Ported from game.js's update(), aimed at
// foesOf() instead of state.entities, and every hit routed through
// hurtHero. Pure: no DOM.
import { DIRS, FACING_ANGLE } from '../systems/entities.js'
import { getAttack, getSwingArc, inSwing, tierMods } from '../systems/melee.js'
import { meleeCost, canAfford, spendStamina } from '../systems/stamina.js'
import { nearestPoint } from '../systems/hitbox.js'
import { shatterBonus } from '../systems/status.js'
import { startKnockback } from '../systems/knockback.js'
import { applyShock, thunderclap, chainNodes, applyChain, applyRain, lightningMods, HAMMER } from '../systems/hammer.js'
import { tryCast } from '../systems/spells.js'
import { castLightning } from '../systems/spells/lightning.js'
import { tryFire } from '../systems/ranged.js'
import { sfx } from '../systems/sfx.js'
import { hurtHero, foesOf } from './combat.js'
import { PVP } from '../data/pvp.js'

const MODULES = { lightning: castLightning }

export function swing(match, hero, mods) {
  hero.spawnProtect = 0
  const wpn = hero.weapon
  const wt = wpn.weaponType
  const cost = meleeCost(wt, mods.tier)
  if (!canAfford(hero, cost)) {
    mods = tierMods('tap', wt)                 // starved: a weak swing that empties the tank
    hero.staminaRefusedT = 0.4
    spendStamina(hero, hero.stamina)
  } else {
    spendStamina(hero, cost)
  }
  const atk = getAttack(wt)
  hero.meleeCooldown = atk.cooldown * mods.cooldownMul
  hero.swingHand = 'main'
  hero.attackTimer = atk.duration
  hero.attackDuration = atk.duration
  hero.attackStyle = atk.style
  hero.attackFacing = hero.facing
  hero.attackReachMul = mods.reachMul
  sfx(match, 'melee-swing', { px: hero.px, py: hero.py })

  const dmg = Math.max(1, Math.round((wpn.damage ?? 1) * mods.dmgMul))
  const fa = FACING_ANGLE[hero.facing] ?? 0
  const arc = getSwingArc(atk.style)
  const bodyHit = e => {
    const n = nearestPoint(e, hero.px, hero.py)
    return inSwing(arc.reach * mods.reachMul, arc.halfAngle, fa, n.x - hero.px, n.y - hero.py)
  }
  const hammer = !!wpn.lightning
  const zap = hammer && mods.tier === 'over'   // the overcharge lands no blow: all its damage is lightning
  const foes = foesOf(match, hero)
  const struck = []
  for (const e of foes) {
    if (!bodyHit(e)) continue
    struck.push(e)
    if (zap) continue
    if (!hurtHero(match, e, dmg + shatterBonus(e), { by: hero, melee: true })) continue
    startKnockback(e, e.px - hero.px, e.py - hero.py, atk.knockback * mods.kbMul)
    sfx(match, 'melee-hit', { px: e.px, py: e.py })
    if (hammer && mods.tier === 'full') { applyShock(e); e.shock.owner = hero.id }
  }
  if (zap) {
    thunderclap(hero, foes)
    match.shockwaves.push({ px: hero.px, py: hero.py, t: 0, dur: 0.35, maxRadius: HAMMER.clap.radius, color: '#e9d5ff' })
    sfx(match, 'thunder', { px: hero.px, py: hero.py })
    // PvP drops the chain's last hop onto its own wielder (spec §2).
    const nodes = chainNodes(hero, struck, foes, lightningMods(hero)).filter(n => !n.player)
    if (nodes.length) {
      applyChain(match, nodes, { hurt: (e, d) => hurtHero(match, e, d, { kind: 'lightning', by: hero }) }, hero)
      sfx(match, 'crackle', { px: hero.px, py: hero.py })
    } else {
      applyRain(hero)
    }
  }
}

export function castSpell(match, hero, spellId, tier, hand = 'main') {
  const cast = tryCast(match, spellId, tier, { modules: MODULES, hand, caster: hero })
  if (!cast.ok) {
    if (cast.reason === 'stamina') hero.staminaRefusedT = 0.4
    return cast
  }
  hero.spawnProtect = 0
  sfx(match, 'magic-cast', { px: hero.px, py: hero.py })
  if (cast.projectiles) match.projectiles.push(...cast.projectiles)
  if (cast.from) hero.blinkTrail = { from: cast.from, to: cast.to, t: 0 }
  return cast
}

export function loose(match, hero) {
  const shot = tryFire(hero)
  if (!shot.ok) return shot
  hero.spawnProtect = 0
  const [dx, dy] = DIRS[hero.facing] ?? DIRS.east
  const proj = { px: hero.px, py: hero.py, dx: dx * PVP.arrowSpeed, dy: dy * PVP.arrowSpeed,
    damage: shot.damage, color: shot.color, shape: shot.shape, friendly: true, owner: hero.id }
  if (shot.pierce !== undefined) proj.pierce = shot.pierce
  if (shot.fork) proj.fork = { ...shot.fork }
  if (shot.onHit) proj.onHit = { ...shot.onHit }
  match.projectiles.push(proj)
  sfx(match, 'ranged-shot', { px: hero.px, py: hero.py })
  return shot
}
```

In `renderer/pvp/hero.js`, add the imports

```js
import { isChargeWeapon, shouldAutoRelease, resolveCharge } from '../systems/melee.js'
import { resolveGustTier, shouldAutoReleaseGust } from '../systems/magic.js'
import { spellFor } from '../systems/spells.js'
import { offhand } from '../systems/inventory.js'
import { swing, castSpell, loose } from './attacks.js'
```
(merge them into the existing `melee.js`/`magic.js`/`inventory.js` import lines) and replace the three stubs:

```js
// Light blades swing the instant attack lands; charge weapons (the rune's
// hammer) wind up while it is held and swing on release, tiered by hold.
function tickMelee(match, hero, input, attacking, dt) {
  const wt = hero.weapon?.weaponType
  if (!wt) { hero.charging = null; return }
  if (isChargeWeapon(wt)) {
    if (hero.charging) {
      if (input.attack && !shouldAutoRelease(wt, hero.charging.t)) hero.charging.t += dt
      else {
        const held = hero.charging.t
        hero.charging = null
        hero.needRelease = true
        swing(match, hero, resolveCharge(wt, held))
      }
    } else if (attacking && hero.meleeCooldown <= 0) hero.charging = { t: 0 }
  } else {
    if (hero.charging && !hero.charging.kind) hero.charging = null
    if (attacking && hero.meleeCooldown <= 0) swing(match, hero, resolveCharge(wt, 0))
  }
}

// Hold to charge the main wand, release to cast; an offhand wand casts a
// tap on each alt press, on its own cooldown.
function tickMagic(match, hero, input, attacking, altEdge, dt) {
  if (hero.charging?.kind === 'spell') {
    if (input.attack && !shouldAutoReleaseGust(hero.charging.t)) hero.charging.t += dt
    else {
      const tier = resolveGustTier(hero.charging.t)
      hero.charging = null
      hero.needRelease = true
      castSpell(match, hero, spellFor(hero).id, tier, 'main')
    }
  } else if (attacking && hero.magicCooldown <= 0) hero.charging = { t: 0, kind: 'spell' }
  if (altEdge && offhand(hero)?.kind === 'wand') castSpell(match, hero, spellFor(hero, 'off').id, 'tap', 'off')
}

// Every PvP bow fires on its cooldown while attack is held.
function tickRanged(match, hero, attacking) {
  if (attacking) loose(match, hero)
}
```

Before running, confirm the assumed tier timing for the hammer tests: `CHARGE.ukonvasara` (`melee.js:34`) is full 0.5 / over 1.1, so `resolveCharge('ukonvasara', 0.6)` is `full` and `5` is `over`. Confirm `HAMMER.chain.damage[0..1]` is `[4, 3]`.

- [ ] **Step 4: Run tests**

Run: `node --test test/pvp-attacks.test.js test/pvp-hero.test.js && npm test`
Expected: PASS. If the "streams arrows" count is off by one (the first shot fires on tick 1, the next at 0.6 s → 2 in 30 ticks), check `PVP.tick` accumulation before touching the assertion.

- [ ] **Step 5: Commit**

```bash
git add renderer/pvp/attacks.js renderer/pvp/hero.js test/pvp-attacks.test.js
git commit -m "feat(pvp): hero attacks — sword and rune hammer, spark/blink/storm casts, bow shots

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Contested pickups and the power rune

**Files:**
- Create: `renderer/pvp/pickups.js`
- Test: `test/pvp-pickups.test.js`

**Interfaces:**
- Consumes: `PICKUPS`, `RUNE_POWER` (Task 4); `makeHero`, `placeHero` (Task 5).
- Produces:
  - `makePickups(arena) → [{ kind, x, y, px, py, up, t }]`
  - `tickPickups(match, dt)`, which pushes `{ type:'pickup', kind, hero }`
  - `grantRune(match, hero) → boolean`, `endRune(match, hero)` (pushes `{ type:'runeEnd', hero }`), `tickRunes(match, dt)`

- [ ] **Step 1: Write the failing tests**

`test/pvp-pickups.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makePickups, tickPickups, grantRune, endRune, tickRunes } from '../renderer/pvp/pickups.js'
import { makeHero, placeHero } from '../renderer/pvp/hero.js'
import { PICKUPS } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const hero = (id, cls, cell = { x: 3, y: 3 }) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const withPickups = (heroes, list) => { const m = testMatch(heroes); m.pickups = makePickups({ pickups: list }); return m }

describe('makePickups', () => {
  it('flasks and quivers start up; the rune waits for its first spawn', () => {
    const [f, r] = makePickups({ pickups: [{ kind: 'flask', x: 1, y: 1 }, { kind: 'rune', x: 2, y: 2 }] })
    assert.equal(f.up, true)
    assert.equal(r.up, false)
    assert.equal(r.t, PICKUPS.rune.firstSpawn)
  })
})

describe('flask', () => {
  it('heals 4 (capped) and goes down for its respawn time', () => {
    const h = hero('a', 'archer'); h.hp = 8
    const m = withPickups([h], [{ kind: 'flask', x: 3, y: 3 }])
    tickPickups(m, 0.1)
    assert.equal(h.hp, 10)
    assert.equal(m.pickups[0].up, false)
    assert.equal(m.pickups[0].t, PICKUPS.flask.respawn)
    assert.deepEqual(m.events[0], { type: 'pickup', kind: 'flask', hero: 'a' })
  })
  it('is left alone at full hp', () => {
    const h = hero('a', 'archer')
    const m = withPickups([h], [{ kind: 'flask', x: 3, y: 3 }])
    tickPickups(m, 0.1)
    assert.equal(m.pickups[0].up, true)
  })
  it('comes back after its timer and is taken by a hero standing on it', () => {
    const h = hero('a', 'archer'); h.hp = 2
    const m = withPickups([h], [{ kind: 'flask', x: 3, y: 3 }])
    tickPickups(m, 0.1)                       // taken: 6 hp
    tickPickups(m, PICKUPS.flask.respawn)     // back up this tick
    tickPickups(m, 0.1)                       // taken again by the hero still on it
    assert.equal(h.hp, 10)
  })
})

describe('quiver', () => {
  it('only an archer takes it', () => {
    const w = hero('w', 'warrior'), a = hero('a', 'archer', { x: 4, y: 3 })
    const m = withPickups([w, a], [{ kind: 'quiver', x: 3, y: 3 }, { kind: 'quiver', x: 4, y: 3 }])
    tickPickups(m, 0.1)
    assert.equal(m.pickups[0].up, true)
    assert.equal(m.pickups[1].up, false)
    assert.equal(a.ammo.arrow, 24 + PICKUPS.quiver.arrows)
  })
})

describe('rune', () => {
  it('turns each class main hand into its power weapon and back', () => {
    const w = hero('w', 'warrior'), a = hero('a', 'archer'), mg = hero('m', 'mage')
    const m = testMatch([w, a, mg])
    for (const h of [w, a, mg]) assert.equal(grantRune(m, h), true)
    assert.equal(w.weapon.weaponType, 'ukonvasara')
    assert.equal(a.ranged.weaponType, 'crossbow')
    assert.equal(a.ammo.bolt, 10)
    assert.equal(mg.wand.weaponType, 'stormwand')
    for (const h of [w, a, mg]) endRune(m, h)
    assert.equal(w.weapon.weaponType, 'sword')
    assert.equal(a.ranged.weaponType, 'shortbow')
    assert.equal(a.ammo.bolt, 0)
    assert.equal(mg.wand.weaponType, 'sparkwand')
    assert.equal(m.events.filter(e => e.type === 'runeEnd').length, 3)
  })
  it('a hero already holding the rune does not take a second', () => {
    const w = hero('w', 'warrior'); const m = testMatch([w])
    grantRune(m, w)
    assert.equal(grantRune(m, w), false)
  })
  it('ends after its duration', () => {
    const w = hero('w', 'warrior'); const m = testMatch([w])
    grantRune(m, w)
    tickRunes(m, PICKUPS.rune.duration)
    assert.equal(w.rune, null)
    assert.equal(w.weapon.weaponType, 'sword')
  })
  it('is picked up after first spawn and respawns 60 s after pickup', () => {
    const w = hero('w', 'warrior')
    const m = withPickups([w], [{ kind: 'rune', x: 3, y: 3 }])
    tickPickups(m, PICKUPS.rune.firstSpawn)   // appears
    tickPickups(m, 0.1)                       // taken
    assert.ok(w.rune)
    assert.equal(m.pickups[0].t, PICKUPS.rune.respawn)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/pvp-pickups.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

`renderer/pvp/pickups.js`:

```js
// Contested pickups: walk-onto flasks, Archer-only quivers and the power
// rune, each on its own respawn timer; and the rune's swap of a hero's main
// hand for its class's power weapon. Pure: no DOM.
import { weaponContents, makeRangedContents, makeWandContents } from '../systems/entities.js'
import { addAmmo } from '../systems/inventory.js'
import { addFloat } from '../systems/feedback.js'
import { sfx } from '../systems/sfx.js'
import { PICKUPS, RUNE_POWER } from '../data/pvp.js'

const TILE = 32

export function makePickups(arena) {
  return arena.pickups.map(p => ({
    kind: p.kind, x: p.x, y: p.y, px: p.x * TILE + TILE / 2, py: p.y * TILE + TILE / 2,
    up: p.kind !== 'rune', t: p.kind === 'rune' ? PICKUPS.rune.firstSpawn : 0,
  }))
}

function take(match, hero, p) {
  if (p.kind === 'flask') {
    if (hero.hp >= hero.maxHp) return false
    const healed = Math.min(PICKUPS.flask.heal, hero.maxHp - hero.hp)
    hero.hp += healed
    addFloat(match.feedback, { px: hero.px, py: hero.py - 10, text: `+${healed}`, kind: 'heal' })
    return true
  }
  if (p.kind === 'quiver') {
    if (hero.cls !== 'archer') return false
    return addAmmo(hero, 'arrow', PICKUPS.quiver.arrows) > 0
  }
  if (p.kind === 'rune') return grantRune(match, hero)
  return false
}

export function tickPickups(match, dt) {
  for (const p of match.pickups) {
    if (!p.up) {
      p.t -= dt
      if (p.t <= 0) { p.up = true; p.t = 0 }
      continue
    }
    const taker = match.heroes.find(h => !h.dead && h.x === p.x && h.y === p.y && take(match, h, p))
    if (!taker) continue
    p.up = false
    p.t = PICKUPS[p.kind].respawn
    match.events.push({ type: 'pickup', kind: p.kind, hero: taker.id })
    sfx(match, 'pickup', { px: p.px, py: p.py })
  }
}

export function grantRune(match, hero) {
  if (hero.rune) return false
  const power = RUNE_POWER[hero.cls]
  if (!power) return false
  const saved = { weapon: hero.weapon, ranged: hero.ranged, wand: hero.wand }
  if (power.weaponType) hero.weapon = weaponContents(power.weaponType)
  if (power.rangedType) {
    hero.ranged = makeRangedContents(power.rangedType)
    hero.ammo.bolt = (hero.ammo.bolt ?? 0) + power.bolts
  }
  if (power.wandType) hero.wand = makeWandContents(power.wandType)
  hero.charging = null
  hero.rune = { t: PICKUPS.rune.duration, saved }
  return true
}

export function endRune(match, hero) {
  if (!hero.rune) return
  Object.assign(hero, hero.rune.saved)
  if (RUNE_POWER[hero.cls]?.bolts) hero.ammo.bolt = 0   // unused bolts go with the crossbow
  hero.charging = null
  hero.rune = null
  match.events.push({ type: 'runeEnd', hero: hero.id })
}

export function tickRunes(match, dt) {
  for (const h of match.heroes) {
    if (!h.rune || h.dead) continue
    h.rune.t -= dt
    if (h.rune.t <= 0) endRune(match, h)
  }
}
```

Before running, check the `pickup` sfx cue name exists (`grep -n "'pickup'\|pickup:" renderer/render/audio.js`). If it doesn't, use `'drop'` (a cue `game.js` already plays). `addAmmo(player, kind, n)` returns the count added (`inventory.js:444`); confirm it with `sed -n 444,456p renderer/systems/inventory.js`.

- [ ] **Step 4: Run tests**

Run: `node --test test/pvp-pickups.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/pvp/pickups.js test/pvp-pickups.test.js
git commit -m "feat(pvp): flasks, quivers and the power rune

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The match simulation

**Files:**
- Create: `renderer/pvp/sim.js`
- Test: `test/pvp-sim.test.js`

**Interfaces:**
- Consumes: Tasks 4–7.
- Produces:
  - `makeMatch({ arena = PVP_ARENAS.pillars, roster, sfx = null }) → match`. `roster` is `[{ id, name, cls }]` with 1–6 entries and unique ids.
  - `stepMatch(match, inputs, dt) → events[]`
  - `setClass(match, heroId, cls)`
  - `standings(match) → [{ id, name, cls, kills, deaths, rank }]`
  - `farthestSpawn(match) → {x, y}`
  - Match fields beyond Task 5's `testMatch`: `arena`, `standings` (set at match end).
  - Events: `hit`, `kill {victim, killer}`, `respawn {hero}`, `pickup`, `runeEnd`, `matchEnd {standings}`.

- [ ] **Step 1: Write the failing tests**

`test/pvp-sim.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeMatch, stepMatch, setClass, standings, farthestSpawn } from '../renderer/pvp/sim.js'
import { placeHero } from '../renderer/pvp/hero.js'
import { PVP } from '../renderer/data/pvp.js'
import { makeWandContents } from '../renderer/systems/entities.js'

const roster = (...cls) => cls.map((c, i) => ({ id: `h${i}`, name: `H${i}`, cls: c }))
const byId = (m, id) => m.heroes.find(h => h.id === id)
const run = (m, secs, inputs = {}) => { const ev = []; for (let t = 0; t < secs - 1e-9; t += PVP.tick) ev.push(...stepMatch(m, inputs, PVP.tick)); return ev }

describe('makeMatch', () => {
  it('places each hero on its own spawn with a full kit', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer', 'mage') })
    assert.equal(m.heroes.length, 3)
    const cells = new Set(m.heroes.map(h => `${h.x},${h.y}`))
    assert.equal(cells.size, 3)
    assert.equal(m.entities.length, 3)
  })
  it('rejects an empty roster, more than six heroes and duplicate ids', () => {
    assert.throws(() => makeMatch({ roster: [] }))
    assert.throws(() => makeMatch({ roster: roster(...Array(7).fill('mage')) }))
    assert.throws(() => makeMatch({ roster: [{ id: 'a', name: 'a', cls: 'mage' }, { id: 'a', name: 'b', cls: 'mage' }] }))
  })
})

describe('stepMatch timing', () => {
  it('dt 0.1 runs exactly three ticks', () => {
    const m = makeMatch({ roster: roster('mage') })
    stepMatch(m, {}, 0.1)
    assert.ok(Math.abs(m.clock - 0.1) < 1e-9)
  })
  it('a 5 s hitch runs at most 8 ticks', () => {
    const m = makeMatch({ roster: roster('mage') })
    stepMatch(m, {}, 5)
    assert.ok(m.clock <= 8 * PVP.tick + 1e-9)
  })
  it('ends at the match length with a matchEnd event, then stops', () => {
    const m = makeMatch({ roster: roster('mage', 'archer') })
    byId(m, 'h0').kills = 2
    const ev = run(m, PVP.matchLength + 1)
    const end = ev.find(e => e.type === 'matchEnd')
    assert.ok(end)
    assert.equal(end.standings[0].id, 'h0')
    assert.equal(m.ended, true)
    assert.deepEqual(stepMatch(m, {}, 1), [])
  })
})

describe('death, credit and respawn', () => {
  const duel = () => {
    const m = makeMatch({ roster: roster('archer', 'archer') })
    const a = byId(m, 'h0'), b = byId(m, 'h1')
    placeHero(a, { x: 2, y: 2 }); placeHero(b, { x: 5, y: 2 })
    return { m, a, b }
  }
  it("an arrow kill credits the archer and counts the victim's death", () => {
    const { m, a, b } = duel()
    b.hp = 2
    const ev = run(m, 1, { h0: { move: { x: 0, y: 0 }, facing: 'east', attack: true, alt: false, sprint: false } })
    const kill = ev.find(e => e.type === 'kill')
    assert.deepEqual(kill, { type: 'kill', victim: 'h1', killer: 'h0' })
    assert.equal(a.kills, 1); assert.equal(b.deaths, 1); assert.equal(b.dead, true)
  })
  it('a dead owner arrow still credits the owner', () => {
    const { m, a, b } = duel()
    b.hp = 2
    m.projectiles.push({ px: a.px + 20, py: a.py, dx: 280, dy: 0, damage: 2, friendly: true, owner: 'h0' })
    a.hp = 0                                   // the archer dies this tick (a -1 self-kill)
    const ev = run(m, 1)
    assert.ok(ev.some(e => e.type === 'kill' && e.victim === 'h1' && e.killer === 'h0'))
    assert.equal(a.kills, 0)                   // -1 for dying uncredited, +1 for the arrow
  })
  it('a death with no recent attacker costs the victim a kill', () => {
    const { m, b } = duel()
    b.hp = 0
    run(m, PVP.tick)
    assert.equal(b.kills, -1)
  })
  it('credit expires after the credit window', () => {
    const { m, a, b } = duel()
    b.lastHitBy = { id: 'h0', t: 0 }
    m.clock = PVP.creditWindow + 1
    b.hp = 0
    run(m, PVP.tick)
    assert.equal(a.kills, 0)
    assert.equal(b.kills, -1)
  })
  it('simultaneous kills both count', () => {
    const { m, a, b } = duel()
    a.hp = 0; a.lastHitBy = { id: 'h1', t: 0 }
    b.hp = 0; b.lastHitBy = { id: 'h0', t: 0 }
    run(m, PVP.tick)
    assert.equal(a.kills, 1); assert.equal(b.kills, 1)
    assert.equal(a.dead && b.dead, true)
  })
  it('respawns after the delay at the spawn farthest from the living, protected, with a fresh kit', () => {
    const { m, a, b } = duel()
    b.hp = 0; b.ammo.arrow = 0
    const ev = run(m, PVP.respawnDelay + 0.1)
    assert.ok(ev.some(e => e.type === 'respawn' && e.hero === 'h1'))
    assert.equal(b.dead, false)
    assert.equal(b.hp, 10)
    assert.equal(b.ammo.arrow, 24)
    assert.ok(b.spawnProtect > 0)
    assert.ok(Math.hypot(b.px - a.px, b.py - a.py) > 20 * 32)   // across the arena from h0 at (2,2)
  })
  it('a spawn-protected hero cannot be hit', () => {
    const { m, b } = duel()
    b.spawnProtect = 1
    run(m, 0.5, { h0: { move: { x: 0, y: 0 }, facing: 'east', attack: true, alt: false, sprint: false } })
    assert.equal(b.hp, 10)
  })
  it('death ends the rune and clears the charge', () => {
    const { m, a } = duel()
    a.cls = 'mage'
    a.rune = { t: 10, saved: { weapon: null, ranged: a.ranged, wand: makeWandContents('sparkwand') } }
    a.charging = { t: 0.5, kind: 'spell' }
    a.hp = 0
    const ev = run(m, PVP.tick)
    assert.equal(a.rune, null)
    assert.equal(a.charging, null)
    assert.ok(ev.some(e => e.type === 'runeEnd'))
  })
  it('setClass applies at the next respawn only', () => {
    const { m, b } = duel()
    setClass(m, 'h1', 'warrior')
    assert.equal(b.cls, 'archer')
    b.hp = 0
    run(m, PVP.respawnDelay + 0.1)
    assert.equal(b.cls, 'warrior')
    assert.equal(b.weapon.weaponType, 'sword')
    assert.throws(() => setClass(m, 'h1', 'bard'))
  })
})

describe('crowd control is halved', () => {
  it('a lightning stun on a hero lasts half as long', () => {
    const m = makeMatch({ roster: roster('mage', 'archer') })
    const mg = byId(m, 'h0'), ar = byId(m, 'h1')
    placeHero(mg, { x: 2, y: 2 }); placeHero(ar, { x: 5, y: 2 })
    m.lightning.push({ x: 5, y: 2, t: 0, delay: 0.01, struck: false, owner: 'h0' })
    run(m, PVP.tick)
    assert.ok(ar.stunTimer > 0.4 && ar.stunTimer <= 0.5, `stun ${ar.stunTimer}`)
  })
})

describe('standings', () => {
  it('sorts by kills then fewer deaths and shares tied ranks', () => {
    const m = makeMatch({ roster: roster('mage', 'mage', 'mage') })
    const [a, b, c] = m.heroes
    a.kills = 3; a.deaths = 2; b.kills = 3; b.deaths = 1; c.kills = 3; c.deaths = 2
    const rows = standings(m)
    assert.deepEqual(rows.map(r => [r.id, r.rank]), [['h1', 1], ['h0', 2], ['h2', 2]])
  })
})

describe('farthestSpawn', () => {
  it('picks the spawn with the greatest distance to the nearest living hero', () => {
    const m = makeMatch({ roster: roster('mage') })
    placeHero(m.heroes[0], { x: 2, y: 2 })
    assert.deepEqual(farthestSpawn(m), { x: 29, y: 21 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/pvp-sim.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

`renderer/pvp/sim.js`:

```js
// The PvP match: N heroes stepped from input intents at a fixed tick, with
// projectiles, lightning, the hammer's shocks, knockback, deaths, kill
// credit, respawns, pickups and the match clock. Pure and DOM-free — the
// local harness runs it in the page and the server (sub-project 3) will run
// it under Node. Spec: docs/superpowers/specs/2026-09-25-pvp-multi-hero-core-design.md
import { buildArena } from '../systems/map.js'
import { makeFeedback, tickFeedback, addFloat } from '../systems/feedback.js'
import { sfx } from '../systems/sfx.js'
import { stepProjectiles } from '../systems/projectiles.js'
import { tickLightning } from '../systems/spells/lightning.js'
import { tickShock, tickArcs } from '../systems/hammer.js'
import { stepKnockback } from '../systems/knockback.js'
import { canMoveTo, PLAYER_HALF, TILE_SIZE } from '../systems/movement.js'
import { PVP, KITS } from '../data/pvp.js'
import { PVP_ARENAS } from '../data/pvp-arenas.js'
import { makeHero, placeHero, applyKit, tickHero, tickHeroStatus, NEUTRAL_INPUT } from './hero.js'
import { heroById, hurtHero, refreshTargets } from './combat.js'
import { makePickups, tickPickups, tickRunes, endRune } from './pickups.js'

export function makeMatch({ arena = PVP_ARENAS.pillars, roster, sfx: sfxQueue = null } = {}) {
  if (!Array.isArray(roster) || roster.length < 1 || roster.length > arena.spawns.length)
    throw new Error(`pvp: roster must hold 1-${arena.spawns.length} heroes`)
  if (new Set(roster.map(r => r.id)).size !== roster.length) throw new Error('pvp: duplicate hero id')
  const { map } = buildArena({ size: arena.size, columns: arena.columns, enemies: [], chests: [] }, () => {})
  const match = {
    map, arena, heroes: [], entities: [], projectiles: [], lightning: [], strikes: [], arcs: [],
    shockwaves: [], zones: [], fireZones: [], feedback: makeFeedback(), sfx: sfxQueue,
    pickups: makePickups(arena), clock: 0, acc: 0, ended: false, events: [], inputs: {}, standings: null,
  }
  roster.forEach((r, i) => {
    const h = makeHero(r)
    placeHero(h, arena.spawns[i])
    match.heroes.push(h)
  })
  refreshTargets(match)
  return match
}

export function stepMatch(match, inputs = {}, dt = PVP.tick) {
  if (match.ended) return []
  match.inputs = inputs
  match.acc += Math.min(dt, PVP.maxFrame)
  while (match.acc >= PVP.tick - 1e-9 && !match.ended) {
    match.acc -= PVP.tick
    tick(match)
  }
  const events = match.events
  match.events = []
  return events
}

export function setClass(match, heroId, cls) {
  if (!KITS[cls]) throw new Error(`pvp: unknown class "${cls}"`)
  const h = heroById(match, heroId)
  if (h) h.pendingCls = cls
}

export function standings(match) {
  const rows = match.heroes
    .map(h => ({ id: h.id, name: h.name, cls: h.cls, kills: h.kills, deaths: h.deaths }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
  rows.forEach((r, i) => {
    const prev = rows[i - 1]
    r.rank = prev && prev.kills === r.kills && prev.deaths === r.deaths ? prev.rank : i + 1
  })
  return rows
}

export function farthestSpawn(match) {
  const living = match.heroes.filter(h => !h.dead)
  let best = match.arena.spawns[0], bestD = -1
  for (const s of match.arena.spawns) {
    const cx = s.x * TILE_SIZE + TILE_SIZE / 2, cy = s.y * TILE_SIZE + TILE_SIZE / 2
    const d = living.length ? Math.min(...living.map(h => Math.hypot(h.px - cx, h.py - cy))) : 0
    if (d > bestD) { bestD = d; best = s }
  }
  return best
}

const projectileHooks = match => ({
  isHittable: e => e.type === 'hero' && !e.dead && !(e.spawnProtect > 0),
  hurt: (target, damage, p) => {
    hurtHero(match, target, damage, { by: heroById(match, p?.owner), from: { px: p.px, py: p.py } })
    return target
  },
  detonate: () => {},        // no PvP kit fires an exploding projectile
  damagePlayer: () => false, // no enemy projectiles in a match
  cull: entities => entities,
})

const CC_FIELDS = ['stunTimer', 'slowTimer', 'rootTimer']
const ccSnapshot = h => CC_FIELDS.map(f => Math.max(0, h[f] ?? 0))
// Whatever crowd control landed this tick, from any source, lasts PVP.ccMul
// of its single-player length on a hero.
function scaleNewCC(h, before) {
  CC_FIELDS.forEach((f, i) => {
    const now = h[f] ?? 0
    if (now > before[i]) h[f] = before[i] + (now - before[i]) * PVP.ccMul
  })
}

function tick(match) {
  const dt = PVP.tick
  match.clock += dt

  const before = new Map()
  for (const h of match.heroes) {
    if (h.dead) continue
    tickHeroStatus(h, dt)
    before.set(h, ccSnapshot(h))
  }
  refreshTargets(match)
  for (const h of match.heroes) {
    tickHero(match, h, match.inputs[h.id] ?? NEUTRAL_INPUT, dt)
    refreshTargets(match)
  }

  stepProjectiles(match, dt, projectileHooks(match))
  tickLightning(match, dt, {
    hurt: (e, d, info) => { hurtHero(match, e, d, { kind: 'lightning', by: heroById(match, info?.owner) }) },
  })
  for (const h of match.heroes) {
    if (h.dead || !h.shock) continue
    tickShock(h, dt, { hurt: (e, d) => { hurtHero(match, e, d, { kind: 'lightning', by: heroById(match, e.shock?.owner) }) } })
  }
  for (const h of match.heroes) {
    if (!h.dead) stepKnockback(h, dt, (px, py) => canMoveTo(match.map, px, py, PLAYER_HALF))
  }
  tickArcs(match, dt)
  for (const s of match.shockwaves) s.t += dt
  match.shockwaves = match.shockwaves.filter(s => s.t < s.dur)
  tickFeedback(match.feedback, dt)
  for (const [h, b] of before) scaleNewCC(h, b)

  tickRunes(match, dt)
  resolveDeaths(match)
  tickRespawns(match, dt)
  tickPickups(match, dt)
  refreshTargets(match)

  if (match.clock >= PVP.matchLength - 1e-9) {
    match.ended = true
    match.standings = standings(match)
    match.events.push({ type: 'matchEnd', standings: match.standings })
  }
}

// Every hero at 0 hp dies together, so two heroes trading killing blows in
// one tick both score.
function resolveDeaths(match) {
  const dying = match.heroes.filter(h => !h.dead && h.hp <= 0)
  for (const h of dying) {
    if (h.rune) endRune(match, h)
    const c = h.lastHitBy
    const killer = c && match.clock - c.t <= PVP.creditWindow ? heroById(match, c.id) : null
    if (killer && killer !== h) {
      killer.kills++
      addFloat(match.feedback, { px: killer.px, py: killer.py - 16, text: '+1', kind: 'heal' })
    } else {
      h.kills--
    }
    h.deaths++
    match.events.push({ type: 'kill', victim: h.id, killer: killer && killer !== h ? killer.id : null })
    sfx(match, 'enemy-death', { px: h.px, py: h.py })
  }
  for (const h of dying) {
    h.dead = true
    h.respawnT = PVP.respawnDelay
    h.lastHitBy = null
    h.charging = null
    h.knockback = null
    h.shock = undefined
    h.blocking = false
  }
}

function tickRespawns(match, dt) {
  for (const h of match.heroes) {
    if (!h.dead) continue
    h.respawnT -= dt
    if (h.respawnT > 0) continue
    applyKit(h, h.pendingCls ?? h.cls)
    h.pendingCls = null
    placeHero(h, farthestSpawn(match))
    h.dead = false
    h.spawnProtect = PVP.spawnProtect
    match.events.push({ type: 'respawn', hero: h.id })
  }
}
```

Notes for the implementer:
- `stepProjectiles` destructures `state.player` but only reads it on the enemy branch, which never runs here (every hero projectile is `friendly`). `match.player` stays undefined on purpose.
- The "dead owner" test works because `heroById` finds dead heroes too. Keep that property: never filter `heroById` by `dead`.
- `resolveDeaths` counts credit in a first pass and flips `dead` in a second, which is what makes simultaneous kills both count.

- [ ] **Step 4: Run tests**

Run: `node --test test/pvp-sim.test.js && npm test`
Expected: PASS. If "respawns … across the arena" fails, print `farthestSpawn(m)` and the spawn list. With h0 at (2,2) the farthest spawn is (29,21).

- [ ] **Step 5: Commit**

```bash
git add renderer/pvp/sim.js test/pvp-sim.test.js
git commit -m "feat(pvp): the match simulation — fixed tick, kill credit, respawns, halved CC, match end

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Bots and the headless soak

**Files:**
- Create: `renderer/pvp/bots.js`
- Test: `test/pvp-bots.test.js`, `test/pvp-soak.test.js`

**Interfaces:**
- Consumes: `foesOf` (Task 5), `NEUTRAL_INPUT` (Task 5), `makeMatch`/`stepMatch` (Task 8).
- Produces: `botInput(match, hero) → HeroInput`; `nextStep(map, from, to) → {x, y} | null` (4-neighbour BFS; the first tile on a shortest path, `from` itself when already there, null when unreachable).

- [ ] **Step 1: Write the failing tests**

`test/pvp-bots.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { botInput, nextStep } from '../renderer/pvp/bots.js'
import { makeMatch } from '../renderer/pvp/sim.js'
import { placeHero } from '../renderer/pvp/hero.js'
import { openMap } from './pvp-helpers.js'
import { TILE } from '../renderer/systems/entities.js'

const roster = (...cls) => cls.map((c, i) => ({ id: `b${i}`, name: `B${i}`, cls: c }))
const valid = inp => ['x', 'y'].every(k => [-1, 0, 1].includes(inp.move[k])) &&
  (inp.facing === null || ['north', 'south', 'east', 'west'].includes(inp.facing)) &&
  typeof inp.attack === 'boolean' && typeof inp.alt === 'boolean'

describe('nextStep', () => {
  it('following it walks the shortest way around a wall', () => {
    const map = openMap(7, 7)
    for (let y = 1; y <= 4; y++) map[y][3].tile = TILE.WALL
    const goal = { x: 5, y: 1 }
    let pos = { x: 1, y: 1 }, steps = 0
    while (!(pos.x === goal.x && pos.y === goal.y) && steps < 50) {
      const next = nextStep(map, pos, goal)
      assert.ok(Math.abs(next.x - pos.x) + Math.abs(next.y - pos.y) === 1, 'one orthogonal step')
      assert.notEqual(map[next.y][next.x].tile, TILE.WALL)
      pos = next; steps++
    }
    assert.equal(steps, 12)
  })
  it('returns null when the goal is walled off', () => {
    const map = openMap(7, 7)
    for (let y = 1; y <= 5; y++) map[y][3].tile = TILE.WALL
    assert.equal(nextStep(map, { x: 1, y: 1 }, { x: 5, y: 1 }), null)
  })
})

describe('botInput', () => {
  it('produces a valid input for every class', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer', 'mage') })
    for (const h of m.heroes) assert.ok(valid(botInput(m, h)), h.cls)
  })
  it('a warrior next to a foe faces it and attacks', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer') })
    placeHero(m.heroes[0], { x: 10, y: 2 }); placeHero(m.heroes[1], { x: 11, y: 2 })
    const inp = botInput(m, m.heroes[0])
    assert.equal(inp.facing, 'east'); assert.equal(inp.attack, true)
  })
  it('an archer aligned with a foe in the open shoots along the line', () => {
    const m = makeMatch({ roster: roster('archer', 'warrior') })
    placeHero(m.heroes[0], { x: 2, y: 2 }); placeHero(m.heroes[1], { x: 8, y: 2 })
    const inp = botInput(m, m.heroes[0])
    assert.equal(inp.facing, 'east'); assert.equal(inp.attack, true)
  })
  it('a dead bot idles', () => {
    const m = makeMatch({ roster: roster('mage', 'archer') })
    m.heroes[0].dead = true
    const inp = botInput(m, m.heroes[0])
    assert.equal(inp.attack, false); assert.deepEqual(inp.move, { x: 0, y: 0 })
  })
  it('a hurt bot heads for a flask', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer') })
    const b = m.heroes[0]
    placeHero(b, { x: 7, y: 14 }); b.hp = 2          // flask at (7,12)
    placeHero(m.heroes[1], { x: 29, y: 21 })
    assert.deepEqual(botInput(m, b).move, { x: 0, y: -1 })
  })
})
```

`test/pvp-soak.test.js`:

```js
// Six bots fight a full match headless under Node: the DOM-free check for
// renderer/pvp/sim.js, and an invariant sweep over every tick.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { botInput } from '../renderer/pvp/bots.js'
import { PVP } from '../renderer/data/pvp.js'
import { isWalkable } from '../renderer/systems/entities.js'

describe('pvp soak', () => {
  it('six bots play a full match without breaking an invariant', () => {
    const roster = ['warrior', 'archer', 'mage', 'warrior', 'archer', 'mage'].map((cls, i) => ({ id: `b${i}`, name: `B${i}`, cls }))
    const m = makeMatch({ roster })
    const kills = []
    let ended = false
    for (let i = 0; i < Math.ceil(PVP.matchLength / PVP.tick) + 5 && !ended; i++) {
      const inputs = Object.fromEntries(m.heroes.map(h => [h.id, botInput(m, h)]))
      for (const ev of stepMatch(m, inputs, PVP.tick)) {
        if (ev.type === 'kill') kills.push(ev)
        if (ev.type === 'matchEnd') ended = true
      }
      for (const h of m.heroes) {
        assert.ok(h.hp <= h.maxHp, `${h.id} hp ${h.hp} over max`)
        if (h.dead) continue
        assert.ok(h.hp > 0, `${h.id} alive at ${h.hp} hp`)
        const cell = m.map[h.y]?.[h.x]
        assert.ok(cell && isWalkable(cell.tile, cell), `${h.id} inside a wall at ${h.x},${h.y}`)
      }
    }
    assert.ok(ended, 'match never ended')
    assert.ok(kills.length > 0, 'nobody died in four minutes')
    const deaths = m.heroes.reduce((s, h) => s + h.deaths, 0)
    assert.equal(deaths, kills.length)
    const credited = kills.filter(k => k.killer).length
    const selfKills = kills.length - credited
    assert.equal(m.heroes.reduce((s, h) => s + h.kills, 0), credited - selfKills)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/pvp-bots.test.js test/pvp-soak.test.js`
Expected: FAIL. `bots.js` is not found.

- [ ] **Step 3: Implement**

`renderer/pvp/bots.js`:

```js
// Bots: one input intent per tick from the match state alone, so the local
// harness has opponents today and sub-project 4 can fill short lobbies
// later. Deliberately simple per class — the Warrior closes in behind a
// shield, the Archer and Mage line up on a row or column (every shot flies
// along a facing) and keep their distance. Pure: no DOM.
import { isWalkable, hasLineOfSight } from '../systems/entities.js'
import { foesOf } from './combat.js'
import { NEUTRAL_INPUT } from './hero.js'
import { GUST_CHARGE } from '../systems/magic.js'

const TILE = 32
const MELEE_RANGE = 1.3     // tiles
const SHOOT_RANGE = 9       // tiles
const KEEP_AWAY = 3         // tiles a caster/archer tries to hold
const ALIGN_SLACK = 10      // px off-axis that still counts as lined up
const HURT = 0.4            // hp fraction that sends a bot for a flask
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

const tileDist = (a, b) => Math.hypot(a.px - b.px, a.py - b.py) / TILE
const walk = (map, x, y) => { const c = map[y]?.[x]; return !!c && isWalkable(c.tile, c) }
const faceToward = (from, to) => {
  const dx = to.px - from.px, dy = to.py - from.py
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'east' : 'west') : (dy >= 0 ? 'south' : 'north')
}
const FLIP = { east: 'west', west: 'east', north: 'south', south: 'north' }

// The first tile on a shortest 4-neighbour path from `from` to `to`.
export function nextStep(map, from, to) {
  if (from.x === to.x && from.y === to.y) return { x: from.x, y: from.y }
  const key = (x, y) => y * 1000 + x
  const parent = new Map([[key(from.x, from.y), null]])
  const queue = [from]
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]
    for (const [dx, dy] of STEPS) {
      const nx = c.x + dx, ny = c.y + dy, k = key(nx, ny)
      if (parent.has(k) || !walk(map, nx, ny)) continue
      parent.set(k, c)
      if (nx === to.x && ny === to.y) {
        let step = { x: nx, y: ny }, p = c
        while (p && !(p.x === from.x && p.y === from.y)) { step = p; p = parent.get(key(p.x, p.y)) }
        return { x: step.x, y: step.y }
      }
      queue.push({ x: nx, y: ny })
    }
  }
  return null
}

const nearest = (hero, list) => list.reduce((best, e) => !best || tileDist(hero, e) < tileDist(hero, best) ? e : best, null)

function steer(match, hero, goal, input) {
  const step = nextStep(match.map, hero, goal)
  if (!step) return
  const cx = step.x * TILE + TILE / 2, cy = step.y * TILE + TILE / 2
  const dx = cx - hero.px, dy = cy - hero.py
  input.move = { x: Math.abs(dx) > 2 ? Math.sign(dx) : 0, y: Math.abs(dy) > 2 ? Math.sign(dy) : 0 }
  if (input.move.x || input.move.y) input.facing = faceToward(hero, { px: cx, py: cy })
}

// The walkable tile on the foe's row or column nearest the bot, at least
// KEEP_AWAY from the foe — where a shot along a facing will land.
function firingSpot(match, hero, foe) {
  let best = null, bestD = Infinity
  for (const [dx, dy] of STEPS) {
    for (let r = KEEP_AWAY; r <= SHOOT_RANGE - 2; r++) {
      const x = foe.x + dx * r, y = foe.y + dy * r
      if (!walk(match.map, x, y)) break
      if (!hasLineOfSight(match.map, y, x, foe.y, foe.x)) break
      const d = Math.hypot(x - hero.x, y - hero.y)
      if (d < bestD) { bestD = d; best = { x, y } }
    }
  }
  return best
}

function incoming(match, hero) {
  return match.projectiles.find(p => p.owner !== hero.id &&
    Math.hypot(p.px - hero.px, p.py - hero.py) < 3 * TILE &&
    (hero.px - p.px) * p.dx + (hero.py - p.py) * p.dy > 0)
}

export function botInput(match, hero) {
  if (hero.dead) return { ...NEUTRAL_INPUT, move: { x: 0, y: 0 } }
  const input = { move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false }
  const up = kind => match.pickups.filter(p => p.up && p.kind === kind)
  const foe = nearest(hero, foesOf(match, hero))

  if (hero.hp < hero.maxHp * HURT) {
    const flask = nearest(hero, up('flask'))
    if (flask) { steer(match, hero, flask, input); return input }
  }
  const rune = hero.rune ? null : nearest(hero, up('rune'))
  if (rune && (!foe || tileDist(hero, rune) < tileDist(hero, foe))) { steer(match, hero, rune, input); return input }
  if (!foe) return input

  const d = tileDist(hero, foe)
  if (hero.cls === 'warrior') {
    const shot = incoming(match, hero)
    if (shot) { input.alt = true; input.facing = faceToward(hero, shot); return input }
    if (d <= MELEE_RANGE) { input.facing = faceToward(hero, foe); input.attack = true; return input }
    steer(match, hero, foe, input)
    return input
  }

  if (hero.cls === 'mage' && d < 1.5) {
    input.facing = FLIP[faceToward(hero, foe)]
    input.alt = !hero.prevAlt               // one press per two ticks: an edge the blink reads
    return input
  }
  const aligned = Math.abs(hero.px - foe.px) < ALIGN_SLACK || Math.abs(hero.py - foe.py) < ALIGN_SLACK
  if (aligned && d <= SHOOT_RANGE && hasLineOfSight(match.map, hero.y, hero.x, foe.y, foe.x)) {
    input.facing = faceToward(hero, foe)
    // A mage releases once the charge reaches the full tier; an archer streams.
    input.attack = hero.cls === 'mage' ? !(hero.charging?.t >= GUST_CHARGE.full) : true
    if (d < KEEP_AWAY - 1) input.move = { x: 0, y: 0 }
    return input
  }
  const spot = firingSpot(match, hero, foe)
  steer(match, hero, spot ?? foe, input)
  return input
}
```

- [ ] **Step 4: Run tests and time the soak**

Run: `time node --test test/pvp-bots.test.js test/pvp-soak.test.js`
Expected: PASS in under ~10 s.
- If the soak reports "nobody died", bots aren't engaging. Print per-bot `hp`/position every 30 s of sim to see whether warriors reach each other. The likely cause is `steer` oscillating at a tile edge: loosen the `> 2` px dead-zone to `> 1`.
- If it reports "inside a wall", the bug is in `moveEntity`/`castSelf` usage, not in the bots.

Fix the cause; don't weaken the assertion.

- [ ] **Step 5: Commit**

```bash
git add renderer/pvp/bots.js test/pvp-bots.test.js test/pvp-soak.test.js
git commit -m "feat(pvp): bots and a headless six-bot soak of a full match

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Drawing heroes, name tags, the rune glow and pickups

**Files:**
- Modify: `renderer/render/canvas.js`: `drawEntity` (the `'player'` branch at ~line 286, plus a new `'pvp_pickup'` branch), and `Renderer.render` (the hero block, ~lines 1210–1241)
- Test: `test/pvp-render.test.js`

**Interfaces:**
- Consumes: hero fields from Task 5, pickup fields from Task 7.
- Produces:
  - `export function drawHero(ctx, hero, sprites, camX, camY, S, { lift = 0, trail = null, greenAlpha = 0 } = {})`, which returns early for `hero.dead`.
  - `export function otherHeroes(state) → hero[]`: `state.heroes` minus `state.player`, minus the dead, minus those on non-visible cells.
  - `drawEntity` draws `type: 'hero'` like `'player'`, and `type: 'pvp_pickup'` by `kind`.

- [ ] **Step 1: Write the failing test**

`test/pvp-render.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { otherHeroes } from '../renderer/render/canvas.js'

describe('otherHeroes', () => {
  const map = [[{ visible: true }, { visible: false }]]
  const me = { id: 'me', x: 0, y: 0 }
  it('lists visible, living heroes other than the local one', () => {
    const seen = { id: 'a', x: 0, y: 0 }, hidden = { id: 'b', x: 1, y: 0 }, dead = { id: 'c', x: 0, y: 0, dead: true }
    assert.deepEqual(otherHeroes({ map, player: me, heroes: [me, seen, hidden, dead] }).map(h => h.id), ['a'])
  })
  it('is empty in single-player (no heroes)', () => {
    assert.deepEqual(otherHeroes({ map, player: me }), [])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/pvp-render.test.js`
Expected: FAIL. `otherHeroes` is not exported.

- [ ] **Step 3: Implement in `renderer/render/canvas.js`**

1. In `drawEntity`, change `if (entity.type === 'player') {` to `if (entity.type === 'player' || entity.type === 'hero') {`, and add before it:

```js
  if (entity.type === 'pvp_pickup') {
    const key = { flask: 'potion', quiver: 'item_arrows', rune: 'weapon_ukonvasara' }[entity.kind]
    const s = sprites[key]
    if (entity.kind === 'rune') drawRuneGlow(ctx, px + S / 2, py + S / 2, S)
    if (s) ctx.drawImage(s, px, py, S, S)
    return
  }
```

2. Add module-level helpers next to `drawBlinkTrail`:

```js
// PvP: the heroes the local view should draw besides its own — living, and
// standing on a cell the local hero can see.
export function otherHeroes(state) {
  return (state.heroes ?? []).filter(h => h !== state.player && !h.dead && state.map?.[h.y]?.[h.x]?.visible)
}

// The power rune's gold halo, on the floating rune and on whoever holds it.
function drawRuneGlow(ctx, cx, cy, S) {
  ctx.save()
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = '#facc15'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, S * 0.62, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

// Another hero's name and a thin hp bar above the sprite.
function drawHeroTag(ctx, hero, hx, hy, S) {
  const frac = Math.max(0, Math.min(1, hero.hp / (hero.maxHp || 1)))
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(hx, hy - 6, S, 4)
  ctx.fillStyle = '#ef4444'
  ctx.fillRect(hx, hy - 6, Math.round(S * frac), 4)
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#e5e7eb'
  ctx.fillText(hero.name ?? '', hx + S / 2, hy - 9)
  ctx.restore()
}

// One hero, drawn the way the player always was: blink ghosts, the sprite
// (flickering through i-frames), the grab and trance washes, the swing, the
// charge ring and the rain cloud. Returns the sprite's top-left on screen.
export function drawHero(ctx, hero, sprites, camX, camY, S, { lift = 0, trail = null, greenAlpha = 0 } = {}) {
  if (hero.dead) return null
  const hx = hero.px !== undefined ? Math.round(hero.px - S / 2 - camX) : Math.round(hero.x * S - camX)
  const hy = (hero.py !== undefined ? Math.round(hero.py - S / 2 - camY) : Math.round(hero.y * S - camY)) - lift
  drawBlinkTrail(ctx, trail, hero, sprites, camX, camY, S)
  if (hero.rune) drawRuneGlow(ctx, hx + S / 2, hy + S / 2, S)
  if (isFlickerVisible(hero.invulnTimer)) drawEntity(ctx, hero, hx, hy, S, sprites)
  if (hero.grabbed) {
    ctx.save()
    ctx.globalAlpha = 0.45
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(hx, hy, S, S)
    ctx.restore()
  }
  if (greenAlpha > 0) {
    ctx.save()
    ctx.globalAlpha = Math.min(0.6, greenAlpha * 1.6)
    ctx.fillStyle = '#4ade80'
    ctx.fillRect(hx, hy, S, S)
    ctx.restore()
  }
  drawMeleeSwing(ctx, hero, sprites, camX, camY, S)
  drawChargeRing(ctx, hero, camX, camY)
  if (hero.rain) drawRainCloud(ctx, hx + S / 2, hy - 14, S, hero.rain.t, hero.rain.t / hero.rain.dur)
  return { px: hx, py: hy }
}
```

3. In `Renderer.render`, replace the block from `const ppx = …` through the `if (player.rain) drawRainCloud(…)` line with:

```js
    const lift = Math.round(fx?.lift ?? 0)
    if (fx?.wizards?.length) {
      drawRiteCeremony(ctx, fx, camX, camY, S, this.whiteWizardSprite(), {
        px: player.px ?? player.x * S + S / 2,
        py: player.py ?? player.y * S + S / 2,
      })
    }
    // PvP: every other hero first, each with its name and hp; the local hero
    // is drawn last, on top, exactly as the single-player hero always was.
    for (const h of otherHeroes(state)) {
      const at = drawHero(ctx, h, sprites, camX, camY, S, { trail: h.blinkTrail })
      if (at) {
        if (h.stunTimer > 0) drawStunStars(ctx, at.px + S / 2, at.py - 4, h.stunTimer)
        if (h.shock) drawShockCloud(ctx, at.px + S / 2, at.py - 14, S, h.shock.tickT + h.shock.left)
        drawHeroTag(ctx, h, at.px, at.py, S)
      }
    }
    // The blink ghosts belong with the player: behind him, in front of the floor.
    drawHero(ctx, player, sprites, camX, camY, S,
      { lift, trail: player.blinkTrail ?? state.blinkTrail, greenAlpha: fx?.greenAlpha ?? 0 })
```

In single-player this draws the same things in the same order as before (ceremony → trail → sprite → grab → green → swing → ring → rain). `player.blinkTrail` is undefined there, so the trail is still `state.blinkTrail`.

- [ ] **Step 4: Run tests**

Run: `node --test test/pvp-render.test.js && npm test`
Expected: PASS, including the existing `canvas.test.js`.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/canvas.js test/pvp-render.test.js
git commit -m "feat(pvp): draw every hero with name tags, rune glow and arena pickups

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Local harness: cheat, class picker, HUD, results and the game loop

**Files:**
- Create: `renderer/pvp/local.js`, `renderer/ui/pvp-hud.js`
- Modify: `renderer/systems/cheats.js` (add `parsePvpCheat`), `renderer/ui/menu.js` (`renderScreen` gains `onPvp` and `lines`; add `showClassPicker`, `showPvpResults`; `showTitle` passes `onPvp`), `renderer/game.js` (imports, `pvp` session, loop branch, key-handler guards, `goTitle`)
- Test: `test/pvp-ui.test.js`

**Interfaces:**
- Consumes: `makeMatch`, `stepMatch`, `setClass` (Task 8), `botInput` (Task 9), `drawHero`/`otherHeroes` via `Renderer.render` (Task 10).
- Produces:
  - `local.js`:
    - `LOCAL_ID = 'you'`
    - `inputFromKeys(keys, sprinting = false) → HeroInput`
    - `makeLocalMatch({ cls, bots = PVP.localBots, sfx = null }) → match`, where bots are `bot1..botN` with classes cycling `CLASSES`
    - `localInputs(match, keys, sprinting) → inputs`
    - `viewOf(match, theme) → view` (`player` = the local hero, `heroes`, `entities` = the up pickups as `pvp_pickup`, plus the effect lists)
  - `pvp-hud.js`: `pvpHudModel(match, localId) → { time, kills, leaderKills, leading, dead, respawnIn }`, `updatePvpHud(model)`, `hidePvpHud()`
  - `cheats.js`: `parsePvpCheat(buffer) → boolean`
  - `menu.js`: `showClassPicker({ title, subtitle, onPick, onBack })`, `showPvpResults(rows, { onNext, onQuit })`

- [ ] **Step 1: Write the failing tests**

`test/pvp-ui.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parsePvpCheat, cheatDecision } from '../renderer/systems/cheats.js'
import { inputFromKeys, makeLocalMatch, localInputs, viewOf, LOCAL_ID } from '../renderer/pvp/local.js'
import { pvpHudModel } from '../renderer/ui/pvp-hud.js'
import { PVP } from '../renderer/data/pvp.js'

describe('pvp cheat', () => {
  it('matches a buffer ending in pvp, any case', () => {
    assert.equal(parsePvpCheat('xxPvP'), true)
    assert.equal(parsePvpCheat('pv'), false)
  })
  it('does not disturb the level cheat', () => {
    assert.equal(cheatDecision('pvp'), null)
  })
})

describe('inputFromKeys', () => {
  it('maps WASD/arrows, Space, Q and sprint; the last pressed axis names the facing', () => {
    assert.deepEqual(inputFromKeys({ d: true, s: true, ' ': true, q: true }, true),
      { move: { x: 1, y: 1 }, facing: 'south', attack: true, alt: true, sprint: true })
    assert.deepEqual(inputFromKeys({}), { move: { x: 0, y: 0 }, facing: null, attack: false, alt: false, sprint: false })
  })
})

describe('makeLocalMatch / localInputs / viewOf', () => {
  it('puts you against three bots of cycling classes', () => {
    const m = makeLocalMatch({ cls: 'mage' })
    assert.deepEqual(m.heroes.map(h => [h.id, h.cls]), [[LOCAL_ID, 'mage'], ['bot1', 'warrior'], ['bot2', 'archer'], ['bot3', 'mage']])
  })
  it('clamps the bot count to 1-5', () => {
    assert.equal(makeLocalMatch({ cls: 'mage', bots: 9 }).heroes.length, 6)
    assert.equal(makeLocalMatch({ cls: 'mage', bots: 0 }).heroes.length, 2)
  })
  it('keys drive you; bots drive the rest', () => {
    const m = makeLocalMatch({ cls: 'archer' })
    const inputs = localInputs(m, { a: true }, false)
    assert.deepEqual(inputs[LOCAL_ID].move, { x: -1, y: 0 })
    assert.equal(Object.keys(inputs).length, 4)
  })
  it('the view centres on you and shows only pickups that are up', () => {
    const m = makeLocalMatch({ cls: 'archer' })
    const v = viewOf(m, { bgColor: '#000' })
    assert.equal(v.player.id, LOCAL_ID)
    assert.equal(v.heroes, m.heroes)
    assert.ok(v.entities.every(e => e.type === 'pvp_pickup'))
    assert.equal(v.entities.length, 4)   // the rune is not up yet
  })
})

describe('pvpHudModel', () => {
  it('shows time left, your kills and the leader', () => {
    const m = makeLocalMatch({ cls: 'archer' })
    m.clock = 65.5
    m.heroes[2].kills = 3
    const model = pvpHudModel(m, LOCAL_ID)
    assert.equal(model.time, `${Math.floor((PVP.matchLength - 65.5) / 60)}:${String(Math.floor((PVP.matchLength - 65.5) % 60)).padStart(2, '0')}`)
    assert.equal(model.kills, 0)
    assert.equal(model.leaderKills, 3)
    assert.equal(model.leading, false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/pvp-ui.test.js`
Expected: FAIL. `parsePvpCheat` is not exported, and `local.js`/`pvp-hud.js` are not found.

- [ ] **Step 3: Implement the pure modules**

`renderer/systems/cheats.js`, appended:

```js
// Title-screen cheat: typing "pvp" opens the local PvP arena
// (renderer/pvp/local.js). Suffix-matched like the others.
export function parsePvpCheat(buffer) {
  return /pvp$/.test(String(buffer).toLowerCase())
}
```

`renderer/pvp/local.js`:

```js
// The local PvP harness: you on the keyboard against bots, in the page.
// Takes the keys object as a parameter and touches no DOM; game.js owns the
// loop, the renderer and the menus.
import { makeMatch } from './sim.js'
import { botInput } from './bots.js'
import { PVP, CLASSES } from '../data/pvp.js'

export const LOCAL_ID = 'you'

export function inputFromKeys(keys, sprinting = false) {
  let x = 0, y = 0, facing = null
  if (keys.ArrowLeft || keys.a) { x -= 1; facing = 'west' }
  if (keys.ArrowRight || keys.d) { x += 1; facing = 'east' }
  if (keys.ArrowUp || keys.w) { y -= 1; facing = 'north' }
  if (keys.ArrowDown || keys.s) { y += 1; facing = 'south' }
  return { move: { x, y }, facing, attack: !!keys[' '], alt: !!(keys.q || keys.Q), sprint: !!(sprinting || keys.sprint) }
}

export function makeLocalMatch({ cls, bots = PVP.localBots, sfx = null }) {
  const n = Math.max(1, Math.min(5, Math.round(bots)))
  const roster = [{ id: LOCAL_ID, name: 'You', cls }]
  for (let i = 0; i < n; i++) roster.push({ id: `bot${i + 1}`, name: `Bot ${i + 1}`, cls: CLASSES[i % CLASSES.length] })
  return makeMatch({ roster, sfx })
}

export function localInputs(match, keys, sprinting) {
  const inputs = {}
  for (const h of match.heroes) inputs[h.id] = h.id === LOCAL_ID ? inputFromKeys(keys, sprinting) : botInput(match, h)
  return inputs
}

// What Renderer.render and updateHUD read: a single-player-shaped state
// whose `player` is the local hero, plus `heroes` for everyone else.
export function viewOf(match, theme) {
  return {
    map: match.map, theme, level: 0,
    player: match.heroes.find(h => h.id === LOCAL_ID),
    heroes: match.heroes,
    entities: match.pickups.filter(p => p.up).map(p => ({ ...p, type: 'pvp_pickup' })),
    projectiles: match.projectiles, lightning: match.lightning, strikes: match.strikes,
    arcs: match.arcs, shockwaves: match.shockwaves, zones: match.zones, fireZones: match.fireZones,
    feedback: match.feedback, sfx: match.sfx, hitEffects: [], flash: 0,
  }
}
```

`renderer/ui/pvp-hud.js`:

```js
// The PvP HUD strip: time left, your kills, the leader's kills (gold when
// the leader is you). The model is pure; the DOM is touched only inside
// updatePvpHud/hidePvpHud, and only when the markup changes.
import { PVP } from '../data/pvp.js'

export function pvpHudModel(match, localId) {
  const me = match.heroes.find(h => h.id === localId)
  const leader = [...match.heroes].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0]
  const left = Math.max(0, PVP.matchLength - match.clock)
  return {
    time: `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`,
    kills: me.kills, leaderKills: leader.kills, leading: leader === me,
    dead: me.dead, respawnIn: me.dead ? Math.ceil(me.respawnT) : 0,
  }
}

export function updatePvpHud(m) {
  let node = document.getElementById('pvp-hud')
  if (!node) {
    node = document.createElement('div')
    node.id = 'pvp-hud'
    node.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;gap:18px;' +
      'font:bold 16px monospace;color:#e5e7eb;text-shadow:0 1px 2px #000'
    document.getElementById('hud-overlay').appendChild(node)
  }
  const html = `<span>${m.time}</span>` +
    `<span style="color:${m.leading ? '#facc15' : '#e5e7eb'}">${m.kills}</span>` +
    `<span style="opacity:0.6">${m.leaderKills}</span>` +
    (m.dead ? `<span style="color:#f87171">${m.respawnIn}</span>` : '')
  if (node._html === html) return
  node._html = html
  node.innerHTML = html
}

export function hidePvpHud() {
  document.getElementById('pvp-hud')?.remove()
}
```

- [ ] **Step 4: Run the pure tests**

Run: `node --test test/pvp-ui.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the menu**

In `renderer/ui/menu.js`:
- Import `parsePvpCheat`: `import { cheatDecision, CHEAT_HOLD_MS, parsePvpCheat } from '../systems/cheats.js'`.
- Change the signature to `function renderScreen({ title, subtitle, lines = [], buttons, onCheat, onPvp }) {`. After the subtitle block, add:

```js
  for (const line of lines) {
    const l = document.createElement('div')
    l.className = 'menu-subtitle'
    l.textContent = line
    panel.appendChild(l)
  }
```
- In the key handler's cheat branch, directly after `cheatBuffer = (cheatBuffer + e.key).toLowerCase().slice(-12)`:

```js
      if (onPvp && parsePvpCheat(cheatBuffer)) { clearCheatTimer(); cheatBuffer = ''; onPvp(); return }
```
- `showTitle(meta, { …, onCheat, onPvp })` passes `onPvp` into `renderScreen`.
- Append:

```js
// PvP: pick a class — before a local match, and while dead (applies at respawn).
export function showClassPicker({ title = 'Arena', subtitle = 'Pick a class', onPick, onBack }) {
  renderScreen({
    title, subtitle,
    buttons: [
      { label: 'Warrior', onSelect: () => onPick('warrior') },
      { label: 'Archer', onSelect: () => onPick('archer') },
      { label: 'Mage', onSelect: () => onPick('mage') },
      ...(onBack ? [{ label: 'Back', onSelect: onBack }] : []),
    ],
  })
}

// PvP: the end-of-match table, one line per hero.
export function showPvpResults(rows, { onNext, onQuit }) {
  renderScreen({
    title: 'Match over',
    lines: rows.map(r => `${r.rank}. ${r.name} — ${r.cls} — ${r.kills} / ${r.deaths}`),
    buttons: [
      { label: 'Next match', onSelect: onNext },
      { label: 'Quit', onSelect: onQuit },
    ],
  })
}
```

- [ ] **Step 6: Wire game.js**

Add imports:

```js
import { makeLocalMatch, localInputs, viewOf, LOCAL_ID } from './pvp/local.js'
import { stepMatch, setClass } from './pvp/sim.js'
import { pvpHudModel, updatePvpHud, hidePvpHud } from './ui/pvp-hud.js'
```
`maybeComputeFOV`, `decorateMap`, `DEPTH_THEMES`, `makeSfx`, `drainSfx`, `playCues`, `updateHUD` and `menu` are already imported. Confirm with `grep -n "maybeComputeFOV\|decorateMap\|DEPTH_THEMES\|drainSfx" renderer/game.js | head`.

Next to `let state = null`, add:

```js
// A local PvP match (renderer/pvp/local.js) while one runs. `state` stays
// null meanwhile, so every single-player key handler that checks it no-ops.
let pvp = null
```

Add these functions after `goEpisodeSelect`:

```js
function goPvpPicker() {
  phase = PHASE.TITLE
  menu.showClassPicker({ onPick: startPvp, onBack: goTitle })
}

function startPvp(cls) {
  const theme = DEPTH_THEMES.find(t => t.depths.includes(0)) ?? DEPTH_THEMES[0]
  const match = makeLocalMatch({ cls, sfx: makeSfx(loadMutedPref()) })
  decorateMap(match.map, rulesets[theme.ruleset])
  pvp = { match, theme, cls, picking: false }
  state = null
  setPhase(PHASE.PLAYING)
  menu.hide()
  keys[' '] = false
}

function stopPvp() {
  pvp = null
  hidePvpHud()
  goTitle()
}

function pvpFrame(delta) {
  const { match } = pvp
  for (const ev of stepMatch(match, localInputs(match, keys, sprintDetector.sprinting()), delta)) {
    if (ev.type === 'kill' && ev.victim === LOCAL_ID) {
      pvp.picking = true
      menu.showClassPicker({ title: 'Down!', subtitle: 'Class for your next life',
        onPick: cls => { setClass(match, LOCAL_ID, cls); pvp.cls = cls; pvp.picking = false; menu.hide(); keys[' '] = false } })
    }
    if (ev.type === 'respawn' && ev.hero === LOCAL_ID && pvp.picking) { pvp.picking = false; menu.hide() }
    if (ev.type === 'matchEnd') {
      menu.showPvpResults(ev.standings, { onNext: () => startPvp(pvp.cls), onQuit: stopPvp })
    }
  }
  const view = viewOf(match, pvp.theme)
  maybeComputeFOV(view.map, view.player, 12, { los: true })
  renderer.updateCamera(view.player, 0, null)
  renderer.render(view, null)
  updateHUD(view)
  updatePvpHud(pvpHudModel(match, LOCAL_ID))
  playCues(audio, drainSfx(match), view.player, match.sfx.muted)
}
```

In `goTitle`, add `onPvp: goPvpPicker,` to the `showTitle` options.

In `gameLoop`, replace the PLAYING block with:

```js
  if (phase === PHASE.PLAYING) {
    if (pvp) pvpFrame(delta)
    else {
      update(delta)
      if (state) render()
    }
  }
```

Key-handler guards:
- Escape handler: first line inside `if (e.key === 'Escape') {` becomes `if (pvp) { stopPvp(); return }`.
- I handler: after the key check, `if (pvp) return`.
- M handler: replace `if (!state?.sfx) return` with

```js
  if (pvp) { pvp.match.sfx.muted = !pvp.match.sfx.muted; saveMutedPref(pvp.match.sfx.muted); return }
  if (!state?.sfx) return
```
- Q, Shift and the in-game weapon cheat already return on `!state`; leave them.

- [ ] **Step 7: Run the suite and a syntax check**

Run: `npm test && node --check renderer/game.js && node --check renderer/ui/menu.js`
Expected: all PASS, no syntax errors.

- [ ] **Step 8: Commit**

```bash
git add renderer/pvp/local.js renderer/ui/pvp-hud.js renderer/systems/cheats.js renderer/ui/menu.js renderer/game.js test/pvp-ui.test.js
git commit -m "feat(pvp): local arena harness — pvp cheat, class picker, HUD, results, loop branch

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Live check, frame budget and wrap-up

**Files:**
- Modify: `tools/perf/trace.mjs` (a `pvp` level argument)
- Create (scratchpad, not committed): a Playwright live-check script
- Modify: `CLAUDE.md` (the dungeon-crawler section: one paragraph on `renderer/pvp/`)

- [ ] **Step 1: Let the tracer enter PvP**

In `tools/perf/trace.mjs`, replace the cheat-typing line with:

```js
const cheat = level === 'pvp' ? ['p', 'v', 'p', 'Enter'] : ['l', 'e', 'v', 'e', 'l', ...level.split('')]
for (const k of cheat) { await page.keyboard.press(k); await sleep(120) }
```
(`Enter` confirms the class picker's first button, Warrior. If the menu's confirm key isn't Enter, check `navActionFor` in `renderer/ui/menu.js` and use its confirm key.) Update the header comment's usage line to `node tools/perf/trace.mjs [depth=12|pvp] [seconds=5]`.

- [ ] **Step 2: Measure the frame cost**

Run: `node tools/perf/trace.mjs pvp 5` and, for comparison, `node tools/perf/trace.mjs 0 5`.
Expected: the PvP arena's main-thread ms/frame stays within ~2 ms of the level-0 arena and well under 16 ms. If it's much worse, the tracer's JS vs raster split says which side to look at. A JS-heavy result points at bots (e.g. `nextStep` every tick: throttle to every 5th tick per bot); a raster-heavy result points at the name-tag text.

- [ ] **Step 3: Live check in the web build (time-boxed, about 2 minutes)**

Start `npm run web` in the background, then run this script from the repo root (write it to the scratchpad; `playwright-core`'s chromium is available):

```js
import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto('http://localhost:8080')
await page.waitForTimeout(2500)
for (const k of ['p', 'v', 'p']) await page.keyboard.press(k)
await page.waitForTimeout(300)
await page.keyboard.press('Enter')                  // Warrior
await page.keyboard.down('d'); await page.waitForTimeout(1500); await page.keyboard.up('d')
await page.keyboard.down(' '); await page.waitForTimeout(400); await page.keyboard.up(' ')
for (const k of ['q', 'Shift', 'i', 'm', 'm']) { await page.keyboard.press(k); await page.waitForTimeout(150) }
await page.waitForTimeout(8000)
await page.screenshot({ path: process.argv[2] ?? 'pvp.png' })
await page.keyboard.press('Escape')                 // back to the title
await page.waitForTimeout(500)
const title = await page.locator('.menu-title').textContent()
console.log(JSON.stringify({ errors, title }))
await browser.close()
```
Expected: `errors` is `[]` and `title` is `DUNGEON CRAWLER`. Read the screenshot and confirm three things:
- the arena, with pillars, is drawn;
- at least one other hero shows a name tag and HP bar;
- the HUD strip shows the timer and kill counts.

If anything fails, fix it (with a test where the cause is in pure code) before continuing. Stop the web server afterwards.

- [ ] **Step 4: Document the new subsystem in CLAUDE.md**

In the dungeon-crawler section of `/home/lappemikb/CLAUDE.md`, after the `renderer/render/` bullet, add:

```markdown
- `renderer/pvp/` — the PvP arena (spec `docs/superpowers/specs/2026-09-25-pvp-multi-hero-core-design.md`, roadmap `…-pvp-roadmap.md`): a DOM-free fixed-30 Hz simulation (`sim.js` `makeMatch`/`stepMatch`) of 2–6 `type: 'hero'` heroes stepped from input intents (`hero.js` `tickHero`), attacks in `attacks.js`, every hero hit through `combat.js` `hurtHero` → `damagePlayer(…, hero)`, flasks/quivers/power rune in `pickups.js`, `bots.js` opponents, and `local.js` — the `pvp` title cheat plays you against 3 bots. Shared systems take an optional hero/caster (`damagePlayer`, `tryBlock`, `tryCast({caster})`, `castCone`, `castLightning`, `applyChain`) and projectiles/lightning marks carry `owner`; all tuning is in `renderer/data/pvp.js`. Networking is sub-project 3.
```

- [ ] **Step 5: Full suite and commit**

Run: `npm test`
Expected: PASS (on a lone WSL SIGSEGV, re-run once).

```bash
git add tools/perf/trace.mjs
git commit -m "chore(pvp): trace the arena, document renderer/pvp

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(`/home/lappemikb/CLAUDE.md` lives outside this repo, so it is edited but not committed here.)
