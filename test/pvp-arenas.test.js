import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PVP_ARENAS, PVP_ARENA_ORDER, ARENA_ROWS, parseArena, arenaAt, nextArenaIndex } from '../renderer/data/pvp-arenas.js'
import { DEPTH_THEMES } from '../renderer/data/levels.js'
import { KITS, CLASSES, RUNE_POWER, PVP } from '../renderer/data/pvp.js'
import { arenaMap } from '../renderer/pvp/sim.js'
import { isWalkable, TILE } from '../renderer/systems/entities.js'

const tiles = d => Math.hypot(d.a.x - d.b.x, d.a.y - d.b.y)
const pairs = list => list.flatMap((a, i) => list.slice(i + 1).map(b => ({ a, b })))

describe('parseArena', () => {
  it('turns a grid into the arena shape: interior # walls, o columns, S spawns, F/Q/R pickups in reading order', () => {
    const a = parseArena('t', [
      '#######',
      '#S.o.F#',
      '#.#R#.#',
      '#Q...S#',
      '#######',
    ], { floorTile: 'floor' })
    assert.equal(a.id, 't')
    assert.deepEqual(a.size, { w: 7, h: 5 })
    assert.deepEqual(a.columns, [{ x: 3, y: 1 }])
    assert.deepEqual(a.walls, [{ x: 2, y: 2 }, { x: 4, y: 2 }])
    assert.deepEqual(a.spawns, [{ x: 1, y: 1 }, { x: 5, y: 3 }])
    assert.deepEqual(a.pickups, [{ kind: 'flask', x: 5, y: 1 }, { kind: 'rune', x: 3, y: 2 }, { kind: 'quiver', x: 1, y: 3 }])
    assert.deepEqual(a.theme, { floorTile: 'floor' })
  })
  it('refuses ragged rows, an open border and an unknown cell', () => {
    assert.throws(() => parseArena('t', ['###', '#.', '###']), /equal-length/)
    assert.throws(() => parseArena('t', ['###', '..#', '###']), /border/)
    assert.throws(() => parseArena('t', ['###', '#x#', '###']), /unknown cell/)
  })
})

describe('the rotation', () => {
  it('is pillars, glade, tunnels, ruins, and wraps', () => {
    assert.deepEqual(PVP_ARENA_ORDER, ['pillars', 'glade', 'tunnels', 'ruins'])
    assert.deepEqual([0, 1, 2, 3].map(nextArenaIndex), [1, 2, 3, 0])
    assert.deepEqual([0, 1, 2, 3, 4].map(i => arenaAt(i).id), ['pillars', 'glade', 'tunnels', 'ruins', 'pillars'])
  })
  it('every arena carries its own id and a theme in the DEPTH_THEMES shape', () => {
    for (const id of PVP_ARENA_ORDER) {
      const { theme } = PVP_ARENAS[id]
      assert.equal(PVP_ARENAS[id].id, id)
      assert.equal(typeof theme.bgColor, 'string', id)
      assert.equal(typeof theme.fogAlpha, 'number', id)
      assert.ok(['floor', 'sand'].includes(theme.floorTile), id)
    }
  })
  it("pillars keeps today's depth-0 look", () => {
    const d0 = DEPTH_THEMES.find(t => t.depths.includes(0))
    const { theme } = PVP_ARENAS.pillars
    for (const k of ['floorTile', 'bgColor', 'tint', 'fogAlpha']) assert.equal(theme[k], d0[k], k)
    assert.equal(theme.ruleset, d0.ruleset)
  })
  it('the themes: glade outdoors, tunnels catacombs with the depth-4 tint and fog, ruins the depth-3 sand', () => {
    const d = n => DEPTH_THEMES.find(t => t.depths.includes(n))
    assert.equal(PVP_ARENAS.glade.theme.ruleset, 'outdoors')
    assert.equal(PVP_ARENAS.tunnels.theme.ruleset, 'catacombs')
    assert.equal(PVP_ARENAS.tunnels.theme.tint, d(4).tint)
    assert.equal(PVP_ARENAS.tunnels.theme.fogAlpha, 0.80)
    assert.equal(PVP_ARENAS.ruins.theme.floorTile, 'sand')
    assert.equal(PVP_ARENAS.ruins.theme.tint, d(3).tint)
  })
})

for (const id of PVP_ARENA_ORDER) {
  const arena = PVP_ARENAS[id]
  const map = arenaMap(arena)
  const walk = ({ x, y }) => isWalkable(map[y]?.[x]?.tile, map[y]?.[x])
  describe(`arena invariants: ${id}`, () => {
    it("fits buildArena's size clamp (8-40 × 8-30) and builds at that size", () => {
      assert.ok(arena.size.w >= 8 && arena.size.w <= 40, `w ${arena.size.w}`)
      assert.ok(arena.size.h >= 8 && arena.size.h <= 30, `h ${arena.size.h}`)
      assert.equal(map.length, arena.size.h)
      assert.equal(map[0].length, arena.size.w)
    })
    it('is rectangular with an all-wall border', () => {
      const rows = ARENA_ROWS[id]
      if (rows) for (const r of rows) assert.equal(r.length, arena.size.w)
      for (let x = 0; x < arena.size.w; x++) {
        assert.equal(map[0][x].tile, TILE.WALL); assert.equal(map[arena.size.h - 1][x].tile, TILE.WALL)
      }
      for (let y = 0; y < arena.size.h; y++) {
        assert.equal(map[y][0].tile, TILE.WALL); assert.equal(map[y][arena.size.w - 1].tile, TILE.WALL)
      }
    })
    if (ARENA_ROWS[id]) it('builds tile for tile what the grid says', () => {
      ARENA_ROWS[id].forEach((row, y) => [...row].forEach((ch, x) => {
        const want = ch === '#' ? TILE.WALL : ch === 'o' ? TILE.COLUMN : arena.theme.floorTile === 'sand' ? TILE.SAND : TILE.FLOOR
        assert.equal(map[y][x].tile, want, `${ch} at ${x},${y}`)
      }))
    })
    it('has exactly 6 spawns, 2 flasks, 2 quivers and 1 rune, all on walkable cells', () => {
      const n = k => arena.pickups.filter(p => p.kind === k).length
      assert.equal(arena.spawns.length, 6)
      assert.deepEqual([n('flask'), n('quiver'), n('rune')], [2, 2, 1])
      assert.equal(arena.pickups.length, 5)
      for (const c of [...arena.spawns, ...arena.pickups]) assert.ok(walk(c), `${c.kind ?? 'spawn'} ${c.x},${c.y}`)
    })
    it('every spawn and pickup is reachable from spawn 1', () => {
      const start = arena.spawns[0]
      const seen = new Set([`${start.x},${start.y}`])
      const queue = [start]
      for (let i = 0; i < queue.length; i++) {
        const c = queue[i]
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = { x: c.x + dx, y: c.y + dy }, k = `${n.x},${n.y}`
          if (!seen.has(k) && walk(n)) { seen.add(k); queue.push(n) }
        }
      }
      for (const c of [...arena.spawns, ...arena.pickups]) assert.ok(seen.has(`${c.x},${c.y}`), `${c.x},${c.y} unreachable`)
    })
    it('spawns are at least 6 tiles apart', () => {
      for (const d of pairs(arena.spawns)) assert.ok(tiles(d) >= 6, `${JSON.stringify(d)} ${tiles(d)}`)
    })
    it('the rune is at least 5 tiles from every spawn', () => {
      const rune = arena.pickups.find(p => p.kind === 'rune')
      for (const s of arena.spawns) assert.ok(tiles({ a: s, b: rune }) >= 5, `spawn ${s.x},${s.y}`)
    })
  })
}

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

describe('glade theme', () => {
  it('lays grass over the floor, not the outdoors ruleset sand', () => {
    const skins = PVP_ARENAS.glade.theme.floorSkins
    assert.ok(Array.isArray(skins) && skins.length > 0)
    for (const s of skins) assert.match(s.skin, /^ow_grass_/)
  })
})
