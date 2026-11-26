// The desert's ground (renderer/wilds/desert-art.js): rippled sand swept by
// a wind that is pure in the world tile, and hardpan that frays into it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  windAt, sandSkinAt, SAND_SKINS, HARDPAN_SKINS, HARDPAN_EDGES, DESERT_SKINS, RIPPLES,
  isRippleSkin, isHardpanSkin, isCrackedSkin, isHardpanEdge, isDuneSkin, isWindwardSkin, setDesertDress, desertDress, WIND,
} from '../renderer/wilds/desert-art.js'
import { makeTerrain, TERRAIN_SKINS } from '../renderer/wilds/terrain.js'
import { PIECE, MARGIN } from '../renderer/wilds/layout.js'
import { hashInt } from '../renderer/wilds/rand.js'
import { isDesert } from '../renderer/wilds/desert.js'
import { classOf, CLASS } from '../renderer/wilds/map.js'

const TILES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer/assets/tiles')
const built = (seed, wx, wy, deal = 0) => { const t = makeTerrain(seed, wx, wy, deal); t.finish(); return t }
const groundOf = (t, x, y) => t.b.palette[t.b.ground[y + MARGIN]?.[x + MARGIN]] ?? null
const without = fn => { setDesertDress(false); try { return fn() } finally { setDesertDress(true) } }
// desert pieces of seed 7, hardpan and all (render 7 8 -1 2 2), each with a
// block of 40 x 40 tiles in it that is desert through and through
const DESERT = [[7, 8, -1, 40, 20], [7, 9, -1, 20, 20], [7, 8, 0, 20, 0], [7, 9, 0, 20, 20]]
const orientOf = n => +/^ow_sand_ripple_(\d+)_\d+$/.exec(n)[1]

// a 2x2 window laid a b / c d is a checker when a = d, b = c and a != b
const checkers = (at, x0, y0, w, h) => {
  let bad = 0, all = 0
  for (let y = y0; y < y0 + h - 1; y++) for (let x = x0; x < x0 + w - 1; x++) {
    const a = at(x, y), b = at(x + 1, y), c = at(x, y + 1), d = at(x + 1, y + 1)
    if (a == null || b == null || c == null || d == null) continue
    all++
    if (a === d && b === c && a !== b) bad++
  }
  return { bad, all }
}

test('sand never lays a checker', () => {
  for (const [seed, wx, wy, ox, oy] of DESERT) {
    const X0 = wx * PIECE + ox, Y0 = wy * PIECE + oy
    for (let y = Y0; y < Y0 + 40; y++) for (let x = X0; x < X0 + 40; x++) assert.ok(isDesert(seed, x, y), `${x},${y} is not desert`)
    const pure = checkers((x, y) => sandSkinAt(seed, x, y), X0, Y0, 40, 40)
    assert.ok(pure.bad / pure.all <= 0.02, `seed ${seed} at ${X0},${Y0}: ${pure.bad} of ${pure.all} windows are a checker`)
    // and as laid, over the whole piece, among the sand it lays
    const t = built(seed, wx, wy)
    const laid = checkers((x, y) => { const g = groundOf(t, x, y); return isRippleSkin(g) ? g : null }, 0, 0, PIECE, PIECE)
    assert.ok(laid.all > 1000, `seed ${seed} piece ${wx},${wy}: only ${laid.all} windows of sand`)
    assert.ok(laid.bad / laid.all <= 0.02, `seed ${seed} piece ${wx},${wy}: ${laid.bad} of ${laid.all} windows laid as a checker`)
  }
})

// The wind blows towards the south-east in every desert, so a dune's slip
// face (downwind of its crest) is always turned from the light, the upper
// left, which the dune tiles light from (tools/make-wilds-desert-tiles.mjs).
test('the wind never blows towards the upper left', () => {
  const lo = WIND.toward - WIND.spread - WIND.swing, hi = WIND.toward + WIND.spread + WIND.swing
  assert.ok(lo > -Math.PI / 4 && hi < 3 * Math.PI / 4, `the wind may blow from ${(lo * 180 / Math.PI).toFixed(0)} to ${(hi * 180 / Math.PI).toFixed(0)} degrees`)
  let seen = 0
  for (let seed = 1; seed <= 60; seed++) for (let i = 0; i < 400; i++) {
    const X = (hashInt(seed, i, 0, 1) % 20000) - 10000, Y = (hashInt(seed, i, 1, 1) % 20000) - 10000
    const w = windAt(seed, X, Y)
    assert.ok(w >= lo && w <= hi, `seed ${seed} tile ${X},${Y}: the wind blows at ${(w * 180 / Math.PI).toFixed(1)} degrees`)
    // downwind is never towards the light: the slip face looks away from the upper left
    assert.ok(Math.cos(w) + Math.sin(w) > 0, `seed ${seed} tile ${X},${Y}: the slip face looks towards the light`)
    seen++
  }
  assert.equal(seen, 24000)
})

test('a stretch of sand is swept one way', () => {
  for (const [seed, wx, wy, ox, oy] of DESERT) {
    const X0 = wx * PIECE + ox, Y0 = wy * PIECE + oy
    const count = new Map()
    for (let y = Y0; y < Y0 + 40; y++) for (let x = X0; x < X0 + 40; x++) {
      const o = orientOf(sandSkinAt(seed, x, y))
      count.set(o, (count.get(o) ?? 0) + 1)
    }
    const top = Math.max(...count.values())
    assert.ok(top / 1600 >= 0.6, `seed ${seed} at ${X0},${Y0}: the commonest sweep covers only ${(top / 16).toFixed(0)}%`)
    // the wind turns slowly: neighbours differ by little
    for (let i = 0; i < 200; i++) {
      const x = X0 + (i * 7) % 40, y = Y0 + (i * 13) % 40
      const d = Math.abs(Math.atan2(Math.sin(windAt(seed, x + 1, y) - windAt(seed, x, y)), Math.cos(windAt(seed, x + 1, y) - windAt(seed, x, y))))
      assert.ok(d < 0.1, `the wind turns ${d.toFixed(3)} rad in one tile at ${x},${y}`)
    }
  }
})

test('wind and sand are pure in the world tile', () => {
  for (const [seed, wx, wy] of DESERT) for (const [da, db] of [[0, 1], [2, 0]]) {
    const A = built(seed, wx, wy, da), E = built(seed, wx + 1, wy, db), S = built(seed, wx, wy + 1, db)
    const X0 = wx * PIECE, Y0 = wy * PIECE
    let seen = 0
    for (let i = 0; i < PIECE; i++) for (let k = 0; k < MARGIN; k++) {
      // the same world tile, as each piece lays it: A's margin is E's (or S's) first cells, and back
      const pairs = [
        [[A, PIECE + k, i], [E, k, i], X0 + PIECE + k, Y0 + i],
        [[E, -1 - k, i], [A, PIECE - 1 - k, i], X0 + PIECE - 1 - k, Y0 + i],
        [[A, i, PIECE + k], [S, i, k], X0 + i, Y0 + PIECE + k],
        [[S, i, -1 - k], [A, i, PIECE - 1 - k], X0 + i, Y0 + PIECE - 1 - k],
      ]
      for (const [[P, px, py], [Q, qx, qy], X, Y] of pairs) {
        const p = groundOf(P, px, py), q = groundOf(Q, qx, qy)
        // wherever either lays rippled sand, it is the world tile's own
        for (const g of [p, q]) if (isRippleSkin(g)) { assert.equal(g, sandSkinAt(seed, X, Y), `seed ${seed} tile ${X},${Y}`); seen++ }
        // a margin cell whose cells two deep round it both pieces hold (its
        // cracks look at its neighbours' neighbours): the same hardpan, edges and cracks
        if (k < MARGIN - 2 && (isHardpanSkin(p) || isHardpanSkin(q))) assert.equal(p, q, `seed ${seed} tile ${X},${Y}: hardpan ${p} / ${q}`)
      }
    }
    assert.ok(seen > 500, `seed ${seed} piece ${wx},${wy}: only ${seen} margin cells of sand compared`)
  }
})

test('hardpan has no square edge', () => {
  let edges = 0, cracked = 0
  for (const [seed, wx, wy] of DESERT) {
    const t = built(seed, wx, wy)
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      const g = groundOf(t, x, y)
      assert.notEqual(g, 'ow_hardpan_0', `seed ${seed} piece ${wx},${wy}: the old flat hardpan at ${x},${y}`)
      if (!isHardpanSkin(g)) continue
      let beside = false
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !isHardpanSkin(groundOf(t, x + dx, y + dy))) beside = true
      if (beside) { assert.ok(isHardpanEdge(g), `seed ${seed} piece ${wx},${wy}: ${g} at ${x},${y} is beside sand`); edges++ }
      else { assert.ok(isCrackedSkin(g), `seed ${seed} piece ${wx},${wy}: inner hardpan ${g} at ${x},${y}`); cracked++ }
    }
  }
  assert.ok(edges > 200, `only ${edges} hardpan edges`)
  assert.ok(cracked > 200, `only ${cracked} cells of cracked clay`)
})

test('a crack runs on from one cell of clay into the next', () => {
  const sides = n => +/^ow_hardpan_cracked_(\d+)_\d+$/.exec(n)[1]
  let crossings = 0
  for (const [seed, wx, wy] of DESERT) {
    const t = built(seed, wx, wy)
    for (let y = -1; y < PIECE; y++) for (let x = -1; x < PIECE; x++) {
      const g = groundOf(t, x, y)
      if (!isCrackedSkin(g)) continue
      // east and south: the cell beyond crosses the same border, or neither does
      const e = groundOf(t, x + 1, y), s = groundOf(t, x, y + 1)
      const toE = !!(sides(g) & 2), toS = !!(sides(g) & 4)
      assert.equal(isCrackedSkin(e) && !!(sides(e) & 8), toE, `seed ${seed} piece ${wx},${wy}: ${g} at ${x},${y} and ${e} east of it`)
      assert.equal(isCrackedSkin(s) && !!(sides(s) & 1), toS, `seed ${seed} piece ${wx},${wy}: ${g} at ${x},${y} and ${s} south of it`)
      crossings += toE + toS
    }
  }
  assert.ok(crossings > 100, `only ${crossings} cracks cross a border`)
})

test('every desert skin exists', () => {
  assert.ok(SAND_SKINS.length >= RIPPLES.length * 3)
  assert.ok(HARDPAN_SKINS.length > 0 && HARDPAN_EDGES.length > 0)
  const names = new Set(TERRAIN_SKINS)
  for (const n of DESERT_SKINS) {
    assert.ok(fs.existsSync(path.join(TILES, n + '.png')), `no tile art for ${n}`)
    assert.ok(names.has(n), `${n} is not in TERRAIN_SKINS`)
    assert.ok(!n.endsWith('_d'), `${n} ends in _d`)
    assert.ok(!n.startsWith('ow_dune_'), `${n} would block sight`)
    assert.equal(classOf({ skin: n }), CLASS.sand, `${n} is not sand on the map`)
  }
})

test('the beaches keep their sand, and the dress comes off', () => {
  assert.equal(desertDress(), true)
  for (const [seed, wx, wy] of DESERT) {
    const off = without(() => built(seed, wx, wy)), on = built(seed, wx, wy)
    let sand = 0
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      const a = groundOf(off, x, y), b = groundOf(on, x, y)
      const own = n => DESERT_SKINS.includes(n) || isDuneSkin(n) || isWindwardSkin(n)
      assert.ok(!own(a), `dress off lays ${a}`)
      // everything that is not the desert's own ground (its dunes and their slopes too) is the same
      if (!own(b)) assert.equal(a, b, `seed ${seed} piece ${wx},${wy} at ${x},${y}`)
      else { assert.ok(a === 'ow_sand_0' || a === 'ow_sand_flat' || a === 'ow_hardpan_0', `${a} under ${b}`); sand++ }
      assert.equal(off.walkable(x, y), on.walkable(x, y))
    }
    assert.ok(sand > 3000)
  }
  // a beach in sea country: plain sand, never the desert's ripples
  let beach = 0
  for (const [wx, wy] of [[0, 3], [1, 3], [2, 3], [5, 3], [4, 4]]) {
    const t = built(7, wx, wy)
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      if (t.biome(x, y) !== 'sea') continue
      const g = groundOf(t, x, y)
      assert.ok(!DESERT_SKINS.includes(g), `a beach at ${wx},${wy} ${x},${y} lays ${g}`)
      if (g === 'ow_sand_0') beach++
    }
  }
  assert.ok(beach > 100, `only ${beach} beach cells`)
})

// Kalevanlinna on seed 8, which has desert, hardpan and all, south-west of the
// city and under its south wall; the digest test's seed 7 has none.
const cityOf = async (seed, dressed) => {
  const { buildCity } = await import('../renderer/wilds/city/build.js')
  return dressed ? buildCity(seed) : without(() => buildCity(seed))
}
// inside the walls, on them, or the city's masonry anywhere (a wall's lower
// face, a tower's foot, the harbour): what the city lays itself
const walled = async () => {
  const { insideWalls, wallCells } = await import('../renderer/wilds/city/plan.js')
  const wc = wallCells()
  return (x, y, n, c) => insideWalls(x, y) || wc.has(y * n + x) || /^ow_city_/.test(c.overlay ?? '') || /^ow_city_/.test(c.deco ?? '')
}

// The city's land outside its walls: the open ground of its outskirts, where
// nothing stands (what the city builds there, a farmhouse say, keeps the
// ground it was built on, as the walls do).
test('Kalevanlinna\'s land frays and cracks its hardpan as the Wilds do', async () => {
  const city = await cityOf(8, true), inWalls = await walled(), n = city.cells.length
  let hard = 0
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = city.cells[y][x]
    if (inWalls(x, y, n, c) || c.overlay || c.deco) continue
    assert.notEqual(c.skin, 'ow_hardpan_0', `the old flat hardpan in the city's land at ${x},${y}`)
    if (isHardpanSkin(c.skin)) hard++
  }
  assert.ok(hard > 100, `only ${hard} cells of hardpan`)
})

test('nothing inside or on Kalevanlinna\'s walls, nor its masonry, changes with the desert\'s dress', async () => {
  const on = await cityOf(8, true), off = await cityOf(8, false), inWalls = await walled(), n = on.cells.length
  const cell = c => `${c.tile}|${c.skin}|${c.overlay ?? ''}|${c.deco ?? ''}|${c.ward ? 1 : 0}|${c.over ? 1 : 0}|${c.losClear ? 1 : 0}|${c.losTall ? 1 : 0}`
  let walls = 0, onHardpan = 0
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!inWalls(x, y, n, off.cells[y][x]) && !inWalls(x, y, n, on.cells[y][x])) continue
    walls++
    if (off.cells[y][x].skin === 'ow_hardpan_0') onHardpan++
    assert.equal(cell(on.cells[y][x]), cell(off.cells[y][x]), `seed 8, city cell ${x},${y}`)
  }
  assert.ok(walls > 10000, `only ${walls} cells inside and on the walls`)
  // (the case this holds: masonry standing on hardpan)
  assert.ok(onHardpan > 10, `only ${onHardpan} wall cells stand on hardpan`)
})
