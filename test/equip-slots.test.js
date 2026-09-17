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
