import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from '../tools/png-read.mjs'
import { MapBuilder } from '../tools/static-overworld/lib.mjs'
import { MTN, isMass, isMassSkin, rimShape, stampMass, clearMountain, stampMountainRim } from '../tools/static-overworld/mountain.mjs'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { buildOpenMap } from '../renderer/systems/openmap.js'
import { TILE, hasLineOfSight, computePlayerFOV, makePlayer } from '../renderer/systems/entities.js'
import { createMap } from '../renderer/systems/map.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.join(HERE, '../renderer/assets/tiles')
const rng = () => 0.5

const f = (s = '') => ({ N: s.includes('N'), E: s.includes('E'), S: s.includes('S'), W: s.includes('W') })
const d = (s = '') => ({ NE: s.includes('NE'), NW: s.includes('NW'), SE: s.includes('SE'), SW: s.includes('SW') })

describe('mountain tiles on disk', () => {
  it('every tile the rim pass can pick exists as a 16x16 PNG', () => {
    const names = [...MTN.floor, ...MTN.peak, ...MTN.scree, ...Object.values(MTN.edge).flat()]
    assert.equal(new Set(names).size, names.length)
    for (const n of names) {
      const png = readPng(path.join(TILES, `${n}.png`))
      assert.equal(`${png.width}x${png.height}`, '16x16', n)
    }
  })
})

describe('rimShape', () => {
  it('a straight face runs the ridge along it', () => {
    assert.equal(rimShape(f('S'), d()), 'h')
    assert.equal(rimShape(f('N'), d()), 'h')
    assert.equal(rimShape(f('E'), d()), 'v')
    assert.equal(rimShape(f('W'), d()), 'v')
  })
  it('convex corners turn toward the two mass sides', () => {
    assert.equal(rimShape(f('SE'), d()), 'tl')
    assert.equal(rimShape(f('SW'), d()), 'tr')
    assert.equal(rimShape(f('NE'), d()), 'lb')
    assert.equal(rimShape(f('NW'), d()), 'br')
  })
  it('a one-wide spur or column keeps a straight ridge', () => {
    assert.equal(rimShape(f('NS'), d()), 'h')
    assert.equal(rimShape(f('EW'), d()), 'v')
    assert.equal(rimShape(f('NES'), d()), 'v')
    assert.equal(rimShape(f('NEW'), d()), 'h')
  })
  it('concave corners see floor only diagonally and turn the same way', () => {
    assert.equal(rimShape(f(), d('NE')), 'tr')
    assert.equal(rimShape(f(), d('NW')), 'tl')
    assert.equal(rimShape(f(), d('SE')), 'br')
    assert.equal(rimShape(f(), d('SW')), 'lb')
  })
  it('interior cells and diagonal junctions stay peak fill; an island is scree', () => {
    assert.equal(rimShape(f(), d()), null)
    assert.equal(rimShape(f(), d('NE SW')), null)
    assert.equal(rimShape(f('NESW'), d()), 'scree')
  })
})

describe('stampMountainRim', () => {
  const block = () => {
    const b = new MapBuilder('t', 'forest', 't', 12, 12)
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) b.g(x, y, 'ow_grass_0')
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 8; x++) stampMass(b, rng, x, y)
    return b
  }
  const skin = (b, x, y) => b.palette[b.ground[y][x]]

  it('rims a solid block: straight faces, turned corners, peaks inside', () => {
    const b = block()
    stampMountainRim(b, rng)
    assert.match(skin(b, 5, 3), /^ow_mtn_edge_h_/)
    assert.match(skin(b, 5, 7), /^ow_mtn_edge_h_/)
    assert.match(skin(b, 3, 5), /^ow_mtn_edge_v_/)
    assert.match(skin(b, 8, 5), /^ow_mtn_edge_v_/)
    assert.match(skin(b, 3, 3), /^ow_mtn_edge_br_/)
    assert.match(skin(b, 8, 3), /^ow_mtn_edge_lb_/)
    assert.match(skin(b, 3, 7), /^ow_mtn_edge_tr_/)
    assert.match(skin(b, 8, 7), /^ow_mtn_edge_tl_/)
    assert.match(skin(b, 5, 5), /^ow_mtn_peak_/)
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 8; x++) assert.equal(b.walkable(x, y), false)
    assert.equal(skin(b, 1, 1), 'ow_grass_0')
  })

  it('a notch cut into the block gives its inner corners turns', () => {
    const b = block()
    clearMountain(b, rng, 5, 7, 1)   // opens (5,7), (4,7), (6,7), (5,6)
    assert.equal(b.walkable(5, 6), true)
    stampMountainRim(b, rng)
    assert.match(skin(b, 4, 6), /^ow_mtn_edge_(v|tl)_/)  // floor E and S → tl... or v when only E
    assert.match(skin(b, 6, 6), /^ow_mtn_edge_tr_/)      // floor W and S
    assert.match(skin(b, 5, 5), /^ow_mtn_edge_h_/)       // floor S only
  })

  it('an isolated mass cell becomes a scree boulder and stays blocked', () => {
    const b = new MapBuilder('t', 'forest', 't', 8, 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b.g(x, y, 'ow_grass_0')
    stampMass(b, rng, 4, 4)
    stampMountainRim(b, rng)
    assert.match(skin(b, 4, 4), /^ow_mtn_scree_/)
    assert.equal(b.walkable(4, 4), false)
    assert.equal(isMass(b, 4, 4), false)
  })

  it('mass running off the map shows no rim against the edge', () => {
    const b = new MapBuilder('t', 'forest', 't', 8, 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b.g(x, y, 'ow_grass_0')
    for (let y = 0; y < 8; y++) for (let x = 0; x <= 3; x++) stampMass(b, rng, x, y)
    stampMountainRim(b, rng)
    assert.match(skin(b, 0, 4), /^ow_mtn_peak_/)
    assert.match(skin(b, 3, 4), /^ow_mtn_edge_v_/)
  })

  it('is idempotent over a finished map', () => {
    const b = block()
    stampMountainRim(b, rng)
    const once = b.ground.map(r => r.map(i => b.palette[i]))
    stampMountainRim(b, rng)
    assert.deepEqual(b.ground.map(r => r.map(i => b.palette[i])), once)
  })
})

describe('Mountain Pass (depth 12)', () => {
  const m = OPEN_MAPS[12]
  const g = (x, y) => m.palette[m.ground[y][x]]
  const mass = (x, y) => x < 0 || y < 0 || x >= m.w || y >= m.h || isMassSkin(g(x, y))

  it('keeps its name, title and story POIs', () => {
    assert.equal(m.name, 'forest-3-autumn')
    assert.equal(m.title, 'Mountain Pass')
    const labels = m.pois.map(p => p.label)
    for (const l of ['stone circle', 'hermit hut', 'old mine 1', 'old mine 2']) assert.ok(labels.includes(l), l)
  })

  it('has no rock props left and wears the mountain tileset', () => {
    assert.deepEqual(m.palette.filter(n => n.startsWith('ow_rock')), [])
    assert.ok(m.palette.some(n => n.startsWith('ow_mtn_peak')))
    assert.ok(m.palette.some(n => n.startsWith('ow_mtn_edge')))
  })

  it('every mountain cell is blocked, and every mass face wears a rim tile', () => {
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const n = g(x, y)
      if (isMassSkin(n) || n.startsWith('ow_mtn_scree')) assert.equal(m.walk[y][x], '0', `${x},${y} ${n}`)
      if (!n.startsWith('ow_mtn_peak')) continue
      let floorSides = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!mass(x + dx, y + dy)) floorSides++
      assert.equal(floorSides, 0, `peak at ${x},${y} touches floor`)
    }
  })

  it('still keeps its autumn woods', () => {
    let trees = 0
    for (const row of m.prop) for (const i of row) if (i >= 0 && m.palette[i].startsWith('ow_tree')) trees++
    assert.ok(trees > 1500, `only ${trees} trees`)
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
    assert.equal(hasLineOfSight(map, 5, 5, 5, 7), true)    // the near face
    assert.equal(hasLineOfSight(map, 5, 5, 5, 10), true)   // a peak deep inside
    assert.equal(hasLineOfSight(map, 5, 5, 5, 12), true)   // the far face
    assert.equal(hasLineOfSight(map, 5, 5, 5, 14), false)  // floor beyond the range
  })
  it('a plain wall still hides what is behind it, mountain or not', () => {
    const map = open()
    map[5][7].tile = TILE.WALL
    map[5][9].tile = TILE.WALL; map[5][9].losTall = true
    assert.equal(hasLineOfSight(map, 5, 5, 5, 9), false)
  })
  it('buildOpenMap stamps losTall on Mountain Pass peaks and rims, not on scree or floor', () => {
    const { map } = buildOpenMap(OPEN_MAPS[12], { depth: 12 })
    const m = OPEN_MAPS[12]
    let tall = 0
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
      if (m.prop[y][x] >= 0) continue   // a prop is the blocker the player sees
      const n = m.palette[m.ground[y][x]]
      const expect = n.startsWith('ow_mtn_peak') || n.startsWith('ow_mtn_edge')
      assert.equal(!!map[y][x].losTall, expect, `${x},${y} ${n}`)
      if (expect) tall++
    }
    assert.ok(tall > 1000)
  })
  it('the FOV lights a whole mountain face from the pass, rims and interior alike', () => {
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
