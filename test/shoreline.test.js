import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MapBuilder, shoreline, reshore, WATER_SKINS } from '../tools/static-overworld/lib.mjs'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'

const skinAt = (b, x, y) => b.palette[b.ground[y][x]]

// 7x7 grass map with a 3x3 lake in the middle (x 2..4, y 2..4).
function lake() {
  const b = new MapBuilder('t', 'forest', 't', 7, 7)
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) b.g(x, y, 'ow_grass_0')
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) { b.g(x, y, 'ow_water_0'); b.block(x, y) }
  return b
}

describe('shoreline', () => {
  it('rims a lake with the pond edge and corner tiles, centre stays open water', () => {
    const b = lake()
    shoreline(b)
    assert.equal(skinAt(b, 2, 2), 'ow_pond_00')
    assert.equal(skinAt(b, 3, 2), 'ow_pond_10')
    assert.equal(skinAt(b, 4, 2), 'ow_pond_20')
    assert.equal(skinAt(b, 2, 3), 'ow_pond_01')
    assert.equal(skinAt(b, 4, 3), 'ow_pond_21')
    assert.equal(skinAt(b, 2, 4), 'ow_pond_02')
    assert.equal(skinAt(b, 3, 4), 'ow_pond_12')
    assert.equal(skinAt(b, 4, 4), 'ow_pond_22')
    assert.ok(WATER_SKINS.includes(skinAt(b, 3, 3)))
  })

  it('never touches land, and keeps every rimmed cell blocked', () => {
    const b = lake()
    shoreline(b)
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const inLake = x >= 2 && x <= 4 && y >= 2 && y <= 4
      if (!inLake) assert.equal(skinAt(b, x, y), 'ow_grass_0')
      else assert.equal(b.walkable(x, y), false)
    }
  })

  it('treats pier logs as water: no rim beside a pier', () => {
    const b = lake()
    b.g(3, 2, 'ow_pier_log'); b.unblock(3, 2)    // pier log on the lake's top edge
    shoreline(b)
    assert.equal(skinAt(b, 3, 3), 'ow_water_0')   // below the pier: no bank there
    assert.equal(skinAt(b, 2, 2), 'ow_pond_00')   // the neighbours still see land N
  })

  it('treats the map edge as open water: sea at the border gets no rim', () => {
    const b = new MapBuilder('t', 'seaside', 't', 4, 4)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) b.g(x, y, 'ow_water_1')
    shoreline(b)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.equal(skinAt(b, x, y), 'ow_water_1')
  })

  it('a one-cell channel takes the top/left bank when both sides are land', () => {
    const b = new MapBuilder('t', 'forest', 't', 5, 5)
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) b.g(x, y, 'ow_grass_0')
    b.g(2, 2, 'ow_water_0')                        // a single puddle, land on all four sides
    shoreline(b)
    assert.equal(skinAt(b, 2, 2), 'ow_pond_00')
  })
})

describe('shipped open maps', () => {
  it('use only plain water skins for open water', () => {
    for (const m of Object.values(OPEN_MAPS))
      for (const n of m.palette) if (n.startsWith('ow_water')) assert.ok(WATER_SKINS.includes(n), `${m.name} uses ${n}`)
  })
  it('rim every water cell that touches land', () => {
    for (const m of Object.values(OPEN_MAPS)) {
      const skin = (x, y) => m.palette[m.ground[y]?.[x]]
      const wet = (x, y) => { const n = skin(x, y); return n === undefined || n.startsWith('ow_water') || n.startsWith('ow_pond_') || n === 'ow_pier_log' }
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        if (!skin(x, y)?.startsWith('ow_water')) continue
        const touchesLand = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !wet(x + dx, y + dy))
        assert.equal(touchesLand, false, `${m.name}: plain water at ${x},${y} touches land`)
      }
    }
  })
})

describe('reshore (hand-edited maps)', () => {
  it('hydrates a map JSON, strips corner/overlay/pond water to plain, rims it, and round-trips', () => {
    const src = new MapBuilder('t', 'forest', 't', 6, 5)
    for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) src.g(x, y, 'ow_grass_0')
    src.g(2, 2, 'ow_water_2'); src.block(2, 2)                       // shore-corner skin
    src.g(3, 2, 'ow_pond_12'); src.block(3, 2)                        // stale hand-painted rim
    src.p(4, 2, 'ow_pond_11'); src.block(4, 2)                        // water painted on the overlay
    src.p(1, 1, 'ow_tree_small')
    src.poi('landmark', 1, 2, 'x'); src.playerSpawn = { x: 3, y: 3 }
    const b = MapBuilder.fromJSON(JSON.parse(JSON.stringify(src.toJSON())))
    assert.equal(reshore(b), 3)
    shoreline(b)
    b.compactPalette()
    const out = b.toJSON()
    assert.equal(skinAt(b, 2, 2), 'ow_pond_00')
    assert.equal(skinAt(b, 3, 2), 'ow_pond_10')
    assert.equal(skinAt(b, 4, 2), 'ow_pond_20')
    assert.equal(out.prop[2][4], -1)
    for (const n of out.palette) assert.ok(!/^ow_water_[23]$/.test(n), `stale ${n}`)
    assert.equal(out.palette[out.prop[1][1]], 'ow_tree_small')
    assert.deepEqual(out.walk, src.toJSON().walk)
    assert.deepEqual(out.pois, src.pois)
    assert.deepEqual(out.playerSpawn, src.playerSpawn)
  })
})
