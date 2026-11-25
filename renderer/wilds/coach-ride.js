// The coach's ride in the world (game.js drives it once a town is chosen in
// the coach's menu): the hero sits on top, the coachman drives from the bench,
// and the horse pulls the coach along the real road (coach-path.js) at
// COACH_SPEED, from the cart at the stop left to the cart at the far stop,
// where the hero steps down. The window follows the hero as on foot
// (session.js tickWilds re-centres it; game.js wakes the tales and the town
// after each re-centre); the day and play time go on as on foot. Nothing hurts
// the rider (player-damage.js) and no foe sees him (systems/brain.js); the
// controls are his again when he steps down (player-bind.js playerBound).
// DOM-free.
//
//   state.coachRide   never saved: { from, dest, pieces, todo, path, d, t, hoof, dir,
//                     rolling, man, carts }
//     pieces   keys of every piece the ride sees: made before it sets off, held
//              in the cache (world.held) until it ends
//     path     the way in world tiles (null until the land is made); d how far
//              along it the coach is, in tiles; dir the way the horse faces
//     man      the coachman entity on the bench (taken off his post), or null
//     carts    the cells whose cart art is taken off for the ride (the stop
//              left, and the far stop until the coach parks there)
//   player.riding     the hero on top: bound, unhurt, unseen
//
// A save made during the ride (session.js snapshotWilds) records the hero
// at the far stop, arrived, so quitting never leaves him on the road.
import { coachPath, cartOf, ridePieces } from './coach-path.js'
import { arrive, stopTile, wakeOf } from './coach.js'
import { getPiece, recordFor } from './world.js'
import { admit } from './tales.js'
import { admitSampo } from './city/sampo-places.js'
import { PIECE } from './layout.js'
import { WIN_TILES } from './window.js'
import { markTileDirty } from '../systems/tile-dirty.js'
import { sfx } from '../systems/sfx.js'

export const COACH_SPEED = 22     // tiles a second: about six times walking pace
export const HOOF_EVERY = 0.3     // s between two clip-clops while it rolls
const S = 32

const parse = key => key.split(',').map(Number)
const cellAt = (world, X, Y) => {
  const wx = Math.floor(X / PIECE), wy = Math.floor(Y / PIECE)
  return getPiece(world, wx, wy).cells[Y - wy * PIECE][X - wx * PIECE]
}
const dirOf = (a, b) => (b.X > a.X ? 'east' : b.X < a.X ? 'west' : b.Y > a.Y ? 'south' : 'north')

// Take a cart's art off its cells, or put it back. The cells keep everything
// else (they still block): only what is drawn changes, and the tile layer is
// told where the cell is in the window.
function hideCart(state, world, cells) {
  for (const p of cells) {
    const c = cellAt(world, p.X, p.Y)
    if (c.overlay === undefined) continue
    c.hiddenCart = c.overlay
    delete c.overlay
    dirty(state, world, p)
  }
}
function showCart(state, world, cells) {
  for (const p of cells) {
    const c = cellAt(world, p.X, p.Y)
    if (c.hiddenCart === undefined) continue
    c.overlay = c.hiddenCart
    delete c.hiddenCart
    dirty(state, world, p)
  }
}
function dirty(state, world, p) {
  const x = p.X - world.origin.wx * PIECE, y = p.Y - world.origin.wy * PIECE
  if (state.map && x >= 0 && y >= 0 && x < WIN_TILES && y < WIN_TILES) markTileDirty(state.map, x, y)
}
const cartCells = cart => (cart ? [cart.H, cart.C] : [])

// Set off from the stop of `fromKey` for `dest` (an entry of destinations).
// The land the ride will see is given its chance of becoming a tale's place
// now, all at once, as the window would give it bit by bit (tales.js admit,
// city/sampo-places.js admitSampo), and is then made, a piece a frame, while
// the coach waits at the stop (tickCoachRide). The coachman leaves his post
// for the bench; the cart at the stop is the coach now.
export function startRide(state, world, fromKey, dest) {
  if (state.coachRide) return state.coachRide
  const pieces = admitRide(world, dest.route)
  world.held = new Set(pieces)
  const ride = {
    from: fromKey, dest, pieces, todo: pieces.filter(k => !world.pieces.has(k)),
    path: null, d: 0, t: 0, hoof: 0, dir: 'west', rolling: false, man: null, carts: [],
  }
  // the coachman of a village takes the bench; he is home again when his village is next built
  const man = state.entities.find(e => e.type === 'npc' && e.coachman && e.wildsKey === fromKey && e.hp > 0)
  if (man) {
    state.entities = state.entities.filter(e => e !== man)
    if (!world.away.has(fromKey)) world.away.set(fromKey, new Set())
    world.away.get(fromKey).add(man.wildsIx)
    ride.man = man
  }
  const cart = cartOf(world, fromKey)
  ride.start = cart?.C ?? stopTile(world, fromKey)
  if (cart) { ride.dir = dirOf(cart.C, cart.H); ride.carts.push(...cartCells(cart)); hideCart(state, world, cartCells(cart)) }
  const p = state.player
  p.riding = true
  p.charging = null
  p.knockback = null
  p.swayAmp = 0
  state.coachRide = ride
  seat(state, world, ride)
  return ride
}

// The land a ride along `route` will see (coach-path.js ridePieces), given
// its one chance of becoming a tale's or a Sampo piece's place, in the order
// session.js recentre gives it; then recorded, so no window rolls for it
// again. Returns its piece keys.
export function admitRide(world, route) {
  const pieces = ridePieces(route)
  const refs = pieces.map(k => { const [wx, wy] = parse(k); return { wx, wy } })
  admit(world, refs)
  admitSampo(world, refs)
  for (const k of pieces) recordFor(world, k)
  return pieces
}

// Once a frame on the surface while a ride is up: the next piece of land
// made, then the way found and the far cart taken off for the coach to park
// on; then the coach rolls on and the hero with it. 'arrived' on the frame
// the hero steps down, else null.
export function tickCoachRide(state, world, dt) {
  const ride = state.coachRide
  if (!ride) return null
  ride.t += dt
  if (!ride.path) {
    const next = ride.todo.find(k => !world.pieces.has(k))
    if (next) { getPiece(world, ...parse(next)); seat(state, world, ride); return null }
    ride.path = coachPath(world, ride.from, ride.dest.town.key) ?? [ride.start, stopTile(world, ride.dest.town.key)]
    const far = cartOf(world, ride.dest.town.key)
    ride.carts.push(...cartCells(far))
    hideCart(state, world, cartCells(far))
    seat(state, world, ride)
    return null
  }
  const end = ride.path.length - 1
  ride.d = Math.min(end, ride.d + COACH_SPEED * dt)
  seat(state, world, ride)
  if ((ride.hoof -= dt) <= 0) { sfx(state, 'coach-hoof'); ride.hoof += HOOF_EVERY }
  if (ride.d < end) return null
  park(state, world, ride)
  return 'arrived'
}

// The hero on the coach: his tile the cell the coach is on (the nearer of the
// two it is between), his pixel position where it is now. In window tiles,
// worked out from the world tiles at every frame (the window moves under it).
function seat(state, world, ride) {
  let X, Y, tile
  if (!ride.path) { X = ride.start.X; Y = ride.start.Y; tile = ride.start; ride.rolling = false }
  else {
    const i = Math.min(Math.floor(ride.d), ride.path.length - 1), f = ride.d - i
    const a = ride.path[i], b = ride.path[Math.min(i + 1, ride.path.length - 1)]
    X = a.X + (b.X - a.X) * f; Y = a.Y + (b.Y - a.Y) * f
    tile = f < 0.5 ? a : b
    if (a !== b) ride.dir = dirOf(a, b)
    ride.rolling = ride.d < ride.path.length - 1
  }
  const ox = world.origin.wx * PIECE, oy = world.origin.wy * PIECE, p = state.player
  p.x = tile.X - ox; p.y = tile.Y - oy
  p.px = (X - ox) * S + S / 2; p.py = (Y - oy) * S + S / 2
  p.facing = ride.dir
}

// The coach stands on the far cart: its art is back, and so is the cart's at
// the stop left; the hero steps down beside the stop (coach.js arrive: held
// off it, the town visited and where he wakes), his controls his again.
function park(state, world, ride) {
  showCart(state, world, ride.carts)
  state.coachRide = null
  world.held = null
  const p = state.player
  p.riding = false
  arrive(state, world, ride.dest)
  // he did not walk here: no sway left over from a walk
  p._wpx = p.px; p._wpy = p.py; p.swayAmp = 0
}

// A save made while a ride is up (session.js snapshotWilds): the world record
// `rec` (exportWorld) as if the ride were over: the hero at the far stop, the
// town visited and where he wakes. The live world is left as it is.
export function arrivedRecord(rec, world, ride) {
  const town = ride.dest.town
  const at = stopTile(world, town.key)
  if (at) rec.pos = { X: at.X, Y: at.Y }
  if (!rec.visited.includes(town.key)) rec.visited = [...rec.visited, town.key]
  rec.lastVillage = wakeOf(town)
  return rec
}
