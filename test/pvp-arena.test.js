import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PVP_ARENAS } from '../renderer/data/pvp-arenas.js'
import { KITS, CLASSES, RUNE_POWER, PVP } from '../renderer/data/pvp.js'
import { buildArena } from '../renderer/systems/map.js'
import { isWalkable } from '../renderer/systems/entities.js'

const arena = PVP_ARENAS.pillars
const { map } = buildArena({ size: arena.size, columns: arena.columns, enemies: [], chests: [] }, () => {})
const walk = ({ x, y }) => isWalkable(map[y]?.[x]?.tile, map[y]?.[x])

describe('pillars arena', () => {
  it('builds at its configured size', () => {
    assert.equal(map.length, arena.size.h)
    assert.equal(map[0].length, arena.size.w)
  })
  it('has six walkable spawns and walkable pickups', () => {
    assert.equal(arena.spawns.length, 6)
    for (const s of arena.spawns) assert.ok(walk(s), `spawn ${s.x},${s.y}`)
    for (const p of arena.pickups) assert.ok(walk(p), `${p.kind} ${p.x},${p.y}`)
  })
  it('has 2 flasks, 2 quivers and 1 rune', () => {
    const n = k => arena.pickups.filter(p => p.kind === k).length
    assert.deepEqual([n('flask'), n('quiver'), n('rune')], [2, 2, 1])
  })
  it('every spawn and pickup is reachable from the first spawn', () => {
    const seen = new Set([`${arena.spawns[0].x},${arena.spawns[0].y}`])
    const queue = [arena.spawns[0]]
    while (queue.length) {
      const c = queue.shift()
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: c.x + dx, y: c.y + dy }
        const k = `${n.x},${n.y}`
        if (!seen.has(k) && walk(n)) { seen.add(k); queue.push(n) }
      }
    }
    for (const p of [...arena.spawns, ...arena.pickups]) assert.ok(seen.has(`${p.x},${p.y}`), `${p.x},${p.y} unreachable`)
  })
  it('the columns really block (at least 40 column cells)', () => {
    assert.ok(arena.columns.length >= 40)
  })
})

describe('pvp data', () => {
  it('has a kit and a rune power for every class', () => {
    assert.deepEqual(CLASSES, ['warrior', 'archer', 'mage'])
    for (const c of CLASSES) { assert.ok(KITS[c]); assert.ok(RUNE_POWER[c]) }
  })
  it('matches the spec numbers', () => {
    assert.equal(PVP.matchLength, 240)
    assert.equal(PVP.ccMul, 0.5)
    assert.equal(PVP.creditWindow, 5)
  })
})
