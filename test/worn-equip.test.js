// The four worn slots (head, armor, boots, ring): one table, per-character
// slots beside the offhand and the outfit, and the rules for putting a piece
// on and taking it off.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  itemFromContents, contentsFromItem, addItem, canEquip, equipWorn, unequipWorn, wornOf,
  equipOutfit, unequipOutfit, autoEquipOnPickup,
} from '../renderer/systems/inventory.js'
import { makePlayer, makeWornContents, makeOutfitContents, WORN_TYPES, WORN_SLOTS, OUTFIT_TYPES, defaultGear } from '../renderer/systems/entities.js'
import { gearWearing } from './helpers/outfits.js'

const mk = (over = {}) => ({ ...makePlayer(1, 1), ...over })
const piece = key => itemFromContents(makeWornContents(key))
const give = (p, key) => { addItem(p, piece(key)); return p.inventory.length - 1 }
const fill = p => { while (p.inventory.length < p.maxInventory) p.inventory.push({ kind: 'filler', name: 'x', stackable: false }) }

describe('the table of worn pieces', () => {
  it('holds fourteen pieces over the four slots', () => {
    assert.deepEqual(WORN_SLOTS, ['head', 'armor', 'boots', 'ring'])
    assert.equal(Object.keys(WORN_TYPES).length, 14)
    for (const def of Object.values(WORN_TYPES)) assert.ok(WORN_SLOTS.includes(def.slot), def.name)
  })
  it('makes contents by key, typed by the slot, and nothing for a key it does not know', () => {
    assert.deepEqual(makeWornContents('chain'), { type: 'armor', gearType: 'chain', name: 'Chain Shirt', armor: 3, sprintMul: 1.5 })
    assert.deepEqual(makeWornContents('plate'), { type: 'armor', gearType: 'plate', name: 'Plate Cuirass', armor: 5, sprintMul: 2, heavy: true })
    assert.equal(makeWornContents('horned').power, 'ram')
    assert.equal(makeWornContents('nonsense'), null)
  })
  it('a fresh hero has the four slots, empty, on each character', () => {
    const g = defaultGear()
    for (const stance of ['melee', 'ranged', 'magic'])
      for (const slot of WORN_SLOTS) assert.equal(g[stance][slot], null)
  })
  it('the cyclops outfit is the tabard: it opens heavy steel and protects nothing', () => {
    assert.deepEqual(makeOutfitContents('plate'), { type: 'outfit', outfitType: 'plate', name: "Knight's Tabard", loadout: 'melee', heavy: true })
    assert.equal(OUTFIT_TYPES.leather, undefined)
    assert.equal(makeOutfitContents('leather'), null)
  })
})

describe('pieces as bag items', () => {
  it('a piece is an item of its slot, keyed by gearType, and goes back to contents whole', () => {
    const cap = piece('cap')
    assert.equal(cap.kind, 'head')
    assert.equal(cap.name, 'Leather Cap')
    assert.equal(cap.stackable, false)
    assert.equal(cap.payload.gearType, 'cap')
    assert.deepEqual(contentsFromItem(cap), makeWornContents('cap'))
  })
  it('contents are rebuilt from the table, and an unknown key is nothing', () => {
    const stale = itemFromContents({ type: 'armor', gearType: 'leather', armor: 99, name: 'Old' })
    assert.equal(stale.payload.armor, 2)
    assert.equal(stale.name, 'Leather Jerkin')
    assert.equal(itemFromContents({ type: 'boots', gearType: 'nonsense' }), null)
    // a key of another slot is not minted under the wrong kind
    assert.equal(itemFromContents({ type: 'boots', gearType: 'cap' }), null)
  })
  it('an old Leather Coat lying about is a Leather Jerkin when picked up', () => {
    const it = itemFromContents({ type: 'outfit', outfitType: 'leather', name: 'Leather Coat', loadout: null, protect: 1 })
    assert.equal(it.kind, 'armor')
    assert.equal(it.payload.gearType, 'leather')
  })
})

describe('wearing and taking off', () => {
  it('a piece goes on the character being played, out of the bag', () => {
    const p = mk()
    const i = give(p, 'cap')
    assert.equal(equipWorn(p, i).ok, true)
    assert.equal(wornOf(p, 'head').gearType, 'cap')
    assert.equal(p.inventory.length, 0)
    assert.equal(wornOf(p, 'head', 'ranged'), null)
    assert.equal(wornOf(p, 'head', 'magic'), null)
  })
  it('each character has slots of its own', () => {
    const p = mk({ gear: gearWearing('ranger') })
    equipWorn(p, give(p, 'cap'))
    p.attackMode = 'ranged'
    assert.equal(wornOf(p, 'head'), null)
    equipWorn(p, give(p, 'helm'))
    assert.equal(wornOf(p, 'head').gearType, 'helm')
    assert.equal(wornOf(p, 'head', 'melee').gearType, 'cap')
  })
  it('a second piece of the slot swaps the first back into the bag', () => {
    const p = mk()
    equipWorn(p, give(p, 'cap'))
    assert.equal(equipWorn(p, give(p, 'helm')).ok, true)
    assert.equal(wornOf(p, 'head').gearType, 'helm')
    assert.deepEqual(p.inventory.map(i => i.payload.gearType), ['cap'])
  })
  it('a swap works with a full bag: one out, one in', () => {
    const p = mk()
    equipWorn(p, give(p, 'cap'))
    const i = give(p, 'helm')
    fill(p)
    assert.equal(equipWorn(p, i).ok, true)
    assert.equal(p.inventory.length, p.maxInventory)
  })
  it('taking a piece off needs a bag slot, and moves nothing without one', () => {
    const p = mk()
    equipWorn(p, give(p, 'elk'))
    fill(p)
    assert.deepEqual(unequipWorn(p, 'boots'), { ok: false, reason: 'full' })
    assert.equal(wornOf(p, 'boots').gearType, 'elk')
    p.inventory.pop()
    assert.equal(unequipWorn(p, 'boots').ok, true)
    assert.equal(wornOf(p, 'boots'), null)
    assert.equal(p.inventory.at(-1).payload.gearType, 'elk')
  })
  it('an empty slot has nothing to take off', () => {
    assert.deepEqual(unequipWorn(mk(), 'ring'), { ok: false, reason: 'not_equippable' })
  })
  it('a thing that is no worn piece is refused', () => {
    const p = mk()
    addItem(p, itemFromContents({ type: 'weapon', weaponType: 'sword', name: 'Sword', damage: 2 }))
    assert.deepEqual(equipWorn(p, 0), { ok: false, reason: 'not_equippable' })
    assert.deepEqual(canEquip(p, piece('cap'), 'armor'), { ok: false, reason: 'not_equippable' })
    assert.equal(canEquip(p, piece('cap'), 'head').ok, true)
  })
})

describe('plate is heavy', () => {
  it('needs the tabard on the Warrior', () => {
    const p = mk()
    const i = give(p, 'plate')
    assert.deepEqual(equipWorn(p, i), { ok: false, reason: 'heavy' })
    assert.equal(p.inventory.length, 1)
    const knight = mk({ gear: gearWearing('plate') })
    assert.equal(equipWorn(knight, give(knight, 'plate')).ok, true)
  })
  it('with the tabard on the Warrior, the Mage may wear plate too', () => {
    const p = mk({ gear: gearWearing('plate', 'robe'), attackMode: 'magic' })
    assert.equal(equipWorn(p, give(p, 'plate')).ok, true)
    assert.equal(wornOf(p, 'armor', 'magic').gearType, 'plate')
  })
  const twoPlates = () => {
    const p = mk({ gear: gearWearing('plate', 'robe') })
    equipWorn(p, give(p, 'plate'))
    p.attackMode = 'magic'
    equipWorn(p, give(p, 'plate'))
    p.attackMode = 'melee'
    return p
  }
  it('the tabard coming off sends every worn cuirass to the bag', () => {
    const p = twoPlates()
    assert.equal(unequipOutfit(p, 'melee').ok, true)
    assert.equal(wornOf(p, 'armor', 'melee'), null)
    assert.equal(wornOf(p, 'armor', 'magic'), null)
    assert.deepEqual(p.inventory.map(i => i.kind).sort(), ['armor', 'armor', 'outfit'])
  })
  it('without room for all of it the tabard stays on and nothing moves', () => {
    const p = twoPlates()
    fill(p)
    p.inventory.length = p.maxInventory - 2          // room for the tabard and one cuirass only
    const before = p.inventory.length
    assert.deepEqual(unequipOutfit(p, 'melee'), { ok: false, reason: 'full' })
    assert.equal(p.inventory.length, before)
    assert.equal(wornOf(p, 'armor', 'melee').gearType, 'plate')
    assert.equal(wornOf(p, 'armor', 'magic').gearType, 'plate')
    assert.equal(p.gear.melee.outfit.outfitType, 'plate')
  })
  it('a lighter piece stays on when the tabard goes', () => {
    const p = mk({ gear: gearWearing('plate') })
    equipWorn(p, give(p, 'chain'))
    unequipOutfit(p, 'melee')
    assert.equal(wornOf(p, 'armor').gearType, 'chain')
  })
})

describe('walking onto a piece', () => {
  it('puts it on the character being played when that slot is bare', () => {
    const p = mk()
    assert.deepEqual(autoEquipOnPickup(p, piece('cap')), { ok: true, equipped: true, worn: true })
    assert.equal(wornOf(p, 'head').gearType, 'cap')
    assert.equal(wornOf(p, 'head', 'ranged'), null)
    assert.equal(p.inventory.length, 0)
  })
  it('goes to the bag when the slot is taken, duplicates kept', () => {
    const p = mk()
    autoEquipOnPickup(p, piece('cap'))
    assert.deepEqual(autoEquipOnPickup(p, piece('cap')), { ok: true, equipped: false })
    assert.equal(p.inventory.length, 1)
  })
  it('a cuirass the hero cannot lift goes to the bag', () => {
    const p = mk()
    assert.deepEqual(autoEquipOnPickup(p, piece('plate')), { ok: true, equipped: false })
    assert.equal(wornOf(p, 'armor'), null)
  })
  it('is refused whole by a full bag when the slot is taken', () => {
    const p = mk()
    autoEquipOnPickup(p, piece('cap'))
    fill(p)
    assert.deepEqual(autoEquipOnPickup(p, piece('helm')), { ok: false, reason: 'full' })
  })
})
