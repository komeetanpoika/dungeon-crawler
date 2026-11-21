// Kalevanlinna's fixed skeleton, as data in city tiles (0..159): walls, towers,
// gates, the harbour, streets, the square, the castle, the church and the other
// fixed places, districts, guard posts and patrol routes. Blocks of houses are
// generated later between the streets; this file is pure and never changes with
// the seed. Streets are rasterised by `streetCells()`: an axis-aligned segment
// of width w covers the cells c - floor((w-1)/2) .. c + ceil((w-1)/2) across it
// (w 3 = centred, w 2 = the given cell and the next, w 1 = just the cell).
import { CITY } from './geometry.js'

const S = CITY.size
const deepFreeze = o => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v) }
  return o
}

const wall = [[20, 20], [140, 20], [140, 120], [98, 120], [98, 140], [62, 140], [62, 120], [20, 120]]
// the last edge of the outer face but one, [98,140] -> [62,140], is the harbour mouth: open water
const harbour = {
  basin: { x0: 65, y0: 106, x1: 95, y1: 139 },
  mouth: { x0: 65, x1: 95, y: 140 },
  piers: [{ x: 68, y0: 106, y1: 122 }, { x: 80, y0: 106, y1: 118 }, { x: 92, y0: 106, y1: 126 }],
}
const gates = {
  N: { x: 80, y: 20, w: 3, dir: 'N' },
  W: { x: 20, y: 68, w: 3, dir: 'W' },
  E: { x: 140, y: 75, w: 3, dir: 'E' },
}
// The water gates: one in each harbour wall, from the stone moles the builder
// lays along the outside of the harbour onto the moles inside it (the two
// southern crossings come in that way). Shaped like the west and east land
// gates: three cells down the wall line, `dir` the side the outside lies on;
// their arches count as inside the walls, a square tower stands either side.
const waterGates = [
  { id: 'harbour-W', x: 62, y: 132, w: 3, dir: 'W' },
  { id: 'harbour-E', x: 98, y: 132, w: 3, dir: 'E' },
]
const allGates = [...Object.values(gates), ...waterGates]

// towers: every corner, a flanking pair at each gate (land and water), and about one every 25 tiles between
const makeTowers = () => {
  const out = []; const seen = new Set()
  const add = (x, y, kind) => { const k = x + ',' + y; if (!seen.has(k)) { seen.add(k); out.push({ x, y, kind }) } }
  for (const [x, y] of wall) add(x, y, 'round')
  for (let i = 0; i < wall.length; i++) {
    const [a, b] = [wall[i], wall[(i + 1) % wall.length]]
    if (a[1] === 140 && b[1] === 140) continue // the mouth
    const horiz = a[1] === b[1]
    const lo = horiz ? Math.min(a[0], b[0]) : Math.min(a[1], b[1])
    const hi = horiz ? Math.max(a[0], b[0]) : Math.max(a[1], b[1])
    const fixed = horiz ? a[1] : a[0]
    const gate = allGates.find(g => (horiz ? g.y === fixed : g.x === fixed) && (horiz ? g.x : g.y) > lo && (horiz ? g.x : g.y) < hi)
    const at = t => (horiz ? add(t, fixed, 'square') : add(fixed, t, 'square'))
    const n = Math.round((hi - lo) / 25)
    for (let j = 1; j < n; j++) {
      const t = Math.round(lo + ((hi - lo) * j) / n)
      if (gate && Math.abs(t - (horiz ? gate.x : gate.y)) <= 6) continue
      at(t)
    }
    if (gate) { const c = horiz ? gate.x : gate.y; at(c - 3); at(c + 3) }
  }
  return out
}

const places = {
  square: { x0: 62, y0: 60, x1: 96, y1: 86 }, fountain: { x: 79, y: 73 },
  castle: { x0: 104, y0: 24, x1: 136, y1: 56 }, keep: { x0: 116, y0: 26, x1: 130, y1: 38 }, castleGate: { x: 110, y: 56 },
  church: { x0: 28, y0: 56, x1: 50, y1: 66 }, belltower: { x0: 23, y0: 57, x1: 27, y1: 65 }, churchDoor: { x: 31, y: 66 },
  churchyard: { x0: 26, y0: 70, x1: 50, y1: 82 }, green: { x0: 52, y0: 54, x1: 60, y1: 64 },
  smithy: { x0: 97, y0: 62, x1: 103, y1: 69 },
  inn: { x0: 66, y0: 51, x1: 76, y1: 59, door: { x: 71, y: 59 } },
  fishMarket: { x0: 64, y0: 99, x1: 76, y1: 103 }, warehouses: { x0: 84, y0: 97, x1: 96, y1: 103 },
  barracks: { x0: 86, y0: 23, x1: 96, y1: 31 }, windmill: { x: 128, y: 100 }, crier: { x: 75, y: 68 }, stocks: { x: 88, y: 70 },
}

const streets = [
  { id: 'north', pts: [[80, 20], [80, 59]], w: 3 },
  { id: 'west', pts: [[20, 68], [61, 68]], w: 3 },
  { id: 'east', pts: [[140, 75], [97, 75]], w: 3 },
  { id: 'quay', pts: [[79, 87], [79, 105]], w: 3 },
  { id: 'castle', pts: [[110, 57], [110, 75]], w: 3 },
  { id: 'wharf', pts: [[64, 104], [96, 104]], w: 2 },
  { id: 'mole-west', pts: [[64, 104], [64, 139]], w: 1 },
  { id: 'mole-east', pts: [[96, 104], [96, 139]], w: 1 },
  // along the inside face of the wall, from the harbour's west mole round to its east mole
  { id: 'inner', ring: true, w: 2, pts: [[63, 118], [21, 118], [21, 21], [138, 21], [138, 118], [97, 118]] },
  // through the water gates onto the moles
  { id: 'water-west', pts: [[62, 132], [63, 132]], w: 3 },
  { id: 'water-east', pts: [[97, 132], [98, 132]], w: 3 },
]

const posts = [
  { id: 'gate-N-a', x: 78, y: 22, face: 'N' }, { id: 'gate-N-b', x: 82, y: 22, face: 'N' },
  { id: 'gate-W-a', x: 22, y: 66, face: 'W' }, { id: 'gate-W-b', x: 22, y: 70, face: 'W' },
  { id: 'gate-E-a', x: 138, y: 73, face: 'E' }, { id: 'gate-E-b', x: 138, y: 77, face: 'E' },
  { id: 'harbour-W', x: 64, y: 137, face: 'S' }, { id: 'harbour-E', x: 96, y: 137, face: 'S' },
  { id: 'castle-a', x: 109, y: 57, face: 'S' }, { id: 'castle-b', x: 111, y: 57, face: 'S' },
]

const patrols = [
  { id: 'wall-west', pts: [[22, 118], [22, 22], [78, 22]] },
  { id: 'wall-east', pts: [[138, 118], [138, 22], [82, 22]] },
  { id: 'market', pts: [[80, 24], [80, 58]] },
  { id: 'harbour', pts: [[79, 88], [79, 104], [64, 104], [64, 136]] },
]

// Districts as inclusive [x0, y0, x1, y1] rects tiling every free cell inside the walls (streets and gate arches included, since arches are street cells;
// walls, fixed places, the basin and the harbour mouth left out). Split by market (the middle), gardens (west), crafts (east), harbour (south).
// Cut from the plan by a scan: a change to places or walls means cutting them again; the test checks the cover.
const DISTRICTS = [
  { id: 'gardens', rects: [
    [22, 21, 42, 55],
    [46, 21, 61, 53],
    [21, 22, 21, 43],
    [43, 22, 45, 55],
    [21, 47, 21, 63],
    [46, 54, 51, 55],
    [61, 54, 61, 86],
    [22, 56, 27, 56],
    [51, 56, 51, 86],
    [22, 57, 22, 119],
    [52, 65, 60, 86],
    [23, 66, 27, 69],
    [21, 67, 21, 69],
    [28, 67, 50, 69],
    [23, 70, 25, 119],
    [21, 73, 21, 93],
    [26, 83, 50, 86],
    [26, 87, 47, 118],
    [21, 97, 21, 118],
    [26, 119, 39, 119],
    [43, 119, 47, 119],
  ] },
  { id: 'market', rects: [
    [62, 21, 66, 50],
    [70, 21, 75, 50],
    [79, 21, 81, 59],
    [85, 21, 90, 22],
    [94, 21, 103, 22],
    [67, 22, 69, 50],
    [76, 22, 78, 50],
    [82, 22, 84, 59],
    [91, 22, 93, 22],
    [85, 23, 85, 59],
    [97, 23, 103, 61],
    [86, 32, 96, 59],
    [62, 51, 65, 59],
    [77, 51, 78, 59],
    [97, 70, 103, 86],
  ] },
  { id: 'crafts', rects: [
    [104, 21, 114, 23],
    [118, 21, 138, 23],
    [115, 22, 117, 23],
    [139, 22, 139, 43],
    [137, 24, 138, 119],
    [139, 47, 139, 70],
    [104, 57, 136, 86],
    [139, 74, 139, 76],
    [139, 80, 139, 93],
    [113, 87, 136, 118],
    [139, 97, 139, 118],
    [113, 119, 117, 119],
    [121, 119, 136, 119],
  ] },
  { id: 'harbour', rects: [
    [48, 87, 112, 96],
    [48, 97, 83, 98],
    [97, 97, 112, 118],
    [48, 99, 63, 118],
    [77, 99, 83, 105],
    [64, 104, 76, 105],
    [84, 104, 96, 105],
    [64, 106, 64, 139],
    [96, 106, 96, 139],
    [48, 119, 60, 119],
    [100, 119, 112, 119],
    [63, 122, 63, 127],
    [63, 137, 63, 138],
    [97, 122, 97, 127],
    [97, 137, 97, 138],
  ] },
]

export const PLAN = deepFreeze({ wall, towers: makeTowers(), gates, waterGates, harbour, streets, places, districts: DISTRICTS, posts, patrols })

const key = (x, y) => y * S + x
const TOWER_HALF = 1

let wallSet = null
export function wallCells() {
  if (wallSet) return wallSet
  const set = new Set()
  const arch = new Set()
  for (const g of allGates) for (let d = -1; d <= 1; d++) arch.add(g.dir === 'N' ? key(g.x + d, g.y) : key(g.x, g.y + d))
  const m = harbour.mouth
  for (let i = 0; i < wall.length; i++) {
    const [a, b] = [wall[i], wall[(i + 1) % wall.length]]
    for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) {
      if (arch.has(key(x, y)) || (y === m.y && x >= m.x0 && x <= m.x1)) continue
      set.add(key(x, y))
    }
  }
  for (const t of PLAN.towers) for (let y = t.y - TOWER_HALF; y <= t.y + TOWER_HALF; y++) for (let x = t.x - TOWER_HALF; x <= t.x + TOWER_HALF; x++) set.add(key(x, y))
  wallSet = set
  return set
}

let insideGrid = null
const onBoundary = (x, y) => wall.some((a, i) => {
  const b = wall[(i + 1) % wall.length]
  return x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0]) && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1])
})
const strictlyInside = (x, y) => {
  let hits = 0
  for (let i = 0; i < wall.length; i++) {
    const [a, b] = [wall[i], wall[(i + 1) % wall.length]]
    if (a[0] !== b[0] || a[0] <= x) continue // vertical edges to the right only
    if (y >= Math.min(a[1], b[1]) && y < Math.max(a[1], b[1])) hits++
  }
  return hits % 2 === 1
}
// Inside the outer face of the wall: gate arches and the whole harbour (basin and mouth) count, the wall and its towers do not.
export function insideWalls(cx, cy) {
  if (cx < 0 || cy < 0 || cx >= S || cy >= S) return false
  if (!insideGrid) {
    const wc = wallCells()
    insideGrid = new Uint8Array(S * S)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (wc.has(key(x, y))) continue
      insideGrid[key(x, y)] = onBoundary(x, y) || strictlyInside(x, y) ? 1 : 0
    }
  }
  return insideGrid[key(cx, cy)] === 1
}

// The cells of each street (Map id -> Set of keys), and of all of them.
let streetMap = null
export function streetCellsById() {
  if (streetMap) return streetMap
  const wc = wallCells(); streetMap = new Map()
  for (const st of streets) {
    const set = new Set()
    const lo = Math.floor((st.w - 1) / 2), hi = Math.ceil((st.w - 1) / 2)
    for (let i = 0; i + 1 < st.pts.length; i++) {
      const [a, b] = [st.pts[i], st.pts[i + 1]]
      const horiz = a[1] === b[1]
      for (let y = Math.min(a[1], b[1]) - (horiz ? lo : 0); y <= Math.max(a[1], b[1]) + (horiz ? hi : 0); y++)
        for (let x = Math.min(a[0], b[0]) - (horiz ? 0 : lo); x <= Math.max(a[0], b[0]) + (horiz ? 0 : hi); x++) {
          if (x < 0 || y < 0 || x >= S || y >= S || wc.has(key(x, y))) continue
          set.add(key(x, y))
        }
    }
    streetMap.set(st.id, set)
  }
  return streetMap
}
let streetSet = null
export function streetCells() {
  if (streetSet) return streetSet
  streetSet = new Set()
  for (const set of streetCellsById().values()) for (const k of set) streetSet.add(k)
  return streetSet
}

let districtGrid = null
export function districtAt(cx, cy) {
  if (!districtGrid) {
    districtGrid = new Uint8Array(S * S)
    PLAN.districts.forEach((d, i) => { for (const [x0, y0, x1, y1] of d.rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) districtGrid[key(x, y)] = i + 1 })
  }
  if (cx < 0 || cy < 0 || cx >= S || cy >= S) return null
  const v = districtGrid[key(cx, cy)]
  return v ? PLAN.districts[v - 1].id : null
}
