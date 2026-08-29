import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeItem, itemFromContents, contentsFromItem, addItem, removeItem,
  canEquip, equipItem, autoEquipOnPickup, EQUIP_FAIL_MESSAGES,
  findQuickUseIndex, quickUseSummary,
} from '../renderer/systems/inventory.js'

const mkPlayer = (over = {}) => ({
  inventory: [], maxInventory: 10, weapon: null, ranged: null, talents: [], ...over,
})
const swordContents = () => ({ type: 'weapon', weaponType: 'sword', name: 'Sword', damage: 2 })
const bowContents = () => ({ type: 'ranged', weaponType: 'shortbow', name: 'Shortbow',
  damage: 2, ammo: 12, maxAmmo: 12, cooldown: 0.6, color: '#facc15', kind: 'bow' })

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
    assert.deepEqual(r1, { ok: true, equipped: false })
    assert.equal(untrained.ranged, null)
    assert.equal(untrained.inventory.length, 1)

    const trained = mkPlayer({ talents: ['ranged_stance'] })
    const r2 = autoEquipOnPickup(trained, itemFromContents(bowContents()))
    assert.deepEqual(r2, { ok: true, equipped: true })
    assert.equal(trained.ranged.weaponType, 'shortbow')
    assert.equal(trained.inventory.length, 0)
  })

  it('reports full when neither hand nor sack can take it', () => {
    const p = mkPlayer({ maxInventory: 0, weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } })
    assert.deepEqual(autoEquipOnPickup(p, itemFromContents(swordContents())), { ok: false, reason: 'full' })
  })

  it('round-trips contents for dropping', () => {
    const item = itemFromContents(bowContents())
    assert.deepEqual(contentsFromItem(item), bowContents())
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
  it('is a stackable consumable that heals 2', () => {
    const m = makeItem('meat')
    assert.equal(m.stackable, true); assert.equal(m.heal, 2); assert.equal(m.kind, 'meat')
    assert.equal(findQuickUseIndex([m]), 0)
    assert.deepEqual(itemFromContents({ type: 'meat' }).kind, 'meat')
    assert.deepEqual(contentsFromItem(m), { type: 'meat' })
  })
})
