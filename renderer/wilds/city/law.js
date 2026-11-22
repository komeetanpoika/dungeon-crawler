// Kalevanlinna's law at work (the rules and numbers are crime.js's). A blow
// from the player on one of the city's people standing inside the walls is
// violence: the first is a warning shout, a second while it stands (or any
// killing blow) makes the player wanted. Then up to CRIME.maxHostile of the
// watch hunt them, the nearest near watchmen first and then men walking out
// of the barracks door, none further than CRIME.leashTiles beyond the wall.
// The watch takes a wanted player alive (state.mercy, read by damagePlayer):
// the last blow fades the screen and the player wakes in the stocks on the
// square for CRIME.stocksSeconds, where the townsfolk gather round and throw
// turnips (the `gawk` scene, scenes.js: it runs while player.stocks.seated).
// No DOM and no game.js import: runtime.js runs tickLaw every frame; game.js
// calls cityViolence for every npc it strikes, arrest and toStocks for the
// fade, and clearCrime on a wake.
//
//   w.hunt     a watchman after the player: hostile while near (the enemy
//              brain drives him), walking a route to the player while far
//   w.leashed  a hunter who went past the leash: calm until back inside the walls
//   player.stocks   { t, fade, seated }: t mirrors crime.t, fade runs to ARREST_FADE
import { CRIME, CRIME_LINES, makeCrime, onViolence, tickCrime, spares } from './crime.js'
import { cityFor } from './build.js'
import { fromCity } from './geometry.js'
import { reachable, CITY_OX as OX, CITY_OY as OY } from './walkers.js'
import { backToDay, endScenes } from './scenes.js'
import { PIECE } from '../layout.js'
import { WIN_TILES } from '../window.js'
import { speakFrom } from '../../systems/feedback.js'
import { FLEE_TIME } from '../../systems/npc.js'

export { TURNIP_FLIGHT } from './scenes.js'

const S = 32
const SCATTER = 6           // tiles from a struck person within which the townsfolk run too
const REINFORCE_EVERY = 1.2 // s between two men out of the barracks door
const HUNT_ROUTE = 3        // s between two routes a far hunter takes towards the player
const FAR = 255             // beyondWall's "further than the leash"

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
  if (crime.level === 'stocks' && p.stocks) p.stocks.t = crime.t
}

// ---- the wanted -----------------------------------------------------------------

// How many tiles a window cell stands beyond the wall: 0 on a warded cell,
// else the Chebyshev distance to the nearest warded one, found ring by ring;
// FAR past the leash (nothing further is ever asked). A handful of asks a
// frame while wanted, most answered by the cell itself (a field over the
// whole window cost 3-6 ms to build on every new window).
function beyondWall(map, x, y) {
  if (map[y]?.[x]?.ward) return 0
  for (let r = 1; r <= CRIME.leashTiles + 1; r++) {
    for (let d = -r; d <= r; d++) {
      if (map[y - r]?.[x + d]?.ward || map[y + r]?.[x + d]?.ward || map[y + d]?.[x - r]?.ward || map[y + d]?.[x + r]?.ward) return r
    }
  }
  return FAR
}

function hunt(state, run, delta, ox, oy) {
  const p = state.player, map = state.map
  const beyond = (x, y) => beyondWall(map, x, y)
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
  return true
}

// The arrest's darkest moment: into the stocks. Taken where the square is
// beyond the window (just outside the west gate, the window still round the
// land west of the city), `rebuild(at)` builds the window anew round world
// tile `at` first (game.js: enterWilds, the tales and the town, fresh), and
// the record goes along to the new town.
export function toStocks(state, world, rebuild) {
  if (seat(state, world)) return true
  const crime = state.cityRun?.crime
  if (!crime || !state.player.stocks) return false
  rebuild(stocksWorld(world))
  if (!state.cityRun) return false
  state.cityRun.crime = crime
  return seat(state, world)
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

// the crowd round the stocks goes back about its day, the turnips with it
function release(run) {
  endScenes(run, 'gawk')
  run.fx.turnips.length = 0
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
