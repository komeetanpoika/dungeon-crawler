// The tiles one walks under. The view is from above and to the south, so the
// northernmost row of a building or a wall is height, not ground: it hides
// the ground behind it. This pass opens that row and marks it `over`, and
// the screen draws an `over` cell's art after the people (render/tile-layer.js
// drawOver), so whoever stands there is behind it. A gate's arch is `over`
// too. Pure: a function of the cells it is given.
//
//   solid      a cell that blocks and whose art is a building or wall tile, and
//              every cell of a gate (masonry overhead, open or shut)
//   candidate  a solid cell with no solid cell north of it and one south of it
//              (judged on the cells as they came, so one row opens, never two)
//   group      candidates joined edge to edge; it opens only if every walkable
//              cell it touches belongs to one region of the grid, so opening
//              never joins two places that were apart: a wall stays a wall.
//              Regions are counted with every gate shut, or a walled town
//              would be one region with the land outside it
//
// An opened cell is walkable floor with its art left where it was (`deco`,
// `overlay`), so whatever reads tile names sees the same cell.
import { TILE } from '../systems/entities.js'

const STRUCTURE = ['ow_city_', 'ow_roof_', 'ow_house_', 'ow_castle_parapet_']
const NOT_STRUCTURE = ['ow_city_pave_', 'ow_city_stall_']
const GATES = ['ow_city_gate_', 'ow_city_castle_gate']
const starts = (name, list) => list.some(p => name.startsWith(p))

export const isStructure = name => !!name && (name === 'ow_brick' || (starts(name, STRUCTURE) && !starts(name, NOT_STRUCTURE)))
export const isGate = name => !!name && starts(name, GATES)
// A cell opened by this pass: walked under, and not a gate's arch (which was
// always a way). Where people should not stand or be sent, ask this.
export const isTop = cell => !!cell?.over && !isGate(cell.overlay) && !isGate(cell.deco)

// (the tests and the tools compare a world with and without its tops opened)
let enabled = true
export function setOpenTops(on) { enabled = on }

const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]]

export function openTops(cells, { ward = null } = {}) {
  const res = { opened: 0, gates: 0 }
  if (!enabled) return res
  const H = cells.length, W = cells[0]?.length ?? 0
  const at = (x, y) => y * W + x
  const walk = new Uint8Array(W * H), solid = new Uint8Array(W * H), gate = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = cells[y][x]
    if (isGate(c.overlay) || isGate(c.deco)) { c.over = true; res.gates++; solid[at(x, y)] = gate[at(x, y)] = 1; continue }
    if (c.tile === TILE.FLOOR) walk[at(x, y)] = 1
    else if (c.tile === TILE.WALL && (isStructure(c.overlay) || isStructure(c.deco))) solid[at(x, y)] = 1
  }

  // the regions of walkable ground, as they are before anything opens
  const region = new Int32Array(W * H)
  let regions = 0
  const stack = []
  for (let i = 0; i < W * H; i++) {
    if (!walk[i] || region[i]) continue
    region[i] = ++regions
    stack.push(i)
    while (stack.length) {
      const j = stack.pop(), x = j % W, y = (j / W) | 0
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const k = at(nx, ny)
        if (walk[k] && !region[k]) { region[k] = regions; stack.push(k) }
      }
    }
  }

  const cand = new Uint8Array(W * H)
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++)
    if (solid[at(x, y)] && !gate[at(x, y)] && !solid[at(x, y - 1)] && solid[at(x, y + 1)]) cand[at(x, y)] = 1

  // Judge the groups; one that would join regions loses the cells touching
  // any region but its main one (the one most of its north sides are in) and
  // what is left is judged again.
  const group = new Int32Array(W * H)
  for (let again = true; again;) {   // (ends: every further pass has fewer candidates)
    again = false
    group.fill(0)
    let groups = 0
    for (let i = 0; i < W * H; i++) {
      if (!cand[i] || group[i]) continue
      const id = ++groups, members = [i]
      group[i] = id
      const touched = new Map()   // region -> how many north sides of the group are in it
      for (let m = 0; m < members.length; m++) {
        const j = members[m], x = j % W, y = (j / W) | 0
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const k = at(nx, ny)
          if (cand[k]) { if (!group[k]) { group[k] = id; members.push(k) } }
          else if (region[k]) touched.set(region[k], (touched.get(region[k]) ?? 0) + (dy === -1 ? 1 : 0))
        }
      }
      if (touched.size === 1) continue
      if (touched.size === 0) { for (const j of members) cand[j] = 0; continue }
      let main = 0, best = -1
      for (const [r, n] of touched) if (n > best || (n === best && r < main)) { main = r; best = n }
      for (const j of members) {
        const x = j % W, y = (j / W) | 0
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const r = region[at(nx, ny)]
          if (r && r !== main) { cand[j] = 0; again = true; break }
        }
      }
    }
  }

  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
    if (!cand[at(x, y)]) continue
    const c = cells[y][x]
    c.tile = TILE.FLOOR
    c.over = true
    delete c.losClear; delete c.losSoft; delete c.losTall
    if (ward?.(x, y)) c.ward = true
    res.opened++
  }
  return res
}

// Where something that falls at (x, y) should lie so that no top hides it:
// the cell itself unless it is `over`, else the nearest cell on foot from
// there that is walkable and not `over` (north first: that is the way in),
// else the cell itself.
const WAYS = [[0, -1], [-1, 0], [1, 0], [0, 1]]
export function clearOfTops(map, x, y) {
  if (!map[y]?.[x]?.over) return { x, y }
  const seen = new Set([`${x},${y}`]), queue = [{ x, y, d: 0 }]
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i]
    if (q.d >= 8) break
    for (const [dx, dy] of WAYS) {
      const nx = q.x + dx, ny = q.y + dy, k = `${nx},${ny}`, c = map[ny]?.[nx]
      if (seen.has(k) || !c || c.tile !== TILE.FLOOR) continue
      if (!c.over) return { x: nx, y: ny }
      seen.add(k)
      queue.push({ x: nx, y: ny, d: q.d + 1 })
    }
  }
  return { x, y }
}
