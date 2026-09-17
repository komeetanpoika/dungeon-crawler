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
