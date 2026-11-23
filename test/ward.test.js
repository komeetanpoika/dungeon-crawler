import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { buildNavGrid, canMoveTo, passable } from '../renderer/systems/nav.js'
import { isWarded } from '../renderer/systems/ward.js'
import { makeNpc, updateNpc } from '../renderer/systems/npc.js'
import { act } from '../renderer/systems/act.js'

const S = 32
// 30x11: open field x 1..11, a 3-tall warded arch at x 12..13 (rows 4..6),
// a warded yard x 14..27 rows 2..8, walls elsewhere.
function cityMap() {
  const map = createMap(30, 11)
  for (let y = 1; y < 10; y++) for (let x = 1; x < 12; x++) map[y][x].tile = TILE.FLOOR
  for (let y = 4; y <= 6; y++) for (let x = 12; x <= 13; x++) { map[y][x].tile = TILE.FLOOR; map[y][x].ward = true }
  for (let y = 2; y <= 8; y++) for (let x = 14; x <= 27; x++) { map[y][x].tile = TILE.FLOOR; map[y][x].ward = true }
  return map
}
function stateFor(map, px, py, entities) {
  return { map, player: { type: 'player', x: px, y: py, px: px * S + S / 2, py: py * S + S / 2, maxHp: 10, hp: 10 }, entities }
}

describe('ward grid', () => {
  it('blocks warded cells; the plain grid does not', () => {
    const map = cityMap()
    const plain = buildNavGrid(map), ward = buildNavGrid(map, { ward: true })
    assert.ok(plain !== ward)
    assert.equal(map._navWard, ward)
    assert.ok(passable(plain, 14, 5)); assert.ok(!passable(ward, 14, 5)); assert.ok(passable(ward, 5, 5))
    assert.equal(ward.walk[5 * ward.w + 12], 0)
    assert.equal(canMoveTo(map, 14 * S + 16, 5 * S + 16, 4), true)
    assert.equal(canMoveTo(map, 14 * S + 16, 5 * S + 16, 4, true), false)
    assert.equal(canMoveTo(map, 5 * S + 16, 5 * S + 16, 4, true), true)
  })
  it('shares the plain grid on a map with no warded cells', () => {
    const map = createMap(8, 8)
    for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) map[y][x].tile = TILE.FLOOR
    assert.equal(buildNavGrid(map, { ward: true }), buildNavGrid(map))
  })
})

describe('isWarded', () => {
  it('warded: monsters and hostile wolves; free: townsfolk, watchmen with a cityKey', () => {
    assert.equal(isWarded(makeNpc({ species: 'wolf', id: 1, x: 1, y: 1 })), true)
    assert.equal(isWarded({ type: 'monster', maxHp: 2, hp: 2 }), true)
    assert.equal(isWarded(makeNpc({ species: 'villager', id: 2, x: 1, y: 1 })), false)
    const watch = { ...makeNpc({ species: 'wolf', id: 3, x: 1, y: 1 }), cityKey: 'w1' }
    assert.equal(watch.hostile, true)
    assert.equal(isWarded(watch), false)
  })
})

describe('monsters stay out', () => {
  it('a wolf chasing the player stops at the warded gate arch', () => {
    const map = cityMap()
    const wolf = makeNpc({ species: 'wolf', id: 1, x: 5, y: 5 })
    const state = stateFor(map, 20, 5, [wolf])
    for (let i = 0; i < 600; i++) {
      updateNpc(wolf, state, 1 / 60)
      const c = map[Math.floor(wolf.py / S)][Math.floor(wolf.px / S)]
      assert.ok(!c.ward, `wolf stood on warded ground at frame ${i} (${wolf.px},${wolf.py})`)
    }
    assert.ok(wolf.px < 12 * S, 'it did get up to the gate')
  })
  it('townsfolk and watchmen walk warded cells', () => {
    for (const cityKey of [undefined, 'w1']) {
      const map = cityMap()
      const e = { ...makeNpc({ species: 'wolf', id: 9, x: 10, y: 5 }), ...(cityKey ? { cityKey } : { hostile: false, type: 'npc' }) }
      if (!cityKey) e.hostile = false
      const state = stateFor(map, 20, 5, [e])
      let onWard = false
      for (let i = 0; i < 600; i++) {
        act(e, state, 1 / 60, { mode: 'patrol', target: { x: 20, y: 5 }, speed: 80 })
        if (map[e.y][e.x].ward) onWard = true
      }
      assert.ok(onWard && e.px > 14 * S, `entity (cityKey=${cityKey}) should have walked in`)
    }
  })
})
