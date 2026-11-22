// Laying helpers on Kalevanlinna's grid: the 160 x 160 city tiles (and a
// margin of its neighbours' land, for the art passes), with stamps for the
// things a city is built of: a wall run with its towers, a gatehouse, the
// keep, the church, a townhouse or a shop seen from the street or from
// behind, a market stall, the windmill, a lamp, a bench. Pure: every stamp
// is a function of its arguments.
//
// A cell holds ground art, what stands on it (prop), a third layer between
// them (deco: what a sign or a banner hangs over), whether it can be walked,
// and a tag saying who laid it: the terrain (0), the city's roads and fields
// out in the country (ROAD, FARM), or the city itself (CITY). The art passes
// that dress natural land (rims, shores, mountain faces) leave CITY cells
// alone.
import { MapBuilder } from '../../terrain/lib.js'
import { hashInt } from '../rand.js'
import { WALL, TOWER, GATE, HARBOUR, CASTLE, CHURCH, HOUSE_FRONT, PAVE, PROPS } from './kit.js'

export const N = 160, M = 4
export const TAG = { LAND: 0, ROAD: 1, FARM: 2, CITY: 3 }

export function makeGrid() {
  const S = N + 2 * M
  const b = new MapBuilder('kalevanlinna', 'city', 'city', S, S)
  for (const row of b.walkG) row.fill(true)   // (the builder blocks its own border; the city has none)
  const deco = new Array(S * S).fill(null)
  const tag = new Uint8Array(S * S)
  const inG = (x, y) => x >= -M && y >= -M && x < N + M && y < N + M
  const at = (x, y) => (y + M) * S + x + M
  return {
    b, S, deco, tag, in: inG,
    inCity: (x, y) => x >= 0 && y >= 0 && x < N && y < N,
    ground: (x, y) => inG(x, y) ? b.palette[b.ground[y + M][x + M]] : null,
    prop: (x, y) => inG(x, y) ? (b.palette[b.prop[y + M][x + M]] ?? null) : null,
    decoAt: (x, y) => inG(x, y) ? deco[at(x, y)] : null,
    walkable: (x, y) => inG(x, y) && b.walkG[y + M][x + M],
    tagAt: (x, y) => inG(x, y) ? tag[at(x, y)] : TAG.LAND,
    setGround(x, y, n) { if (inG(x, y)) b.ground[y + M][x + M] = b.skin(n) },
    setProp(x, y, n, walk = false) { if (!inG(x, y)) return; b.prop[y + M][x + M] = n ? b.skin(n) : -1; b.walkG[y + M][x + M] = walk },
    setDeco(x, y, n) { if (inG(x, y)) deco[at(x, y)] = n },
    setWalk(x, y, w) { if (inG(x, y)) b.walkG[y + M][x + M] = w },
    setTag(x, y, t) { if (inG(x, y)) tag[at(x, y)] = t },
  }
}

// What a city stamp lays: art on a cell the city owns from then on.
export function lay(G, x, y, prop, { walk = false, ground = null, deco = null } = {}) {
  if (ground) G.setGround(x, y, ground)
  G.setProp(x, y, prop, walk)
  G.setDeco(x, y, deco)
  G.setTag(x, y, TAG.CITY)
}
// Bare city ground: paving and nothing on it.
export function pave(G, x, y, ground) { lay(G, x, y, null, { walk: true, ground }) }

// What was laid besides the cells: doors and where the lit windows, chimneys,
// lamps and the townsfolk's spots are.
export function makeRecord() {
  return { doors: [], signs: [], lamps: [], chimneys: [], windows: [], spots: {}, spawns: [], yards: [] }
}
export const doorLabel = (x, y) => `house:city:${x},${y + 160}`
export function addDoor(rec, x, y, { kind, lot = null, look, closed = null }) {
  const d = { x, y, label: doorLabel(x, y), tier: 'safe', look, lot, kind, closed, city: true }
  rec.doors.push(d)
  return d
}

const h = (x, y, salt) => hashInt(0, x, y, salt)
export const cobble = (x, y) => PAVE.cobble[h(x, y, 1) % PAVE.cobble.length]
export const flag = (x, y) => PAVE.flag[h(x, y, 2) % 2]
export const alley = (x, y) => PAVE.alley[h(x, y, 3) % 2]
export const squareStone = (x, y) => PAVE.square[y % 2][x % 2]

// ---- walls -------------------------------------------------------------------
// The wall walk over `walls` (keys y * N + x), its tile picked by which
// neighbours are wall (a tower's footprint counts), and under every top
// whose south side is open its one-row face. `noFace(x, y)`: cells a face
// must not take (a gate's cells).
export function wallRun(G, walls, towers, noFace = () => false) {
  const k = (x, y) => y * N + x
  const isWall = (x, y) => walls.has(k(x, y)) || towers.has(k(x, y))
  const face = (x, y) => walls.has(k(x, y)) && !towers.has(k(x, y)) && !isWall(x, y + 1) && !noFace(x, y + 1)
  for (const key of walls) {
    if (towers.has(key)) continue
    const x = key % N, y = (key - x) / N
    const m = (isWall(x, y - 1) ? 1 : 0) | (isWall(x + 1, y) ? 2 : 0) | (isWall(x, y + 1) ? 4 : 0) | (isWall(x - 1, y) ? 8 : 0)
    lay(G, x, y, WALL.top[m])
    if (!face(x, y)) continue
    // a face runs on into a tower beside it (the tower's foot carries it on, tower())
    const l = !face(x - 1, y) && !towers.has(k(x - 1, y)), r = !face(x + 1, y) && !towers.has(k(x + 1, y))
    const F = WALL.lower
    lay(G, x, y + 1, l && r ? F.lr : l ? F.l : r ? F.r : h(x, y, 4) % 6 === 0 ? F.m2 : F.m)
  }
}
// Where the wall meets a tower on the wall line y, its rows `top`..`bottom`:
// the sides whose neighbour just beyond it is wall or a gate in it, not
// another tower (east and west on the wall line). `masonry`: keys (y * N + x)
// of walls and gates.
export function towerJoins(masonry, towers, x, y, top = y - 1, bottom = y + 1) {
  const on = (a, b) => masonry.has(b * N + a) && !towers.has(b * N + a)
  return { w: on(x - 2, y), e: on(x + 2, y), n: on(x, top - 1), s: on(x, bottom + 1) }
}
// What lies under a tower's cell: the wall running on behind it where it
// meets one, so the masonry shows round the tower's body, not the ground:
// the walk behind its side on the wall line, the face behind its foot, a
// north-south wall's walk behind the middle of its top row (a wall coming
// in from the north) or of the wall line (one going on south from its foot).
// `i` the column (0..2), `dy` the row from the wall line, `top` the first row.
function behindTower(joins, i, dy, top) {
  if (!joins) return null
  if ((i === 0 && joins.w) || (i === 2 && joins.e)) return dy === 0 ? WALL.top[10] : dy > 0 ? WALL.lower.m : null
  if (i === 1 && ((dy === top && joins.n) || (dy === 0 && joins.s))) return WALL.top[5]
  return null
}
// A tower on the wall line y (plan.js towerRect): its cap's two rows, `body`
// more rows, its foot on the row below the wall line, beside the wall's own
// foot (its face). `joins` (towerJoins): the sides the wall meets it on. A
// wall going on south starts in the middle of its foot: there it lays its
// walk instead of the foot, so it reads as coming out of the tower.
export function tower(G, x, y, kind, body = 0, joins = null) {
  const t = TOWER[kind]
  layTower(G, x, y, [...t.cap, ...Array(body).fill(t.body), t.base], joins)
}
export function harbourTower(G, x, y, joins = null, body = 0) {
  const t = HARBOUR.tower
  layTower(G, x, y, [...t.head, ...Array(body).fill(t.body), t.base], joins)
}
function layTower(G, x, y, rows, joins) {
  const top = y + 2 - rows.length
  rows.forEach((r, j) => r.forEach((n, i) => {
    const row = top + j
    const art = i === 1 && row === y + 1 && joins?.s ? WALL.top[5] : n
    lay(G, x - 1 + i, row, art, { deco: behindTower(joins, i, row - y, top - y) })
  }))
}
// A gate in a wall running east-west, three wide at x-1..x+1: its arch over
// the wall row and the face row below; walked through on the street's cobbles.
export function gateArch(G, x, y) {
  GATE.arch2.forEach((r, j) => r.forEach((n, i) => lay(G, x - 1 + i, y + j, n, { walk: true, ground: cobble(x - 1 + i, y + j) })))
}
// A gate in a wall running north-south, three down at y-1..y+1.
export function gateSide(G, x, y, ground = cobble) {
  GATE.side.forEach((n, j) => lay(G, x, y - 1 + j, n, { walk: true, ground: ground(x, y - 1 + j) }))
}

// ---- buildings -----------------------------------------------------------------
// A house as kit.js lays one: a roof row (chimney), an eave row (a gable over
// the door), then a wall row per storey, the ground floor last. `view`:
//   front  seen from the street to the south: the ground floor with its
//          door is the last row
//   back   seen from behind, its front on a street to the north: the roof's
//          top row runs along that street with the door let into it, the
//          back wall (windows, no door) below
// spec: { x0, x1, top, storeys, view, wall, roof, door: { x, y } | null,
//         chim: column | null, shop: awning | null, sign: name | null,
//         flowers, gable, roofRows (1), info: addDoor's options }
// Returns the door, if it has one.
export function house(G, rec, s) {
  const W = HOUSE_FRONT.walls[s.wall], R = HOUSE_FRONT.roofs[s.roof]
  const w = s.x1 - s.x0 + 1
  const d = s.door && s.info ? addDoor(rec, s.door.x, s.door.y, s.info) : null
  const label = d?.label ?? null
  const end = (i, l, m, r) => i === 0 ? l : i === w - 1 ? r : m
  const back = s.view === 'back'
  const eave = s.top + (s.roofRows ?? 1)
  const ground = eave + s.storeys
  for (let i = 0; i < w; i++) {
    const x = s.x0 + i
    const chim = s.chim === x && !(back && s.door?.x === x)
    for (let y = s.top; y < eave; y++) lay(G, x, y, end(i, R.l, chim && y === s.top ? R.chim : R.m, R.r))
    if (chim && label) rec.chimneys.push({ x, y: s.top, door: label })
    const gable = s.gable !== false && !back && s.door && s.door.x === x && i > 0 && i < w - 1
    lay(G, x, eave, end(i, R.el, gable ? R.gable : R.em, R.er))
    for (let y = eave + 1; y <= ground; y++) {
      const groundFloor = y === ground && !back
      let n
      if (groundFloor && s.shop) {
        const S = HOUSE_FRONT.shop[s.shop]
        n = end(i, S.l, S.win, S.r)
      } else n = end(i, W.l, s.flowers && (i + y) % 2 ? W.win2 : W.win, W.r)
      lay(G, x, y, n)
      if (/win/.test(n) && label) rec.windows.push({ x, y, door: label })
    }
  }
  if (d) {
    const sh = s.shop && !back && s.door.y === ground ? HOUSE_FRONT.shop[s.shop].door : W.door
    lay(G, s.door.x, s.door.y, sh, { walk: true })
    rec.windows = rec.windows.filter(o => o.x !== s.door.x || o.y !== s.door.y)
  }
  // the sign hangs beside the door: on the storey over a shop front, or by a back door on the roof's edge
  if (s.sign && d) {
    const row = back ? s.top : ground - 1
    if (back || s.storeys >= 2) {
      const sx = s.door.x + 1 <= s.x1 - (back ? 1 : 0) ? s.door.x + 1 : s.door.x - 1
      if (sx >= s.x0 && sx <= s.x1 && !(back && s.chim === sx)) {
        G.setDeco(sx, row, G.prop(sx, row))
        G.setProp(sx, row, HOUSE_FRONT.signs[s.sign], false)
      }
    }
  }
  return d
}

// A one-cell market stall: its awning over the counter, the seller behind.
export function stall(G, x, y, colour) {
  const [top, front] = PROPS.stall[colour]
  lay(G, x, y, top); lay(G, x, y + 1, front)
}
export function windmill(G, x, y) {
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++)
    lay(G, x - 1 + i, y - 1 + j, PROPS.windmill.sails[0][j][i], { deco: PROPS.windmill.base[j][i] })
}
export function lamp(G, rec, x, y) { lay(G, x, y, PROPS.lamp); rec.lamps.push({ x, y }) }
export function bench(G, x, y, side = false) { lay(G, x, y, side ? PROPS.benchSide : PROPS.bench) }

// The keep: a slate hall with its great door between two round towers,
// pennants flying, the battlemented block of the old keep behind.
// (x0, yLow): the hall's west end and its ground row; w: the hall's width.
export function keep(G, x0, yLow, w) {
  const R = CASTLE.roof
  const rows = [R.ridge, R.slope, R.slope, R.eave]
  const top = yLow - 1 - rows.length
  rows.forEach((r, j) => { for (let i = 0; i < w; i++) lay(G, x0 + i, top + j, i === 0 ? r[0] : i === w - 1 ? r[2] : r[1]) })
  for (let i = 1; i < w - 1; i += 3) lay(G, x0 + i + 1, top + 1, R.dormer)
  for (const i of [2, w - 3]) lay(G, x0 + i, top, R.chim)
  const mid = x0 + (w >> 1) - 1
  for (let i = 0; i < w; i++) {
    const x = x0 + i, edge = i === 0 ? 'l' : i === w - 1 ? 'r' : null
    const win = !edge && (i % 3 === 1) && x !== mid && x !== mid + 1
    lay(G, x, yLow - 1, edge ? CASTLE.upper[edge] : win ? CASTLE.upper.win : CASTLE.upper.m)
    lay(G, x, yLow, edge ? CASTLE.lower[edge] : win ? CASTLE.lower.win : CASTLE.lower.m)
  }
  // banners over the upper row either side of the door
  for (const [x, f] of [[mid - 2, 0], [mid + 3, 1]]) { G.setDeco(x, yLow - 1, G.prop(x, yLow - 1)); G.setProp(x, yLow - 1, CASTLE.banner[f]) }
  lay(G, mid, yLow, CASTLE.lower.door[0]); lay(G, mid + 1, yLow, CASTLE.lower.door[1])
  // the old keep behind the hall: a battlemented block
  const T = CASTLE.top
  const by0 = top - 5
  for (let y = by0; y < top; y++) for (let i = 1; i < w - 1; i++) {
    const r = y === by0 ? 0 : y === top - 1 ? 2 : 1, c = i === 1 ? 0 : i === w - 2 ? 2 : 1
    lay(G, x0 + i, y, T[r][c])
  }
  // round towers at either end, taller than the hall
  for (const tx of [x0 - 2, x0 + w + 1]) {
    tower(G, tx, yLow - 1, 'round3', 4)
    const capY = yLow - 1 - 1 - 4
    G.setDeco(tx, capY, G.prop(tx, capY)); G.setProp(tx, capY, CASTLE.pennant[tx < x0 ? 0 : 1])
  }
  return { door: { x: mid, y: yLow }, top: by0 }
}

// The church: the nave east-west with its south face on the street, the
// apse at the east end, the bell tower at the west end. (x0, yLow): the
// nave's west end and ground row; n: the nave's length; door: the column
// of the door's west half.
export function church(G, x0, yLow, n, doorX) {
  const C = CHURCH
  const roof = [C.roof.ridge, C.roof.slope, C.roof.slope, C.roof.eave]
  roof.forEach((r, j) => { for (let i = 0; i < n; i++) lay(G, x0 + i, yLow - 5 + j, i === 0 ? r[0] : i === n - 1 ? r[2] : r[1]) })
  const isWin = i => i > 0 && i < n - 1 && i % 3 === 2 && Math.abs(x0 + i - doorX) > 1 && x0 + i !== doorX + 2
  for (let i = 0; i < n; i++) {
    const edge = i === 0 ? 'l' : i === n - 1 ? 'r' : null
    lay(G, x0 + i, yLow - 1, edge ? C.upper[edge] : isWin(i) ? C.upper.win : C.upper.m)
    lay(G, x0 + i, yLow, edge ? C.lower[edge] : isWin(i) ? C.lower.win : C.lower.m)
  }
  lay(G, doorX, yLow - 1, C.upper.doorTop[0]); lay(G, doorX + 1, yLow - 1, C.upper.doorTop[1])
  lay(G, doorX, yLow, C.lower.door[0]); lay(G, doorX + 1, yLow, C.lower.door[1])
  const ap = C.apse
  ;[ap.ridge, ap.slope, ap.eave, ap.upper, ap.lower].forEach((r, j) => r.forEach((nm, i) => lay(G, x0 + n + i, yLow - 4 + j, nm)))
  // the bell tower: spire, belfry, body, rose window, base, its base level with the nave's upper row
  const tx = x0 - 3
  const T = C.tower
  ;[...T.spire, T.belfry, T.body, T.rose, T.base].forEach((r, j) => r.forEach((nm, i) => lay(G, tx + i, yLow - 7 + j, nm)))
  return { door: { x: doorX, y: yLow }, bell: { x: tx + 1, y: yLow } }
}
