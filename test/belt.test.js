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

import { resolveTool, findHarvestHit, harvest, TREES } from '../renderer/systems/lumber.js'
import { TILE } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

const grassMap = () => { const m = createMap(8, 8); for (const row of m) for (const c of row) { c.tile = TILE.FLOOR; c.overlay = 'ow_grass' } return m }
const plant = (m, x, y, overlay) => { m[y][x].tile = TILE.WALL; m[y][x].overlay = overlay; m[y][x].losSoft = true }
const at = (x, y, belt = null) => ({ x, y, px: x * 32 + 16, py: y * 32 + 16, belt })
const anyHit = () => true

describe('resolveTool', () => {
  it('takes the weapon’s own values first and fills the gaps from the belt', () => {
    assert.deepEqual(resolveTool({ chop: 2 }, { chop: 1, mine: 1 }), { chop: 2, mine: 1 })
    assert.deepEqual(resolveTool({ damage: 1 }, { chop: 1 }), { chop: 1 })
    assert.deepEqual(resolveTool({ damage: 1 }, null), {})
    assert.deepEqual(resolveTool(null, { mine: 1 }), { mine: 1 })
    assert.deepEqual(resolveTool({ chop: 1 }, undefined), { chop: 1 })
  })
})

describe('a dagger swing with a hatchet on the belt', () => {
  const tree = Object.keys(TREES).find(k => TREES[k].cells === 1 && !TREES[k].border) ?? Object.keys(TREES)[0]
  it('finds the tree the dagger alone could not', () => {
    const m = grassMap(); plant(m, 3, 3, tree)
    const dagger = weaponContents('dagger')
    assert.equal(findHarvestHit(m, at(2, 3), anyHit, 46, dagger), null)
    assert.deepEqual(findHarvestHit(m, at(2, 3, weaponContents('hatchet')), anyHit, 46, dagger), { x: 3, y: 3 })
  })
  it('the resolved tool fells it at the belt’s chop, never the weapon’s damage', () => {
    const m = grassMap(); plant(m, 3, 3, tree)
    const tool = resolveTool(weaponContents('dagger'), weaponContents('hatchet'))
    assert.deepEqual(tool, { chop: 1 })
    const first = harvest(m, 3, 3, tool)
    assert.equal(first.kind, 'tree')
    assert.equal(m[3][3].chopHp, TREES[tree].hp - 1)
  })
  it('a pick on the belt lets a sword crack rock', () => {
    const m = grassMap(); m[3][3].overlay = 'ow_rock_gray_0'; m[3][3].tile = TILE.WALL
    const sword = weaponContents('sword')
    assert.equal(findHarvestHit(m, at(2, 3), anyHit, 46, sword), null)
    assert.deepEqual(findHarvestHit(m, at(2, 3, weaponContents('pick')), anyHit, 46, sword), { x: 3, y: 3 })
  })
})
