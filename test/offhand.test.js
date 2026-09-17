import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SHIELD_TYPES, makeShieldContents, isSmallBlade, WEAPON_TYPES, weaponContents, makeWandContents, makePlayer, makeOutfitContents } from '../renderer/systems/entities.js'
import {
  itemFromContents, contentsFromItem, offhandItem,
  addItem, canEquip, canEquipOffhand, equipItem, equipOffhand, unequipOffhand, equipOutfit, unequipOutfit,
  autoEquipOnPickup,
  makeItem, OFFHAND_KINDS, resolveOffhand,
} from '../renderer/systems/inventory.js'
import { iconSpriteFor } from '../renderer/render/icons.js'
import { gearWearing } from './helpers/outfits.js'

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

const mk = (over = {}) => ({ ...makePlayer(1, 1), ...over })
const weapon = wt => itemFromContents({ type: 'weapon', ...weaponContents(wt) })
const shield = st => itemFromContents(makeShieldContents(st))
const wand = wt => itemFromContents(makeWandContents(wt))
const kite = () => ({ kind: 'shield', ...(({ type, ...s }) => s)(makeShieldContents('kite')) })

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
  it('a malformed item with no payload is refused rather than thrown on', () => {
    const p = mk({ gear: gearWearing('plate') })
    assert.deepEqual(canEquipOffhand(p, { kind: 'weapon', name: 'Ghost Blade' }), { ok: false, reason: 'not_equippable' })
    assert.deepEqual(canEquipOffhand(p, { kind: 'shield', name: 'Ghost Shield' }), { ok: false, reason: 'not_equippable' })
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
  it('walking onto an axe sends the offhand dagger back to the sack', () => {
    const p = mk({ gear: gearWearing('plate') })
    addItem(p, weapon('dagger')); equipOffhand(p, 0)
    assert.deepEqual(autoEquipOnPickup(p, weapon('axe')), { ok: true, equipped: true })
    assert.equal(p.weapon.weaponType, 'axe')
    assert.equal(p.gear.melee.off, null)
    assert.deepEqual(p.inventory.map(i => i.payload.weaponType), ['dagger'])
  })
  it('a walked-onto axe with nowhere to put the offhand is not equipped', () => {
    const p = mk({ gear: gearWearing('plate'), maxInventory: 1 })
    addItem(p, weapon('dagger')); equipOffhand(p, 0)   // the dagger leaves the sack
    addItem(p, makeItem('potion'))                     // sack 1/1: no slot for the dagger
    assert.deepEqual(autoEquipOnPickup(p, weapon('axe')), { ok: false, reason: 'full' })
    assert.equal(p.weapon, null)
    assert.equal(p.gear.melee.off.weaponType, 'dagger')
    assert.deepEqual(p.inventory.map(i => i.kind), ['potion'])
  })
  it('taking the plate off evicts the kite shield with the axe', () => {
    const p = mk({ gear: gearWearing('plate'), weapon: weaponContents('axe') })
    p.gear.melee.off = kite()
    assert.equal(unequipOutfit(p, 'melee').ok, true)
    assert.equal(p.gear.melee.off, null)
    assert.deepEqual(p.inventory.map(i => i.kind).sort(), ['outfit', 'shield', 'weapon'])
    const q = mk({ gear: gearWearing('plate'), maxInventory: 1 })
    q.gear.melee.off = kite()
    assert.deepEqual(unequipOutfit(q, 'melee'), { ok: false, reason: 'full' })
  })
  it('the plate carries the Mage offhand kite shield too', () => {
    const p = mk({ gear: gearWearing('plate', 'robe') })
    p.gear.magic.off = kite()
    assert.equal(unequipOutfit(p, 'melee').ok, true)
    assert.equal(p.gear.magic.off, null)
    assert.deepEqual(p.inventory.map(i => i.kind).sort(), ['outfit', 'shield'])
  })
  it('both kite shields are counted when the sack is nearly full', () => {
    const wearing = () => {
      const q = mk({ gear: gearWearing('plate', 'robe'), maxInventory: 2 })
      q.gear.melee.off = kite(); q.gear.magic.off = kite()
      return q
    }
    // plate + two kites need three slots; two is a refusal that moves nothing.
    const tight = wearing()
    assert.deepEqual(unequipOutfit(tight, 'melee'), { ok: false, reason: 'full' })
    assert.equal(tight.gear.melee.off.weaponType, 'kite')
    assert.equal(tight.gear.magic.off.weaponType, 'kite')
    const roomy = wearing(); roomy.maxInventory = 3
    assert.equal(unequipOutfit(roomy, 'melee').ok, true)
    assert.deepEqual(roomy.inventory.map(i => i.kind).sort(), ['outfit', 'shield', 'shield'])
  })
  it('swapping the plate for a lighter outfit evicts every kite shield', () => {
    const p = mk({ gear: gearWearing('plate', 'robe') })
    p.gear.melee.off = kite(); p.gear.magic.off = kite()
    addItem(p, itemFromContents(makeOutfitContents('leather')))
    assert.equal(equipOutfit(p, 0, 'melee').ok, true)
    assert.equal(p.gear.melee.off, null)
    assert.equal(p.gear.magic.off, null)
    assert.deepEqual(p.inventory.map(i => i.kind).sort(), ['outfit', 'shield', 'shield'])
  })
})
