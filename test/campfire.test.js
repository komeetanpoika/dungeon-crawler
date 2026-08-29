import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAMPFIRE_COST, CAMPFIRE_DURATION, canBuildCampfire, buildSpot, makeCampfire, spendLumber,
  tickCampfires, campfireAlpha, cookMeat,
} from '../renderer/systems/campfire.js'
import { makeItem } from '../renderer/systems/inventory.js'
import { TILE } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

const mkPlayer = (inventory = []) => ({ x: 3, y: 3, px: 112, py: 112, inventory, maxInventory: 10 })
function grass() {
  const m = createMap(7, 7)
  for (const row of m) for (const c of row) c.tile = TILE.FLOOR
  return m
}

describe('building', () => {
  it('needs three lumber', () => {
    assert.equal(CAMPFIRE_COST, 3)
    assert.deepEqual(canBuildCampfire(mkPlayer([makeItem('lumber', 2)])), { ok: false, reason: 'lumber' })
    assert.deepEqual(canBuildCampfire(mkPlayer([makeItem('lumber', 3)])), { ok: true })
  })
  it('spendLumber removes exactly the cost and drops an emptied stack', () => {
    const p = mkPlayer([makeItem('lumber', 4)])
    spendLumber(p)
    assert.equal(p.inventory[0].count, 1)
    const q = mkPlayer([makeItem('lumber', 3)]); spendLumber(q)
    assert.deepEqual(q.inventory, [])
  })
  it('buildSpot picks the first free orthogonal walkable tile, skipping occupied ones', () => {
    const m = grass(); const p = mkPlayer()
    assert.deepEqual(buildSpot(m, [], p), { x: 2, y: 3 })
    assert.deepEqual(buildSpot(m, [{ x: 2, y: 3 }], p), { x: 4, y: 3 })
    m[3][2].tile = TILE.WALL; m[3][4].tile = TILE.WALL; m[2][3].tile = TILE.WALL; m[4][3].tile = TILE.WALL
    assert.equal(buildSpot(m, [], p), null)
  })
  it('makeCampfire is a fresh fire centred on its tile', () => {
    assert.deepEqual(makeCampfire(2, 3), { type: 'campfire', x: 2, y: 3, px: 80, py: 112, t: 0 })
  })
})

describe('burning out', () => {
  it('fires age and vanish after a minute; other entities are untouched', () => {
    assert.equal(CAMPFIRE_DURATION, 60)
    const guard = { type: 'guard', hp: 3 }
    const r1 = tickCampfires([guard, makeCampfire(1, 1)], 59)
    assert.equal(r1.entities.length, 2)
    assert.deepEqual(r1.expired, [])
    const r2 = tickCampfires(r1.entities, 1.5)
    assert.deepEqual(r2.entities, [guard])
    assert.equal(r2.expired.length, 1)
    assert.equal(r2.expired[0].type, 'campfire')
  })
  it('the flame dims over the last ten seconds', () => {
    assert.equal(campfireAlpha({ t: 0 }), 1)
    assert.equal(campfireAlpha({ t: 50 }), 1)
    const late = campfireAlpha({ t: 55 })
    assert.ok(late < 1 && late > 0.3, `alpha ${late}`)
    assert.ok(campfireAlpha({ t: 60 }) <= 0.3 + 1e-9)
  })
})

describe('cooking', () => {
  it('turns every raw meat into cooked meat and reports the count', () => {
    const p = mkPlayer([makeItem('lumber'), makeItem('meat', 3)])
    assert.equal(cookMeat(p), 3)
    assert.deepEqual(p.inventory.map(i => [i.kind, i.count]), [['lumber', 1], ['cooked_meat', 3]])
  })
  it('stacks onto cooked meat already carried', () => {
    const p = mkPlayer([makeItem('cooked_meat', 2), makeItem('meat', 1)])
    assert.equal(cookMeat(p), 1)
    assert.deepEqual(p.inventory.map(i => [i.kind, i.count]), [['cooked_meat', 3]])
  })
  it('is a no-op without raw meat', () => {
    const p = mkPlayer([makeItem('potion')])
    assert.equal(cookMeat(p), 0)
    assert.equal(p.inventory.length, 1)
  })
})
