import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from '../tools/png-read.mjs'
import { MapBuilder } from '../tools/static-overworld/lib.mjs'
import { MTN, LAT_PX, LAT_PY, isMassSkin, rimShape, stampMass, stampRock, clearMountain, stampMountainRim } from '../tools/static-overworld/mountain.mjs'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { buildOpenMap } from '../renderer/systems/openmap.js'
import { TILE, hasLineOfSight, computePlayerFOV, makePlayer } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'
import { HARVEST } from '../renderer/systems/lumber.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.join(HERE, '../renderer/assets/tiles')
const rng = () => 0.5
const f = (s = '') => ({ N: s.includes('N'), E: s.includes('E'), S: s.includes('S'), W: s.includes('W') })
const d = () => ({ NE: false, NW: false, SE: false, SW: false })
const png = n => readPng(path.join(TILES, `${n}.png`))
const alphaAt = (p, x, y) => p.pixels[(y * p.width + x) * 4 + 3]

describe('mountain tiles on disk', () => {
  it('every tile the rules can pick exists as a 16x16 PNG, and no name is used twice', () => {
    const names = [...MTN.ground, ...MTN.shade, ...MTN.lat.flat(), ...Object.values(MTN.ridge).flat(), ...MTN.rock]
    assert.equal(new Set(names).size, names.length)
    for (const n of names) { const p = png(n); assert.equal(`${p.width}x${p.height}`, '16x16', n) }
  })
  it('a lattice cell with an open north side has transparent pixels along its top edge and is opaque at its foot', () => {
    let clear = 0
    for (let q = 0; q < LAT_PX * LAT_PY; q++) {
      const p = png(MTN.lat[1][q])
      for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) if (alphaAt(p, x, y) === 0) clear++
      for (let x = 0; x < 16; x++) assert.equal(alphaAt(p, x, 15), 255, `${q}:${x}`)
    }
    assert.ok(clear > 40, `only ${clear} transparent pixels along the top three rows`)
  })
  it('an interior lattice cell is fully opaque; a keyed piece has both transparent and opaque pixels', () => {
    const p = png(MTN.lat[0][5])
    for (let i = 3; i < p.pixels.length; i += 4) assert.equal(p.pixels[i], 255)
    for (const n of [MTN.lat[15][0], MTN.rock[0], MTN.ridge.dr[0]]) {
      const q = png(n)
      const a = new Set(); for (let i = 3; i < q.pixels.length; i += 4) a.add(q.pixels[i])
      assert.deepEqual([...a].sort(), [0, 255], n)
    }
  })
  it('the shade tile is darker at its top rows than its plain ground and equal lower down', () => {
    const g = png(MTN.ground[0]), s = png(MTN.shade[0])
    const row = (p, y) => { let t = 0; for (let x = 0; x < 16; x++) t += p.pixels[(y * 16 + x) * 4]; return t }
    assert.ok(row(s, 0) < row(g, 0) * 0.75)
    assert.equal(row(s, 12), row(g, 12))
  })
})

describe('rimShape', () => {
  it('returns the open-side mask for a lattice cell', () => {
    assert.equal(rimShape(f(), d()), 0)
    assert.equal(rimShape(f('N'), d()), 1)
    assert.equal(rimShape(f('E'), d()), 2)
    assert.equal(rimShape(f('S'), d()), 4)
    assert.equal(rimShape(f('W'), d()), 8)
    assert.equal(rimShape(f('NE'), d()), 3)
    assert.equal(rimShape(f('ESW'), d()), 14)
  })
  it('an island is a lattice cell open on all sides; a one-cell wall is a ridge wall unless a thin lattice is asked for', () => {
    assert.equal(rimShape(f('NESW'), d()), 15)
    assert.equal(rimShape(f('NS'), d(), { walls: 'lattice' }), 5)
    assert.equal(rimShape(f('NS'), d()), 'wall')
    assert.equal(rimShape(f('EW'), d()), 'wall')
    assert.equal(rimShape(f('N'), d()), 1)
  })
})

describe('stampMountainRim', () => {
  const fresh = (w = 12, h = 12) => {
    const b = new MapBuilder('t', 'forest', 't', w, h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.g(x, y, MTN.ground[0])
    return b
  }
  const block = () => { const b = fresh(); for (let y = 3; y <= 7; y++) for (let x = 3; x <= 8; x++) stampMass(b, rng, x, y); return b }
  const prop = (b, x, y) => b.palette[b.prop[y][x]]
  const ground = (b, x, y) => b.palette[b.ground[y][x]]
  const latAt = (m, x, y) => MTN.lat[m][(x % LAT_PX) + LAT_PX * (y % LAT_PY)]

  it('paints every mass cell with the lattice tile for its mask and lattice position', () => {
    const b = block()
    stampMountainRim(b, rng)
    assert.equal(prop(b, 5, 5), latAt(0, 5, 5))
    assert.equal(prop(b, 5, 3), latAt(1, 5, 3))       // north face
    assert.equal(prop(b, 8, 5), latAt(2, 8, 5))       // east face
    assert.equal(prop(b, 3, 7), latAt(4 | 8, 3, 7))   // south-west corner
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 8; x++) assert.equal(b.walkable(x, y), false)
    assert.equal(b.walkable(2, 5), true)
  })

  it('with apron on, shades only the mountain ground directly south of a mass, and undoes it when the mass goes', () => {
    const b = block()
    stampMountainRim(b, rng, { apron: true })
    assert.equal(ground(b, 5, 8), MTN.shade[0])
    assert.equal(ground(b, 5, 2), MTN.ground[0])
    assert.equal(ground(b, 2, 5), MTN.ground[0])
    assert.equal(ground(b, 9, 8), MTN.ground[0])   // diagonal only
    clearMountain(b, rng, 5, 7, 0)
    stampMountainRim(b, rng, { apron: true })
    assert.match(ground(b, 5, 8), /^ow_mtn_ground_/)
    assert.match(ground(b, 5, 7), /^ow_mtn_shade_/)
  })

  it('by default the ground is not shaded', () => {
    const b = block()
    stampMountainRim(b, rng)
    assert.equal(ground(b, 5, 8), MTN.ground[0])
  })

  it('leaves grass alone', () => {
    const b = block()
    b.g(5, 8, 'ow_grass_0')
    stampMountainRim(b, rng)
    assert.equal(ground(b, 5, 8), 'ow_grass_0')
  })

  it('an island is the all-sides-open lattice cell, still blocked; rocks are blocked props that clear to ground', () => {
    const b = fresh(8, 8)
    stampMass(b, rng, 4, 4)
    stampRock(b, rng, 1, 1)
    stampMountainRim(b, rng)
    assert.equal(prop(b, 4, 4), latAt(15, 4, 4))
    assert.equal(b.walkable(4, 4), false)
    assert.equal(b.walkable(1, 1), false)
    clearMountain(b, rng, 1, 1, 0)
    assert.equal(b.walkable(1, 1), true)
    assert.equal(b.prop[1][1], -1)
  })

  it('mass running off the map shows no face against the edge', () => {
    const b = fresh(8, 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x <= 3; x++) stampMass(b, rng, x, y)
    stampMountainRim(b, rng)
    assert.equal(prop(b, 0, 4), latAt(0, 0, 4))
    assert.equal(prop(b, 3, 4), latAt(2, 3, 4))
  })

  it('is idempotent over a finished map', () => {
    const b = block()
    stampMountainRim(b, rng)
    const once = JSON.stringify(b.toJSON())
    stampMountainRim(b, rng)
    assert.equal(JSON.stringify(b.toJSON()), once)
  })
})

describe('Mountain Pass (depth 12)', () => {
  const m = OPEN_MAPS[12]
  const propAt = (x, y) => m.prop[y][x] >= 0 ? m.palette[m.prop[y][x]] : null
  const mass = (x, y) => x < 0 || y < 0 || x >= m.w || y >= m.h || isMassSkin(propAt(x, y))

  it('keeps its name, title and story POIs', () => {
    assert.equal(m.name, 'forest-3-autumn')
    assert.equal(m.title, 'Mountain Pass')
    const labels = m.pois.map(p => p.label)
    for (const l of ['stone circle', 'hermit hut', 'old mine 1', 'old mine 2']) assert.ok(labels.includes(l), l)
  })

  it('has no rock props from the old set left and wears the mountain tileset', () => {
    assert.deepEqual(m.palette.filter(n => n.startsWith('ow_rock')), [])
    assert.ok(m.palette.some(n => n.startsWith('ow_mtn_lat_')))
  })

  it('every mountain cell is blocked and wears the lattice tile for its open sides', () => {
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
      const p = propAt(x, y)
      if (!p?.startsWith('ow_mtn_')) continue
      assert.equal(m.walk[y][x], '0', `${x},${y} ${p}`)
      if (!p.startsWith('ow_mtn_lat_')) continue
      const want = (mass(x, y - 1) ? 0 : 1) | (mass(x + 1, y) ? 0 : 2) | (mass(x, y + 1) ? 0 : 4) | (mass(x - 1, y) ? 0 : 8)
      assert.equal(p, MTN.lat[want][(x % LAT_PX) + LAT_PX * (y % LAT_PY)], `${x},${y}`)
    }
  })

  it('still keeps its autumn woods', () => {
    let trees = 0
    for (const row of m.prop) for (const i of row) if (i >= 0 && m.palette[i].startsWith('ow_tree')) trees++
    assert.ok(trees > 1500, `only ${trees} trees`)
  })

  it('mountain masses are not mineable; the boulders are, like the rocks they replaced', () => {
    for (const n of m.palette) {
      if (n.startsWith('ow_mtn_rock_')) assert.equal(HARVEST[n]?.tool, 'mine', n)
      else if (n.startsWith('ow_mtn_')) assert.equal(HARVEST[n], undefined, n)
    }
  })
})

describe('Wadi Canyon (depth 14)', () => {
  const m = OPEN_MAPS[14]
  const propAt = (x, y) => m.prop[y][x] >= 0 ? m.palette[m.prop[y][x]] : null
  const mass = (x, y) => x < 0 || y < 0 || x >= m.w || y >= m.h || isMassSkin(propAt(x, y))

  it('keeps its title, POIs and spawn', () => {
    assert.equal(m.title, 'Wadi Canyon')
    const labels = m.pois.map(p => p.label)
    for (const l of ['hidden oasis', 'buried temple', 'deep cave', 'wadi camp']) assert.ok(labels.includes(l), l)
    assert.deepEqual(m.playerSpawn, { x: 10, y: 42 })
    assert.equal(m.walk[42][10], '1')
  })

  it('its massif is mountain, not brown boulders, and every mass cell wears the lattice for its open sides', () => {
    assert.deepEqual(m.palette.filter(n => n.startsWith('ow_rock_brown')), [])
    let cells = 0
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
      const p = propAt(x, y)
      if (!p?.startsWith('ow_mtn_lat_')) continue
      cells++
      assert.equal(m.walk[y][x], '0', `${x},${y}`)
      const want = (mass(x, y - 1) ? 0 : 1) | (mass(x + 1, y) ? 0 : 2) | (mass(x, y + 1) ? 0 : 4) | (mass(x - 1, y) ? 0 : 8)
      assert.equal(p, MTN.lat[want][(x % LAT_PX) + LAT_PX * (y % LAT_PY)], `${x},${y}`)
    }
    assert.ok(cells > 5000, `only ${cells} mass cells`)
  })

  it('keeps its hardpan wadis walkable', () => {
    let hardpan = 0
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.palette[m.ground[y][x]].startsWith('ow_hardpan') && m.walk[y][x] === '1') hardpan++
    assert.ok(hardpan > 800, `only ${hardpan} walkable hardpan cells`)
  })
})

describe('line of sight through mountains (losTall)', () => {
  const open = () => {
    const map = createMap(20, 20)
    for (const row of map) for (const t of row) t.tile = TILE.FLOOR
    return map
  }
  it('a mountain behind a mountain is seen, the ground behind it is not', () => {
    const map = open()
    for (let x = 7; x <= 12; x++) { map[5][x].tile = TILE.WALL; map[5][x].losTall = true }
    assert.equal(hasLineOfSight(map, 5, 5, 5, 7), true)
    assert.equal(hasLineOfSight(map, 5, 5, 5, 10), true)
    assert.equal(hasLineOfSight(map, 5, 5, 5, 12), true)
    assert.equal(hasLineOfSight(map, 5, 5, 5, 14), false)
  })
  it('a plain wall still hides what is behind it, mountain or not', () => {
    const map = open()
    map[5][7].tile = TILE.WALL
    map[5][9].tile = TILE.WALL; map[5][9].losTall = true
    assert.equal(hasLineOfSight(map, 5, 5, 5, 9), false)
  })
  it('buildOpenMap stamps losTall on Mountain Pass masses, not on rocks or ground', () => {
    const { map } = buildOpenMap(OPEN_MAPS[12], { depth: 12 })
    const m = OPEN_MAPS[12]
    let tall = 0
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
      const p = m.prop[y][x] >= 0 ? m.palette[m.prop[y][x]] : null
      const expect = isMassSkin(p)
      assert.equal(!!map[y][x].losTall, expect, `${x},${y} ${p}`)
      if (expect) tall++
    }
    assert.ok(tall > 1000)
  })
  it('the FOV lights a whole mountain face from the pass', () => {
    const { map } = buildOpenMap(OPEN_MAPS[12], { depth: 12 })
    const player = makePlayer(84, 24)
    computePlayerFOV(map, player, 8)
    let litTall = 0
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      const t = map[24 + dy]?.[84 + dx]
      if (t?.losTall && t.visible) litTall++
    }
    assert.ok(litTall > 20, `only ${litTall} mountain cells lit`)
  })
})
