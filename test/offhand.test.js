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
