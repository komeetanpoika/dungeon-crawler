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
