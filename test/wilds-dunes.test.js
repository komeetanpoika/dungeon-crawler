// The desert's dunes (renderer/wilds/desert-art.js crestAt, layDunes): crest
// bands one or two cells wide, walked over but not seen past, laid by
// terrain.js on the desert's bare sand and kept off every way, site and
// place, the same in a piece and in its neighbour's margin whatever either's
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
import { crestAt, crestField, setDunes, dunesOn, isDuneSkin, isRippleSkin, isHardpanSkin, isWindwardSkin, DUNE_SKINS, WINDWARD_SKINS, WINDWARD_LEVELS } from '../renderer/wilds/desert-art.js'
import { PIECE, FRAME, MARGIN, pieceBiome, pieceKey, tierAt, lootDepthFor, gateAt } from '../renderer/wilds/layout.js'
import { pieceClass } from '../renderer/wilds/roads.js'
import { inGentleRing } from '../renderer/wilds/desert.js'
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
const maskOf = n => +/^ow_dune_(\d+)_\d+$/.exec(n)[1]

test('every dune tile exists, and the map shows a dune and its slopes as sand', () => {
  assert.equal(DUNE_SKINS.length, 16 * 3)
  assert.equal(WINDWARD_SKINS.length, WINDWARD_LEVELS * 8 * 3)
  const names = new Set(TERRAIN_SKINS)
  for (const n of [...DUNE_SKINS, ...WINDWARD_SKINS]) {
    assert.ok(!n.endsWith('_d'), `${n} ends in _d`)
    assert.ok(names.has(n), `${n} is not in TERRAIN_SKINS`)
    assert.ok(fs.existsSync(path.join(TILES, n + '.png')), `no tile art for ${n}`)
    assert.equal(classOf({ skin: n }), CLASS.sand, `${n} is not sand on the map`)
  }
  for (const n of DUNE_SKINS) assert.ok(n.startsWith('ow_dune_') && isDuneSkin(n) && cellOf(n, null, true).losDune, n)
  // a slope is walked over and seen across like any sand
  for (const n of WINDWARD_SKINS) assert.ok(isWindwardSkin(n) && !n.startsWith('ow_dune_') && !cellOf(n, null, true).losDune, n)
})

test('dunes lie in the desert', () => {
  for (const seed of SEEDS) {
    let ground = 0, dunes = 0
    for (const { wx, wy } of desertPieces(seed)) {
      if (inGentleRing(wx, wy)) continue
      const { t, dune } = built(seed, wx, wy)
      each((x, y) => {
        if (t.biome(x, y) !== 'desert' || !t.walkable(x, y) || t.propAt(x, y)) return
        const g = t.groundAt(x, y)
        if (!isRippleSkin(g) && !isHardpanSkin(g) && !isDuneSkin(g) && !isWindwardSkin(g)) return
        ground++
        if (dune(x, y)) dunes++
      })
    }
    assert.ok(ground > 20000, `seed ${seed}: only ${ground} cells of open desert ground`)
    assert.ok(dunes / ground >= 0.05, `seed ${seed}: ${dunes} of ${ground} cells of open desert ground (${(100 * dunes / ground).toFixed(1)} %) are crests`)
  }
})

test('every crest lies where the field says, shaped by the crests round it', () => {
  for (const seed of SEEDS) for (const { wx, wy } of desertPieces(seed).slice(0, 8)) {
    const { t, dune, X0, Y0, at } = built(seed, wx, wy)
    // the field over the piece and its margin, worked out at once, is crestAt tile by tile
    const field = crestField(seed, X0 - MARGIN, Y0 - MARGIN, PIECE + 2 * MARGIN, PIECE + 2 * MARGIN)
    const fieldAt = (x, y) => field[(y + MARGIN) * (PIECE + 2 * MARGIN) + x + MARGIN] === 1
    for (let i = 0; i < 300; i++) {
      const x = (hashInt(seed, wx, wy, i) % (PIECE + 2 * MARGIN)) - MARGIN, y = (hashInt(seed, wy, wx, i) % (PIECE + 2 * MARGIN)) - MARGIN
      assert.equal(crestAt(seed, X0 + x, Y0 + y), fieldAt(x, y), `${at}: crestAt and crestField at ${x},${y}`)
    }
    for (let y = -MARGIN; y < PIECE + MARGIN; y++) for (let x = -MARGIN; x < PIECE + MARGIN; x++) {
      if (!dune(x, y)) continue
      assert.ok(fieldAt(x, y), `${at}: a crest at ${x},${y} off the field`)
      if (x === -MARGIN || y === -MARGIN || x === PIECE + MARGIN - 1 || y === PIECE + MARGIN - 1) continue
      const want = (dune(x, y - 1) ? 1 : 0) | (dune(x + 1, y) ? 2 : 0) | (dune(x, y + 1) ? 4 : 0) | (dune(x - 1, y) ? 8 : 0)
      assert.equal(maskOf(t.groundAt(x, y)), want, `${at}: ${t.groundAt(x, y)} at ${x},${y}`)
    }
  }
})

test('the windward slope climbs to the crest', () => {
  let slopes = 0
  for (const seed of SEEDS) for (const { wx, wy } of desertPieces(seed).slice(0, 8)) {
    const { t, dune, X0, Y0, at } = built(seed, wx, wy)
    const L = WINDWARD_LEVELS, W = PIECE + L
    const field = crestField(seed, X0, Y0, W, W)
    const on = (x, y) => field[y * W + x] === 1
    // the fewest steps south and east to a crest of the field, up to L (0 for none)
    const steps = (x, y) => { for (let k = 1; k <= L; k++) for (let i = 0; i <= k; i++) if (on(x + i, y + k - i)) return k; return 0 }
    each((x, y) => {
      const g = t.groundAt(x, y), k = steps(x, y)
      if (isWindwardSkin(g)) {
        slopes++
        const [, l, o, v] = /^ow_sand_slope_(\d+)_(\d+)_(\d+)$/.exec(g).map(Number)
        assert.ok(k > 0 && l === L + 1 - k, `${at}: ${g} at ${x},${y}, ${k} steps from a crest`)
        assert.ok(!dune(x, y), `${at}: a slope that hides what is behind it at ${x},${y}`)
        assert.ok(o >= 0 && o < 8 && v >= 0 && v < 3, g)
      } else if (isRippleSkin(g)) {
        assert.equal(k, 0, `${at}: bare sand ${g} at ${x},${y}, ${k} steps upwind of a crest`)
      }
      // beside a crest on its north or west, open sand is the top of the slope
      if (dune(x, y)) for (const [dx, dy] of [[0, -1], [-1, 0]]) {
        const n = t.groundAt(x + dx, y + dy)
        if (x + dx >= 0 && y + dy >= 0 && (isRippleSkin(n) || isWindwardSkin(n))) assert.equal(n.startsWith(`ow_sand_slope_${L}_`), true, `${at}: ${n} upwind of the crest at ${x},${y}`)
      }
    })
  }
  assert.ok(slopes > 5000, `only ${slopes} slope cells`)
})

test('a crest band runs edge to edge: no sight line slips between two crest cells', () => {
  // the field itself, over a stretch of desert two pieces square on each seed
  for (const seed of SEEDS) {
    const all = new Set(desertPieces(seed).map(p => `${p.wx},${p.wy}`))
    const { wx, wy } = desertPieces(seed).find(p => !inGentleRing(p.wx, p.wy) && [[1, 0], [0, 1], [1, 1]].every(([dx, dy]) => all.has(`${p.wx + dx},${p.wy + dy}`)))
    const W = 2 * PIECE, f = crestField(seed, wx * PIECE, wy * PIECE, W, W)
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < W && f[y * W + x] === 1
    let crests = 0
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue
      crests++
      for (const dx of [1, -1]) if (on(x + dx, y + 1)) assert.ok(on(x + dx, y) || on(x, y + 1), `seed ${seed}: crest cells ${wx * PIECE + x},${wy * PIECE + y} and ${wx * PIECE + x + dx},${wy * PIECE + y + 1} touch only at a corner`)
    }
    assert.ok(crests > 1000, `seed ${seed}: only ${crests} crest cells`)
  }
  // as laid: where two crest cells touch only at a corner, the band was cut
  // there (a way, a site, something standing): a cell between them is crest in
  // the field but not laid, and a sight line through the cut is meant
  for (const seed of SEEDS) for (const { wx, wy } of desertPieces(seed)) {
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
  for (const seed of SEEDS) for (const { wx, wy } of desertPieces(seed)) {
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

test('no dune on a site', () => {
  let looked = 0
  for (const seed of SEEDS) for (const { wx, wy } of desertPieces(seed)) {
    const { piece, dune, at } = built(seed, wx, wy)
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
  assert.ok(looked > 300, `only ${looked} doors and spawns looked at`)
})

test('no dunes near home', () => {
  for (const seed of SEEDS) {
    for (let wy = -1; wy <= 1; wy++) for (let wx = -1; wx <= 1; wx++) {
      const { dune, at } = built(seed, wx, wy)
      each((x, y) => assert.ok(!dune(x, y), `${at}: a crest at ${x},${y}`))
    }
    // nor anywhere in the field there
    const f = crestField(seed, -PIECE, -PIECE, 3 * PIECE, 3 * PIECE)
    assert.ok(!f.includes(1), `seed ${seed}: the field has a crest round home`)
  }
})

test('nor on Kalevanlinna, nor within eight tiles of it', () => {
  // the city's pieces are (0..1, 2..3): tiles (0..159, 160..319)
  for (const seed of [...SEEDS, 8]) {
    const f = crestField(seed, -8, 152, 176, 176)
    assert.ok(!f.includes(1), `seed ${seed}: a crest by the city`)
  }
})

test('crests and their slopes are pure in the world tile', () => {
  let seen = 0, slopes = 0
  for (const seed of SEEDS) {
    const ds = desertPieces(seed).filter(p => !inGentleRing(p.wx, p.wy))
    const keys = new Set(ds.map(p => `${p.wx},${p.wy}`))
    const pairs = ds.filter(p => keys.has(`${p.wx + 1},${p.wy}`) && keys.has(`${p.wx},${p.wy + 1}`)).slice(0, 4)
    assert.ok(pairs.length >= 2, `seed ${seed}: too few desert pieces with desert neighbours`)
    for (const { wx, wy } of pairs) for (const [da, db] of [[0, 3], [3, 0]]) {
      const A = built(seed, wx, wy, da), E = built(seed, wx + 1, wy, db), S = built(seed, wx, wy + 1, db)
      for (let i = 0; i < PIECE; i++) for (let k = 0; k < MARGIN; k++) {
        // the same world tile, as each piece lays it: A's margin is E's (or S's) first cells, and back
        for (const [[P, px, py], [Q, qx, qy]] of [
          [[A, PIECE + k, i], [E, k, i]], [[E, -1 - k, i], [A, PIECE - 1 - k, i]],
          [[A, i, PIECE + k], [S, i, k]], [[S, i, -1 - k], [A, i, PIECE - 1 - k]],
        ]) {
          const p = P.dune(px, py), q = Q.dune(qx, qy)
          assert.equal(p, q, `${A.at}/${Q.at}: a crest in one and not the other at ${qx},${qy} of ${Q.wx},${Q.wy}`)
          const gp = P.ground(px, py), gq = Q.ground(qx, qy)
          if (isWindwardSkin(gp) || isWindwardSkin(gq)) { slopes++; assert.equal(gp, gq, `${A.at}/${Q.at}: two slopes at ${qx},${qy} of ${Q.wx},${Q.wy}`) }
          if (!p) continue
          seen++
          assert.equal(P.ground(px, py), Q.ground(qx, qy), `${A.at}/${Q.at}: two crests at ${qx},${qy} of ${Q.wx},${Q.wy}`)
        }
      }
    }
  }
  assert.ok(seen > 200 && slopes > 300, `only ${seen} margin crest cells and ${slopes} slope cells compared`)
})

test('a crest crossing a piece edge is one band', () => {
  // a crest cell of the field that may not be laid: by a way, under something standing, off the sand
  const cut = (P, x, y) => AROUND.some(([dx, dy]) => P.corridor(x + dx, y + dy)) || !P.t.walkable(x, y) || !!P.t.propAt(x, y)
    || !(isRippleSkin(P.ground(x, y)) || isDuneSkin(P.ground(x, y)))
  let crossings = 0
  for (const seed of SEEDS) {
    const ds = desertPieces(seed).filter(p => !inGentleRing(p.wx, p.wy))
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
  for (const seed of SEEDS) for (const { wx, wy } of desertPieces(seed)) {
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
      if (a.skin !== b.skin) assert.ok((a.losDune || isWindwardSkin(a.skin)) && isRippleSkin(b.skin), `${at}: ${b.skin} became ${a.skin} at ${x},${y}`)
    }
  }
  assert.ok(pieces > 40, `only ${pieces} pieces`)
})

test('a laid band has gaps only at ways, sites and kept ground', () => {
  // nothing grows or lies on a crest of the field (terrain.js occupant), so a
  // crest of the field is laid wherever its ground is the desert's sand, off
  // the ways and what a feature holds
  let gaps = 0, crests = 0
  for (const seed of SEEDS) for (const { wx, wy } of desertPieces(seed)) {
    const { t, dune, onWay, at } = built(seed, wx, wy)
    each((x, y) => {
      if (!t.onCrest(x, y)) return
      crests++
      if (dune(x, y)) return
      gaps++
      const g = t.groundAt(x, y)
      const why = AROUND.some(([dx, dy]) => onWay(x + dx, y + dy)) ? 'way'
        : t.onSite(x, y) || t.keptOpen(x, y) ? 'site'
        : !isRippleSkin(g) && !isWindwardSkin(g) ? 'ground' : null
      assert.ok(why, `${at}: the crest at ${x},${y} is not laid (${g}${t.propAt(x, y) ? ' under ' + t.propAt(x, y) : ''})`)
    })
  }
  assert.ok(crests > 10000 && gaps > 100, `${crests} crest cells of the field, ${gaps} not laid`)
})

test('a recorded place keeps clear of dunes', () => {
  // tales whose places have keep-outs and ways of their own, forced onto
  // deep desert as a recorded place is laid whatever the land (world.places)
  const TALES = ['elk', 'tar', 'lalli', 'fold', 'nakki', 'sampo_sea']
  let near = 0
  for (const seed of SEEDS) {
    const deep = desertPieces(seed).filter(p => !inGentleRing(p.wx, p.wy) && Math.abs(p.wx) + Math.abs(p.wy) > 3).slice(0, 3)
    for (const { wx, wy } of deep) for (const id of TALES) {
      const { t, piece, dune, onWay, at } = built(seed, wx, wy, 0, id)
      const geo = layoutTale(id, mulberry32(hashInt(seed, wx, wy, 500)), side => t.gateInner(side))
      assert.equal(piece.main.kind, `tale_${id}`, at)
      const bad = []
      each((x, y) => {
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
