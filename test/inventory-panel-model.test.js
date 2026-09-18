import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { gearStrip, sackActions, gearAction, moveSelection } from '../renderer/ui/inventory-panel-model.js'
import { makePlayer, weaponContents, makeOutfitContents } from '../renderer/systems/entities.js'
import { makeItem, addItem, itemFromContents } from '../renderer/systems/inventory.js'
import { gearWearing } from './helpers/outfits.js'

const mk = over => ({ ...makePlayer(1, 1), ...over })

describe('gearStrip', () => {
  it('lists Warrior, Archer, Mage with locks that follow the outfits', () => {
    const strip = gearStrip(mk({ gear: gearWearing('robe') }))
    assert.deepEqual(strip.map(c => [c.name, c.locked]), [['Warrior', false], ['Archer', true], ['Mage', false]])
    assert.deepEqual(strip.map(c => c.active), [true, false, false])
  })
  it('shows the main hand, the resolved pointer and the outfit per column', () => {
    const p = mk({ weapon: weaponContents('sword'), gear: gearWearing('plate') })
    addItem(p, makeItem('potion', 2))
    const [warrior] = gearStrip(p)
    assert.equal(warrior.tiles[0].item.payload.weaponType, 'sword')
    assert.deepEqual(warrior.tiles[1].item, { kind: 'consumable', item: 'potion', name: 'Potion', emoji: '🧪', count: 2 })
    assert.equal(warrior.tiles[2].item.payload.outfitType, 'plate')
  })
  it('an empty pointer still shows the kind at count 0; a null offhand is null', () => {
    const p = mk()
    assert.equal(gearStrip(p)[0].tiles[1].item.count, 0)
    p.gear.melee.off = null
    assert.equal(gearStrip(p)[0].tiles[1].item, null)
  })
})

describe('sackActions', () => {
  it('a potion drinks, can be pointed at, and drops', () => {
    assert.deepEqual(sackActions(mk(), makeItem('potion')).map(a => a.label), ['Drink', 'Offhand', 'Drop'])
  })
  it('an outfit wears; a weapon equips; a quest item only drops', () => {
    assert.deepEqual(sackActions(mk(), itemFromContents(makeOutfitContents('ranger'))).map(a => [a.label, a.fn]), [['Wear', 'onEquip'], ['Drop', 'onDrop']])
    assert.deepEqual(sackActions(mk(), itemFromContents({ type: 'weapon', ...weaponContents('dagger') })).map(a => a.label), ['Equip', 'Offhand', 'Drop'])
    assert.deepEqual(sackActions(mk(), makeItem('clapper')).map(a => a.label), ['Drop'])
  })
})

describe('gearAction', () => {
  it('unequips a filled hand or outfit, clears a pointer, nothing on empty or locked', () => {
    const p = mk({ weapon: weaponContents('sword'), gear: gearWearing('plate') })
    assert.deepEqual(gearAction(p, 'melee', 'main'), { label: 'Unequip', fn: 'onUnequip' })
    assert.deepEqual(gearAction(p, 'melee', 'outfit'), { label: 'Unequip', fn: 'onUnequip' })
    assert.deepEqual(gearAction(p, 'melee', 'off'), { label: 'Clear', fn: 'onUnequip' })
    assert.equal(gearAction(p, 'ranged', 'main'), null)     // locked
    assert.equal(gearAction(p, 'magic', 'outfit'), null)    // locked and empty
  })
})

describe('moveSelection', () => {
  const counts = { sack: 7, gear: 9 }
  it('moves within the sack grid as before', () => {
    assert.deepEqual(moveSelection({ area: 'sack', index: 0 }, 'ArrowRight', counts), { area: 'sack', index: 1 })
    assert.deepEqual(moveSelection({ area: 'sack', index: 1 }, 'ArrowDown', counts), { area: 'sack', index: 6 })
    assert.deepEqual(moveSelection({ area: 'sack', index: 6 }, 'ArrowRight', counts), { area: 'sack', index: 6 })
  })
  it('Up from the top row enters the strip; Down from the strip returns to the sack', () => {
    assert.deepEqual(moveSelection({ area: 'sack', index: 2 }, 'ArrowUp', counts, 'melee'), { area: 'gear', index: 0 })
    assert.deepEqual(moveSelection({ area: 'sack', index: 2 }, 'ArrowUp', counts, 'magic'), { area: 'gear', index: 6 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 2 }, 'ArrowDown', counts), { area: 'sack', index: 0 })
  })
  it('within the strip, Left/Right change column and Up/Down change tile', () => {
    assert.deepEqual(moveSelection({ area: 'gear', index: 0 }, 'ArrowRight', counts), { area: 'gear', index: 3 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 3 }, 'ArrowDown', counts), { area: 'gear', index: 4 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 8 }, 'ArrowRight', counts), { area: 'gear', index: 9 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 0 }, 'ArrowUp', counts), { area: 'gear', index: 0 })
  })
  it('an empty sack keeps Up/Down between strip and a zero-index sack', () => {
    assert.deepEqual(moveSelection({ area: 'gear', index: 2 }, 'ArrowDown', { sack: 0, gear: 9 }), { area: 'sack', index: 0 })
  })
})

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

import { beltTile, gearAt } from '../renderer/ui/inventory-panel-model.js'
describe('the belt in the panel', () => {
  it('shows the worn tool as a weapon tile, or nothing', () => {
    assert.equal(beltTile(mk()).item, null)
    const t = beltTile(mk({ belt: weaponContents('hatchet') }))
    assert.equal(t.slot, 'belt')
    assert.equal(t.item.kind, 'weapon')
    assert.equal(t.item.payload.weaponType, 'hatchet')
  })
  it('sits at gear index 9, right of the Mage column', () => {
    assert.deepEqual(gearAt(9), { stance: 'belt', slot: 'belt' })
    const counts = { sack: 3, gear: 10 }
    assert.deepEqual(moveSelection({ area: 'gear', index: 6 }, 'ArrowRight', counts), { area: 'gear', index: 9 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 8 }, 'ArrowRight', counts), { area: 'gear', index: 9 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 9 }, 'ArrowLeft', counts), { area: 'gear', index: 6 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 9 }, 'ArrowDown', counts), { area: 'sack', index: 0 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 9 }, 'ArrowUp', counts), { area: 'gear', index: 9 })
    assert.deepEqual(moveSelection({ area: 'gear', index: 9 }, 'ArrowRight', counts), { area: 'gear', index: 9 })
  })
  it('offers Belt to tools the player can wear, Unequip on the tile', () => {
    const hatchet = itemFromContents({ type: 'weapon', ...weaponContents('hatchet') })
    assert.deepEqual(sackActions(mk(), hatchet).map(a => a.label), ['Equip', 'Offhand', 'Belt', 'Drop'])
    const axe = itemFromContents({ type: 'weapon', ...weaponContents('axe') })
    assert.deepEqual(sackActions(mk(), axe).map(a => a.label), ['Equip', 'Drop'])
    assert.deepEqual(sackActions(mk({ gear: gearWearing('plate') }), axe).map(a => a.label), ['Equip', 'Belt', 'Drop'])
    const sword = itemFromContents({ type: 'weapon', ...weaponContents('sword') })
    assert.deepEqual(sackActions(mk(), sword).map(a => a.label), ['Equip', 'Offhand', 'Drop'])
    assert.equal(gearAction(mk(), 'belt', 'belt'), null)
    assert.deepEqual(gearAction(mk({ belt: weaponContents('pick') }), 'belt', 'belt'), { label: 'Unequip', fn: 'onUnequip' })
  })
})
