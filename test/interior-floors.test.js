import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeBuilding, stairAt, shutAt, blockedBy, travel } from '../renderer/interior/floors.js'

const room = () => {
  const map = createMap(5, 5)
  for (const row of map) for (const c of row) c.tile = TILE.FLOOR_WOOD
  return map
}

function setup() {
  const a = {
    id: 'a', map: room(), entities: [], exit: { x: 1, y: 4 }, spawn: { x: 1, y: 3 },
    stairs: [{ id: 'up', x: 3, y: 1, to: { floor: 'b', stair: 'down' }, land: { x: 3, y: 2 } }],
    shut: [{ x: 0, y: 0, line: 'Locked.' }],
  }
  const b = {
    id: 'b', map: room(), entities: [],
    stairs: [{ id: 'down', x: 1, y: 3, to: { floor: 'a', stair: 'up' }, land: { x: 2, y: 3 } }],
    shut: [],
  }
  const building = makeBuilding([a, b], 'a')
  const state = {
    map: a.map, entities: a.entities, player: { x: 3, y: 1, px: 112, py: 48, hp: 10 },
    cave: { building, stairs: { x: 1, y: 4 }, spawn: { x: 1, y: 3 }, offStairs: true },
    projectiles: [{}], zones: [{}], fireZones: [{}], lightning: [{}], strikes: [{}], shockwaves: [{}], hitEffects: [{}],
  }
  return { a, b, building, state }
}

test('travel up lands beside the arriving stair and clears the air', () => {
  const { b, building, state } = setup()
  const s = travel(state, stairAt(building, 3, 1))
  assert.ok(s.map === b.map)
  assert.deepEqual([s.player.x, s.player.y, s.player.px, s.player.py], [2, 3, 80, 112])
  assert.equal(building.at, 'b')
  assert.deepEqual(s.cave.stairs, { x: -1, y: -1 })
  assert.deepEqual(s.cave.spawn, { x: -1, y: -1 })
  assert.equal(s.cave.offStairs, false)
  assert.equal(s.cave.stairHold, true)
  for (const k of ['projectiles', 'zones', 'fireZones', 'lightning', 'strikes', 'shockwaves', 'hitEffects']) assert.equal(s[k].length, 0)
})

test('entities stay with their floor and the way back lands by the stair taken', () => {
  const { a, b, building, state } = setup()
  const npc = { type: 'npc', x: 0, y: 2, hp: 3 }
  state.entities.push(npc)
  const up = travel(state, stairAt(building, 3, 1))
  assert.ok(!up.entities.includes(npc))
  const down = travel(up, stairAt(building, 1, 3))
  assert.ok(down.entities.includes(npc))
  assert.ok(building.floors.get('a').entities === down.entities)
  assert.ok(!building.floors.get('b').entities.includes(npc))
  assert.deepEqual([down.player.x, down.player.y], [3, 2])
  assert.deepEqual(down.cave.stairs, a.exit)
  assert.ok(b.entities !== down.entities)
})

test('a living thing on the landing moves the arrival to a free neighbour, never the stair', () => {
  const { b, building, state } = setup()
  b.entities.push({ x: 2, y: 3, hp: 5 })
  const s = travel(state, stairAt(building, 3, 1))
  const { x, y } = s.player
  assert.equal(Math.max(Math.abs(x - 2), Math.abs(y - 3)), 1)
  assert.ok(!(x === 1 && y === 3))
  // a dead thing does not block
  b.entities[0].hp = 0
  const again = travel(travel(s, stairAt(building, 1, 3)), stairAt(building, 3, 1))
  assert.deepEqual([again.player.x, again.player.y], [2, 3])
})

test('a guard is looked for in the live entity list, not the stored one', () => {
  const { a, building, state } = setup()
  const stair = { ...a.stairs[0], guard: 'g', line: 'Private.' }
  const g = { id: 'g', hp: 3 }
  state.entities.push(g)
  assert.equal(blockedBy(building, stair, state.entities), 'Private.')
  state.entities = state.entities.filter(e => e !== g)
  assert.equal(blockedBy(building, stair, state.entities), null)
  state.entities = [{ id: 'g', hp: 0 }]
  assert.equal(blockedBy(building, stair, state.entities), null)
  state.entities = [{ id: 'g', hp: 2 }]
  assert.equal(blockedBy(building, stair, state.entities), 'Private.')
  assert.equal(blockedBy(building, a.stairs[0], state.entities), null)
})

test('travel names a stair that leads nowhere', () => {
  const { building, state } = setup()
  assert.throws(() => travel(state, { id: 'bad', x: 1, y: 1, to: { floor: 'zz', stair: 'q' } }), /bad.*zz\/q/)
  assert.throws(() => travel(state, { id: 'bad2', x: 1, y: 1, to: { floor: 'b', stair: 'q' } }), /bad2/)
  assert.equal(building.at, 'a')
})

test('shut cells belong to their floor; no building finds nothing', () => {
  const { building, state } = setup()
  assert.equal(shutAt(building, 0, 0).line, 'Locked.')
  travel(state, stairAt(building, 3, 1))
  assert.equal(shutAt(building, 0, 0), null)
  assert.equal(stairAt(undefined, 1, 1), null)
  assert.equal(shutAt(undefined, 1, 1), null)
})
