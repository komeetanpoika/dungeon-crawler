import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { traceBeam, reflect, findSun, solveSun } from '../renderer/interior/sunroom.js'
import { generateInterior, specFor } from '../renderer/interior/index.js'
import { MISC } from '../renderer/interior/kit.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'

// A bare 9x9 floor with walls round it.
function room() {
  return Array.from({ length: 9 }, (_, y) => Array.from({ length: 9 }, (_, x) =>
    ({ tile: x === 0 || y === 0 || x === 8 || y === 8 ? TILE.WALL : TILE.FLOOR_WOOD })))
}
const mirror = (m, x, y, o) => Object.assign(m[y][x], { tile: TILE.WALL, losClear: true, mirror: o })
const target = (m, x, y) => Object.assign(m[y][x], { tile: TILE.WALL, losClear: true, sun: 'target' })

describe('the sunbeam', () => {
  it('turns at a mirror the way the mirror leans', () => {
    assert.deepEqual(['S', 'N', 'E', 'W'].map(d => reflect('/', d)), ['W', 'E', 'N', 'S'])
    assert.deepEqual(['S', 'N', 'E', 'W'].map(d => reflect('\\', d)), ['E', 'W', 'S', 'N'])
  })
  it('runs straight until a wall, and says where it stopped', () => {
    const m = room()
    const b = traceBeam(m, { x: 4, y: 1, dir: 'S' })
    assert.deepEqual(b.cells.map(c => c.y), [1, 2, 3, 4, 5, 6, 7])
    assert.equal(b.hit, null)
    assert.deepEqual(b.end, { x: 4, y: 7, dir: 'S' })
  })
  it('follows the mirrors to the seed', () => {
    const m = room()
    mirror(m, 4, 5, '\\')        // S -> E
    mirror(m, 7, 5, '/')         // E -> N
    target(m, 7, 2)
    const b = traceBeam(m, { x: 4, y: 1, dir: 'S' })
    assert.deepEqual(b.hit, { x: 7, y: 2 })
    assert.deepEqual(b.cells.map(c => `${c.x},${c.y}`), ['4,1', '4,2', '4,3', '4,4', '4,5', '5,5', '6,5', '7,5', '7,4', '7,3'])
    m[5][4].mirror = '/'         // turned the wrong way: S -> W, into the wall
    assert.equal(traceBeam(m, { x: 4, y: 1, dir: 'S' }).hit, null)
  })
  it('is stopped by furniture, and passes over people and rugs', () => {
    const m = room()
    m[4][4].deco = 'in_rug_green_mm'
    Object.assign(m[6][4], { tile: TILE.WALL, losClear: true, overlay: 'in_table_small' })
    assert.deepEqual(traceBeam(m, { x: 4, y: 1, dir: 'S' }).end, { x: 4, y: 5, dir: 'S' })
  })
})

const sunrooms = (n, solved = false) => Array.from({ length: n }, (_, i) =>
  generateInterior(specFor({ version: 'sunroom', size: ['large', 'grand'][i % 2], seed: i + 1, label: `sun:${i}` }), { solved }))
const mirrorsOf = map => map.flatMap((row, y) => row.flatMap((c, x) => c.mirror ? [{ x, y, c }] : []))

function reach(map, from) {
  const seen = new Set([`${from.x},${from.y}`]), q = [from]
  while (q.length) {
    const { x, y } = q.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`
      if (!seen.has(k) && map[ny]?.[nx] && isWalkable(map[ny][nx].tile, map[ny][nx])) { seen.add(k); q.push({ x: nx, y: ny }) }
    }
  }
  return seen
}

describe('Päivölä, the glassmaker\'s house', () => {
  it('has its puzzle in the hall: a window, a seed, mirrors and a panel in the wall', () => {
    for (const g of sunrooms(300)) {
      const sun = findSun(g.map)
      assert.ok(sun && sun.start && sun.target && sun.alcove && sun.window, 'no puzzle')
      assert.equal(g.map[sun.target.y][sun.target.x].overlay, MISC.seed)
      assert.equal(g.map[sun.alcove.y][sun.alcove.x].overlay, MISC.panel)
      assert.equal(g.map[sun.start.y][sun.start.x].roomId, g.plan.entry, 'the puzzle is in the hall')
      const ms = mirrorsOf(g.map)
      assert.ok(ms.length >= 4 && ms.length <= 7, `${ms.length} mirrors`)
      for (const { c } of ms) assert.equal(c.overlay, MISC.mirror[c.mirror])
    }
  })
  it('is never solved as built, and can always be solved by turning mirrors', () => {
    for (const g of sunrooms(300)) {
      const sun = findSun(g.map)
      assert.equal(traceBeam(g.map, sun.start).hit, null, 'already solved')
      const ms = mirrorsOf(g.map)
      let solvable = false
      for (let bits = 0; bits < 1 << ms.length && !solvable; bits++) {
        ms.forEach(({ c }, i) => { c.mirror = bits & (1 << i) ? '/' : '\\' })
        if (traceBeam(g.map, sun.start).hit) solvable = true
      }
      assert.ok(solvable, 'no way to the seed')
    }
  })
  it('lets every mirror be walked into, and cuts no floor off', () => {
    for (const g of sunrooms(300)) {
      const seen = reach(g.map, g.playerSpawn)
      g.map.forEach((row, y) => row.forEach((c, x) => { if (isWalkable(c.tile, c)) assert.ok(seen.has(`${x},${y}`), `${x},${y} cut off`) }))
      for (const { x, y } of mirrorsOf(g.map))
        assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(`${x + dx},${y + dy}`)), `mirror at ${x},${y} out of reach`)
      const below = findSun(g.map).alcove
      assert.ok(seen.has(`${below.x},${below.y + 1}`), 'the panel cannot be reached')
    }
  })
  it('the glassmaker is at home, friendly, with a hint', () => {
    for (const g of sunrooms(20)) {
      const gm = g.entitySpawns.filter(s => s.role === 'glassmaker')
      assert.equal(gm.length, 1)
      assert.equal(gm[0].hostile, false)
      assert.ok(gm[0].lines.some(l => /walk into/i.test(l)), 'no hint how mirrors turn')
      assert.ok(!g.entitySpawns.some(s => s.kind === 'monster' || s.kind === 'chest'))
    }
  })
  it('built solved: the beam reaches the bloom, the panel is open, flowers line the way, no chest', () => {
    for (const g of sunrooms(60, true)) {
      const sun = findSun(g.map)
      const beam = traceBeam(g.map, sun.start)
      assert.deepEqual(beam.hit, sun.target)
      assert.equal(g.map[sun.target.y][sun.target.x].overlay, MISC.bloom)
      const niche = g.map[sun.alcove.y][sun.alcove.x]
      assert.ok(isWalkable(niche.tile), 'the alcove is open')
      assert.equal(niche.skin, MISC.nicheFloor)
      assert.equal(g.map[sun.alcove.y - 1][sun.alcove.x].overlay, MISC.nicheTop)
      assert.ok(beam.cells.some(c => MISC.flowers.includes(g.map[c.y][c.x].deco)), 'no flowers')
      assert.ok(!g.entitySpawns.some(s => s.kind === 'chest'))
      assert.ok(g.entitySpawns.find(s => s.role === 'glassmaker').lines.some(l => /gold/i.test(l)))
    }
  })
  it('solveSun names every cell it changed', () => {
    const g = sunrooms(1)[0]
    const sun = findSun(g.map)
    for (const { c } of mirrorsOf(g.map)) c.mirror = c.solution
    const changed = solveSun(g.map, sun)
    const keys = new Set(changed.map(c => `${c.x},${c.y}`))
    assert.ok(keys.has(`${sun.target.x},${sun.target.y}`) && keys.has(`${sun.alcove.x},${sun.alcove.y}`) && keys.has(`${sun.alcove.x},${sun.alcove.y - 1}`))
  })
})
