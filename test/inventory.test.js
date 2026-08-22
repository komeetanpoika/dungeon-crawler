import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeItem, itemFromContents, contentsFromItem, addItem, removeItem,
  canEquip, equipItem, autoEquipOnPickup, EQUIP_FAIL_MESSAGES,
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
    const p = mkPlayer()
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

  it('reports full when neither hand nor sack can take it', () => {
    const p = mkPlayer({ maxInventory: 0, weapon: { weaponType: 'dagger', name: 'Dagger', damage: 1 } })
    assert.deepEqual(autoEquipOnPickup(p, itemFromContents(swordContents())), { ok: false, reason: 'full' })
  })

  it('round-trips contents for dropping', () => {
    const item = itemFromContents(bowContents())
    assert.deepEqual(contentsFromItem(item), bowContents())
  })
})
