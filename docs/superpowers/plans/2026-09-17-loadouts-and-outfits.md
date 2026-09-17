# Loadouts and Outfits Implementation Plan (plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the three stances into three loadouts of one body — each with an outfit slot and an offhand — replace the stance/Might talents with self-equipping outfit items, and move quick-use onto the offhand (consumable pointers only in this plan).

**Architecture:** The three main hands stay at `player.weapon` / `player.ranged` / `player.wand`; a new `player.gear = { melee, ranged, magic }` holds each loadout's `off` and `outfit`, plus a shared `player.belt` (data only in this plan). A new pure module `systems/outfits.js` owns the outfit sources (map clear, cyclops, rush start, the rite), the talent→outfit save migration and the toast. `systems/inventory.js` grows accessors (`loadout`, `offhand`, `outfitOf`, `loadoutAvailable`, `canWieldHeavy`, `resolveOffhand`) and the outfit/offhand equip rules; every former `hasTalent(...'ranged_stance' | 'magic_stance' | 'heavy_weapons')` check routes through them. The pause panel gains a gear strip driven by a DOM-free model module.

**Tech Stack:** Vanilla ES modules, Electron renderer, `node:test` + `node:assert/strict`. Run the suite with `npm test` (`node --test test/*.test.js`) from `~/projects/dungeon-crawler`.

**Spec:** `docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md` (§1 data model, §2 tables, §3 gates and sources, §4 offhand — consumable pointer and Q only here, §7 saves, §8 panel). Plan 2 covers shields, offhand wands, alternating blades and the two-handed rule; plan 3 covers the belt in play, loot and polish.

## Global Constraints

- Pure systems modules under `renderer/systems/` import nothing from `game.js` or the DOM; `renderer/systems/outfits.js` and `renderer/ui/inventory-panel-model.js` must be importable under plain Node.
- Every new `SPRITES` key must point at an existing PNG in `renderer/assets/tiles/` (`test/sprites.test.js`).
- Refusal reasons are the `{ ok: false, reason }` shape; every reason has an `EQUIP_FAIL_MESSAGES` entry.
- Save migration is additive and idempotent; `normalizeAdventureSave` on an already-current save is a no-op.
- No spoilers: a locked loadout is greyed in the panel with no hint of how to unlock it.
- Copy (verbatim): toast title `Outfit found`; lines `Ranger's Coat — the Archer's way is open.`, `Mage's Robe — the Mage's way is open.`, `Plated Armor — heavy steel sits easy now.`; offhand empty think `Nothing in my off hand.`; pointer with an empty stack `None left.`; new fail messages `two_handed: 'I need both hands for that.'`, `wrong_loadout: "That's not my garb."`, `full: 'My pack is full.'`.
- Commit after every task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` as the last line. Work on branch `loadouts-and-offhand`.

---

## File map

| File | Responsibility in this plan |
|---|---|
| `renderer/systems/entities.js` | `OUTFIT_TYPES`, `makeOutfitContents`, `defaultGear`, `makePlayer` gains `gear` + `belt` |
| `renderer/systems/inventory.js` | outfit item conversion, accessors, `canEquip(player, item, slot)`, `equipOutfit`/`unequipOutfit`, `unequipMain`, `equipOffhand`/`unequipOffhand`, `resolveOffhand`, outfit pickups; quick-use functions removed |
| `renderer/systems/outfits.js` (new) | `RETIRED_TALENT_OUTFITS`, `MAP_CLEAR_OUTFITS`, `BOSS_DROP_OUTFITS`, `RUSH_START_OUTFITS`, `wearOutfit`, `ownsOutfit`, `migrateTalentsToOutfits`, `outfitToast` |
| `renderer/systems/talents.js` | drops the three retired talents and `MAP_CLEAR_TALENTS` |
| `renderer/systems/ranged.js`, `spells.js`, `magic.js`, `render/canvas.js`, `systems/rites.js`, `data/rites.js`, `systems/openmap.js` | gates route through `loadoutAvailable` / `canWieldHeavy`; trigger field `talent` → `outfit` |
| `renderer/systems/adventure.js` | `normalizeBody` gains `gear`/`belt`; save v8 runs `migrateTalentsToOutfits` |
| `renderer/game.js` | persist/restore gear, `applyLoadout` outfits, rush start, rite → robe, boss drops → coat/plate, Q → offhand, panel handlers |
| `renderer/render/hud.js`, `renderer/index.html`, `renderer/ui/touch-controls.js` | `#hud-consumable` → `#hud-offhand` fed by `resolveOffhand` |
| `renderer/render/sprites.js`, `renderer/render/icons.js` | outfit icons aliased to the loadout player sprites |
| `renderer/ui/inventory-panel-model.js` (new), `renderer/ui/inventory-panel.js` | DOM-free strip/actions model; gear strip render, gear-area navigation |
| `test/helpers/outfits.js` (new) | `gearWearing(...ids)` test helper |
| `tools/verify-loot.mjs`, `~/CLAUDE.md`, the spec | tooling and docs follow |

---

### Task 1: Outfit table, gear shape, item conversion and accessors

**Files:**
- Modify: `renderer/systems/entities.js` (after `WAND_TYPES`/`makeWandContents`, ~line 103; `makePlayer` ~line 214)
- Modify: `renderer/systems/inventory.js` (imports, `HAND_EMOJI`, `REBUILD`, `itemFromContents`, `contentsFromItem`; new accessors before `addItem`)
- Create: `test/helpers/outfits.js`
- Test: `test/outfits-model.test.js` (new)

**Interfaces:**
- Produces (entities.js): `OUTFIT_TYPES`, `makeOutfitContents(outfitType) → { type:'outfit', outfitType, name, loadout, protect, heavy?, sprintDrain? }`, `defaultGear() → { melee:{off,outfit}, ranged:{off,outfit}, magic:{off,outfit} }` where every `off` starts as the potion pointer `{ kind:'consumable', item:'potion' }`, `makePlayer` returns `gear: defaultGear(), belt: null`.
- Produces (inventory.js): `STANCES`, `MAIN_OF`, `LOADOUT_NAMES`, `CONSUMABLE_KINDS`, `gearOf(player, stance)`, `loadout(player, stance?)`, `offhand(player)`, `outfitOf(player, stance)`, `loadoutAvailable(player, stance)`, `canWieldHeavy(player)`, `resolveOffhand(player)`, `outfitItem(payload)`; `itemFromContents` accepts `type:'outfit'`, `contentsFromItem` round-trips it.
- Test helper: `gearWearing(...outfitTypes) → gear` with each named outfit worn in its own loadout's slot.

- [ ] **Step 1: Write the test helper**

`test/helpers/outfits.js`:
```js
// Builds a player.gear with the named outfits worn in their own loadouts.
// Consumable pointers stay at their default (potion) so the offhand HUD and
// Q behave exactly as a fresh player's do.
import { defaultGear, makeOutfitContents, OUTFIT_TYPES } from '../../renderer/systems/entities.js'

export function gearWearing(...outfitTypes) {
  const gear = defaultGear()
  for (const ot of outfitTypes) {
    const { type, ...payload } = makeOutfitContents(ot)
    gear[OUTFIT_TYPES[ot].loadout ?? 'melee'].outfit = payload
  }
  return gear
}
```

- [ ] **Step 2: Write the failing tests**

`test/outfits-model.test.js`:
```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { OUTFIT_TYPES, makeOutfitContents, defaultGear, makePlayer } from '../renderer/systems/entities.js'
import {
  itemFromContents, contentsFromItem, makeItem, addItem,
  loadout, offhand, outfitOf, loadoutAvailable, canWieldHeavy, resolveOffhand, MAIN_OF, STANCES,
} from '../renderer/systems/inventory.js'
import { gearWearing } from './helpers/outfits.js'

describe('outfit table', () => {
  it('names the three story outfits and the leather coat', () => {
    assert.deepEqual(Object.keys(OUTFIT_TYPES).sort(), ['leather', 'plate', 'ranger', 'robe'])
    assert.equal(OUTFIT_TYPES.ranger.loadout, 'ranged')
    assert.equal(OUTFIT_TYPES.robe.loadout, 'magic')
    assert.equal(OUTFIT_TYPES.plate.loadout, 'melee')
    assert.equal(OUTFIT_TYPES.plate.heavy, true)
    assert.equal(OUTFIT_TYPES.leather.loadout, null)
  })
  it('makeOutfitContents copies only the flags a row sets', () => {
    assert.deepEqual(makeOutfitContents('robe'), { type: 'outfit', outfitType: 'robe', name: "Mage's Robe", loadout: 'magic', protect: 0 })
    assert.deepEqual(makeOutfitContents('plate'), { type: 'outfit', outfitType: 'plate', name: 'Plated Armor', loadout: 'melee', protect: 2, heavy: true, sprintDrain: 2 })
  })
  it('an outfit round-trips through the sack', () => {
    const item = itemFromContents(makeOutfitContents('ranger'))
    assert.equal(item.kind, 'outfit')
    assert.equal(item.stackable, false)
    assert.equal(item.payload.outfitType, 'ranger')
    assert.deepEqual(contentsFromItem(item), makeOutfitContents('ranger'))
  })
  it('an unknown outfit type is dropped, not minted', () => {
    assert.equal(itemFromContents({ type: 'outfit', outfitType: 'tuxedo' }), null)
  })
})

describe('gear shape', () => {
  it('makePlayer starts every loadout empty of outfits with the offhand pointed at potions', () => {
    const p = makePlayer(1, 1)
    assert.deepEqual(p.gear, defaultGear())
    for (const s of STANCES) {
      assert.equal(p.gear[s].outfit, null)
      assert.deepEqual(p.gear[s].off, { kind: 'consumable', item: 'potion' })
    }
    assert.equal(p.belt, null)
  })
  it('accessors lazily create gear on a bare player', () => {
    const p = {}
    assert.equal(outfitOf(p, 'magic'), null)
    assert.ok(p.gear.magic)
  })
  it('loadout() pairs the main hand with its gear', () => {
    const p = { ...makePlayer(1, 1), weapon: { weaponType: 'sword' }, wand: { weaponType: 'sparkwand' }, attackMode: 'magic' }
    assert.equal(loadout(p).main.weaponType, 'sparkwand')
    assert.equal(loadout(p, 'melee').main.weaponType, 'sword')
    assert.equal(MAIN_OF.ranged, 'ranged')
    assert.deepEqual(offhand(p), { kind: 'consumable', item: 'potion' })
  })
})

describe('loadout availability', () => {
  it('Warrior is always open; Archer and Mage need their coat and robe worn', () => {
    const bare = makePlayer(1, 1)
    assert.deepEqual(STANCES.map(s => loadoutAvailable(bare, s)), [true, false, false])
    const dressed = { ...makePlayer(1, 1), gear: gearWearing('ranger', 'robe') }
    assert.deepEqual(STANCES.map(s => loadoutAvailable(dressed, s)), [true, true, true])
  })
  it('a leather coat in the Archer slot does not open the Archer', () => {
    const p = makePlayer(1, 1)
    const { type, ...leather } = makeOutfitContents('leather')
    p.gear.ranged.outfit = leather
    assert.equal(loadoutAvailable(p, 'ranged'), false)
  })
  it('plate on the Warrior is what lets heavy weapons be wielded', () => {
    assert.equal(canWieldHeavy(makePlayer(1, 1)), false)
    assert.equal(canWieldHeavy({ gear: gearWearing('plate') }), true)
    assert.equal(canWieldHeavy({ gear: gearWearing('ranger') }), false)
  })
})

describe('resolveOffhand', () => {
  it('a consumable pointer resolves to the sack stack and its count', () => {
    const p = makePlayer(1, 1)
    addItem(p, makeItem('potion', 3))
    const r = resolveOffhand(p)
    assert.equal(r.kind, 'consumable')
    assert.equal(r.item, 'potion')
    assert.equal(r.count, 3)
    assert.equal(r.index, 0)
  })
  it('an empty stack resolves with count 0 and no index', () => {
    const r = resolveOffhand(makePlayer(1, 1))
    assert.deepEqual(r, { kind: 'consumable', item: 'potion', count: 0, index: -1, slot: null })
  })
  it('null offhand resolves to null', () => {
    const p = makePlayer(1, 1)
    p.gear.melee.off = null
    assert.equal(resolveOffhand(p), null)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/outfits-model.test.js`
Expected: FAIL — `OUTFIT_TYPES` is not exported / `loadout` is not exported.

- [ ] **Step 4: Add the table and gear shape to entities.js**

After `makeWandContents` (before the `AMMO_KINDS` comment):
```js
// Outfits — one per loadout slot (systems/inventory.js gearOf). Wearing the
// outfit whose `loadout` names a stance is what opens that stance: the coat
// is the Archer, the robe is the Mage. `loadout: null` fits any loadout.
// `heavy` on the Warrior's outfit is the heavy-weapon gate (plate); protect
// and sprintDrain are read in plan 2/3 (damagePlayer, sprintProfile).
export const OUTFIT_TYPES = {
  ranger:  { name: "Ranger's Coat", loadout: 'ranged', protect: 0 },
  robe:    { name: "Mage's Robe",   loadout: 'magic',  protect: 0 },
  plate:   { name: 'Plated Armor',  loadout: 'melee',  protect: 2, heavy: true, sprintDrain: 2 },
  leather: { name: 'Leather Coat',  loadout: null,     protect: 1 },
}

export function makeOutfitContents(outfitType = 'leather') {
  const ot = OUTFIT_TYPES[outfitType] ? outfitType : 'leather'
  const def = OUTFIT_TYPES[ot]
  return { type: 'outfit', outfitType: ot, name: def.name, loadout: def.loadout, protect: def.protect,
    ...(def.heavy && { heavy: true }), ...(def.sprintDrain && { sprintDrain: def.sprintDrain }) }
}

// Per-loadout gear beside the three main hands (see makePlayer). Every
// offhand starts pointed at the potion stack so Q heals from the first step,
// exactly as quick-use did before the offhand existed.
export function defaultGear() {
  const slot = () => ({ off: { kind: 'consumable', item: 'potion' }, outfit: null })
  return { melee: slot(), ranged: slot(), magic: slot() }
}
```

In `makePlayer`, replace the `bonuses, weapon: null, ranged: null, wand: null, ammo: emptyAmmo(),` line and its comment with:
```js
    // Three loadouts of one body: the main hands live here (melee / bow /
    // wand — combat code reads them directly), each loadout's offhand and
    // outfit live one level down in `gear`, and `belt` is the one shared tool
    // slot. The Warrior is always open; the Archer and the Mage open when
    // their outfit is worn (inventory.js loadoutAvailable).
    bonuses, weapon: null, ranged: null, wand: null, ammo: emptyAmmo(),
    gear: defaultGear(), belt: null,
```

- [ ] **Step 5: Add item conversion and accessors to inventory.js**

Update the import:
```js
import {
  AMMO_CAPS, emptyAmmo, RANGED_WEAPON_TYPES, WAND_TYPES, OUTFIT_TYPES,
  makeRangedContents, makeWandContents, makeOutfitContents, defaultGear,
} from './entities.js'
```
Change `HAND_EMOJI` to `const HAND_EMOJI = { weapon: '⚔', ranged: '🏹', wand: '🪄', outfit: '🧥' }` and `REBUILD` to:
```js
const REBUILD = {
  ranged: [RANGED_WEAPON_TYPES, makeRangedContents],
  wand:   [WAND_TYPES, makeWandContents],
  outfit: [OUTFIT_TYPES, makeOutfitContents],
}
```
In `itemFromContents`, the rebuild branch keys on `contents.weaponType`; outfits key on `outfitType`. Replace the first lines of the function with:
```js
export function itemFromContents(contents) {
  const rebuild = REBUILD[contents.type]
  if (rebuild) {
    const [table, make] = rebuild
    const key = contents.type === 'outfit' ? contents.outfitType : contents.weaponType
    if (!table[key]) return null
    const { type, ...payload } = make(key)
    if (type === 'ranged' && Number.isFinite(contents.bundle)) payload.bundle = contents.bundle
    return { kind: type, name: payload.name, emoji: HAND_EMOJI[type], stackable: false, payload }
  }
```
In `contentsFromItem`, change the weapon/wand line to include outfits:
```js
  if (item.kind === 'weapon' || item.kind === 'wand' || item.kind === 'outfit')
    return { ...item.payload, type: item.kind }
```
Add before `addItem`:
```js
// ── Loadouts ────────────────────────────────────────────────────────────────
// The stance name is the loadout key. Main hands stay on the player object;
// gear[stance] holds the offhand and the outfit (entities.js defaultGear).
export const STANCES = ['melee', 'ranged', 'magic']
export const MAIN_OF = { melee: 'weapon', ranged: 'ranged', magic: 'wand' }
export const LOADOUT_NAMES = { melee: 'Warrior', ranged: 'Archer', magic: 'Mage' }
// What an offhand may point at (Q uses one). Quest items and wood are not.
export const CONSUMABLE_KINDS = ['potion', 'mushroom', 'meat', 'cooked_meat']

export function gearOf(player, stance) {
  player.gear ??= defaultGear()
  return player.gear[stance]
}
export function loadout(player, stance = player.attackMode ?? 'melee') {
  const g = gearOf(player, stance)
  return { main: player[MAIN_OF[stance]] ?? null, off: g.off, outfit: g.outfit }
}
export const offhand = player => gearOf(player, player.attackMode ?? 'melee').off
export const outfitOf = (player, stance) => gearOf(player, stance).outfit

// Warrior is innate; Archer and Mage exist while their own outfit is worn.
export function loadoutAvailable(player, stance) {
  if (stance === 'melee') return true
  return outfitOf(player, stance)?.loadout === stance
}
// Heavy weapons (and, in plan 2, the heavy shield) need the plate on the Warrior.
export const canWieldHeavy = player => outfitOf(player, 'melee')?.heavy === true

// The active offhand with a consumable pointer resolved against the sack:
// { kind:'consumable', item, count, index, slot }. Non-pointer contents
// (plan 2) come back as they are; an empty offhand is null.
export function resolveOffhand(player) {
  const off = offhand(player)
  if (!off) return null
  if (off.kind !== 'consumable') return off
  const index = (player.inventory ?? []).findIndex(i => i.kind === off.item)
  const slot = index === -1 ? null : player.inventory[index]
  return { kind: 'consumable', item: off.item, count: slot?.count ?? 0, index, slot }
}

export function outfitItem(payload) {
  return { kind: 'outfit', name: payload.name, emoji: HAND_EMOJI.outfit, stackable: false, payload: { ...payload } }
}
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/outfits-model.test.js test/inventory.test.js test/entities.test.js`
Expected: all PASS (existing inventory tests are unaffected by the additive changes).

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/entities.js renderer/systems/inventory.js test/helpers/outfits.js test/outfits-model.test.js
git commit -m "feat: outfit table, per-loadout gear shape and loadout accessors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `systems/outfits.js` — sources, ownership, migration, toast

**Files:**
- Create: `renderer/systems/outfits.js`
- Test: `test/outfits.test.js` (new)

**Interfaces:**
- Consumes: `makeOutfitContents`, `OUTFIT_TYPES`, `defaultGear` (entities), `gearOf`, `outfitOf`, `STANCES` (inventory), `queueToast` (feedback), `sfx` (sfx).
- Produces:
  - `RETIRED_TALENT_OUTFITS = { ranged_stance:'ranger', magic_stance:'robe', heavy_weapons:'plate' }`
  - `MAP_CLEAR_OUTFITS = { 'forest-1-clearings': 'ranger' }`
  - `BOSS_DROP_OUTFITS = { cyclops: 'plate' }`
  - `RUSH_START_OUTFITS = ['ranger', 'robe', 'plate']`
  - `outfitStance(payload, fallback) → stance` (payload.loadout ?? fallback)
  - `wearOutfit(player, payload, stance?) → boolean` — puts the outfit on if that slot is empty, false otherwise (no sack involvement; used by rush start and migration)
  - `ownsOutfit(player, outfitType) → boolean` — worn in any loadout or carried in the sack
  - `migrateTalentsToOutfits(body, talents) → { body, talents }` — pure; retired ids leave `talents` and become worn outfits on `body.gear` (body created if null)
  - `outfitToast(state, payload)` — queues the toast and the `talent-learned` cue
  - `OUTFIT_TOAST_LINES`

- [ ] **Step 1: Write the failing tests**

`test/outfits.test.js`:
```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RETIRED_TALENT_OUTFITS, MAP_CLEAR_OUTFITS, BOSS_DROP_OUTFITS, RUSH_START_OUTFITS,
  wearOutfit, ownsOutfit, migrateTalentsToOutfits, outfitToast, OUTFIT_TOAST_LINES,
} from '../renderer/systems/outfits.js'
import { makeOutfitContents, makePlayer, OUTFIT_TYPES, emptyAmmo } from '../renderer/systems/entities.js'
import { itemFromContents, loadoutAvailable } from '../renderer/systems/inventory.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const payload = ot => { const { type, ...p } = makeOutfitContents(ot); return p }

describe('sources', () => {
  it('every source names a real outfit', () => {
    const all = [...Object.values(RETIRED_TALENT_OUTFITS), ...Object.values(MAP_CLEAR_OUTFITS),
      ...Object.values(BOSS_DROP_OUTFITS), ...RUSH_START_OUTFITS]
    for (const ot of all) assert.ok(OUTFIT_TYPES[ot], ot)
  })
  it('the three retired talents map to the three story outfits, and rush wears all three', () => {
    assert.deepEqual(RETIRED_TALENT_OUTFITS, { ranged_stance: 'ranger', magic_stance: 'robe', heavy_weapons: 'plate' })
    assert.deepEqual([...RUSH_START_OUTFITS].sort(), ['plate', 'ranger', 'robe'])
    assert.equal(MAP_CLEAR_OUTFITS['forest-1-clearings'], 'ranger')
    assert.equal(BOSS_DROP_OUTFITS.cyclops, 'plate')
  })
})

describe('wearOutfit / ownsOutfit', () => {
  it('wears into the outfit’s own loadout when empty and opens it', () => {
    const p = makePlayer(1, 1)
    assert.equal(wearOutfit(p, payload('ranger')), true)
    assert.equal(p.gear.ranged.outfit.outfitType, 'ranger')
    assert.equal(loadoutAvailable(p, 'ranged'), true)
    assert.equal(wearOutfit(p, payload('ranger')), false)   // slot taken
  })
  it('a leather coat goes to the named stance, defaulting to the active one', () => {
    const p = { ...makePlayer(1, 1), attackMode: 'magic' }
    assert.equal(wearOutfit(p, payload('leather')), true)
    assert.equal(p.gear.magic.outfit.outfitType, 'leather')
    const q = makePlayer(1, 1)
    assert.equal(wearOutfit(q, payload('leather'), 'ranged'), true)
    assert.equal(q.gear.ranged.outfit.outfitType, 'leather')
  })
  it('refuses to wear a loadout-bound outfit into another loadout', () => {
    const p = makePlayer(1, 1)
    assert.equal(wearOutfit(p, payload('robe'), 'melee'), false)
    assert.equal(p.gear.melee.outfit, null)
  })
  it('ownsOutfit sees worn and sacked outfits', () => {
    const p = makePlayer(1, 1)
    assert.equal(ownsOutfit(p, 'plate'), false)
    wearOutfit(p, payload('plate'))
    assert.equal(ownsOutfit(p, 'plate'), true)
    const q = makePlayer(1, 1)
    q.inventory.push(itemFromContents(makeOutfitContents('robe')))
    assert.equal(ownsOutfit(q, 'robe'), true)
    assert.equal(ownsOutfit({}, 'robe'), false)
  })
})

describe('migrateTalentsToOutfits', () => {
  it('turns retired talents into worn outfits and keeps the rest', () => {
    const { body, talents } = migrateTalentsToOutfits(null, ['magic_stance', 'ski_legs', 'heavy_weapons'])
    assert.deepEqual(talents, ['ski_legs'])
    assert.equal(body.gear.magic.outfit.outfitType, 'robe')
    assert.equal(body.gear.melee.outfit.outfitType, 'plate')
    assert.equal(body.gear.ranged.outfit, null)
    assert.deepEqual(body.ammo, emptyAmmo())
    assert.deepEqual(body.inventory, [])
  })
  it('is a no-op on a current save', () => {
    const cur = { weapon: null, ranged: null, wand: null, ammo: emptyAmmo(), inventory: [], gear: makePlayer(1, 1).gear, belt: null }
    const r = migrateTalentsToOutfits(cur, ['ski_legs'])
    assert.deepEqual(r, { body: cur, talents: ['ski_legs'] })
    assert.equal(migrateTalentsToOutfits(null, []).body, null)
  })
  it('never overwrites an outfit already worn', () => {
    const body = { weapon: null, ranged: null, wand: null, ammo: emptyAmmo(), inventory: [], gear: makePlayer(1, 1).gear, belt: null }
    body.gear.melee.outfit = payload('leather')
    const r = migrateTalentsToOutfits(body, ['heavy_weapons'])
    assert.equal(r.body.gear.melee.outfit.outfitType, 'leather')
    assert.deepEqual(r.talents, [])
  })
})

describe('outfitToast', () => {
  it('queues the toast and the learned cue', () => {
    const state = { feedback: makeFeedback(), sfx: makeSfx() }
    outfitToast(state, payload('ranger'))
    assert.deepEqual(state.feedback.toasts, [{ title: 'Outfit found', lines: [OUTFIT_TOAST_LINES.ranger] }])
    assert.deepEqual(state.sfx.cues.map(c => c.name), ['talent-learned'])
  })
  it('has a line for every outfit', () => {
    for (const ot of Object.keys(OUTFIT_TYPES)) assert.ok(OUTFIT_TOAST_LINES[ot], ot)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/outfits.test.js`
Expected: FAIL — cannot find module `outfits.js`.

- [ ] **Step 3: Write the module**

`renderer/systems/outfits.js`:
```js
// Outfits: where the three story outfits come from, who owns what, and the
// one-time save migration from the stance talents they replaced. Pure —
// game.js spawns the floating items and calls grantContents.
import { makeOutfitContents, OUTFIT_TYPES, defaultGear, emptyAmmo } from './entities.js'
import { gearOf, STANCES } from './inventory.js'
import { queueToast } from './feedback.js'
import { sfx } from './sfx.js'

// The stance talents of the 2026-08-22 design, now items. Ski-legs stays a talent.
export const RETIRED_TALENT_OUTFITS = { ranged_stance: 'ranger', magic_stance: 'robe', heavy_weapons: 'plate' }
// A dungeon cleared on this map drops the outfit at the boss's feet (once — see ownsOutfit).
export const MAP_CLEAR_OUTFITS = { 'forest-1-clearings': 'ranger' }
// A boss of this type drops the outfit wherever it dies (Rush depth 3, the Mountain Pass cave).
export const BOSS_DROP_OUTFITS = { cyclops: 'plate' }
// Dungeon Rush wears everything from the first step.
export const RUSH_START_OUTFITS = ['ranger', 'robe', 'plate']

export const OUTFIT_TOAST_LINES = {
  ranger:  "Ranger's Coat — the Archer's way is open.",
  robe:    "Mage's Robe — the Mage's way is open.",
  plate:   'Plated Armor — heavy steel sits easy now.',
  leather: 'Leather Coat — a little between me and the teeth.',
}

export const outfitStance = (payload, fallback = 'melee') => payload.loadout ?? fallback

// Put an outfit straight on (no sack involved). False when the slot is taken
// or the outfit belongs to another loadout.
export function wearOutfit(player, payload, stance = outfitStance(payload, player.attackMode ?? 'melee')) {
  if (payload.loadout && payload.loadout !== stance) return false
  const g = gearOf(player, stance)
  if (g.outfit) return false
  g.outfit = { ...payload }
  return true
}

export function ownsOutfit(player, outfitType) {
  if (!player) return false
  if (STANCES.some(s => player.gear?.[s]?.outfit?.outfitType === outfitType)) return true
  return (player.inventory ?? []).some(i => i.kind === 'outfit' && i.payload?.outfitType === outfitType)
}

const emptyBody = () => ({ weapon: null, ranged: null, wand: null, ammo: emptyAmmo(), inventory: [], gear: defaultGear(), belt: null })

// Save migration (adventure.js v8, timewarp mini-saves, arena kits): every
// retired talent becomes its outfit, worn. Pure: returns new objects only
// when something changed, so an already-current save round-trips by identity.
export function migrateTalentsToOutfits(body, talents = []) {
  const retired = talents.filter(t => RETIRED_TALENT_OUTFITS[t])
  if (retired.length === 0) return { body, talents }
  const out = body ? { ...body, gear: structuredClone(body.gear ?? defaultGear()) } : emptyBody()
  for (const t of retired) {
    const { type, ...payload } = makeOutfitContents(RETIRED_TALENT_OUTFITS[t])
    const stance = OUTFIT_TYPES[payload.outfitType].loadout
    out.gear[stance].outfit ??= payload
  }
  return { body: out, talents: talents.filter(t => !RETIRED_TALENT_OUTFITS[t]) }
}

export function outfitToast(state, payload) {
  queueToast(state, { title: 'Outfit found', lines: [OUTFIT_TOAST_LINES[payload.outfitType]].filter(Boolean) })
  sfx(state, 'talent-learned')
}
```
Note `emptyAmmo` must be exported from entities.js (it is). `structuredClone` is available in Node 18+ and Electron.

- [ ] **Step 4: Run the tests**

Run: `node --test test/outfits.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/outfits.js test/outfits.test.js
git commit -m "feat: outfits module — sources, ownership, talent migration, toast

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Equip rules — slots, outfits, offhand pointers, pickups

**Files:**
- Modify: `renderer/systems/inventory.js` (`canEquip`, `equipItem`, `autoEquipOnPickup`, `EQUIP_FAIL_MESSAGES`; remove `findQuickUseIndex`/`quickUseSummary`)
- Test: `test/inventory.test.js` (update talent-based tests), `test/equip-slots.test.js` (new)

**Interfaces:**
- `canEquip(player, item, slot = 'main') → { ok, reason? }`; reasons `not_equippable | not_learned | heavy | wrong_loadout | two_handed | full`.
- `equipItem(player, index)` unchanged signature (main hand), gates via `loadoutAvailable`/`canWieldHeavy`.
- `equipOutfit(player, index, stance?) → { ok, equipped? , reason? }` — swaps a worn outfit back to the sack; taking plate off a Warrior holding a heavy weapon moves the weapon to the sack first; `full` when the sack can't take it.
- `unequipOutfit(player, stance) → { ok, reason? }` — same eviction rule; if the loadout closes while active, `attackMode` falls back to `'melee'` and `charging`/`stanceSwitch` clear.
- `unequipMain(player, stance) → { ok, reason? }` — hand → sack (`full` if no room).
- `equipOffhand(player, index, stance?) → { ok, equipped?, reason? }` — this plan: consumables only, sets the pointer, sack untouched.
- `unequipOffhand(player, stance) → { ok }` — clears a pointer.
- `autoEquipOnPickup`: an outfit self-wears into its loadout's empty slot (`{ ok:true, equipped:true, outfit:true }`), a duplicate already owned is discarded (`{ ok:true, equipped:false, merged:'outfit' }`), otherwise the sack.
- `findQuickUseIndex` and `quickUseSummary` are deleted (hud.js and game.js stop importing them in Tasks 6–7; until then those two files are broken — Tasks 3→7 land in one branch).

- [ ] **Step 1: Write the failing tests**

`test/equip-slots.test.js`:
```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  itemFromContents, makeItem, addItem, canEquip, equipItem, equipOutfit, unequipOutfit, unequipMain,
  equipOffhand, unequipOffhand, autoEquipOnPickup, EQUIP_FAIL_MESSAGES, loadoutAvailable, resolveOffhand,
} from '../renderer/systems/inventory.js'
import { makePlayer, makeOutfitContents, makeRangedContents, makeWandContents, weaponContents } from '../renderer/systems/entities.js'
import { gearWearing } from './helpers/outfits.js'

const mk = (over = {}) => ({ ...makePlayer(1, 1), ...over })
const outfit = ot => itemFromContents(makeOutfitContents(ot))
const weapon = wt => itemFromContents({ type: 'weapon', ...weaponContents(wt) })

describe('main-hand gates read the outfits', () => {
  it('a bow needs the coat, a wand the robe, an axe the plate', () => {
    const bare = mk()
    assert.deepEqual(canEquip(bare, itemFromContents(makeRangedContents('shortbow'))), { ok: false, reason: 'not_learned' })
    assert.deepEqual(canEquip(bare, itemFromContents(makeWandContents('sparkwand'))), { ok: false, reason: 'not_learned' })
    assert.deepEqual(canEquip(bare, weapon('axe')), { ok: false, reason: 'heavy' })
    const dressed = mk({ gear: gearWearing('ranger', 'robe', 'plate') })
    assert.equal(canEquip(dressed, itemFromContents(makeRangedContents('shortbow'))).ok, true)
    assert.equal(canEquip(dressed, itemFromContents(makeWandContents('sparkwand'))).ok, true)
    assert.equal(canEquip(dressed, weapon('axe')).ok, true)
  })
  it('the crossbow is no longer heavy: the coat alone suffices', () => {
    assert.equal(canEquip(mk({ gear: gearWearing('ranger') }), itemFromContents(makeRangedContents('crossbow'))).ok, true)
  })
  it('an outfit is not a main-hand item, and a weapon is not an outfit', () => {
    assert.deepEqual(canEquip(mk(), outfit('robe')), { ok: false, reason: 'not_equippable' })
    assert.deepEqual(canEquip(mk(), weapon('sword'), 'outfit'), { ok: false, reason: 'not_equippable' })
    assert.equal(canEquip(mk(), outfit('robe'), 'outfit').ok, true)
  })
})

describe('equipOutfit / unequipOutfit', () => {
  it('wears an outfit from the sack into its own loadout and opens it', () => {
    const p = mk()
    addItem(p, outfit('ranger'))
    assert.equal(equipOutfit(p, 0).ok, true)
    assert.equal(p.inventory.length, 0)
    assert.equal(p.gear.ranged.outfit.outfitType, 'ranger')
    assert.equal(loadoutAvailable(p, 'ranged'), true)
  })
  it('refuses a loadout-bound outfit into another loadout', () => {
    const p = mk()
    addItem(p, outfit('robe'))
    assert.deepEqual(equipOutfit(p, 0, 'melee'), { ok: false, reason: 'wrong_loadout' })
    assert.ok(EQUIP_FAIL_MESSAGES.wrong_loadout)
  })
  it('a leather coat lands on the active loadout by default', () => {
    const p = mk({ attackMode: 'melee' })
    addItem(p, outfit('leather'))
    equipOutfit(p, 0)
    assert.equal(p.gear.melee.outfit.outfitType, 'leather')
  })
  it('swaps a worn outfit back into the sack', () => {
    const p = mk({ gear: gearWearing('plate') })
    addItem(p, outfit('leather'))
    assert.equal(equipOutfit(p, 0).ok, true)
    assert.equal(p.gear.melee.outfit.outfitType, 'leather')
    assert.deepEqual(p.inventory.map(i => i.payload.outfitType), ['plate'])
  })
  it('taking the plate off a Warrior holding an axe sends the axe to the sack too', () => {
    const p = mk({ gear: gearWearing('plate'), weapon: weaponContents('axe') })
    assert.equal(unequipOutfit(p, 'melee').ok, true)
    assert.equal(p.weapon, null)
    assert.deepEqual(p.inventory.map(i => i.kind).sort(), ['outfit', 'weapon'])
  })
  it('refuses to take the plate off when the sack cannot hold outfit and axe', () => {
    const p = mk({ gear: gearWearing('plate'), weapon: weaponContents('axe'), maxInventory: 1 })
    assert.deepEqual(unequipOutfit(p, 'melee'), { ok: false, reason: 'full' })
    assert.equal(p.weapon.weaponType, 'axe')
    assert.equal(p.gear.melee.outfit.outfitType, 'plate')
    assert.ok(EQUIP_FAIL_MESSAGES.full)
  })
  it('swapping plate for leather with a heavy weapon held needs one extra slot', () => {
    const p = mk({ gear: gearWearing('plate'), weapon: weaponContents('axe'), maxInventory: 1 })
    addItem(p, outfit('leather'))                       // sack: 1/1
    assert.deepEqual(equipOutfit(p, 0), { ok: false, reason: 'full' })
    p.maxInventory = 2
    assert.equal(equipOutfit(p, 0).ok, true)            // leather out, plate + axe in
    assert.equal(p.inventory.length, 2)
  })
  it('closing the active loadout drops the stance back to melee', () => {
    const p = mk({ gear: gearWearing('ranger'), attackMode: 'ranged', charging: { kind: 'draw' } })
    assert.equal(unequipOutfit(p, 'ranged').ok, true)
    assert.equal(p.attackMode, 'melee')
    assert.equal(p.charging, null)
  })
  it('unequipping an empty slot is not_equippable', () => {
    assert.deepEqual(unequipOutfit(mk(), 'magic'), { ok: false, reason: 'not_equippable' })
  })
})

describe('unequipMain', () => {
  it('moves the held weapon to the sack and refuses when full', () => {
    const p = mk({ weapon: weaponContents('sword') })
    assert.equal(unequipMain(p, 'melee').ok, true)
    assert.equal(p.weapon, null)
    assert.equal(p.inventory[0].payload.weaponType, 'sword')
    const q = mk({ wand: { weaponType: 'sparkwand', name: 'Spark Wand', spell: 'spark' }, maxInventory: 0 })
    assert.deepEqual(unequipMain(q, 'magic'), { ok: false, reason: 'full' })
    assert.deepEqual(unequipMain(mk(), 'ranged'), { ok: false, reason: 'not_equippable' })
  })
})

describe('offhand consumable pointer', () => {
  it('points the active offhand at a consumable kind without moving the stack', () => {
    const p = mk()
    addItem(p, makeItem('mushroom', 2))
    assert.equal(equipOffhand(p, 0).ok, true)
    assert.equal(p.inventory.length, 1)
    assert.deepEqual(p.gear.melee.off, { kind: 'consumable', item: 'mushroom' })
    assert.equal(resolveOffhand(p).count, 2)
  })
  it('a weapon is not an offhand item yet (plan 2)', () => {
    const p = mk()
    addItem(p, weapon('dagger'))
    assert.deepEqual(equipOffhand(p, 0), { ok: false, reason: 'not_equippable' })
    assert.deepEqual(canEquip(p, p.inventory[0], 'off'), { ok: false, reason: 'not_equippable' })
  })
  it('two loadouts may point at the same stack', () => {
    const p = mk({ gear: gearWearing('robe') })
    addItem(p, makeItem('cooked_meat'))
    equipOffhand(p, 0, 'melee'); equipOffhand(p, 0, 'magic')
    assert.equal(p.gear.melee.off.item, 'cooked_meat')
    assert.equal(p.gear.magic.off.item, 'cooked_meat')
  })
  it('unequipOffhand clears a pointer', () => {
    const p = mk()
    assert.equal(unequipOffhand(p, 'melee').ok, true)
    assert.equal(p.gear.melee.off, null)
    assert.equal(resolveOffhand(p), null)
  })
})

describe('outfit pickups', () => {
  it('a found outfit wears itself into its empty slot', () => {
    const p = mk()
    assert.deepEqual(autoEquipOnPickup(p, outfit('ranger')), { ok: true, equipped: true, outfit: true })
    assert.equal(p.gear.ranged.outfit.outfitType, 'ranger')
    assert.equal(p.inventory.length, 0)
  })
  it('a second copy of an owned outfit is discarded, not sacked', () => {
    const p = mk({ gear: gearWearing('plate') })
    assert.deepEqual(autoEquipOnPickup(p, outfit('plate')), { ok: true, equipped: false, merged: 'outfit' })
    assert.equal(p.inventory.length, 0)
  })
  it('a different outfit for an occupied slot goes to the sack', () => {
    const p = mk({ gear: gearWearing('plate') })
    assert.deepEqual(autoEquipOnPickup(p, outfit('leather')), { ok: true, equipped: false })
    assert.equal(p.inventory[0].kind, 'outfit')
  })
  it('reports full when the slot is taken and the sack is full', () => {
    const p = mk({ gear: gearWearing('plate'), maxInventory: 0 })
    assert.deepEqual(autoEquipOnPickup(p, outfit('leather')), { ok: false, reason: 'full' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/equip-slots.test.js`
Expected: FAIL — `equipOutfit` is not exported.

- [ ] **Step 3: Rewrite the equip section of inventory.js**

Replace everything from `export function canEquip` through the end of `equipItem` with:
```js
// ── Equip rules ─────────────────────────────────────────────────────────────
// `slot` is where the item is going: 'main' (the loadout's hand), 'off',
// 'outfit' or 'belt' (plan 3). Talents no longer gate anything here — the
// worn outfits do (loadoutAvailable / canWieldHeavy).
export function canEquip(player, item, slot = 'main') {
  if (!item) return { ok: false, reason: 'not_equippable' }
  if (slot === 'outfit') return item.kind === 'outfit' ? { ok: true } : { ok: false, reason: 'not_equippable' }
  if (slot === 'off') return canEquipOffhand(player, item)
  if (item.kind === 'wand')
    return loadoutAvailable(player, 'magic') ? { ok: true } : { ok: false, reason: 'not_learned' }
  if (item.kind !== 'weapon' && item.kind !== 'ranged') return { ok: false, reason: 'not_equippable' }
  if (item.kind === 'ranged' && !loadoutAvailable(player, 'ranged'))
    return { ok: false, reason: 'not_learned' }
  if (item.payload.heavy && !canWieldHeavy(player))
    return { ok: false, reason: 'heavy' }
  return { ok: true }
}

// Plan 1: the offhand only ever points at a consumable stack. Plan 2 adds
// small blades, shields and wands with the two-handed rule.
export function canEquipOffhand(player, item) {
  return CONSUMABLE_KINDS.includes(item?.kind) ? { ok: true } : { ok: false, reason: 'not_equippable' }
}

const HAND_OF_KIND = { weapon: 'weapon', ranged: 'ranged', wand: 'wand' }

const handItem = (hand, payload) =>
  ({ kind: hand, name: payload.name, emoji: HAND_EMOJI[hand], stackable: false, payload: { ...payload } })

const roomFor = (player, n) => player.inventory.length + n <= player.maxInventory

// Equip the sack slot at `index` into its main hand; a held item swaps back in.
export function equipItem(player, index) {
  const item = player.inventory[index]
  if (!item) return { ok: false, reason: 'not_equippable' }
  const gate = canEquip(player, item)
  if (!gate.ok) return gate
  const hand = HAND_OF_KIND[item.kind]
  const held = player[hand]
  player[hand] = { ...item.payload }
  player.inventory.splice(index, 1)
  if (held) player.inventory.push(handItem(hand, held))
  return { ok: true, equipped: item }
}

// Hand → sack. The loadout may be locked (coat taken off with a bow still
// held): the hand keeps its content until the player empties it here.
export function unequipMain(player, stance) {
  const hand = MAIN_OF[stance]
  const held = player[hand]
  if (!held) return { ok: false, reason: 'not_equippable' }
  if (!roomFor(player, 1)) return { ok: false, reason: 'full' }
  player.inventory.push(handItem(hand, held))
  player[hand] = null
  return { ok: true }
}

// The Warrior's heavy weapon rides on the plate: whatever removes the plate
// (swap or unequip) must find the weapon a sack slot first.
function heavyEviction(player, stance, nextOutfit) {
  if (stance !== 'melee') return null
  return player.weapon?.heavy && !nextOutfit?.heavy ? player.weapon : null
}

// A closed loadout cannot stay active: fall back to the Warrior and drop any
// charge that belonged to the stance being closed.
function closeIfLocked(player, stance) {
  if (loadoutAvailable(player, stance) || player.attackMode !== stance) return
  player.attackMode = 'melee'
  player.charging = null
  player.stanceSwitch = null
}

// Wear the sack outfit at `index` in `stance` (default: the outfit's own
// loadout, else the active one). A worn outfit swaps back into the sack.
export function equipOutfit(player, index, stance) {
  const item = player.inventory[index]
  if (!item || item.kind !== 'outfit') return { ok: false, reason: 'not_equippable' }
  stance ??= item.payload.loadout ?? player.attackMode ?? 'melee'
  if (item.payload.loadout && item.payload.loadout !== stance) return { ok: false, reason: 'wrong_loadout' }
  const g = gearOf(player, stance)
  const evict = heavyEviction(player, stance, item.payload)
  // The new outfit frees one slot; the old outfit and an evicted weapon each take one.
  if (!roomFor(player, (g.outfit ? 1 : 0) + (evict ? 1 : 0) - 1)) return { ok: false, reason: 'full' }
  player.inventory.splice(index, 1)
  if (g.outfit) player.inventory.push(outfitItem(g.outfit))
  if (evict) { player.inventory.push(handItem('weapon', evict)); player.weapon = null }
  g.outfit = { ...item.payload }
  closeIfLocked(player, stance)
  return { ok: true, equipped: item }
}

export function unequipOutfit(player, stance) {
  const g = gearOf(player, stance)
  if (!g.outfit) return { ok: false, reason: 'not_equippable' }
  const evict = heavyEviction(player, stance, null)
  if (!roomFor(player, 1 + (evict ? 1 : 0))) return { ok: false, reason: 'full' }
  player.inventory.push(outfitItem(g.outfit))
  if (evict) { player.inventory.push(handItem('weapon', evict)); player.weapon = null }
  g.outfit = null
  closeIfLocked(player, stance)
  return { ok: true }
}

// Point `stance`'s offhand at the consumable kind in sack slot `index`. The
// stack stays in the sack — every loadout may point at the same one.
export function equipOffhand(player, index, stance = player.attackMode ?? 'melee') {
  const item = player.inventory[index]
  const gate = canEquipOffhand(player, item)
  if (!gate.ok) return gate
  gearOf(player, stance).off = { kind: 'consumable', item: item.kind }
  return { ok: true, equipped: item }
}

export function unequipOffhand(player, stance = player.attackMode ?? 'melee') {
  gearOf(player, stance).off = null
  return { ok: true }
}
```
Delete `findQuickUseIndex`, `quickUseSummary` and the comment above them (keep `CONSUMABLE_KINDS`, now exported in the loadout section from Task 1 — remove the older `const CONSUMABLE_KINDS` line).

In `autoEquipOnPickup`, add before the `if (item.kind === 'wand')` branch:
```js
  if (item.kind === 'outfit') {
    const ot = item.payload.outfitType
    const owned = STANCES.some(s => gearOf(player, s).outfit?.outfitType === ot)
      || player.inventory.some(i => i.kind === 'outfit' && i.payload.outfitType === ot)
    if (owned) return { ok: true, equipped: false, merged: 'outfit' }
    const stance = item.payload.loadout ?? player.attackMode ?? 'melee'
    if (!gearOf(player, stance).outfit) {
      gearOf(player, stance).outfit = { ...item.payload }
      return { ok: true, equipped: true, outfit: true }
    }
    const r = addItem(player, item)
    return r.ok ? { ok: true, equipped: false } : r
  }
```
Extend the messages:
```js
export const EQUIP_FAIL_MESSAGES = {
  heavy: 'Too heavy — I lack the strength.',
  not_equippable: "I can't wield that.",
  not_learned: "I don't know how to use this.",
  two_handed: 'I need both hands for that.',
  wrong_loadout: "That's not my garb.",
  full: 'My pack is full.',
}
```

- [ ] **Step 4: Update `test/inventory.test.js`**

- Import: drop `findQuickUseIndex, quickUseSummary`; add `import { gearWearing } from './helpers/outfits.js'` and `defaultGear` from entities.
- `mkPlayer`: `({ inventory: [], maxInventory: 10, weapon: null, ranged: null, wand: null, talents: [], gear: defaultGear(), ...over })`.
- Every `mkPlayer({ talents: [...] })` becomes `mkPlayer({ gear: gearWearing(...) })` with `ranged_stance → 'ranger'`, `magic_stance → 'robe'`, `heavy_weapons → 'plate'`. Rename the `it` titles accordingly ("without the coat", "without the robe", "without the plate").
- The crossbow test (line 113) becomes: `it('a crossbow needs only the coat now that plate belongs to the Warrior', ...)` asserting `not_learned` bare and `ok` with `gearWearing('ranger')`.
- Delete any `describe`/`it` covering `findQuickUseIndex`/`quickUseSummary`.

- [ ] **Step 5: Run the tests**

Run: `node --test test/equip-slots.test.js test/inventory.test.js test/outfits-model.test.js test/outfits.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add renderer/systems/inventory.js test/inventory.test.js test/equip-slots.test.js
git commit -m "feat: slot-aware equip rules — outfits, offhand pointers, outfit pickups

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Retire the stance talents in every gate

**Files:**
- Modify: `renderer/systems/talents.js`, `renderer/systems/ranged.js:3-20,80`, `renderer/systems/spells.js:15,170`, `renderer/systems/magic.js:9,85`, `renderer/render/canvas.js:84-88`, `renderer/systems/rites.js:4,124-129`, `renderer/data/rites.js`, `renderer/systems/openmap.js:240`, `tools/verify-loot.mjs:35-60`
- Test: `test/talents.test.js`, `test/ranged.test.js`, `test/spells.test.js`, `test/magic.test.js`, `test/canvas.test.js:318-326,360`, `test/rites.test.js:376-397`, `test/openmap.test.js:172`, `test/loot.test.js`, `test/hud.test.js:17` (talents line only; the slot itself is Task 7)

**Interfaces:**
- `TALENTS` = `{ ski_legs }` only; `RUSH_START_TALENTS = Object.keys(TALENTS)`; `MAP_CLEAR_TALENTS` removed.
- `nextStance(player)` cycles over `STANCES` filtered by `loadoutAvailable`.
- `tryFire`, `tryCast`, `tryGust` return `not_learned` when the loadout is closed.
- `playerSpriteKey(player, mode)` returns `player_melee_heavy` when `canWieldHeavy(player)`.
- `talent_trigger` entities carry `outfit` (string | null); `pullTarget(state)` skips a ring whose outfit the player already owns (`ownsOutfit`).

- [ ] **Step 1: Update the tests first**

- `test/talents.test.js`: registry test becomes `it('defines ski-legs and no stance talents', () => { assert.deepEqual(Object.keys(TALENTS), ['ski_legs']) })`; delete the `MAP_CLEAR_TALENTS` test and its import; `RUSH_START_TALENTS` test unchanged; replace every `'magic_stance'`/`'ranged_stance'` in the `grantTalent` tests with `'ski_legs'` and the "refuses unknown ids" test may add `assert.equal(grantTalent(state, 'magic_stance'), false)`.
- `test/ranged.test.js`: import `gearWearing`; replace `talents: ['ranged_stance', 'magic_stance']` with `gear: gearWearing('ranger', 'robe')`, `talents: ['ranged_stance']` with `gear: gearWearing('ranger')`, `talents: ['magic_stance']` with `gear: gearWearing('robe')`, `talents: []` with `gear: defaultGear()` (import from entities). Bare `{ attackMode: 'melee', talents: [] }` objects become `{ attackMode: 'melee' }` (accessors lazily create gear).
- `test/spells.test.js:19,96` and `test/magic.test.js:22,29,34,110,138,192`: same substitution; the "refuses without the magic_stance talent" tests become "refuses without the robe" using a player with `gear: defaultGear()`.
- `test/canvas.test.js:321-326`: 
```js
  it('picks the sprite for the stance; the plate makes the Warrior a knight', () => {
    assert.equal(playerSpriteKey({ attackMode: 'melee' }, 'melee'), 'player_base')
    assert.equal(playerSpriteKey({ attackMode: 'melee', gear: gearWearing('plate') }, 'melee'), 'player_melee_heavy')
    assert.equal(playerSpriteKey({ attackMode: 'ranged', gear: gearWearing('ranger') }, 'ranged'), 'player_ranged')
    assert.equal(playerSpriteKey({ attackMode: 'magic', gear: gearWearing('robe') }, 'magic'), 'player_magic')
  })
```
  and line 360 `player({ talents: ['heavy_weapons'], ...` → `player({ gear: gearWearing('plate'), ...`.
- `test/rites.test.js:376-397`: `ring` gets `outfit: 'robe'` instead of `talent`; `player` becomes `{}`; "will not pull a player who already learned the talent" → "will not pull a player who already owns the robe" with `player: { gear: gearWearing('robe') }`; the marsh test uses `{ ...ring, outfit: null }`.
- `test/openmap.test.js:172`: expected trigger `{ kind: 'talent_trigger', x: 4, y: 4, outfit: 'robe', rite: 'mushroom_circle' }`.
- `test/loot.test.js`: replace `ALL_TALENTS` with `const ALL_OUTFITS = ['ranger', 'robe', 'plate']`; `mkPlayer({ talents, ... })` → `mkPlayer({ outfits = [], ... })` building `gear: gearWearing(...outfits)`; each call site maps talent ids to outfit ids (`heavy_weapons`→`plate`, etc.). Line 184's "everything but heavy" becomes `outfits: ['ranger', 'robe']`.
- `test/hud.test.js:17`: `talents: ['ranged_stance', 'magic_stance']` → `gear: gearWearing('ranger', 'robe')` (import the helper).

- [ ] **Step 2: Run the updated tests to see them fail**

Run: `node --test test/talents.test.js test/ranged.test.js test/spells.test.js test/magic.test.js test/canvas.test.js test/rites.test.js test/openmap.test.js test/loot.test.js`
Expected: FAIL in ranged/spells/magic/canvas/rites/openmap (gates still read talents).

- [ ] **Step 3: talents.js**

```js
export const TALENTS = {
  ski_legs: { name: 'Ski-legs', desc: 'Sprinting costs far less stamina.' },
}
// Dungeon Rush: every talent from the first step (outfits too — see
// systems/outfits.js RUSH_START_OUTFITS). Assigned silently at spawn.
export const RUSH_START_TALENTS = Object.keys(TALENTS)
```
Delete `MAP_CLEAR_TALENTS` and its comment. Update the header comment: the stance talents became outfits on 2026-09-17 (`systems/outfits.js`).

- [ ] **Step 4: ranged.js**

Replace `import { hasTalent } from './talents.js'` with `import { spendAmmo, loadoutAvailable } from './inventory.js'` (merging with the existing `spendAmmo` import), delete the `STANCE_TALENT` line, and in `nextStance` change the one gate line
```js
    if (!STANCE_TALENT[mode] || hasTalent(player, STANCE_TALENT[mode])) return mode
```
to
```js
    if (loadoutAvailable(player, mode)) return mode
```
(`STANCE_ORDER` and the loop stay as they are.) Update the comment above it: "The next open loadout in the cycle; null when only the Warrior is open." In `tryFire`: `if (!loadoutAvailable(player, 'ranged')) return { ok: false, reason: 'not_learned' }`.

- [ ] **Step 5: spells.js, magic.js**

Replace `import { hasTalent } from './talents.js'` with `import { loadoutAvailable } from './inventory.js'` and the two checks with `if (!loadoutAvailable(p, 'magic')) return { ok: false, reason: 'not_learned' }`. Check for an import cycle: `inventory.js` imports only `entities.js`; fine.

- [ ] **Step 6: canvas.js**

```js
import { canWieldHeavy } from '../systems/inventory.js'
// The player's look follows the stance: bare adventurer (or the knight in
// plate) in melee, the ranger in ranged, the wizard in magic.
export function playerSpriteKey(player, mode) {
  if (mode === 'ranged') return 'player_ranged'
  if (mode === 'magic') return 'player_magic'
  return canWieldHeavy(player) ? 'player_melee_heavy' : 'player_base'
}
```

- [ ] **Step 7: rites — data, spawn, pull**

`renderer/data/rites.js`: field `talent` → `outfit`: `{ fromPoi: 'mushroom ring', outfit: 'robe', rite: 'mushroom_circle' }` and `{ fromPoi: 'mushroom ring', outfit: null, rite: 'mushroom_circle' }`; update the comment ("no outfit to give").
`renderer/systems/openmap.js:240`: `entitySpawns.push({ kind: 'talent_trigger', x: poi.x, y: poi.y, outfit: rite.outfit, rite: rite.rite })`.
`renderer/systems/rites.js`: import `ownsOutfit` from `./outfits.js` instead of `hasTalent`;
```js
export function pullTarget(state) {
  return (state.entities ?? []).find(e => e.type === 'talent_trigger'
    && (!e.outfit || !ownsOutfit(state.player, e.outfit))) ?? null
}
```
Check `outfits.js` → `inventory.js` → `entities.js` and `rites.js` → `outfits.js` form no cycle (rites.js is not imported by outfits.js).

- [ ] **Step 8: tools/verify-loot.mjs**

Snapshot `outfits: ['melee','ranged','magic'].map(s => p.gear?.[s]?.outfit?.outfitType).filter(Boolean)` instead of `talents`, print it, and the dead-item rule becomes:
```js
      const has = ot => snap.outfits.includes(ot)
      const dead =
        (c.type === 'ranged' && !has('ranger')) ||
        (c.type === 'wand' && !has('robe')) ||
        (c.heavy && !has('plate')) ||
        (c.type === 'ammo' && !snap.ammoKinds.includes(c.ammoKind))
```

- [ ] **Step 9: Run the suite for these files**

Run: `node --test test/talents.test.js test/ranged.test.js test/spells.test.js test/magic.test.js test/canvas.test.js test/rites.test.js test/openmap.test.js test/loot.test.js`
Expected: PASS. (`test/hud.test.js` still fails until Task 7 — expected.)

- [ ] **Step 10: Commit**

```bash
git add renderer/systems/talents.js renderer/systems/ranged.js renderer/systems/spells.js renderer/systems/magic.js renderer/render/canvas.js renderer/systems/rites.js renderer/data/rites.js renderer/systems/openmap.js tools/verify-loot.mjs test/
git commit -m "refactor: stance and Might gates read worn outfits, not talents

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Save shape — gear/belt in the body, v8 talent migration

**Files:**
- Modify: `renderer/systems/adventure.js:19-58` (`normalizeBody`), `:101-126` (`normalizeAdventureSave`)
- Test: `test/adventure.test.js` (v3 test expectation, new v8 tests), `test/timewarp.test.js` if it asserts a body shape (grep `body` there; adjust the same way)

**Interfaces:**
- `normalizeBody(body)` returns `gear` (per-stance `{ off, outfit }`, outfits rebuilt from `OUTFIT_TYPES`, unknown ones dropped, offhand pointers copied, anything else nulled in this plan) and `belt` (null unless a known melee weaponType).
- `normalizeAdventureSave(raw)`: after body normalisation, `migrateTalentsToOutfits(base.body, base.talents)` is applied and `base.v8 = true`.

- [ ] **Step 1: Write the failing tests**

Append to `test/adventure.test.js`:
```js
import { migrateTalentsToOutfits } from '../renderer/systems/outfits.js'   // (top of file)
import { defaultGear, makeOutfitContents } from '../renderer/systems/entities.js'

describe('v8 save shape — gear and outfits', () => {
  const emptyBody = () => ({ weapon: null, ranged: null, wand: null, ammo: { arrow: 0, bolt: 0, stone: 0 }, inventory: [], gear: defaultGear(), belt: null })

  it('a body without gear gains the default gear and no belt', () => {
    const b = normalizeBody({ weapon: null, ranged: null, wand: null, inventory: [] })
    assert.deepEqual(b.gear, defaultGear())
    assert.equal(b.belt, null)
  })
  it('worn outfits are rebuilt from the table; unknown ones are dropped', () => {
    const stale = { ...emptyBody(), gear: { ...defaultGear(), melee: { off: null, outfit: { outfitType: 'plate', name: 'Old Plate' } },
      magic: { off: { kind: 'consumable', item: 'mushroom' }, outfit: { outfitType: 'tuxedo' } } } }
    const b = normalizeBody(stale)
    assert.equal(b.gear.melee.outfit.name, 'Plated Armor')
    assert.equal(b.gear.melee.outfit.protect, 2)
    assert.equal(b.gear.magic.outfit, null)
    assert.deepEqual(b.gear.magic.off, { kind: 'consumable', item: 'mushroom' })
    assert.equal(b.gear.melee.off, null)
  })
  it('a v7 save with stance talents wakes up wearing the outfits', () => {
    const v7 = { caves: {}, progress: { mapDepth: 12, cleared: {}, visited: [] }, talents: ['ranged_stance', 'magic_stance', 'heavy_weapons', 'ski_legs'],
      body: { weapon: null, ranged: null, wand: null, ammo: { arrow: 0, bolt: 0, stone: 0 }, inventory: [] },
      gates: {}, npcs: {}, felled: {}, leaps: {}, quests: {}, clock: 0, v6: true, v7: true }
    const s = normalizeAdventureSave(v7)
    assert.deepEqual(s.talents, ['ski_legs'])
    assert.equal(s.body.gear.ranged.outfit.outfitType, 'ranger')
    assert.equal(s.body.gear.magic.outfit.outfitType, 'robe')
    assert.equal(s.body.gear.melee.outfit.outfitType, 'plate')
    assert.equal(s.v8, true)
  })
  it('talents with no body still produce a dressed body', () => {
    const s = normalizeAdventureSave({ caves: {}, progress: { mapDepth: 7, cleared: {} }, talents: ['magic_stance'], body: null })
    assert.equal(s.body.gear.magic.outfit.outfitType, 'robe')
    assert.deepEqual(s.talents, [])
  })
  it('a current save is untouched', () => {
    const s = normalizeAdventureSave(null)
    assert.equal(s.body, null)
    assert.equal(s.v8, true)
    assert.deepEqual(normalizeAdventureSave(s), s)
  })
})
```
Update the existing v3 test (line ~118): its expected object gains `v8: true` and, because `talents: ['magic_stance']` migrates, expects `talents: []` and `body: { ...v3.body, wand: null, ammo: {...}, gear: <defaultGear with magic.outfit = robe payload>, belt: null }`. Build the expected gear with `const g = defaultGear(); const { type, ...robe } = makeOutfitContents('robe'); g.magic.outfit = robe`. The v4 test's expectation gains `v8: true` and `body: null` stays null (no retired talents).

- [ ] **Step 2: Run to see failure**

Run: `node --test test/adventure.test.js`
Expected: FAIL — `gear` undefined / `v8` undefined.

- [ ] **Step 3: adventure.js**

Imports: add `OUTFIT_TYPES, makeOutfitContents, defaultGear, WEAPON_TYPES, weaponContents` from `./entities.js` and `import { migrateTalentsToOutfits } from './outfits.js'`.

At the end of `normalizeBody`, before `return out`:
```js
  // Per-loadout gear (2026-09-17): outfits are table data and are rebuilt
  // like the hands; an unknown outfitType is dropped. Offhand pointers are
  // copied as-is; anything else in an offhand is plan 2's to restore and is
  // nulled here so a half-migrated save cannot hand the HUD a stray shape.
  const gear = defaultGear()
  for (const stance of Object.keys(gear)) {
    const g = out.gear?.[stance]
    if (!g) continue
    const ot = g.outfit?.outfitType
    if (OUTFIT_TYPES[ot]) { const { type, ...payload } = makeOutfitContents(ot); gear[stance].outfit = payload }
    else gear[stance].outfit = null
    gear[stance].off = g.off?.kind === 'consumable' && typeof g.off.item === 'string' ? { kind: 'consumable', item: g.off.item } : null
  }
  out.gear = gear
  out.belt = WEAPON_TYPES[out.belt?.weaponType] ? weaponContents(out.belt.weaponType) : null
```
Note: when `out.gear` is absent entirely the loop `continue`s for every stance, leaving the defaults (potion pointers). When present, each stance's `off` is read from the save (a saved null stays null).

In `normalizeAdventureSave`, after the `v7` block:
```js
  // v8: the stance talents became outfits (systems/outfits.js). A body is
  // conjured if the save had talents but no body yet.
  if (!base.v8) {
    const m = migrateTalentsToOutfits(base.body, base.talents)
    base.body = m.body
    base.talents = m.talents
    base.v8 = true
  }
```
Update the save-shape comment block above the function with a v8 line.

- [ ] **Step 4: Run**

Run: `node --test test/adventure.test.js test/timewarp.test.js test/mode.test.js`
Expected: PASS (fix any timewarp expectation that spelled out a full save object by adding `v8: true`).

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/adventure.js test/adventure.test.js test/timewarp.test.js
git commit -m "feat: save v8 — gear and belt on the body, stance talents migrate to outfits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: game.js wiring — persistence, sources, rite, Q

**Files:**
- Modify: `renderer/game.js` — imports (`:29`, `:61`), Q handler (`:150-157`), `persistRun` (`:227-236`), `applyLoadout` (`:622-645`), `startNewRun` (`:682-706`), rite end (`:1003-1013`), `answerTheCall` (`:994`), trigger (`:1206-1208`), `useInventoryItem` (`:900`), `dropInventoryItem` (`:921`), boss death (`:1783-1790`)

**Interfaces:**
- Consumes Task 2–5 exports. Produces `useOffhand()` (Q), `freeAdjacentTile(x, y)` helper, `spawnOutfitDrop(tile, outfitType)`.

- [ ] **Step 1: Imports**

Line 29 becomes:
```js
import { itemFromContents, contentsFromItem, autoEquipOnPickup, addAmmo, removeItem, equipItem, equipOutfit, unequipOutfit, unequipMain, equipOffhand, unequipOffhand, resolveOffhand, EQUIP_FAIL_MESSAGES } from './systems/inventory.js'
```
Line 61 becomes `import { TALENTS, grantTalent, hasTalent, RUSH_START_TALENTS } from './systems/talents.js'` and add:
```js
import { RETIRED_TALENT_OUTFITS, MAP_CLEAR_OUTFITS, BOSS_DROP_OUTFITS, RUSH_START_OUTFITS, wearOutfit, ownsOutfit, outfitToast } from './systems/outfits.js'
```
Add `OUTFIT_TYPES, makeOutfitContents, defaultGear` to the existing entities import.

- [ ] **Step 2: Q becomes "use offhand"**

Replace the Q handler body:
```js
// Q (and the green touch button): use whatever the active offhand holds.
// This plan: a consumable pointer. Plan 2 adds hold-to-block and wand casts.
window.addEventListener('keydown', e => {
  if ((e.key !== 'q' && e.key !== 'Q') || e.repeat) return
  if (phase !== PHASE.PLAYING || !state) return
  useOffhand()
})

function useOffhand() {
  const off = resolveOffhand(state.player)
  if (!off) { throttledThink('offhand', 'Nothing in my off hand.'); return }
  if (off.kind === 'consumable') {
    if (off.index === -1) { throttledThink('offhand', 'None left.'); return }
    useInventoryItem(off.index)
  }
}
```
(`throttledThink` is defined later in the file as a function declaration, so hoisting covers the call.)

- [ ] **Step 3: persistRun body**

Inside `activeSave.body = { ... }` add:
```js
      // Per-loadout gear and the shared belt travel with the body too.
      gear: structuredClone(state.player.gear ?? defaultGear()),
      belt: state.player.belt ? { ...state.player.belt } : null,
```

- [ ] **Step 4: startNewRun restore + rush + applyLoadout**

After `player.wand = ...` in the `activeSave.body` block add:
```js
      // Gear was normalised (outfits rebuilt from the table) by normalizeBody on load.
      player.gear = structuredClone(activeSave.body.gear ?? defaultGear())
      player.belt = activeSave.body.belt ? { ...activeSave.body.belt } : null
```
Replace `if (runMode === 'rush') player.talents = [...RUSH_START_TALENTS]` with:
```js
  if (runMode === 'rush') {
    player.talents = [...RUSH_START_TALENTS]
    for (const ot of RUSH_START_OUTFITS) { const { type, ...payload } = makeOutfitContents(ot); wearOutfit(player, payload) }
  }
```
In `applyLoadout`, replace the talents loop with:
```js
  // A kit's `talents` may still name a retired stance talent — it means the
  // outfit now. `outfits` names outfits directly.
  const wear = ot => { const { type, ...payload } = makeOutfitContents(ot); if (OUTFIT_TYPES[ot]) wearOutfit(player, payload); else console.warn(`loadout: unknown outfit "${ot}" — skipped`) }
  if (Array.isArray(po.talents)) {
    for (const t of po.talents) {
      if (RETIRED_TALENT_OUTFITS[t]) wear(RETIRED_TALENT_OUTFITS[t])
      else if (TALENTS[t]) player.talents.push(t)
      else console.warn(`loadout: unknown talent "${t}" — skipped`)
    }
  }
  if (Array.isArray(po.outfits)) po.outfits.forEach(wear)
```
Update the `applyLoadout` doc comment to list `outfits`.

- [ ] **Step 5: Outfit drops and the adjacency helper**

Extract from `dropInventoryItem`:
```js
// The nearest free walkable neighbour of (x, y), or null.
function freeAdjacentTile(x, y) {
  const { map } = state
  return [[-1,0],[1,0],[0,-1],[0,1]].map(([dx,dy]) => ({ x: x+dx, y: y+dy }))
    .find(t => isWalkable(map[t.y]?.[t.x]?.tile, map[t.y]?.[t.x]) && !state.entities.some(e => e.x===t.x && e.y===t.y)) ?? null
}
```
and have `dropInventoryItem` call `freeAdjacentTile(player.x, player.y)`.

Add:
```js
// An outfit landing next to a fallen boss (or on the tile itself when nothing
// is free): a floating item like any drop, so walking onto it self-equips.
function spawnOutfitDrop(tile, outfitType) {
  const at = freeAdjacentTile(tile.x, tile.y) ?? tile
  const px = tile.x * TILE_SIZE + TILE_SIZE / 2, py = tile.y * TILE_SIZE + TILE_SIZE / 2
  state.entities.push({
    type: 'floating_item', contents: makeOutfitContents(outfitType), x: at.x, y: at.y,
    startPx: px, startPy: py, targetPx: at.x * TILE_SIZE + TILE_SIZE / 2, targetPy: at.y * TILE_SIZE + TILE_SIZE / 2,
    px, py, progress: 0, duration: 0.35,
  })
}
```
In the boss-death block, replace the two `MAP_CLEAR_TALENTS` lines and add the cyclops rule outside the `if (state.cave)`:
```js
    // Outfits fall where bosses fall: the cyclops always carries the plate,
    // and the first dungeon cleared on a map with a MAP_CLEAR_OUTFITS entry
    // leaves that outfit. Neither drops for a body that already owns it.
    const drops = [BOSS_DROP_OUTFITS[bossType]]
    if (state.cave) drops.push(MAP_CLEAR_OUTFITS[OPEN_MAPS[state.cave.surface.level].name])
    for (const ot of new Set(drops.filter(Boolean)))
      if (!ownsOutfit(state.player, ot)) spawnOutfitDrop(state.lastBossTile, ot)
```
(Keep `markCleared`, `mapJustCompleted` and `persistRun()` in the `if (state.cave)` block as they are.)

- [ ] **Step 6: Pickup toast**

In `grantContents`, after `if (!r.ok) {...}`:
```js
  if (r.outfit) outfitToast(state, item.payload)
```

- [ ] **Step 7: The rite gives the robe**

- `buildEntities` (`:524`): `case 'talent_trigger': return [{ type: 'talent_trigger', x: s.x, y: s.y, outfit: s.outfit, rite: s.rite }]`.
- `beginRite(outfit)` (`:971`): `state.rite = { t: 0, dur: RITE_DURATION, outfit, cx: player.px, cy: player.py }`.
- `answerTheCall` (`:994`): `state.tripPull = { t: 0, dur: PULL_DURATION, x: target.x, y: target.y, outfit: target.outfit }`.
- Where the pull hands over (`beginRite(pull.talent)` inside the `state.tripPull` block) → `beginRite(pull.outfit)`; the trigger path `beginRite(trigger.talent)` → `beginRite(trigger.outfit)`.
- Trigger condition: `if (trigger && (!trigger.outfit || !ownsOutfit(player, trigger.outfit)) && riteConditionMet(trigger.rite, state))`.
- Rite end:
```js
      const outfit = state.rite.outfit
      state.rite = null
      state.player.trance = 0
      state.player.tranceFade = 0
      // Outfit-less anchors (the marsh's ring) play the ceremony and give
      // nothing. Otherwise the robe is simply there, under the player's feet:
      // grantContents self-equips it (or sacks it); a full sack leaves it
      // floating on the ring for the next step.
      if (outfit) {
        if (!grantContents(makeOutfitContents(outfit))) spawnOutfitDrop({ x: state.player.x, y: state.player.y }, outfit)
        persistIfSurface()
      }
```
Remove the now-unused `grantTalent` import only if nothing else uses it (Ski-legs' grant in `systems/quests/clearings.js` uses its own import; check `grep -n grantTalent renderer/game.js`).

- [ ] **Step 8: Boot check**

Run: `node --check renderer/game.js` and `npm test` (expect only `test/hud.test.js` failing on the slot id, fixed in Task 7). Then launch with the level cheat and confirm nothing throws on start:
```bash
DISPLAY=:0 timeout 40 npx electron . --dcdebug 2>&1 | grep -i "error\|uncaught" || echo "clean boot"
```

- [ ] **Step 9: Commit**

```bash
git add renderer/game.js
git commit -m "feat: wire loadouts into the run — persistence, outfit drops, rite robe, Q uses the offhand

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: HUD offhand slot and outfit icons

**Files:**
- Modify: `renderer/render/hud.js:1,35-48`, `renderer/index.html:57,225`, `renderer/ui/touch-controls.js:101-108`, `renderer/render/sprites.js` (after `player_magic`), `renderer/render/icons.js`
- Test: `test/hud.test.js:39-54,142,151`, `test/icons.test.js` (add outfit case), `test/sprites.test.js` (automatic)

**Interfaces:**
- `#hud-offhand` replaces `#hud-consumable`; `dataset.offhand` = the resolved kind (`'consumable'`) when usable, `''` otherwise (touch button greys on empty).
- `SPRITES.outfit_ranger = 'tile_0112'`, `outfit_robe = 'tile_0084'`, `outfit_plate = 'tile_0097'`, `outfit_leather = 'tile_0098'`; `iconSpriteFor({ kind:'outfit', payload:{ outfitType } })` → `outfit_<type>`.

- [ ] **Step 1: Update tests**

`test/hud.test.js`: rename the describe to `updateHUD offhand slot`; the `state()` helper's player gains `gear: gearWearing('ranger', 'robe')` (already from Task 4) — its melee offhand is the potion pointer. Tests:
```js
  it('shows the pointed consumable with its count and publishes the badge attribute', () => {
    const nodes = fakeDom()
    updateHUD(state({ inventory: [{ kind: 'potion', emoji: '🧪', stackable: true, count: 3 }] }))
    assert.match(nodes['hud-offhand'].innerHTML, /assets\/tiles\/.*\.png/)
    assert.match(nodes['hud-offhand'].innerHTML, /×3/)
    assert.equal(nodes['hud-offhand'].dataset.offhand, 'consumable')
  })
  it('an empty stack renders the pointed kind dimmed, no count, badge cleared', () => {
    const nodes = fakeDom()
    updateHUD(state())
    assert.match(nodes['hud-offhand'].innerHTML, /hud-icon-empty/)
    assert.doesNotMatch(nodes['hud-offhand'].innerHTML, /hud-count/)
    assert.equal(nodes['hud-offhand'].dataset.offhand, '')
  })
  it('an empty offhand renders the dimmed potion silhouette', () => {
    const nodes = fakeDom()
    const s = state(); s.player.gear.melee.off = null
    updateHUD(s)
    assert.match(nodes['hud-offhand'].innerHTML, /hud-icon-empty/)
    assert.equal(nodes['hud-offhand'].dataset.offhand, '')
  })
  it('follows the active loadout', () => {
    const nodes = fakeDom()
    const s = state({ inventory: [{ kind: 'mushroom', emoji: '🍄', stackable: true, count: 1 }], attackMode: 'magic' })
    s.player.gear.magic.off = { kind: 'consumable', item: 'mushroom' }
    updateHUD(s)
    assert.match(nodes['hud-offhand'].innerHTML, /ow_mushroom/)
  })
```
Lines 142/151: `'hud-consumable'` → `'hud-offhand'`.
`test/icons.test.js`: add `it('outfits use their loadout sprite', () => assert.equal(iconSpriteFor({ kind: 'outfit', payload: { outfitType: 'robe' } }), 'outfit_robe'))`.

- [ ] **Step 2: Run to see failure**

Run: `node --test test/hud.test.js test/icons.test.js` → FAIL.

- [ ] **Step 3: hud.js**

Import `resolveOffhand` (drop the quick-use imports) and replace the consumable block:
```js
  // Offhand slot: what Q acts on in the active loadout. A consumable pointer
  // shows the kind and the sack count (dimmed at zero); an empty offhand shows
  // the dimmed potion silhouette so the slot never vanishes.
  const off = resolveOffhand(player)
  const offEl = el('hud-offhand')
  if (off?.kind === 'consumable') {
    const src = iconSrcFor({ kind: off.item })
    const cls = off.count > 0 ? 'hud-icon' : 'hud-icon hud-icon-empty'
    setHTML(offEl, (src ? `<img class="${cls}" src="${src}" alt="">` : (off.slot?.emoji ?? ''))
      + (off.count > 0 ? `<span class="hud-count">×${off.count}</span>` : ''))
    offEl.dataset.offhand = off.count > 0 ? 'consumable' : ''
  } else {
    const emptySrc = iconSrcFor({ kind: 'potion' })
    setHTML(offEl, emptySrc ? `<img class="hud-icon hud-icon-empty" src="${emptySrc}" alt="">` : '')
    offEl.dataset.offhand = ''
  }
```

- [ ] **Step 4: index.html, touch-controls.js**

Rename `#hud-consumable` → `#hud-offhand` in the CSS rule (line 57) and the element (line 225); update the comment on `#hud-ammo`. In touch-controls.js:
```js
  // --- The offhand button mirrors the badge the HUD publishes on
  // #hud-offhand rather than reaching into game state: grey when the active
  // offhand has nothing usable. ---
  const offhandEl = document.getElementById('hud-offhand')
  const quickBtn = document.getElementById('touch-quickuse')
  new MutationObserver(() => {
    quickBtn.classList.toggle('empty', !offhandEl.dataset.offhand)
  }).observe(offhandEl, { attributes: true, attributeFilter: ['data-offhand'] })
```

- [ ] **Step 5: sprites.js and icons.js**

After `player_magic` in `SPRITES`:
```js
  // Outfit icons: the loadout's own figure stands in for its garb until
  // dedicated art exists (plan 3).
  outfit_ranger:  'tile_0112',
  outfit_robe:    'tile_0084',
  outfit_plate:   'tile_0097',
  outfit_leather: 'tile_0098',
```
icons.js `iconSpriteFor`: before the weapon branch add
```js
  if (item.kind === 'outfit') return SPRITES[`outfit_${item.payload?.outfitType}`] ? `outfit_${item.payload.outfitType}` : 'outfit_leather'
```

- [ ] **Step 6: Run**

Run: `node --test test/hud.test.js test/icons.test.js test/sprites.test.js test/touch-input.test.js` → PASS. Then `npm test` → all green except nothing (Tasks 3–6 complete).

- [ ] **Step 7: Commit**

```bash
git add renderer/render/hud.js renderer/index.html renderer/ui/touch-controls.js renderer/render/sprites.js renderer/render/icons.js test/hud.test.js test/icons.test.js
git commit -m "feat: HUD offhand slot replaces the quick-use slot; outfit icons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Pause panel — gear strip

**Files:**
- Create: `renderer/ui/inventory-panel-model.js`
- Modify: `renderer/ui/inventory-panel.js` (whole render), `renderer/index.html` CSS (replace `.inv-hands`/`.inv-hand` rules), `renderer/game.js` `openInventory` handlers (`:838-849`)
- Test: `test/inventory-panel-model.test.js` (new)

**Interfaces:**
- Model (pure):
  - `gearStrip(player) → [{ stance, name, active, locked, tiles: [{ slot:'main'|'off'|'outfit', item }] }]` — `item` is a sack-shaped item (`{ kind, name, emoji, payload }`) for hands/outfits, `{ kind:'consumable', name, count, emoji, item }` for a resolved pointer, or null; `locked = !loadoutAvailable`.
  - `sackActions(player, item) → [{ label, fn }]` in display order: primary (Equip / Drink / Eat / Build fire), `Offhand` for consumables (`fn: 'onEquipOff'`), then `Drop`; quest items only Drop; outfits `Wear` (`fn: 'onEquip'`).
  - `gearAction(player, stance, slot) → { label:'Unequip'|'Clear', fn:'onUnequip' } | null` (null for an empty tile or a locked loadout).
  - `moveSelection(sel, key, counts) → sel` where `sel = { area:'sack'|'gear', index }`, `counts = { sack, gear }`, cols 5 in the sack and 3 tiles × 3 columns in the strip (index = column*3 + tile); Up from sack row 0 → gear index of the active column's main tile; Down from the strip → sack index 0.
- Handlers game.js provides to `showInventory`: `onEquip(i)`, `onEquipOff(i)`, `onUnequip(stance, slot)`, `onUse(i)`, `onDrop(i)`, `onBuild(i)`, `onClose()`.

- [ ] **Step 1: Write the failing tests**

`test/inventory-panel-model.test.js`:
```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { gearStrip, sackActions, gearAction, moveSelection } from '../renderer/ui/inventory-panel-model.js'
import { makePlayer, weaponContents, makeOutfitContents } from '../renderer/systems/entities.js'
import { makeItem, addItem, itemFromContents } from '../renderer/systems/inventory.js'
import { gearWearing } from './helpers/outfits.js'

const mk = over => ({ ...makePlayer(1, 1), ...over })

describe('gearStrip', () => {
  it('lists Warrior, Archer, Mage with locks that follow the outfits', () => {
    const strip = gearStrip(mk({ gear: gearWearing('robe') }))
    assert.deepEqual(strip.map(c => [c.name, c.locked]), [['Warrior', false], ['Archer', true], ['Mage', false]])
    assert.deepEqual(strip.map(c => c.active), [true, false, false])
  })
  it('shows the main hand, the resolved pointer and the outfit per column', () => {
    const p = mk({ weapon: weaponContents('sword'), gear: gearWearing('plate') })
    addItem(p, makeItem('potion', 2))
    const [warrior] = gearStrip(p)
    assert.equal(warrior.tiles[0].item.payload.weaponType, 'sword')
    assert.deepEqual(warrior.tiles[1].item, { kind: 'consumable', item: 'potion', name: 'Potion', emoji: '🧪', count: 2 })
    assert.equal(warrior.tiles[2].item.payload.outfitType, 'plate')
  })
  it('an empty pointer still shows the kind at count 0; a null offhand is null', () => {
    const p = mk()
    assert.equal(gearStrip(p)[0].tiles[1].item.count, 0)
    p.gear.melee.off = null
    assert.equal(gearStrip(p)[0].tiles[1].item, null)
  })
})

describe('sackActions', () => {
  it('a potion drinks, can be pointed at, and drops', () => {
    assert.deepEqual(sackActions(mk(), makeItem('potion')).map(a => a.label), ['Drink', 'Offhand', 'Drop'])
  })
  it('an outfit wears; a weapon equips; a quest item only drops', () => {
    assert.deepEqual(sackActions(mk(), itemFromContents(makeOutfitContents('ranger'))).map(a => [a.label, a.fn]), [['Wear', 'onEquip'], ['Drop', 'onDrop']])
    assert.deepEqual(sackActions(mk(), itemFromContents({ type: 'weapon', ...weaponContents('dagger') })).map(a => a.label), ['Equip', 'Drop'])
    assert.deepEqual(sackActions(mk(), makeItem('clapper')).map(a => a.label), ['Drop'])
  })
})

describe('gearAction', () => {
  it('unequips a filled hand or outfit, clears a pointer, nothing on empty or locked', () => {
    const p = mk({ weapon: weaponContents('sword'), gear: gearWearing('plate') })
    assert.deepEqual(gearAction(p, 'melee', 'main'), { label: 'Unequip', fn: 'onUnequip' })
    assert.deepEqual(gearAction(p, 'melee', 'outfit'), { label: 'Unequip', fn: 'onUnequip' })
    assert.deepEqual(gearAction(p, 'melee', 'off'), { label: 'Clear', fn: 'onUnequip' })
    assert.equal(gearAction(p, 'ranged', 'main'), null)     // locked
    assert.equal(gearAction(p, 'magic', 'outfit'), null)    // locked and empty
  })
})

describe('moveSelection', () => {
  const counts = { sack: 7, gear: 9 }
  it('moves within the sack grid as before', () => {
    assert.deepEqual(moveSelection({ area: 'sack', index: 0 }, 'ArrowRight', counts), { area: 'sack', index: 1 })
    assert.deepEqual(moveSelection({ area: 'sack', index: 1 }, 'ArrowDown', counts), { area: 'sack', index: 6 })
    assert.deepEqual(moveSelection({ area: 'sack', index: 6 }, 'ArrowRight', counts), { area: 'sack', index: 6 })
  })
  it('Up from the top row enters the strip; Down from the strip returns to the sack', () => {
    assert.deepEqual(moveSelection({ area: 'sack', index: 2 }, 'ArrowUp', counts, 'melee'), { area: 'gear', index: 0 })
    assert.deepEqual(moveSelection({ area: 'sack', index: 2 }, 'ArrowUp', counts, 'magic'), { area: 'gear', index: 6 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 2 }, 'ArrowDown', counts), { area: 'sack', index: 0 })
  })
  it('within the strip, Left/Right change column and Up/Down change tile', () => {
    assert.deepEqual(moveSelection({ area: 'gear', index: 0 }, 'ArrowRight', counts), { area: 'gear', index: 3 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 3 }, 'ArrowDown', counts), { area: 'gear', index: 4 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 8 }, 'ArrowRight', counts), { area: 'gear', index: 8 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 0 }, 'ArrowUp', counts), { area: 'gear', index: 0 })
  })
  it('an empty sack keeps Up/Down between strip and a zero-index sack', () => {
    assert.deepEqual(moveSelection({ area: 'gear', index: 2 }, 'ArrowDown', { sack: 0, gear: 9 }), { area: 'sack', index: 0 })
  })
})
```

- [ ] **Step 2: Run to see failure**

Run: `node --test test/inventory-panel-model.test.js` → FAIL (module missing).

- [ ] **Step 3: Write the model**

`renderer/ui/inventory-panel-model.js`:
```js
// DOM-free model behind ui/inventory-panel.js: what the gear strip shows,
// which buttons a selection offers, and how the cursor moves between the
// strip and the sack grid. Rendering stays in inventory-panel.js.
import { STANCES, LOADOUT_NAMES, MAIN_OF, CONSUMABLE_KINDS, gearOf, loadoutAvailable, makeItem } from '../systems/inventory.js'

const HAND_EMOJI = { weapon: '⚔', ranged: '🏹', wand: '🪄', outfit: '🧥' }
export const GEAR_SLOTS = ['main', 'off', 'outfit']
export const SACK_COLS = 5

const asItem = (kind, payload) => payload ? { kind, name: payload.name, emoji: HAND_EMOJI[kind], payload } : null

function offTile(player, off) {
  if (!off) return null
  if (off.kind !== 'consumable') return off
  const slot = (player.inventory ?? []).find(i => i.kind === off.item)
  const proto = makeItem(off.item)
  return { kind: 'consumable', item: off.item, name: proto.name, emoji: proto.emoji, count: slot?.count ?? 0 }
}

export function gearStrip(player) {
  const active = player.attackMode ?? 'melee'
  return STANCES.map(stance => {
    const g = gearOf(player, stance)
    return {
      stance, name: LOADOUT_NAMES[stance], active: stance === active, locked: !loadoutAvailable(player, stance),
      tiles: [
        { slot: 'main', item: asItem(MAIN_OF[stance], player[MAIN_OF[stance]]) },
        { slot: 'off', item: offTile(player, g.off) },
        { slot: 'outfit', item: asItem('outfit', g.outfit) },
      ],
    }
  })
}

export function sackActions(player, item) {
  if (!item) return []
  const out = []
  if (!item.quest) {
    if (item.kind === 'weapon' || item.kind === 'ranged' || item.kind === 'wand') out.push({ label: 'Equip', fn: 'onEquip' })
    else if (item.kind === 'outfit') out.push({ label: 'Wear', fn: 'onEquip' })
    else if (item.kind === 'potion') out.push({ label: 'Drink', fn: 'onUse' })
    else if (item.kind === 'mushroom' || item.kind === 'meat' || item.kind === 'cooked_meat') out.push({ label: 'Eat', fn: 'onUse' })
    else if (item.kind === 'lumber' || item.kind === 'deadwood') out.push({ label: 'Build fire', fn: 'onBuild' })
    if (CONSUMABLE_KINDS.includes(item.kind)) out.push({ label: 'Offhand', fn: 'onEquipOff' })
  }
  out.push({ label: 'Drop', fn: 'onDrop' })
  return out
}

export function gearAction(player, stance, slot) {
  if (!loadoutAvailable(player, stance)) return null
  const g = gearOf(player, stance)
  if (slot === 'main') return player[MAIN_OF[stance]] ? { label: 'Unequip', fn: 'onUnequip' } : null
  if (slot === 'outfit') return g.outfit ? { label: 'Unequip', fn: 'onUnequip' } : null
  if (slot === 'off') return g.off ? { label: g.off.kind === 'consumable' ? 'Clear' : 'Unequip', fn: 'onUnequip' } : null
  return null
}

// Gear index = column * 3 + tile (columns in STANCES order).
export const gearAt = index => ({ stance: STANCES[Math.floor(index / 3)], slot: GEAR_SLOTS[index % 3] })

export function moveSelection(sel, key, counts, activeStance = 'melee') {
  const clampSack = i => Math.max(0, Math.min(Math.max(0, counts.sack - 1), i))
  if (sel.area === 'sack') {
    if (key === 'ArrowRight') return { area: 'sack', index: clampSack(sel.index + 1) }
    if (key === 'ArrowLeft') return { area: 'sack', index: clampSack(sel.index - 1) }
    if (key === 'ArrowDown') return { area: 'sack', index: clampSack(sel.index + SACK_COLS) }
    if (key === 'ArrowUp') {
      if (sel.index >= SACK_COLS) return { area: 'sack', index: sel.index - SACK_COLS }
      return { area: 'gear', index: STANCES.indexOf(activeStance) * 3 }
    }
    return sel
  }
  const col = Math.floor(sel.index / 3), tile = sel.index % 3
  if (key === 'ArrowRight') return { area: 'gear', index: Math.min(STANCES.length - 1, col + 1) * 3 + tile }
  if (key === 'ArrowLeft') return { area: 'gear', index: Math.max(0, col - 1) * 3 + tile }
  if (key === 'ArrowUp') return { area: 'gear', index: col * 3 + Math.max(0, tile - 1) }
  if (key === 'ArrowDown') return tile < 2 ? { area: 'gear', index: col * 3 + tile + 1 } : { area: 'sack', index: 0 }
  return sel
}
```

- [ ] **Step 4: Run the model tests**

Run: `node --test test/inventory-panel-model.test.js` → PASS. (The test's expected pointer tile in `gearStrip` test 2 lists keys in the order `kind, item, name, emoji, count` — `deepEqual` ignores order.)

- [ ] **Step 5: Render the strip in inventory-panel.js**

Rewrite the module around the model. Key points, full code:
```js
// Pause-overlay loot sack panel: a gear strip (three loadouts × main / off /
// outfit) above the sack grid. All mutations happen in game.js via handlers;
// what to show and where the cursor goes comes from inventory-panel-model.js.
import { canEquip, EQUIP_FAIL_MESSAGES } from '../systems/inventory.js'
import { gearStrip, sackActions, gearAction, gearAt, moveSelection, SACK_COLS } from './inventory-panel-model.js'
import { sfx } from '../systems/sfx.js'
import { iconSrcFor } from '../render/icons.js'

let keyHandler = null
let sel = { area: 'sack', index: 0 }
let lastState = null
let lastHandlers = null

const el = () => document.getElementById('inv-overlay')

function detailText(player, item) {
  if (!item) return ' '
  if (item.kind === 'consumable') return `${item.name} ×${item.count}`
  const stats = item.payload?.damage != null ? ` (${item.payload.damage} dmg)`
    : item.payload?.protect != null ? ` (protect ${item.payload.protect})` : ''
  const slot = item.kind === 'outfit' ? 'outfit' : 'main'
  const gate = (item.kind === 'weapon' || item.kind === 'ranged' || item.kind === 'wand' || item.kind === 'outfit') ? canEquip(player, item, slot) : { ok: true }
  const warn = gate.ok ? '' : ` — <span class="warn">${EQUIP_FAIL_MESSAGES[gate.reason]}</span>`
  return `${item.name}${stats}${warn}`
}

function iconHtml(item, cls = 'inv-icon') {
  if (!item) return ''
  const src = iconSrcFor(item.kind === 'consumable' ? { kind: item.item } : item)
  return src ? `<img class="${cls}" src="${src}" alt="${item.name}">` : (item.emoji ?? '')
}

function selectedItem(player) {
  if (sel.area === 'sack') return player.inventory[sel.index] ?? null
  const { stance, slot } = gearAt(sel.index)
  return gearStrip(player).find(c => c.stance === stance).tiles.find(t => t.slot === slot).item
}

export function refreshInventory(state) {
  if (!lastHandlers) return
  const { player } = state
  lastState = state
  if (sel.area === 'sack') sel.index = Math.min(sel.index, Math.max(0, player.inventory.length - 1))
  const root = el()
  root.innerHTML = ''
  const panel = document.createElement('div')
  panel.className = 'inv-panel'
  panel.innerHTML = `<div class="inv-title">PACK ${player.inventory.length}/${player.maxInventory}</div>`

  // Gear strip — one column per loadout. A locked column is greyed and inert:
  // no hint of how it opens (the world is the clue).
  const strip = document.createElement('div')
  strip.className = 'inv-strip'
  gearStrip(player).forEach((col, c) => {
    const colEl = document.createElement('div')
    colEl.className = 'inv-col' + (col.active ? ' active' : '') + (col.locked ? ' locked' : '')
    colEl.innerHTML = `<div class="inv-col-name">${col.name}</div>`
    col.tiles.forEach((t, i) => {
      const idx = c * 3 + i
      const tile = document.createElement('div')
      tile.className = 'inv-tile' + (sel.area === 'gear' && sel.index === idx ? ' selected' : '')
      tile.dataset.slot = t.slot
      tile.innerHTML = iconHtml(t.item) + (t.item?.kind === 'consumable' ? `<span class="inv-count">×${t.item.count}</span>` : '')
      if (!col.locked) tile.addEventListener('click', () => { sel = { area: 'gear', index: idx }; refreshInventory(lastState) })
      colEl.appendChild(tile)
    })
    strip.appendChild(colEl)
  })
  panel.appendChild(strip)

  const grid = document.createElement('div')
  grid.className = 'inv-grid'
  for (let i = 0; i < player.maxInventory; i++) {
    const slot = document.createElement('div')
    slot.className = 'inv-slot' + (sel.area === 'sack' && i === sel.index ? ' selected' : '')
    const item = player.inventory[i]
    if (item) {
      slot.innerHTML = iconHtml(item)
      if (item.stackable && item.count > 1) {
        const cnt = document.createElement('span'); cnt.className = 'inv-count'; cnt.textContent = `×${item.count}`
        slot.appendChild(cnt)
      }
      slot.addEventListener('click', () => { sel = { area: 'sack', index: i }; refreshInventory(lastState) })
    }
    grid.appendChild(slot)
  }
  panel.appendChild(grid)

  const detail = document.createElement('div')
  detail.className = 'inv-detail'
  detail.innerHTML = detailText(player, selectedItem(player))
  panel.appendChild(detail)

  const actions = document.createElement('div')
  actions.className = 'inv-actions'
  for (const a of currentActions(player)) {
    const b = document.createElement('button')
    b.textContent = a.label
    b.addEventListener('click', () => fire(a))
    actions.appendChild(b)
  }
  const close = document.createElement('button')
  close.textContent = 'Close (I)'
  close.addEventListener('click', () => lastHandlers.onClose())
  actions.appendChild(close)
  panel.appendChild(actions)
  root.appendChild(panel)
  root.style.display = 'flex'
}

function currentActions(player) {
  if (sel.area === 'sack') return sackActions(player, player.inventory[sel.index])
  const { stance, slot } = gearAt(sel.index)
  const a = gearAction(player, stance, slot)
  return a ? [a] : []
}

function fire(action) {
  if (sel.area === 'sack') lastHandlers[action.fn](sel.index)
  else { const { stance, slot } = gearAt(sel.index); lastHandlers[action.fn](stance, slot) }
}

export function showInventory(state, handlers) {
  lastHandlers = handlers
  sel = { area: 'sack', index: 0 }
  refreshInventory(state)
  keyHandler = (e) => {
    const key = ({ d: 'ArrowRight', a: 'ArrowLeft', s: 'ArrowDown', w: 'ArrowUp' })[e.key] ?? e.key
    const player = state.player
    if (key.startsWith('Arrow')) {
      const next = moveSelection(sel, key, { sack: player.inventory.length, gear: 9 }, player.attackMode ?? 'melee')
      if (next.area !== sel.area || next.index !== sel.index) sfx(lastState, 'ui-move')
      sel = next
    } else if (key === 'Enter' || key === ' ') {
      const [first] = currentActions(player)
      if (first && first.fn !== 'onDrop') fire(first)
    } else if (key === 'x' || key === 'X') {
      if (sel.area === 'sack' && player.inventory[sel.index]) lastHandlers.onDrop(sel.index)
    } else return
    e.preventDefault(); e.stopPropagation()
    refreshInventory(state)
  }
  window.addEventListener('keydown', keyHandler, true)
}

export function hideInventory() {
  if (keyHandler) { window.removeEventListener('keydown', keyHandler, true); keyHandler = null }
  lastHandlers = null
  const root = el()
  root.style.display = 'none'
  root.innerHTML = ''
}
```
Keep `SACK_COLS` in sync: the model uses 5 and the CSS grid is `repeat(5, 52px)`.

- [ ] **Step 6: CSS**

Replace the `.inv-hands` and `.inv-hand` rules (and the `.inv-hand .inv-icon` rule) in `renderer/index.html` with:
```css
    .inv-strip { display: flex; gap: 10px; margin-bottom: 10px; }
    .inv-col { display: flex; flex-direction: column; gap: 4px; padding: 6px; border: 1px solid #3a3a44; }
    .inv-col.active { border-color: #f6ad55; }
    .inv-col.locked { opacity: 0.35; filter: grayscale(1); }
    .inv-col-name { color: #f6ad55; font-size: 12px; letter-spacing: 1px; text-align: center; }
    .inv-tile { width: 44px; height: 44px; border: 1px solid #3a3a44; background: #14141a; position: relative;
      display: flex; align-items: center; justify-content: center; font-size: 18px; cursor: pointer; }
    .inv-tile.selected { border-color: #e8b84b; background: #2a2a36; }
    .inv-tile .inv-icon { width: 32px; height: 32px; }
```

- [ ] **Step 7: game.js handlers**

Replace the `showInventory(state, {...})` call in `openInventory`:
```js
  const report = r => { if (!r.ok) think(state, EQUIP_FAIL_MESSAGES[r.reason] ?? "Can't equip that."); else sfx(state, 'equip'); afterInventoryChange() }
  showInventory(state, {
    onEquip: i => report(state.player.inventory[i]?.kind === 'outfit' ? equipOutfit(state.player, i) : equipItem(state.player, i)),
    onEquipOff: i => report(equipOffhand(state.player, i)),
    onUnequip: (stance, slot) => report(
      slot === 'main' ? unequipMain(state.player, stance)
      : slot === 'outfit' ? unequipOutfit(state.player, stance)
      : unequipOffhand(state.player, stance)),
    onUse: i => useInventoryItem(i),
    onDrop: i => dropInventoryItem(i),
    onBuild: slot => buildCampfire(state.player.inventory[slot]?.kind ?? 'lumber'),
    onClose: closeInventory,
  })
```

- [ ] **Step 8: Live check (time-boxed, ≤ 5 minutes)**

```bash
cd ~/projects/dungeon-crawler && DISPLAY=:0 npx electron . --dcdebug
```
In the running game: type `level7`, press `I`. Expect the strip with Warrior active and Archer/Mage greyed; the Warrior's offhand tile shows the potion at ×0 or the starting count. Arrow Up from the grid enters the strip; Enter on the main tile unequips the dagger into the sack; Enter on the sack dagger equips it back. Close, press Q with no potions: "Nothing left" reads `None left.`. Then type `mauno` (cheat) and confirm nothing throws. Do not click the editor Build tab. If a playwright driver is preferred, follow `~/.claude/.../verify-editor-with-playwright.md`'s recipe and stop at the first passing screenshot.

- [ ] **Step 9: Run the whole suite and commit**

Run: `npm test` → all PASS (a lone SIGSEGV is the WSL runner flake; re-run once).
```bash
git add renderer/ui/inventory-panel-model.js renderer/ui/inventory-panel.js renderer/index.html renderer/game.js test/inventory-panel-model.test.js
git commit -m "feat: pause panel gear strip — three loadouts, equip/unequip, offhand pointers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs and hand-off

**Files:**
- Modify: `~/CLAUDE.md` (dungeon-crawler `renderer/systems/` bullet: `talents` and `inventory` entries), `docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md` §7 (migration lives in `systems/outfits.js`), `.claude/skills/arena-test/JOURNAL.md` if it documents arena `talents` pre-grants (add a line: `talents: ['magic_stance']` in an arena config now wears the robe; `outfits: ['robe']` is the direct form).

- [ ] **Step 1: CLAUDE.md**

In the `renderer/systems/` bullet, change the `talents` entry to: ``talents` (learned non-gear abilities — Ski-legs today — via one idempotent `grantTalent`; the former stance/Might talents are **outfits** since 2026-09-17: `systems/outfits.js` owns their sources — Ranger's Coat from the first Clearings dungeon, Mage's Robe from the mushroom rite, Plated Armor from the cyclops — the `talents → outfits` save migration (v8) and the pickup toast)`` and the `inventory` entry to mention: three **loadouts** (Warrior/Archer/Mage = `player.attackMode`) whose main hands stay at `player.weapon/ranged/wand` while `player.gear[stance] = { off, outfit }` holds the rest and `player.belt` the shared tool; `loadoutAvailable` (outfit worn) replaces the stance talents in every gate, `canWieldHeavy` (plate) replaces Might; the offhand holds a **consumable pointer** `{ kind:'consumable', item }` at the sack stack and Q/green button uses it (quick-use from the sack is gone); spec `docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md`, plans 2–3 add shields/wands/blades and the belt.

- [ ] **Step 2: Spec touch-up**

In §7 replace "`migrateTalentsToOutfits(player)` in `systems/inventory.js`" with "`migrateTalentsToOutfits(body, talents)` in `systems/outfits.js`". In §3 note that there is no editor dropdown for rites (triggers are spawned from `data/rites.js` POIs), so only the data field renames.

- [ ] **Step 3: Commit and open the PR**

```bash
git add ~/CLAUDE.md docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md .claude/skills/arena-test/JOURNAL.md
git commit -m "docs: loadouts and outfits — CLAUDE.md, spec touch-ups

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin loadouts-and-offhand
gh pr create --title "Loadouts and outfits (inventory rework, plan 1/3)" --body "$(cat <<'EOF'
## Summary
- Three loadouts of one body (Warrior / Archer / Mage): main hands unchanged, per-loadout `gear[stance] = { off, outfit }`, shared `belt` (data only for now).
- The stance talents and Might are retired; the Ranger's Coat, Mage's Robe and Plated Armor are self-equipping items dropped by the first Clearings dungeon, the mushroom rite and the cyclops. Save v8 migrates old talents into worn outfits.
- Q / the green button now uses the active offhand, which in this plan is a pointer at a consumable stack shared by all loadouts. HUD slot renamed to offhand.
- Pause panel gains a gear strip with equip / unequip / offhand pointers.

Spec: docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md — plan 1 of 3 (plans 2–3: shield / offhand wand / dual blades; belt / loot).

## Test plan
- [ ] `npm test` green
- [ ] level7: strip renders, Archer/Mage greyed, unequip/equip round-trips
- [ ] Old adventure save with talents loads wearing the outfits (Shift cycles as before)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

- **Spec coverage (plan 1 scope):** §1 data model → Tasks 1, 5, 6. §2 outfit table + item conversion → Task 1; sprites → Task 7 (icons aliased; shields deferred to plan 2). §3 gates, sources, self-equip, toast, rite → Tasks 2, 3, 4, 6. §4 consumable pointer, Q, HUD → Tasks 3, 6, 7 (shield/wand/blade/two-handed → plan 2). §7 saves → Tasks 5, 6. §8 panel → Task 8 (belt tile → plan 3, since belt equip lands there). §9 tests → each task. §5 (protect, sprint drain, belt fallback) and §6 (loot) → plans 2–3 by the spec's own delivery order.
- **Type consistency:** `resolveOffhand` returns `{ kind, item, count, index, slot }` everywhere (Tasks 1, 6, 7); the panel model's pointer tile is a different shape (`{ kind:'consumable', item, name, emoji, count }`) by design and is only consumed inside the panel. `equipOutfit(player, index, stance?)`, `unequipOutfit(player, stance)`, `unequipMain(player, stance)`, `equipOffhand(player, index, stance?)`, `unequipOffhand(player, stance?)` match between Task 3, Task 6 and Task 8. `wearOutfit(player, payload, stance?)` takes a payload (no `type`), as Tasks 2 and 6 use it.
- **Ordering hazard:** Tasks 3–7 leave `game.js`/`hud.js` importing removed names between commits; the branch is only expected green from Task 7 onward, and the plan says so in Task 3.
