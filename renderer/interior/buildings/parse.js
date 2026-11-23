// A floor laid by hand: `rows` is the plan grid (plan.js glyphs: '#' wall top,
// 'u' 'l' face rows, '.' floor, 'd' doorway, 'E' the way out, ' ' outside) and
// `things` a grid of the same size with a legend character where something
// lies. parseFloor turns it into the plan walls.js `buildCells` takes, plus
// what is laid on it. Pure.
//
// A legend entry is one of these combinations of keys; anything else throws:
//   { item }                          a piece of furniture (ITEMS key)
//   { item, spot }                    the same, and its cells are also a spot
//   { spot }                          a named place people are seated at
//   { stair, to: [floor, stair], dir: 'up'|'down' }   a stair cell
//   { stair, to, dir, say }           the same, with a line thought the first time it is climbed
//   { stair, to, dir, art }           (with or without say) drawn with MISC[art] instead of a stair
//   { land }                          the landing of the stair of that id
//   { shut }                          a shut door cell, `shut` is its line
//   { shut, deco }                    the same, drawn with MISC[deco]
//   { deco }                          a picture on the floor (MISC[deco])
//   { spawn }                         an entity spawn (kind defaults to 'npc')
//   { spawn, spot }                   the same, on a spot
//   { spawn, guards, line }           the spawn guards the stair of that id
//   { spawn, spot, guards, line }
//
// `rugs` (optional): [{ colour, x0, y0, x1, y1 }], bordered rugs (kit RUGS)
// laid on the floor under whatever stands there, at least 2x2, never on a
// cell with a picture of its own (a legend deco).
// `clear` (optional): [{ x0, y0, x1, y1 }], floor kept clear: nothing is
// dressed there and nobody stands there for want of a seat (an aisle, the
// space before an altar). Spots in it are still sat at.
// `sealed` (optional): [{ x0, y0, x1, y1 }], floor behind a locked door (a
// prison cell behind its bars): seen through, never walked on, nothing
// dressed there and nobody seated. An item may stand in it (a cot); a spot,
// stair, landing, shut cell or spawn may not (they must be reached).
import { ITEMS, MISC, RUGS } from '../kit.js'

const GRID = new Set([...'#ul.dE '])
const COMBOS = [
  ['item'], ['item', 'spot'], ['spot'], ['stair', 'dir', 'to'], ['say', 'stair', 'dir', 'to'], ['art', 'stair', 'dir', 'to'], ['art', 'say', 'stair', 'dir', 'to'], ['land'], ['shut'], ['deco', 'shut'], ['deco'],
  ['spawn'], ['spawn', 'spot'], ['guards', 'line', 'spawn'], ['guards', 'line', 'spawn', 'spot'],
].map(k => [...k].sort().join('+'))

export function parseFloor(def) {
  const id = def.id
  const fail = (x, y, msg) => { throw new Error(`${id} ${x},${y}: ${msg}`) }
  const failFloor = msg => { throw new Error(`${id}: ${msg}`) }
  const rows = def.rows, things = def.things
  const h = rows.length, w = rows[0]?.length ?? 0
  rows.forEach((r, y) => { if (r.length !== w) fail(0, y, `rows of unequal length (${r.length}, not ${w})`) })
  if (things.length !== h) failFloor(`things has ${things.length} rows, rows has ${h}`)
  things.forEach((r, y) => { if (r.length !== w) fail(0, y, `things row of unequal length (${r.length}, not ${w})`) })
  const legend = def.legend ?? {}
  for (const [c, e] of Object.entries(legend)) {
    if (!COMBOS.includes(Object.keys(e).sort().join('+'))) failFloor(`legend "${c}" mixes roles that do not go together (${Object.keys(e).join(', ')})`)
    if (e.item && !ITEMS[e.item]) failFloor(`legend "${c}": unknown item "${e.item}"`)
    if (e.deco && typeof MISC[e.deco] !== 'string') failFloor(`legend "${c}": unknown deco "${e.deco}"`)
    if (e.say !== undefined && (typeof e.say !== 'string' || !e.say)) failFloor(`legend "${c}": a stair's say is a line of text`)
    if (e.stair && e.dir !== 'up' && e.dir !== 'down') failFloor(`legend "${c}": a stair's dir is 'up' or 'down'`)
  }

  const g = (x, y) => rows[y]?.[x] ?? ' '
  let exit = null
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (!GRID.has(ch)) fail(x, y, `unknown grid character "${ch}"`)
    if (ch === 'E') { if (exit) fail(x, y, `more than one E (first at ${exit.x},${exit.y})`); exit = { x, y } }
  }))
  const spawn = exit ? { x: exit.x, y: exit.y - 1 } : null

  const items = [], decos = [], spawns = [], shut = [], guards = [], lands = new Map()
  const spots = new Map(), stairs = new Map()
  const addSpot = (name, x, y) => { if (!spots.has(name)) spots.set(name, []); spots.get(name).push({ x, y }) }
  const used = Array.from({ length: h }, () => new Array(w).fill(false))

  const need = { floor: ['.'], faceLower: ['l'], faceUpper: ['u'], face: ['u', 'l'] }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = things[y][x]
    if (c === ' ' || used[y][x]) continue
    const e = legend[c]
    if (!e) fail(x, y, `unknown legend character "${c}"`)
    if (e.item) {
      const item = ITEMS[e.item], th = item.tiles.length, tw = item.tiles[0].length
      for (let dy = 0; dy < th; dy++) for (let dx = 0; dx < tw; dx++) {
        if (things[y + dy]?.[x + dx] !== c || used[y + dy][x + dx]) fail(x, y, `item "${e.item}" needs a ${tw}x${th} block of "${c}"`)
      }
      for (let dy = 0; dy < th; dy++) for (let dx = 0; dx < tw; dx++) {
        const want = need[item.on][item.on === 'face' ? dy : 0]
        if (g(x + dx, y + dy) !== want) fail(x + dx, y + dy, `item "${e.item}" (on ${item.on}) needs "${want}" under it, found "${g(x + dx, y + dy)}"`)
        used[y + dy][x + dx] = true
        if (e.spot) addSpot(e.spot, x + dx, y + dy)
      }
      if (e.spot && (item.on !== 'floor' || item.block !== false)) fail(x, y, `item "${e.item}" blocks, so nobody can stand on it as a spot`)
      items.push({ item: e.item, x, y })
      continue
    }
    used[y][x] = true
    const onFloor = () => { if (g(x, y) !== '.') fail(x, y, `"${c}" needs floor ('.') under it, found "${g(x, y)}"`) }
    const seat = () => { if (spawn && x === spawn.x && y === spawn.y) fail(x, y, `a spot cannot be on the spawn cell`) }
    if (e.shut !== undefined) {
      if (g(x, y) !== '.' && g(x, y) !== 'd') fail(x, y, `shut cell needs floor or a doorway under it, found "${g(x, y)}"`)
      shut.push({ x, y, line: e.shut })
      if (e.deco) decos.push({ x, y, deco: e.deco })
    } else if (e.deco) {
      if (g(x, y) !== '.' && g(x, y) !== 'd') fail(x, y, `deco needs floor under it`)
      decos.push({ x, y, deco: e.deco })
    } else if (e.stair) {
      onFloor()
      if (stairs.has(e.stair)) fail(x, y, `stair "${e.stair}" stands twice (first at ${stairs.get(e.stair).x},${stairs.get(e.stair).y})`)
      stairs.set(e.stair, { id: e.stair, x, y, to: { floor: e.to[0], stair: e.to[1] }, dir: e.dir, ...(e.say ? { say: e.say } : {}), ...(e.art ? { art: e.art } : {}) })
    } else if (e.land) {
      onFloor()
      if (lands.has(e.land)) fail(x, y, `stair "${e.land}" has more than one landing`)
      lands.set(e.land, { x, y })
    } else if (e.spawn) {
      onFloor()
      spawns.push({ kind: 'npc', ...e.spawn, x, y })
      if (e.spot) { seat(); addSpot(e.spot, x, y) }
      if (e.guards) guards.push({ stair: e.guards, id: e.spawn.id, line: e.line, x, y })
    } else if (e.spot) {
      onFloor()
      seat()
      addSpot(e.spot, x, y)
    }
  }

  for (const s of stairs.values()) {
    const land = lands.get(s.id)
    if (!land) fail(s.x, s.y, `stair "${s.id}" needs exactly one landing`)
    s.land = land
  }
  for (const [sid, l] of lands) if (!stairs.has(sid)) fail(l.x, l.y, `landing for unknown stair "${sid}"`)
  const seen = new Set()
  for (const gd of guards) {
    const s = stairs.get(gd.stair)
    if (!s) fail(gd.x, gd.y, `guards unknown stair "${gd.stair}"`)
    if (seen.has(gd.stair)) fail(gd.x, gd.y, `stair "${gd.stair}" has two guards`)
    seen.add(gd.stair)
    s.guard = gd.id; s.line = gd.line
  }

  const rugs = (def.rugs ?? []).map((r, i) => {
    const where = `rug ${i} (${r.colour})`
    if (!RUGS[r.colour]) failFloor(`${where}: unknown colour`)
    if (!(r.x1 > r.x0 && r.y1 > r.y0)) failFloor(`${where}: a rug is at least 2x2`)
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (g(x, y) !== '.') fail(x, y, `${where} needs floor ('.') under it, found "${g(x, y)}"`)
      if (decos.some(d => d.x === x && d.y === y)) fail(x, y, `${where} lies on a picture of its own`)
    }
    return { colour: r.colour, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }
  })

  const clear = []
  for (const [i, r] of (def.clear ?? []).entries()) {
    if (!(r.x1 >= r.x0 && r.y1 >= r.y0)) failFloor(`clear ${i}: x0..x1 and y0..y1 run the wrong way`)
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (g(x, y) !== '.') fail(x, y, `clear ${i} needs floor ('.') under it, found "${g(x, y)}"`)
      clear.push({ x, y })
    }
  }

  const reached = [
    ...[...spots].flatMap(([name, list]) => list.map(c => ({ ...c, what: `spot "${name}"` }))),
    ...[...stairs.values()].flatMap(s => [{ x: s.x, y: s.y, what: `stair "${s.id}"` }, { ...s.land, what: `the landing of stair "${s.id}"` }]),
    ...shut.map(c => ({ ...c, what: 'shut cell' })), ...spawns.map(c => ({ ...c, what: 'spawn' })),
  ]
  const sealed = []
  for (const [i, r] of (def.sealed ?? []).entries()) {
    if (!(r.x1 >= r.x0 && r.y1 >= r.y0)) failFloor(`sealed ${i}: x0..x1 and y0..y1 run the wrong way`)
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (g(x, y) !== '.') fail(x, y, `sealed ${i} needs floor ('.') under it, found "${g(x, y)}"`)
      const hit = reached.find(c => c.x === x && c.y === y)
      if (hit) fail(x, y, `sealed ${i} lies on a ${hit.what}, which must be reached`)
      sealed.push({ x, y })
    }
  }

  const rooms = def.rooms.map(r => ({ id: r.id, x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1, floorY0: r.y0 + 2, floor: r.floor }))
  if (!rooms.some(r => r.id === def.entry)) failFloor(`entry "${def.entry}" is not a room`)
  const doors = []
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'd') doors.push({ x, y, cells: [{ x, y }] }) }))
  const plan = { w, h, grid: [...rows], rooms, doors, entry: def.entry }
  if (exit) { plan.exit = exit; plan.spawn = spawn }
  return {
    plan, items, spots, stairs: [...stairs.values()], shut, decos, rugs, clear, sealed, spawns,
    guards: guards.map(({ stair, id: gid, line }) => ({ stair, id: gid, line })),
  }
}
