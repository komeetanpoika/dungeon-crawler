// The roads' verges (renderer/wilds/road-art.js): a road's gravel worn off
// onto the cells beside it, as a deco. Art only, the same from both pieces
// of an edge, and on every join of a road with open land.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { vergeRoads, setRoadVerges, vergeSkin, isVergeSkin, roadSetOf, VERGE_SKINS, VERGE_VARIANTS, ROAD_SETS } from '../renderer/wilds/road-art.js'
import { MapBuilder, isWaterSkin, isPierSkin } from '../renderer/terrain/lib.js'
import { isMassSkin } from '../renderer/terrain/mountain.js'
import { EDGE_SHAPES } from '../renderer/terrain/edges.js'
import { isBankSkin } from '../renderer/wilds/shore-art.js'
import { isFilletSkin } from '../renderer/wilds/bridge-art.js'
import { isStructure } from '../renderer/wilds/over.js'
import { PIECE, MARGIN, tierAt, pieceKey, pieceBiome, lootDepthFor } from '../renderer/wilds/layout.js'
import { makeTerrain, WILDS_SKINS } from '../renderer/wilds/terrain.js'
import { placeFeatures } from '../renderer/wilds/features.js'
import { generatePiece } from '../renderer/wilds/piece.js'
import { roadSides, pieceClass } from '../renderer/wilds/roads.js'
import { isCityPiece } from '../renderer/wilds/city/geometry.js'
import { generateCityPiece } from '../renderer/wilds/city/piece.js'
import { buildCity } from '../renderer/wilds/city/build.js'
import { insideWalls, wallCells } from '../renderer/wilds/city/plan.js'
import { classOf } from '../renderer/wilds/map.js'

const TILES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer/assets/tiles')
const without = fn => { setRoadVerges(false); try { return fn() } finally { setRoadVerges(true) } }
const N = 1, E = 2, S = 4, W = 8
const parse = name => { const m = /^ow_deco_road_([a-z]+)_(\d+)_(\d+)_(\d+)$/.exec(name ?? ''); return m && { set: m[1], M: +m[2], D: +m[3], V: +m[4] } }

// ---- on a grid of glyphs -------------------------------------------------------
const LEGEND = {
  '.': ['ow_grass_0', null], 'R': ['ow_road_grass_0', null], 'Z': ['ow_road_sand_1', null], 'd': ['ow_dirt_0', null],
  '~': ['ow_water_0', null], 'B': ['ow_bank_grass_nw_a', null], 'P': ['ow_water_0', 'ow_pier_deck_h_0'],
  'M': ['ow_mtn_ground_0', 'ow_mtn_lat_0_0'], 'H': ['ow_grass_0', 'ow_house_wall_stone'], 'T': ['ow_grass_0', 'ow_tree_pine_trunk'],
}
function lay(rows, { X0 = 0, Y0 = 0, seed = 1, deco = null, skip = null } = {}) {
  const h = rows.length, w = rows[0].length
  const b = new MapBuilder('t', 't', 't', w, h)
  rows.forEach((r, y) => [...r].forEach((ch, x) => { const [g, p] = LEGEND[ch]; b.ground[y][x] = b.skin(g); b.prop[y][x] = p ? b.skin(p) : -1 }))
  const out = deco ?? new Array(w * h).fill(null)
  const laid = vergeRoads(b, out, { X0, Y0, seed, skip })
  return { at: (x, y) => out[y * w + x], laid }
}

describe('the verge of a road', () => {
  it('a straight road: the cells along it wear its gravel on that side, and no further', () => {
    const g = lay(['.....', '.....', 'RRRRR', 'RRRRR', '.....'])
    for (let x = 0; x < 5; x++) {
      assert.deepEqual({ ...parse(g.at(x, 1)), V: 0 }, { set: 'grass', M: S, D: 0, V: 0 }, `${x},1`)
      assert.equal(parse(g.at(x, 4)).M, N, `${x},4`)
      assert.equal(g.at(x, 0), null, `${x},0`)
      assert.equal(g.at(x, 2), null, 'a road cell of one set wears nothing of its own')
    }
    assert.equal(g.laid, 10)
  })

  it('a step: the inner corner fills across, the cell past an outer corner takes a nibble', () => {
    const g = lay(['......', 'RRR...', 'RRRR..', 'RRRRR.'])
    assert.equal(parse(g.at(3, 1)).M, W | S)
    assert.equal(parse(g.at(4, 2)).M, W | S)
    assert.equal(parse(g.at(5, 3)).M, W)
    // touched at a corner alone (south-west), its two sides open
    assert.deepEqual([parse(g.at(4, 1)).M, parse(g.at(4, 1)).D], [0, 4])
    assert.deepEqual([parse(g.at(3, 0)).M, parse(g.at(3, 0)).D], [0, 4])
    assert.equal(parse(g.at(1, 0)).M, S)
  })

  it('water, a bank, a bridge deck, mountain rock and a building take none; a tree and a trail do', () => {
    const g = lay(['~BPMHTd', 'RRRRRRR'])
    for (let x = 0; x < 5; x++) assert.equal(g.at(x, 0), null, `${[...'~BPMH'][x]}`)
    assert.equal(parse(g.at(5, 0)).M, S, 'under the tree')
    assert.equal(parse(g.at(6, 0)).M, S, 'on the trail')
  })

  it('where a road changes its ground, the lower set takes the higher one\'s verge on that side', () => {
    assert.ok(ROAD_SETS.indexOf('sand') > ROAD_SETS.indexOf('grass'))
    const g = lay(['.....', 'RRZZZ', 'RRZZZ', '.....'])
    assert.deepEqual([parse(g.at(1, 1)).set, parse(g.at(1, 1)).M], ['sand', E])
    assert.equal(g.at(2, 1), null)
    assert.equal(g.at(0, 1), null)
    // beside the join, each cell of open land takes the set of the road beside it
    assert.deepEqual([parse(g.at(1, 0)).set, parse(g.at(1, 0)).M], ['grass', S])
    assert.deepEqual([parse(g.at(2, 0)).set, parse(g.at(2, 0)).M], ['sand', S])
  })

  it('off the grid is no road; a cell that has a deco keeps it; a skipped cell is left alone', () => {
    const g = lay(['R..', '...'])
    assert.equal(parse(g.at(1, 0)).M, W)
    assert.equal(g.at(0, 1) && parse(g.at(0, 1)).M, N)
    const deco = new Array(6).fill(null)
    deco[1] = 'ow_city_banner'
    const k = lay(['R..', '...'], { deco, skip: (x, y) => x === 0 && y === 1 })
    assert.equal(k.at(1, 0), 'ow_city_banner')
    assert.equal(k.at(0, 1), null)
    assert.equal(parse(k.at(1, 1)).D, 8)
  })

  it('its variant is a function of the world tile: a window onto the same land lays the same verges', () => {
    const rows = ['..........', '..RRRR....', '..RRRRR...', '...RRRRR..', '..........']
    const whole = lay(rows, { X0: 40, Y0: -7, seed: 9 })
    const part = lay(rows.map(r => r.slice(3)), { X0: 43, Y0: -7, seed: 9 })
    let variants = new Set()
    for (let y = 0; y < 5; y++) for (let x = 4; x < 10; x++) {
      assert.equal(part.at(x - 3, y), whole.at(x, y), `${x},${y}`)
      if (whole.at(x, y)) variants.add(parse(whole.at(x, y)).V)
    }
    assert.equal(variants.size, VERGE_VARIANTS)
  })

  it('switched off, it lays nothing', () => {
    assert.equal(without(() => lay(['RR.', '...']).laid), 0)
  })

  it('every verge has its tile, is loaded with the Wilds, and is named as a deco to walk on', () => {
    assert.equal(VERGE_SKINS.length, ROAD_SETS.length * EDGE_SHAPES.length * VERGE_VARIANTS)
    const loaded = new Set(WILDS_SKINS)
    for (const n of VERGE_SKINS) {
      assert.ok(isVergeSkin(n) && n.startsWith('ow_deco_') && !n.endsWith('_d'), n)
      assert.ok(loaded.has(n), `${n} is not loaded with the Wilds`)
      assert.ok(fs.existsSync(path.join(TILES, `${n}.png`)), `no tile art for ${n}`)
    }
    assert.equal(vergeSkin('marsh', 12, 0, 1), 'ow_deco_road_marsh_12_0_1')
    assert.equal(roadSetOf('ow_road_mtn_3'), 'mtn')
    assert.equal(roadSetOf('ow_dirt_0'), null)
  })
})

// ---- the real generators -------------------------------------------------------
// The first n pieces with a road edge, by rings round home (no city piece).
function roadPieces(seed, n) {
  const out = []
  for (let r = 0; r <= 12 && out.length < n; r++) for (let wy = -r; wy <= r && out.length < n; wy++) for (let wx = -r; wx <= r && out.length < n; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r || isCityPiece(wx, wy)) continue
    const s = roadSides(seed, wx, wy)
    if (s.N || s.E || s.S || s.W) out.push({ wx, wy })
  }
  return out
}
const SAMPLE = [7, 12345].flatMap(seed => roadPieces(seed, 7).map(p => ({ seed, ...p })))
const pieceAt = (seed, wx, wy, deal) => isCityPiece(wx, wy) ? generateCityPiece(seed, wx, wy) : generatePiece(seed, wx, wy, deal)
const bare = c => isWaterSkin(c.skin) || isBankSkin(c.skin) || isPierSkin(c.overlay) || isFilletSkin(c.overlay) || isMassSkin(c.overlay) || isStructure(c.overlay)

// A piece as piece.js makes it, with its terrain kept so a test can ask what is road.
function built(seed, wx, wy, deal = 0) {
  const t = makeTerrain(seed, wx, wy, deal)
  const tier = tierAt(wx, wy)
  const piece = {
    key: pieceKey(wx, wy), wx, wy, deal, tier, biome: pieceBiome(seed, wx, wy), cls: pieceClass(seed, wx, wy), road: null,
    main: null, small: [], packs: [], tale: null, points: [], villageTale: null, villagePoints: [], cells: null, spawns: [], caves: [], doors: [], signs: [], village: null,
    spawnPoint: null, gates: t.gates, lootDepth: lootDepthFor(tier),
  }
  placeFeatures(t, piece)
  t.finish()
  return t
}

describe('the verges of real pieces', () => {
  it('are art only: no walk, sight, road, ground, prop or map colour changes, nothing moves', () => {
    let verges = 0
    for (const { seed, wx, wy } of SAMPLE) {
      const a = generatePiece(seed, wx, wy), b = without(() => generatePiece(seed, wx, wy))
      for (const k of ['spawns', 'doors', 'caves', 'packs', 'points', 'signs', 'spawnPoint', 'gates', 'road'])
        assert.ok(JSON.stringify(a[k]) === JSON.stringify(b[k]), `${seed} ${a.key}: ${k} differ`)
      for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
        const ca = a.cells[y][x], cb = b.cells[y][x], at = `${seed} ${a.key} ${x},${y}`
        assert.ok(ca.tile === cb.tile && ca.skin === cb.skin && ca.overlay === cb.overlay, `${at}: cell`)
        assert.ok(ca.losClear === cb.losClear && ca.losSoft === cb.losSoft && ca.losTall === cb.losTall && ca.over === cb.over, `${at}: sight`)
        assert.ok(classOf(ca) === classOf(cb), `${at}: map colour`)
        assert.ok(cb.deco === undefined, `${at}: a deco with the verges off`)
        if (ca.deco !== undefined) { assert.ok(isVergeSkin(ca.deco), `${at}: ${ca.deco}`); verges++ }
      }
    }
    assert.ok(verges > 2000, `only ${verges} verges in the sample`)
    // and what the terrain says is road or path, or can be walked
    for (const { seed, wx, wy } of SAMPLE.slice(0, 4)) {
      const a = built(seed, wx, wy), b = without(() => built(seed, wx, wy))
      for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++)
        assert.ok(a.onRoad(x, y) === b.onRoad(x, y) && a.onPath(x, y) === b.onPath(x, y) && a.walkable(x, y) === b.walkable(x, y), `${seed} ${wx},${wy} ${x},${y}`)
    }
  })

  it('leave no hard join: wherever a road meets open land or another set, that side wears a verge', () => {
    let joins = 0
    for (const { seed, wx, wy } of SAMPLE) {
      const p = generatePiece(seed, wx, wy)
      const rank = c => ROAD_SETS.indexOf(roadSetOf(c.skin))
      for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
        const c = p.cells[y][x]
        if (rank(c) < 0) continue
        for (const [dx, dy, bit, back] of [[0, -1, N, S], [1, 0, E, W], [0, 1, S, N], [-1, 0, W, E]]) {
          const o = p.cells[y + dy]?.[x + dx]
          if (!o) continue
          const at = `${seed} ${p.key} ${x},${y} -> ${x + dx},${y + dy}`
          if (rank(o) === rank(c)) continue
          if (rank(o) > rank(c)) { joins++; assert.ok(parse(c.deco)?.M & bit, `${at}: ${c.skin} under ${o.skin} wears ${c.deco}`) } else if (rank(o) < 0 && bare(o)) continue
          else { joins++; assert.ok(parse(o.deco)?.M & back, `${at}: ${o.skin}/${o.overlay} wears ${o.deco}`) }
        }
      }
    }
    assert.ok(joins > 2000, `only ${joins} joins in the sample`)
  })

  it('a piece and its neighbour lay the same verges on the cells they both see, whatever each was dealt', () => {
    let compared = 0
    for (const seed of [7, 12345, 3]) {
      const memo = new Map()
      const once = (k, make) => { if (!memo.has(k)) memo.set(k, make()); return memo.get(k) }
      const terrain = (wx, wy, deal) => isCityPiece(wx, wy) ? null : once(`t${wx},${wy},${deal}`, () => { const t = makeTerrain(seed, wx, wy, deal); t.finish(); return t })
      const piece = (wx, wy, deal) => once(`p${wx},${wy},${deal}`, () => pieceAt(seed, wx, wy, deal))
      for (const { wx, wy } of roadPieces(seed, 7)) {
        const sides = roadSides(seed, wx, wy)
        for (const [side, nx, ny] of [['E', wx + 1, wy], ['S', wx, wy + 1]]) {
          if (!sides[side]) continue
          for (const [dA, dB] of [[0, 1], [1, 0]]) {
            // A's margin is the neighbour's first cells; the neighbour's margin is A's last ones
            const tA = terrain(wx, wy, dA), pA = piece(wx, wy, dA), tB = terrain(nx, ny, dB), pB = piece(nx, ny, dB)
            for (let i = 0; i < PIECE; i++) for (let k = 0; k < MARGIN - 1; k++) {
              const [ax, ay, bx, by] = side === 'E' ? [PIECE + k, i, k, i] : [i, PIECE + k, i, k]
              const mine = tA.decoAt(ax, ay), theirs = pB.cells[by][bx].deco ?? null
              assert.equal(mine, theirs, `seed ${seed} ${wx},${wy}/${dA} ${side} into ${nx},${ny}/${dB}: ${bx},${by}`)
              if (tB) {
                const [cx, cy, qx, qy] = side === 'E' ? [-1 - k, i, PIECE - 1 - k, i] : [i, -1 - k, i, PIECE - 1 - k]
                assert.equal(tB.decoAt(cx, cy), pA.cells[qy][qx].deco ?? null, `seed ${seed} ${nx},${ny}/${dB} back into ${wx},${wy}/${dA}: ${qx},${qy}`)
              }
              if (theirs) compared++
            }
          }
        }
      }
    }
    assert.ok(compared > 300, `only ${compared} verges along the seams`)
  })

  it('the city\'s roads in at its edges: the Wilds lays in its margin what the city lays in its frame', () => {
    let compared = 0
    // the pieces round Kalevanlinna (0..1, 2..3) and the side that faces it
    for (const [wx, wy, side] of [[0, 1, 'S'], [1, 1, 'S'], [-1, 2, 'E'], [-1, 3, 'E'], [2, 2, 'W'], [2, 3, 'W']]) {
      const t = makeTerrain(7, wx, wy, 0); t.finish()
      const [cx, cy] = side === 'S' ? [wx, wy + 1] : side === 'E' ? [wx + 1, wy] : [wx - 1, wy]
      const city = generateCityPiece(7, cx, cy)
      for (let i = 0; i < PIECE; i++) for (let k = 0; k < MARGIN - 1; k++) {
        const [mx, my, x, y] = side === 'S' ? [i, PIECE + k, i, k] : side === 'E' ? [PIECE + k, i, k, i] : [-1 - k, i, PIECE - 1 - k, i]
        const theirs = city.cells[y][x].deco ?? null
        assert.equal(t.decoAt(mx, my), theirs, `${wx},${wy} ${side} into the city: ${x},${y}`)
        if (theirs) compared++
      }
    }
    assert.ok(compared > 8, `only ${compared} verges where roads enter the city`)
  })

  it('within MARGIN of the edge the same verges whatever is dealt', () => {
    for (const { seed, wx, wy } of SAMPLE.slice(0, 6)) {
      const a = generatePiece(seed, wx, wy, 0), b = generatePiece(seed, wx, wy, 1), c = generatePiece(seed, wx, wy, 2)
      for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
        if (Math.min(x, y, PIECE - 1 - x, PIECE - 1 - y) >= MARGIN) continue
        assert.equal(a.cells[y][x].deco, b.cells[y][x].deco, `${seed} ${a.key} ${x},${y}`)
        assert.equal(a.cells[y][x].deco, c.cells[y][x].deco, `${seed} ${a.key} ${x},${y}`)
      }
    }
  })
})

describe('Kalevanlinna\'s roads outside the wall', () => {
  const city = buildCity(7), plain = without(() => buildCity(7))
  buildCity(7)   // (leave the kept city the real one)
  const C = city.cells.length
  const walled = (x, y) => insideWalls(x, y) || wallCells().has(y * C + x)

  it('wear verges, and nothing else of the city changes: on or inside the wall not even a deco', () => {
    let verges = 0
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const a = city.cells[y][x], b = plain.cells[y][x]
      assert.ok(a.tile === b.tile && a.skin === b.skin && a.overlay === b.overlay && a.over === b.over && a.ward === b.ward, `${x},${y}`)
      if (a.deco === b.deco) continue
      assert.ok(!walled(x, y), `${x},${y}: a verge on or inside the wall`)
      assert.ok(isVergeSkin(a.deco) && b.deco === undefined, `${x},${y}: ${b.deco} became ${a.deco}`)
      verges++
    }
    assert.ok(verges > 400, `only ${verges} verges round the city`)
    for (const k of ['doors', 'signs', 'lamps', 'chimneys', 'windows', 'spots', 'inn', 'spawns', 'yards'])
      assert.ok(JSON.stringify(city[k]) === JSON.stringify(plain[k]), `${k} differ`)
    assert.ok(JSON.stringify(city.streets) === JSON.stringify(plain.streets), 'the street graph differs')
  })
})
