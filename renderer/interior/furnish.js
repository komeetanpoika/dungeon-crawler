// Rooms with a purpose: each room of a plan gets a role (the hall by the
// door, then bedroom, kitchen, larder, a trade's workshop...), and each role
// is furnished from its recipe (interior/recipes.js): things on the north
// wall's face, a group in the middle (a table with chairs on a rug), things
// along the walls. Pure in its rng.
//
// A blocking thing makes its cell solid (`tile = WALL`, `losClear`: you see
// over a table). After each one the floor is flooded from the spawn and the
// thing is taken away again if any walkable cell was cut off, so furniture
// never blocks the way. The spawn, the way out, every doorway cell and the
// cells beside a doorway stay bare.
import { TILE } from '../systems/entities.js'
import { ITEMS, RUGS, FLOORS } from './kit.js'
import { HOME, HIDEOUT, RUIN, TRADES, GROUPS, FILL, FILL_CELLS } from './recipes.js'
import { int, pick, shuffle } from './rng.js'

const BOOK = { hideout: HIDEOUT, ruin: RUIN }
export const recipeOf = (version, role) => (BOOK[version] ?? HOME)[role] ?? HOME[role] ?? HOME.hall
const area = r => (r.x1 - r.x0 + 1) * (r.y1 - r.floorY0 + 1)
const count = (rng, n) => Array.isArray(n) ? int(rng, n[0], n[1]) : n ?? 1

// roomId -> role. `story` ({ role }) puts that role on the biggest room past
// the hall; a house of one room is a cottage whatever it is for. A trade with
// a `hallRole` (the inn's taproom) names the room by the door and its `rooms`
// the rest, biggest first.
export function assignRoles(plan, { version = 'home', trade = null, story = null, rng }) {
  const roles = new Map()
  const others = plan.rooms.filter(r => r.id !== plan.entry).sort((a, b) => area(b) - area(a) || a.id - b.id)
  if (version === 'hideout') {
    roles.set(plan.entry, 'den')
    others.forEach((r, i) => roles.set(r.id, i % 2 === 0 ? 'stash' : 'den'))
    return roles
  }
  if (version === 'ruin') {
    roles.set(plan.entry, 'ruin_hall')
    for (const r of others) roles.set(r.id, 'ruin_room')
    return roles
  }
  if (!others.length) { roles.set(plan.entry, 'cottage'); return roles }
  const T = TRADES[trade]
  roles.set(plan.entry, version === 'sunroom' ? 'sunhall' : T?.hallRole ?? 'hall')
  if (version === 'sunroom') {   // the glassmaker reads, sleeps and cooks
    others.forEach((r, i) => roles.set(r.id, ['study', 'bedroom', 'kitchen', 'larder'][i] ?? 'larder'))
    return roles
  }
  if (T?.rooms) { others.forEach((r, i) => roles.set(r.id, T.rooms[i] ?? 'larder')); return roles }
  const work = T?.workshopRole ?? (T ? 'workshop' : null)
  let want = ['bedroom', 'kitchen', 'larder', 'bedroom', 'study', 'larder']
  if (work && others.length >= 3) want.splice(2, 0, work)
  else if (work && others.length === 2 && rng() < 0.4) want = ['bedroom', work, 'kitchen', 'larder']
  if (story?.role) {
    want = want.filter((r, i) => r !== story.role || want.indexOf(story.role) !== i)
    want.unshift(story.role)
  }
  others.forEach((r, i) => roles.set(r.id, want[i] ?? 'larder'))
  return roles
}

// roomId -> floor tile name, from the role's recipe.
export function floorsFor(plan, roles, rng, version = 'home') {
  const out = new Map()
  for (const r of plan.rooms) out.set(r.id, FLOORS[pick(rng, recipeOf(version, roles.get(r.id)).floor)][0])
  return out
}

// Cells nothing may stand on: the spawn, the way out, every doorway cell and
// the cells beside them.
export function bareOf(plan) {
  const bare = new Set()
  for (const c of [plan.spawn, plan.exit, ...plan.doors.flatMap(d => d.cells)]) {
    bare.add(`${c.x},${c.y}`)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) bare.add(`${c.x + dx},${c.y + dy}`)
  }
  return bare
}

function makeFurnisher(map, plan, rng, reserve) {
  const H = map.length, W = map[0].length
  const key = (x, y) => `${x},${y}`
  const bare = new Set([...reserve, ...bareOf(plan)])
  const walk = c => c.tile !== TILE.WALL
  // cells the spawn reaches on foot
  const reachCount = () => {
    const seen = new Uint8Array(W * H), q = [plan.spawn.y * W + plan.spawn.x]
    seen[q[0]] = 1
    let n = 0
    while (q.length) {
      const i = q.pop(); n++
      const x = i % W, y = (i / W) | 0
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (!seen[j] && walk(map[ny][nx])) { seen[j] = 1; q.push(j) }
      }
    }
    return n
  }
  // what the spawn reaches before any furniture (counted by flood, so a thing
  // laid before furnish cannot skew it); no placement may shrink it
  let walkable = reachCount()
  const connected = () => reachCount() === walkable
  const placed = []
  const floorFree = (room, x, y) => x >= room.x0 && x <= room.x1 && y >= room.floorY0 && y <= room.y1 &&
    plan.grid[y][x] === '.' && map[y][x].tile === TILE.FLOOR_WOOD && !map[y][x].overlay && !bare.has(key(x, y))

  // A floor item with its top-left at (x, y); undone if it cuts the floor.
  function putFloor(room, id, x, y) {
    const item = ITEMS[id]
    const cells = []
    for (let dy = 0; dy < item.tiles.length; dy++) for (let dx = 0; dx < item.tiles[0].length; dx++) {
      if (!floorFree(room, x + dx, y + dy)) return false
      cells.push({ x: x + dx, y: y + dy, name: item.tiles[dy][dx] })
    }
    const block = item.block !== false
    for (const c of cells) {
      const m = map[c.y][c.x]
      m.overlay = c.name
      if (block) { m.tile = TILE.WALL; m.losClear = true; walkable-- }
    }
    if (block && !connected()) {
      for (const c of cells) { const m = map[c.y][c.x]; delete m.overlay; m.tile = TILE.FLOOR_WOOD; delete m.losClear; walkable++ }
      return false
    }
    placed.push({ id, x, y, room: room.id })
    return true
  }

  // A face item at column x of the room's face run.
  function putFace(room, id, x) {
    const item = ITEMS[id], w = item.tiles[0].length
    const rows = item.on === 'face' ? [0, 1] : item.on === 'faceUpper' ? [0] : [1]
    for (let dx = 0; dx < w; dx++) for (const r of rows) {
      const fx = x + dx, fy = room.y0 + r
      if (plan.grid[fy]?.[fx] !== (r === 0 ? 'u' : 'l') || map[fy][fx].overlay || bare.has(key(fx, fy))) return false
    }
    for (let dx = 0; dx < w; dx++) rows.forEach((r, i) => { map[room.y0 + r][x + dx].overlay = item.tiles[i][dx] })
    placed.push({ id, x, y: room.y0 + rows[0], room: room.id })
    return true
  }

  function faceEntry(room, e) {
    const run = []
    for (let x = room.x0; x <= room.x1; x++) if (plan.grid[room.y0][x] === 'u') run.push(x)
    const n = count(rng, e.n)
    for (let i = 0; i < n; i++) {
      let order
      if (e.at === 'mid') { const mid = (room.x0 + room.x1) / 2 + (rng() - 0.5) * 2; order = [...run].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid)) }
      else if (e.at === 'spread') { const t = run[Math.floor(((i + 0.25 + rng() * 0.5) / n) * run.length)] ?? run[0]; order = [...run].sort((a, b) => Math.abs(a - t) - Math.abs(b - t)) }
      else order = shuffle(rng, run)
      const id = pick(rng, e.items)
      for (const x of order) if (putFace(room, id, x)) break
    }
  }

  function spots(room, at, w, h) {
    const out = []
    const xs = [], ys = []
    for (let x = room.x0; x <= room.x1 - w + 1; x++) xs.push(x)
    for (let y = room.floorY0; y <= room.y1 - h + 1; y++) ys.push(y)
    const north = xs.map(x => [x, room.floorY0]), south = xs.map(x => [x, room.y1 - h + 1])
    const side = ys.flatMap(y => [[room.x0, y], [room.x1 - w + 1, y]])
    const corner = [[room.x0, room.floorY0], [room.x1 - w + 1, room.floorY0], [room.x0, room.y1 - h + 1], [room.x1 - w + 1, room.y1 - h + 1]]
    if (at === 'north') out.push(...north)
    else if (at === 'side') out.push(...side)
    else if (at === 'south') out.push(...south)
    else if (at === 'corner') out.push(...corner)
    else if (at === 'edge') out.push(...north, ...side, ...south)
    else for (const y of ys) for (const x of xs) out.push([x, y])
    return shuffle(rng, out)
  }

  function wallEntry(room, e) {
    const n = count(rng, e.n)
    for (let i = 0; i < n; i++) {
      const id = pick(rng, e.items), item = ITEMS[id]
      for (const [x, y] of spots(room, e.at ?? 'edge', item.tiles[0].length, item.tiles.length)) if (putFloor(room, id, x, y)) break
    }
  }

  function rug(room, x0, y0, x1, y1, colour) {
    x0 = Math.max(x0, room.x0); x1 = Math.min(x1, room.x1); y0 = Math.max(y0, room.floorY0); y1 = Math.min(y1, room.y1)
    if (x1 - x0 < 1 || y1 - y0 < 1) return
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (plan.grid[y][x] !== '.') continue
      const v = y === y0 ? 0 : y === y1 ? 2 : 1, hh = x === x0 ? 0 : x === x1 ? 2 : 1
      map[y][x].deco = RUGS[colour][v][hh]
    }
  }

  // A taproom's tables: spread about the floor, each with a bench along both
  // long sides. A table keeps a row clear of the face and of the south wall
  // and a cell off the side walls, three cells from the spawn, and a cell
  // clear of the next table's benches; each next table is the free place
  // farthest from those laid (a little jitter), so they spread out.
  function tables(room, G) {
    const id = pick(rng, G.table), item = ITEMS[id], tw = item.tiles[0].length, th = item.tiles.length
    const want = Math.max(G.tables[0], Math.min(G.tables[1], Math.floor(area(room) / G.per)))
    const cand = []
    for (let y = room.floorY0 + 2; y + th + 1 <= room.y1 - 1; y++) for (let x = room.x0 + 1; x + tw <= room.x1; x++) {
      if (Math.max(Math.abs(x + (tw - 1) / 2 - plan.spawn.x), Math.abs(y + th - plan.spawn.y)) < 3.5) continue
      cand.push({ x, y, j: rng() })
    }
    const laid = []
    // the footprints (table and benches) of two tables keep a cell between them
    const clear = c => laid.every(t => c.x + tw < t.x || t.x + tw < c.x || c.y + th + 2 < t.y || t.y + th + 2 < c.y)
    const gap = c => laid.length ? Math.min(...laid.map(t => Math.max(Math.abs(c.x - t.x), Math.abs(c.y - t.y)))) : -Math.hypot(c.x + tw / 2 - (room.x0 + room.x1 + 1) / 2, c.y - (room.floorY0 + room.y1) / 2)
    while (laid.length < want) {
      const free = cand.filter(clear)
      if (!free.length) break
      free.sort((a, b) => gap(b) + b.j - (gap(a) + a.j))
      let done = false
      for (const c of free) {
        if (!putFloor(room, id, c.x, c.y)) continue
        for (const by of [c.y - 1, c.y + th]) putFloor(room, G.bench, c.x, by)
        laid.push(c); done = true
        break
      }
      if (!done) break
    }
  }

  function group(room, kind, recipe) {
    const G = GROUPS[kind]
    if (!G) return
    if (G.tables) { tables(room, G); return }
    const rw = room.x1 - room.x0 + 1, rh = room.y1 - room.floorY0 + 1
    const cx = (room.x0 + room.x1) / 2, cy = (room.floorY0 + room.y1) / 2
    if (G.rugOnly) {
      const w = Math.min(4, rw - 2), h = Math.min(3, rh - 2)
      if (w >= 2 && h >= 2) { const x0 = Math.round(cx - (w - 1) / 2), y0 = Math.round(cy - (h - 1) / 2); rug(room, x0, y0, x0 + w - 1, y0 + h - 1, pick(rng, recipe.rug ?? ['green'])) }
      return
    }
    const id = G.single ?? pick(rng, G.table)
    const item = ITEMS[id], tw = item.tiles[0].length, th = item.tiles.length
    // places for the table, nearest the middle first, keeping a cell round it where the room allows
    const cand = []
    for (let y = room.floorY0; y <= room.y1 - th + 1; y++) for (let x = room.x0; x <= room.x1 - tw + 1; x++) {
      const margin = Math.min(x - room.x0, room.x1 - (x + tw - 1), y - room.floorY0, room.y1 - (y + th - 1))
      const nearDoor = Math.max(Math.abs(x - plan.spawn.x), Math.abs(y - plan.spawn.y)) < 3 ? 4 : 0
      cand.push({ x, y, s: Math.hypot(x + (tw - 1) / 2 - cx, y + (th - 1) / 2 - cy) + rng() * 1.2 - Math.min(margin, 1) * 3 + nearDoor })
    }
    cand.sort((a, b) => a.s - b.s)
    for (const { x, y } of cand) {
      if (!putFloor(room, id, x, y)) continue
      if (G.chairs) {
        const seats = [
          ...Array.from({ length: tw }, (_, i) => ({ x: x + i, y: y - 1, id: 'chair_s' })),
          ...Array.from({ length: tw }, (_, i) => ({ x: x + i, y: y + th, id: 'chair_n' })),
          { x: x - 1, y, id: 'chair_e' }, { x: x + tw, y, id: 'chair_w' },
        ]
        const want = count(rng, G.chairs)
        let got = 0
        for (const s of shuffle(rng, seats)) {
          if (got >= want) break
          if (putFloor(room, G.stools ? 'stool' : s.id, s.x, s.y)) got++
        }
      }
      if (G.rug && recipe.rug) rug(room, x - 1, y - 1, x + tw, y + th, pick(rng, recipe.rug))
      return
    }
  }

  // More of the role's fill until the room is about as full as a lived-in room.
  function fill(room, list) {
    if (!list) return
    const floorCells = (room.x1 - room.x0 + 1) * (room.y1 - room.floorY0 + 1)
    const run = []
    for (let x = room.x0; x <= room.x1; x++) if (plan.grid[room.y0][x] === 'u') run.push(x)
    const mine = on => placed.filter(p => p.room === room.id && (ITEMS[p.id].on === 'floor') === on).length
    for (let tries = 0; tries < 24 && list.floor && mine(true) < Math.round(floorCells / FILL_CELLS); tries++)
      wallEntry(room, { items: list.floor, n: 1, at: 'edge' })
    for (let tries = 0; tries < 4 && list.flat; tries++) if (rng() < 0.5) wallEntry(room, { items: list.flat, n: 1, at: 'any' })
    for (let tries = 0; tries < 12 && list.face && mine(false) < Math.ceil(run.length / 2); tries++)
      faceEntry(room, { items: list.face, n: 1 })
  }

  return { faceEntry, wallEntry, group, fill, placed, putFloor, putFace, floorFree, bare }
}

// Lay every room's furniture into `map` (cells from walls.js) in place.
// opts: { version, trade, rng, reserve: Set<'x,y'> cells to keep bare, extra:
// roomId -> { face: [...], wall: [...] } more entries }
// Returns { placed: [{ id, x, y, room }], free: [{ x, y }] } — `free` the
// bare walkable floor left, for people, foes and pickups.
export function furnish(map, plan, roles, { version = 'home', trade = null, rng, reserve = new Set(), extra = {} } = {}) {
  const F = makeFurnisher(map, plan, rng, reserve)
  const T = TRADES[trade] ?? {}
  for (const room of plan.rooms) {
    const role = roles.get(room.id)
    const R = recipeOf(version, role)
    const face = [...(R.face ?? []), ...(role === 'hall' ? T.hallFace ?? [] : role === 'workshop' ? T.workshopFace ?? [] : []), ...(extra[room.id]?.face ?? [])]
    const wall = [...(R.wall ?? []), ...(role === 'hall' ? T.hall ?? [] : role === 'workshop' ? T.workshop ?? [] : []), ...(extra[room.id]?.wall ?? [])]
    for (const e of face) if (e.must) F.faceEntry(room, e)
    for (const e of wall) if (e.must) F.wallEntry(room, e)
    if (R.centre) F.group(room, R.centre, R)
    for (const e of face) if (!e.must) F.faceEntry(room, e)
    for (const e of wall) if (!e.must) F.wallEntry(room, e)
    F.fill(room, FILL[role])
  }
  const free = []
  map.forEach((row, y) => row.forEach((c, x) => {
    if (plan.grid[y][x] === '.' && c.tile !== TILE.WALL && !c.overlay && !(x === plan.spawn.x && y === plan.spawn.y)) free.push({ x, y })
  }))
  return { placed: F.placed, free }
}
