// Kalevanlinna's law at work (the rules and numbers are crime.js's). A blow
// from the player on one of the city's people standing inside the walls is
// violence: the first is a warning shout, a second while it stands (or any
// killing blow) makes the player wanted. Then up to CRIME.maxHostile of the
// watch hunt them, the nearest near watchmen first and then men walking out
// of the barracks door, none further than CRIME.leashTiles beyond the wall.
// The watch takes a wanted player alive (state.mercy, read by damagePlayer):
// the last blow fades the screen and the player wakes in the stocks on the
// square, where the townsfolk gather round and throw turnips (harmless), for
// CRIME.stocksSeconds. No DOM and no game.js import: runtime.js runs tickLaw
// every frame; game.js calls cityViolence for every npc it strikes, arrest
// and seat for the fade, and clearCrime on a wake.
//
//   w.hunt     a watchman after the player: hostile while near (the enemy
//              brain drives him), walking a route to the player while far
//   w.leashed  a hunter who went past the leash: calm until back inside the walls
//   w.gawk     a townsperson come to stand round the stocks: { X, Y, k, sx, there }
//   run.fx.turnips  [{ fromX, fromY, toX, toY, t }]: world tiles, t seconds in
//              flight (city-fx draws them); each lands with a splat at TURNIP_FLIGHT
//   player.stocks   { t, fade, seated }: t mirrors crime.t, fade runs to ARREST_FADE
//
// This is the small first form of the `gawk` scene; the scenes take it over.
import { CRIME, CRIME_LINES, makeCrime, onViolence, tickCrime, spares } from './crime.js'
import { cityFor } from './build.js'
import { fromCity } from './geometry.js'
import { setEntry, reachable, CITY_OX as OX, CITY_OY as OY } from './walkers.js'
import { entryAt } from './schedule.js'
import { PIECE } from '../layout.js'
import { WIN_TILES } from '../window.js'
import { TILE } from '../../systems/entities.js'
import { speakFrom } from '../../systems/feedback.js'
import { FLEE_TIME } from '../../systems/npc.js'

const S = 32
const SCATTER = 6           // tiles from a struck person within which the townsfolk run too
const REINFORCE_EVERY = 1.2 // s between two men out of the barracks door
const HUNT_ROUTE = 3        // s between two routes a far hunter takes towards the player
const GAWKERS = 8           // townsfolk who come to stand round the stocks
const TURNIP_EVERY = 1.1    // s between two turnips
export const TURNIP_FLIGHT = 0.6   // s a turnip is in the air
const REACH = 0.6           // tiles from his spot that count as standing there
const FAR = 255             // the ward field's "further than it counts"
const FIELD_CAP = 32        // tiles out the ward field is counted

// damagePlayer asks this (as state.mercy) whether a blow spares a life.
export const cityMercy = (from, state) => spares(state?.cityRun?.crime, from)

// The stocks' spot (the cell south of the stocks) in world tiles.
export function stocksWorld(world) {
  const s = cityFor(world.seed).spots.stocks
  return fromCity(s.x, s.y)
}

// game.js npcStruck: an npc the player struck (melee, shot, spell, the fire
// they laid, a slam), alive or killed. Violence when it is one of the city's
// people standing inside the walls; the watch's own blows (source 'watch')
// never are. Returns what crime.js decided ('warn' | 'wanted' | null).
export function cityViolence(state, world, e, { killed = false, source = 'player' } = {}) {
  const run = state.cityRun
  if (!run || state.cave || source === 'watch' || e.cityKey === undefined) return null
  if (!state.map?.[e.y]?.[e.x]?.ward) return null
  const r = onViolence(run.crime, { killed })
  scatter(run, e)
  if (r) {
    // the nearest of the watch shouts it; with none about, the struck themselves
    // (a person, alive: a splash's snapshot of the killed still carries its old hp)
    const by = nearest(run, e.px, e.py, 'watchman') ?? (!killed && e.hp > 0 && run.people.has(e.cityKey) ? e : null)
    if (by) speakFrom(state, by, r === 'warn' ? CRIME_LINES.warn : CRIME_LINES.wanted)
    if (r === 'wanted') run.reinforceT = 0
  }
  return r
}

// the townsfolk about a struck person run (the struck one runs by its own onHit)
function scatter(run, e) {
  for (const w of run.people.values()) {
    if (w.mode !== 'near' || w.species !== 'townsfolk' || !(w.entity?.hp > 0)) continue
    const o = w.entity
    if (Math.max(Math.abs(o.px - e.px), Math.abs(o.py - e.py)) > SCATTER * S) continue
    o.ai.fleeTimer = Math.max(o.ai.fleeTimer ?? 0, FLEE_TIME)
    w.shy = null
  }
}

// the near person of that species (any, for null) nearest a pixel position
function nearest(run, px, py, species) {
  let best = null, bestD = Infinity
  for (const w of run.people.values()) {
    if (w.mode !== 'near' || (species && w.species !== species) || !(w.entity?.hp > 0)) continue
    const d = Math.hypot(w.entity.px - px, w.entity.py - py)
    if (d < bestD) { best = w.entity; bestD = d }
  }
  return best
}

// Once per tick of the town (runtime.js tickCity, after the watch picked its
// foes and before people turn near or far).
export function tickLaw(state, world, run, delta) {
  const crime = run.crime, p = state.player
  const ox = world.origin.wx * PIECE, oy = world.origin.wy * PIECE
  const was = crime.level
  if (tickCrime(crime, delta, { inside: !!state.map[p.y]?.[p.x]?.ward }) === 'cleared') {
    if (was === 'wanted') calmAll(run)
    if (was === 'stocks') free(state, run)
  }
  if (crime.level === 'wanted') hunt(state, run, delta, ox, oy)
  if (crime.level === 'stocks' && p.stocks) {
    p.stocks.t = crime.t
    if (p.stocks.seated) gawk(state, run, delta, ox, oy)
  }
  turnips(state, run, delta)
}

// ---- the wanted -----------------------------------------------------------------

// How many tiles each window cell stands beyond the wall (Chebyshev distance
// to the nearest warded cell, 0 inside, FAR past FIELD_CAP). Built once per
// window map and kept on it (a re-centre lays a new map).
function wardField(map) {
  if (map._wardDist) return map._wardDist
  const H = map.length, W = map[0].length
  const d = new Uint8Array(W * H).fill(FAR)
  const q = new Int32Array(W * H)
  let head = 0, tail = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map[y][x]?.ward) { d[y * W + x] = 0; q[tail++] = y * W + x }
  while (head < tail) {
    const i = q[head++], x = i % W, y = (i / W) | 0, n = d[i] + 1
    if (n > FIELD_CAP) continue
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy
      if (X < 0 || Y < 0 || X >= W || Y >= H || d[Y * W + X] !== FAR) continue
      d[Y * W + X] = n; q[tail++] = Y * W + X
    }
  }
  map._wardDist = d
  return d
}

function hunt(state, run, delta, ox, oy) {
  const p = state.player, map = state.map
  const field = wardField(map)
  const beyond = (x, y) => x >= 0 && y >= 0 && x < WIN_TILES && y < WIN_TILES ? field[y * WIN_TILES + x] : FAR
  const reach = beyond(p.x, p.y) <= CRIME.leashTiles
  const wx = w => Math.round(w.X) - ox, wy = w => Math.round(w.Y) - oy
  let n = 0
  for (const w of run.people.values()) {
    if (w.leashed && beyond(wx(w), wy(w)) === 0) w.leashed = false
    if (!w.hunt) continue
    // the player out of reach: every hunter turns back
    if (!reach || w.mode === 'indoors') { calm(run, w); continue }
    if (w.mode === 'near') {
      const e = w.entity
      if (beyond(e.x, e.y) > CRIME.leashTiles) { calm(run, w); w.leashed = true; continue }
      knowWhere(e, p)
    } else if ((w.huntT -= delta) <= 0) {
      w.huntT = HUNT_ROUTE
      aimAt(run, w, p.x + ox, p.y + oy)
    }
    n++
  }
  if (!reach || n >= CRIME.maxHostile) return
  // the nearest near watchmen first
  const idle = []
  for (const w of run.people.values()) {
    if (w.species !== 'watchman' || w.mode !== 'near' || w.hunt || w.leashed || w.out || !(w.entity?.hp > 0)) continue
    if (beyond(w.entity.x, w.entity.y) > CRIME.leashTiles) continue
    idle.push({ w, d: Math.max(Math.abs(w.entity.x - p.x), Math.abs(w.entity.y - p.y)) })
  }
  idle.sort((a, b) => a.d - b.d)
  for (const { w } of idle) {
    if (n >= CRIME.maxHostile) return
    rouse(run, w, p)
    n++
  }
  // then men out of the barracks door, one at a time
  run.reinforceT = (run.reinforceT ?? 0) - delta
  if (run.reinforceT > 0) return
  const label = run.cc.city.doors.find(d => d.kind === 'barracks')?.label
  if (!label) return
  let man = null
  for (const w of run.people.values()) {
    if (w.species === 'watchman' && w.mode === 'indoors' && w.door === label && !w.out && !w.pending && !w.leashed) { man = w; break }
  }
  if (!man) return
  run.reinforceT = REINFORCE_EVERY
  const f = run.cc.front(label)
  man.mode = 'far'; man.door = null; man.X = f.x + OX; man.Y = f.y + OY
  man.hunt = true; man.huntT = HUNT_ROUTE
  aimAt(run, man, p.x + ox, p.y + oy)
}

// A far hunter walks a route to the player's tile, or the nearest a route
// reaches (a player outside the walls is left to the near men).
function aimAt(run, w, X, Y) {
  const cx = X - OX, cy = Y - OY
  let tile = null
  for (let r = 0; r <= 4 && !tile; r++) for (let dy = -r; dy <= r && !tile; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) === r && reachable(run.cc, cx + dx, cy + dy)) { tile = { x: cx + dx, y: cy + dy }; break }
  }
  if (!tile) return
  w.goal = { key: 'hunt', kind: 'spot', tile }
  w.phase = 'wait'; w.path = null; w.loop = false
  if (!w.needRoute) { w.needRoute = true; run.queue.push(w) }
}

function rouse(run, w, p) {
  w.hunt = true; w.huntT = 0; w.shy = null
  if (w.entity) rouseEntity(w.entity, p)
}

// A hunter's entity (also for one spawned near while he hunts): hostile, so
// the enemy brain drives him at the player through attack_hostile. He never
// patrols: the town tells him where the player is.
export function rouseEntity(e, p) {
  e.hostile = true
  e.city.foe = null; e.city.next = null
  e.ai.patrolPoints ??= []
  knowWhere(e, p)
}

function knowWhere(e, p) {
  const ai = e.ai
  if (ai.mode === 'chase') return
  ai.mode = 'hunt'; ai.lastSeen = { x: p.x, y: p.y }; ai.huntWait = 0; ai.giveUp = 0
}

// A hunter let go: peaceful again, and back to the day the schedule has for him now.
function calm(run, w) {
  w.hunt = false
  const e = w.entity
  if (e) {
    e.hostile = false; e.attack = null
    e.ai.mode = 'patrol'; e.ai.lastSeen = null
  }
  if (!w.out && w.mode !== 'indoors') backToDay(run, w)
}

function calmAll(run) {
  for (const w of run.people.values()) {
    if (w.hunt) calm(run, w)
    w.leashed = false
  }
}

function backToDay(run, w) {
  w.goal = null   // whatever the schedule says is somewhere new: routed from where they stand
  setEntry(run.cc, w, entryAt(w.sched, run.frac))
  if (w.needRoute) run.queue.push(w)
  if (w.entity) w.entity.city.entry = w.entry
}

// ---- the stocks -----------------------------------------------------------------

// game.js, when damagePlayer spared the player (state.arrest): the watch has
// them. The record is the stocks', the watch is peaceful, and the player is
// bound while the screen fades (seat puts them in the stocks at its darkest).
export function arrest(state) {
  state.arrest = false
  const run = state.cityRun, p = state.player
  if (!run || p.stocks) return false
  const crime = run.crime
  crime.level = 'stocks'; crime.t = CRIME.stocksSeconds; crime.away = 0
  calmAll(run)
  p.stocks = { t: CRIME.stocksSeconds, fade: 0, seated: false }
  p.charging = null; p.knockback = null
  return true
}

// Put the player in the stocks. False when the square is beyond the window
// (game.js then builds the window round it first).
export function seat(state, world) {
  const p = state.player
  if (!p.stocks || !world.origin) return false
  const { X, Y } = stocksWorld(world)
  const x = X - world.origin.wx * PIECE, y = Y - world.origin.wy * PIECE
  if (x < 0 || y < 0 || x >= WIN_TILES || y >= WIN_TILES) return false
  p.x = x; p.y = y; p.px = x * S + S / 2; p.py = y * S + S / 2
  p.facing = 'south'
  p.stocks.seated = true
  if (state.cityRun) state.cityRun.ring = null
  return true
}

// The minute is up: full hp, the record clean, and a word from the watch.
function free(state, run) {
  const p = state.player
  p.stocks = null
  p.hp = p.maxHp
  release(run)
  const by = nearest(run, p.px, p.py, 'watchman') ?? nearest(run, p.px, p.py, null)
  if (by) speakFrom(state, by, CRIME_LINES.freed)
}

function release(run) {
  for (const w of run.people.values()) {
    if (!w.gawk) continue
    w.gawk = null
    if (!w.out && w.mode !== 'indoors') backToDay(run, w)
  }
  run.fx.turnips.length = 0
  run.ring = null
}

// The cells round the stocks a crowd stands on (2 and 3 tiles out), in world tiles.
function ringRound(map, at, ox, oy) {
  const out = []
  for (const r of [2, 3]) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    if (map[at.Y + dy - oy]?.[at.X + dx - ox]?.tile === TILE.FLOOR) out.push({ X: at.X + dx, Y: at.Y + dy })
  }
  return out
}

// While the player sits in the stocks: up to GAWKERS near townsfolk, the
// nearest first, come and stand round it facing it, and every TURNIP_EVERY
// one who stands there throws a turnip.
function gawk(state, run, delta, ox, oy) {
  const at = stocksWorld({ seed: run.seed })
  run.ring ??= ringRound(state.map, at, ox, oy)
  const taken = new Set(), crowd = []
  for (const w of run.people.values()) {
    if (!w.gawk) continue
    if (w.out || w.mode !== 'near') { w.gawk = null; if (!w.out && w.mode === 'far') backToDay(run, w); continue }
    taken.add(w.gawk.k); crowd.push(w)
  }
  if (crowd.length < GAWKERS && taken.size < run.ring.length) {
    const more = []
    for (const w of run.people.values()) {
      if (w.mode !== 'near' || w.species !== 'townsfolk' || w.gawk || w.out || !(w.entity?.hp > 0)) continue
      more.push({ w, d: Math.max(Math.abs(w.X - at.X), Math.abs(w.Y - at.Y)) })
    }
    more.sort((a, b) => a.d - b.d)
    for (const { w } of more) {
      if (crowd.length >= GAWKERS) break
      let k = 0
      while (taken.has(k)) k++
      if (k >= run.ring.length) break
      taken.add(k)
      w.gawk = { X: run.ring[k].X, Y: run.ring[k].Y, k, sx: at.X, there: false }
      w.shy = null
      crowd.push(w)
    }
  }
  run.turnipT = (run.turnipT ?? TURNIP_EVERY) - delta
  if (run.turnipT > 0) return
  const ready = crowd.filter(w => w.gawk.there)
  if (!ready.length) return
  run.turnipT = TURNIP_EVERY
  const w = ready[(run.thrown = (run.thrown ?? 0) + 1) % ready.length]
  run.fx.turnips.push({ fromX: w.X, fromY: w.Y, toX: at.X, toY: at.Y, t: 0 })
}

function turnips(state, run, delta) {
  const list = run.fx.turnips
  for (let i = list.length - 1; i >= 0; i--) {
    if ((list[i].t += delta) < TURNIP_FLIGHT) continue
    list.splice(i, 1)
    run.hooks.sfx?.('splat', { px: state.player.px, py: state.player.py })
  }
}

// runtime.js near(): a gawker walks to their spot and, once there, faces the stocks.
export function stepGawker(w, e, ox, oy) {
  const g = w.gawk
  const c = e.city
  if (c.next) { c.next.x = g.X - ox; c.next.y = g.Y - oy } else c.next = { x: g.X - ox, y: g.Y - oy }
  if (!g.there && Math.hypot(g.X - w.X, g.Y - w.Y) < REACH) g.there = true
  if (g.there) e.facing = g.sx < w.X ? 'west' : 'east'
}

// ---- in and out of the window, death and load -------------------------------------

// The town left the window (walked off): a standing warning or the wanted goes
// along, and the clock counts on while it is away.
export function carryCrime(state, now) {
  const c = state.cityRun?.crime
  if (c && (c.level === 'warned' || c.level === 'wanted')) state.cityAway = { crime: c, at: now }
}

// ... and comes back with the town (runtime.js, building it anew on a walk).
export function bringCrime(state, run, now) {
  const a = state.cityAway
  delete state.cityAway
  if (!a) return
  if (tickCrime(a.crime, Math.max(0, now - a.at), { inside: false }) !== 'cleared') run.crime = a.crime
}

// A wake after death or a load: no warning, no wanted, no stocks.
export function clearCrime(state) {
  state.arrest = false
  delete state.cityAway
  if (state.player) state.player.stocks = null
  const run = state.cityRun
  if (!run) return
  run.crime = makeCrime()
  calmAll(run)
  release(run)
}
