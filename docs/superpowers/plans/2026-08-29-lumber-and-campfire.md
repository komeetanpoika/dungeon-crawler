# Lumber and Campfire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fell overworld trees with a hatchet/axe for lumber, build a one-minute campfire from lumber, and cook raw meat on it into cooked meat that heals.

**Architecture:** Two new pure systems — `systems/lumber.js` (tree table, swing hit selection, felling, felled-record helpers) and `systems/campfire.js` (cost gate, placement, burn-out tick, cooking) — wired into `game.js` at the existing melee swing, the walk-onto pickup block, and the sack panel. Felled trunks persist in the adventure save (v5 `felled`); campfires are session-only. The map cell itself carries invisible chop hp; the overlay art stays a plain tree until the cell is felled.

**Tech Stack:** Electron + vanilla JS ES modules, `node:test` (`npm test`), 16 px PNG placeholders painted by `tools/npc-placeholders.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-29-lumber-and-campfire-design.md`

## Global Constraints

- Systems under `renderer/systems/` stay pure (no DOM/Web Audio); `game.js` owns wiring, messages and persistence.
- No HP bar or number for trees, ever; tree overlay art is unchanged until felled (`ow_stump`).
- Feedback tiers: sfx + spark on chop; text (`think`) only for refusals and the cook confirmation. No emoji icons — atlas sprites via `render/icons.js`.
- `CAMPFIRE_COST = 3`, `CAMPFIRE_DURATION = 60`, hatchet `chop: 1`, axe `chop: 2`, raw meat `heal: 1`, cooked meat `heal: 4`.
- Tree hp/yield: small/apple/small_autumn 3/1, deadtree 2/1, pine/autumn trunk 4/2 (two-cell; top at `y-1`).
- Run tests with `npm test` from the repo root (`node --test test/`). Run a single file with `node --test test/<file>.test.js`.
- Commit after every task with a conventional prefix (`feat:`, `art:`, `test:`), ending the message with the Co-Authored-By/Claude-Session trailer used by this repo.
- `renderer/data/open-maps.js` is generated — edit `tools/static-overworld/export-game-maps.mjs` and re-run `node tools/static-overworld/export-game-maps.mjs`.

---

### Task 1: Hatchet weapon type + starter

**Files:**
- Modify: `renderer/systems/entities.js:18-26` (`WEAPON_TYPES`)
- Modify: `renderer/systems/melee.js:8-14` (`ATTACK_STYLES`)
- Modify: `renderer/systems/stamina.js:10-16` (`MELEE_COSTS`)
- Modify: `renderer/render/sprites.js:71-74` (weapon sprites)
- Modify: `tools/static-overworld/export-game-maps.mjs:18` (`starter`)
- Regenerate: `renderer/data/open-maps.js`
- Test: `test/melee.test.js`, `test/stamina.test.js`, `test/sprites.test.js`, `test/openmap.test.js:311-323`

**Interfaces:**
- Produces: `WEAPON_TYPES.hatchet = { name: 'Hatchet', damage: 1, chop: 1 }`, `WEAPON_TYPES.axe.chop = 2`, and `weaponContents(weaponType) -> { weaponType, name, damage, heavy?, chop? }` — the one place a melee weapon's payload is built. Later tasks read `player.weapon.chop`.

- [ ] **Step 1: Write the failing tests**

Append to `test/melee.test.js`:

```js
import { WEAPON_TYPES } from '../renderer/systems/entities.js'

describe('hatchet', () => {
  it('is a light arc chopper that can chop wood; the axe chops harder', () => {
    assert.equal(WEAPON_TYPES.hatchet.chop, 1)
    assert.equal(WEAPON_TYPES.axe.chop, 2)
    assert.equal(WEAPON_TYPES.dagger.chop, undefined)
    assert.equal(WEAPON_TYPES.hatchet.heavy, undefined)
    assert.equal(getAttack('hatchet').style, 'arc')
    assert.equal(isChargeWeapon('hatchet'), false)
  })
  it('weapon payloads carry chop (and heavy) only when the type has it', () => {
    assert.deepEqual(weaponContents('hatchet'), { weaponType: 'hatchet', name: 'Hatchet', damage: 1, chop: 1 })
    assert.deepEqual(weaponContents('axe'), { weaponType: 'axe', name: 'Axe', damage: 4, heavy: true, chop: 2 })
    assert.deepEqual(weaponContents('dagger'), { weaponType: 'dagger', name: 'Dagger', damage: 1 })
    assert.equal(makeWeapon(0, 0, 'hatchet').chop, 1)
  })
})
```

(import `weaponContents, makeWeapon` from `entities.js` in that test file.)

Append to `test/stamina.test.js`:

```js
  it('the hatchet costs between dagger and sword', () => {
    assert.equal(meleeCost('hatchet', 'full'), 10)
  })
```

(place inside the existing `describe` that already imports `meleeCost`).

Append to `test/sprites.test.js`:

```js
describe('hatchet art', () => {
  it('weapon_hatchet = tile_0119 (single-bit axe); the big axe keeps tile_0118', () => {
    assert.equal(SPRITES.weapon_hatchet, 'tile_0119')
    assert.equal(SPRITES.weapon_axe, 'tile_0118')
  })
})
```

Edit `test/openmap.test.js` starter test: rename to `'Clearings declares a hatchet; the chest lands beside the village spawn'` and change both `'dagger'` assertions to `'hatchet'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/melee.test.js test/stamina.test.js test/sprites.test.js test/openmap.test.js`
Expected: FAIL — `chop` undefined, `meleeCost('hatchet')` returns 8 (dagger fallback), `weapon_hatchet` undefined, starter is `'dagger'`.

- [ ] **Step 3: Implement**

`renderer/systems/entities.js` — `WEAPON_TYPES`:

```js
export const WEAPON_TYPES = {
  // `chop` is the damage a swing deals a tree (systems/lumber.js); blades
  // without it can't fell anything.
  hatchet:   { name: 'Hatchet',   damage: 1, chop: 1 },
  dagger:    { name: 'Dagger',    damage: 1 },
  sword:     { name: 'Sword',     damage: 2 },
  longsword: { name: 'Longsword', damage: 3, heavy: true },
  axe:       { name: 'Axe',       damage: 4, heavy: true, chop: 2 },
  maunonmiekka: { name: 'Maunonmiekka', damage: 10 },
}
```

(keep the existing maunonmiekka comment.) The payload is currently assembled by hand in three places (`entities.js:169` `makeWeapon`, `game.js:347-351` the `'weapon'` spawn case, `loot.js:18-20`). Replace all three with one helper in `entities.js`, right after `WEAPON_TYPES`:

```js
// The melee-weapon payload every chest, drop and hand slot carries.
export function weaponContents(weaponType) {
  const def = WEAPON_TYPES[weaponType] ?? WEAPON_TYPES.dagger
  return { weaponType: def === WEAPON_TYPES[weaponType] ? weaponType : 'dagger', name: def.name, damage: def.damage,
    ...(def.heavy && { heavy: true }), ...(def.chop && { chop: def.chop }) }
}

export function makeWeapon(x, y, weaponType = 'dagger') {
  return { type: 'weapon', x, y, ...weaponContents(weaponType) }
}
```

`game.js` weapon case: `return [makeChest(s.x, s.y, { type: 'weapon', ...weaponContents(s.weaponType ?? 'dagger') })]` (drop the now-unused `WEAPON_TYPES` import if nothing else in `game.js` uses it). `loot.js:18-20`: `return { type: 'weapon', ...weaponContents(pick(MELEE_POOLS[tier], rng)) }` (import `weaponContents`; drop the `WEAPON_TYPES` import if unused). Run `node --test test/loot.test.js test/entities.test.js test/progression.test.js` — the payload shape for existing types is unchanged, so they must still pass.

`renderer/systems/melee.js` — add to `ATTACK_STYLES`:

```js
  hatchet:      { style: 'arc',   duration: 0.18, cooldown: 0.38, knockback: 14 },
```

`renderer/systems/stamina.js` — add to `MELEE_COSTS`:

```js
  hatchet:      { full: 10 },
```

`renderer/render/sprites.js` — after `weapon_dagger`:

```js
  weapon_hatchet:   'tile_0119',   // single-bit axe; the chopping starter
```

`tools/static-overworld/export-game-maps.mjs:18` — `starter: 'hatchet',`. Then run `node tools/static-overworld/export-game-maps.mjs` and check `git diff --stat renderer/data/open-maps.js` shows only that file changed (the starter string).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/entities.js renderer/systems/melee.js renderer/systems/stamina.js renderer/render/sprites.js tools/static-overworld/export-game-maps.mjs renderer/data/open-maps.js test/
git commit -m "feat(weapons): hatchet starter weapon; hatchet and axe can chop"
```

---

### Task 2: Placeholder art (lumber, cooked meat, stump, campfire)

**Files:**
- Modify: `tools/npc-placeholders.mjs:40-45`
- Create (generated): `renderer/assets/tiles/item_lumber.png`, `item_meat_cooked.png`, `ow_stump.png`, `prop_campfire.png`
- Modify: `renderer/render/sprites.js:43` (register keys)
- Test: `test/sprites.test.js`

**Interfaces:**
- Produces sprite keys `item_lumber`, `item_meat_cooked`, `ow_stump`, `prop_campfire` (key === file name).

- [ ] **Step 1: Write the failing test**

Append to `test/sprites.test.js`:

```js
describe('lumber and campfire placeholders', () => {
  for (const key of ['item_lumber', 'item_meat_cooked', 'ow_stump', 'prop_campfire'])
    it(`${key} is registered under its own file name`, () => assert.equal(SPRITES[key], key))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/sprites.test.js`
Expected: FAIL — keys undefined (and the "every sprite key points to a real file" test will fail once keys exist but files don't).

- [ ] **Step 3: Paint and register**

In `tools/npc-placeholders.mjs`, after the `MEAT` constant add four 16×16 rows arrays (same `paint(rows, pal)` helper; `.` transparent, `#` outline):

```js
// Lumber — two logs stacked, cut ends showing rings.
const LUMBER = paint([
  '................', '................', '................', '..############..',
  '.#bbbbbbbbbbbbc#', '#rbbbbbbbbbbbbc#', '#rbbbbbbbbbbbbc#', '.#bbbbbbbbbbbbc#',
  '..############..', '.#bbbbbbbbbbbbc#', '#rbbbbbbbbbbbbc#', '#rbbbbbbbbbbbbc#',
  '.#bbbbbbbbbbbbc#', '..############..', '................', '................',
], { b: [139, 90, 43, 255], c: [222, 184, 135, 255], r: [200, 160, 110, 255] })

// Cooked meat — the drumstick, browned with a char line.
const MEAT_COOKED = paint([
  '................', '................', '......####......', '.....#rrrr#.....',
  '....#rrkkrr#....', '....#rkrrkr#....', '....#rrrrrr#....', '....#rrrrr#.....',
  '.....#rrr#......', '......#b#.......', '......#b#.......', '.......#b#......',
  '.......#b##.....', '........#ww#....', '.........##.....', '................',
], { r: [150, 75, 40, 255], k: [80, 40, 20, 255], b: [222, 205, 170, 255], w: [245, 240, 225, 255] })

// Stump — a cut trunk seen from above-front, rings on the cut face.
const STUMP = paint([
  '................', '................', '................', '................',
  '................', '.....######.....', '....#ccccccc#...', '...#ccrrrrrcc#..',
  '...#crrcccrrc#..', '...#ccrrrrrcc#..', '...#bbbbbbbbb#..', '...#bbbbbbbbb#..',
  '...#bbbbbbbbb#..', '....#########...', '................', '................',
], { b: [110, 70, 35, 255], c: [222, 184, 135, 255], r: [190, 150, 100, 255] })

// Campfire — crossed logs with a flame.
const CAMPFIRE = paint([
  '................', '................', '.......#........', '......#y#.......',
  '.....#yyy#......', '.....#yoy#......', '....#yoooy#.....', '....#ooroo#.....',
  '...#oorrroo#....', '...#orrrrro#....', '....#rrrrr#.....', '.#bb#######bb#..',
  '..#bbbbbbbbb#...', '.#bbbb#b#bbbb#..', '..###..#..###...', '................',
], { y: [255, 230, 120, 255], o: [255, 150, 40, 255], r: [220, 60, 30, 255], b: [120, 75, 40, 255] })
```

Extend the write loop's list:

```js
for (const [name, px] of [['npc_chicken', CHICKEN], ['npc_deer', DEER], ['item_meat', MEAT],
  ['item_lumber', LUMBER], ['item_meat_cooked', MEAT_COOKED], ['ow_stump', STUMP], ['prop_campfire', CAMPFIRE]]) {
```

Run `node tools/npc-placeholders.mjs` — expect four `wrote` lines and `kept` for the existing three. Look at the results (`Read` the PNGs) and touch up pixels if something reads wrong.

`renderer/render/sprites.js`, after `item_meat`:

```js
  item_lumber:      'item_lumber',       // placeholders drawn by tools/npc-placeholders.mjs
  item_meat_cooked: 'item_meat_cooked',
  ow_stump:         'ow_stump',          // felled-tree cell overlay (systems/lumber.js)
  prop_campfire:    'prop_campfire',     // campfire entity (systems/campfire.js)
```

- [ ] **Step 4: Run tests**

Run: `node --test test/sprites.test.js test/png-read.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/npc-placeholders.mjs renderer/assets/tiles/item_lumber.png renderer/assets/tiles/item_meat_cooked.png renderer/assets/tiles/ow_stump.png renderer/assets/tiles/prop_campfire.png renderer/render/sprites.js test/sprites.test.js
git commit -m "art: placeholder lumber, cooked meat, stump and campfire sprites"
```

---

### Task 3: Lumber and cooked-meat item kinds

**Files:**
- Modify: `renderer/systems/inventory.js:5-32` (kinds, contents round-trip, consumables)
- Modify: `renderer/render/icons.js:7`
- Test: `test/inventory.test.js`, `test/icons.test.js`

**Interfaces:**
- Produces: `makeItem('lumber')`, `makeItem('cooked_meat')` (`heal: 4`); `makeItem('meat').heal === 1`; `itemFromContents({ type: 'lumber', count: 2 })` → stack of 2; `contentsFromItem` inverse; `CONSUMABLE_KINDS` includes `cooked_meat`.

- [ ] **Step 1: Write the failing tests**

Append to `test/inventory.test.js`:

```js
describe('lumber and cooked meat', () => {
  it('lumber stacks and carries a count through contents', () => {
    const item = itemFromContents({ type: 'lumber', count: 2 })
    assert.equal(item.kind, 'lumber')
    assert.equal(item.stackable, true)
    assert.equal(item.count, 2)
    assert.deepEqual(contentsFromItem(item), { type: 'lumber', count: 2 })
    const p = mkPlayer()
    addItem(p, item)
    addItem(p, makeItem('lumber'))
    assert.equal(p.inventory.length, 1)
    assert.equal(p.inventory[0].count, 3)
  })
  it('contents without a count default to one', () => {
    assert.equal(itemFromContents({ type: 'lumber' }).count, 1)
    assert.equal(itemFromContents({ type: 'meat' }).count, 1)
  })
  it('raw meat heals 1, cooked meat heals 4, both are quick-use consumables', () => {
    assert.equal(makeItem('meat').heal, 1)
    assert.equal(makeItem('cooked_meat').heal, 4)
    assert.equal(itemFromContents({ type: 'cooked_meat' }).kind, 'cooked_meat')
    assert.deepEqual(contentsFromItem(makeItem('cooked_meat')), { type: 'cooked_meat', count: 1 })
    const p = mkPlayer({ inventory: [makeItem('lumber'), makeItem('cooked_meat')] })
    assert.equal(findQuickUseIndex(p.inventory), 1)
    assert.equal(quickUseSummary(p.inventory).count, 1)
  })
  it('lumber is not a consumable', () => {
    assert.equal(findQuickUseIndex([makeItem('lumber')]), -1)
  })
})
```

Add to `test/icons.test.js` `'maps consumables by kind'`:

```js
    assert.equal(iconSpriteFor({ kind: 'meat' }), 'item_meat')
    assert.equal(iconSpriteFor({ kind: 'cooked_meat' }), 'item_meat_cooked')
    assert.equal(iconSpriteFor({ kind: 'lumber' }), 'item_lumber')
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/inventory.test.js test/icons.test.js`
Expected: FAIL — `makeItem('lumber')` throws (undefined def), heal is 2, icons null.

- [ ] **Step 3: Implement**

`renderer/systems/inventory.js`:

```js
const STACKABLE_KINDS = {
  potion:      { name: 'Potion',      emoji: '🧪', extra: { amount: 4 } },
  mushroom:    { name: 'Mushroom',    emoji: '🍄', extra: {} },
  meat:        { name: 'Meat',        emoji: '🍖', extra: { heal: 1 } },   // animal drop, raw
  cooked_meat: { name: 'Cooked Meat', emoji: '🍗', extra: { heal: 4 } },   // raw meat cooked on a campfire
  lumber:      { name: 'Lumber',      emoji: '🪵', extra: {} },            // felled tree (systems/lumber.js)
}

export function makeItem(kind, count = 1) {
  const def = STACKABLE_KINDS[kind]
  return { kind, name: def.name, emoji: def.emoji, stackable: true, count, ...def.extra }
}

// Chest/floating `contents` -> sack item. Unknown types return null.
export function itemFromContents(contents) {
  if (contents.type === 'weapon' || contents.type === 'ranged') {
    const { type, ...payload } = contents
    return { kind: type, name: contents.name, emoji: type === 'weapon' ? '⚔' : '🏹', stackable: false, payload }
  }
  if (STACKABLE_KINDS[contents.type]) return makeItem(contents.type, contents.count ?? 1)
  return null
}

export function contentsFromItem(item) {
  if (item.kind === 'weapon') return { ...item.payload, type: 'weapon' }
  if (item.kind === 'ranged') return { ...item.payload, type: 'ranged' }
  if (item.kind === 'potion') return { type: 'potion', amount: item.amount }
  return { type: item.kind, count: item.count ?? 1 }
}

const CONSUMABLE_KINDS = ['potion', 'mushroom', 'meat', 'cooked_meat']
```

`test/inventory.test.js:200` asserts `contentsFromItem(m)` deep-equals `{ type: 'meat' }`; change it to `{ type: 'meat', count: 1 }` (contents consumers only read `type`, and `itemFromContents` now honours `count`).

`renderer/render/icons.js`:

```js
const KIND_ICONS = { potion: 'potion', mushroom: 'ow_mushroom', meat: 'item_meat',
  cooked_meat: 'item_meat_cooked', lumber: 'item_lumber' }
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/inventory.js renderer/render/icons.js test/inventory.test.js test/icons.test.js
git commit -m "feat(inventory): lumber and cooked meat kinds; raw meat heals 1"
```

---

### Task 4: `systems/lumber.js` — trees, hit selection, felling

**Files:**
- Create: `renderer/systems/lumber.js`
- Test: `test/lumber.test.js`

**Interfaces:**
- Produces:
  - `TREES` — `{ [overlay]: { hp, yield, cells } }`
  - `resolveTree(map, x, y) -> { x, y, def } | null` (tops resolve to the trunk below)
  - `findTreeHit(map, player, hitAt, reachPx) -> { x, y } | null`
  - `chopTree(map, x, y, chop) -> { felled, yield }`
  - `applyFelled(map, keys)` — `keys` are `'x,y'` strings
  - `felledCells(map) -> string[]`
  - `STUMP = 'ow_stump'`
- Consumes: `TILE` from `entities.js`.

- [ ] **Step 1: Write the failing tests**

Create `test/lumber.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TREES, STUMP, resolveTree, findTreeHit, chopTree, applyFelled, felledCells } from '../renderer/systems/lumber.js'
import { TILE } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

// 7x7 all-floor map; callers stamp trees.
function grass() {
  const m = createMap(7, 7)
  for (const row of m) for (const c of row) { c.tile = TILE.FLOOR; c.skin = 'ow_grass_0' }
  return m
}
function tree(m, x, y, overlay) { m[y][x].tile = TILE.WALL; m[y][x].overlay = overlay; m[y][x].losSoft = true }
function pine(m, x, y) { tree(m, x, y, 'ow_tree_pine_trunk'); tree(m, x, y - 1, 'ow_tree_pine_top') }
const player = (x, y) => ({ x, y, px: x * 32 + 16, py: y * 32 + 16 })
const anyHit = () => true

describe('tree table', () => {
  it('lists every overworld tree overlay with hp and yield', () => {
    assert.deepEqual(TREES.ow_tree_small, { hp: 3, yield: 1, cells: 1 })
    assert.deepEqual(TREES.ow_tree_apple, { hp: 3, yield: 1, cells: 1 })
    assert.deepEqual(TREES.ow_tree_small_autumn, { hp: 3, yield: 1, cells: 1 })
    assert.deepEqual(TREES.ow_deadtree_0, { hp: 2, yield: 1, cells: 1 })
    assert.deepEqual(TREES.ow_deadtree_1, { hp: 2, yield: 1, cells: 1 })
    assert.deepEqual(TREES.ow_tree_pine_trunk, { hp: 4, yield: 2, cells: 2 })
    assert.deepEqual(TREES.ow_tree_autumn_trunk, { hp: 4, yield: 2, cells: 2 })
    assert.equal(TREES.ow_tree_pine_top, undefined)
    assert.equal(TREES.ow_bush_0, undefined)
  })
})

describe('resolveTree', () => {
  it('a trunk resolves to itself', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_small')
    assert.deepEqual(resolveTree(m, 3, 3), { x: 3, y: 3, def: TREES.ow_tree_small })
  })
  it('a pine top resolves to the trunk below it', () => {
    const m = grass(); pine(m, 3, 3)
    assert.deepEqual(resolveTree(m, 3, 2), { x: 3, y: 3, def: TREES.ow_tree_pine_trunk })
  })
  it('an orphan top, bushes, rocks and grass are not trees', () => {
    const m = grass(); tree(m, 3, 2, 'ow_tree_pine_top'); tree(m, 5, 5, 'ow_bush_0')
    assert.equal(resolveTree(m, 3, 2), null)
    assert.equal(resolveTree(m, 5, 5), null)
    assert.equal(resolveTree(m, 1, 1), null)
    assert.equal(resolveTree(m, -1, 0), null)
  })
})

describe('findTreeHit', () => {
  it('returns the nearest trunk whose centre is inside the wedge', () => {
    const m = grass(); tree(m, 4, 3, 'ow_tree_small'); tree(m, 5, 3, 'ow_tree_small')
    const p = player(3, 3)
    const east = (dx, dy) => dx > 0 && Math.abs(dy) < 16   // a narrow eastward wedge
    assert.deepEqual(findTreeHit(m, p, east, 46), { x: 4, y: 3 })
  })
  it('ignores trees outside the wedge', () => {
    const m = grass(); tree(m, 2, 3, 'ow_tree_small')
    const east = (dx, dy) => dx > 0 && Math.abs(dy) < 16
    assert.equal(findTreeHit(m, player(3, 3), east, 46), null)
  })
  it('a swing that catches only a pine top still chops the trunk', () => {
    const m = grass(); pine(m, 3, 3)   // trunk at (3,3), top at (3,2)
    const p = player(3, 1)             // standing north of the top
    const south = (dx, dy) => dy > 0 && Math.abs(dx) < 16
    assert.deepEqual(findTreeHit(m, p, south, 46), { x: 3, y: 3 })
  })
  it('never looks beyond the reach', () => {
    const m = grass(); tree(m, 6, 3, 'ow_tree_small')
    assert.equal(findTreeHit(m, player(1, 3), anyHit, 34), null)
  })
})

describe('chopTree', () => {
  it('needs hp hits; the overlay stays the plain tree until it falls', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_small')
    assert.deepEqual(chopTree(m, 3, 3, 1), { felled: false, yield: 0 })
    assert.equal(m[3][3].overlay, 'ow_tree_small')
    assert.equal(m[3][3].tile, TILE.WALL)
    assert.deepEqual(chopTree(m, 3, 3, 1), { felled: false, yield: 0 })
    assert.deepEqual(chopTree(m, 3, 3, 1), { felled: true, yield: 1 })
    assert.equal(m[3][3].tile, TILE.FLOOR)
    assert.equal(m[3][3].overlay, STUMP)
    assert.equal(m[3][3].losSoft, undefined)
    assert.equal(m[3][3].chopHp, undefined)
    assert.equal(m[3][3].dirty, true)
  })
  it('the axe fells a dead tree in one blow', () => {
    const m = grass(); tree(m, 3, 3, 'ow_deadtree_1')
    assert.deepEqual(chopTree(m, 3, 3, 2), { felled: true, yield: 1 })
  })
  it('a felled pine clears its top as well and yields two', () => {
    const m = grass(); pine(m, 3, 3)
    assert.deepEqual(chopTree(m, 3, 3, 4), { felled: true, yield: 2 })
    assert.equal(m[3][3].overlay, STUMP)
    assert.equal(m[2][3].tile, TILE.FLOOR)
    assert.equal(m[2][3].overlay, null)
    assert.equal(m[2][3].losSoft, undefined)
  })
  it('a stump or a non-tree cannot be chopped', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_small')
    chopTree(m, 3, 3, 3)
    assert.deepEqual(chopTree(m, 3, 3, 3), { felled: false, yield: 0 })
    assert.deepEqual(chopTree(m, 1, 1, 3), { felled: false, yield: 0 })
  })
})

describe('felled record', () => {
  it('felledCells lists stumps as "x,y" and applyFelled restores them idempotently', () => {
    const m = grass(); tree(m, 3, 3, 'ow_tree_small'); pine(m, 5, 4)
    chopTree(m, 3, 3, 3); chopTree(m, 5, 4, 4)
    assert.deepEqual(felledCells(m).sort(), ['3,3', '5,4'])
    const fresh = grass(); tree(fresh, 3, 3, 'ow_tree_small'); pine(fresh, 5, 4)
    applyFelled(fresh, ['3,3', '5,4', '9,9', '1,1'])   // out-of-range and non-tree keys are ignored
    assert.equal(fresh[3][3].overlay, STUMP)
    assert.equal(fresh[4][5].overlay, STUMP)
    assert.equal(fresh[3][5].tile, TILE.FLOOR)
    applyFelled(fresh, ['3,3'])
    assert.equal(fresh[3][3].overlay, STUMP)
    assert.deepEqual(felledCells(fresh).sort(), ['3,3', '5,4'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/lumber.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `renderer/systems/lumber.js`**

```js
// Trees and lumber: which overlay art is a choppable tree, which cell a
// swing lands on, and what felling leaves behind. Pure map mutation —
// game.js spawns the lumber pickup, plays the cues and persists the record.
//
// Chop damage lives in cell.chopHp and is deliberately invisible: the
// overlay stays the plain tree until the cell is felled (no bar, no
// number). Per-damage tree art may come later.
import { TILE } from './entities.js'

export const STUMP = 'ow_stump'
const TILE_SIZE = 32

// Keyed by the overlay buildOpenMap stamps on the blocking cell. Two-cell
// trees are addressed by the trunk; the `_top` overlay sits at y-1.
export const TREES = {
  ow_tree_small:        { hp: 3, yield: 1, cells: 1 },
  ow_tree_small_autumn: { hp: 3, yield: 1, cells: 1 },
  ow_tree_apple:        { hp: 3, yield: 1, cells: 1 },
  ow_deadtree_0:        { hp: 2, yield: 1, cells: 1 },
  ow_deadtree_1:        { hp: 2, yield: 1, cells: 1 },
  ow_tree_pine_trunk:   { hp: 4, yield: 2, cells: 2 },
  ow_tree_autumn_trunk: { hp: 4, yield: 2, cells: 2 },
}

const isTop = overlay => typeof overlay === 'string' && overlay.endsWith('_top')

// The tree a cell belongs to: trunks resolve to themselves, tops to the
// trunk directly below. Null for anything else (an orphan top is scenery).
export function resolveTree(map, x, y) {
  const cell = map[y]?.[x]
  if (!cell) return null
  const def = TREES[cell.overlay]
  if (def) return { x, y, def }
  if (isTop(cell.overlay)) {
    const below = map[y + 1]?.[x]
    const tdef = below && TREES[below.overlay]
    if (tdef && tdef.cells === 2) return { x, y: y + 1, def: tdef }
  }
  return null
}

// Nearest tree trunk whose cell centre lies inside the swing wedge —
// hitAt(dx, dy) is the same test the entity hit uses. One tree per swing.
export function findTreeHit(map, player, hitAt, reachPx) {
  const r = Math.ceil(reachPx / TILE_SIZE) + 1
  let best = null, bestD = Infinity
  for (let y = player.y - r; y <= player.y + r; y++) for (let x = player.x - r; x <= player.x + r; x++) {
    const t = resolveTree(map, x, y)
    if (!t) continue
    const dx = x * TILE_SIZE + TILE_SIZE / 2 - player.px
    const dy = y * TILE_SIZE + TILE_SIZE / 2 - player.py
    if (Math.hypot(dx, dy) > reachPx + TILE_SIZE / 2) continue
    if (!hitAt(dx, dy)) continue
    const d = Math.hypot(t.x * TILE_SIZE + TILE_SIZE / 2 - player.px, t.y * TILE_SIZE + TILE_SIZE / 2 - player.py)
    if (d < bestD) { bestD = d; best = { x: t.x, y: t.y } }
  }
  return best
}

function fell(map, x, y, def) {
  const cell = map[y][x]
  cell.tile = TILE.FLOOR
  cell.overlay = STUMP
  cell.dirty = true
  delete cell.losSoft
  delete cell.chopHp
  if (def.cells === 2) {
    const top = map[y - 1]?.[x]
    if (top && isTop(top.overlay)) {
      top.tile = TILE.FLOOR
      top.overlay = null
      top.dirty = true
      delete top.losSoft
    }
  }
}

// Deal `chop` to the trunk at (x, y). Felled trunks become walkable stumps.
export function chopTree(map, x, y, chop) {
  const cell = map[y]?.[x]
  const def = cell && TREES[cell.overlay]
  if (!def) return { felled: false, yield: 0 }
  cell.chopHp = (cell.chopHp ?? def.hp) - chop
  if (cell.chopHp > 0) return { felled: false, yield: 0 }
  fell(map, x, y, def)
  return { felled: true, yield: def.yield }
}

// Save-record helpers: stumps as "x,y" keys, and their re-application on a
// freshly built map (unknown or already-felled keys are ignored).
export function felledCells(map) {
  const out = []
  for (let y = 0; y < map.length; y++) for (let x = 0; x < map[y].length; x++)
    if (map[y][x].overlay === STUMP) out.push(`${x},${y}`)
  return out
}

export function applyFelled(map, keys) {
  for (const key of keys ?? []) {
    const [x, y] = key.split(',').map(Number)
    const cell = map[y]?.[x]
    const def = cell && TREES[cell.overlay]
    if (def) fell(map, x, y, def)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/lumber.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/lumber.js test/lumber.test.js
git commit -m "feat(lumber): tree table, swing hit selection and felling"
```

---

### Task 5: Persist felled trees (save v5) and apply on map build

**Files:**
- Modify: `renderer/systems/adventure.js:36-51`
- Modify: `renderer/systems/openmap.js:88` (`buildOpenMap` options) and after the cell loop
- Modify: `renderer/systems/map.js:573-576` (`generateLevel` threads `felled`)
- Modify: `renderer/game.js:180-197` (`persistAdventure`), `:398-400`, `:1389-1392` (build calls)
- Test: `test/adventure.test.js`, `test/openmap.test.js`

**Interfaces:**
- Produces: save field `felled: { [mapName]: ['x,y', ...] }`; `buildOpenMap(data, { npcs, felled })`; `generateLevel(depth, w, h, { ..., felled })`.
- Consumes: `applyFelled`, `felledCells` from Task 4.

- [ ] **Step 1: Write the failing tests**

In `test/adventure.test.js`, update the v3 pass-through test and add a v4 one:

```js
  it('v3 saves pass through untouched, gaining only the empty gates, npcs and felled maps', () => {
    const v3 = { caves: {}, progress: { mapDepth: 7, cleared: {} },
      talents: ['magic_stance'], body: { weapon: null, ranged: null, inventory: [] } }
    assert.deepEqual(normalizeAdventureSave(v3), { ...v3, gates: {}, npcs: {}, felled: {} })
  })

  it('v4 saves keep their npcs and gain an empty felled map', () => {
    const v4 = { caves: {}, progress: { mapDepth: 7, cleared: {} }, talents: [], body: null,
      gates: {}, npcs: { 'forest-1-clearings': { dead: ['npc:forest-1-clearings:0'], hostile: false } } }
    assert.deepEqual(normalizeAdventureSave(v4), { ...v4, felled: {} })
  })

  it('a fresh save has no felled trees', () => {
    assert.deepEqual(normalizeAdventureSave(null).felled, {})
  })
```

Append to `test/openmap.test.js`:

```js
import { TREES, STUMP } from '../renderer/systems/lumber.js'

describe('felled trees', () => {
  const firstTrunk = () => {
    for (let y = 1; y < DATA.h - 1; y++) for (let x = 1; x < DATA.w - 1; x++) {
      const pi = DATA.prop[y][x]
      if (pi >= 0 && TREES[DATA.palette[pi]]) return { x, y }
    }
    throw new Error('no tree on the map')
  }
  it('a recorded trunk is rebuilt as a walkable stump', () => {
    const { x, y } = firstTrunk()
    const { map } = buildOpenMap(DATA, { felled: [`${x},${y}`] })
    assert.equal(map[y][x].tile, TILE.FLOOR)
    assert.equal(map[y][x].overlay, STUMP)
    assert.ok(isWalkable(map[y][x].tile, map[y][x]))
    assert.equal(map[y][x].losSoft, undefined)
  })
  it('without a record the tree stands', () => {
    const { x, y } = firstTrunk()
    const { map } = buildOpenMap(DATA)
    assert.equal(map[y][x].tile, TILE.WALL)
    assert.ok(TREES[map[y][x].overlay])
  })
  it('generateLevel threads the record through', () => {
    const { x, y } = firstTrunk()
    const { map } = generateLevel(7, DATA.w, DATA.h, { felled: [`${x},${y}`] })
    assert.equal(map[y][x].overlay, STUMP)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/adventure.test.js test/openmap.test.js`
Expected: FAIL — no `felled` field; tree still standing.

- [ ] **Step 3: Implement**

`renderer/systems/adventure.js` — extend the shape comment (`v5 adds felled ({mapName: ['x,y']}) — permanent, not wiped on death`) and in `normalizeAdventureSave` add `base.felled ??= {}` after `base.npcs ??= {}`.

`renderer/systems/openmap.js`:

```js
import { applyFelled } from './lumber.js'
// ...
export function buildOpenMap(data, { npcs = null, felled = null, rng = Math.random } = {}) {
```

Immediately after the `for (let y…) for (let x…) {…}` cell loop (before `const entitySpawns`):

```js
  // Trees the player has already felled here come back as stumps — done
  // before anything reads walkability or the LOS flags.
  applyFelled(map, felled)
```

`renderer/systems/map.js:573-576`:

```js
export function generateLevel(depth, width = MAP_W, height = MAP_H, { skipProps = false, structures = {}, arena = null, npcs = null, felled = null } = {}) {
  // ...
  if (OPEN_MAPS[depth]) return buildOpenMap(OPEN_MAPS[depth], { npcs, felled })
```

`renderer/game.js`:

- import: `import { felledCells } from './systems/lumber.js'`
- `persistAdventure`, after the `recordNpcState` line:

```js
  if (mapName) savedAdventure.felled[mapName] = felledCells(surface.map)
```

- both `generateLevel(...)` calls that pass `npcs: npcRecord` (around `:399` and `:1391`) also pass `felled: savedAdventure.felled[<mapName>] ?? []` — in `startNewRun` use `openMap ? savedAdventure.felled[openMap.name] ?? [] : null`; in the travel path `savedAdventure.felled[mapName] ?? []`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/adventure.js renderer/systems/openmap.js renderer/systems/map.js renderer/game.js test/adventure.test.js test/openmap.test.js
git commit -m "feat(lumber): felled trees persist in the adventure save (v5)"
```

---

### Task 6: Chop wiring in the swing, cues, and item rendering

**Files:**
- Modify: `renderer/game.js:873-935` (inside `swing`)
- Modify: `renderer/systems/sfx.js:5-19` (`CUE_NAMES`), `renderer/render/audio.js:19-52` (`RECIPES`)
- Modify: `renderer/render/canvas.js:183-193` (floating item draw)
- Test: `test/audio.test.js` (existing registry test covers new cues), `test/canvas.test.js`

**Interfaces:**
- Consumes: `findTreeHit`, `chopTree` (Task 4); `player.weapon.chop` (Task 1); `contents: { type: 'lumber', count }` (Task 3).

- [ ] **Step 1: Write the failing tests**

Append to `test/canvas.test.js`:

```js
describe('trees never show damage', () => {
  it('a chopped-but-standing tree cell draws exactly like an untouched one', () => {
    const spr = { ow_grass_0: 'G', ow_tree_small: 'T' }
    const a = recordingCtx(), b = recordingCtx()
    drawTile(a, TILE.WALL, 0, 0, 32, spr, { skin: 'ow_grass_0', overlay: 'ow_tree_small' })
    drawTile(b, TILE.WALL, 0, 0, 32, spr, { skin: 'ow_grass_0', overlay: 'ow_tree_small', chopHp: 1 })
    assert.deepEqual(a.calls, b.calls)
  })
})

describe('floating consumables use atlas sprites', () => {
  for (const [type, key] of [['meat', 'item_meat'], ['cooked_meat', 'item_meat_cooked'], ['lumber', 'item_lumber'], ['mushroom', 'ow_mushroom']])
    it(`${type} draws ${key}`, () => {
      const ctx = recordingCtx()
      ctx.fillText = () => {}
      drawEntity(ctx, { type: 'floating_item', contents: { type } }, 0, 0, 32, { [key]: key.toUpperCase() })
      assert.deepEqual(ctx.calls, [key.toUpperCase()])
    })
})
```

The first test passes already (documenting the invariant); the second fails for meat/cooked_meat/lumber.

- [ ] **Step 2: Run to verify**

Run: `node --test test/canvas.test.js test/audio.test.js`
Expected: canvas floating tests FAIL (no draw call); audio passes until cues are added.

- [ ] **Step 3: Implement**

`renderer/systems/sfx.js` `CUE_NAMES` — add a group:

```js
  // lumber & campfire
  'chop', 'tree-fall', 'campfire-light', 'campfire-out', 'sizzle',
```

`renderer/render/audio.js` `RECIPES` — add:

```js
  'chop':           { kind: 'burst',  freq: 320,  q: 2.0,  dur: 0.10, vol: 0.8 },
  'tree-fall':      { kind: 'rumble', freq: 75,  dur: 0.60, vol: 0.9 },
  'campfire-light': { kind: 'swoosh', f0: 300,  f1: 1200, dur: 0.30, vol: 0.5 },
  'campfire-out':   { kind: 'blip',   wave: 'triangle', f0: 400,  f1: 150,  dur: 0.30, vol: 0.4 },
  'sizzle':         { kind: 'burst',  freq: 2400, q: 0.5,  dur: 0.35, vol: 0.5 },
```

`renderer/render/canvas.js` floating item branch — replace the `mushroom` branch with a generic one:

```js
    } else {
      const key = { mushroom: 'ow_mushroom', meat: 'item_meat', cooked_meat: 'item_meat_cooked', lumber: 'item_lumber' }[c.type]
      const s = key && sprites[key]
      if (s) ctx.drawImage(s, px, py, S, S)
      else { ctx.font = `${Math.round(S*0.8)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', px + S/2, py + S/2) }
    }
```

`renderer/game.js` — import `findTreeHit, chopTree` alongside `felledCells`. Inside `swing(mods)`, after `state.hitEffects = [{ x: player.x, y: player.y }]`:

```js
    // Chopping: a hatchet/axe swing also lands on the nearest tree in the
    // wedge. Damage is silent bar-less chopHp on the cell; the fall is what
    // you hear and see, and the lumber arcs onto the stump for a walk-onto
    // pickup.
    const chop = player.weapon?.chop
    if (chop) {
      const tree = findTreeHit(state.map, player, hitAt, arc.reach * mods.reachMul)
      if (tree) {
        const res = chopTree(state.map, tree.x, tree.y, chop)
        state.hitEffects.push({ x: tree.x, y: tree.y })
        const tpx = tree.x * TILE_SIZE + TILE_SIZE / 2, tpy = tree.y * TILE_SIZE + TILE_SIZE / 2
        sfx(state, res.felled ? 'tree-fall' : 'chop', { px: tpx, py: tpy })
        if (res.felled) {
          state.entities.push({
            type: 'floating_item', contents: { type: 'lumber', count: res.yield }, x: tree.x, y: tree.y,
            startPx: tpx, startPy: tpy - TILE_SIZE, targetPx: tpx, targetPy: tpy,
            px: tpx, py: tpy - TILE_SIZE, progress: 0, duration: 0.35,
          })
          if (OPEN_MAPS[state.cave ? state.cave.surface.level : state.level]) persistAdventure()
        }
      }
    }
```

Check `state.hitEffects` consumers accept extra entries (grep `hitEffects` in `canvas.js`; it iterates the array).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS (audio registry test now sees the five new cues on both sides).

- [ ] **Step 5: Commit**

```bash
git add renderer/game.js renderer/systems/sfx.js renderer/render/audio.js renderer/render/canvas.js test/canvas.test.js
git commit -m "feat(lumber): hatchet and axe swings chop trees; lumber drops onto the stump"
```

---

### Task 7: `systems/campfire.js` — cost, placement, burn-out, cooking

**Files:**
- Create: `renderer/systems/campfire.js`
- Test: `test/campfire.test.js`

**Interfaces:**
- Produces: `CAMPFIRE_COST = 3`, `CAMPFIRE_DURATION = 60`, `CAMPFIRE_FADE = 10`,
  `canBuildCampfire(player) -> { ok: true } | { ok: false, reason: 'lumber' }`,
  `buildSpot(map, entities, player) -> { x, y } | null`,
  `makeCampfire(x, y) -> { type: 'campfire', x, y, px, py, t: 0 }`,
  `spendLumber(player)` (removes `CAMPFIRE_COST` lumber),
  `tickCampfires(entities, delta) -> { entities, expired: campfire[] }`,
  `campfireAlpha(fire) -> number` (1 until the last `CAMPFIRE_FADE` s, then down to 0.3),
  `cookMeat(player) -> number`.
- Consumes: `isWalkable` from `entities.js`; `makeItem`, `addItem` from `inventory.js`.

- [ ] **Step 1: Write the failing tests**

Create `test/campfire.test.js`:

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAMPFIRE_COST, CAMPFIRE_DURATION, canBuildCampfire, buildSpot, makeCampfire, spendLumber,
  tickCampfires, campfireAlpha, cookMeat,
} from '../renderer/systems/campfire.js'
import { makeItem } from '../renderer/systems/inventory.js'
import { TILE } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

const mkPlayer = (inventory = []) => ({ x: 3, y: 3, px: 112, py: 112, inventory, maxInventory: 10 })
function grass() {
  const m = createMap(7, 7)
  for (const row of m) for (const c of row) c.tile = TILE.FLOOR
  return m
}

describe('building', () => {
  it('needs three lumber', () => {
    assert.equal(CAMPFIRE_COST, 3)
    assert.deepEqual(canBuildCampfire(mkPlayer([makeItem('lumber', 2)])), { ok: false, reason: 'lumber' })
    assert.deepEqual(canBuildCampfire(mkPlayer([makeItem('lumber', 3)])), { ok: true })
  })
  it('spendLumber removes exactly the cost and drops an emptied stack', () => {
    const p = mkPlayer([makeItem('lumber', 4)])
    spendLumber(p)
    assert.equal(p.inventory[0].count, 1)
    const q = mkPlayer([makeItem('lumber', 3)]); spendLumber(q)
    assert.deepEqual(q.inventory, [])
  })
  it('buildSpot picks the first free orthogonal walkable tile, skipping occupied ones', () => {
    const m = grass(); const p = mkPlayer()
    assert.deepEqual(buildSpot(m, [], p), { x: 2, y: 3 })
    assert.deepEqual(buildSpot(m, [{ x: 2, y: 3 }], p), { x: 4, y: 3 })
    m[3][2].tile = TILE.WALL; m[3][4].tile = TILE.WALL; m[2][3].tile = TILE.WALL; m[4][3].tile = TILE.WALL
    assert.equal(buildSpot(m, [], p), null)
  })
  it('makeCampfire is a fresh fire centred on its tile', () => {
    assert.deepEqual(makeCampfire(2, 3), { type: 'campfire', x: 2, y: 3, px: 80, py: 112, t: 0 })
  })
})

describe('burning out', () => {
  it('fires age and vanish after a minute; other entities are untouched', () => {
    assert.equal(CAMPFIRE_DURATION, 60)
    const guard = { type: 'guard', hp: 3 }
    const r1 = tickCampfires([guard, makeCampfire(1, 1)], 59)
    assert.equal(r1.entities.length, 2)
    assert.deepEqual(r1.expired, [])
    const r2 = tickCampfires(r1.entities, 1.5)
    assert.deepEqual(r2.entities, [guard])
    assert.equal(r2.expired.length, 1)
    assert.equal(r2.expired[0].type, 'campfire')
  })
  it('the flame dims over the last ten seconds', () => {
    assert.equal(campfireAlpha({ t: 0 }), 1)
    assert.equal(campfireAlpha({ t: 50 }), 1)
    const late = campfireAlpha({ t: 55 })
    assert.ok(late < 1 && late > 0.3, `alpha ${late}`)
    assert.ok(campfireAlpha({ t: 60 }) <= 0.3 + 1e-9)
  })
})

describe('cooking', () => {
  it('turns every raw meat into cooked meat and reports the count', () => {
    const p = mkPlayer([makeItem('lumber'), makeItem('meat', 3)])
    assert.equal(cookMeat(p), 3)
    assert.deepEqual(p.inventory.map(i => [i.kind, i.count]), [['lumber', 1], ['cooked_meat', 3]])
  })
  it('stacks onto cooked meat already carried', () => {
    const p = mkPlayer([makeItem('cooked_meat', 2), makeItem('meat', 1)])
    assert.equal(cookMeat(p), 1)
    assert.deepEqual(p.inventory.map(i => [i.kind, i.count]), [['cooked_meat', 3]])
  })
  it('is a no-op without raw meat', () => {
    const p = mkPlayer([makeItem('potion')])
    assert.equal(cookMeat(p), 0)
    assert.equal(p.inventory.length, 1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/campfire.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `renderer/systems/campfire.js`**

```js
// Campfires: built from lumber next to the player, burn for a minute, and
// cook raw meat for whoever stands on them. Pure — game.js wires the sack
// panel, the per-frame tick, cues and messages; canvas.js draws the flame.
import { isWalkable } from './entities.js'
import { makeItem, addItem } from './inventory.js'

const TILE_SIZE = 32
export const CAMPFIRE_COST = 3        // lumber per fire
export const CAMPFIRE_DURATION = 60   // seconds a fire burns
export const CAMPFIRE_FADE = 10       // last seconds, during which the flame dims

const lumberCount = player => player.inventory.filter(i => i.kind === 'lumber').reduce((n, i) => n + (i.count ?? 1), 0)

export function canBuildCampfire(player) {
  return lumberCount(player) >= CAMPFIRE_COST ? { ok: true } : { ok: false, reason: 'lumber' }
}

// Remove CAMPFIRE_COST lumber, emptied stacks vanish.
export function spendLumber(player) {
  let left = CAMPFIRE_COST
  player.inventory = player.inventory.flatMap(i => {
    if (i.kind !== 'lumber' || left <= 0) return [i]
    const take = Math.min(left, i.count ?? 1)
    left -= take
    const count = (i.count ?? 1) - take
    return count > 0 ? [{ ...i, count }] : []
  })
}

// First free orthogonal walkable tile — the same search item drops use.
export function buildSpot(map, entities, player) {
  return [[-1, 0], [1, 0], [0, -1], [0, 1]]
    .map(([dx, dy]) => ({ x: player.x + dx, y: player.y + dy }))
    .find(t => isWalkable(map[t.y]?.[t.x]?.tile, map[t.y]?.[t.x]) && !entities.some(e => e.x === t.x && e.y === t.y)) ?? null
}

export function makeCampfire(x, y) {
  return { type: 'campfire', x, y, px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2, t: 0 }
}

// Age every fire; those past their duration are dropped and returned.
export function tickCampfires(entities, delta) {
  const expired = []
  const kept = entities.filter(e => {
    if (e.type !== 'campfire') return true
    e.t += delta
    if (e.t < CAMPFIRE_DURATION) return true
    expired.push(e)
    return false
  })
  return { entities: kept, expired }
}

// 1 while burning well; eases down to 0.3 over the final CAMPFIRE_FADE seconds.
export function campfireAlpha(fire) {
  const left = CAMPFIRE_DURATION - fire.t
  if (left >= CAMPFIRE_FADE) return 1
  return 0.3 + 0.7 * Math.max(0, left) / CAMPFIRE_FADE
}

// Every raw meat stack becomes cooked meat. Returns how many were cooked.
export function cookMeat(player) {
  const i = player.inventory.findIndex(it => it.kind === 'meat')
  if (i === -1) return 0
  const n = player.inventory[i].count ?? 1
  player.inventory.splice(i, 1)
  addItem(player, makeItem('cooked_meat', n))   // the freed slot guarantees room
  return n
}
```

Note `spendLumber` reassigns `player.inventory`; `game.js` reads `state.player.inventory` fresh each frame so that is fine, but `refreshInventory` must be called after (Task 8 does via `afterInventoryChange`).

- [ ] **Step 4: Run tests**

Run: `node --test test/campfire.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/campfire.js test/campfire.test.js
git commit -m "feat(campfire): build cost, placement, minute burn-out and cooking"
```

---

### Task 8: Campfire wiring — sack panel, tick, cook, render

**Files:**
- Modify: `renderer/ui/inventory-panel.js:14-20` (`primaryAction`)
- Modify: `renderer/game.js` — `useInventoryItem` (`:592`), `openInventory` handlers (`:532-542`), walk-onto block after floating pickup (`:718-727`), update loop near floating arcs (`:1227`)
- Modify: `renderer/render/canvas.js:136` (`drawEntity` campfire branch)
- Test: none new — the panel has no DOM tests today; the logic is covered by Task 7 and this wiring is verified live in Task 9.

**Interfaces:**
- Consumes everything from Task 7; `campfireAlpha` for drawing; `sprites.prop_campfire` (Task 2).
- Produces: panel handler `onBuild(i)`; `primaryAction` labels `Eat` (meat, cooked_meat) and `Build fire` (lumber).

- [ ] **Step 1: Panel actions**

`renderer/ui/inventory-panel.js` `primaryAction`:

```js
function primaryAction(item) {
  if (!item) return null
  if (item.kind === 'weapon' || item.kind === 'ranged') return { label: 'Equip', fn: 'onEquip' }
  if (item.kind === 'potion') return { label: 'Drink', fn: 'onUse' }
  if (item.kind === 'mushroom' || item.kind === 'meat' || item.kind === 'cooked_meat') return { label: 'Eat', fn: 'onUse' }
  if (item.kind === 'lumber') return { label: 'Build fire', fn: 'onBuild' }
  return null
}
```

- [ ] **Step 2: game.js — eat, build, cook, tick, draw**

Imports:

```js
import { canBuildCampfire, spendLumber, buildSpot, makeCampfire, tickCampfires, cookMeat } from './systems/campfire.js'
```

`useInventoryItem` — widen the heal branch:

```js
  if (item.kind === 'potion' || item.kind === 'meat' || item.kind === 'cooked_meat') {
    const healed = Math.min(state.player.maxHp - state.player.hp, item.kind === 'potion' ? item.amount : item.heal)
```

New function next to `dropInventoryItem`:

```js
function buildCampfire() {
  const gate = canBuildCampfire(state.player)
  if (!gate.ok) { think(state, 'Not enough lumber.'); return }
  const spot = buildSpot(state.map, state.entities, state.player)
  if (!spot) { think(state, 'No room for a fire here.'); return }
  spendLumber(state.player)
  const fire = makeCampfire(spot.x, spot.y)
  state.entities.push(fire)
  sfx(state, 'campfire-light', { px: fire.px, py: fire.py })
  if (inventoryOpen) closeInventory()
  afterInventoryChange()
}
```

`openInventory` handlers — add `onBuild: () => buildCampfire(),`.

Walk-onto cooking, right after the floating-item pickup block:

```js
  // Campfire cooking — standing on a fire cooks every raw meat carried.
  // cookMeat empties the raw stack, so it can't fire twice for the same meat.
  const fire = state.entities.find(e => e.type === 'campfire' && e.x === player.x && e.y === player.y)
  if (fire) {
    const n = cookMeat(player)
    if (n) {
      sfx(state, 'sizzle', { px: fire.px, py: fire.py })
      think(state, 'You cook the meat.')
      afterInventoryChange()
    }
  }
```

Burn-out tick, next to the floating-item arc loop in `update`:

```js
  // Campfires burn out after a minute.
  const fires = tickCampfires(state.entities, delta)
  state.entities = fires.entities
  for (const f of fires.expired) sfx(state, 'campfire-out', { px: f.px, py: f.py })
```

`renderer/render/canvas.js` — import `campfireAlpha` from `../systems/campfire.js` and add to `drawEntity` before the `floating_item` branch:

```js
  if (entity.type === 'campfire') {
    const s = sprites.prop_campfire
    if (!s) return
    const prev = ctx.globalAlpha
    ctx.globalAlpha = prev * campfireAlpha(entity)
    ctx.drawImage(s, px, py, S, S)
    ctx.globalAlpha = prev
    return
  }
```

Confirm `drawHealthBars` skips the campfire (it has no `hp`/`maxHp`) and `isHittable` ignores it (type is neither enemy nor npc), so swings and the death cull leave it alone.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add renderer/ui/inventory-panel.js renderer/game.js renderer/render/canvas.js test/
git commit -m "feat(campfire): build from the sack, cook meat by standing on it, burns out"
```

---

### Task 9: Live verification in the running game

**Files:**
- Create (scratch, not committed): `<scratchpad>/verify-lumber.mjs`
- Reference: `tools/verify-npcs.mjs` (the existing playwright-core `_electron` harness pattern), memory note "Verify editor with Playwright" (WSLg, `DISPLAY=:0`).

Time-box this to ~15 minutes; the logic is unit-covered.

- [ ] **Step 1: Write the driver**

Copy the launch/boilerplate from `tools/verify-npcs.mjs`. Script the run: start Adventure on map 7, pick up the starter chest (confirm `player.weapon.weaponType === 'hatchet'` via `page.evaluate` on whatever debug handle the harness exposes), face the nearest tree cell and press Space until it falls, walk onto the stump, then open the sack (`I`) and read the DOM: expect a Lumber slot with the `item_lumber.png` icon. Take screenshots before/after the fell into the scratchpad.

- [ ] **Step 2: Run it**

Run: `DISPLAY=:0 node <scratchpad>/verify-lumber.mjs`
Expected: hatchet equipped; a tree cell becomes a stump the player can stand on; lumber in the sack; no bar drawn over a half-chopped tree (inspect the screenshot). Then, if the map's animals are reachable quickly, kill one for meat, build a fire from 3 lumber (cheat extra lumber in via the debug handle if needed), stand on it, and confirm the sack shows Cooked Meat. Otherwise state which part was skipped.

- [ ] **Step 3: Check the data dir**

Run: `git status --short renderer/data/`
Expected: clean (the editor-autosave hazard only applies to the editor, but confirm anyway).

- [ ] **Step 4: Update docs**

Add `lumber` (tree table, felling, felled save record) and `campfire` (build/cook/burn-out) to the `renderer/systems/` list in `~/CLAUDE.md`'s dungeon-crawler section, one clause each, matching the existing style. Commit:

```bash
git add ~/CLAUDE.md
git commit -m "docs: lumber and campfire systems"
```

(`~/CLAUDE.md` lives outside this repo — if it is not tracked here, skip the commit and just edit the file.)
