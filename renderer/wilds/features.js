// What a Wilds piece holds: one main thing, two to four small things, the
// paths that lead to them, and the packs that roam the land between. Stamped onto a piece's terrain (terrain.js)
// before its art passes run.
//
// Order matters and is always the same: open the main pad, run a path from
// each gate to it, pick the small things' spots clear of those paths, run a
// trail from each to the main thing, then stamp the structures. A structure
// stands on a path only on its own site's ground (the opened pad, a tale's
// circles: terrain.js refuses it anywhere else), where there is room to walk
// round it; last of all the dressing that still blocks a way is taken up.
//
// A piece with a road edge (roads.js roadSides) is laid round its roads. A
// village's and a tale's place's roads run to its hub. Anywhere else the
// roads come first, from each road gate to a junction, and the main thing
// stands beside them, as near the junction as they leave it room; trails one
// wide join the junction to the main thing, to the gates without a road and
// to the small things. A piece with no road edge is laid as it always was.
import { PIECE, FRAME, tierAt, pieceBiome, fixedMain, villageAt, caveDepthFor, pieceKey, BIOME_NAMES } from './layout.js'
import { hash, hashInt, mulberry32 } from './rand.js'
import { makeSites, layoutTale, wayCells, TALE_PAD } from './sites.js'
import { roadSides } from './roads.js'

const PAD = { village: 12, ring: 6, cave: 5, camp: 6, boss: 7, ruin: 8, landmark: 7 }
const SIDES = ['N', 'E', 'S', 'W']
const STEP = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
const TAU = Math.PI * 2
// where a road piece's junction may lie, on both axes
const JUNCTION_LO = FRAME + 8, JUNCTION_HI = PIECE - FRAME - 9
// how far a junction that falls in water or rock may move to find dry land
const JUNCTION_SHIFT = 10
// how far the main thing's builders reach past its pad (a den heaps its rock 8.6 tiles out)
const BUILT_PAST_PAD = 3
// a village's roads come round a ring this far out from the middle of the
// square (a road three wide on it stays outside the village's pad of 12), and
// its streets stop where they meet the square
const RING = 15, STREET_TO = 5
// the sheep fold of a village built for the fold tale (sites.js villageTrouble)
// stands south-east of the square out to the ring: no road goes round there
const FOLD_ARC = [Math.PI / 9, Math.PI * 7 / 18]   // 20° to 70°, y down
// at toughness 1 and 2, no foe of a pack is posted within this many tiles of a road
const ROAD_CALM = 10
const VILLAGERS = ['villager', 'villager', 'villager', 'elder', 'chicken', 'chicken', 'sheep', 'goat']
const ROCKS = {
  forest: ['ow_rock_gray_moss_0', 'ow_rock_gray_moss_1', 'ow_rock_gray_moss_2'],
  desert: ['ow_rock_brown_0', 'ow_rock_brown_1', 'ow_rock_brown_2'],
  mountain: ['ow_mtn_rock_0', 'ow_mtn_rock_1', 'ow_mtn_rock_2', 'ow_mtn_rock_3', 'ow_mtn_rock_4', 'ow_mtn_rock_5'],
  other: ['ow_rock_gray_0', 'ow_rock_gray_1', 'ow_rock_gray_2'],
}
const rocksFor = biome => ROCKS[biome] ?? (biome === 'autumn' || biome === 'marsh' ? ROCKS.forest : ROCKS.other)

// Camp rosters by the lowest toughness they appear at. Each entry is a list
// of spawn makers; a camp draws its three to five foes from one roster.
const wolf = { npc: 'wolf' }, bear = { npc: 'bear' }
const spider = v => ({ kind: 'monster', variant: v })
const CAMPS = [
  { from: 1, name: 'wolves', look: 'den', foes: [wolf, wolf, wolf] },
  { from: 1, name: 'spiders', look: 'nest', foes: [spider('weak'), spider('weak'), spider('medium')] },
  { from: 1, name: 'pete', look: 'bandits', foes: [{ kind: 'pullopete' }, spider('weak'), spider('weak'), spider('medium')], lead: 1 },
  { from: 2, name: 'bandits', look: 'bandits', foes: [{ kind: 'guard' }] },
  { from: 2, name: 'bones', look: 'graves', foes: [{ kind: 'rappeluu' }, { kind: 'rappeluu' }, spider('medium')] },
  { from: 2, name: 'bears', look: 'den', foes: [wolf, wolf, bear], lead: 1 },
  { from: 3, name: 'hounds', look: 'den', foes: [{ kind: 'boarhound' }, { kind: 'boarhound' }, spider('strong')] },
  { from: 3, name: 'podeboo', look: 'graves', foes: [{ kind: 'podeboo' }, { kind: 'rappeluu' }, { kind: 'rappeluu' }], lead: 1 },
  { from: 4, name: 'manticores', look: 'nest', foes: [{ kind: 'manticore' }, { kind: 'boarhound' }, { kind: 'boarhound' }], lead: 1 },
]

// Roaming packs by toughness; row 0 is the ring round home. Every row has an
// all-spider pack, which is what a village piece draws from: nothing that
// hunts on its own initiative within a walk of the villagers.
const bones = { kind: 'rappeluu' }, hound = { kind: 'boarhound' }
// A rare pack is dealt only one time in five that the pick lands on it
// (RARE_ODDS); the other times the pick is made again among the common packs
// of its row. The clown: about one wild piece in eight to twelve has one.
const RARE_ODDS = 0.2
const CLOWN = [{ kind: 'klovni' }]
const RARE = new Set([CLOWN])
const PACKS = [
  [[spider('weak'), spider('weak')], [wolf], [spider('weak'), spider('weak'), spider('weak')]],
  [[spider('weak'), spider('weak')], [wolf, wolf], [spider('weak'), spider('medium')], [spider('weak'), spider('weak'), spider('weak')], CLOWN],
  [[spider('medium'), spider('medium')], [bones, bones], [wolf, wolf, wolf], [bear], [spider('weak'), spider('medium'), spider('medium')], CLOWN],
  [[hound, hound], [spider('strong'), spider('medium')], [bones, bones, bones], [bear, wolf, wolf], CLOWN],
  [[{ kind: 'manticore' }], [hound, hound, hound], [{ kind: 'podeboo' }, bones], [spider('strong'), spider('strong')]],
]
const SUNROOM_ODDS = 0.25   // a village beyond home with Päivölä in it
const VILLAGE_CALM = 24   // tiles round a village centre no pack is dealt into
const nearHome = (wx, wy) => Math.max(Math.abs(wx), Math.abs(wy)) <= 1

const ANIMALS = {
  forest: ['deer', 'deer', 'boar', 'mouse'], autumn: ['deer', 'deer', 'boar', 'mouse'],
  marsh: ['boar', 'mouse', 'mouse'], mountain: ['deer', 'mouse'], sea: ['chicken', 'mouse'],
}

// The squared distance from every cell of a piece to the nearest cell `on`
// marks: Felzenszwalb and Huttenlocher's exact transform, along each row and
// then down each column of the row pass's result.
function squaredDistances(on) {
  const N = PIECE, FAR = 1e9
  const d2 = new Float64Array(N * N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) d2[y * N + x] = on(x, y) ? 0 : FAR
  const f = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1)
  const line = (start, stride) => {
    for (let q = 0; q < N; q++) f[q] = d2[start + q * stride]
    // the lower envelope of the parabolas rooted at each cell
    let k = 0
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity
    for (let q = 1; q < N; q++) {
      let s
      for (;;) {
        const p = v[k]
        s = (f[q] + q * q - f[p] - p * p) / (2 * (q - p))
        if (s > z[k]) break
        k--
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity
    }
    k = 0
    for (let q = 0; q < N; q++) {
      while (z[k + 1] < q) k++
      d2[start + q * stride] = (q - v[k]) * (q - v[k]) + f[v[k]]
    }
  }
  for (let y = 0; y < N; y++) line(y * N, 1)
  for (let x = 0; x < N; x++) line(x, N)
  return d2
}

// The one main thing of a piece: fixed for the home trio and for villages,
// otherwise dealt.
export function mainKind(seed, wx, wy, deal = 0) {
  const fixed = fixedMain(wx, wy)
  if (fixed) return fixed
  if (villageAt(seed, wx, wy)) return 'village'
  // An open-world boss is common far out, rare in the first country and
  // never beside home; what it gives up goes to the camps.
  const boss = tierAt(wx, wy) >= 2 ? 15 : nearHome(wx, wy) ? 0 : 8
  const table = [['cave', 30], ['camp', 45 - boss], ['boss', boss], ['ruin', 12], ['landmark', 13]]
  let r = hash(seed, wx, wy, 400 + deal) * 100
  for (const [kind, weight] of table) { if (r < weight) return kind; r -= weight }
  return 'camp'
}

export function placeFeatures(t, piece) {
  const { seed, wx, wy, deal } = t
  const rng = mulberry32(hashInt(seed, wx, wy, 500 + deal))
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  const pick = a => a[Math.floor(rng() * a.length)]
  const key = pieceKey(wx, wy)
  const tier = piece.tier

  const taken = new Set()
  const hold = (x, y) => taken.add(`${x},${y}`)
  const spawn = s => { piece.spawns.push(s); hold(s.x, s.y); return s }
  let npcIx = 0
  const npc = (species, x, y, extra = {}) => spawn({ kind: 'npc', species, id: `npc:wilds:${key}:${npcIx++}`, x, y, ...extra })
  // A free, untaken cell between rMin and rMax tiles of (cx, cy), or null.
  const freeSpot = (cx, cy, rMin, rMax) => {
    for (let tries = 0; tries < 80; tries++) {
      const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin)
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r)
      if (t.free(x, y) && !taken.has(`${x},${y}`)) return { x, y }
    }
    for (let r = rMin; r <= rMax + 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
      if (t.free(cx + dx, cy + dy) && !taken.has(`${cx + dx},${cy + dy}`)) return { x: cx + dx, y: cy + dy }
    }
    return null
  }
  const place = (maker, cx, cy, rMin, rMax) => {
    const at = freeSpot(cx, cy, rMin, rMax)
    if (!at) return null
    return maker.npc ? npc(maker.npc, at.x, at.y) : spawn({ ...maker, x: at.x, y: at.y })
  }
  // `extra`: what the house looks like outside ({ look: { w, storeys, wall } })
  // and what it is (kind: 'sunroom'), for the interior built behind it
  const door = (x, y, doorTier, story = null, extra = {}) => {
    piece.doors.push({ x, y, label: `house:wilds:${wx * PIECE + x},${wy * PIECE + y}`, tier: doorTier, story, toughness: tier, ...extra })
    hold(x, y)
  }
  const ring = (cx, cy, r, n, skinOf) => {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2
      const x = cx + Math.round(Math.cos(a) * r), y = cy + Math.round(Math.sin(a) * r)
      t.setProp(x, y, skinOf(i))
      hold(x, y)
    }
  }
  const pond = (cx, cy, r) => {
    for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
      const wob = (hash(seed, wx * PIECE + cx + dx, wy * PIECE + cy + dy, 510 + deal) - 0.5) * 1.2
      if (Math.hypot(dx, dy) + wob <= r) { t.setWater(cx + dx, cy + dy); hold(cx + dx, cy + dy) }
    }
  }

  // ---- the roads ----------------------------------------------------------------
  // Which sides carry a road is the edges' and never the deal's.
  const sides = roadSides(seed, wx, wy)
  const roadGates = SIDES.filter(side => sides[side])
  const roadPiece = roadGates.length > 0
  // How near each cell is to a road laid inside the piece: its squared
  // distance to the nearest road cell. Asked only once every road is laid.
  let roadD2 = null
  const roadNear = () => roadD2 ??= squaredDistances((x, y) => t.onRoad(x, y))
  // Where a road piece's roads meet: towards the mean of its road gates'
  // inner points, a few tiles off it by the deal; on the nearest dry land
  // within JUNCTION_SHIFT if that falls in water or rock, so that the trails
  // meet the road on the ground and not on a raft of planks.
  const roadJunction = () => {
    const inner = roadGates.map(side => t.gateInner(side))
    const mean = a => Math.round(inner.reduce((sum, g) => sum + g[a], 0) / inner.length)
    const box = v => Math.max(JUNCTION_LO, Math.min(JUNCTION_HI, v))
    const j = { x: box(mean('x') + ri(-4, 4)), y: box(mean('y') + ri(-4, 4)) }
    if (t.rawKind(j.x, j.y) === 'land') return j
    let best = null
    for (let dy = -JUNCTION_SHIFT; dy <= JUNCTION_SHIFT; dy++) for (let dx = -JUNCTION_SHIFT; dx <= JUNCTION_SHIFT; dx++) {
      const x = j.x + dx, y = j.y + dy, d = dx * dx + dy * dy
      if (d > JUNCTION_SHIFT * JUNCTION_SHIFT || box(x) !== x || box(y) !== y || t.rawKind(x, y) !== 'land') continue
      if (!best || d < best.d) best = { x, y, d }
    }
    return best ? { x: best.x, y: best.y } : j
  }
  // Where the main thing stands beside its roads: as near the junction as they
  // leave room for its pad and what is built round it, never nearer than pad
  // + 4. Where the roads leave no such room it gives up a tile of that room at
  // a time.
  const besideTheRoads = (j, pad) => {
    const near = roadNear()
    for (let room = pad + BUILT_PAST_PAD; room >= 0; room--) {
      const spots = []
      for (let y = 18; y <= PIECE - 19; y++) for (let x = 18; x <= PIECE - 19; x++) {
        const d = Math.hypot(x - j.x, y - j.y)
        if (d >= pad + 4 && near[y * PIECE + x] > room * room) spots.push({ x, y, d })
      }
      if (!spots.length) continue
      const best = Math.min(...spots.map(s => s.d))
      return pick(spots.filter(s => s.d < best + 2))
    }
    return { x: j.x, y: j.y }
  }
  // A village is entered by its roads (sites.js village cobbles what of them
  // lies in the village; the village's layout assumes ROAD_WIDTH 3). Each
  // comes from its gate straight at the middle of the square as far as a ring
  // RING tiles out, outside the village: that leg's wander only takes it
  // further from the village. It follows the ring to the nearest of the four
  // axes the ring has room on, the shorter way round that stays inside the
  // piece, and goes in along that axis as a straight street to the square,
  // where no house of the village stands. A gate that is itself inside the
  // ring (a village near that edge) is joined along the border to its own
  // axis. Points here are the road's middle line; t.road lays its square from
  // the cell one up and one left of a point. Steps of one tile do not wander.
  const midIn = v => Math.max(FRAME + 1, Math.min(PIECE - FRAME - 2, v))
  const fitsIn = p => p.x === midIn(p.x) && p.y === midIn(p.y)
  const straight = (a, b) => {
    const cells = wayCells(a.x, a.y, b.x, b.y)
    for (let i = 1; i < cells.length; i++) t.road(cells[i - 1].x - 1, cells[i - 1].y - 1, cells[i].x - 1, cells[i].y - 1)
  }
  const street = (side, g, cx, cy) => {
    const gm = { x: midIn(g.x + 1), y: midIn(g.y + 1) }
    const on = (axis, d) => ({ x: cx + axis[0] * d, y: cy + axis[1] * d })
    const ring = a => ({ x: Math.round(cx + RING * Math.cos(a)), y: Math.round(cy + RING * Math.sin(a)) })
    const byFold = p => { const a = Math.atan2(p.y - cy, p.x - cx); return piece.villageTale === 'fold' && a > FOLD_ARC[0] && a < FOLD_ARC[1] }
    const fits = p => fitsIn(p) && !byFold(p)
    const rg = Math.hypot(gm.x - cx, gm.y - cy)
    if (rg >= RING - 0.5) {
      const start = rg >= RING + 2 ? ring(Math.atan2(gm.y - cy, gm.x - cx)) : gm
      const from = Math.atan2(start.y - cy, start.x - cx)
      // each axis there is room for, either way round, the shortest first
      const arcs = []
      for (const axis of Object.values(STEP)) {
        if (!fits(on(axis, RING))) continue
        for (const dir of [1, -1]) arcs.push({ axis, dir, span: ((((Math.atan2(axis[1], axis[0]) - from) * dir) % TAU) + TAU) % TAU })
      }
      arcs.sort((p, q) => p.span - q.span)
      for (const { axis, dir, span } of arcs) {
        const n = Math.ceil(span * RING / 3)
        const way = [start, ...Array.from({ length: n }, (_, i) => ring(from + dir * span * (i + 1) / n)), on(axis, RING)]
        if (!way.every(fits)) continue
        if (start !== gm) t.road(g.x, g.y, start.x - 1, start.y - 1)
        for (let i = 1; i < way.length; i++) straight(way[i - 1], way[i])
        straight(on(axis, RING), on(axis, STREET_TO))
        return
      }
    }
    // along the border to the gate's own axis; or, where that would cross the
    // sheep fold, across to the axis on the gate's side of the square
    const own = STEP[side], across = own[0] ? [0, gm.y > cy ? 1 : -1] : [gm.x > cx ? 1 : -1, 0]
    const ls = [[own, own[0] ? { x: gm.x, y: cy } : { x: cx, y: gm.y }], [across, own[0] ? { x: cx, y: gm.y } : { x: gm.x, y: cy }]]
    const penned = p => piece.villageTale === 'fold' && p.x + 1 >= cx + 6 && p.x - 1 <= cx + 12 && p.y + 1 >= cy + 7 && p.y - 1 <= cy + 12
    const clear = ([axis, corner]) => {
      const end = on(axis, STREET_TO)
      return ![...wayCells(gm.x, gm.y, corner.x, corner.y), ...wayCells(corner.x, corner.y, end.x, end.y)].some(penned)
    }
    const [axis, corner] = ls.find(clear) ?? ls[0]
    straight(gm, corner)
    straight(corner, on(axis, STREET_TO))
  }

  // ---- the main thing -------------------------------------------------------
  // A tale's place takes the main thing over: its parts are laid out first so
  // roads, small things and packs keep clear of them.
  // (a tale whose place is not built yet is dealt as ordinary land)
  const geo = piece.tale && TALE_PAD[piece.tale] !== undefined ? layoutTale(piece.tale, rng, side => t.gateInner(side)) : null
  const kind = geo ? `tale_${piece.tale}` : mainKind(seed, wx, wy, deal)
  const home = wx === 0 && wy === 0
  const pad = geo ? TALE_PAD[piece.tale] : PAD[kind]
  // the roads of a road piece that is neither a village nor a tale's place come first
  const besideRoads = roadPiece && !geo && kind !== 'village'
  let junction = null
  if (besideRoads) {
    junction = roadJunction()
    for (const side of roadGates) { const g = t.gateInner(side); t.road(g.x, g.y, junction.x, junction.y) }
  }
  const spot = besideRoads ? besideTheRoads(junction, pad) : null
  const mx = geo ? geo.cx : home ? 40 : spot ? spot.x : ri(18, PIECE - 19), my = geo ? geo.cy : home ? 40 : spot ? spot.y : ri(18, PIECE - 19)
  const hub = geo ? geo.hub : { x: mx, y: my }
  // a village's and a tale's place's roads meet at its hub
  if (roadPiece && !junction) junction = { x: hub.x, y: hub.y }
  piece.road = roadPiece ? { sides, junction } : null
  const keepOut = geo ? geo.keep : []
  const kept = (x, y, margin) => keepOut.some(k => Math.hypot(x - k.x, y - k.y) < k.r + margin) ||
    (geo?.ways ?? []).some(c => Math.abs(c.x - x) <= margin + 1 && Math.abs(c.y - y) <= margin + 1)
  piece.main = { kind, x: mx, y: my }
  t.open(mx, my, pad)
  // a tale's place is more than its pad: what it builds in its circles may stand on a path
  for (const k of keepOut) for (let dy = -k.r; dy <= k.r; dy++) for (let dx = -k.r; dx <= k.r; dx++)
    if (dx * dx + dy * dy <= k.r * k.r) t.claim(k.x + dx, k.y + dy)
  // The ways in. With no road edge, a path two wide from each gate to the hub.
  // Beside the roads, a trail from the junction to the hub and one from each
  // gate without a road to the junction. A tale's place: a road from each road
  // gate to its hub, a path from the others. A village: a street from each
  // road gate, then a trail from the others (laid after the streets, a trail
  // that meets one corner to corner adds trail and not street).
  if (besideRoads) t.path(junction.x, junction.y, hub.x, hub.y, 1)
  for (const side of SIDES) {
    const g = t.gateInner(side)
    if (!roadPiece) t.path(g.x, g.y, hub.x, hub.y, 2)
    else if (besideRoads) { if (!sides[side]) t.path(g.x, g.y, junction.x, junction.y, 1) }
    else if (geo) { if (sides[side]) t.road(g.x, g.y, hub.x, hub.y); else t.path(g.x, g.y, hub.x, hub.y, 2) }
    else if (sides[side]) street(side, g, mx, my)
  }
  if (roadPiece && !besideRoads && !geo) for (const side of SIDES) if (!sides[side]) { const g = t.gateInner(side); t.path(g.x, g.y, hub.x, hub.y, 1) }
  // where the small things' trails lead
  const meet = junction ?? hub

  // ---- small things: spots first, then trails -------------------------------
  const here = t.biome(mx, my)
  const roster = PACKS[nearHome(wx, wy) ? 0 : tier].filter(p => kind !== 'village' || p.every(f => f.kind === 'monster'))
  const common = roster.filter(p => !RARE.has(p))
  const pickPack = () => { const p = pick(roster); return !RARE.has(p) || rng() < RARE_ODDS ? p : pick(common) }
  const smallKinds = ['chest', 'chest', 'rocks', 'hut']
  if (ANIMALS[piece.biome]) smallKinds.push('animals', 'animals')
  if (['forest', 'autumn', 'marsh'].includes(piece.biome)) smallKinds.push('mushrooms')
  // guarded things: a nest round a chest, old stones with something in them
  if (kind !== 'village') smallKinds.push('nest', 'nest', 'stones')
  const padOf = k => k === 'hut' ? 5 : k === 'stones' ? 3 : 2
  const mainPad = pad
  // A village's small things are dealt as if its ways in were still the
  // paths it had before roads (two wide, from each gate to the hub): the
  // draws they take come before the village's houses, which so stay the
  // houses they were, door for door. One that then lies across a road is
  // left out.
  const villageRoads = roadPiece && kind === 'village'
  const onWay = villageRoads
    ? t.tracePaths(SIDES.map(side => { const g = t.gateInner(side); return [g.x, g.y, hub.x, hub.y, 2] }))
    : (x, y) => t.onPath(x, y)
  const want = 2 + Math.floor(rng() * 3)
  const lo = FRAME + 5, hi = PIECE - FRAME - 6
  for (let i = 0; i < want; i++) {
    const k = pick(smallKinds)
    const pad = padOf(k)
    for (let tries = 0; tries < 60; tries++) {
      const x = ri(lo, hi), y = ri(lo, hi)
      // (a tale's pad may be a lake: nothing small is dealt into it)
      if (Math.hypot(x - mx, y - my) < pad + 8 || (geo && Math.hypot(x - mx, y - my) < mainPad + pad + 1) || kept(x, y, 6)) continue
      if (piece.small.some(s => Math.hypot(x - s.x, y - s.y) < 10)) continue
      let crossed = false
      for (let dy = -pad - 1; dy <= pad + 1 && !crossed; dy++) for (let dx = -pad - 1; dx <= pad + 1; dx++) if (onWay(x + dx, y + dy)) { crossed = true; break }
      if (crossed) continue
      piece.small.push({ kind: k, x, y })
      break
    }
  }
  if (villageRoads) piece.small = piece.small.filter(s => {
    const r = padOf(s.kind) + 1
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (t.onPath(s.x + dx, s.y + dy)) return false
    return true
  })
  for (const s of piece.small) t.open(s.x, s.y, padOf(s.kind))
  for (const s of piece.small) t.path(s.x, s.y, meet.x, meet.y, 1)

  // ---- stamp the main thing ---------------------------------------------------
  const sandy = here === 'desert' || here === 'sea'
  const sites = makeSites({
    t, rng, pick, ri, hold, spawn, place, freeSpot, door, npc,
    hash: (x, y, salt) => hash(seed, wx * PIECE + x, wy * PIECE + y, salt + deal),
    taken: (x, y) => taken.has(`${x},${y}`), rocks: rocksFor(here), sandy,
  })
  let spawnPoint = null
  if (geo) {
    piece.points = sites.tales[piece.tale](geo)
    spawnPoint = hub
    hold(hub.x, hub.y)
  } else if (kind === 'village') {
    const v = villageAt(seed, wx, wy) ?? { name: 'Koivula' }
    spawnPoint = { x: mx + 1, y: my + 1 }
    hold(spawnPoint.x, spawnPoint.y)
    // the glassmaker's house: always in the home village, in about one other in four
    // (a hash, not the piece's rng, so nothing else of the piece moves)
    sites.village(mx, my, piece.villageTale, key === '0,0' || hash(seed, wx, wy, 777) < SUNROOM_ODDS)
    // what the village's own tale leaves standing in it
    if (piece.villageTale) piece.villagePoints = sites.villageTrouble(piece.villageTale, mx, my)
    const toward = (dx, dy) => BIOME_NAMES[pieceBiome(seed, wx + dx * 3, wy + dy * 3)]
    piece.signs.push({
      x: mx - 2, y: my + 1, title: v.name,
      lines: [`North: ${toward(0, -1)}.`, `East: ${toward(1, 0)}.`, v.name === 'Koivula' ? 'South: Kalevanlinna, by the sea.' : `South: ${toward(0, 1)}.`, `West: ${toward(-1, 0)}.`],
    })
    piece.village = { name: v.name, x: mx, y: my }
    if (home) spawn({ kind: 'weapon', weaponType: 'hatchet', x: mx + 2, y: my + 1 })
    for (const species of VILLAGERS) place({ npc: species }, mx, my, 2, 6)
  } else if (kind === 'ring') {
    ring(mx, my, 4, 8, () => 'ow_mushroom')
    spawn({ kind: 'talent_trigger', x: mx, y: my, outfit: 'robe', rite: 'mushroom_circle' })
    for (let i = 0; i < 3; i++) place({ kind: 'wild_mushroom' }, mx, my, 1, 3)
    sites.flowers(mx, my, 5, 7, 7)
    spawnPoint = { x: mx, y: my + 2 }
  } else if (kind === 'cave') {
    sites.cave(mx, my)
    const caveDepth = caveDepthFor(seed, wx, wy)
    piece.caves.push({ x: mx, y: my, caveDepth, label: `cave:${key}` }, { x: mx + 1, y: my, caveDepth, label: `cave:${key}` })
    hold(mx, my); hold(mx + 1, my)
    spawnPoint = { x: mx, y: my + 2 }
  } else if (kind === 'camp') {
    const camp = pick(CAMPS.filter(c => c.from <= tier && c.from >= tier - 2))
    sites.camp(mx, my, camp.look)
    const n = tier >= 4 ? 5 : ri(3, 5)
    const lead = camp.lead ?? 0
    for (let i = 0; i < lead; i++) place(camp.foes[i], mx, my, 1, 4)
    for (let i = lead; i < n; i++) place(camp.foes[lead + ((i - lead) % (camp.foes.length - lead))], mx, my, 2, 5)
    place({ kind: 'chest' }, mx, my, 1, 2)
  } else if (kind === 'boss') {
    sites.lair(mx, my)
    if (tier >= 4 && rng() < 0.5) for (let i = 0; i < 3; i++) place({ kind: 'manticore' }, mx, my, 1, 3)
    else for (let i = 0; i < (tier >= 4 ? 2 : 1); i++) place({ kind: 'ogre' }, mx, my, 1, 2)
    place({ kind: 'chest' }, mx, my, 3, 5)
    for (let i = 0; i < 5; i++) { const at = freeSpot(mx, my, 5, 7); if (at && !t.onPath(at.x, at.y)) { t.setProp(at.x, at.y, pick(rocksFor(here))); hold(at.x, at.y) } }
  } else if (kind === 'ruin') {
    sites.ruin(mx, my)
    place({ kind: 'chest' }, mx, my + 3, 0, 2)
    spawnPoint = { x: mx, y: my + 2 }
  } else {
    // landmark: what the country offers
    if (here === 'desert') {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 16) t.setGround(mx + dx, my + dy, t.grassSkin(mx + dx, my + dy))
      pond(mx, my, 1)
      ring(mx, my, 3, 5, i => i % 2 ? 'ow_tree_small' : 'ow_tree_apple')
      place({ kind: 'chest' }, mx, my, 2, 3)
    } else if (here === 'mountain') {
      ring(mx, my, 4, 8, i => ROCKS.mountain[i % ROCKS.mountain.length])
      place({ kind: 'chest' }, mx, my, 0, 1)
    } else if (here === 'sea') {
      t.setProp(mx, my, 'ow_boat'); hold(mx, my)
      place({ kind: 'chest' }, mx, my, 1, 2)
      for (let i = 0; i < 2; i++) place({ npc: 'chicken' }, mx, my, 2, 5)
    } else if (rng() < 0.35) {
      // an old statue someone still tends
      sites.statue(mx, my)
      place({ kind: 'chest' }, mx, my, 1, 2)
    } else {
      pond(mx, my, 3)
      sites.lilies(mx, my, 3, 3)
      sites.flowers(mx, my, 4, 7, 6)
      for (let i = 0; i < 2; i++) { const at = freeSpot(mx, my, 4, 6); if (at) { t.setProp(at.x, at.y, 'ow_bush_berry'); hold(at.x, at.y) } }
      for (let i = 0; i < 3; i++) place({ npc: here === 'marsh' ? 'boar' : 'deer' }, mx, my, 4, 6)
    }
  }
  piece.spawnPoint = spawnPoint ?? freeSpot(mx, my, Math.max(1, pad - 3), pad - 1) ?? { x: mx, y: my }

  // ---- stamp the small things -------------------------------------------------
  for (const s of piece.small) {
    if (s.kind === 'chest') place({ kind: 'chest' }, s.x, s.y, 0, 1)
    else if (s.kind === 'animals') {
      const list = ANIMALS[piece.biome]
      if (kind !== 'village' && rng() < 0.2) for (let i = 0; i < 2; i++) place({ npc: 'wolf' }, s.x, s.y, 0, 2)
      else for (let i = ri(2, 3); i > 0; i--) place({ npc: pick(list) }, s.x, s.y, 0, 2)
    } else if (s.kind === 'mushrooms') {
      t.setProp(s.x, s.y, 'ow_mushroom'); hold(s.x, s.y)
      for (let i = ri(2, 4); i > 0; i--) place({ kind: 'wild_mushroom' }, s.x, s.y, 1, 2)
    } else if (s.kind === 'hut') {
      sites.hut(s.x, s.y)
    } else if (s.kind === 'nest') {
      spawn({ kind: 'chest', x: s.x, y: s.y })
      sites.nest(s.x, s.y)
      for (const foe of pickPack().slice(0, 2)) place(foe, s.x, s.y, 1, 2)
    } else if (s.kind === 'stones') {
      spawn({ kind: 'chest', x: s.x, y: s.y })
      sites.stones(s.x, s.y)
      const guards = tier >= 2 ? [bones, bones] : pickPack().slice(0, 2)
      for (const foe of guards) place(foe, s.x, s.y, 1, 3)
    } else {
      // a knot of rocks to mine, around the end of the trail
      const set = rocksFor(t.biome(s.x, s.y))
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = s.x + dx, y = s.y + dy
        if ((dx === 0 && dy === 0) || dx * dx + dy * dy > 5 || t.onPath(x, y) || !t.free(x, y) || rng() > 0.6) continue
        t.setProp(x, y, pick(set)); hold(x, y)
      }
    }
  }
  // ---- keep the paths whole ----------------------------------------------------
  // From where the paths meet, every gate and every small thing must still be
  // reached over path and the sites' own ground alone. What a site is (a
  // house, a pond, a heap of rock) leaves such ground to walk round it; its
  // dressing, where it turns out to stand in the one way left, is taken up.
  const ground = (x, y) => t.inside(x, y) && (t.onPath(x, y) || t.onSite(x, y))
  const loose = new Set(sites.dressing.map(d => d.y * PIECE + d.x))
  const clearWay = goal => {
    const prev = new Int32Array(PIECE * PIECE).fill(-2)
    // fewest pieces of dressing first: `now` is walked at no cost, `later` costs one more
    let now = [piece.spawnPoint.y * PIECE + piece.spawnPoint.x], later = []
    prev[now[0]] = -1
    while (now.length) {
      for (let q = 0; q < now.length; q++) {
        const i = now[q], x = i % PIECE, y = (i / PIECE) | 0
        if (goal(x, y)) {
          for (let k = i; k >= 0; k = prev[k]) if (loose.has(k) && !t.walkable(k % PIECE, (k / PIECE) | 0)) t.clear(k % PIECE, (k / PIECE) | 0)
          return
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = (y + dy) * PIECE + x + dx
          if (!ground(x + dx, y + dy) || prev[n] !== -2) continue
          if (t.walkable(x + dx, y + dy)) { prev[n] = i; now.push(n) } else if (loose.has(n)) { prev[n] = i; later.push(n) }
        }
      }
      now = later; later = []
    }
  }
  for (const side of ['N', 'E', 'S', 'W']) { const g = t.gateInner(side); clearWay((x, y) => x === g.x && y === g.y) }
  for (const s of piece.small) clearWay((x, y) => Math.hypot(x - s.x, y - s.y) <= padOf(s.kind))
  // nor does it stand in the corner between two cells of a bridge, which would then only touch
  const deck = (x, y) => t.walkable(x, y) && (t.propAt(x, y) ?? '').startsWith('ow_pier')
  for (const d of sites.dressing) {
    if (t.walkable(d.x, d.y)) continue
    if ([[1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => deck(d.x + dx, d.y) && deck(d.x, d.y + dy) && !t.walkable(d.x + dx, d.y + dy))) t.clear(d.x, d.y)
  }

  // ---- the packs that roam between ---------------------------------------------
  // Two or three in wild land (one more far out), one or two round a village
  // and those well away from it. Half the wild pieces post one on a road.
  // At toughness 1 and 2 a road is safe to walk: no foe of a pack is posted
  // on one or within ROAD_CALM tiles of it.
  const village = kind === 'village'
  const calm = roadPiece && tier <= 2
  const offRoad = (x, y, r) => !calm || roadNear()[y * PIECE + x] > r * r
  const keep = village ? VILLAGE_CALM : pad + 8
  const rim = FRAME + 4
  const roomy = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!t.free(x + dx, y + dy)) return false; return true }
  const clear = (x, y) => x >= rim && y >= rim && x < PIECE - rim && y < PIECE - rim &&
    Math.hypot(x - mx, y - my) >= keep && !kept(x, y, 6) && offRoad(x, y, ROAD_CALM + 2) &&
    piece.small.every(s => Math.hypot(x - s.x, y - s.y) >= 8) &&
    piece.packs.every(p => Math.hypot(x - p.x, y - p.y) >= 14)
  const pack = (x, y, road) => {
    let made = pickPack().map(foe => place(foe, x, y, 0, 2)).filter(Boolean)
    // the road's calm is measured to each foe, not to the middle of its pack
    const strays = made.filter(s => !offRoad(s.x, s.y, ROAD_CALM))
    if (strays.length) {
      piece.spawns = piece.spawns.filter(s => !strays.includes(s))
      made = made.filter(s => !strays.includes(s))
    }
    // a village's calm is measured to each foe, not to the middle of its pack
    if (made.length) piece.packs.push({ x, y, road })
  }
  // (on a calm road piece the draw is still made, and nothing posted on its road)
  if (!village && rng() < 0.5 && !calm) {
    const road = []
    for (let y = rim; y < PIECE - rim; y++) for (let x = rim; x < PIECE - rim; x++) if (t.onPath(x, y) && t.free(x, y) && clear(x, y)) road.push({ x, y })
    if (road.length) { const at = pick(road); pack(at.x, at.y, true) }
  }
  const wantPacks = village ? ri(1, 2) : ri(2, 3) + (tier >= 3 ? 1 : 0)
  for (let tries = 0; tries < 400 && piece.packs.length < wantPacks; tries++) {
    const x = ri(rim, PIECE - rim - 1), y = ri(rim, PIECE - rim - 1)
    if (clear(x, y) && roomy(x, y)) pack(x, y, false)
  }

  // A piece that could fit no small thing still gets its chest, by the main pad.
  if (!piece.small.length) {
    const at = freeSpot(mx, my, pad - 1, pad + 2) ?? piece.spawnPoint
    piece.small.push({ kind: 'chest', x: at.x, y: at.y })
    if (!taken.has(`${at.x},${at.y}`)) spawn({ kind: 'chest', x: at.x, y: at.y })
  }
}
