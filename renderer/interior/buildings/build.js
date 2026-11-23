// One hand-laid floor (parse.js) built into game cells: walls and floors from
// walls.js, the items as furnish.js lays them, stairs, pictures, then the
// floor's `dress` entries scattered by the rng on free floor. Pure in
// (def, rng).
import { TILE } from '../../systems/entities.js'
import { ITEMS, FLOORS, MISC } from '../kit.js'
import { buildCells } from '../walls.js'
import { markCasts } from '../casts.js'
import { int, pick, shuffle } from '../rng.js'
import { parseFloor } from './parse.js'

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

export function buildFloor(def, { rng }) {
  const parsed = parseFloor(def)
  const { plan } = parsed
  const floorOf = new Map(plan.rooms.map(r => {
    if (!FLOORS[r.floor]) throw new Error(`${def.id}: room "${r.id}" has unknown floor "${r.floor}"`)
    return [r.id, FLOORS[r.floor][0]]
  }))
  const map = buildCells(plan, { palette: def.palette, floorOf: id => floorOf.get(id) })
  const H = plan.h, W = plan.w

  const lay = (name, x, y) => {
    const item = ITEMS[name], block = item.block !== false
    item.tiles.forEach((row, dy) => row.forEach((tile, dx) => {
      const m = map[y + dy][x + dx]
      m.overlay = tile
      if (block && item.on === 'floor') { m.tile = TILE.WALL; m.losClear = true }
    }))
  }
  for (const it of parsed.items) lay(it.item, it.x, it.y)
  for (const s of parsed.stairs) map[s.y][s.x].overlay = s.dir === 'up' ? MISC.stairUp : MISC.stairDown
  for (const d of parsed.decos) map[d.y][d.x].deco = MISC[d.deco]

  // dressing: never on a spot, a landing, a stair, a shut cell, a legend
  // spawn, the way in or out, a doorway or the cells beside one
  const key = (x, y) => `${x},${y}`
  const bare = new Set()
  const keep = c => { bare.add(key(c.x, c.y)); for (const [dx, dy] of NEIGHBOURS) bare.add(key(c.x + dx, c.y + dy)) }
  for (const c of [plan.spawn, plan.exit, ...plan.doors.flatMap(d => d.cells)]) if (c) keep(c)
  for (const list of parsed.spots.values()) for (const c of list) bare.add(key(c.x, c.y))
  for (const s of parsed.stairs) { bare.add(key(s.x, s.y)); bare.add(key(s.land.x, s.land.y)) }
  for (const c of [...parsed.shut, ...parsed.spawns]) bare.add(key(c.x, c.y))

  const walk = c => c.tile !== TILE.WALL
  const origin = plan.spawn ?? parsed.stairs[0]?.land
  if (!origin) throw new Error(`${def.id}: a floor needs a way out (E) or a stair to start from (the spawn)`)
  const isFloor = (x, y) => '.dE'.includes(plan.grid[y][x])
  // the cells the origin reaches on foot
  const reach = () => {
    const seen = new Uint8Array(W * H), q = [origin.y * W + origin.x]
    seen[q[0]] = 1
    while (q.length) {
      const i = q.pop()
      const x = i % W, y = (i / W) | 0
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (!seen[j] && isFloor(nx, ny) && walk(map[ny][nx])) { seen[j] = 1; q.push(j) }
      }
    }
    return seen
  }
  const reachCount = () => reach().reduce((n, v) => n + v, 0)
  // a hand-written map that cannot be walked fails here, not in the game
  const seen = reach()
  const must = [
    ...map.flatMap((row, y) => row.map((c, x) => ({ x, y })).filter(c => isFloor(c.x, c.y) && walk(map[c.y][c.x]))),
    ...parsed.stairs, ...parsed.stairs.map(s => s.land), ...[...parsed.spots.values()].flat(), ...parsed.shut, ...parsed.spawns,
  ]
  for (const c of must) {
    if (!seen[c.y * W + c.x]) throw new Error(`${def.id} ${c.x},${c.y}: not reached on foot from the ${plan.spawn ? 'spawn' : 'first stair'} (${origin.x},${origin.y})`)
  }
  let walkable = reachCount()

  const cellsOf = (name, x, y) => ITEMS[name].tiles.flatMap((row, dy) => row.map((_, dx) => ({ x: x + dx, y: y + dy, dy })))
  function dressOne(name) {
    const item = ITEMS[name], block = item.block !== false && item.on === 'floor'
    const want = { floor: ['.'], faceLower: ['l'], faceUpper: ['u'], face: ['u', 'l'] }[item.on]
    const spots = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) spots.push({ x, y })
    for (const p of shuffle(rng, spots)) {
      const cells = cellsOf(name, p.x, p.y)
      const ok = cells.every(c => plan.grid[c.y]?.[c.x] === want[item.on === 'face' ? c.dy : 0] &&
        !bare.has(key(c.x, c.y)) && !map[c.y][c.x].overlay && walk(map[c.y][c.x]))
      if (!ok) continue
      for (const c of cells) {
        const m = map[c.y][c.x]
        m.overlay = item.tiles[c.dy][c.x - p.x]
        if (block) { m.tile = TILE.WALL; m.losClear = true }
      }
      if (block) {
        walkable -= cells.length
        if (reachCount() !== walkable) {
          for (const c of cells) { const m = map[c.y][c.x]; delete m.overlay; m.tile = TILE.FLOOR_WOOD; delete m.losClear }
          walkable += cells.length
          continue
        }
      }
      return true
    }
    return false
  }
  for (const e of def.dress ?? []) {
    const n = Array.isArray(e.n) ? int(rng, e.n[0], e.n[1]) : e.n ?? 1
    for (let i = 0; i < n; i++) dressOne(Array.isArray(e.item) ? pick(rng, e.item) : e.item)
  }

  markCasts(map)

  const out = {
    id: def.id, map,
    entitySpawns: parsed.spawns.map(s => ({ ...s })),
    stairs: parsed.stairs.map(({ dir, ...s }) => s),
    shut: parsed.shut, spots: parsed.spots,
    // bare walkable floor left, for seating people
    free: [],
  }
  const marked = new Set([...parsed.spawns, ...parsed.shut, ...[...parsed.spots.values()].flat()].map(c => key(c.x, c.y)))
  map.forEach((row, y) => row.forEach((c, x) => {
    if (plan.grid[y][x] === '.' && walk(c) && !c.overlay && !marked.has(key(x, y))) out.free.push({ x, y })
  }))
  if (plan.spawn) { out.playerSpawn = { ...plan.spawn }; out.exit = { ...plan.exit } }
  return out
}
