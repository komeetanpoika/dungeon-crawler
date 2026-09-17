# Offhand Behaviours Implementation Plan (plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the offhand do things: a shield that blocks while Q is held, a second wand that casts on Q, a second small blade that alternates swings, the two-handed rule that keeps heavy weapons and bows from sharing a body with them, and the outfits' `protect` and `sprintDrain` in play.

**Architecture:** The offhand stores an item as `{ kind:'weapon'|'wand'|'shield', ...payload }` beside the plan-1 consumable pointer; `inventory.js` grows the per-loadout legality table and the two-handed eviction, a new pure `systems/shield.js` owns raising, the block arc and the stamina price, and `damagePlayer` gains a `from` position so every positioned hit can be blocked and armour-reduced in one funnel. Alternation and the offhand cooldown are small pure helpers in `melee.js` and `spells.js`; game.js only routes keys and picks the swinging hand. Rendering follows: the HUD offhand slot, the idle two-hand draw, the swing sprite, the panel's actions and detail line.

**Tech Stack:** Vanilla ES modules, Electron renderer, `node:test` + `node:assert/strict`. Run one file with `node --test test/<file>.test.js`, the suite with `npm test` (green at 2421 tests on `main`).

**Spec:** `docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md` — §2 (shields, small blades), §4 (offhand legality, the offhand key, shield / wand / blade, HUD), §5 (protect, sprint drain), §7 (item offhands must persist), §8 (panel detail line and Offhand button). Plan 1 (`2026-09-17-loadouts-and-outfits.md`, merged as PR #52) built the loadouts, outfits and the consumable pointer this plan extends. The belt in play and loot are plan 3.

## Global Constraints

- Pure systems modules under `renderer/systems/` import nothing from `game.js` or the DOM; no import cycles (`shield.js` → `inventory.js`/`stamina.js`/`sfx.js`/`entities.js`; `player-damage.js` → `shield.js`; nothing the other way).
- Every new weaponType gets a `SPRITES['weapon_<key>']` entry pointing at an existing PNG (`test/sprites.test.js`); every new sound cue gets a `RECIPES` entry (`test/audio.test.js`).
- Refusal reasons stay `{ ok:false, reason }` with an `EQUIP_FAIL_MESSAGES` entry; `two_handed: 'I need both hands for that.'` already exists.
- Exact values (spec §2/§4/§5): `SHIELD_TYPES = { buckler: { name:'Buckler', blockCost:8 }, kite: { name:'Kite Shield', blockCost:4, heavy:true } }`; a small blade is a `WEAPON_TYPES` row with no `heavy` and `damage <= 2`; the block arc is 60° either side of the facing; `SHIELD_DROP = 0.8` s; blocking walk speed × 0.5; a blocked melee enemy is shoved 12 px; the offhand swing's cooldown × 0.75; offhand wand casts are tap-tier only with their own cooldown `player.offCooldown`; `protect` is subtracted from `'hit'` damage, floored at 0; `sprintDrain` multiplies the sprint drain (plate: 2) and composes with Ski-legs.
- Controller ruling carried from plan 1: `protect` applies to kind `'hit'` only — `'dot'` (fire, bramble) and `'lightning'` (the hero's own chain) are untouched, or a protect of 2 would nullify every burn.
- Offhand legality: Warrior `weapon` (small) / `shield` / consumable; Archer consumable only; Mage `wand` / `weapon` (small) / `shield` / consumable. A heavy main hand narrows the offhand to consumables. The kite shield's `heavy` needs `canWieldHeavy`.
- No spoilers, no new controls: Q is the only offhand input; a blade needs no key.
- Commit after every task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` as the last line. Work on branch `offhand-behaviours` off `main`.

---

## File map

| File | Responsibility in this plan |
|---|---|
| `renderer/systems/entities.js` | `SHIELD_TYPES`, `makeShieldContents`, `isSmallBlade` |
| `renderer/systems/inventory.js` | shield item conversion, `offhandItem`, `OFFHAND_KINDS`, `canEquipOffhand(player, item, stance)`, item offhands in `equipOffhand`/`unequipOffhand`, two-handed eviction in `equipItem`, heavy-offhand eviction on plate removal |
| `renderer/systems/adventure.js` | `normalizeBody` rebuilds item offhands from the tables |
| `renderer/systems/shield.js` (new) | `SHIELD_DROP`, `BLOCK_HALF_ARC`, `BLOCK_SPEED_MUL`, `BLOCK_SHOVE`, `heldShield`, `tickShield`, `inBlockArc`, `tryBlock` |
| `renderer/systems/player-damage.js` | `damagePlayer(state, amount, kind, from)` — block, then protect, then hp |
| `renderer/systems/stamina.js` | `sprintProfile(mode, { skiLegs, drainMul })` |
| `renderer/systems/enemy-attack.js`, `projectiles.js`, `cyclops.js`, `dragonboss.js`, `monsters/nakki.js`, `monsters/kivihiisi.js`, `monsters/podeboo.js` | pass `from` positions; the melee strike treats a block as a spent swing plus a shove |
| `renderer/systems/spells.js` | `spellFor(player, hand)`, `tryCast(..., { modules, hand })` with `offCooldown` |
| `renderer/systems/melee.js` | `OFFHAND_COOLDOWN_MUL`, `swingHand`, `nextHandAfter` |
| `renderer/systems/sfx.js`, `renderer/render/audio.js` | `shield-block` cue + recipe |
| `renderer/game.js` | blocking per frame, speed/sprint/attack gating, Q dispatch by offhand kind, offhand cast, `offCooldown` tick, sprint drain from the outfit, the swing closure parametrised by hand, `applyLoadout` `offhand` for arena/episode kits |
| `renderer/render/canvas.js` | idle draw of the offhand item (mirrored; raised shield), `drawMeleeSwing` by swing hand |
| `renderer/render/hud.js`, `renderer/render/sprites.js`, `renderer/render/icons.js` | offhand slot for shield/wand/blade with dim rules; shield sprites and icon fallback |
| `renderer/ui/inventory-panel-model.js`, `renderer/ui/inventory-panel.js` | Offhand button for legal items, `Unequip` for item offhands, detail line with block cost / spell |
| Tests | `test/offhand.test.js` (new), `test/shield.test.js` (new), `test/player-damage.test.js`, `test/enemy-attack.test.js`, `test/projectiles.test.js`, `test/spells.test.js`, `test/melee.test.js`, `test/stamina.test.js`, `test/adventure.test.js`, `test/hud.test.js`, `test/canvas.test.js`, `test/sprites.test.js`, `test/audio.test.js`, `test/inventory-panel-model.test.js` |

---

### Task 1: Shield table, small-blade predicate, item conversion, sprites

**Files:**
- Modify: `renderer/systems/entities.js` (after `makeWandContents`), `renderer/systems/inventory.js` (imports, `HAND_EMOJI`, `REBUILD`, `contentsFromItem`; new `offhandItem` after `outfitItem`), `renderer/render/sprites.js` (after `weapon_blinkwand`), `renderer/render/icons.js` (`WEAPON_FALLBACK`, the kind test in `iconSpriteFor`)
- Test: `test/offhand.test.js` (new), `test/sprites.test.js:127-130`

**Interfaces:**
- Produces (entities.js): `SHIELD_TYPES`; `makeShieldContents(weaponType = 'buckler') → { type:'shield', weaponType, name, blockCost, heavy? }`; `isSmallBlade(weaponType) → boolean`.
- Produces (inventory.js): `itemFromContents({ type:'shield', weaponType })` → `{ kind:'shield', name, emoji:'🛡', stackable:false, payload }`; `contentsFromItem` round-trips it; `offhandItem(off) → sack item | null` (null for a pointer or empty offhand; `{ kind, name, emoji, stackable:false, payload }` for an item offhand stored as `{ kind, ...payload }`).
- Produces (sprites/icons): `SPRITES.weapon_buckler = 'tile_0102'`, `SPRITES.weapon_kite = 'tile_0101'`; `iconSpriteFor({ kind:'shield', payload:{ weaponType } })` → `weapon_<type>`, fallback `weapon_buckler`.

- [ ] **Step 1: Write the failing tests**

`test/offhand.test.js`:
```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SHIELD_TYPES, makeShieldContents, isSmallBlade, WEAPON_TYPES, weaponContents, makeWandContents } from '../renderer/systems/entities.js'
import { itemFromContents, contentsFromItem, offhandItem } from '../renderer/systems/inventory.js'
import { iconSpriteFor } from '../renderer/render/icons.js'

describe('shield table', () => {
  it('has the buckler and the heavy kite shield', () => {
    assert.deepEqual(SHIELD_TYPES, { buckler: { name: 'Buckler', blockCost: 8 }, kite: { name: 'Kite Shield', blockCost: 4, heavy: true } })
    assert.deepEqual(makeShieldContents('kite'), { type: 'shield', weaponType: 'kite', name: 'Kite Shield', blockCost: 4, heavy: true })
    assert.deepEqual(makeShieldContents('buckler'), { type: 'shield', weaponType: 'buckler', name: 'Buckler', blockCost: 8 })
  })
  it('round-trips through the sack and drops unknown types', () => {
    const item = itemFromContents(makeShieldContents('buckler'))
    assert.equal(item.kind, 'shield')
    assert.equal(item.emoji, '🛡')
    assert.deepEqual(contentsFromItem(item), makeShieldContents('buckler'))
    assert.equal(itemFromContents({ type: 'shield', weaponType: 'tower' }), null)
  })
  it('has an icon per shield', () => {
    assert.equal(iconSpriteFor({ kind: 'shield', payload: { weaponType: 'kite' } }), 'weapon_kite')
    assert.equal(iconSpriteFor({ kind: 'shield', payload: { weaponType: 'tower' } }), 'weapon_buckler')
  })
})

describe('isSmallBlade', () => {
  it('is a light melee row with damage 2 or less', () => {
    assert.deepEqual(Object.keys(WEAPON_TYPES).filter(isSmallBlade).sort(), ['dagger', 'hatchet', 'pick', 'sword'])
    assert.equal(isSmallBlade('longsword'), false)
    assert.equal(isSmallBlade('maunonmiekka'), false)
    assert.equal(isSmallBlade('spork'), false)
  })
})

describe('offhandItem', () => {
  it('turns an item offhand back into a sack item, and nothing else', () => {
    const { type, ...dagger } = { type: 'weapon', ...weaponContents('dagger') }
    assert.deepEqual(offhandItem({ kind: 'weapon', ...dagger }), { kind: 'weapon', name: 'Dagger', emoji: '⚔', stackable: false, payload: dagger })
    const { type: t2, ...wand } = makeWandContents('frostwand')
    assert.equal(offhandItem({ kind: 'wand', ...wand }).payload.spell, 'rime')
    assert.equal(offhandItem({ kind: 'shield', weaponType: 'kite', name: 'Kite Shield', blockCost: 4, heavy: true }).payload.blockCost, 4)
    assert.equal(offhandItem({ kind: 'consumable', item: 'potion' }), null)
    assert.equal(offhandItem(null), null)
  })
})
```
`test/sprites.test.js` line 127: extend the table check to `[...Object.keys(WEAPON_TYPES), ...Object.keys(RANGED_WEAPON_TYPES), ...Object.keys(SHIELD_TYPES)]` (import `SHIELD_TYPES`).

- [ ] **Step 2: Run to see failure**

Run: `node --test test/offhand.test.js test/sprites.test.js` → FAIL (`SHIELD_TYPES` not exported).

- [ ] **Step 3: entities.js**

After `makeWandContents`:
```js
// Shields — offhand only (inventory.js canEquipOffhand). Raised by holding Q
// (systems/shield.js); `blockCost` is the stamina each absorbed hit costs.
// The kite shield is heavy: it rides on the plate like a heavy blade does.
export const SHIELD_TYPES = {
  buckler: { name: 'Buckler',     blockCost: 8 },
  kite:    { name: 'Kite Shield', blockCost: 4, heavy: true },
}

export function makeShieldContents(weaponType = 'buckler') {
  const wt = SHIELD_TYPES[weaponType] ? weaponType : 'buckler'
  const def = SHIELD_TYPES[wt]
  return { type: 'shield', weaponType: wt, name: def.name, blockCost: def.blockCost, ...(def.heavy && { heavy: true }) }
}

// What fits in the offhand beside a main weapon: a light blade, damage 2 or
// less and never heavy. Derived from the table so a new dagger needs no list.
export const isSmallBlade = weaponType => {
  const d = WEAPON_TYPES[weaponType]
  return !!d && !d.heavy && d.damage <= 2
}
```

- [ ] **Step 4: inventory.js**

Import `SHIELD_TYPES, makeShieldContents` from `./entities.js`. `HAND_EMOJI` gains `shield: '🛡'`. `REBUILD` gains `shield: [SHIELD_TYPES, makeShieldContents]` (the existing key logic — `outfitType` for outfits, `weaponType` otherwise — already covers it). In `contentsFromItem` add `'shield'` to the `weapon || wand || outfit` line. After `outfitItem`:
```js
// An item offhand ({ kind:'weapon'|'wand'|'shield', ...payload }) back into a
// sack item; a consumable pointer or an empty offhand is not an item.
export function offhandItem(off) {
  if (!off || off.kind === 'consumable') return null
  const { kind, ...payload } = off
  return { kind, name: payload.name, emoji: HAND_EMOJI[kind], stackable: false, payload }
}
```

- [ ] **Step 5: sprites.js and icons.js**

After `weapon_blinkwand` in `SPRITES`:
```js
  // Shields (offhand only): the round buckler and the tall kite shield.
  weapon_buckler: 'tile_0102',
  weapon_kite:    'tile_0101',
```
icons.js: `WEAPON_FALLBACK` gains `shield: 'weapon_buckler'`; the kind test in `iconSpriteFor` becomes `if (item.kind === 'weapon' || item.kind === 'ranged' || item.kind === 'wand' || item.kind === 'shield')`.

- [ ] **Step 6: Run**

Run: `node --test test/offhand.test.js test/sprites.test.js test/icons.test.js test/inventory.test.js test/equip-slots.test.js` → PASS.

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/entities.js renderer/systems/inventory.js renderer/render/sprites.js renderer/render/icons.js test/offhand.test.js test/sprites.test.js
git commit -m "feat: shield table, small-blade predicate, offhand item conversion

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Offhand legality, item offhands, the two-handed rule

**Files:**
- Modify: `renderer/systems/inventory.js` (`canEquipOffhand`, `equipItem`, `handsToEvict`/`equipOutfit`/`unequipOutfit`, `equipOffhand`, `unequipOffhand`)
- Test: `test/offhand.test.js` (append), `test/equip-slots.test.js` (one test title changes)

**Interfaces:**
- `OFFHAND_KINDS = { melee: ['weapon','shield'], ranged: [], magic: ['wand','weapon','shield'] }` (exported).
- `canEquipOffhand(player, item, stance = player.attackMode ?? 'melee') → { ok, reason? }`: consumables always ok; otherwise the kind must be in `OFFHAND_KINDS[stance]`, the loadout open (`not_learned`), a weapon must be a small blade (`two_handed`), a heavy item needs `canWieldHeavy` (`heavy`), and a heavy main hand in that loadout refuses (`two_handed`).
- `equipOffhand(player, index, stance?)`: a consumable sets the pointer as before; an item moves out of the sack and a previously held item offhand swaps back in (a pointer is simply replaced).
- `unequipOffhand(player, stance?)`: an item goes back to the sack (`full` if no room); a pointer clears.
- `equipItem` of a heavy melee weapon evicts a non-consumable Warrior offhand to the sack first, refusing with `two_handed` when the sack cannot take it.
- Removing or swapping away the plate also evicts a heavy offhand (kite shield).
- `canEquip(player, item, 'off')` delegates to `canEquipOffhand` with the active stance (unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `test/offhand.test.js`:
```js
import {
  addItem, canEquip, canEquipOffhand, equipItem, equipOffhand, unequipOffhand, equipOutfit, unequipOutfit,
  makeItem, OFFHAND_KINDS, resolveOffhand,
} from '../renderer/systems/inventory.js'
import { makePlayer, makeOutfitContents } from '../renderer/systems/entities.js'
import { gearWearing } from './helpers/outfits.js'

const mk = (over = {}) => ({ ...makePlayer(1, 1), ...over })
const weapon = wt => itemFromContents({ type: 'weapon', ...weaponContents(wt) })
const shield = st => itemFromContents(makeShieldContents(st))
const wand = wt => itemFromContents(makeWandContents(wt))

describe('offhand legality', () => {
  it('Warrior: small blade, shield, consumable; never a wand', () => {
    const p = mk()
    assert.equal(canEquipOffhand(p, weapon('dagger')).ok, true)
    assert.equal(canEquipOffhand(p, shield('buckler')).ok, true)
    assert.equal(canEquipOffhand(p, makeItem('potion')).ok, true)
    assert.deepEqual(canEquipOffhand(p, wand('sparkwand')), { ok: false, reason: 'not_equippable' })
    assert.deepEqual(OFFHAND_KINDS.melee, ['weapon', 'shield'])
  })
  it('Archer: consumable only', () => {
    const p = mk({ gear: gearWearing('ranger'), attackMode: 'ranged' })
    assert.deepEqual(canEquipOffhand(p, weapon('dagger'), 'ranged'), { ok: false, reason: 'not_equippable' })
    assert.deepEqual(canEquipOffhand(p, shield('buckler'), 'ranged'), { ok: false, reason: 'not_equippable' })
    assert.equal(canEquipOffhand(p, makeItem('potion'), 'ranged').ok, true)
  })
  it('Mage: wand, small blade, shield, consumable', () => {
    const p = mk({ gear: gearWearing('robe'), attackMode: 'magic' })
    for (const item of [wand('frostwand'), weapon('dagger'), shield('buckler'), makeItem('mushroom')])
      assert.equal(canEquipOffhand(p, item, 'magic').ok, true, item.kind)
  })
  it('a closed loadout refuses items but not a pointer', () => {
    const p = mk()
    assert.deepEqual(canEquipOffhand(p, wand('frostwand'), 'magic'), { ok: false, reason: 'not_learned' })
    assert.equal(canEquipOffhand(p, makeItem('potion'), 'magic').ok, true)
  })
  it('a big blade is two-handed; the kite shield needs the plate', () => {
    const p = mk()
    assert.deepEqual(canEquipOffhand(p, weapon('longsword')), { ok: false, reason: 'two_handed' })
    assert.deepEqual(canEquipOffhand(p, shield('kite')), { ok: false, reason: 'heavy' })
    assert.equal(canEquipOffhand(mk({ gear: gearWearing('plate') }), shield('kite')).ok, true)
  })
  it('a heavy main hand narrows the offhand to consumables', () => {
    const p = mk({ gear: gearWearing('plate'), weapon: weaponContents('axe') })
    assert.deepEqual(canEquipOffhand(p, weapon('dagger')), { ok: false, reason: 'two_handed' })
    assert.deepEqual(canEquip(p, shield('buckler'), 'off'), { ok: false, reason: 'two_handed' })
    assert.equal(canEquipOffhand(p, makeItem('potion')).ok, true)
  })
})

describe('item offhands', () => {
  it('a dagger moves from the sack into the offhand and back', () => {
    const p = mk()
    addItem(p, weapon('dagger'))
    assert.equal(equipOffhand(p, 0).ok, true)
    assert.equal(p.inventory.length, 0)
    assert.equal(p.gear.melee.off.kind, 'weapon')
    assert.equal(p.gear.melee.off.weaponType, 'dagger')
    assert.equal(resolveOffhand(p).weaponType, 'dagger')
    assert.equal(unequipOffhand(p).ok, true)
    assert.equal(p.gear.melee.off, null)
    assert.equal(p.inventory[0].payload.weaponType, 'dagger')
  })
  it('a held item swaps back into the sack; a pointer is just replaced', () => {
    const p = mk()                                   // offhand = potion pointer
    addItem(p, shield('buckler'))
    equipOffhand(p, 0)
    assert.equal(p.gear.melee.off.kind, 'shield')
    assert.equal(p.inventory.length, 0)              // the pointer left nothing behind
    addItem(p, weapon('hatchet'))
    equipOffhand(p, 0)
    assert.equal(p.gear.melee.off.weaponType, 'hatchet')
    assert.equal(p.inventory[0].kind, 'shield')
  })
  it('pointing at a consumable over a held shield sends the shield to the sack', () => {
    const p = mk()
    addItem(p, shield('buckler')); equipOffhand(p, 0)
    addItem(p, makeItem('potion', 2))
    assert.equal(equipOffhand(p, 0).ok, true)
    assert.deepEqual(p.gear.melee.off, { kind: 'consumable', item: 'potion' })
    assert.deepEqual(p.inventory.map(i => i.kind).sort(), ['potion', 'shield'])
  })
  it('unequipping an item offhand refuses when the sack is full; a pointer always clears', () => {
    const p = mk({ maxInventory: 0 })
    p.gear.melee.off = { kind: 'shield', ...(({ type, ...s }) => s)(makeShieldContents('buckler')) }
    assert.deepEqual(unequipOffhand(p), { ok: false, reason: 'full' })
    assert.equal(p.gear.melee.off.kind, 'shield')
    p.gear.melee.off = { kind: 'consumable', item: 'potion' }
    assert.equal(unequipOffhand(p).ok, true)
  })
})

describe('the two-handed rule on the main hand', () => {
  it('equipping an axe sends the offhand dagger back to the sack', () => {
    const p = mk({ gear: gearWearing('plate') })
    addItem(p, weapon('dagger')); equipOffhand(p, 0)
    addItem(p, weapon('axe'))
    assert.equal(equipItem(p, 0).ok, true)
    assert.equal(p.weapon.weaponType, 'axe')
    assert.equal(p.gear.melee.off, null)
    assert.deepEqual(p.inventory.map(i => i.payload.weaponType), ['dagger'])
  })
  it('refuses with two_handed when the evicted offhand has nowhere to go', () => {
    const p = mk({ gear: gearWearing('plate'), weapon: weaponContents('sword'), maxInventory: 1 })
    addItem(p, weapon('dagger')); equipOffhand(p, 0)
    addItem(p, weapon('axe'))                      // sack 1/1; the sword would need a slot and so would the dagger
    assert.deepEqual(equipItem(p, 0), { ok: false, reason: 'two_handed' })
    assert.equal(p.weapon.weaponType, 'sword')
    assert.equal(p.gear.melee.off.weaponType, 'dagger')
  })
  it('a consumable pointer survives a heavy main hand', () => {
    const p = mk({ gear: gearWearing('plate') })
    addItem(p, weapon('axe'))
    equipItem(p, 0)
    assert.deepEqual(p.gear.melee.off, { kind: 'consumable', item: 'potion' })
  })
  it('taking the plate off evicts the kite shield with the axe', () => {
    const p = mk({ gear: gearWearing('plate'), weapon: weaponContents('axe') })
    p.gear.melee.off = { kind: 'shield', ...(({ type, ...s }) => s)(makeShieldContents('kite')) }
    assert.equal(unequipOutfit(p, 'melee').ok, true)
    assert.equal(p.gear.melee.off, null)
    assert.deepEqual(p.inventory.map(i => i.kind).sort(), ['outfit', 'shield', 'weapon'])
    const q = mk({ gear: gearWearing('plate'), maxInventory: 1 })
    q.gear.melee.off = { kind: 'shield', ...(({ type, ...s }) => s)(makeShieldContents('kite')) }
    assert.deepEqual(unequipOutfit(q, 'melee'), { ok: false, reason: 'full' })
  })
})
```
In `test/equip-slots.test.js`, the test titled `'a weapon is not an offhand item yet (plan 2)'` now contradicts the rule: change it to assert a **longsword** is `two_handed` for the offhand and a dagger is ok (rename to `'a big blade is two-handed for the offhand; a small one fits'`).

- [ ] **Step 2: Run to see failure**

Run: `node --test test/offhand.test.js test/equip-slots.test.js` → FAIL (`OFFHAND_KINDS` not exported; dagger refused).

- [ ] **Step 3: inventory.js**

Import `isSmallBlade` from `./entities.js`. Replace `canEquipOffhand`:
```js
// Which item kinds each loadout's offhand takes beside a consumable pointer.
// The Archer's bows are two-handed, so only a belt potion rides with them.
export const OFFHAND_KINDS = { melee: ['weapon', 'shield'], ranged: [], magic: ['wand', 'weapon', 'shield'] }

export function canEquipOffhand(player, item, stance = player.attackMode ?? 'melee') {
  if (!item) return { ok: false, reason: 'not_equippable' }
  if (CONSUMABLE_KINDS.includes(item.kind)) return { ok: true }
  if (!(OFFHAND_KINDS[stance] ?? []).includes(item.kind)) return { ok: false, reason: 'not_equippable' }
  if (!loadoutAvailable(player, stance)) return { ok: false, reason: 'not_learned' }
  if (item.kind === 'weapon' && !isSmallBlade(item.payload.weaponType)) return { ok: false, reason: 'two_handed' }
  if (item.payload.heavy && !canWieldHeavy(player)) return { ok: false, reason: 'heavy' }
  // A heavy main hand needs both hands: only a consumable rides with it.
  if (player[MAIN_OF[stance]]?.heavy) return { ok: false, reason: 'two_handed' }
  return { ok: true }
}
```
`canEquip`'s `'off'` branch stays `return canEquipOffhand(player, item)`.

In `equipItem`, after the gate and before mutating:
```js
  const hand = HAND_OF_KIND[item.kind]
  const held = player[hand]
  // A heavy blade needs both hands: an item in the Warrior's offhand goes back
  // to the sack first (a consumable pointer stays — it is only a pointer).
  const evictOff = hand === 'weapon' && item.payload.heavy ? offhandItem(gearOf(player, 'melee').off) : null
  if (evictOff && !roomFor(player, (held ? 1 : 0) + 1 - 1)) return { ok: false, reason: 'two_handed' }
  player[hand] = { ...item.payload }
  player.inventory.splice(index, 1)
  if (held) player.inventory.push(handItem(hand, held))
  if (evictOff) { player.inventory.push(evictOff); gearOf(player, 'melee').off = null }
  return { ok: true, equipped: item }
```

Add, next to `handsToEvict`:
```js
// The heavy shield rides on the plate too: an outfit change that drops the
// heavy grant sends it to the sack with the heavy blade.
function offToEvict(player, stance, nextOutfit) {
  if (stance !== 'melee') return null
  const off = gearOf(player, stance).off
  return off?.heavy && !nextOutfit?.heavy ? offhandItem(off) : null
}
```
In `equipOutfit`: `const offEvict = offToEvict(player, stance, item.payload)`; the `roomFor` count becomes `(g.outfit ? 1 : 0) + evict.length + (offEvict ? 1 : 0) - 1`; after `evictHands(player, evict)` add `if (offEvict) { player.inventory.push(offEvict); g.off = null }`. In `unequipOutfit`: `const offEvict = offToEvict(player, stance, null)`; count `1 + evict.length + (offEvict ? 1 : 0)`; same push/null after `evictHands`.

Replace `equipOffhand` / `unequipOffhand`:
```js
// Put the sack item at `index` in `stance`'s offhand. A consumable becomes a
// pointer (the stack stays in the sack; every loadout may point at the same
// one). Anything else moves out of the sack, and a held item swaps back in.
export function equipOffhand(player, index, stance = player.attackMode ?? 'melee') {
  const item = player.inventory[index]
  const gate = canEquipOffhand(player, item, stance)
  if (!gate.ok) return gate
  const g = gearOf(player, stance)
  const held = offhandItem(g.off)
  if (CONSUMABLE_KINDS.includes(item.kind)) {
    if (held) player.inventory.push(held)   // the item leaves; the sack gains one, never more
    g.off = { kind: 'consumable', item: item.kind }
    return { ok: true, equipped: item }
  }
  player.inventory.splice(index, 1)
  if (held) player.inventory.push(held)
  g.off = { kind: item.kind, ...item.payload }
  return { ok: true, equipped: item }
}

export function unequipOffhand(player, stance = player.attackMode ?? 'melee') {
  const g = gearOf(player, stance)
  const held = offhandItem(g.off)
  if (held) {
    if (!roomFor(player, 1)) return { ok: false, reason: 'full' }
    player.inventory.push(held)
  }
  g.off = null
  return { ok: true }
}
```
(Pointing at a consumable while holding an item: the sack already holds the consumable stack, so the returning item is a net +1 — `roomFor(player, 1)` must hold; refuse with `full` when it does not. Add that check before the push.)

- [ ] **Step 4: Run**

Run: `node --test test/offhand.test.js test/equip-slots.test.js test/inventory.test.js test/outfits.test.js test/inventory-panel-model.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/inventory.js test/offhand.test.js test/equip-slots.test.js
git commit -m "feat: offhand legality per loadout, item offhands, the two-handed rule

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Item offhands persist

**Files:**
- Modify: `renderer/systems/adventure.js` (`normalizeBody`, the gear loop)
- Test: `test/adventure.test.js` (the "worn outfits are rebuilt" test and one new test)

**Interfaces:**
- `normalizeBody` rebuilds an item offhand from its table: `weapon` → `weaponContents(weaponType)`, `wand` → `makeWandContents` minus `type`, `shield` → `makeShieldContents` minus `type`, each stored as `{ kind, ...payload }`; an unknown weaponType or kind → `null`; consumable pointers as before.

- [ ] **Step 1: Write the failing test**

In `test/adventure.test.js`, the test `'worn outfits are rebuilt from the table; unknown ones are dropped'` currently asserts `b.gear.melee.off === null` for a saved `off: null` — keep that. Add:
```js
  it('item offhands are rebuilt from their tables; unknown ones are dropped', () => {
    const stale = { ...emptyBody(), gear: { ...defaultGear(),
      melee: { off: { kind: 'shield', weaponType: 'buckler', name: 'Old Buckler', blockCost: 99 }, outfit: null },
      magic: { off: { kind: 'wand', weaponType: 'frostwand' }, outfit: null },
      ranged: { off: { kind: 'weapon', weaponType: 'spork' }, outfit: null } } }
    const b = normalizeBody(stale)
    assert.deepEqual(b.gear.melee.off, { kind: 'shield', weaponType: 'buckler', name: 'Buckler', blockCost: 8 })
    assert.equal(b.gear.magic.off.spell, 'rime')
    assert.equal(b.gear.ranged.off, null)
    assert.deepEqual(normalizeBody(b), b)
  })
```
(`emptyBody`/`defaultGear` helpers already exist in that file from plan 1; add `makeShieldContents` to the imports if the test needs it — it does not.)

- [ ] **Step 2: Run to see failure**

Run: `node --test test/adventure.test.js` → FAIL (`melee.off` is null).

- [ ] **Step 3: adventure.js**

Import `makeShieldContents, SHIELD_TYPES, weaponContents, WEAPON_TYPES` (some already imported). Add above `normalizeBody`:
```js
// Item offhands are table data like the hands: rebuilt by kind, dropped when
// the table has never heard of them. A consumable pointer is copied as-is.
const OFFHAND_REBUILD = {
  weapon: wt => WEAPON_TYPES[wt] ? weaponContents(wt) : null,
  wand:   wt => WAND_TYPES[wt] ? (({ type, ...p }) => p)(makeWandContents(wt)) : null,
  shield: wt => SHIELD_TYPES[wt] ? (({ type, ...p }) => p)(makeShieldContents(wt)) : null,
}
function normalizeOffhand(off) {
  if (!off) return null
  if (off.kind === 'consumable') return typeof off.item === 'string' ? { kind: 'consumable', item: off.item } : null
  const payload = OFFHAND_REBUILD[off.kind]?.(off.weaponType) ?? null
  return payload ? { kind: off.kind, ...payload } : null
}
```
and in the gear loop replace the `gear[stance].off = ...` line with `gear[stance].off = normalizeOffhand(g.off)`.

- [ ] **Step 4: Run**

Run: `node --test test/adventure.test.js test/timewarp.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/systems/adventure.js test/adventure.test.js
git commit -m "feat: item offhands survive the save round-trip

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The shield system and the damage funnel

**Files:**
- Create: `renderer/systems/shield.js`
- Modify: `renderer/systems/player-damage.js`, `renderer/systems/stamina.js:79-85`, `renderer/systems/sfx.js` (`CUE_NAMES`), `renderer/render/audio.js` (`RECIPES`)
- Test: `test/shield.test.js` (new), `test/player-damage.test.js` (append), `test/stamina.test.js` (append), `test/audio.test.js` (automatic)

**Interfaces:**
- `shield.js`: `SHIELD_DROP = 0.8`, `BLOCK_HALF_ARC = Math.PI / 3`, `BLOCK_SPEED_MUL = 0.5`, `BLOCK_SHOVE = 12`; `heldShield(player) → shield offhand | null`; `tickShield(player, wantBlock, dt) → boolean` (sets `player.blocking`, runs down `player.shieldDropT`); `inBlockArc(player, from) → boolean`; `tryBlock(state, from) → boolean` (absorbs: spends `blockCost`, drops the shield for `SHIELD_DROP` at zero stamina with `staminaRefusedT = 0.4`, sets `player.blockedHit = true`, cues `shield-block`).
- `damagePlayer(state, amount, kind, from = null)`: order i-frames → block (`'hit'` with a `from`) → protect (`'hit'`) → hp. A hit reduced to 0 still lands (i-frames, float `-0` shown as `0`).
- `sprintProfile(mode, { skiLegs = false, drainMul = 1 })` → `drain × (skiLegs ? SKI_LEGS_DRAIN : 1) × drainMul`.
- Cue `shield-block`.

- [ ] **Step 1: Write the failing tests**

`test/shield.test.js`:
```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SHIELD_DROP, BLOCK_HALF_ARC, heldShield, tickShield, inBlockArc, tryBlock } from '../renderer/systems/shield.js'
import { makePlayer, makeShieldContents } from '../renderer/systems/entities.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const buckler = () => { const { type, ...s } = makeShieldContents('buckler'); return { kind: 'shield', ...s } }
const mk = (over = {}) => {
  const p = { ...makePlayer(1, 1), px: 100, py: 100, facing: 'east', stamina: 100, ...over }
  p.gear.melee.off = buckler()
  return p
}
const state = p => ({ player: p, feedback: makeFeedback(), sfx: makeSfx() })

describe('raising the shield', () => {
  it('blocks only while Q is held, a shield is in the offhand, and stamina remains', () => {
    const p = mk()
    assert.equal(tickShield(p, true, 0.016), true)
    assert.equal(p.blocking, true)
    assert.equal(tickShield(p, false, 0.016), false)
    p.gear.melee.off = { kind: 'consumable', item: 'potion' }
    assert.equal(tickShield(p, true, 0.016), false)
    assert.equal(heldShield(p), null)
    const q = mk({ stamina: 0 })
    assert.equal(tickShield(q, true, 0.016), false)
  })
  it('stays down for SHIELD_DROP after the tank empties', () => {
    const p = mk({ shieldDropT: SHIELD_DROP })
    assert.equal(tickShield(p, true, 0.1), false)
    tickShield(p, true, SHIELD_DROP)
    assert.equal(tickShield(p, true, 0.016), true)
  })
})

describe('the block arc', () => {
  it('covers 60 degrees either side of the facing', () => {
    const p = mk({ blocking: true })
    assert.equal(inBlockArc(p, { px: 140, py: 100 }), true)                           // dead ahead
    assert.equal(inBlockArc(p, { px: 120, py: 100 + 20 * Math.tan(BLOCK_HALF_ARC - 0.05) }), true)
    assert.equal(inBlockArc(p, { px: 120, py: 100 + 20 * Math.tan(BLOCK_HALF_ARC + 0.05) }), false)
    assert.equal(inBlockArc(p, { px: 60, py: 100 }), false)                           // behind
    assert.equal(inBlockArc(p, null), false)
    assert.equal(inBlockArc(p, { px: NaN, py: 1 }), false)
  })
  it('follows the facing', () => {
    const p = mk({ blocking: true, facing: 'north' })
    assert.equal(inBlockArc(p, { px: 100, py: 60 }), true)
    assert.equal(inBlockArc(p, { px: 100, py: 140 }), false)
  })
})

describe('tryBlock', () => {
  it('absorbs a frontal hit for the shield’s stamina and cues the block', () => {
    const p = mk({ blocking: true })
    const s = state(p)
    assert.equal(tryBlock(s, { px: 140, py: 100 }), true)
    assert.equal(p.stamina, 92)
    assert.equal(p.blockedHit, true)
    assert.deepEqual(s.sfx.cues.map(c => c.name), ['shield-block'])
  })
  it('does nothing when not blocking or when the hit comes from behind', () => {
    const p = mk({ blocking: false })
    assert.equal(tryBlock(state(p), { px: 140, py: 100 }), false)
    p.blocking = true
    assert.equal(tryBlock(state(p), { px: 60, py: 100 }), false)
    assert.equal(p.stamina, 100)
  })
  it('a block that empties the tank drops the shield for SHIELD_DROP and flashes the bar', () => {
    const p = mk({ blocking: true, stamina: 5 })
    assert.equal(tryBlock(state(p), { px: 140, py: 100 }), true)
    assert.equal(p.stamina, 0)
    assert.equal(p.blocking, false)
    assert.equal(p.shieldDropT, SHIELD_DROP)
    assert.equal(p.staminaRefusedT, 0.4)
  })
})
```
Append to `test/player-damage.test.js` (its `freshState` player is `{ px:40, py:60, hp:10 }`):
```js
import { makePlayer, makeShieldContents, makeOutfitContents } from '../renderer/systems/entities.js'
import { makeSfx } from '../renderer/systems/sfx.js'   // (already imported at the top)

describe('damagePlayer with a shield and armour', () => {
  const dressed = (over = {}) => {
    const p = { ...makePlayer(1, 1), px: 40, py: 60, hp: 10, facing: 'east', stamina: 100, ...over }
    return { player: p, feedback: makeFeedback(), sfx: makeSfx() }
  }
  it('a raised shield absorbs a frontal hit: no damage, no i-frames, returns false', () => {
    const s = dressed({ blocking: true })
    const { type, ...b } = makeShieldContents('buckler'); s.player.gear.melee.off = { kind: 'shield', ...b }
    assert.equal(damagePlayer(s, 3, 'hit', { px: 80, py: 60 }), false)
    assert.equal(s.player.hp, 10)
    assert.equal(s.player.invulnTimer ?? 0, 0)
    assert.equal(s.player.stamina, 92)
  })
  it('a hit from behind, a hit with no position, and a dot all get through a raised shield', () => {
    const s = dressed({ blocking: true })
    const { type, ...b } = makeShieldContents('buckler'); s.player.gear.melee.off = { kind: 'shield', ...b }
    assert.equal(damagePlayer(s, 1, 'hit', { px: 0, py: 60 }), true)
    s.player.invulnTimer = 0
    assert.equal(damagePlayer(s, 1, 'hit'), true)
    assert.equal(damagePlayer(s, 1, 'dot', { px: 80, py: 60 }), true)
    assert.equal(s.player.hp, 7)
  })
  it('worn armour takes protect off every hit, floored at 0, but not off a dot', () => {
    const s = dressed()
    const { type, ...plate } = makeOutfitContents('plate'); s.player.gear.melee.outfit = plate
    assert.equal(damagePlayer(s, 3, 'hit'), true)
    assert.equal(s.player.hp, 9)
    s.player.invulnTimer = 0
    assert.equal(damagePlayer(s, 1, 'hit'), true)     // reduced to 0: still lands, still grants i-frames
    assert.equal(s.player.hp, 9)
    assert.equal(s.player.invulnTimer, INVULN_DURATION)
    assert.equal(damagePlayer(s, 1, 'dot'), true)
    assert.equal(s.player.hp, 8)
  })
  it('the active loadout’s outfit is the one that protects', () => {
    const s = dressed({ attackMode: 'magic' })
    const { type, ...plate } = makeOutfitContents('plate'); s.player.gear.melee.outfit = plate
    damagePlayer(s, 3, 'hit')
    assert.equal(s.player.hp, 7)
  })
})
```
Append to `test/stamina.test.js`:
```js
describe('outfit sprint drain', () => {
  it('multiplies the drain and composes with ski-legs', () => {
    const base = sprintProfile('melee').drain
    assert.equal(sprintProfile('melee', { drainMul: 2 }).drain, base * 2)
    assert.equal(sprintProfile('melee', { skiLegs: true, drainMul: 2 }).drain, base * SKI_LEGS_DRAIN * 2)
    assert.equal(sprintProfile('melee', { drainMul: 2 }).speedMul, sprintProfile('melee').speedMul)
  })
})
```
(import `SKI_LEGS_DRAIN` if not already.)

- [ ] **Step 2: Run to see failure**

Run: `node --test test/shield.test.js test/player-damage.test.js test/stamina.test.js` → FAIL (module missing; `from` ignored).

- [ ] **Step 3: shield.js**

```js
// The shield in the offhand: raised while Q is held (systems/inventory.js
// offhand), it absorbs hits arriving from the front for a stamina price.
// Pure — game.js reads the key and calls tickShield once a frame;
// player-damage.js calls tryBlock for every positioned 'hit'.
import { offhand } from './inventory.js'
import { spendStamina } from './stamina.js'
import { sfx } from './sfx.js'
import { FACING_ANGLE } from './entities.js'

export const SHIELD_DROP = 0.8            // s the shield stays down after the tank empties
export const BLOCK_HALF_ARC = Math.PI / 3 // 60° either side of the facing
export const BLOCK_SPEED_MUL = 0.5        // walk speed while raised
export const BLOCK_SHOVE = 12             // px a blocked melee enemy is pushed back

export const heldShield = player => {
  const off = offhand(player)
  return off?.kind === 'shield' ? off : null
}

// Once a frame. `wantBlock` is the raw key; the shield only rises with a
// shield in hand, stamina in the tank and no drop timer running.
export function tickShield(player, wantBlock, dt) {
  player.shieldDropT = Math.max(0, (player.shieldDropT ?? 0) - dt)
  player.blocking = !!(wantBlock && heldShield(player) && player.shieldDropT <= 0 && (player.stamina ?? 0) > 0)
  return player.blocking
}

// Whether a hit from `from` ({px, py}) arrives inside the raised arc.
export function inBlockArc(player, from) {
  if (!from || !Number.isFinite(from.px) || !Number.isFinite(from.py)) return false
  const fa = FACING_ANGLE[player.facing] ?? 0
  const a = Math.atan2(from.py - player.py, from.px - player.px)
  const d = Math.abs(Math.atan2(Math.sin(a - fa), Math.cos(a - fa)))
  return d <= BLOCK_HALF_ARC
}

// Absorb a hit if the shield is up and the hit is frontal. Costs the
// shield's blockCost; a block that empties the tank drops the shield for
// SHIELD_DROP with the stamina bar's refused flash, the same tell the sprint
// gives. `blockedHit` tells the melee striker (enemy-attack.js) its swing was
// spent on the shield rather than i-framed.
export function tryBlock(state, from) {
  const player = state.player
  if (!player.blocking || !inBlockArc(player, from)) return false
  const shield = heldShield(player)
  spendStamina(player, shield.blockCost)
  if ((player.stamina ?? 0) <= 0) {
    player.shieldDropT = SHIELD_DROP
    player.blocking = false
    player.staminaRefusedT = 0.4
  }
  player.blockedHit = true
  sfx(state, 'shield-block', { px: player.px, py: player.py })
  return true
}
```
Check `spendStamina` in stamina.js clamps at 0 and resets the regen delay (it does: `player.stamina = Math.max(0, ...)`; if not, clamp here).

- [ ] **Step 4: player-damage.js**

```js
// Single funnel for all player damage. 'hit' respects and grants i-frames and
// can be blocked (a raised shield, frontal, with a `from` position) and is
// reduced by the worn outfit's protect; 'dot' and 'lightning' always apply
// untouched. Returns whether damage landed (a block returns false and sets
// player.blockedHit for the striker).
import { addFloat } from './feedback.js'
import { sfx } from './sfx.js'
import { tryBlock } from './shield.js'
import { outfitOf } from './inventory.js'

export const INVULN_DURATION = 0.8

export function damagePlayer(state, amount, kind, from = null) {
  const player = state.player
  if (kind === 'hit' && (player.invulnTimer ?? 0) > 0) return false
  if (kind === 'hit' && tryBlock(state, from)) return false
  if (kind === 'hit') amount = Math.max(0, amount - (outfitOf(player, player.attackMode ?? 'melee')?.protect ?? 0))
  player.hp -= amount
  if (kind === 'hit') player.invulnTimer = INVULN_DURATION
  addFloat(state.feedback, { px: player.px, py: player.py, text: amount > 0 ? `-${amount}` : '0', kind: 'taken' })
  sfx(state, 'player-hurt', { px: player.px, py: player.py })
  return true
}
```

- [ ] **Step 5: stamina.js, sfx.js, audio.js**

```js
export function sprintProfile(mode, { skiLegs = false, drainMul = 1 } = {}) {
  const p = SPRINT_PROFILES[mode] ?? SPRINT_PROFILES.melee
  return { ...p, drain: p.drain * (skiLegs ? SKI_LEGS_DRAIN : 1) * drainMul }
}
```
`CUE_NAMES`: add `'shield-block'` to the combat row. `RECIPES`: `'shield-block': { kind: 'burst', freq: 420, q: 2.0, dur: 0.10, vol: 0.8 },` after `'player-hurt'`.

- [ ] **Step 6: Run**

Run: `node --test test/shield.test.js test/player-damage.test.js test/stamina.test.js test/audio.test.js test/feedback.test.js test/hammer.test.js` → PASS.

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/shield.js renderer/systems/player-damage.js renderer/systems/stamina.js renderer/systems/sfx.js renderer/render/audio.js test/shield.test.js test/player-damage.test.js test/stamina.test.js
git commit -m "feat: shield blocking, outfit protect and sprint drain in the damage and stamina funnels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Hit sources carry a position; a blocked melee strike is spent

**Files:**
- Modify: `renderer/systems/enemy-attack.js:69-86` (`strike`), `renderer/systems/projectiles.js:176`, `renderer/systems/cyclops.js:67,96`, `renderer/systems/dragonboss.js:88,140,159`, `renderer/systems/monsters/nakki.js:67`, `renderer/systems/monsters/kivihiisi.js:108`, `renderer/systems/monsters/podeboo.js:80,87`, `renderer/game.js` (`projectileHooks.damagePlayer`, ~line 422; the fireball burst at ~386 stays positionless)
- Test: `test/enemy-attack.test.js` (append), `test/projectiles.test.js` (the hook assertion)

**Interfaces:**
- Every `'hit'` from an entity passes `{ px: e.px, py: e.py }` of the attacker (the projectile passes its own `px/py`); `'dot'` and the hero's own lightning pass nothing.
- `projectiles.js` calls `hooks.damagePlayer(p.damage, { px: p.px, py: p.py })`; game.js's hook is `(damage, from) => damagePlayer(state, damage, 'hit', from)`.
- `enemy-attack.js` `strike`: a blocked swing (`damagePlayer` returned false and `player.blockedHit` is set) is spent like a landed one (cooldown, swing animation) and the attacker is shoved `BLOCK_SHOVE` px away from the player; `blockedHit` is cleared there. An i-framed swing still retries next frame.

- [ ] **Step 1: Write the failing tests**

Append to `test/enemy-attack.test.js` (mirror its existing `strike`/state fixtures — read the file's helpers first; the fixture below assumes a `mkState`-style helper exists, otherwise build `{ player, entities, feedback: makeFeedback(), sfx: makeSfx() }` by hand):
```js
import { makeShieldContents, makePlayer } from '../renderer/systems/entities.js'
import { BLOCK_SHOVE } from '../renderer/systems/shield.js'

describe('a blocked strike', () => {
  const shielded = () => {
    const p = { ...makePlayer(1, 1), px: 100, py: 100, hp: 10, facing: 'east', stamina: 100, blocking: true, invulnTimer: 0 }
    const { type, ...b } = makeShieldContents('buckler'); p.gear.melee.off = { kind: 'shield', ...b }
    return p
  }
  it('is spent on the shield: no damage, cooldown set, attacker shoved back', () => {
    const player = shielded()
    const e = { type: 'guard', px: 120, py: 100, x: 3, y: 3, hp: 4, damageCooldown: 0 }
    const state = { player, entities: [e], feedback: makeFeedback(), sfx: makeSfx() }
    beginAttack(e, state)                    // whatever the file's public entry is (see its existing tests)
    while (e.attack?.phase === 'windup') stepEnemyAttack(e, state, 0.05)
    assert.equal(player.hp, 10)
    assert.equal(player.blockedHit, false)
    assert.ok(e.damageCooldown > 0)
    assert.equal(e.attack?.phase, 'swing')
    assert.ok(e.knockback || e.kvx !== undefined, 'attacker was shoved')   // use the field startKnockback actually sets (see knockback.js)
    assert.deepEqual(state.sfx.cues.map(c => c.name).filter(n => n === 'shield-block'), ['shield-block'])
  })
  it('an i-framed strike still retries next frame', () => {
    const player = { ...shielded(), blocking: false, invulnTimer: 0.5 }
    const e = { type: 'guard', px: 120, py: 100, x: 3, y: 3, hp: 4, damageCooldown: 0 }
    const state = { player, entities: [e], feedback: makeFeedback(), sfx: makeSfx() }
    beginAttack(e, state)
    while (e.attack?.phase === 'windup') stepEnemyAttack(e, state, 0.05)
    assert.equal(e.attack, null)
  })
})
```
`test/projectiles.test.js`: find the test that asserts the `damagePlayer` hook was called for a projectile reaching the player and extend its recording hook to `(d, from) => calls.push([d, from])`, asserting `from` deep-equals the projectile's `{ px, py }` at impact.

- [ ] **Step 2: Run to see failure**

Run: `node --test test/enemy-attack.test.js test/projectiles.test.js` → FAIL.

- [ ] **Step 3: enemy-attack.js**

Import `startKnockback` from `./knockback.js` and `BLOCK_SHOVE` from `./shield.js`. In `strike`:
```js
  const connects = inSwing(reach, halfAngle, a.angle, player.px - e.px, player.py - e.py)
  const landed = connects && damagePlayer(state, w.damage, 'hit', { px: e.px, py: e.py })
  if (connects && !landed) {
    if (player.blockedHit) {
      // The shield took it: the swing is spent like a landed one, and the
      // blade skids off — a short shove away from the player.
      player.blockedHit = false
      startKnockback(e, e.px - player.px, e.py - player.py, BLOCK_SHOVE)
    } else {
      e.attack = null   // i-framed: no cooldown, no animation — retries next frame
      return
    }
  }
  if (landed) e.inCombat = true
```
(the rest of the function unchanged: cooldown, phase, timer). Check `startKnockback`'s signature in `knockback.js` before writing the test's shoved assertion.

- [ ] **Step 4: projectiles.js and game.js hook**

`projectiles.js:176`: `hooks.damagePlayer(p.damage, { px: p.px, py: p.py })`; update the hook comment near line 84. `game.js` `projectileHooks`: `damagePlayer: (damage, from) => damagePlayer(state, damage, 'hit', from),`.

- [ ] **Step 5: The other strikers**

Each existing `damagePlayer(state, N, 'hit')` at the listed lines gains a fourth argument with the attacking entity's position (the variable is `e`, `boss`, `hiisi`, `m` or similar in each file — read the enclosing function). For `podeboo.js` use the monster's own position for both the burst and the sweep. Leave every `'dot'` call and game.js's `'lightning'` call alone.

- [ ] **Step 6: Run**

Run: `node --test test/enemy-attack.test.js test/projectiles.test.js test/cyclops.test.js test/dragonboss.test.js test/nakki.test.js test/kivihiisi.test.js test/monsters.test.js` → PASS; `node --check renderer/game.js`.

- [ ] **Step 7: Commit**

```bash
git add renderer/systems/enemy-attack.js renderer/systems/projectiles.js renderer/systems/cyclops.js renderer/systems/dragonboss.js renderer/systems/monsters/nakki.js renderer/systems/monsters/kivihiisi.js renderer/systems/monsters/podeboo.js renderer/game.js test/enemy-attack.test.js test/projectiles.test.js
git commit -m "feat: hits carry their source so the shield can judge the arc; a blocked strike is spent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Offhand wand casts and alternating blades (pure helpers)

**Files:**
- Modify: `renderer/systems/spells.js:96-99,167-175`, `renderer/systems/melee.js` (append)
- Test: `test/spells.test.js` (append), `test/melee.test.js` (append)

**Interfaces:**
- `spellFor(player, hand = 'main')` — `'off'` reads the offhand wand (`offhand(player)` with `kind === 'wand'`); a non-wand offhand yields the gust like an empty hand.
- `tryCast(state, spellId, tier, { modules, hand = 'main' })` — `hand: 'off'` reads and writes `player.offCooldown` instead of `magicCooldown`; stamina shared.
- `melee.js`: `OFFHAND_COOLDOWN_MUL = 0.75`; `swingHand(player, offBlade) → 'main' | 'off'` (`'off'` when an offhand blade exists and `player.nextHand === 'off'`); `nextHandAfter(hand, offBlade) → 'main' | 'off'` (alternates only while an offhand blade exists).

- [ ] **Step 1: Write the failing tests**

Append to `test/spells.test.js` (its fixture builds a magic-stance player with the robe; reuse it):
```js
import { makeWandContents } from '../renderer/systems/entities.js'
describe('offhand wand', () => {
  const withOff = (wt) => { const s = mkState(); const { type, ...w } = makeWandContents(wt); s.player.gear.magic.off = { kind: 'wand', ...w }; return s }
  it('spellFor reads the offhand wand; a non-wand offhand is the gust', () => {
    assert.equal(spellFor(withOff('frostwand').player, 'off').id, 'rime')
    const s = mkState(); s.player.gear.magic.off = { kind: 'consumable', item: 'potion' }
    assert.equal(spellFor(s.player, 'off').id, 'gust')
  })
  it('an offhand cast runs on its own cooldown and the shared tank', () => {
    const s = withOff('sparkwand')
    s.player.stamina = 100
    const r = tryCast(s, 'spark', 'tap', { hand: 'off' })
    assert.equal(r.ok, true)
    assert.ok(s.player.offCooldown > 0)
    assert.equal(s.player.magicCooldown ?? 0, 0)
    assert.equal(tryCast(s, 'spark', 'tap', { hand: 'off' }).reason, 'cooldown')
    assert.equal(tryCast(s, 'spark', 'tap').ok, true)      // the main hand is not on cooldown
    assert.ok(s.player.stamina < 100)
  })
})
```
Append to `test/melee.test.js`:
```js
import { OFFHAND_COOLDOWN_MUL, swingHand, nextHandAfter } from '../renderer/systems/melee.js'
describe('alternating blades', () => {
  const dagger = { kind: 'weapon', weaponType: 'dagger', damage: 1 }
  it('the main hand swings first, then hands alternate while an offhand blade is held', () => {
    assert.equal(swingHand({}, dagger), 'main')
    assert.equal(nextHandAfter('main', dagger), 'off')
    assert.equal(swingHand({ nextHand: 'off' }, dagger), 'off')
    assert.equal(nextHandAfter('off', dagger), 'main')
  })
  it('without an offhand blade every swing is the main hand', () => {
    assert.equal(swingHand({ nextHand: 'off' }, null), 'main')
    assert.equal(nextHandAfter('main', null), 'main')
    assert.equal(OFFHAND_COOLDOWN_MUL, 0.75)
  })
})
```

- [ ] **Step 2: Run to see failure** — `node --test test/spells.test.js test/melee.test.js` → FAIL.

- [ ] **Step 3: spells.js**

Import `offhand` alongside `loadoutAvailable` from `./inventory.js`.
```js
// Which spell a hand casts: the wand it holds, or the wandless gust when the
// hand is empty (or holds something the table doesn't know — a dagger in the
// offhand casts nothing, and game.js never asks it to).
export function spellFor(player, hand = 'main') {
  const held = hand === 'off' ? offhand(player) : player?.wand
  const wand = hand === 'off' && held?.kind !== 'wand' ? null : held
  const spell = SPELLS[WAND_TYPES[wand?.weaponType]?.spell]
  return spell ?? SPELLS.gust
}
```
In `tryCast(state, spellId, tier = 'tap', { modules, hand = 'main' } = {})`: `const cd = hand === 'off' ? 'offCooldown' : 'magicCooldown'`; the cooldown check reads `p[cd]`, the set writes `p[cd] = spell.cooldown`. Update the doc comment: an offhand wand keeps its own cooldown, shares the tank.

- [ ] **Step 4: melee.js**

Append:
```js
// Two small blades alternate swings; the offhand's swing recovers faster.
export const OFFHAND_COOLDOWN_MUL = 0.75
export const swingHand = (player, offBlade) => offBlade && player.nextHand === 'off' ? 'off' : 'main'
export const nextHandAfter = (hand, offBlade) => offBlade && hand === 'main' ? 'off' : 'main'
```

- [ ] **Step 5: Run** — `node --test test/spells.test.js test/melee.test.js test/magic.test.js test/charge.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add renderer/systems/spells.js renderer/systems/melee.js test/spells.test.js test/melee.test.js
git commit -m "feat: offhand wand cooldown and blade alternation helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: game.js — blocking, Q by kind, the alternating swing, sprint drain, kits

**Files:**
- Modify: `renderer/game.js` — imports; `useOffhand`; the update loop's shield tick and movement (~1085-1107); cooldown ticks (~1316-1322); `attacking` (~1328); the `swing` closure (~1331-1470); `applyLoadout` (~622-662)

**Interfaces:**
- Per frame, before movement: `player.blockedHit = false; const blocking = tickShield(player, keys['q'] || keys['Q'], delta)`; while blocking: `charging = null`, no sprint, speed × `BLOCK_SPEED_MUL`, `attacking` false.
- `useOffhand()` (Q keydown): consumable → use as in plan 1; wand → `castOffhand()`; shield/blade → nothing (the shield is per-frame; blades need no key).
- `castOffhand()`: `tryCast(state, spellFor(player,'off').id, 'tap', { modules: { lightning: castLightning }, hand: 'off' })`, `showCast` on success, the stamina refusal as the main hand's.
- `player.offCooldown` ticks down beside `magicCooldown`.
- `sprintProfile(player.attackMode, { skiLegs, drainMul: outfitOf(player, player.attackMode)?.sprintDrain ?? 1 })`.
- The swing closure takes its weapon from `swingHand`; sets `player.swingHand`, `player.nextHand`; the offhand swing's cooldown × `OFFHAND_COOLDOWN_MUL`; harvest tool from the swinging blade.
- `applyLoadout` accepts `offhand: { type:'weapon'|'wand'|'shield', weaponType }` (arena configs, episode kits) placed in the loadout that accepts it (`'weapon'`/`'shield'` → melee, `'wand'` → magic).

- [ ] **Step 1: Imports**

Add to the inventory import: `offhand, outfitOf, gearOf`. Add `import { tickShield, BLOCK_SPEED_MUL } from './systems/shield.js'`, `OFFHAND_COOLDOWN_MUL, swingHand, nextHandAfter` to the melee import, `makeShieldContents, SHIELD_TYPES` to the entities import.

- [ ] **Step 2: Q dispatch**

```js
function useOffhand() {
  const off = resolveOffhand(state.player)
  if (!off) { throttledThink('offhand', 'Nothing in my off hand.'); return }
  if (off.kind === 'consumable') {
    if (off.index === -1) { throttledThink('offhand', 'None left.'); return }
    useInventoryItem(off.index)
  } else if (off.kind === 'wand') {
    castOffhand()
  }
  // A shield rises while Q is held (tickShield reads the key each frame);
  // a blade needs no key — swings alternate on Space.
}

// The offhand wand: a tap cast on its own cooldown, from the shared tank.
function castOffhand() {
  const player = state.player
  if (player.attackMode !== 'magic' || player.stanceSwitch) return
  const cast = tryCast(state, spellFor(player, 'off').id, 'tap', { modules: { lightning: castLightning }, hand: 'off' })
  if (cast.ok) showCast(cast)
  else if (cast.reason === 'stamina') {
    player.staminaRefusedT = 0.4
    throttledThink('magic', 'Too winded to shape the wind.')
  }
}
```

- [ ] **Step 3: Blocking, movement, sprint drain**

Right after `const wasGrabbed = ...` / `player.grabbed = false`:
```js
  // The shield: up while Q is held with a shield in the offhand. Raised, the
  // player walks at half speed, cannot sprint, and every attack is dead.
  player.blockedHit = false
  const blocking = tickShield(player, !!(keys['q'] || keys['Q']), delta)
  if (blocking) player.charging = null
```
`const profile = sprintProfile(player.attackMode, { skiLegs: hasTalent(player, 'ski_legs'), drainMul: outfitOf(player, player.attackMode)?.sprintDrain ?? 1 })`
`const sprinting = moving && !player.charging && !blocking && player.stamina > 0 && ...`
`const speed = PLAYER_SPEED * chargeFactor * rainSlow(player) * (blocking ? BLOCK_SPEED_MUL : 1) * (sprinting ? profile.speedMul : 1)`

Cooldowns: `player.offCooldown = Math.max(0, (player.offCooldown ?? 0) - delta)` beside `magicCooldown`.
`const attacking = keys[' '] && !player.stanceSwitch && !player.blocking`.

- [ ] **Step 4: The swing closure**

Above the closure: `const offBlade = offhand(player)?.kind === 'weapon' ? offhand(player) : null`. Inside `swing`, first lines:
```js
  const swing = (mods) => {
    const hand = swingHand(player, offBlade)
    const wpn = hand === 'off' ? offBlade : player.weapon
    const wt = wpn.weaponType
```
then, throughout the closure body only: `meleeWT` → `wt`, `player.weapon?.damage` → `wpn.damage`, `player.weapon?.lightning` → `wpn.lightning`, `player.weapon?.chop/mine` → `wpn.chop/wpn.mine`. After `player.meleeCooldown = atk.cooldown * mods.cooldownMul` append `* (hand === 'off' ? OFFHAND_COOLDOWN_MUL : 1)`, and add:
```js
    player.swingHand = hand
    player.nextHand = nextHandAfter(hand, offBlade)
```
The `meleeWT` const outside the closure (used by `isChargeWeapon(meleeWT)` and `resolveCharge(meleeWT, …)`) stays: the charge path is the main hand's, and a heavy main never has a blade beside it. Also reset `player.nextHand = 'main'` wherever a swing is impossible: in the unarmed branch (`player.attackMode === 'melee' && !player.weapon`).

- [ ] **Step 5: applyLoadout**

After the `outfits` handling:
```js
  // A kit's `offhand` ({ type, weaponType }) goes straight into the loadout
  // that takes it: blades and shields to the Warrior, wands to the Mage.
  if (po.offhand) {
    const { type, weaponType } = po.offhand
    const make = { weapon: wt => WEAPON_TYPES[wt] && weaponContents(wt), wand: wt => WAND_TYPES[wt] && handPayload(makeWandContents(wt)), shield: wt => SHIELD_TYPES[wt] && handPayload(makeShieldContents(wt)) }[type]
    const payload = make?.(weaponType)
    if (payload) gearOf(player, type === 'wand' ? 'magic' : 'melee').off = { kind: type, ...payload }
    else console.warn(`loadout: unknown offhand ${type}/${weaponType} — skipped`)
  }
```
Update `applyLoadout`'s doc comment to list `offhand`.

- [ ] **Step 6: Checks**

`node --check renderer/game.js`; `npm test` (green); the residual grep `grep -n "meleeWT" renderer/game.js` should show only the charge-path uses outside the closure. Boot: a playwright `_electron` launch (`{ args: ['.', '--dcdebug'], env: { ...process.env, DISPLAY: ':0' } }`) to the title screen with no `pageerror`.

- [ ] **Step 7: Commit**

```bash
git add renderer/game.js
git commit -m "feat: hold Q to block, Q casts the offhand wand, blades alternate, plate drains the sprint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Rendering — the second hand and the HUD

**Files:**
- Modify: `renderer/render/canvas.js` (`drawHeldWeapon`, the player branch of `drawEntity` ~292-300, `drawMeleeSwing` ~653-660), `renderer/render/hud.js` (offhand block)
- Test: `test/canvas.test.js` (append to the player-draw describe), `test/hud.test.js` (append)

**Interfaces:**
- Idle: the main hand's sprite as today plus the offhand item's sprite mirrored on the other side (`drawOffhandItem(ctx, ws, S, raised)`); a raised shield (`entity.blocking`) draws larger and in front. Reads `entity.gear?.[entity.attackMode]?.off` directly (a render path must not lazily create gear).
- Swing: `drawMeleeSwing` uses `player.swingHand === 'off'` ? the offhand blade's sprite : the main weapon's.
- HUD offhand slot for an item: icon via `offhandItem`, no count; dim when a shield cannot be raised (`stamina < blockCost` or `shieldDropT > 0`) or a wand's tap cost exceeds stamina; `dataset.offhand` = the kind when usable, `''` when dimmed.

- [ ] **Step 1: Write the failing tests**

`test/canvas.test.js` — inside the player-draw describe (the one with `playerCtx()` recording `images`), add:
```js
  it('draws the offhand item beside the main hand, and larger when the shield is raised', () => {
    const base = playerCtx()
    drawEntity(base.ctx, player({ weapon: { weaponType: 'sword' } }), 0, 0, 32, SPR)
    const withOff = playerCtx()
    drawEntity(withOff.ctx, player({ weapon: { weaponType: 'sword' },
      gear: { melee: { off: { kind: 'shield', weaponType: 'buckler' }, outfit: null } } }), 0, 0, 32, SPR)
    assert.equal(withOff.images.length, base.images.length + 1)
    const raised = playerCtx()
    drawEntity(raised.ctx, player({ weapon: { weaponType: 'sword' }, blocking: true,
      gear: { melee: { off: { kind: 'shield', weaponType: 'buckler' }, outfit: null } } }), 0, 0, 32, SPR)
    const w = imgs => imgs.map(i => i.w ?? i.dw ?? i[3])          // use whatever width field playerCtx records
    assert.ok(Math.max(...w(raised.images)) > Math.max(...w(withOff.images)))
  })
  it('the swing draws the hand that swung', () => {
    const p = { px: 50, py: 50, attackTimer: 0.1, attackDuration: 0.2, attackFacing: 'east', attackStyle: 'snap',
      weapon: { weaponType: 'sword' }, attackMode: 'melee', swingHand: 'off',
      gear: { melee: { off: { kind: 'weapon', weaponType: 'dagger' }, outfit: null } } }
    const c = playerCtx()
    drawMeleeSwing(c.ctx, p, { weapon_sword: 'SWORD', weapon_dagger: 'DAGGER' }, 0, 0, 32)
    assert.ok(c.images.some(i => i.img === 'DAGGER' || i[0] === 'DAGGER'))
  })
```
(`SPR` must map `weapon_buckler`/`weapon_sword` to stand-in images the way the describe's existing sprite maps do; adapt to the file's recorder shape.)

`test/hud.test.js` — append to the offhand describe:
```js
  it('shows a shield with no count, dimmed when it cannot be raised', () => {
    const nodes = fakeDom()
    const s = state({ stamina: 100 })
    s.player.gear.melee.off = { kind: 'shield', weaponType: 'buckler', name: 'Buckler', blockCost: 8 }
    updateHUD(s)
    assert.match(nodes['hud-offhand'].innerHTML, /tile_0102/)
    assert.doesNotMatch(nodes['hud-offhand'].innerHTML, /hud-count|hud-icon-empty/)
    assert.equal(nodes['hud-offhand'].dataset.offhand, 'shield')
    s.player.stamina = 3
    updateHUD(s)
    assert.match(nodes['hud-offhand'].innerHTML, /hud-icon-empty/)
    assert.equal(nodes['hud-offhand'].dataset.offhand, '')
    s.player.stamina = 100; s.player.shieldDropT = 0.5
    updateHUD(s)
    assert.match(nodes['hud-offhand'].innerHTML, /hud-icon-empty/)
  })
  it('shows an offhand wand dimmed below its tap cost, and a blade never dimmed', () => {
    const nodes = fakeDom()
    const s = state({ attackMode: 'magic', stamina: 5 })
    s.player.gear.magic.off = { kind: 'wand', weaponType: 'sparkwand', name: 'Spark Wand', spell: 'spark' }
    updateHUD(s)
    assert.match(nodes['hud-offhand'].innerHTML, /hud-icon-empty/)
    assert.equal(nodes['hud-offhand'].dataset.offhand, '')
    const t = fakeDom()
    const u = state({ stamina: 0 })
    u.player.gear.melee.off = { kind: 'weapon', weaponType: 'dagger', name: 'Dagger', damage: 1 }
    updateHUD(u)
    assert.match(t['hud-offhand'].innerHTML, /tile_0103/)
    assert.doesNotMatch(t['hud-offhand'].innerHTML, /hud-icon-empty/)
    assert.equal(t['hud-offhand'].dataset.offhand, 'weapon')
  })
```

- [ ] **Step 2: Run to see failure** — `node --test test/canvas.test.js test/hud.test.js` → FAIL.

- [ ] **Step 3: canvas.js**

Import `offhandItem` is not needed; add after `drawHeldWeapon`:
```js
// The other hand: the offhand item mirrored across the body. A raised shield
// comes up in front, larger, so the block reads at a glance.
function drawOffhandItem(ctx, ws, S, raised) {
  const hw = Math.round(S * (raised ? 0.9 : 0.7))
  ctx.save()
  if (raised) ctx.translate(S * 0.05, -S * 0.5)
  else { ctx.translate(S * 0.30, -S * 0.34); ctx.rotate(0.35) }
  ctx.scale(-1, 1)
  ctx.drawImage(ws, -hw / 2, -hw * 0.85, hw, hw)
  ctx.restore()
}
```
In the player branch, after `if (ws) drawHeldWeapon(ctx, ws, S)`:
```js
      const off = entity.gear?.[entity.attackMode ?? 'melee']?.off
      if (off && off.kind !== 'consumable') {
        const os = sprites[`weapon_${off.weaponType}`]
        if (os) drawOffhandItem(ctx, os, S, !!entity.blocking && off.kind === 'shield')
      }
```
`drawMeleeSwing`:
```js
  const off = player.gear?.[player.attackMode ?? 'melee']?.off
  const swung = player.swingHand === 'off' && off?.kind === 'weapon' ? off : player.weapon
  const ws = sprites[`weapon_${swung?.weaponType}`]
```

- [ ] **Step 4: hud.js**

Import `offhandItem` from `../systems/inventory.js`. Between the consumable branch and the empty branch:
```js
  } else if (off) {
    // An item in the offhand: shield, wand or blade. No count. Dimmed when it
    // cannot act — a shield below its block cost or still dropped, a wand
    // below its tap cost. A blade is always ready.
    const src = iconSrcFor(offhandItem(off))
    const dim = off.kind === 'shield' ? ((player.stamina ?? 0) < off.blockCost || (player.shieldDropT ?? 0) > 0)
      : off.kind === 'wand' ? (player.stamina ?? 0) < spellFor(player, 'off').cost.tap
      : false
    setHTML(offEl, src ? `<img class="${dim ? 'hud-icon hud-icon-empty' : 'hud-icon'}" src="${src}" alt="${off.name ?? ''}">` : '')
    offEl.dataset.offhand = dim ? '' : off.kind
```

- [ ] **Step 5: Run** — `node --test test/canvas.test.js test/hud.test.js test/touch-input.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add renderer/render/canvas.js renderer/render/hud.js test/canvas.test.js test/hud.test.js
git commit -m "feat: draw the offhand item and the raised shield; HUD offhand slot for items

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Panel — Offhand button for items, detail line

**Files:**
- Modify: `renderer/ui/inventory-panel-model.js` (`offTile`, `sackActions`), `renderer/ui/inventory-panel.js` (`detailText`)
- Test: `test/inventory-panel-model.test.js` (append)

**Interfaces:**
- `offTile` returns `offhandItem(off)` for an item offhand (sack-item shape, so `iconHtml` works unchanged).
- `sackActions(player, item)`: a shield has no `Equip`; `Offhand` (`onEquipOff`) appears for a weapon, wand or shield only when `canEquip(player, item, 'off').ok`; consumables keep it always.
- `detailText`: `(block N st)` for a shield, `(dmg N)` for blades as today, the spell's name for a wand (`SPELLS[payload.spell].name`), `(protect N)` for outfits; the gate for a shield is `canEquip(player, item, 'off')`.

- [ ] **Step 1: Write the failing tests**

Append to `test/inventory-panel-model.test.js`:
```js
import { makeShieldContents } from '../renderer/systems/entities.js'
describe('offhand items in the strip and the actions', () => {
  it('an item offhand shows as a sack-shaped tile', () => {
    const p = mk()
    p.gear.melee.off = { kind: 'shield', weaponType: 'buckler', name: 'Buckler', blockCost: 8 }
    const tile = gearStrip(p)[0].tiles[1].item
    assert.equal(tile.kind, 'shield')
    assert.equal(tile.payload.weaponType, 'buckler')
  })
  it('Offhand appears only where the item may go', () => {
    const shield = itemFromContents(makeShieldContents('buckler'))
    assert.deepEqual(sackActions(mk(), shield).map(a => a.label), ['Offhand', 'Drop'])
    const archer = mk({ gear: gearWearing('ranger'), attackMode: 'ranged' })
    assert.deepEqual(sackActions(archer, shield).map(a => a.label), ['Drop'])
    const dagger = itemFromContents({ type: 'weapon', ...weaponContents('dagger') })
    assert.deepEqual(sackActions(mk(), dagger).map(a => a.label), ['Equip', 'Offhand', 'Drop'])
    const longsword = itemFromContents({ type: 'weapon', ...weaponContents('longsword') })
    assert.deepEqual(sackActions(mk({ gear: gearWearing('plate') }), longsword).map(a => a.label), ['Equip', 'Drop'])
  })
  it('an item offhand unequips, a pointer clears', () => {
    const p = mk()
    p.gear.melee.off = { kind: 'weapon', weaponType: 'dagger', name: 'Dagger', damage: 1 }
    assert.deepEqual(gearAction(p, 'melee', 'off'), { label: 'Unequip', fn: 'onUnequip' })
  })
})
```

- [ ] **Step 2: Run to see failure** — `node --test test/inventory-panel-model.test.js` → FAIL.

- [ ] **Step 3: Model**

Import `offhandItem, canEquip` from `../systems/inventory.js`. `offTile`: `if (off.kind !== 'consumable') return offhandItem(off)`. In `sackActions`, replace the Offhand line with:
```js
    if (CONSUMABLE_KINDS.includes(item.kind)
      || ((item.kind === 'weapon' || item.kind === 'wand' || item.kind === 'shield') && canEquip(player, item, 'off').ok))
      out.push({ label: 'Offhand', fn: 'onEquipOff' })
```
(a shield never gets `Equip`: the first branch lists only weapon/ranged/wand).

- [ ] **Step 4: Panel detail line**

Import `SPELLS` from `../systems/spells.js`. In `detailText`:
```js
  const stats = item.payload?.blockCost != null ? ` (block ${item.payload.blockCost} st)`
    : item.payload?.damage != null ? ` (${item.payload.damage} dmg)`
    : item.payload?.spell ? ` (${SPELLS[item.payload.spell]?.name ?? item.payload.spell})`
    : item.payload?.protect != null ? ` (protect ${item.payload.protect})` : ''
  const slot = item.kind === 'outfit' ? 'outfit' : item.kind === 'shield' ? 'off' : 'main'
  const gated = ['weapon', 'ranged', 'wand', 'outfit', 'shield'].includes(item.kind)
  const gate = gated ? canEquip(player, item, slot) : { ok: true }
```

- [ ] **Step 5: Run** — `node --test test/inventory-panel-model.test.js` → PASS; `node --check renderer/ui/inventory-panel.js`.

- [ ] **Step 6: Commit**

```bash
git add renderer/ui/inventory-panel-model.js renderer/ui/inventory-panel.js test/inventory-panel-model.test.js
git commit -m "feat: panel offers the offhand to blades, wands and shields; detail line shows block cost and spell

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Live check, docs

**Files:**
- Modify: `~/CLAUDE.md` (dungeon-crawler `inventory` entry: item offhands; new `shield` entry; `player-damage` mention if any), `docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md` (§4: note protect applies to `'hit'` only; the arena/kit `offhand` field), `.claude/skills/arena-test/JOURNAL.md` (one run entry if the arena skill is used)

- [ ] **Step 1: Live check (time-box 10 minutes)**

Read `.claude/skills/arena-test/SKILL.md` for the arena config shape. Run a level-0 arena with `player: { weaponType: 'sword', offhand: { type: 'shield', weaponType: 'buckler' } }` and one `guard` two tiles east of the spawn. Drive it with playwright-core `_electron` (`--dcdebug`): face east, hold `q`, wait for the guard's swing; read `window.__dc.state.player.hp` (unchanged) and the cue log for `shield-block`; release `q`, wait for a swing, hp drops. Second config: `offhand: { type: 'weapon', weaponType: 'dagger' }`, press Space twice 0.5 s apart, read `player.swingHand` after each (`main`, then `off`). Third: `talents: ['magic_stance'], wandType: 'sparkwand', offhand: { type: 'wand', weaponType: 'frostwand' }`, press `q`, expect a projectile in `state.projectiles` and `player.offCooldown > 0`. Record the numbers in the report; do not click the editor Build tab; confirm `git status --short renderer/data/` is clean afterwards.

- [ ] **Step 2: Docs**

CLAUDE.md `renderer/systems/` bullet: extend the `inventory` entry with "an offhand holds a consumable pointer or an item `{ kind:'weapon'|'wand'|'shield', ...payload }` under `OFFHAND_KINDS` per loadout, small blades only (`isSmallBlade`), heavy main hand → consumables only (`two_handed`)"; add ``shield` (hold Q with a shield in the offhand: `tickShield` each frame, `tryBlock` inside `damagePlayer` absorbs frontal `'hit'`s within 60° for `blockCost` stamina and shoves a melee striker; `damagePlayer(state, amount, kind, from)` — every positioned hit passes its source; worn outfit `protect` comes off `'hit'`s only)``; note two small blades alternate (`swingHand`/`nextHandAfter`, offhand cooldown × 0.75) and an offhand wand casts on Q with `offCooldown`. Spec §4/§5: add the `'hit'`-only protect ruling and the kit `offhand` field.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-17-loadouts-and-offhand-design.md .claude/skills/arena-test/JOURNAL.md
git commit -m "docs: offhand behaviours — spec touch-ups, arena journal entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
(`~/CLAUDE.md` is outside the repo; edit it on disk.)

---

## Self-review notes

- **Spec coverage (plan 2 scope):** §2 shields/small blades → Task 1; §4 legality table + two-handed → Task 2; §7 item offhands persist → Task 3; §4 shield (raise, arc, cost, drop, shove, unblockable sources) → Tasks 4–5; §4 wand + blade → Tasks 6–7; §4 HUD icons/dim rules + held-weapon draw → Task 8; §8 panel Offhand button and detail line → Task 9; §5 protect + sprint drain → Task 4 (+ Task 7 wiring). Belt fallback in harvesting and loot stay in plan 3.
- **Type consistency:** the offhand item shape `{ kind, ...payload }` is produced by `equipOffhand` (T2), `normalizeOffhand` (T3), `applyLoadout` (T7) and consumed by `offhandItem` (T1), `heldShield` (T4), `spellFor('off')` (T6), the swing closure (T7), canvas/HUD (T8), `offTile` (T9). `damagePlayer(state, amount, kind, from)` is the same signature in T4 and every T5 caller. `sprintProfile(mode, { skiLegs, drainMul })` in T4 and T7. `tryCast(..., { modules, hand })` in T6 and T7.
- **Known seams left for the final review:** the swing-closure rename in T7 is the one edit that cannot be unit-tested; the live check in T10 covers it. `test/enemy-attack.test.js`'s fixture names in T5 must be adapted to that file's real helpers.
