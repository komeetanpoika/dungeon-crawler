// The desert's dunes (renderer/wilds/desert-art.js duneField, layDunes): a
// height field of large dune bodies, each a long gentle windward slope up to
// a brink and a short steep slip face beyond, shaded by how each slope faces
// the light from the upper left with tiles keyed by their corners. The brink
// of a dune tall enough is a crest band one or two cells wide, walked over but
// not seen past, laid by terrain.js on the desert's bare sand and kept off
// every way, site and place; the shading eases to level ground round them.
// Near home (desert.js deep() = 0) the desert is open dune country; deep in
// it (deep() = 1) the dunes stand closer and more of them carry a crest. All
// of it is the same in a piece and in its neighbour's margin whatever either's
// deal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePiece, cellOf } from '../renderer/wilds/piece.js'
import { makeTerrain, TERRAIN_SKINS } from '../renderer/wilds/terrain.js'
import { placeFeatures } from '../renderer/wilds/features.js'
import { layoutTale, TALE_PAD } from '../renderer/wilds/sites.js'
import {
  crestAt, crestField, duneField, duneHeight, crestHeightAt, windAt, setDunes, dunesOn, isDuneSkin, isRippleSkin, isHardpanSkin, isShadeSkin,
  cornersOf, DUNE_SKINS, SHADE_SKINS, LIGHT,
} from '../renderer/wilds/desert-art.js'
import { PIECE, FRAME, MARGIN, pieceBiome, pieceKey, tierAt, lootDepthFor, gateAt } from '../renderer/wilds/layout.js'
import { pieceClass } from '../renderer/wilds/roads.js'
import { inGentleRing, deep, DEEP } from '../renderer/wilds/desert.js'
import { hashInt, mulberry32 } from '../renderer/wilds/rand.js'
import { classOf, CLASS } from '../renderer/wilds/map.js'

const TILES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer/assets/tiles')
const SEEDS = [7, 42, 1]
const PAD = { village: 12, ring: 6, cave: 5, camp: 6, boss: 7, ruin: 8, landmark: 7,   // as features.js opens them
  farmstead: 10, orchard: 8, mill: 7, peat: 7, fisher: 8, fold: 7, quarry: 7, well: 6, field: 6,
  rest: 5, shrine: 5, inn: 10, tower: 8 }
const padOf = kind => kind.startsWith('tale_') ? TALE_PAD[kind.slice(5)] : PAD[kind]
const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
const without = fn => { setDunes(false); try { return fn() } finally { setDunes(true) } }

// Every desert piece within six pieces of home.
const desertPieces = seed => {
  const out = []
  for (let wy = -6; wy <= 6; wy++) for (let wx = -6; wx <= 6; wx++) if (pieceBiome(seed, wx, wy) === 'desert') out.push({ wx, wy })
  return out
}
// How deep a piece lies: deep() at its tile nearest the middle of the home
// piece (lo) and at its tile farthest from it (hi).
const pieceDepth = (wx, wy) => {
  const mid = PIECE / 2, near = (o, v) => Math.max(o * PIECE, Math.min(o * PIECE + PIECE - 1, v))
  const far = (o, v) => Math.abs(o * PIECE - v) > Math.abs(o * PIECE + PIECE - 1 - v) ? o * PIECE : o * PIECE + PIECE - 1
  return { lo: deep(near(wx, mid), near(wy, mid)), hi: deep(far(wx, mid), far(wy, mid)) }
}
// The desert pieces beyond the gentle ring that hold desert of depth 0, and a
// few wholly at depth 1, nearest home first.
const nearPieces = seed => desertPieces(seed).filter(p => !inGentleRing(p.wx, p.wy) && pieceDepth(p.wx, p.wy).lo === 0)
const deepMemo = new Map()
const deepPieces = seed => {
  if (deepMemo.has(seed)) return deepMemo.get(seed)
  const out = []
  for (let r = 7; r <= 10; r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++)
    if (Math.max(Math.abs(wx), Math.abs(wy)) === r && pieceBiome(seed, wx, wy) === 'desert' && pieceDepth(wx, wy).lo === 1) out.push({ wx, wy })
  deepMemo.set(seed, out)
  return out
}
// Deep desert pieces whose east and south neighbours are deep desert too.
const deepPairs = seed => {
  const all = new Set(deepPieces(seed).map(p => `${p.wx},${p.wy}`))
  return deepPieces(seed).filter(p => all.has(`${p.wx + 1},${p.wy}`) && all.has(`${p.wx},${p.wy + 1}`))
}
// The pieces the art checks look at on each seed: near home, in the ramp, and deep.
const artPieces = seed => [...desertPieces(seed).filter(p => !inGentleRing(p.wx, p.wy)).slice(0, 8), ...deepPieces(seed).slice(0, 4)]
// Every desert piece within six of home, and the first deep ones.
const allPieces = seed => [...desertPieces(seed), ...deepPieces(seed).slice(0, 4)]

// A piece as piece.js makes it, with its terrain kept so the test can ask
// what is a path, a road or a site's ground. `dune(x, y)` is the cell's
// losDune as piece.js flags it, for local cells and the MARGIN beyond.
const builtMemo = new Map()
function built(seed, wx, wy, deal = 0, tale = null) {
  const key = `${seed}:${wx},${wy}:${deal}:${tale}`
  if (builtMemo.has(key)) return builtMemo.get(key)
  const t = makeTerrain(seed, wx, wy, deal)
  const tier = tierAt(wx, wy)
  const piece = {
    key: pieceKey(wx, wy), wx, wy, deal, tier, biome: pieceBiome(seed, wx, wy), cls: pieceClass(seed, wx, wy), road: null, coach: null,
    main: null, small: [], packs: [], tale, points: [], villageTale: null, villagePoints: [], cells: null, spawns: [], caves: [], doors: [], signs: [], village: null,
    spawnPoint: null, gates: t.gates, lootDepth: lootDepthFor(tier),
  }
  placeFeatures(t, piece)
  t.finish()
  const ground = (x, y) => t.groundAt(x, y)
  const dune = (x, y) => !!cellOf(ground(x, y), t.propAt(x, y), t.walkable(x, y)).losDune
  // a gate's corridor, as terrain.js lays it, for cells of this piece and of its neighbours' frames
  const corridor = (x, y) => {
    const px = Math.floor(x / PIECE), py = Math.floor(y / PIECE)
    const lx = x - px * PIECE, ly = y - py * PIECE, pwx = wx + px, pwy = wy + py
    const lane = (o, side) => { const g = gateAt(seed, pwx, pwy, side); return o >= g - 1 && o <= g + 2 }
    return (ly < FRAME && lane(lx, 'N')) || (ly >= PIECE - FRAME && lane(lx, 'S')) || (lx < FRAME && lane(ly, 'W')) || (lx >= PIECE - FRAME && lane(ly, 'E'))
  }
  const onWay = (x, y) => corridor(x, y) || (x >= 0 && y >= 0 && x < PIECE && y < PIECE && t.onPath(x, y))
  const b = { seed, wx, wy, deal, t, piece, ground, dune, corridor, onWay, X0: wx * PIECE, Y0: wy * PIECE, at: `seed ${seed} piece ${wx},${wy} deal ${deal}${tale ? ' ' + tale : ''}` }
  builtMemo.set(key, b)
  return b
}
const each = (fn) => { for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) fn(x, y) }
// The corner levels a cell's ground is drawn with (desert-art.js cornersOf),
// NW NE SE SW: anything that is not the dunes' own ground meets them level.
const levels = n => cornersOf(n) ?? [0, 0, 0, 0]
const allZero = c => c.every(l => l === 0)
// A crossing: an edge whose two corners are the windward (+1) and the lee (-1) side of a brink.
const SIDES = [[0, -1, 0, 1], [1, 0, 1, 2], [0, 1, 2, 3], [-1, 0, 3, 0]]   // dx, dy, and the two corners on that side
const crossings = c => SIDES.filter(([, , i, j]) => c[i] * c[j] === -1)

// The dune field over a stretch of desert of one depth band on each seed:
// near, every tile within DEEP.from pieces of home (those of depth 0 are the
// band); deep, a block of two by two desert pieces wholly at depth 1.
const stretchMemo = new Map()
const stretch = (seed, band) => {
  const key = `${seed}:${band}`
  if (stretchMemo.has(key)) return stretchMemo.get(key)
  let X0, Y0, W
  if (band === 'near') { X0 = -DEEP.from * PIECE; Y0 = X0; W = (2 * DEEP.from + 1) * PIECE }
  else {
    const all = new Set(deepPieces(seed).map(p => `${p.wx},${p.wy}`))
    const { wx, wy } = deepPieces(seed).find(p => [[1, 0], [0, 1], [1, 1]].every(([dx, dy]) => all.has(`${p.wx + dx},${p.wy + dy}`)))
    X0 = wx * PIECE; Y0 = wy * PIECE; W = 2 * PIECE
  }
  const F = duneField(seed, X0, Y0, W, W)
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < W
  const crest = (x, y) => inside(x, y) && F.crest[y * W + x] === 1
  const height = (x, y) => F.height[y * W + x]
  const inBand = (x, y) => deep(X0 + x, Y0 + y) === (band === 'near' ? 0 : 1)
  const s = { W, X0, Y0, F, crest, height, inside, inBand }
  stretchMemo.set(key, s)
  return s
}
const BANDS = ['near', 'deep']
// The crest share of open desert ground: within NEAR_SHARE (per cent) near
// home, at least DEEP_SHARE deep in the desert.
const NEAR_SHARE = [0.8, 3.5], DEEP_SHARE = 3
const quantile = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

test('every dune tile exists, and the map shows a dune and its shading as sand', () => {
  assert.ok(DUNE_SKINS.length >= 81, `${DUNE_SKINS.length} crest tiles`)
  assert.ok(SHADE_SKINS.length > 100, `${SHADE_SKINS.length} shading tiles`)
  const names = new Set(TERRAIN_SKINS)
  for (const n of [...DUNE_SKINS, ...SHADE_SKINS]) {
    assert.ok(!n.endsWith('_d'), `${n} ends in _d`)
    assert.ok(names.has(n), `${n} is not in TERRAIN_SKINS`)
    assert.ok(fs.existsSync(path.join(TILES, n + '.png')), `no tile art for ${n}`)
    assert.equal(classOf({ skin: n }), CLASS.sand, `${n} is not sand on the map`)
    assert.equal(cornersOf(n)?.length, 4, `${n} names no corners`)
  }
  for (const n of DUNE_SKINS) assert.ok(n.startsWith('ow_dune_') && isDuneSkin(n) && cellOf(n, null, true).losDune, n)
  // a slope is walked over and seen across like any sand, and steps by at most one level corner to corner
  for (const n of SHADE_SKINS) {
    const c = cornersOf(n)
    assert.ok(isShadeSkin(n) && !n.startsWith('ow_dune_') && !cellOf(n, null, true).losDune, n)
    assert.ok(Math.max(...c) - Math.min(...c) <= 1 && !allZero(c), `${n}: corners ${c}`)
  }
})

test('the desert deepens with distance from home', () => {
  // 0 at home and out to DEEP.from pieces, 1 from DEEP.to, never falling on the way out
  assert.equal(deep(PIECE / 2, PIECE / 2), 0)
  for (let a = 0; a < 16; a++) {
    const ux = Math.cos(a * Math.PI / 8), uy = Math.sin(a * Math.PI / 8), at = d => deep(PIECE / 2 + ux * d * PIECE, PIECE / 2 + uy * d * PIECE)
    assert.equal(at(DEEP.from), 0, `ray ${a}: deep at ${DEEP.from} pieces`)
    assert.equal(at(DEEP.to), 1, `ray ${a}: deep at ${DEEP.to} pieces`)
    assert.equal(at(12), 1)
    let last = 0
    for (let d = 0; d <= 12; d += 0.1) { const z = at(d); assert.ok(z >= last && z <= 1, `ray ${a}: deep falls to ${z} at ${d.toFixed(1)} pieces`); last = z }
  }
  // the same for a world tile whatever piece asks: the field across the ramp
  // is the same in two rectangles that share it, to the last bit
  const A = duneField(7, 380, -300, 120, 90), B = duneField(7, 420, -260, 140, 100)
  let shared = 0
  for (let Y = -260; Y < -210; Y++) for (let X = 420; X < 500; X++) {
    const a = (Y + 300) * 120 + X - 380, b = (Y + 260) * 140 + X - 420
    assert.ok(A.height[a] === B.height[b] && A.crest[a] === B.crest[b], `tile ${X},${Y}`)
    if (deep(X, Y) > 0 && deep(X, Y) < 1) shared++
  }
  assert.ok(shared > 3000, `only ${shared} shared tiles in the ramp`)
})

test('duneHeight is the height of the field, level round home and by the city', () => {
  for (const seed of SEEDS) for (const band of BANDS) {
    const { W, X0, Y0, height } = stretch(seed, band)
    for (let i = 0; i < 50; i++) {
      const x = hashInt(seed, i, 1, 31) % W, y = hashInt(seed, i, 2, 31) % W
      assert.ok(duneHeight(seed, X0 + x, Y0 + y) === height(x, y), `seed ${seed} tile ${X0 + x},${Y0 + y}`)
    }
  }
  for (const seed of [...SEEDS, 8]) for (let i = 0; i < 30; i++) {
    // the gentle ring's pieces, and Kalevanlinna's with the eight tiles round them
    const rx = hashInt(seed, i, 3, 31) % (3 * PIECE) - PIECE, ry = hashInt(seed, i, 4, 31) % (3 * PIECE) - PIECE
    const cx = hashInt(seed, i, 5, 31) % (2 * PIECE + 16) - 8, cy = 2 * PIECE - 8 + hashInt(seed, i, 6, 31) % (2 * PIECE + 16)
    assert.equal(duneHeight(seed, rx, ry), 0, `seed ${seed}: height at ${rx},${ry} in the ring`)
    assert.equal(duneHeight(seed, cx, cy), 0, `seed ${seed}: height at ${cx},${cy} by the city`)
  }
})

test('dunes lie in the desert, more of them crested deep in it', t => {
  // the crest share of open desert ground: near home within a range, deep in the desert above a floor
  const share = (seed, pieces, band) => {
    let ground = 0, dunes = 0
    for (const { wx, wy } of pieces) {
      const { t: terrain, dune, X0, Y0 } = built(seed, wx, wy)
      each((x, y) => {
        if (deep(X0 + x, Y0 + y) !== band || terrain.biome(x, y) !== 'desert' || !terrain.walkable(x, y) || terrain.propAt(x, y)) return
        const g = terrain.groundAt(x, y)
        if (!isRippleSkin(g) && !isHardpanSkin(g) && !isDuneSkin(g) && !isShadeSkin(g)) return
        ground++
        if (dune(x, y)) dunes++
      })
    }
    return { ground, pct: 100 * dunes / ground }
  }
  for (const seed of SEEDS) {
    const near = share(seed, nearPieces(seed), 0), far = share(seed, deepPieces(seed).slice(0, 4), 1)
    t.diagnostic(`seed ${seed}: crests are ${near.pct.toFixed(2)} % of ${near.ground} cells of near desert ground, ${far.pct.toFixed(2)} % of ${far.ground} deep`)
    assert.ok(near.ground > 5000 && far.ground > 12000, `seed ${seed}: ${near.ground} near and ${far.ground} deep cells of open desert ground`)
    assert.ok(near.pct >= NEAR_SHARE[0] && near.pct <= NEAR_SHARE[1], `seed ${seed}: crests are ${near.pct.toFixed(2)} % of the near desert`)
    assert.ok(far.pct >= DEEP_SHARE, `seed ${seed}: crests are only ${far.pct.toFixed(2)} % of the deep desert`)
  }
})

test('every crest lies where the field says, shaped by the crests round it', () => {
  let joined = 0
  for (const seed of SEEDS) for (const { wx, wy } of artPieces(seed)) {
    const { t, dune, X0, Y0, at } = built(seed, wx, wy)
    // the field over the piece and its margin, worked out at once, is crestAt tile by tile
    const N2 = PIECE + 2 * MARGIN, F = duneField(seed, X0 - MARGIN, Y0 - MARGIN, N2, N2)
    const fi = (x, y) => (y + MARGIN) * N2 + x + MARGIN
    const fieldAt = (x, y) => F.crest[fi(x, y)] === 1
    for (let i = 0; i < 300; i++) {
      const x = (hashInt(seed, wx, wy, i) % N2) - MARGIN, y = (hashInt(seed, wy, wx, i) % N2) - MARGIN
      assert.equal(crestAt(seed, X0 + x, Y0 + y), fieldAt(x, y), `${at}: crestAt and crestField at ${x},${y}`)
    }
    // a corner's side of the wave as layDunes reads it (1 the windward top, -1
    // the slip face, 0 a band's end), and whether level ground evened it
    const side = (vx, vy) => {
      let up = false, down = false
      for (const [cx, cy] of [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]]) if (!fieldAt(cx, cy)) { if (F.high[fi(cx, cy)]) up = true; else down = true }
      return up && !down ? 1 : down && !up ? -1 : up && down ? 0 : 1
    }
    const evened = (vx, vy) => [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]].some(([cx, cy]) => {
      const g = t.groundAt(cx, cy)
      return !(isRippleSkin(g) || isShadeSkin(g) || isDuneSkin(g)) || t.onSite(cx, cy) || t.keptOpen(cx, cy) || F.rim[fi(cx, cy)] === 1 || (fieldAt(cx, cy) && !dune(cx, cy))
    })
    for (let y = -MARGIN; y < PIECE + MARGIN; y++) for (let x = -MARGIN; x < PIECE + MARGIN; x++) {
      if (!dune(x, y)) continue
      assert.ok(fieldAt(x, y), `${at}: a crest at ${x},${y} off the field`)
      if (x === -MARGIN || y === -MARGIN || x === PIECE + MARGIN - 1 || y === PIECE + MARGIN - 1) continue
      const c = levels(t.groundAt(x, y))
      // the brink runs on only into another crest cell: where it leaves a cell, a crest cell takes it up
      for (const [dx, dy] of crossings(c))
        assert.ok(dune(x + dx, y + dy), `${at}: ${t.groundAt(x, y)} at ${x},${y} runs its brink into ${t.groundAt(x + dx, y + dy)}`)
      // and two crest cells side by side, the wave's two sides at the ends of
      // their shared side, are joined by the brink there (unless level ground evened it)
      for (const [dx, dy, i, j, v1, v2] of [[1, 0, 1, 2, [x + 1, y], [x + 1, y + 1]], [0, 1, 3, 2, [x, y + 1], [x + 1, y + 1]]]) {
        if (!dune(x + dx, y + dy) || side(...v1) * side(...v2) !== -1) continue
        joined++
        assert.ok(c[i] * c[j] === -1 || evened(...v1) || evened(...v2), `${at}: no brink between the crest cells ${x},${y} and ${x + dx},${y + dy} (${t.groundAt(x, y)}, ${t.groundAt(x + dx, y + dy)})`)
      }
    }
  }
  assert.ok(joined > 1000, `only ${joined} brinks between crest cells looked at`)
})

test('dunes are large', t => {
  const spreads = []
  for (const seed of SEEDS) for (const band of BANDS) {
    const { W, X0, Y0, crest, height, inBand } = stretch(seed, band)
    // from a crest along the wind to the next crest beyond it
    const gaps = [], tall = []
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (!crest(x, y) || !inBand(x, y)) continue
      tall.push(height(x, y))
      if (band === 'deep' && (x * 7 + y * 13) % 3) continue
      const a = windAt(seed, X0 + x, Y0 + y), ux = Math.cos(a), uy = Math.sin(a)
      for (let s = 4; s <= 80; s++) {
        const px = Math.round(x + ux * s), py = Math.round(y + uy * s)
        if (px < 0 || py < 0 || px >= W || py >= W) break
        if (crest(px, py)) { gaps.push(s); break }
      }
    }
    assert.ok(gaps.length > 100, `seed ${seed} ${band}: only ${gaps.length} crests with another downwind`)
    // dunes 20 to 40 tiles apart near home, and closer deep in the desert but never under 16
    const gap = quantile(gaps, 0.5)
    if (band === 'near') assert.ok(gap >= 20 && gap <= 40, `seed ${seed}: near home crests lie a median ${gap} tiles apart along the wind`)
    else assert.ok(gap >= 16 && gap <= 40, `seed ${seed}: deep in the desert crests lie a median ${gap} tiles apart along the wind`)
    // and some dunes stand taller than others (heights run 0 to 1)
    const lo = quantile(tall, 0.1), hi = quantile(tall, 0.9)
    spreads.push(`${seed} ${band} ${(hi - lo).toFixed(3)}`)
    assert.ok(hi - lo >= 0.2, `seed ${seed} ${band}: crest heights ${lo.toFixed(2)} to ${hi.toFixed(2)} (10th to 90th percentile)`)
  }
  t.diagnostic(`crest height spreads (90th - 10th percentile): ${spreads.join(', ')}`)
})

test('a dune has a gentle windward side and a steep slip face', () => {
  for (const seed of SEEDS) for (const band of BANDS) {
    const { W, X0, Y0, crest, height, inside, inBand } = stretch(seed, band)
    const rises = [], falls = []
    let longer = 0
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (!crest(x, y) || !inBand(x, y) || (x * 5 + y * 3) % (band === 'near' ? 2 : 7)) continue
      const a = windAt(seed, X0 + x, Y0 + y), ux = Math.cos(a), uy = Math.sin(a), top = height(x, y)
      // how many cells the ground keeps going down from the crest, upwind and downwind, before it is low
      const run = dir => {
        let n = 0, last = top
        for (let s = 1; s < 60; s++) {
          const px = Math.round(x + dir * ux * s), py = Math.round(y + dir * uy * s)
          if (!inside(px, py)) return null
          const h = height(px, py)
          if (h > last + 0.02 * top || h <= 0.1 * top) return n
          n++; last = h
        }
        return n
      }
      const rise = run(-1), fall = run(1)
      if (rise === null || fall === null) continue
      rises.push(rise); falls.push(fall)
      if (rise > fall) longer++
    }
    assert.ok(rises.length > 30, `seed ${seed} ${band}: only ${rises.length} crests looked at`)
    const r = quantile(rises, 0.5), f = quantile(falls, 0.5)
    assert.ok(r >= 2 * f, `seed ${seed} ${band}: the windward side rises over a median ${r} cells, the slip face falls over ${f}`)
    assert.ok(longer >= 0.85 * rises.length, `seed ${seed} ${band}: the windward side is the longer at only ${longer} of ${rises.length} crests`)
  }
})

test('shading follows the slope', () => {
  // in the open desert (where the height does not ease off), off the crests
  // (whose two sides the crest tiles draw) and away from anything level
  // (ways, sites, other ground), a cell is drawn lighter where its slope
  // faces the light from the upper left and darker where it faces away
  const flatGround = g => !isRippleSkin(g) && !isShadeSkin(g) && !isDuneSkin(g)
  let lit = 0, litOk = 0, dark = 0, darkOk = 0, wrong = 0
  for (const seed of SEEDS) for (const { wx, wy } of artPieces(seed)) {
    const { t, X0, Y0 } = built(seed, wx, wy)
    const N = PIECE + 4, F = duneField(seed, X0 - 2, Y0 - 2, N, N), at = (x, y) => (y + 2) * N + x + 2
    const h = (x, y) => F.height[at(x, y)], band = (x, y) => F.crest[at(x, y)] === 1
    for (let y = 2; y < PIECE - 2; y++) for (let x = 2; x < PIECE - 2; x++) {
      if (band(x, y)) continue
      let near = false
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (F.ease[at(x + dx, y + dy)] < 1 || flatGround(t.groundAt(x + dx, y + dy)) || t.keptOpen(x + dx, y + dy) || t.onSite(x + dx, y + dy)) { near = true; break }
      }
      if (near) continue
      const s = (h(x + 1, y + 1) - h(x - 1, y - 1)) / (2 * Math.SQRT2)
      const c = levels(t.groundAt(x, y)), m = c.reduce((a, b) => a + b, 0) / 4
      if (s >= 1.5 * LIGHT.lit) { lit++; if (m > 0) litOk++; if (m < 0) wrong++ }
      else if (s <= -1.5 * LIGHT.shade) { dark++; if (m < 0) darkOk++; if (m > 0) wrong++ }
    }
  }
  assert.ok(lit > 2000 && dark > 50, `only ${lit} cells facing the light and ${dark} facing away`)
  assert.ok(litOk >= 0.95 * lit, `${litOk} of ${lit} cells facing the light are drawn lighter`)
  assert.ok(darkOk >= 0.9 * dark, `${darkOk} of ${dark} cells facing away are drawn darker`)
  assert.ok(wrong <= 0.005 * (lit + dark), `${wrong} cells drawn against their slope`)
})

test('no cell squares: the corners of neighbouring cells agree', () => {
  let shaded = 0, pairs = 0
  for (const seed of SEEDS) for (const { wx, wy } of allPieces(seed)) {
    const { t, at } = built(seed, wx, wy)
    const c = Array.from({ length: PIECE }, (_, y) => Array.from({ length: PIECE }, (_, x) => levels(t.groundAt(x, y))))
    each((x, y) => {
      const a = c[y][x]
      if (!allZero(a)) shaded++
      if (x + 1 < PIECE) {
        const b = c[y][x + 1]
        if (!allZero(a) || !allZero(b)) pairs++
        assert.ok(a[1] === b[0] && a[2] === b[3], `${at}: ${t.groundAt(x, y)} at ${x},${y} beside ${t.groundAt(x + 1, y)}`)
      }
      if (y + 1 < PIECE) {
        const b = c[y + 1][x]
        if (!allZero(a) || !allZero(b)) pairs++
        assert.ok(a[3] === b[0] && a[2] === b[1], `${at}: ${t.groundAt(x, y)} at ${x},${y} above ${t.groundAt(x, y + 1)}`)
      }
    })
  }
  assert.ok(shaded > 50000 && pairs > 100000, `only ${shaded} shaded cells, ${pairs} pairs`)
})

test('low swells do not block sight', () => {
  for (const seed of SEEDS) for (const band of BANDS) {
    const { W, X0, Y0, crest, height, inBand } = stretch(seed, band)
    let body = 0, open = 0
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      // a crest only where the dune stands as high as a crest needs there (lower deep in the desert)
      const h = height(x, y)
      if (crest(x, y)) assert.ok(h >= crestHeightAt(X0 + x, Y0 + y), `seed ${seed}: a crest only ${h.toFixed(2)} high at ${X0 + x},${Y0 + y}`)
      if (band !== 'near' || !inBand(x, y) || h < 0.1) continue
      body++
      let near = false
      for (let dy = -6; dy <= 6 && !near; dy++) for (let dx = -6; dx <= 6; dx++) if (crest(x + dx, y + dy)) { near = true; break }
      if (!near) open++
    }
    // and near home there are dunes low enough to have none
    if (band === 'near') assert.ok(open >= 0.05 * body, `seed ${seed}: only ${open} of ${body} cells of near dune lie away from a crest`)
  }
})

test('no lone corner of slip face', () => {
  // a corner of slip face with no other beside it along a side would draw as
  // a dithered diamond: only a crest cell's lee corner may stand alone
  let slip = 0
  for (const seed of SEEDS) for (const { wx, wy } of artPieces(seed)) {
    const { t, dune, at } = built(seed, wx, wy)
    // the corners of the piece's cells, from their skins (shared corners agree: tested below)
    const V = PIECE + 1, corner = new Int8Array(V * V).fill(0)
    each((x, y) => {
      const c = levels(t.groundAt(x, y))
      corner[y * V + x] = c[0]; corner[y * V + x + 1] = c[1]; corner[(y + 1) * V + x + 1] = c[2]; corner[(y + 1) * V + x] = c[3]
    })
    for (let y = 1; y < PIECE; y++) for (let x = 1; x < PIECE; x++) {
      const k = y * V + x
      if (corner[k] !== -1) continue
      slip++
      if (corner[k - 1] === -1 || corner[k + 1] === -1 || corner[k - V] === -1 || corner[k + V] === -1) continue
      assert.ok(dune(x - 1, y - 1) || dune(x, y - 1) || dune(x - 1, y) || dune(x, y), `${at}: a lone corner of slip face at ${x},${y}`)
    }
  }
  assert.ok(slip > 5000, `only ${slip} corners of slip face looked at`)
})

test('a crest band runs edge to edge: no sight line slips between two crest cells', () => {
  // the field itself, over the stretches near home and deep in the desert (crossing the ramp near home)
  for (const seed of SEEDS) for (const band of BANDS) {
    const { W, X0, Y0, crest: on } = stretch(seed, band)
    let crests = 0
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue
      crests++
      for (const dx of [1, -1]) if (on(x + dx, y + 1)) assert.ok(on(x + dx, y) || on(x, y + 1), `seed ${seed}: crest cells ${X0 + x},${Y0 + y} and ${X0 + x + dx},${Y0 + y + 1} touch only at a corner`)
    }
    assert.ok(crests > (band === 'near' ? 300 : 1000), `seed ${seed} ${band}: only ${crests} crest cells`)
  }
  // as laid: where two crest cells touch only at a corner, the band was cut
  // there (a way, a site, something standing): a cell between them is crest in
  // the field but not laid, and a sight line through the cut is meant
  for (const seed of SEEDS) for (const { wx, wy } of allPieces(seed)) {
    const { dune, X0, Y0, at } = built(seed, wx, wy)
    each((x, y) => {
      if (!dune(x, y)) return
      for (const dx of [1, -1]) {
        if (!dune(x + dx, y + 1) || dune(x + dx, y) || dune(x, y + 1)) continue
        assert.ok(crestAt(seed, X0 + x + dx, Y0 + y) || crestAt(seed, X0 + x, Y0 + y + 1), `${at}: crest cells ${x},${y} and ${x + dx},${y + 1} touch only at a corner`)
      }
    })
  }
})

test('no dune on a way', () => {
  let ways = 0
  for (const seed of SEEDS) for (const { wx, wy } of allPieces(seed)) {
    const { t, piece, dune, onWay, at } = built(seed, wx, wy)
    each((x, y) => {
      if (onWay(x, y)) ways++
      if (!dune(x, y)) return
      for (const [dx, dy] of AROUND) {
        const nx = x + dx, ny = y + dy
        assert.ok(!onWay(nx, ny), `${at}: a crest at ${x},${y} on or beside the way at ${nx},${ny}`)
        // and by the art: no road or path on or beside a crest
        const g = t.groundAt(nx, ny) ?? ''
        assert.ok(!/^ow_(road|path)_/.test(g), `${at}: a crest at ${x},${y} beside ${g} at ${nx},${ny}`)
      }
      // nor a road's verge on it (a verge lies beside a road)
      assert.equal(t.decoAt(x, y), null, `${at}: a crest at ${x},${y} under ${t.decoAt(x, y)}`)
    })
    for (const [side, g] of Object.entries(piece.gates)) {
      assert.ok(t.walkable(g.x, g.y), `${at}: gate ${side} is blocked`)
      assert.ok(!dune(g.x, g.y), `${at}: a crest on gate ${side}`)
    }
  }
  assert.ok(ways > 10000, `only ${ways} way cells looked at`)
})

test('no dune on a site, and a site stands on level sand', () => {
  let looked = 0, level = 0
  for (const seed of SEEDS) for (const { wx, wy } of allPieces(seed)) {
    const { t, piece, dune, at } = built(seed, wx, wy)
    // the ground a site is built on and the ground kept open round what a feature holds is level
    each((x, y) => {
      if (!t.onSite(x, y) && !t.keptOpen(x, y)) return
      level++
      assert.ok(allZero(levels(t.groundAt(x, y))), `${at}: ${t.groundAt(x, y)} on a site's ground at ${x},${y}`)
    })
    for (const d of piece.doors) {
      looked++
      assert.ok(!dune(d.x, d.y) && !dune(d.x, d.y + 1), `${at}: a crest at the door ${d.label} or its doorstep`)
    }
    for (const s of piece.spawns) { looked++; assert.ok(!dune(s.x, s.y), `${at}: a crest under the ${s.kind} at ${s.x},${s.y}`) }
    const m = piece.main, pad = padOf(m.kind)
    assert.ok(pad > 0, `${at}: no pad for ${m.kind}`)
    for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++)
      if (dx * dx + dy * dy <= pad * pad) assert.ok(!dune(m.x + dx, m.y + dy), `${at}: a crest on the ${m.kind}'s pad at ${m.x + dx},${m.y + dy}`)
  }
  assert.ok(looked > 300 && level > 20000, `only ${looked} doors and spawns and ${level} cells of site ground looked at`)
})

test('no dunes near home', () => {
  for (const seed of SEEDS) {
    for (let wy = -1; wy <= 1; wy++) for (let wx = -1; wx <= 1; wx++) {
      const { t, dune, at } = built(seed, wx, wy)
      each((x, y) => assert.ok(!dune(x, y) && allZero(levels(t.groundAt(x, y))), `${at}: ${t.groundAt(x, y)} at ${x},${y}`))
    }
    // nor anywhere in the field there: the ground round home is level
    const f = duneField(seed, -PIECE, -PIECE, 3 * PIECE, 3 * PIECE)
    assert.ok(!f.crest.includes(1), `seed ${seed}: the field has a crest round home`)
    assert.ok(f.height.every(h => h === 0), `seed ${seed}: the ground round home is not level`)
  }
})

test('nor on Kalevanlinna, nor within eight tiles of it', () => {
  // the city's pieces are (0..1, 2..3): tiles (0..159, 160..319)
  for (const seed of [...SEEDS, 8]) {
    const f = duneField(seed, -8, 152, 176, 176)
    assert.ok(!f.crest.includes(1), `seed ${seed}: a crest by the city`)
    assert.ok(f.height.every(h => h === 0), `seed ${seed}: the ground by the city is not level`)
  }
})

// Seed 1's piece 5,0 and its east neighbour 6,0 (5 pieces out, early in the
// ramp): there 6,0's outermost margin cells at 76,25 and 76,26 of 5,0 lie
// beside a lone corner of slip face that 5,0 can see is lone (a road seven
// cells in, past the frame, keeps a crest beside it unlaid) and 6,0 cannot.
const REGRESSION = { seed: 1, wx: 5, wy: 0, dx: 1, dy: 0 }
// Desert pieces early in the ramp (centre 3.5 to 5.5 pieces out) with a
// desert neighbour east or south: the one nearest 4 pieces out and the one
// nearest 5, scan order breaking ties.
const earlyRamp = seed => {
  const ds = desertPieces(seed).filter(p => !inGentleRing(p.wx, p.wy)), keys = new Set(ds.map(p => `${p.wx},${p.wy}`))
  const cands = ds.map(p => ({ ...p, d: Math.hypot(p.wx, p.wy), dirs: [[1, 0], [0, 1]].filter(([dx, dy]) => keys.has(`${p.wx + dx},${p.wy + dy}`)) }))
    .filter(p => p.d >= 3.5 && p.d <= 5.5 && p.dirs.length)
  const out = []
  for (const target of [4, 5]) {
    const best = cands.filter(p => !out.some(o => o.wx === p.wx && o.wy === p.wy))
      .reduce((a, p) => !a || Math.abs(p.d - target) < Math.abs(a.d - target) ? p : a, null)
    if (best) out.push({ ...best, early: true })
  }
  return out
}
// A margin cell's corners NW NE SE SW that lie on the outermost line of
// corners its builder works out, by the side of the piece the margin lies on.
const OUTER = { E: [1, 2], W: [0, 3], S: [2, 3], N: [0, 1] }
test('crests and their shading are pure in the world tile', t => {
  // A piece lays the world tile in its MARGIN as its neighbour lays it: crest
  // or not, and the crest's ground, in every margin cell, and the slopes'
  // shading in the three nearest the edge. The outermost margin cell is the
  // one exemption: whether a corner of slip face on the builder's outermost
  // line of corners is lone (and laid as flat sand) depends on a crest cell
  // two beyond, and that on a way three beyond, in the neighbour's interior,
  // which the piece cannot see. So its shading may differ there, at those
  // corners alone, by -1 against 0. No cell of a piece's own 80 x 80 reads
  // that cell (desert-art.js layDunes), and the drawn cells across every
  // edge meet corner to corner.
  let seen = 0, slopes = 0, early = 0, regression = 0, exempt = 0, seam = 0
  for (const seed of SEEDS) {
    // (pieces in the ramp between near and deep, early in the ramp, and deep in the desert)
    const ds = desertPieces(seed).filter(p => !inGentleRing(p.wx, p.wy))
    const keys = new Set(ds.map(p => `${p.wx},${p.wy}`))
    const both = [[1, 0], [0, 1]]
    const ramp = ds.filter(p => keys.has(`${p.wx + 1},${p.wy}`) && keys.has(`${p.wx},${p.wy + 1}`)).slice(0, 2)
    const first = earlyRamp(seed)
    const pairs = [...ramp.map(p => ({ ...p, dirs: both })), ...first, ...deepPairs(seed).slice(0, 2).map(p => ({ ...p, dirs: both }))]
    if (seed === REGRESSION.seed) pairs.push({ wx: REGRESSION.wx, wy: REGRESSION.wy, dirs: [[REGRESSION.dx, REGRESSION.dy]], regression: true })
    assert.ok(ramp.length === 2 && first.length === 2, `seed ${seed}: too few desert pieces with desert neighbours`)
    assert.ok(ramp.every(p => pieceDepth(p.wx, p.wy).hi > 0 && pieceDepth(p.wx, p.wy).lo < 1), `seed ${seed}: the first pairs are not in the ramp`)
    for (const { wx, wy, dirs, early: isEarly, regression: reg } of pairs) for (const [da, db] of reg ? [[0, 3], [3, 0], [1, 2]] : [[0, 3], [3, 0]]) {
      const A = built(seed, wx, wy, da)
      if (reg) regression++
      if (isEarly) early++
      for (const [dx, dy] of dirs) {
        const N = built(seed, wx + dx, wy + dy, db)
        for (let i = 0; i < PIECE; i++) {
          // the drawn cells across the edge: A's last against N's first
          const [ax, ay, nx, ny] = dx ? [PIECE - 1, i, 0, i] : [i, PIECE - 1, i, 0]
          const ca = levels(A.ground(ax, ay)), cn = levels(N.ground(nx, ny))
          if (!allZero(ca) || !allZero(cn)) seam++
          assert.ok(dx ? ca[1] === cn[0] && ca[2] === cn[3] : ca[3] === cn[0] && ca[2] === cn[1],
            `${A.at}/${N.at}: ${A.ground(ax, ay)} at ${ax},${ay} meets ${N.ground(nx, ny)} across the edge`)
          for (let k = 0; k < MARGIN; k++) {
            // the same world tile, as each piece lays it: A's margin is N's first cells, and back
            for (const [[P, px, py], [Q, qx, qy], side] of dx ? [
              [[A, PIECE + k, i], [N, k, i], 'E'], [[N, -1 - k, i], [A, PIECE - 1 - k, i], 'W'],
            ] : [
              [[A, i, PIECE + k], [N, i, k], 'S'], [[N, i, -1 - k], [A, i, PIECE - 1 - k], 'N'],
            ]) {
              const p = P.dune(px, py), q = Q.dune(qx, qy)
              assert.equal(p, q, `${A.at}/${N.at}: a crest in one and not the other at ${qx},${qy} of ${Q.wx},${Q.wy}`)
              const gp = P.ground(px, py), gq = Q.ground(qx, qy)
              if (p) {
                seen++
                assert.equal(gp, gq, `${A.at}/${N.at}: two crests at ${qx},${qy} of ${Q.wx},${Q.wy}`)
                continue
              }
              if (!isShadeSkin(gp) && !isShadeSkin(gq)) continue
              slopes++
              if (gp === gq) continue
              const at = `${A.at}/${N.at}: two slopes at ${qx},${qy} of ${Q.wx},${Q.wy} (margin cell ${k} from the edge)`
              assert.ok(k === MARGIN - 1, at)
              // (the outermost: only the corners on its builder's outer line, and only -1 against 0)
              const cp = levels(gp), cq = levels(gq)
              assert.ok(cp.every((l, j) => l === cq[j] || (OUTER[side].includes(j) && l + cq[j] === -1 && l * cq[j] === 0)), `${at}: ${gp} against ${gq}`)
              exempt++
            }
          }
        }
      }
    }
  }
  assert.ok(early === 12 && regression === 3, `${early} early-ramp and ${regression} regression piece builds compared`)
  assert.ok(seen > 200 && slopes > 300 && seam > 1000, `only ${seen} margin crest cells, ${slopes} slope cells and ${seam} shaded edge cells compared`)
  t.diagnostic(`${exempt} outermost margin cells laid apart by a lone corner`)
})

test('a crest crossing a piece edge is one band', () => {
  // a crest cell of the field that may not be laid: by a way, under something standing, off the sand
  const cut = (P, x, y) => AROUND.some(([dx, dy]) => P.corridor(x + dx, y + dy)) || !P.t.walkable(x, y) || !!P.t.propAt(x, y)
    || !(isRippleSkin(P.ground(x, y)) || isDuneSkin(P.ground(x, y)))
  let crossings = 0
  for (const seed of SEEDS) {
    const ds = [...desertPieces(seed).filter(p => !inGentleRing(p.wx, p.wy)), ...deepPairs(seed).slice(0, 2)]
    for (const { wx, wy } of ds) {
      const A = built(seed, wx, wy, 0)
      // A's last column against E's first, A's last row against S's first, and back
      for (const [N, along] of [[built(seed, wx + 1, wy, 3), 'x'], [built(seed, wx, wy + 1, 3), 'y']]) {
        // (c, o): c across the edge (PIECE - 1 the last line of A, PIECE the first of N), o along it
        const cell = (c, o) => along === 'x' ? [c, o] : [o, c]
        for (const [from, to, F, G, step] of [[PIECE - 1, PIECE, A, N, 1], [PIECE, PIECE - 1, N, A, -1]]) {
          const local = (P, c, o) => { const [x, y] = cell(c, o); return P === A ? [x, y] : along === 'x' ? [x - PIECE, y] : [x, y - PIECE] }
          for (let o = 0; o < PIECE; o++) {
            const [fx, fy] = local(F, from, o)
            if (!F.dune(fx, fy)) continue
            // where the band runs on over the edge (not along it, nor turning
            // back), onto bare sand that no way, nor anything standing, cuts
            const over = [-1, 0, 1].filter(d => {
              if (o + d < 0 || o + d >= PIECE) return false
              const [x, y] = cell(to, o + d), [gx, gy] = local(G, to, o + d)
              return crestAt(seed, wx * PIECE + x, wy * PIECE + y) && !cut(G, gx, gy)
            })
            if (!over.length) continue
            crossings++
            const runs = [-1, 0, 1].some(d => { const [gx, gy] = local(G, to, o + d); return G.dune(gx, gy) })
            assert.ok(runs, `${A.at}: the crest at ${fx},${fy} of ${F.wx},${F.wy} stops at the edge with ${G.wx},${G.wy} (step ${step})`)
          }
        }
      }
    }
  }
  assert.ok(crossings > 200, `only ${crossings} crests crossing an edge`)
})

test('everything the piece offers stays reachable', () => {
  const list = s => JSON.stringify(s.map(e => [e.kind ?? e.label, e.x, e.y]))
  let pieces = 0
  for (const seed of SEEDS) for (const { wx, wy } of [...desertPieces(seed), ...deepPieces(seed).slice(0, 1)]) {
    if (inGentleRing(wx, wy)) continue
    const on = generatePiece(seed, wx, wy, 0), off = without(() => generatePiece(seed, wx, wy, 0))
    assert.equal(dunesOn(), true)
    pieces++
    const at = `seed ${seed} piece ${wx},${wy}`
    assert.equal(on.spawns.length, off.spawns.length, `${at}: ${off.spawns.length - on.spawns.length} spawns dropped among the dunes`)
    assert.ok(list(on.spawns) === list(off.spawns), `${at}: the spawns differ with the dunes`)
    assert.ok(list(on.doors) === list(off.doors) && list(on.caves) === list(off.caves), `${at}: the doors or caves differ with the dunes`)
    assert.equal(on.packs.length, off.packs.length, `${at}: packs`)
    // nothing but the ground of the crests changes
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      const a = on.cells[y][x], b = off.cells[y][x]
      assert.equal(a.tile, b.tile, `${at}: tile at ${x},${y}`)
      if (a.skin !== b.skin) assert.ok((a.losDune || isShadeSkin(a.skin)) && isRippleSkin(b.skin), `${at}: ${b.skin} became ${a.skin} at ${x},${y}`)
    }
  }
  assert.ok(pieces > 40, `only ${pieces} pieces`)
})

test('a laid band has gaps only at ways, sites, kept ground and level ground', () => {
  // nothing grows or lies on a crest of the field (terrain.js occupant), so a
  // crest of the field is laid wherever its ground is the desert's sand, off
  // the ways and what a feature holds; where level ground beside it (a way's,
  // a site's, other ground, other country) has smoothed its brink away; and at
  // a band's end, where the band is shaded but no brink crosses it (a hole a
  // plant punched in a band would be level all round instead)
  const levelGround = (t, x, y) => {
    const g = t.groundAt(x, y)
    return (!isRippleSkin(g) && !isShadeSkin(g) && !isDuneSkin(g)) || t.onSite(x, y) || t.keptOpen(x, y) || t.biome(x, y) !== 'desert'
  }
  let gaps = 0, crests = 0
  for (const seed of SEEDS) for (const { wx, wy } of allPieces(seed)) {
    const { t, dune, onWay, at } = built(seed, wx, wy)
    const near = (x, y, r, test) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (test(x + dx, y + dy)) return true; return false }
    each((x, y) => {
      if (!t.onCrest(x, y)) return
      crests++
      if (dune(x, y)) return
      gaps++
      const g = t.groundAt(x, y)
      const why = AROUND.some(([dx, dy]) => onWay(x + dx, y + dy)) ? 'way'
        : t.onSite(x, y) || t.keptOpen(x, y) ? 'site'
        : !isRippleSkin(g) && !isShadeSkin(g) ? 'ground'
        : near(x, y, 2, (a, b) => levelGround(t, a, b) || onWay(a, b)) ? 'level'
        : !allZero(levels(g)) && crossings(levels(g)).length === 0 ? 'end' : null
      assert.ok(why, `${at}: the crest at ${x},${y} is not laid (${g}${t.propAt(x, y) ? ' under ' + t.propAt(x, y) : ''})`)
    })
  }
  assert.ok(crests > 10000 && gaps > 100, `${crests} crest cells of the field, ${gaps} not laid`)
})

test('a recorded place keeps clear of dunes, on level sand', () => {
  // tales whose places have keep-outs and ways of their own, forced onto
  // deep desert as a recorded place is laid whatever the land (world.places)
  const TALES = ['elk', 'tar', 'lalli', 'fold', 'nakki', 'sampo_sea']
  let near = 0
  for (const seed of SEEDS) {
    const far = desertPieces(seed).filter(p => !inGentleRing(p.wx, p.wy) && Math.abs(p.wx) + Math.abs(p.wy) > 3).slice(0, 3)
    for (const { wx, wy } of far) for (const id of TALES) {
      const { t, piece, dune, onWay, at } = built(seed, wx, wy, 0, id)
      const geo = layoutTale(id, mulberry32(hashInt(seed, wx, wy, 500)), side => t.gateInner(side))
      assert.equal(piece.main.kind, `tale_${id}`, at)
      const bad = []
      each((x, y) => {
        // the place's pad is level ground
        if (Math.hypot(x - geo.cx, y - geo.cy) <= TALE_PAD[id] && !allZero(levels(t.groundAt(x, y)))) bad.push(`${t.groundAt(x, y)} at ${x},${y} on the pad`)
        if (!dune(x, y)) return
        if (Math.hypot(x - geo.cx, y - geo.cy) <= TALE_PAD[id]) bad.push(`${x},${y} on the pad`)
        for (const k of geo.keep) if (Math.hypot(x - k.x, y - k.y) <= k.r) bad.push(`${x},${y} in the keep at ${k.x},${k.y}`)
        for (const w of geo.ways ?? []) if (Math.abs(w.x - x) <= 1 && Math.abs(w.y - y) <= 1) bad.push(`${x},${y} by the way at ${w.x},${w.y}`)
        for (const p of piece.points) if (Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1) bad.push(`${x},${y} by ${p.label}`)
        if (AROUND.some(([dx, dy]) => onWay(x + dx, y + dy))) bad.push(`${x},${y} by a road or path`)
        if (Math.hypot(x - geo.cx, y - geo.cy) <= TALE_PAD[id] + 8) near++
      })
      assert.ok(bad.length === 0, `${at}: ${bad.slice(0, 5).join('; ')}`)
    }
  }
  assert.ok(near > 100, `only ${near} crests near the places: the test saw little desert`)
})
