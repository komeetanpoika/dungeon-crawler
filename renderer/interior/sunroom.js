// Päivölä, the glassmaker's house: a sunbeam comes in through a tall window
// on the hall's north wall, falls across the floor and is turned by standing
// mirrors (walked into, a mirror turns: `/` becomes `\` and back). When it
// reaches the sun-seed in its planter the seed blooms, flowers open along
// the beam, and a panel in the wall opens on an alcove. Pure: the puzzle is
// written into the map's cells (`cell.mirror`, `cell.sun`), so a stored house
// keeps it as it was left; systems/sunroom-run.js plays it.
import { TILE, isWalkable } from '../systems/entities.js'
import { ITEMS, MISC } from './kit.js'
import { int, pick, shuffle } from './rng.js'

export const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
const TURN = { '/': { S: 'W', N: 'E', E: 'N', W: 'S' }, '\\': { S: 'E', N: 'W', E: 'S', W: 'N' } }
export const reflect = (o, dir) => TURN[o][dir]
const leanFor = (from, to) => (TURN['/'][from] === to ? '/' : '\\')
const WINDOW = 'window_tall_teal'

// The beam from `start` ({ x, y, dir }): the cells it lights (a mirror cell
// included, with the direction it arrived in), `hit` the seed's cell when it
// gets there, `end` the last lit cell and the way it was going.
export function traceBeam(map, start) {
  let { x, y, dir } = start
  const cells = []
  for (let steps = 0; steps < 600; steps++) {
    const c = map[y]?.[x]
    if (!c) break
    if (c.sun === 'target') return { cells, hit: { x, y }, end: cells.at(-1) ?? { ...start } }
    if (c.mirror) {
      cells.push({ x, y, dir })
      dir = reflect(c.mirror, dir)
    } else if (isWalkable(c.tile, c)) cells.push({ x, y, dir })
    else break
    x += DIRS[dir][0]; y += DIRS[dir][1]
  }
  const last = cells.at(-1)
  // a mirror cell's entry holds the way the light came in; it leaves the new way
  return { cells, hit: null, end: last ? { x: last.x, y: last.y, dir: map[last.y][last.x].mirror ? dir : last.dir } : { ...start } }
}

// Where a house's puzzle is, read off its cells (null when it has none).
export function findSun(map) {
  const out = {}
  map.forEach((row, y) => row.forEach((c, x) => {
    if (c.sun === 'start') out.start = { x, y, dir: 'S' }
    else if (c.sun === 'target') out.target = { x, y }
    else if (c.sun === 'alcove' || c.sun === 'niche') out.alcove = { x, y }
    else if (c.sun === 'window') out.window = { x, y }
  }))
  return out.start && out.target ? out : null
}

// Lay the puzzle into the hall `room` of a plan, before furniture. Returns
// { reserve } (cells furniture must leave alone: the solution's beam, the
// window, the panel and the cell before it) or null when no puzzle fits.
// `bare`: cells to keep clear anyway (spawn, way out, doorways and beside them).
export function layPuzzle(map, plan, room, rng, bare) {
  const key = (x, y) => `${x},${y}`
  const inRoom = (x, y) => x >= room.x0 && x <= room.x1 && y >= room.floorY0 && y <= room.y1
  const usable = (x, y) => inRoom(x, y) && plan.grid[y][x] === '.' && map[y][x].tile === TILE.FLOOR_WOOD && !bare.has(key(x, y))
  const run = []
  for (let x = room.x0; x <= room.x1; x++) if (plan.grid[room.y0][x] === 'u' && plan.grid[room.y0 + 1][x] === 'l') run.push(x)

  for (let attempt = 0; attempt < 80; attempt++) {
    const sx = pick(rng, run.filter(x => usable(x, room.floorY0)))
    if (sx === undefined) return null
    const turns = int(rng, 3, 4)
    const beam = new Set([key(sx, room.floorY0)]), mirrors = new Map()
    let x = sx, y = room.floorY0, dir = 'S', target = null
    const path = [{ x, y }]
    let ok = true
    for (let t = 0; t <= turns && ok; t++) {
      const [dx, dy] = DIRS[dir]
      const lengths = []
      for (let L = 1; ; L++) {
        const cx = x + dx * L, cy = y + dy * L
        if (!usable(cx, cy) || mirrors.has(key(cx, cy))) break
        if (L >= 2 && !beam.has(key(cx, cy))) lengths.push(L)
      }
      if (!lengths.length) { ok = false; break }
      const L = pick(rng, lengths)
      for (let k = 1; k < L; k++) { beam.add(key(x + dx * k, y + dy * k)); path.push({ x: x + dx * k, y: y + dy * k }) }
      const cx = x + dx * L, cy = y + dy * L
      if (t === turns) { target = { x: cx, y: cy }; break }
      const room2 = d => [1, 2].every(k => { const nx = cx + DIRS[d][0] * k, ny = cy + DIRS[d][1] * k; return usable(nx, ny) && !mirrors.has(key(nx, ny)) })
      const next = shuffle(rng, dir === 'N' || dir === 'S' ? ['E', 'W'] : ['N', 'S']).find(room2)
      if (!next) { ok = false; break }
      mirrors.set(key(cx, cy), { x: cx, y: cy, solution: leanFor(dir, next), wrong: next === 'E' ? 'W' : next === 'W' ? 'E' : next === 'N' ? 'S' : 'N' })
      path.push({ x: cx, y: cy })
      x = cx; y = cy; dir = next
    }
    if (!ok || !target) continue
    // the panel in the wall: a face column away from the window, with floor before it
    const alcoveX = shuffle(rng, run.filter(c => Math.abs(c - sx) >= 2 && usable(c, room.floorY0) && !beam.has(key(c, room.floorY0)) && !mirrors.has(key(c, room.floorY0)) && !(target.x === c && target.y === room.floorY0)))[0]
    if (alcoveX === undefined) continue
    // decoys: one or two more mirrors off the beam, where a wrong turn sends it
    const decoys = []
    const taken = k => beam.has(k) || mirrors.has(k) || k === key(target.x, target.y) || k === key(alcoveX, room.floorY0)
    const want = int(rng, 1, 2)
    const free = (nx, ny) => usable(nx, ny) && !taken(key(nx, ny)) && !decoys.some(d => d.x === nx && d.y === ny)
    for (const m of shuffle(rng, [...mirrors.values()])) {
      if (decoys.length >= want) break
      for (let k = 2; k <= 4; k++) {
        const nx = m.x + DIRS[m.wrong][0] * k, ny = m.y + DIRS[m.wrong][1] * k
        if (!usable(nx, ny)) break
        if (free(nx, ny)) { decoys.push({ x: nx, y: ny, solution: pick(rng, ['/', '\\']) }); break }
      }
    }
    // no wrong turn had room: a decoy two cells off the beam somewhere
    for (const c of shuffle(rng, path)) {
      if (decoys.length) break
      for (const [dx, dy] of shuffle(rng, Object.values(DIRS))) if (free(c.x + dx * 2, c.y + dy * 2)) { decoys.push({ x: c.x + dx * 2, y: c.y + dy * 2, solution: pick(rng, ['/', '\\']) }); break }
    }
    if (!decoys.length) continue
    // stand them up and check nothing is cut off and every mirror can be walked into
    const solid = [...mirrors.values(), ...decoys, target]
    const was = solid.map(p => ({ ...map[p.y][p.x] }))
    for (const p of solid) Object.assign(map[p.y][p.x], { tile: TILE.WALL, losClear: true })
    const seen = flood(map, plan.spawn)
    let walkable = 0
    map.forEach(row => row.forEach(c => { if (isWalkable(c.tile, c)) walkable++ }))
    const bumpable = [...mirrors.values(), ...decoys].every(m => Object.values(DIRS).some(([dx, dy]) => seen.has(key(m.x + dx, m.y + dy))))
    if (seen.size !== walkable || !bumpable || !seen.has(key(alcoveX, room.floorY0))) {
      solid.forEach((p, i) => { map[p.y][p.x] = was[i] })
      continue
    }
    // write it in
    const all = [...mirrors.values(), ...decoys]
    for (const m of all) Object.assign(map[m.y][m.x], { mirror: m.solution, solution: m.solution, overlay: MISC.mirror[m.solution] })
    Object.assign(map[target.y][target.x], { sun: 'target', overlay: MISC.seed })
    map[room.floorY0][sx].sun = 'start'
    const win = ITEMS[WINDOW].tiles
    map[room.y0][sx].overlay = win[0][0]
    Object.assign(map[room.y0 + 1][sx], { overlay: win[1][0], sun: 'window' })
    Object.assign(map[room.y0 + 1][alcoveX], { overlay: MISC.panel, sun: 'alcove' })
    // scrambled until the beam misses, with at least two of the beam's own mirrors wrong
    const own = [...mirrors.values()]
    for (let s = 0; s < 60; s++) {
      for (const m of all) { const o = pick(rng, ['/', '\\']); map[m.y][m.x].mirror = o; map[m.y][m.x].overlay = MISC.mirror[o] }
      const wrong = own.filter(m => map[m.y][m.x].mirror !== m.solution).length
      if (wrong >= 2 && !traceBeam(map, { x: sx, y: room.floorY0, dir: 'S' }).hit) break
      if (s === 59) for (const m of own.slice(0, 2)) { const o = m.solution === '/' ? '\\' : '/'; map[m.y][m.x].mirror = o; map[m.y][m.x].overlay = MISC.mirror[o] }
    }
    const reserve = new Set([...beam, key(alcoveX, room.floorY0), key(sx, room.y0), key(sx, room.y0 + 1), key(alcoveX, room.y0), key(alcoveX, room.y0 + 1)])
    // every mirror keeps a cell beside it to be walked into from
    for (const m of all) {
      const side = Object.values(DIRS).map(([dx, dy]) => [m.x + dx, m.y + dy]).filter(([nx, ny]) => seen.has(key(nx, ny)))
      if (!side.some(([nx, ny]) => reserve.has(key(nx, ny)))) reserve.add(key(...side[0]))
    }
    return { reserve, start: { x: sx, y: room.floorY0, dir: 'S' }, target, alcove: { x: alcoveX, y: room.y0 + 1 }, path }
  }
  return null
}

function flood(map, from) {
  const seen = new Set([`${from.x},${from.y}`]), q = [from]
  while (q.length) {
    const { x, y } = q.pop()
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`
      if (!seen.has(k) && map[ny]?.[nx] && isWalkable(map[ny][nx].tile, map[ny][nx])) { seen.add(k); q.push({ x: nx, y: ny }) }
    }
  }
  return seen
}

// The seed has its light: it blooms, flowers open along the beam, the panel
// opens on the alcove. Returns the cells changed (for the tile cache).
export function solveSun(map, sun) {
  const changed = []
  const t = map[sun.target.y][sun.target.x]
  t.overlay = MISC.bloom
  changed.push({ ...sun.target })
  for (const c of traceBeam(map, sun.start).cells) {
    const cell = map[c.y][c.x]
    if (cell.mirror || cell.overlay || cell.deco) continue
    cell.deco = MISC.flowers[(c.x * 7 + c.y * 3) % MISC.flowers.length]
    changed.push({ x: c.x, y: c.y })
  }
  if (sun.alcove) {
    const a = map[sun.alcove.y][sun.alcove.x]
    a.tile = TILE.FLOOR_WOOD
    a.skin = MISC.nicheFloor
    a.sun = 'niche'
    delete a.overlay; delete a.seeUp
    map[sun.alcove.y - 1][sun.alcove.x].overlay = MISC.nicheTop
    changed.push({ ...sun.alcove }, { x: sun.alcove.x, y: sun.alcove.y - 1 })
  }
  return changed
}
