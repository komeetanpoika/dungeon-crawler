import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeItem, itemFromContents, contentsFromItem, addItem, removeItem,
  canEquip, equipItem, autoEquipOnPickup, addAmmo, spendAmmo, EQUIP_FAIL_MESSAGES,
  findQuickUseIndex, quickUseSummary,
} from '../renderer/systems/inventory.js'
import { makeRangedContents, makeWandContents, emptyAmmo } from '../renderer/systems/entities.js'

const mkPlayer = (over = {}) => ({
  inventory: [], maxInventory: 10, weapon: null, ranged: null, wand: null, talents: [], ...over,
})
const swordContents = () => ({ type: 'weapon', weaponType: 'sword', name: 'Sword', damage: 2 })
// Bows no longer carry ammo/maxAmmo of their own — makeRangedContents gives the
// pool-shaped fields (ammoKind, bundle) that Task 1 defined.
const bowContents = () => makeRangedContents('shortbow')
const crossbowContents = () => makeRangedContents('crossbow')
const wandContents = () => makeWandContents('sparkwand')
// Hand-slot shape: same fields as *Contents() minus `type` — mirrors what
// equipItem/autoEquipOnPickup actually stash in player.wand/player.ranged.
const heldWand = type => { const { type: _t, ...payload } = makeWandContents(type); return payload }

describe('stacking and capacity', () => {
  it('stackables merge into one slot with a growing count', () => {
    const p = mkPlayer()
    addItem(p, makeItem('potion'))
    addItem(p, makeItem('potion'))
    assert.equal(p.inventory.length, 1)
    assert.equal(p.inventory[0].count, 2)
  })

  it('weapons take one slot each', () => {
    const p = mkPlayer()
    addItem(p, itemFromContents(swordContents()))
    addItem(p, itemFromContents(swordContents()))
    assert.equal(p.inventory.length, 2)
  })

  it('a full sack refuses new slots but still stacks', () => {
    const p = mkPlayer({ maxInventory: 1 })
    assert.equal(addItem(p, makeItem('potion')).ok, true)
    assert.deepEqual(addItem(p, itemFromContents(swordContents())), { ok: false, reason: 'full' })
    assert.equal(addItem(p, makeItem('potion')).ok, true)   // stacking needs no new slot
    assert.equal(p.inventory[0].count, 2)
  })

  it('removeItem decrements a stack and splices the last one', () => {
    const p = mkPlayer()
    addItem(p, makeItem('mushroom')); addItem(p, makeItem('mushroom'))
    removeItem(p, 0)
    assert.equal(p.inventory[0].count, 1)
    removeItem(p, 0)
    assert.equal(p.inventory.length, 0)
  })

  it('removeItem on a weapon item returns it without injecting count, and it round-trips', () => {
    const p = mkPlayer()
    const sword = itemFromContents(swordContents())
    addItem(p, sword)
    const removed = removeItem(p, 0)
    assert.equal(removed.count, undefined)
    assert.equal(p.inventory.length, 0)
    assert.deepEqual(contentsFromItem(removed), swordContents())
  })
})

describe('equipping', () => {
  it('equipping a weapon from the sack fills the hand and empties the slot', () => {
    const p = mkPlayer()
    addItem(p, itemFromContents(swordContents()))
    const r = equipItem(p, 0)
    assert.equal(r.ok, true)
    assert.equal(p.weapon.weaponType, 'sword')
    assert.equal(p.inventory.length, 0)
  })

  it('equipping over a held weapon swaps it back into the sack', () => {
    const p = mkPlayer({ weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } })
    addItem(p, itemFromContents(swordContents()))
    equipItem(p, 0)
    assert.equal(p.weapon.weaponType, 'sword')
    assert.equal(p.inventory.length, 1)
    assert.equal(p.inventory[0].payload.weaponType, 'dagger')
  })

  it('ranged items equip into the ranged hand', () => {
    const p = mkPlayer({ talents: ['ranged_stance'] })
    addItem(p, itemFromContents(bowContents()))
    equipItem(p, 0)
    assert.equal(p.ranged.weaponType, 'shortbow')
  })

  it('potions are not equippable', () => {
    const p = mkPlayer()
    addItem(p, makeItem('potion'))
    assert.deepEqual(equipItem(p, 0), { ok: false, reason: 'not_equippable' })
  })

  it('a heavy weapon refuses without the heavy_weapons talent and equips with it', () => {
    const heavy = itemFromContents({ type: 'weapon', weaponType: 'axe', name: 'Axe', damage: 4, heavy: true })
    assert.deepEqual(canEquip(mkPlayer(), heavy), { ok: false, reason: 'heavy' })
    assert.equal(canEquip(mkPlayer({ talents: ['heavy_weapons'] }), heavy).ok, true)
    assert.ok(EQUIP_FAIL_MESSAGES.heavy)
  })

  it('a ranged weapon refuses without ranged_stance and equips with it', () => {
    const bow = itemFromContents(bowContents())
    assert.deepEqual(canEquip(mkPlayer(), bow), { ok: false, reason: 'not_learned' })
    assert.equal(canEquip(mkPlayer({ talents: ['ranged_stance'] }), bow).ok, true)
    assert.ok(EQUIP_FAIL_MESSAGES.not_learned)
  })

  it('a crossbow (heavy ranged) needs both ranged_stance and heavy_weapons', () => {
    const crossbow = itemFromContents(crossbowContents())
    assert.deepEqual(canEquip(mkPlayer(), crossbow), { ok: false, reason: 'not_learned' })
    assert.deepEqual(canEquip(mkPlayer({ talents: ['ranged_stance'] }), crossbow), { ok: false, reason: 'heavy' })
    assert.equal(canEquip(mkPlayer({ talents: ['ranged_stance', 'heavy_weapons'] }), crossbow).ok, true)
  })

  it('a wand refuses without magic_stance and equips with it', () => {
    const wand = itemFromContents(wandContents())
    assert.deepEqual(canEquip(mkPlayer(), wand), { ok: false, reason: 'not_learned' })
    assert.equal(canEquip(mkPlayer({ talents: ['magic_stance'] }), wand).ok, true)
  })

  it('equipping a wand from the sack fills the wand hand', () => {
    const p = mkPlayer({ talents: ['magic_stance'] })
    addItem(p, itemFromContents(wandContents()))
    const r = equipItem(p, 0)
    assert.equal(r.ok, true)
    assert.equal(p.wand.weaponType, 'sparkwand')
    assert.equal(p.inventory.length, 0)
  })

  it('equipping a wand over a held one swaps the old wand back into the sack', () => {
    const p = mkPlayer({ talents: ['magic_stance'], wand: heldWand('frostwand') })
    addItem(p, itemFromContents(wandContents()))
    equipItem(p, 0)
    assert.equal(p.wand.weaponType, 'sparkwand')
    assert.equal(p.inventory.length, 1)
    assert.equal(p.inventory[0].kind, 'wand')
    assert.equal(p.inventory[0].emoji, '🪄')
    assert.equal(p.inventory[0].payload.weaponType, 'frostwand')
  })
})

describe('pickup auto-equip', () => {
  it('auto-equips into an empty allowed hand', () => {
    const p = mkPlayer()
    const r = autoEquipOnPickup(p, itemFromContents(swordContents()))
    assert.deepEqual(r, { ok: true, equipped: true })
    assert.equal(p.weapon.weaponType, 'sword')
    assert.equal(p.inventory.length, 0)
  })

  it('goes to the sack when the hand is full', () => {
    const p = mkPlayer({ weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } })
    const r = autoEquipOnPickup(p, itemFromContents(swordContents()))
    assert.deepEqual(r, { ok: true, equipped: false })
    assert.equal(p.inventory.length, 1)
  })

  it('a heavy pickup with an empty hand still goes to the sack untrained', () => {
    const p = mkPlayer()
    const heavy = itemFromContents({ type: 'weapon', weaponType: 'axe', name: 'Axe', damage: 4, heavy: true })
    const r = autoEquipOnPickup(p, heavy)
    assert.deepEqual(r, { ok: true, equipped: false })
    assert.equal(p.weapon, null)
  })

  it('a bow pickup without ranged_stance goes to the sack, hand stays empty; with the talent it equips', () => {
    const untrained = mkPlayer()
    const r1 = autoEquipOnPickup(untrained, itemFromContents(bowContents()))
    // The bundle rides on every ranged outcome, so game.js floats "+12" for a
    // first bow exactly as it does for a merged duplicate.
    assert.deepEqual(r1, { ok: true, equipped: false, ammo: 12, ammoKind: 'arrow' })
    assert.equal(untrained.ranged, null)
    assert.equal(untrained.inventory.length, 1)

    const trained = mkPlayer({ talents: ['ranged_stance'] })
    const r2 = autoEquipOnPickup(trained, itemFromContents(bowContents()))
    assert.deepEqual(r2, { ok: true, equipped: true, ammo: 12, ammoKind: 'arrow' })
    assert.equal(trained.ranged.weaponType, 'shortbow')
    assert.equal(trained.inventory.length, 0)
  })

  it('a bow pickup always tops up the ammo pool by its bundle, even when it goes to the sack', () => {
    const p = mkPlayer()
    autoEquipOnPickup(p, itemFromContents(bowContents()))   // shortbow bundle 12
    assert.equal(p.ammo.arrow, 12)
  })

  it('a wand pickup with an empty allowed hand equips regardless of talent (talent only gates casting via canEquip)', () => {
    // canEquip still gates the *sack* equip path — an untalented player's wand
    // pickup should behave the same as any other gated item: sack, not hand.
    const untrained = mkPlayer()
    const r1 = autoEquipOnPickup(untrained, itemFromContents(wandContents()))
    assert.deepEqual(r1, { ok: true, equipped: false })
    assert.equal(untrained.wand, null)
    assert.equal(untrained.inventory.length, 1)

    const trained = mkPlayer({ talents: ['magic_stance'] })
    const r2 = autoEquipOnPickup(trained, itemFromContents(wandContents()))
    assert.deepEqual(r2, { ok: true, equipped: true })
    assert.equal(trained.wand.weaponType, 'sparkwand')
    assert.equal(trained.inventory.length, 0)
  })

  it('a wand pickup goes to the sack when the wand hand is full', () => {
    const p = mkPlayer({ talents: ['magic_stance'], wand: heldWand('frostwand') })
    const r = autoEquipOnPickup(p, itemFromContents(wandContents()))
    assert.deepEqual(r, { ok: true, equipped: false })
    assert.equal(p.wand.weaponType, 'frostwand')
    assert.equal(p.inventory.length, 1)
    assert.equal(p.inventory[0].kind, 'wand')
  })

  it('a duplicate wand goes to the sack like any item — no merging for wands', () => {
    const p = mkPlayer({ talents: ['magic_stance'], wand: heldWand('sparkwand') })
    const r = autoEquipOnPickup(p, itemFromContents(wandContents()))
    assert.deepEqual(r, { ok: true, equipped: false })
    assert.equal(p.inventory.length, 1)
  })

  it('an ammo pickup goes straight into the pool and is never a sack item', () => {
    const p = mkPlayer()
    const r = autoEquipOnPickup(p, { kind: 'ammo', ammoKind: 'arrow', count: 10 })
    assert.deepEqual(r, { ok: true, equipped: false, ammo: 10, ammoKind: 'arrow' })
    assert.equal(p.ammo.arrow, 10)
    assert.equal(p.inventory.length, 0)
  })

  it('an ammo pickup caps at AMMO_CAPS and reports only what was actually added', () => {
    const p = mkPlayer({ ammo: { arrow: 38, bolt: 0, stone: 0 } })
    const r = autoEquipOnPickup(p, { kind: 'ammo', ammoKind: 'arrow', count: 10 })
    assert.deepEqual(r, { ok: true, equipped: false, ammo: 2, ammoKind: 'arrow' })
    assert.equal(p.ammo.arrow, 40)
  })

  it('a second copy of the held ranged weapon is discarded; its bundle tops up the pool instead of taking a slot', () => {
    const p = mkPlayer({ talents: ['ranged_stance'], ranged: makeRangedContents('shortbow') })
    p.ammo = { arrow: 3, bolt: 0, stone: 0 }
    const r = autoEquipOnPickup(p, itemFromContents(bowContents()))
    assert.deepEqual(r, { ok: true, equipped: false, merged: 'hand', ammo: 12, ammoKind: 'arrow' })
    assert.equal(p.ammo.arrow, 15)
    assert.equal(p.inventory.length, 0)   // the duplicate weapon itself never entered the sack
  })

  it('a copy of a ranged weapon already in the sack tops up the pool and is discarded too', () => {
    const p = mkPlayer({ inventory: [itemFromContents(bowContents())] })
    const r = autoEquipOnPickup(p, itemFromContents(bowContents()))
    assert.deepEqual(r, { ok: true, equipped: false, merged: 'sack', ammo: 12, ammoKind: 'arrow' })
    assert.equal(p.inventory.length, 1)   // still just the original sack copy
    assert.equal(p.ammo.arrow, 12)
  })

  it('merging still works even when the sack is full, and only for the same weapon type', () => {
    const full = mkPlayer({ maxInventory: 1, inventory: [itemFromContents(bowContents())] })
    assert.equal(autoEquipOnPickup(full, itemFromContents(bowContents())).ok, true)
    assert.equal(full.inventory.length, 1)
    assert.equal(full.ammo.arrow, 12)
    const other = itemFromContents(makeRangedContents('longbow'))   // different weaponType, also arrow
    assert.deepEqual(autoEquipOnPickup(full, other), { ok: false, reason: 'full' })
    assert.equal(full.inventory.length, 1)
  })

  it('the pool ammo cap is AMMO_CAPS, not tied to any one weapon\'s bundle', () => {
    const p = mkPlayer({ ranged: makeRangedContents('shortbow'), ammo: { arrow: 36, bolt: 0, stone: 0 } })
    const r = autoEquipOnPickup(p, itemFromContents(bowContents()))   // bundle 12, cap 40
    assert.deepEqual(r, { ok: true, equipped: false, merged: 'hand', ammo: 4, ammoKind: 'arrow' })
    assert.equal(p.ammo.arrow, 40)
    const again = autoEquipOnPickup(p, itemFromContents(bowContents()))
    assert.deepEqual(again, { ok: true, equipped: false, merged: 'hand', ammo: 0, ammoKind: 'arrow' })
    assert.equal(p.ammo.arrow, 40)
  })

  it('reports full when neither hand nor sack can take it', () => {
    const p = mkPlayer({ maxInventory: 0, weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } })
    assert.deepEqual(autoEquipOnPickup(p, itemFromContents(swordContents())), { ok: false, reason: 'full' })
  })

  it('round-trips contents for dropping', () => {
    const item = itemFromContents(bowContents())
    assert.deepEqual(contentsFromItem(item), bowContents())
  })

  it('wand contents round-trip through the sack too', () => {
    const item = itemFromContents(wandContents())
    assert.equal(item.kind, 'wand')
    assert.equal(item.emoji, '🪄')
    assert.deepEqual(contentsFromItem(item), wandContents())
  })

  it('a looted longsword refuses to equip untrained end-to-end', () => {
    const p = mkPlayer()
    const contents = { type: 'weapon', weaponType: 'longsword', name: 'Longsword', damage: 3, heavy: true }
    autoEquipOnPickup(p, itemFromContents(contents))
    assert.equal(p.weapon, null)
    assert.equal(p.inventory.length, 1)
    p.talents = ['heavy_weapons']
    assert.equal(equipItem(p, 0).ok, true)
    assert.equal(p.weapon.heavy, true)
  })
})

describe('ammo pool', () => {
  it('addAmmo creates player.ammo via emptyAmmo() on first use', () => {
    const p = mkPlayer()
    delete p.ammo
    const added = addAmmo(p, 'stone', 5)
    assert.equal(added, 5)
    assert.deepEqual(p.ammo, { ...emptyAmmo(), stone: 5 })
  })

  it('addAmmo caps at AMMO_CAPS and returns only what fit', () => {
    const p = mkPlayer({ ammo: { arrow: 0, bolt: 22, stone: 0 } })
    assert.equal(addAmmo(p, 'bolt', 5), 2)
    assert.equal(p.ammo.bolt, 24)
    assert.equal(addAmmo(p, 'bolt', 5), 0)
    assert.equal(p.ammo.bolt, 24)
  })

  it('spendAmmo deducts and returns true when there is enough', () => {
    const p = mkPlayer({ ammo: { arrow: 5, bolt: 0, stone: 0 } })
    assert.equal(spendAmmo(p, 'arrow'), true)
    assert.equal(p.ammo.arrow, 4)
    assert.equal(spendAmmo(p, 'arrow', 4), true)
    assert.equal(p.ammo.arrow, 0)
  })

  it('spendAmmo refuses and leaves the pool untouched when there is not enough', () => {
    const p = mkPlayer({ ammo: { arrow: 2, bolt: 0, stone: 0 } })
    assert.equal(spendAmmo(p, 'arrow', 3), false)
    assert.equal(p.ammo.arrow, 2)
  })

  it('an unknown ammo kind is refused outright, never written into the pool', () => {
    // A legacy pickup with no ammoKind would otherwise write `undefined: NaN`.
    const p = mkPlayer({ ammo: emptyAmmo() })
    assert.equal(addAmmo(p, 'pebble', 5), 0)
    assert.equal(addAmmo(p, undefined, 5), 0)
    assert.deepEqual(p.ammo, emptyAmmo())
  })

  it('spendAmmo creates the pool via emptyAmmo() and fails against zero', () => {
    const p = mkPlayer()
    delete p.ammo
    assert.equal(spendAmmo(p, 'stone'), false)
    assert.deepEqual(p.ammo, emptyAmmo())
  })
})

describe('legacy contents normalization', () => {
  it('a pre-redesign ranged contents is rebuilt from the weapon table', () => {
    const item = itemFromContents({ type: 'ranged', weaponType: 'shortbow', name: 'Bow',
      damage: 1, ammo: 7, maxAmmo: 12 })
    const { type: _t, ...fresh } = makeRangedContents('shortbow')
    assert.deepEqual(item.payload, fresh)
    assert.equal(item.payload.ammo, undefined)
    assert.equal(item.payload.maxAmmo, undefined)
    assert.equal(item.payload.damage, 2)       // table damage, not the stale 1
  })

  it('a wand contents is rebuilt from the wand table too', () => {
    const item = itemFromContents({ type: 'wand', weaponType: 'frostwand', name: 'Old Name' })
    const { type: _t, ...fresh } = makeWandContents('frostwand')
    assert.deepEqual(item.payload, fresh)
    assert.equal(item.name, fresh.name)
  })

  it('an unknown ranged or wand type yields no item at all', () => {
    assert.equal(itemFromContents({ type: 'ranged', weaponType: 'raygun', ammo: 3 }), null)
    assert.equal(itemFromContents({ type: 'wand', weaponType: 'noodle' }), null)
  })

  it("a legacy contents' own ammo count is dropped; only the table bundle is credited", () => {
    const p = mkPlayer({ talents: ['ranged_stance'] })
    const r = autoEquipOnPickup(p, itemFromContents({ type: 'ranged', weaponType: 'shortbow', ammo: 7 }))
    assert.equal(r.ammo, 12)          // the bundle, once — not 12 + 7
    assert.equal(p.ammo.arrow, 12)
  })
})

describe('quick-use consumable', () => {
  const potion = (count = 1) => ({ ...makeItem('potion'), count })
  const mushroom = (count = 1) => ({ ...makeItem('mushroom'), count })
  const sword = () => itemFromContents(swordContents())

  it('finds the first consumable slot in sack order', () => {
    assert.equal(findQuickUseIndex([sword(), potion()]), 1)
    assert.equal(findQuickUseIndex([mushroom(), potion()]), 0)
  })

  it('returns -1 when the sack has no consumables', () => {
    assert.equal(findQuickUseIndex([]), -1)
    assert.equal(findQuickUseIndex([sword()]), -1)
  })

  it('summarizes the next-up emoji with the combined consumable count', () => {
    assert.deepEqual(quickUseSummary([sword(), potion(2), mushroom(3)]),
      { emoji: '🧪', count: 5 })
    assert.deepEqual(quickUseSummary([mushroom()]), { emoji: '🍄', count: 1 })
  })

  it('summarizes an empty or consumable-free sack as null', () => {
    assert.equal(quickUseSummary([]), null)
    assert.equal(quickUseSummary([sword()]), null)
  })
})

describe('meat', () => {
  it('is a stackable consumable that heals 1', () => {
    const m = makeItem('meat')
    assert.equal(m.stackable, true); assert.equal(m.heal, 1); assert.equal(m.kind, 'meat')
    assert.equal(findQuickUseIndex([m]), 0)
    assert.deepEqual(itemFromContents({ type: 'meat' }).kind, 'meat')
    assert.deepEqual(contentsFromItem(m), { type: 'meat', count: 1 })
  })
})

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
  it('quest items (clapper, fleece) are not consumable and round-trip through contents', () => {
    assert.equal(makeItem('clapper').quest, true)
    assert.equal(findQuickUseIndex([makeItem('clapper')]), -1)
    assert.equal(itemFromContents({ type: 'fleece' }).kind, 'fleece')
  })
})

describe('deadwood', () => {
  it('deadwood is a stackable kind', () => assert.equal(makeItem('deadwood', 2).count, 2))
})
