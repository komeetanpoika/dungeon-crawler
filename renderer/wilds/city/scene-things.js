// The things Kalevanlinna's scenes move about (scenes.js casts and runs the
// people): the pigeon flock and the gulls, the horse and cart, the lamps and the washing
// lines, the turnips round the stocks, and the tiles the people stand on for
// them. Plain data on the run in world tiles (the shapes are in scenes.js's
// header) for the drawing and the sound to read. DOM-free; pure in the city,
// the seed, the day and the clock.
import { isTop } from '../over.js'
import { hash, hashInt } from '../rand.js'
import { DAY } from './schedule.js'
import { PLAN } from './plan.js'
import { reachable, CITY_OX as OX, CITY_OY as OY } from './walkers.js'
import { CITY } from './geometry.js'
import { TILE } from '../../systems/entities.js'

const S = 32
const N = CITY.size
export const LIFT_R = 2         // tiles from a dog, a child at play or the player that lift the pigeons (and the gulls)
export const LIFT_TIME = 0.6    // s the flock takes to get off the ground
export const CIRCLE_TIME = 4    // s it circles before it settles somewhere else
const SETTLE_MIN = 8            // tiles: the least a flock moves when it lifts
const BIRDS = 9
const GULLS = 2, GULL_BIRDS = 4  // gull flocks about the harbour, birds in each
const TAG_BOX = 5               // tiles from the middle the children keep within, playing tag
const CART_SPEED = 2            // tiles a second
const CART_UNLOAD = 10          // s at the stall
const GIVE_AHEAD = 2.5          // tiles ahead of the cart people step out of the way
const SHY_TIME = 1.5            // s spent stepping aside (runtime.js reads w.shy)
export const TURNIP_FLIGHT = 0.6   // s a turnip is in the air

export const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))
export const toWorld = t => ({ X: t.x + OX, Y: t.y + OY })
// a window cell one can walk on, by world tile
// a cell to stand on or run to: floor, and not under a roof's or a wall's top (wilds/over.js)
const standable = cell => cell?.tile === TILE.FLOOR && !isTop(cell)
export const walkableAt = (c, X, Y) => standable(c.state.map[Math.round(Y) - c.oy]?.[Math.round(X) - c.ox])
export const entityW = (c, e) => ({ X: e.px / S - 0.5 + c.ox, Y: e.py / S - 0.5 + c.oy })

// What the scenes need of a city, found once: the square's open cells (where
// pigeons settle), the quays' and moles' (where gulls do), the washing lines,
// the lamps' order out from the fountain, and the cell to stand on by each
// line and lamp.
const thingsCache = new WeakMap()
export function thingsOf(cc) {
  let t = thingsCache.get(cc.city)
  if (t) return t
  const { city, G } = cc
  const open = (x, y) => x >= 0 && y >= 0 && x < N && y < N && G.walk[y * N + x] === 1 && !cc.doorCells.has(y * N + x)
  const sq = PLAN.places.square, square = []
  for (let y = sq.y0 + 2; y <= sq.y1 - 2; y++) for (let x = sq.x0 + 2; x <= sq.x1 - 2; x++) {
    if (!open(x, y) || !reachable(cc, x, y)) continue
    let clear = true
    for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 1; dx++) if (!open(x + dx, y + dy)) { clear = false; break }
    if (clear) square.push({ x, y })
  }
  const quay = [], mole = []
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!open(x, y)) continue
    const skin = city.cells[y][x].skin ?? ''
    if (skin.startsWith('ow_city_pave_quay_')) quay.push({ x, y })
    else if (skin.startsWith('ow_city_pave_mole_')) mole.push({ x, y })
  }
  const harbour = [...quay, ...mole]
  const besideOf = (x, y, tries) => {
    for (const [dx, dy] of tries) if (open(x + dx, y + dy) && reachable(cc, x + dx, y + dy)) return { x: x + dx, y: y + dy }
    return null
  }
  const lines = []
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (city.cells[y][x].overlay !== 'ow_prop_city_washing_l') continue
    const stand = besideOf(x, y, [[0, 1], [1, 1], [0, -1], [1, -1], [-1, 0], [2, 0]])
    if (stand) lines.push({ x, y, stand })
  }
  const f = city.spots.fountain
  const lamps = city.lamps.map((l, i) => ({ i, d: Math.hypot(l.x - f.x, l.y - f.y) })).sort((a, b) => a.d - b.d || a.i - b.i)
  const rank = new Int16Array(city.lamps.length)
  lamps.forEach((l, r) => { rank[l.i] = r })
  const lampStand = city.lamps.map(l => besideOf(l.x, l.y, [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]]))
  t = { square, quay, harbour, lines, rank, lampStand }
  thingsCache.set(city, t)
  return t
}

// Lamps are lit by the clock wherever the lamplighter is not seen at it:
// nearest the fountain first over the dusk round, out again over the dawn
// round. Where he is seen, he lights them one by one, the nearest due first.
export function lampDue(things, i, frac) {
  const n = things.rank.length, r = things.rank[i] / Math.max(1, n)
  const on = DAY.dusk - 0.02 + 0.1 * r, off = DAY.dawn - 0.01 + 0.06 * r
  return frac >= on || frac < off ? 1 : 0
}

// Washing goes out in the morning and comes in at dusk, on a washing day.
export function washDue(washday, seed, day, j, frac) {
  if (!washday) return 'in'
  const out = 0.27 + 0.03 * hash(seed, day, j, 961), back = 0.71 + 0.04 * hash(seed, day, j, 962)
  return frac >= out && frac < back ? 'out' : 'in'
}

export function makeFlock(things, seed, day) {
  const sq = things.square
  const at = sq.length ? sq[hashInt(seed, day, 0, 942) % sq.length] : { x: 79, y: 70 }
  return { kind: 'pigeon', X: at.x + OX, Y: at.y + OY, state: 'settled', t: 0, from: null, target: null, birds: BIRDS, lifts: 0 }
}

// The gulls: a few small flocks about the harbour, on the same pattern as the
// pigeons (stepFlocks): the first on the wharf and the piers, the others
// anywhere on the quays and moles; they settle anywhere about the harbour.
export function makeGulls(things, seed, day) {
  const out = []
  for (let g = 0; g < GULLS; g++) {
    const hb = g === 0 && things.quay.length ? things.quay : things.harbour
    if (!hb.length) break
    const at = hb[hashInt(seed, day, g, 944) % hb.length]
    out.push({ kind: 'gull', X: at.x + OX, Y: at.y + OY, state: 'settled', t: 0, from: null, target: null, birds: GULL_BIRDS, lifts: 0 })
  }
  return out
}

// The cells round the stocks a crowd stands on (2 and 3 tiles out), in world tiles.
export function ringRound(c, at) {
  const out = []
  for (const r of [2, 3]) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    if (walkableAt(c, at.X + dx, at.Y + dy)) out.push({ X: at.X + dx, Y: at.Y + dy })
  }
  return out
}

// A tile for a child running from "it": three tiles off in whichever of eight
// ways is furthest from it, within the play box. Window tiles.
export function fleeTile(c, e, it, mid) {
  const box = { x: Math.round(mid.x) - c.ox, y: Math.round(mid.y) - c.oy }
  let best = null, bd = -1
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (const n of [3, 2]) {
      const x = e.x + dx * n, y = e.y + dy * n
      if (Math.max(Math.abs(x - box.x), Math.abs(y - box.y)) > TAG_BOX || !standable(c.state.map[y]?.[x])) continue
      const d = Math.max(Math.abs(x - it.x), Math.abs(y - it.y))
      if (d > bd) { best = { x, y }; bd = d }
      break
    }
  }
  return best
}

// The flocks: settled until something spooks them, then up (LIFT_TIME), round
// and down somewhere else on the square (CIRCLE_TIME), or about the harbour.
export function stepFlocks(c, dt) {
  const { run } = c
  for (const f of run.fx.flocks) {
    if (f.state === 'settled') {
      if (f.startle || spooked(c, f)) { f.startle = false; f.state = 'lifting'; f.t = LIFT_TIME; f.lifts++; f.from = { X: f.X, Y: f.Y } }
    } else if (f.state === 'lifting') {
      if ((f.t -= dt) <= 0) { f.state = 'circling'; f.t = CIRCLE_TIME; f.target = settleSpot(c, f) }
    } else if ((f.t -= dt) <= 0) {
      f.state = 'settled'; f.X = f.target.X; f.Y = f.target.Y; f.target = null; f.from = null
    } else {
      const k = 1 - f.t / CIRCLE_TIME
      f.X = f.from.X + (f.target.X - f.from.X) * k; f.Y = f.from.Y + (f.target.Y - f.from.Y) * k
    }
  }
}

// a dog, a child at play or the player within LIFT_R of the flock
function spooked(c, f) {
  if (cheb(c.PX, c.PY, f.X, f.Y) <= LIFT_R) return true
  for (const a of c.run.animals.values()) {
    if (a.species !== 'dog' || a.mode !== 'near' || !a.entity) continue
    const p = entityW(c, a.entity)
    if (cheb(p.X, p.Y, f.X, f.Y) <= LIFT_R) return true
  }
  for (const sc of c.run.scenes) {
    if (sc.id !== 'tag' || sc.done) continue
    for (const id of sc.cast) {
      const e = c.run.people.get(id)?.entity
      if (e && cheb(entityW(c, e).X, entityW(c, e).Y, f.X, f.Y) <= LIFT_R) return true
    }
  }
  return false
}

// somewhere else on the square (about the harbour, for gulls), SETTLE_MIN
// tiles off at least and clear of the player
function settleSpot(c, f) {
  const { run } = c, things = thingsOf(run.cc), sq = f.kind === 'gull' ? things.harbour : things.square
  const n = sq.length
  if (!n) return { X: f.X, Y: f.Y }
  const k0 = hashInt(run.seed, run.day, f.lifts, f.kind === 'gull' ? 945 + run.fx.flocks.indexOf(f) : 943) % n
  for (let i = 0; i < n; i++) {
    const t = sq[(k0 + i * 37) % n], X = t.x + OX, Y = t.y + OY
    if (cheb(X, Y, f.from.X, f.from.Y) >= SETTLE_MIN && cheb(X, Y, c.PX, c.PY) > LIFT_R + 1) return { X, Y }
  }
  const t = sq[k0]
  return { X: t.x + OX, Y: t.y + OY }
}

// One frame of the cart (scene record `sc`: path, i, back, wait, give, cart):
// along its path at CART_SPEED, held up by the player standing in its way, a
// stop at the stall, then back out of the gate. 'gone' once it stands there
// out of sight.
export function moveCart(c, sc, dt) {
  const { run } = c, k = sc.cart
  if (sc.wait > 0) { sc.wait -= dt; k.state = 'unloading'; if (sc.wait <= 0) { sc.back = true; sc.path = sc.path.slice().reverse(); sc.i = 1 } return }
  const t = sc.path[sc.i]
  if (!t) {
    if (!sc.back) { sc.wait = CART_UNLOAD; return }
    k.state = 'stopped'
    return cheb(k.X, k.Y, c.PX, c.PY) > c.R + 2 ? 'gone' : null
  }
  const tx = t.x + OX, ty = t.y + OY
  const dx = tx - k.X, dy = ty - k.Y, d = Math.hypot(dx, dy)
  if (d < 1e-6) { sc.i++; return }   // on this waypoint already: the next
  k.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north')
  const ux = dx / d, uy = dy / d
  // the player in the way: it waits
  const ax = c.PX - k.X, ay = c.PY - k.Y, along = ax * ux + ay * uy
  if (along > 0 && along < 1.6 && Math.abs(ax * uy - ay * ux) < 0.9) { k.state = 'stopped'; return }
  k.state = 'rolling'
  const step = CART_SPEED * dt
  if (d <= step) { k.X = tx; k.Y = ty; sc.i++ } else { k.X += ux * step; k.Y += uy * step }
  sc.at.x = k.X; sc.at.y = k.Y
  if ((sc.give -= dt) > 0) return
  sc.give = 0.2
  // people ahead step aside, out of the cart's way
  for (const w of run.people.values()) {
    if (w.mode !== 'near' || w.hunt || w.shy || !(w.entity?.hp > 0)) continue
    const px = w.X - k.X, py = w.Y - k.Y, al = px * ux + py * uy, lat = px * uy - py * ux
    if (al < -0.5 || al > GIVE_AHEAD || Math.abs(lat) > 1.2) continue
    const s = lat >= 0 ? 1 : -1
    for (const side of [s, -s]) {
      const X = Math.round(w.X + uy * side * 2), Y = Math.round(w.Y - ux * side * 2)
      if (walkableAt(c, X, Y)) { w.shy = { X, Y, t: SHY_TIME }; break }
    }
  }
}

// Turnips in the air land after TURNIP_FLIGHT, with a splat (fx.splats, for the screen).
export function stepTurnips(c, dt) {
  const { run, state } = c
  const list = run.fx.turnips
  for (let i = list.length - 1; i >= 0; i--) {
    if ((list[i].t += dt) < TURNIP_FLIGHT) continue
    const [k] = list.splice(i, 1)
    run.fx.splats?.push({ X: k.toX, Y: k.toY, t: 0 })
    run.hooks.sfx?.('splat', { px: state.player.px, py: state.player.py })
  }
}
