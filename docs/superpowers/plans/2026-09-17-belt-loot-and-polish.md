# Belt, Loot and Polish Implementation Plan (plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the shared belt tool into play (equip it from the panel, let any swing borrow its chop/mine), roll shields and the Leather Coat out of chests, draw every new item kind on the ground, and close plan 2's parked polish — the Mage's dead offhand blade.

**Architecture:** `player.belt` (already on the body and in the save since plan 1) gets its equip rules in `inventory.js` beside the hands, a pure `resolveTool(weapon, belt)` in `lumber.js` merges the swinging weapon's tool values with the belt's so `findHarvestHit`/`harvest` and game.js's swing closure read one resolved tool, and the panel grows a fourth narrow column for the belt over a `beltTile` model export without disturbing the three loadout columns. `loot.js` gains a shield band carved out of the melee weight and a Leather Coat band carved out of the potion weight, so the roll's total stays 100 for a veteran and the existing boundary tests move by known amounts. The canvas floating-item branch learns `shield` and `outfit` contents.

**Tech Stack:** Vanilla ES modules, Electron renderer, `node:test` + `node:assert/strict`. Run one file with `node --test test/<file>.test.js`, the suite with `npm test` (green at 2475 tests on `main` after PR #53).

**Spec:** `docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md` — §5 (belt in harvesting, belt equip gate), §6 (loot), §8 (belt tile, Belt button), §9 (test names `test/belt.test.js`, `test/loot.test.js` additions). Plans 1 (PR #52) and 2 (PR #53) are merged; this plan finishes the spec.

## Global Constraints

- Pure systems modules under `renderer/systems/` import nothing from `game.js` or the DOM; no import cycles (`loot.js` → `entities.js`/`inventory.js`/`data/levels.js` only; `lumber.js` imports nothing new).
- Refusal reasons stay `{ ok:false, reason }` with an `EQUIP_FAIL_MESSAGES` entry (`heavy`, `not_equippable`, `not_learned`, `two_handed`, `wrong_loadout`, `full` all exist).
- Spec §5 exact rules: `findHarvestHit(map, player, hitAt, reach, weapon)` receives the swinging weapon; where it lacks the needed tool value, `player.belt?.[tool]` is used instead; `harvest`/`chopTree` take the resolved value; the belt tool never fights and never appears in `drawHeldWeapon`. `canEquip(player, item, 'belt')` accepts a melee weapon with `chop` or `mine`; the heavy axe still needs the plate.
- Spec §6 exact values: `SHIELD_POOLS = { 1: ['buckler'], 2: ['buckler'], 3: ['buckler','kite'], 4: ['kite'] }`; outfit rung `OUTFIT_POOLS = { 2: ['leather'], 3: ['leather'], 4: ['leather'] }` (no tier-1 pool); shields share the melee category's weight (one in five melee picks is a shield → `BASE_WEIGHTS` melee 16 + shield 4); the Leather Coat is its own low-weight category (a twentieth of a chest → outfit 5, taken from the potion band: potion 30). Story outfits (ranger, robe, plate) never roll. The teaser rule (a fifth of the weight, tier-1 example) applies to a locked shield band exactly as to weapons. `tools/verify-loot.mjs` unchanged.
- Every new sprite key the canvas draws must exist in `SPRITES` (`test/sprites.test.js` guards weapons and shields; this plan extends it to outfits).
- No spoilers, no new controls: the panel's Belt button and belt tile are the only new UI.
- Controller ruling carried from plan 2's final review: a blade in the Mage's offhand can never swing (the swing closure runs only in the Warrior loadout), so `OFFHAND_KINDS.magic` drops `'weapon'` and the spec gets an "As built" note. Recorded as a spec deviation for the user to undo if unwanted.
- Commit after every task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` as the last line. Work on branch `belt-loot-polish` off `main`.

---

## File map

| File | Responsibility in this plan |
|---|---|
| `renderer/systems/inventory.js` | `isTool`, `canEquipBelt`, `canEquip(..., 'belt')`, `equipBelt`, `unequipBelt`, `beltItem`; a heavy belt rides on the plate (`beltToEvict` in `equipOutfit`/`unequipOutfit`); `OFFHAND_KINDS.magic` loses `'weapon'` |
| `renderer/systems/lumber.js` | `resolveTool(weapon, belt)`; `findHarvestHit` reads the resolved tool |
| `renderer/game.js` | swing closure builds its harvest tool with `resolveTool(wpn, player.belt)`; panel handlers `onEquipBelt`, `onUnequip` for `'belt'` |
| `renderer/ui/inventory-panel-model.js` | `beltTile`, `gearAt(9)`, `moveSelection` into/out of the belt tile, `gearAction('belt')`, `sackActions` Belt button |
| `renderer/ui/inventory-panel.js` | fourth column rendering the belt tile; `selectedItem` for the belt |
| `renderer/systems/loot.js` | `SHIELD_POOLS`, `OUTFIT_POOLS`, the shield and outfit bands, shield usability |
| `renderer/render/canvas.js` | floating `shield` and `outfit` contents draw their sprites |
| `docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md` | §4 As-built (Mage offhand), §6 As-built (weights) |
| Tests | `test/belt.test.js` (new), `test/loot.test.js` (rewrite boundaries + additions), `test/inventory-panel-model.test.js`, `test/lumber.test.js`, `test/offhand.test.js`, `test/sprites.test.js`, `test/canvas.test.js`, `test/adventure.test.js` |

---

### Task 1: Belt equip rules

**Files:**
- Modify: `renderer/systems/inventory.js` (`canEquip` ~169, after `canEquipOffhand`; `equipOutfit`/`unequipOutfit` ~324-350; export list)
- Test: `test/belt.test.js` (new), `test/adventure.test.js` (one new test beside the belt tests at ~423)

**Interfaces:**
- Produces: `isTool(payload) → boolean` (`chop` or `mine` present); `canEquipBelt(player, item) → { ok, reason? }` (`not_equippable` for anything but a melee weapon with a tool value; `heavy` when the payload is heavy and `canWieldHeavy` is false); `canEquip(player, item, 'belt')` delegates to it; `equipBelt(player, index) → { ok, equipped? }` moves the sack item into `player.belt`, a held belt swaps back into the sack; `unequipBelt(player) → { ok, reason? }` (`not_equippable` when empty, `full` when the sack has no room); `beltItem(payload) → sack item` (`{ kind:'weapon', name, emoji:'⚔', stackable:false, payload }`).
- Losing the plate's heavy grant (`unequipOutfit(player,'melee')`, or `equipOutfit` swapping the plate for a non-heavy outfit) also sends a heavy belt (the axe) to the sack, counted in the `roomFor` arithmetic like the heavy hand and the kite shields.
- Consumes: `canWieldHeavy`, `roomFor`, `handItem`, `offsToEvict`/`evictOffs` (plan 2) — all in `inventory.js` already.

- [ ] **Step 1: Write the failing tests**

`test/belt.test.js`:
```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isTool, canEquip, canEquipBelt, equipBelt, unequipBelt, beltItem, addItem, itemFromContents,
  equipOutfit, unequipOutfit, makeItem,
} from '../renderer/systems/inventory.js'
import { makePlayer, weaponContents, makeOutfitContents } from '../renderer/systems/entities.js'
import { gearWearing } from './helpers/outfits.js'

const mk = (over = {}) => ({ ...makePlayer(1, 1), ...over })
const weapon = wt => itemFromContents({ type: 'weapon', ...weaponContents(wt) })

describe('what fits on the belt', () => {
  it('a melee weapon with chop or mine; nothing else', () => {
    assert.equal(isTool(weaponContents('hatchet')), true)
    assert.equal(isTool(weaponContents('pick')), true)
    assert.equal(isTool(weaponContents('sword')), false)
    assert.equal(isTool(null), false)
    const p = mk()
    assert.equal(canEquipBelt(p, weapon('hatchet')).ok, true)
    assert.equal(canEquip(p, weapon('pick'), 'belt').ok, true)
    assert.deepEqual(canEquipBelt(p, weapon('sword')), { ok: false, reason: 'not_equippable' })
    assert.deepEqual(canEquipBelt(p, makeItem('potion')), { ok: false, reason: 'not_equippable' })
    assert.deepEqual(canEquipBelt(p, null), { ok: false, reason: 'not_equippable' })
  })
  it('the heavy axe still needs the plate', () => {
    assert.deepEqual(canEquipBelt(mk(), weapon('axe')), { ok: false, reason: 'heavy' })
    assert.equal(canEquipBelt(mk({ gear: gearWearing('plate') }), weapon('axe')).ok, true)
  })
})

describe('equipping the belt', () => {
  it('moves a hatchet from the sack onto the belt and back', () => {
    const p = mk()
    addItem(p, weapon('hatchet'))
    assert.equal(equipBelt(p, 0).ok, true)
    assert.equal(p.inventory.length, 0)
    assert.equal(p.belt.weaponType, 'hatchet')
    assert.equal(p.belt.chop, 1)
    assert.equal(unequipBelt(p).ok, true)
    assert.equal(p.belt, null)
    assert.deepEqual(p.inventory[0], beltItem(weaponContents('hatchet')))
    assert.equal(p.inventory[0].kind, 'weapon')
    assert.equal(p.inventory[0].emoji, '⚔')
  })
  it('a held belt tool swaps back into the sack', () => {
    const p = mk({ belt: weaponContents('hatchet') })
    addItem(p, weapon('pick'))
    assert.equal(equipBelt(p, 0).ok, true)
    assert.equal(p.belt.weaponType, 'pick')
    assert.deepEqual(p.inventory.map(i => i.payload.weaponType), ['hatchet'])
  })
  it('refuses what does not fit, and refuses a full sack on the way back', () => {
    const p = mk()
    addItem(p, weapon('sword'))
    assert.deepEqual(equipBelt(p, 0), { ok: false, reason: 'not_equippable' })
    assert.equal(p.belt, null)
    assert.deepEqual(unequipBelt(p), { ok: false, reason: 'not_equippable' })
    const q = mk({ belt: weaponContents('pick'), maxInventory: 0 })
    assert.deepEqual(unequipBelt(q), { ok: false, reason: 'full' })
    assert.equal(q.belt.weaponType, 'pick')
  })
  it('the belt never becomes a hand: the main hand stays as it was', () => {
    const p = mk({ weapon: weaponContents('sword') })
    addItem(p, weapon('hatchet'))
    equipBelt(p, 0)
    assert.equal(p.weapon.weaponType, 'sword')
  })
})

describe('a heavy belt rides on the plate', () => {
  const outfit = ot => itemFromContents(makeOutfitContents(ot))
  it('taking the plate off sends the axe on the belt to the sack', () => {
    const p = mk({ gear: gearWearing('plate'), belt: weaponContents('axe') })
    assert.equal(unequipOutfit(p, 'melee').ok, true)
    assert.equal(p.belt, null)
    assert.deepEqual(p.inventory.map(i => i.kind).sort(), ['outfit', 'weapon'])
    const q = mk({ gear: gearWearing('plate'), belt: weaponContents('axe'), maxInventory: 1 })
    assert.deepEqual(unequipOutfit(q, 'melee'), { ok: false, reason: 'full' })
    assert.equal(q.belt.weaponType, 'axe')
  })
  it('swapping the plate for the leather coat evicts it too; a hatchet stays', () => {
    const p = mk({ gear: gearWearing('plate'), belt: weaponContents('axe') })
    addItem(p, outfit('leather'))
    assert.equal(equipOutfit(p, 0, 'melee').ok, true)
    assert.equal(p.belt, null)
    assert.deepEqual(p.inventory.map(i => i.kind).sort(), ['outfit', 'weapon'])
    const q = mk({ gear: gearWearing('plate'), belt: weaponContents('hatchet') })
    assert.equal(unequipOutfit(q, 'melee').ok, true)
    assert.equal(q.belt.weaponType, 'hatchet')
  })
})
```
In `test/adventure.test.js`, beside the existing belt round-trip test (~line 423, the one that normalizes `belt: weaponContents('pick')`), add:
```js
  it('a saved belt is rebuilt from the table; an unknown tool is dropped', () => {
    const b = normalizeBody({ ...emptyBody(), belt: { weaponType: 'hatchet', name: 'Old Hatchet', damage: 9, chop: 9 } })
    assert.deepEqual(b.belt, weaponContents('hatchet'))
    assert.equal(normalizeBody({ ...emptyBody(), belt: { weaponType: 'spork' } }).belt, null)
  })
```
(`weaponContents` and `emptyBody` are already imported/defined in that file; the code under test exists from plan 1 — this pins it.)

- [ ] **Step 2: Run to see failure**

Run: `node --test test/belt.test.js test/adventure.test.js` → FAIL (`isTool` not exported).

- [ ] **Step 3: inventory.js**

After `canEquipOffhand`:
```js
// ── The belt ──────────────────────────────────────────────────────────────
// One shared tool the swing borrows chop/mine from (lumber.js resolveTool).
// Only a melee weapon that can chop or mine fits; the belt never fights and
// is never drawn in a hand. The heavy axe still needs the plate.
export const isTool = payload => !!(payload?.chop || payload?.mine)

export function canEquipBelt(player, item) {
  if (item?.kind !== 'weapon' || !isTool(item.payload)) return { ok: false, reason: 'not_equippable' }
  if (item.payload.heavy && !canWieldHeavy(player)) return { ok: false, reason: 'heavy' }
  return { ok: true }
}

export const beltItem = payload => handItem('weapon', payload)

// Sack slot `index` → belt; a held tool swaps back into the sack (net 0).
export function equipBelt(player, index) {
  const item = player.inventory[index]
  const gate = canEquipBelt(player, item)
  if (!gate.ok) return gate
  const held = player.belt
  player.belt = { ...item.payload }
  player.inventory.splice(index, 1)
  if (held) player.inventory.push(beltItem(held))
  return { ok: true, equipped: item }
}

export function unequipBelt(player) {
  if (!player.belt) return { ok: false, reason: 'not_equippable' }
  if (!roomFor(player, 1)) return { ok: false, reason: 'full' }
  player.inventory.push(beltItem(player.belt))
  player.belt = null
  return { ok: true }
}
```
`handItem` and `roomFor` are declared as `const`s *after* `canEquip` today; place this block after them (or hoist those two consts above) so nothing reads a `const` before its initialisation. In `canEquip`, add `if (slot === 'belt') return canEquipBelt(player, item)` beside the `'off'` line.

Heavy belt on the plate — next to `offsToEvict`:
```js
// The axe on the belt rides on the plate like the heavy hand and the kite
// shields: losing the heavy grant sends it to the sack.
function beltToEvict(player, stance, nextOutfit) {
  if (stance !== 'melee' || !player.belt?.heavy || nextOutfit?.heavy) return null
  return beltItem(player.belt)
}
```
In `equipOutfit`: `const beltEvict = beltToEvict(player, stance, item.payload)`; the `roomFor` count gains `+ (beltEvict ? 1 : 0)`; after `evictOffs(...)` add `if (beltEvict) { player.inventory.push(beltEvict); player.belt = null }`. In `unequipOutfit`: `const beltEvict = beltToEvict(player, stance, null)`; same count and push.

- [ ] **Step 4: Run**

Run: `node --test test/belt.test.js test/adventure.test.js test/equip-slots.test.js test/outfits.test.js test/offhand.test.js test/inventory.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/inventory.js test/belt.test.js test/adventure.test.js
git commit -m "feat: the belt — equip a tool beside the hands, heavy tools ride on the plate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The swing borrows the belt's tool

**Files:**
- Modify: `renderer/systems/lumber.js` (`findHarvestHit` ~92; new `resolveTool` above it), `renderer/game.js` (swing closure ~1508: `const tool = { chop: wpn.chop, mine: wpn.mine }`; the lumber import at line 44)
- Test: `test/belt.test.js` (append), `test/lumber.test.js` (unchanged, must stay green)

**Interfaces:**
- Produces: `resolveTool(weapon, belt) → { chop?, mine? }` — the weapon's own values, and for each tool the weapon lacks, the belt's; keys absent when neither has one (so `deepEqual` against `{ mine: 1 }` works).
- `findHarvestHit(map, player, hitAt, reachPx, weapon)` keeps its signature and reads `resolveTool(weapon, player.belt)` internally, per spec §5. `harvest(map, x, y, tool)` and `chopTree` are unchanged and take the resolved value from the caller.
- game.js: `const tool = resolveTool(wpn, player.belt)` feeds both `findHarvestHit` and `harvest`, so the swing's power on a tree comes from whichever of the swinging blade or the belt carries `chop`.

- [ ] **Step 1: Write the failing tests**

Append to `test/belt.test.js`:
```js
import { resolveTool, findHarvestHit, harvest, TREES } from '../renderer/systems/lumber.js'
import { TILE } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

const grassMap = () => { const m = createMap(8, 8); for (const row of m) for (const c of row) { c.tile = TILE.FLOOR; c.overlay = 'ow_grass' } return m }
const plant = (m, x, y, overlay) => { m[y][x].tile = TILE.WALL; m[y][x].overlay = overlay; m[y][x].losSoft = true }
const at = (x, y, belt = null) => ({ x, y, px: x * 32 + 16, py: y * 32 + 16, belt })
const anyHit = () => true

describe('resolveTool', () => {
  it('takes the weapon’s own values first and fills the gaps from the belt', () => {
    assert.deepEqual(resolveTool({ chop: 2 }, { chop: 1, mine: 1 }), { chop: 2, mine: 1 })
    assert.deepEqual(resolveTool({ damage: 1 }, { chop: 1 }), { chop: 1 })
    assert.deepEqual(resolveTool({ damage: 1 }, null), {})
    assert.deepEqual(resolveTool(null, { mine: 1 }), { mine: 1 })
    assert.deepEqual(resolveTool({ chop: 1 }, undefined), { chop: 1 })
  })
})

describe('a dagger swing with a hatchet on the belt', () => {
  const tree = Object.keys(TREES).find(k => TREES[k].cells === 1 && !TREES[k].border) ?? Object.keys(TREES)[0]
  it('finds the tree the dagger alone could not', () => {
    const m = grassMap(); plant(m, 3, 3, tree)
    const dagger = weaponContents('dagger')
    assert.equal(findHarvestHit(m, at(2, 3), anyHit, 46, dagger), null)
    assert.deepEqual(findHarvestHit(m, at(2, 3, weaponContents('hatchet')), anyHit, 46, dagger), { x: 3, y: 3 })
  })
  it('the resolved tool fells it at the belt’s chop, never the weapon’s damage', () => {
    const m = grassMap(); plant(m, 3, 3, tree)
    const tool = resolveTool(weaponContents('dagger'), weaponContents('hatchet'))
    assert.deepEqual(tool, { chop: 1 })
    const first = harvest(m, 3, 3, tool)
    assert.equal(first.kind, 'tree')
    assert.equal(m[3][3].chopHp, TREES[tree].hp - 1)
  })
  it('a pick on the belt lets a sword crack rock', () => {
    const m = grassMap(); m[3][3].overlay = 'ow_rock_gray_0'; m[3][3].tile = TILE.WALL
    const sword = weaponContents('sword')
    assert.equal(findHarvestHit(m, at(2, 3), anyHit, 46, sword), null)
    assert.deepEqual(findHarvestHit(m, at(2, 3, weaponContents('pick')), anyHit, 46, sword), { x: 3, y: 3 })
  })
})
```
Read `test/lumber.test.js`'s `grass()`/`tree()`/`pine()` helpers first and mirror them if `createMap`'s cells need different seeding than sketched above (the sketch assumes `createMap(w, h)` returns rows of cell objects with `tile`/`overlay`; adapt to the real helper rather than inventing a map shape). `TREES[tree].border` may not exist — pick any single-cell trunk key the way `test/lumber.test.js` does (`ow_tree_pine_trunk` with its top is fine: plant the trunk at (3,3) and the top at (3,2)).

- [ ] **Step 2: Run to see failure**

Run: `node --test test/belt.test.js` → FAIL (`resolveTool` not exported).

- [ ] **Step 3: lumber.js**

Above `findHarvestHit`:
```js
// The tool a swing harvests with: the swinging weapon's own chop/mine, and
// for each the weapon lacks, the belt's (spec §5). The belt never raises a
// value the weapon already carries, and it never fights — only this
// resolution reads it.
export function resolveTool(weapon, belt) {
  const chop = weapon?.chop || belt?.chop
  const mine = weapon?.mine || belt?.mine
  return { ...(chop && { chop }), ...(mine && { mine }) }
}
```
In `findHarvestHit`, first line: `const tool = resolveTool(weapon, player.belt)` and change the filter to `if (!t || !tool[t.def.tool]) continue`. Update the doc comment: "Only defs whose tool the weapon — or the belt — carries are considered."

- [ ] **Step 4: game.js**

Import `resolveTool` from `./systems/lumber.js` (line 44). In the swing closure replace `const tool = { chop: wpn.chop, mine: wpn.mine }` with:
```js
    // The belt lends its chop/mine to whichever blade swings (spec §5).
    const tool = resolveTool(wpn, player.belt)
```
The following `if (tool.chop || tool.mine)`, `findHarvestHit(..., tool)` and `harvest(..., tool)` lines stay as they are.

- [ ] **Step 5: Run**

Run: `node --test test/belt.test.js test/lumber.test.js test/quests.test.js 2>/dev/null; node --check renderer/game.js` → PASS (skip `quests.test.js` if it does not exist; the point is any test that drives `findHarvestHit`).

- [ ] **Step 6: Commit**

```bash
git add renderer/systems/lumber.js renderer/game.js test/belt.test.js
git commit -m "feat: a swing borrows chop and mine from the belt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Panel — belt tile and Belt button

**Files:**
- Modify: `renderer/ui/inventory-panel-model.js` (`beltTile` new; `gearAt`; `moveSelection` gear branch; `gearAction`; `sackActions`), `renderer/ui/inventory-panel.js` (`selectedItem` ~39; the strip render after the loadout columns ~60-75), `renderer/game.js` (`openInventory` handlers ~893-903)
- Test: `test/inventory-panel-model.test.js` (append)

**Interfaces:**
- `beltTile(player) → { slot:'belt', item }` where `item` is `asItem('weapon', player.belt)` (null when empty). `gearStrip` is unchanged (still three loadout columns), so every existing strip test stands.
- Gear index 9 is the belt: `gearAt(9) → { stance:'belt', slot:'belt' }`. `moveSelection`: from a gear tile in the Mage column, ArrowRight → `{ area:'gear', index: 9 }`; from 9, ArrowLeft → `{ area:'gear', index: 6 }` (Mage main), ArrowDown → `{ area:'sack', index: 0 }`, ArrowUp/ArrowRight → stays 9.
- `gearAction(player, 'belt', 'belt') → { label:'Unequip', fn:'onUnequip' }` when a belt tool is worn, else null (no `loadoutAvailable` gate — the belt has no loadout).
- `sackActions(player, item)` adds `{ label:'Belt', fn:'onEquipBelt' }` for a weapon when `canEquip(player, item, 'belt').ok`, after Offhand and before Drop.
- game.js: `onEquipBelt: i => report(equipBelt(state.player, i))`; `onUnequip` routes `slot === 'belt'` to `unequipBelt(state.player)`.
- Panel: a fourth `.inv-col` titled `Belt` with one tile (`dataset.slot = 'belt'`, gear index 9), never locked; `selectedItem` returns `beltTile(player).item` for stance `'belt'`.

- [ ] **Step 1: Write the failing tests**

Append to `test/inventory-panel-model.test.js`:
```js
import { beltTile, gearAt } from '../renderer/ui/inventory-panel-model.js'
describe('the belt in the panel', () => {
  it('shows the worn tool as a weapon tile, or nothing', () => {
    assert.equal(beltTile(mk()).item, null)
    const t = beltTile(mk({ belt: weaponContents('hatchet') }))
    assert.equal(t.slot, 'belt')
    assert.equal(t.item.kind, 'weapon')
    assert.equal(t.item.payload.weaponType, 'hatchet')
  })
  it('sits at gear index 9, right of the Mage column', () => {
    assert.deepEqual(gearAt(9), { stance: 'belt', slot: 'belt' })
    const counts = { sack: 3, gear: 10 }
    assert.deepEqual(moveSelection({ area: 'gear', index: 6 }, 'ArrowRight', counts), { area: 'gear', index: 9 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 8 }, 'ArrowRight', counts), { area: 'gear', index: 9 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 9 }, 'ArrowLeft', counts), { area: 'gear', index: 6 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 9 }, 'ArrowDown', counts), { area: 'sack', index: 0 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 9 }, 'ArrowUp', counts), { area: 'gear', index: 9 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 9 }, 'ArrowRight', counts), { area: 'gear', index: 9 })
  })
  it('offers Belt to tools the player can wear, Unequip on the tile', () => {
    const hatchet = itemFromContents({ type: 'weapon', ...weaponContents('hatchet') })
    assert.deepEqual(sackActions(mk(), hatchet).map(a => a.label), ['Equip', 'Offhand', 'Belt', 'Drop'])
    const axe = itemFromContents({ type: 'weapon', ...weaponContents('axe') })
    assert.deepEqual(sackActions(mk(), axe).map(a => a.label), ['Equip', 'Drop'])
    assert.deepEqual(sackActions(mk({ gear: gearWearing('plate') }), axe).map(a => a.label), ['Equip', 'Belt', 'Drop'])
    const sword = itemFromContents({ type: 'weapon', ...weaponContents('sword') })
    assert.deepEqual(sackActions(mk(), sword).map(a => a.label), ['Equip', 'Offhand', 'Drop'])
    assert.equal(gearAction(mk(), 'belt', 'belt'), null)
    assert.deepEqual(gearAction(mk({ belt: weaponContents('pick') }), 'belt', 'belt'), { label: 'Unequip', fn: 'onUnequip' })
  })
})
```
(The existing `moveSelection` test at ~line 69 asserts `{ area:'gear', index: 8 }` + ArrowRight stays 8 — it now moves to 9; update that one assertion to `{ area: 'gear', index: 9 }`.)

- [ ] **Step 2: Run to see failure** — `node --test test/inventory-panel-model.test.js` → FAIL (`beltTile` not exported).

- [ ] **Step 3: Model**

```js
// The belt is one tile to the right of the three loadout columns, gear
// index 9 (3 columns × 3 tiles come first). It has no loadout and is never
// locked.
export const BELT_INDEX = STANCES.length * GEAR_SLOTS.length   // 9
export function beltTile(player) {
  return { slot: 'belt', item: asItem('weapon', player.belt) }
}
```
`gearAt`: `index => index === BELT_INDEX ? { stance: 'belt', slot: 'belt' } : { stance: STANCES[Math.floor(index / 3)], slot: GEAR_SLOTS[index % 3] }`.

`gearAction`: first line becomes `if (stance === 'belt') return player.belt ? { label: 'Unequip', fn: 'onUnequip' } : null`, then the existing `loadoutAvailable` gate.

`sackActions`: after the Offhand push add
```js
    if (item.kind === 'weapon' && canEquip(player, item, 'belt').ok) out.push({ label: 'Belt', fn: 'onEquipBelt' })
```

`moveSelection` gear branch — before `const col = ...`:
```js
  if (sel.index === BELT_INDEX) {
    if (key === 'ArrowLeft') return { area: 'gear', index: (STANCES.length - 1) * 3 }
    if (key === 'ArrowDown') return { area: 'sack', index: 0 }
    return sel
  }
```
and the ArrowRight line becomes `if (key === 'ArrowRight') return col === STANCES.length - 1 ? { area: 'gear', index: BELT_INDEX } : { area: 'gear', index: (col + 1) * 3 + tile }`.

- [ ] **Step 4: Panel and game.js**

`inventory-panel.js`: import `beltTile, BELT_INDEX` alongside the model imports. `selectedItem`: `if (stance === 'belt') return beltTile(player).item` before the strip lookup. After the `gearStrip(player).forEach(...)` loop and before `panel.appendChild(strip)`:
```js
  // The belt: one shared tool, its own narrow column, never locked.
  const belt = beltTile(player)
  const beltCol = document.createElement('div')
  beltCol.className = 'inv-col'
  beltCol.innerHTML = `<div class="inv-col-name">Belt</div>`
  const beltEl = document.createElement('div')
  beltEl.className = 'inv-tile' + (sel.area === 'gear' && sel.index === BELT_INDEX ? ' selected' : '')
  beltEl.dataset.slot = 'belt'
  beltEl.innerHTML = iconHtml(belt.item)
  beltEl.addEventListener('click', () => { sel = { area: 'gear', index: BELT_INDEX }; refreshInventory(lastState) })
  beltCol.appendChild(beltEl)
  strip.appendChild(beltCol)
```
`game.js` `openInventory`: import `equipBelt, unequipBelt` from `./systems/inventory.js`; add `onEquipBelt: i => report(equipBelt(state.player, i)),` and in `onUnequip` add the branch `: slot === 'belt' ? unequipBelt(state.player)` before the offhand fallback. Update the file-top comment in `inventory-panel.js` ("three loadouts × main / off / outfit") to mention the belt column.

- [ ] **Step 5: Run** — `node --test test/inventory-panel-model.test.js; node --check renderer/ui/inventory-panel.js renderer/game.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add renderer/ui/inventory-panel-model.js renderer/ui/inventory-panel.js renderer/game.js test/inventory-panel-model.test.js
git commit -m "feat: panel belt tile and Belt button

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Loot — shields and the Leather Coat

**Files:**
- Modify: `renderer/systems/loot.js`
- Test: `test/loot.test.js` (rewrite the boundary describe; adjust two teaser numbers; append new tests)

**Interfaces:**
- `SHIELD_POOLS`, `OUTFIT_POOLS` (exported for tests/tools); `BASE_WEIGHTS = { potion: 30, melee: 16, shield: 4, ranged: 15, wand: 15, ammo: 15, outfit: 5 }`; band order potion, melee, shield, ranged, wand, ammo, outfit.
- Shield usability: `!contents.heavy || canWieldHeavy(player)` (a null player uses everything). A shield band with nothing usable is a teaser (weight × 0.2, tier-1 buckler) like the weapon bands.
- Outfit band: pool `OUTFIT_POOLS[tier] ?? []`, weight `BASE_WEIGHTS.outfit` when the pool is non-empty else 0, contents `makeOutfitContents(ot)`; leather has `loadout: null` so it is always usable and never a teaser.
- Chest contents for a shield: `makeShieldContents(wt)` → `{ type:'shield', weaponType, name, blockCost, heavy? }` (game.js's pickup path already converts it via `itemFromContents`).

New boundaries (veteran = every outfit worn, bows for every ammo kind): at tier 1 (depths 1, 2, 7) the outfit pool is empty so the total is 95 — potion [0, 30/95), melee [30/95, 46/95), shield [46/95, 50/95), ranged [50/95, 65/95), wand [65/95, 80/95), ammo [80/95, 95/95). At tiers 2–4 the total is 100 — potion [0,.30), melee [.30,.46), shield [.46,.50), ranged [.50,.65), wand [.65,.80), ammo [.80,.95), outfit [.95,1).

- [ ] **Step 1: Rewrite and extend the tests**

Replace the whole `describe('bands for a player who can use everything', ...)` block with:
```js
describe('bands for a player who can use everything', () => {
  // Tier 1 has no outfit pool: potion 30 / melee 16 / shield 4 / ranged 15 /
  // wand 15 / ammo 15 = 95. Boundaries .3158 / .4842 / .5263 / .6842 / .8421.
  it('the first three tenths are a potion', () => {
    assert.deepEqual(rollChestLoot(1, seq(0.0), veteran()), { type: 'potion', amount: 4 })
    assert.deepEqual(rollChestLoot(1, seq(0.31), veteran()), { type: 'potion', amount: 4 })
  })
  it('then a melee weapon with full stats', () => {
    assert.deepEqual(rollChestLoot(1, seq(0.32, 0.0), veteran()),
      { type: 'weapon', weaponType: 'dagger', name: 'Dagger', damage: 1 })
    assert.equal(rollChestLoot(1, seq(0.48, 0.0), veteran()).type, 'weapon')
  })
  it('one melee pick in five is a shield', () => {
    assert.deepEqual(rollChestLoot(1, seq(0.49, 0.0), veteran()),
      { type: 'shield', weaponType: 'buckler', name: 'Buckler', blockCost: 8 })
    assert.equal(rollChestLoot(1, seq(0.525, 0.0), veteran()).type, 'shield')
  })
  it('then a ranged weapon carrying its bundle but no ammo count', () => {
    const c = rollChestLoot(1, seq(0.53, 0.0), veteran())
    assert.equal(c.type, 'ranged')
    assert.equal(c.ammo, undefined)
    assert.equal(c.maxAmmo, undefined)
    assert.ok(c.bundle > 0)
  })
  it('then a wand, then ammo', () => {
    assert.equal(rollChestLoot(1, seq(0.69, 0.0), veteran()).type, 'wand')
    assert.equal(rollChestLoot(1, seq(0.85, 0.0), veteran()).type, 'ammo')
    assert.equal(rollChestLoot(1, seq(0.999, 0.0), veteran()).type, 'ammo')
  })
  it('from tier 2 the last twentieth is the Leather Coat', () => {
    // potion 30 / melee 16 / shield 4 / ranged 15 / wand 15 / ammo 15 / outfit 5 = 100.
    assert.equal(rollChestLoot(3, seq(0.949, 0.0), veteran()).type, 'ammo')
    assert.deepEqual(rollChestLoot(3, seq(0.95, 0.0), veteran()),
      { type: 'outfit', outfitType: 'leather', name: 'Leather Coat', loadout: null, protect: 1 })
    assert.equal(rollChestLoot(3, seq(0.999, 0.0), veteran()).type, 'outfit')
  })
})
```
In `describe('a locked category shrinks to a teaser')` change two boundary numbers and add one test:
- `'draws a locked bow teaser from tier 1 even on a tier-4 map'`: comment becomes `// ranged locked: potion 30 / melee 16 / shield 4 / ranged 3 / wand 15 / ammo 0 / outfit 5 = 73.` and the roll `rollChestLoot(18, seq(50 / 73 + 0.001, 0.99), p)`.
- `'draws a locked wand teaser from tier 1 even on a tier-4 map'`: comment `// wand locked: potion 30 / melee 16 / shield 4 / ranged 15 / wand 3 / ammo 15 / outfit 5 = 88.` and the roll `rollChestLoot(18, seq(65 / 88 + 0.001, 0.99), p)`.
- `'falls back to a tier-1 melee teaser when the whole tier is too heavy'`: comment `// melee locked: potion 30 / melee 3.2 / shield 0.8 / ranged 15 / wand 15 / ammo 15 / outfit 5 = 84.` and the roll `rollChestLoot(18, seq(30 / 84 + 0.001, 0.0), p)`; then add:
```js
  it('a tier-4 kite shield without the plate is a buckler teaser', () => {
    const p = mkPlayer({ outfits: ['ranger', 'robe'], ranged: 'shortbow' })
    // shield locked (tier 4 is the kite alone): 0.8 of 84, right after the melee teaser.
    const c = rollChestLoot(18, seq(33.2 / 84 + 0.001, 0.99), p)
    assert.equal(c.type, 'shield')
    assert.equal(c.weaponType, 'buckler')
  })
```
Append a new describe:
```js
describe('shield and outfit rungs', () => {
  it('tier 3 offers both shields, tier 4 the kite', () => {
    const shield = (d, p) => rollChestLoot(d, seq(0.47, p), veteran()).weaponType
    assert.equal(shield(4, 0.0), 'buckler')   // depth 4 = tier 3
    assert.equal(shield(4, 0.99), 'kite')
    assert.equal(shield(5, 0.0), 'kite')      // depth 5 = tier 4
    assert.equal(shield(1, 0.99), 'buckler')
  })
  it('no outfit rolls at tier 1', () => {
    for (let i = 0; i < 300; i++) assert.notEqual(rollChestLoot(1, Math.random, veteran()).type, 'outfit')
  })
  it('story outfits never roll', () => {
    for (let i = 0; i < 500; i++) {
      const c = rollChestLoot(18, Math.random, veteran())
      if (c.type === 'outfit') assert.equal(c.outfitType, 'leather')
    }
  })
  it('a plated player draws the kite; a null player draws everything', () => {
    assert.equal(rollChestLoot(5, seq(0.47, 0.99), mkPlayer({ outfits: ALL_OUTFITS, ranged: 'shortbow', sack: ['crossbow', 'sling'] })).weaponType, 'kite')
    assert.equal(rollChestLoot(5, seq(0.47, 0.99)).weaponType, 'kite')
    assert.equal(rollChestLoot(5, seq(0.96, 0.0)).type, 'outfit')
  })
})
```
Confirm `lootTierFor(4) === 3` and `lootTierFor(5) === 4` against the existing `'climbs 1,1,2,3,4 across the dungeon depths'` test before relying on them; adjust the depths if that test says otherwise.

- [ ] **Step 2: Run to see failure** — `node --test test/loot.test.js` → FAIL (potion at 0.31 passes, shield band missing, teaser boundaries wrong).

- [ ] **Step 3: loot.js**

Imports: add `makeShieldContents, makeOutfitContents` from `./entities.js` and `canWieldHeavy` from `./inventory.js`. After `WAND_POOLS`:
```js
// Shields ride in the melee category (one pick in five); the tall kite
// shield needs the plate, so a tier that holds only the kite locks like a
// heavy melee tier and teases the buckler instead.
export const SHIELD_POOLS = {
  1: ['buckler'],
  2: ['buckler'],
  3: ['buckler', 'kite'],
  4: ['kite'],
}
// The one chest outfit. Story outfits (ranger, robe, plate) are handed out by
// the world (systems/outfits.js), never rolled. No rung at tier 1: the first
// maps are for learning the sack, not filling it.
export const OUTFIT_POOLS = {
  2: ['leather'],
  3: ['leather'],
  4: ['leather'],
}
```
`BASE_WEIGHTS = { potion: 30, melee: 16, shield: 4, ranged: 15, wand: 15, ammo: 15, outfit: 5 }` with the comment extended: "Shields take a fifth of the old melee weight; the Leather Coat a twentieth of the chest, out of the potion band, so a veteran's roll still totals 100."

`canUse`:
```js
function canUse(player, contents) {
  if (!player) return true
  if (contents.type === 'shield') return !contents.heavy || canWieldHeavy(player)
  const item = itemFromContents(contents)
  return !item || canEquip(player, item).ok
}
```
In `rollChestLoot`'s `bands`, after the melee band: `weaponBand('shield', SHIELD_POOLS, tier, player, makeShieldContents),` and after the ammo band:
```js
    { weight: (OUTFIT_POOLS[tier] ?? []).length ? BASE_WEIGHTS.outfit : 0, pool: OUTFIT_POOLS[tier] ?? [],
      toContents: makeOutfitContents },
```
Update the file-top comment: shields and the Leather Coat are in the ladder; story outfits are not.

- [ ] **Step 4: Run** — `node --test test/loot.test.js test/inventory.test.js` → PASS. Also `node tools/verify-loot.mjs --help 2>/dev/null || node --check tools/verify-loot.mjs` (unchanged, must still parse).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/loot.js test/loot.test.js
git commit -m "feat: shields and the Leather Coat in the chest ladder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Sprite coverage — shields and outfits on the ground

**Files:**
- Modify: `renderer/render/canvas.js` (floating-item branch ~186-203)
- Test: `test/sprites.test.js` (~127-131), `test/canvas.test.js` (append to the describe that draws floating items — find `describe('floating consumables use atlas sprites'` and reuse its recorder)

**Interfaces:**
- A floating `{ type:'shield', weaponType }` draws `sprites[`weapon_${weaponType}`]`; a floating `{ type:'outfit', outfitType }` draws `sprites[`outfit_${outfitType}`]`; both airborne (no background fill) like weapons.
- `test/sprites.test.js` also asserts every `OUTFIT_TYPES` key has `SPRITES['outfit_<key>']` (all four exist today: `tile_0112`, `tile_0084`, `tile_0097`, `tile_0098`).

- [ ] **Step 1: Write the failing tests**

`test/sprites.test.js` — beside the weapon-key test, add (import `OUTFIT_TYPES`):
```js
  it('every outfit key resolves to a SPRITES entry', () => {
    const missing = Object.keys(OUTFIT_TYPES).filter(key => !SPRITES[`outfit_${key}`])
    assert.deepEqual(missing, [])
  })
```
`test/canvas.test.js` — in the floating-item describe, using that describe's recorder and sprite map conventions:
```js
  it('a shield and an outfit on the ground draw their sprites, not the ? glyph', () => {
    const ctx = /* the describe's recorder */ recorder()
    drawEntity(ctx, { type: 'floating_item', contents: { type: 'shield', weaponType: 'buckler' }, px: 0, py: 0 }, 0, 0, 32, { weapon_buckler: 'BUCKLER', outfit_leather: 'COAT' })
    drawEntity(ctx, { type: 'floating_item', contents: { type: 'outfit', outfitType: 'leather' }, px: 0, py: 0 }, 0, 0, 32, { weapon_buckler: 'BUCKLER', outfit_leather: 'COAT' })
    assert.deepEqual(ctx.images, ['BUCKLER', 'COAT'])
    assert.ok(!ctx.texts?.includes('?'))
  })
```
Adapt the entity shape (`px/py` vs `x/y`) and the recorder's field names to what the neighbouring floating-item test actually uses; the assertion that matters is that both sprites were drawn and no `?` text was.

- [ ] **Step 2: Run to see failure** — `node --test test/canvas.test.js test/sprites.test.js` → the canvas test FAILS (a `?` is drawn); the sprites test passes already (keep it — it guards future outfits).

- [ ] **Step 3: canvas.js**

In the floating-item branch: extend the weapon line to `if (c.type === 'weapon' || c.type === 'ranged' || c.type === 'wand' || c.type === 'shield')` and add before the `else` fallback:
```js
    } else if (c.type === 'outfit') {
      const s = sprites[`outfit_${c.outfitType}`]
      if (s) ctx.drawImage(s, px, py, S, S)
```

- [ ] **Step 4: Run** — `node --test test/canvas.test.js test/sprites.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/render/canvas.js test/canvas.test.js test/sprites.test.js
git commit -m "fix: shields and outfits on the ground draw their sprites

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Polish — the Mage's offhand takes no blade

**Files:**
- Modify: `renderer/systems/inventory.js` (`OFFHAND_KINDS` ~185 and its comment), `docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md` (§4 legality table: an "As built" note)
- Test: `test/offhand.test.js` (the `'Mage: wand, small blade, shield, consumable'` test ~74)

**Interfaces:**
- `OFFHAND_KINDS = { melee: ['weapon', 'shield'], ranged: [], magic: ['wand', 'shield'] }`. A dagger offered to the Mage's offhand is `not_equippable`.
- Everything downstream (panel Offhand button, `applyLoadout`'s kit offhand, canvas) already keys on `OFFHAND_KINDS`/`canEquipOffhand`, so no other code changes.

- [ ] **Step 1: Change the test**

Rename the Mage test to `'Mage: wand, shield, consumable — never a blade, since only the Warrior swings'` and make it:
```js
    const p = mk({ gear: gearWearing('robe'), attackMode: 'magic' })
    for (const item of [wand('frostwand'), shield('buckler'), makeItem('mushroom')])
      assert.equal(canEquipOffhand(p, item, 'magic').ok, true, item.kind)
    assert.deepEqual(canEquipOffhand(p, weapon('dagger'), 'magic'), { ok: false, reason: 'not_equippable' })
    assert.deepEqual(OFFHAND_KINDS.magic, ['wand', 'shield'])
```

- [ ] **Step 2: Run to see failure** — `node --test test/offhand.test.js` → FAIL.

- [ ] **Step 3: inventory.js and the spec**

`OFFHAND_KINDS.magic = ['wand', 'shield']`; comment: "The Archer's bows are two-handed, so only a belt potion rides with them; the Mage never swings, so a blade in that offhand would be dead weight (plan 3 ruling — spec §4 As built)."

Spec §4, under the legality table, add:
```
> **As built (plan 3):** the Mage's offhand takes a wand, a shield or a
> consumable — not a small blade. Melee swings only happen in the Warrior
> loadout, so a blade in the Mage's offhand could never be swung; offering
> the slot would promise something the loadout cannot deliver.
```

- [ ] **Step 4: Run** — `node --test test/offhand.test.js test/inventory-panel-model.test.js test/equip-slots.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/inventory.js test/offhand.test.js docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md
git commit -m "fix: the Mage's offhand takes no blade — only the Warrior swings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Boot check, docs

**Files:**
- Modify: `~/CLAUDE.md` (dungeon-crawler `renderer/systems/` bullet: the `inventory` entry's offhand legality line and a belt sentence; the `loot` entry; the `lumber` entry), `docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md` (§6 "As built" with the exact weights; §8 belt tile placement; a `**Status:**` line change to "Implemented — plans 1–3 merged")

- [ ] **Step 1: Boot and panel check (time-box 10 minutes)**

From the repo root, a playwright-core `_electron` launch (`{ args: ['.', '--dcdebug'], env: { ...process.env, DISPLAY: ':0' } }`, scratch script under the session scratchpad, not the repo): reach the title screen with no `pageerror`. Then, via `window.__dc` after starting a run with the `level7` cheat (or an arena config `player: { weaponType: 'dagger' }` with a `hatchet` chest — read `.claude/skills/arena-test/SKILL.md` for the config shape), put a hatchet in the sack (`addItem` through the debug handle if exposed, else the chest), open the panel with `I`, and confirm the DOM shows a fourth `.inv-col` with `[data-slot="belt"]` and that selecting the hatchet lists a `Belt` button. Read back `window.__dc.state.player.belt.weaponType === 'hatchet'` after pressing it. Record what you saw; if the debug handle does not expose what you need, say so and rely on the unit tests. Do not click the editor Build tab; `git status --short renderer/data/` must be clean afterwards.

- [ ] **Step 2: Docs**

`~/CLAUDE.md` (outside the repo — edit on disk): in the `inventory` entry, change "Mage: wand, blade or shield" to "Mage: wand or shield"; append "the shared **belt** (`player.belt`) holds one tool — `equipBelt`/`unequipBelt`, `canEquip(player, item, 'belt')` takes a melee weapon with `chop` or `mine` (the axe still needs the plate, and comes off with it) — that `resolveTool(weapon, belt)` in `lumber.js` lends to every swing where the blade lacks the tool; the panel's fourth column (`beltTile`, gear index 9) and its Belt button". In the `loot` entry add: "shields roll in the melee band (`SHIELD_POOLS`, one pick in five, the kite needing the plate or teasing a buckler) and the Leather Coat is its own twentieth-of-a-chest band from tier 2 (`OUTFIT_POOLS`); story outfits never roll; a floating shield or outfit draws its own sprite". In the `lumber` entry mention `resolveTool`.

Spec: §6 gains `> **As built:** BASE_WEIGHTS = { potion: 30, melee: 16, shield: 4, ranged: 15, wand: 15, ammo: 15, outfit: 5 } — the shield's four came out of melee's twenty, the coat's five out of potion's thirty-five, so a veteran's roll still totals 100 from tier 2 (95 at tier 1, where no coat rolls).` §8 gains `> **As built (plan 3):** the belt is a fourth, one-tile column right of the Mage's; gear index 9; **Belt** appears on a sack weapon that can chop or mine.` Change the `**Status:**` line to `Implemented — plans 1–3 merged (PRs #52, #53, and this plan's PR).`

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md
git commit -m "docs: belt, loot and polish — spec as-built notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
(`~/CLAUDE.md` is outside the repo; edit it on disk. If the arena skill was used, `git add .claude/skills/arena-test/JOURNAL.md` and the run's `LESSONS.md`/`SUGGESTIONS.md` too — the skill mandates them.)

---

## Self-review notes

- **Spec coverage (plan 3 scope):** §5 belt fallback → Task 2; §5 belt equip gate → Task 1; §6 loot (pools, weights, teaser, story outfits never roll) → Task 4; §8 belt tile / Belt button / Enter unequips → Task 3; "sprite/icon coverage" from the delivery order → Task 5; plan 2's parked Mage-blade item → Task 6; §7 belt persistence was built in plan 1 and is pinned by a test in Task 1. §9's `test/belt.test.js` and `test/loot.test.js` additions are Tasks 1–2 and 4; §9's `test/dual-wield.test.js` is covered by plan 2's `test/melee.test.js` and the per-hand chop/mine by Task 2's `resolveTool` tests — no separate file. The touch badge showing live for a Warrior blade (plan 2 review, finding 3) stays as ruled: spec §4's dim rules do not cover it.
- **Type consistency:** `resolveTool(weapon, belt) → { chop?, mine? }` (T2) is what game.js passes to `findHarvestHit`/`harvest` (T2) — both already accept `{ chop, mine }`. `beltItem(payload)` (T1) is `handItem('weapon', payload)`, the same sack shape `beltTile`'s `asItem('weapon', ...)` (T3) mirrors. `SHIELD_POOLS` entries feed `makeShieldContents` (T4), whose `{ type:'shield', weaponType, ... }` is what the canvas branch keys on (T5) and `itemFromContents` already converts. `BELT_INDEX = 9` (T3) is consumed by `gearAt`, `moveSelection`, the panel and `selectedItem`.
- **Known seams left for the final review:** Task 4's boundary arithmetic is spelled out per test; if `lootTierFor` maps depths differently from the assumed 4→3, 5→4, the implementer adjusts the depths, not the weights. Task 3's `BELT_INDEX` assumes `GEAR_SLOTS.length === 3` and `STANCES.length === 3`, both true today. The belt's HUD is deliberately absent (spec §5: it never fights, never in a hand).
