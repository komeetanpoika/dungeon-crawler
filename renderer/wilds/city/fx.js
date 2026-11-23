// Kalevanlinna's light and small life, as data for the screen: the lamps and
// the lit windows (light sources for the night wash: systems/weather.js
// lightSources reads run.lights.sources), the lamp and washing-line tiles,
// the chimney smoke, the sparks and steam at the smithy, the turnip splats,
// and the birds of the flocks as sprites. render/city-fx.js draws it all and
// is the only drawing code; this module has no DOM and changes nothing but
// the run's fx and lights and the window cells' overlays.
//
// Once a frame on the street (runtime.js tickCity, after the scenes) and on
// every arrival, tickCityFx:
//   - lays the lamp tiles as run.lights says (the lamplighter's round, or the
//     clock in its order: scenes.js) and the washing lines as run.fx.washing
//     says, a tile swapped and marked for the baked layer to draw again
//     (markTileDirty); takes the banners, pennants and windmill sails off the
//     baked layer once (their overlay cleared), for the screen draws them a
//     frame at a time (fxThingsOf(city).anim, with the gate towers' pennants)
//   - lists the light sources out to LIGHT_SLACK tiles round the screen (as
//     far as the night wash's kept mask may reach; run.lights.sources, window
//     pixels): lit lamps (LAMP_R), the windows of houses someone is home in at
//     night (WINDOW_R, one light to a run of up to three windows of a house,
//     the runs on screen in run.lights.windows), the forge while the smith works
//   - lets out smoke from the chimneys on screen of houses someone is home in,
//     no more than a puff a chimney every PUFF_EVERY, and drops the smoke of a
//     chimney that leaves the screen; sparks off the anvil at each of the
//     smith's blows on screen, steam while he quenches; ages the turnip splats;
//     notes the time of the crier's last ring (fx.ringAt)
//
// What the run carries for it (beside scenes.js's fx, all positions in world
// tiles, whole numbers at a tile's middle, as the walkers'):
//   run.ox, run.oy   the window's origin (world tiles) at the last look
//   run.fx.t         town time, seconds (stops indoors and in the pause)
//   run.fx.smoke     [{ c (city.chimneys index), X, Y (where it left the chimney), t, dx (drift, tiles/s) }]
//   run.fx.steam     [{ X, Y, t, dx }]
//   run.fx.sparks    [{ X, Y, vx, vy, t }] (moving: X, Y where it is now)
//   run.fx.splats    [{ X, Y, t }] (scene-things.js stepTurnips lays them)
//   run.fx.ringAt    town time of the crier's last ring
//   run.lights.sources  [{ px, py, r, strength, grey, glow }] the city's lights round the screen
//   run.lights.windows  [WindowRun] the lit window runs on screen
//
// flockSprites(run, view) is the birds of the flocks on screen as sprites;
// the view is { X0, Y0, X1, Y1 } in world tiles.
import { hash } from '../rand.js'
import { DAY } from './schedule.js'
import { PROPS, CASTLE, FX } from './kit.js'
import { CITY_OX as OX, CITY_OY as OY } from './walkers.js'
import { LIFT_TIME, CIRCLE_TIME } from './scene-things.js'
import { PLAN, towerRect } from './plan.js'
import { markTileDirty } from '../../systems/tile-dirty.js'
import { TILE } from '../../systems/entities.js'
import { PLAYER_HALF } from '../../systems/movement.js'

const S = 32
export const LAMP_R = 3, WINDOW_R = 1.5, FORGE_R = 2.5
const LAMP_STRENGTH = 1, WINDOW_STRENGTH = 0.7, FORGE_STRENGTH = 0.85
// the warm glow drawn over the night round a light (render/weather.js), in
// tiles: a lamp's small (the software canvas pays for every pixel of it), a
// window none (render/city-fx.js lights its panes instead)
const LAMP_GLOW = 1.1, WINDOW_GLOW = 0
const LANTERN = { x: 20, y: 10 }   // px in a lamp's cell (at S 32): where the light hangs
export const PUFF_EVERY = 0.6      // s: the least between two puffs of a chimney
export const PUFF_LIFE = 2.4       // s a puff of smoke is seen
export const PUFF_RISE = 0.45      // tiles a second
export const WIND = 0.16           // tiles a second, to the east
const CHIMNEY_TOP = 0.4            // tiles above a chimney cell's middle the smoke leaves it
export const STEAM_LIFE = 1.4, STEAM_RISE = 0.8
const STEAM_EVERY = 0.14
export const SPARK_LIFE = 0.45
const SPARKS = 5, SPARK_FALL = 7   // sparks a blow; tiles/s² they fall back at
export const SPLAT_LIFE = 0.6
const WINDOW_RUN = 3               // windows of a house's row to one light
// windows are lit from dusk until a little after dawn
const windowsLit = frac => frac >= DAY.dusk || frac < DAY.dawn + 0.04
export const FLOCK_R = 3           // tiles round a flock its birds may be drawn
const VIEW_SLACK = 1               // tiles round the screen counted as on it
// The night wash (render/weather.js) keeps a mask of the view and NIGHT_PAD
// (160 px, 5 tiles) round it, built anew when a light it holds comes, goes
// or changes; the view may wander the pad either way before it leaves that
// mask, so a light the mask holds can lie twice the pad off screen. The
// lights are listed that far out (plus their own reach): walking then never
// lists or drops one inside a kept mask, which would rebuild it every few
// steps (the screen's own things, panes and smoke, keep to VIEW_SLACK).
const NIGHT_PAD_TILES = 5
export const LIGHT_SLACK = VIEW_SLACK + 2 * NIGHT_PAD_TILES

const LAMP_NAMES = new Set([PROPS.lamp, PROPS.lampLit])
const LINE_NAMES = [new Set([PROPS.washing[0], PROPS.line[0]]), new Set([PROPS.washing[1], PROPS.line[1]])]

// What the screen needs of a city, found once: the cells drawn a frame at a
// time (banners and pennants, two frames; the windmill's sails, four), the
// windows in runs, the chimneys, in world tiles.
//   anim  [{ X, Y, kind: 'banner'|'pennant'|'sails', frames, k (the frame laid there) }]
//   runs  [{ door, Y, X0, X1, cells: X[] }] up to WINDOW_RUN windows side by side of one house
const fxCache = new WeakMap()
export function fxThingsOf(city) {
  let t = fxCache.get(city)
  if (t) return t
  const frameOf = new Map()
  CASTLE.banner.forEach((n, k) => frameOf.set(n, { kind: 'banner', frames: CASTLE.banner, k }))
  CASTLE.pennant.forEach((n, k) => frameOf.set(n, { kind: 'pennant', frames: CASTLE.pennant, k }))
  const sails = PROPS.windmill.sails
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const frames = sails.map(f => f[j][i])
    frames.forEach((n, k) => frameOf.set(n, { kind: 'sails', frames, k }))
  }
  const anim = []
  const N = city.cells.length
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const f = frameOf.get(city.cells[y][x].overlay)
    if (f) anim.push({ X: x + OX, Y: y + OY, ...f })
  }
  // the towers either side of each land gate fly the town's pennant too, on
  // the cap's top middle cell where the finial is (as the keep's towers do);
  // not laid in the city's cells, so the masonry under the cap stays whole
  for (const g of Object.values(PLAN.gates)) for (const t of PLAN.towers) {
    if (!(g.dir === 'N' ? t.y === g.y && Math.abs(t.x - g.x) === 3 : t.x === g.x && Math.abs(t.y - g.y) === 3)) continue
    anim.push({ X: t.x + OX, Y: towerRect(t).y0 + OY, kind: 'pennant', frames: CASTLE.pennant, k: t.x + t.y < g.x + g.y ? 0 : 1 })
  }
  const wins = city.windows.slice().sort((a, b) => (a.door < b.door ? -1 : a.door > b.door ? 1 : 0) || a.y - b.y || a.x - b.x)
  const runs = []
  let r = null
  for (const w of wins) {
    if (r && r.door === w.door && r.Y === w.y + OY && r.X1 === w.x + OX - 1 && r.cells.length < WINDOW_RUN) { r.X1++; r.cells.push(w.x + OX); continue }
    runs.push(r = { door: w.door, Y: w.y + OY, X0: w.x + OX, X1: w.x + OX, cells: [w.x + OX] })
  }
  const chimneys = city.chimneys.map(c => ({ X: c.x + OX, Y: c.y + OY, door: c.door }))
  t = { anim, runs, chimneys }
  fxCache.set(city, t)
  return t
}

// What runtime.js adds to a new run, beside scenes.js's makeStage.
export function makeFx(run) {
  const city = run.cc.city
  Object.assign(run.fx, {
    t: 0, smoke: [], steam: [], sparks: [], splats: [], ringAt: -Infinity, steamAt: 0,
    puffAt: new Float64Array(city.chimneys.length), smoking: new Uint8Array(city.chimneys.length),
    seen: { smithy: null, blows: 0, crier: null, rings: 0 },
  })
  run.lights.sources = []
  run.lights.windows = []
  run.lights.pool = []
  run.fxHome = new Set()
  run.ox = 0; run.oy = 0
}

const inView = (v, X, Y, m = 0) => X >= v.X0 - m && X <= v.X1 + m && Y >= v.Y0 - m && Y <= v.Y1 + m

// The screen round the player, in world tiles.
function viewOf(state, run, ox, oy) {
  const half = run.hooks.viewHalf()
  const PX = state.player.px / S - 0.5 + ox, PY = state.player.py / S - 0.5 + oy
  const w = half.w + VIEW_SLACK, h = half.h + VIEW_SLACK
  const v = run.fxView ??= { X0: 0, Y0: 0, X1: 0, Y1: 0 }
  v.X0 = PX - w; v.X1 = PX + w; v.Y0 = PY - h; v.Y1 = PY + h
  return v
}

// The tiles: lamps lit or not, washing out or in, the moving things off the bake.
export function syncCityTiles(state, run, ox, oy) {
  const map = state.map
  if (!map || state.cave) return
  const city = run.cc.city, lit = run.lights.lit
  const swap = (x, y, want, names) => {
    const cell = map[y]?.[x]
    if (!cell || cell.overlay === want || !names.has(cell.overlay)) return
    cell.overlay = want
    markTileDirty(map, x, y)
  }
  for (let i = 0; i < city.lamps.length; i++) {
    const l = city.lamps[i]
    swap(l.x + OX - ox, l.y + OY - oy, lit[i] ? PROPS.lampLit : PROPS.lamp, LAMP_NAMES)
  }
  for (const line of run.fx.washing) {
    const names = line.state === 'out' ? PROPS.washing : PROPS.line
    for (let k = 0; k < 2; k++) swap(line.X + k - ox, line.Y - oy, names[k], LINE_NAMES[k])
  }
  for (const a of fxThingsOf(city).anim) {
    const x = a.X - ox, y = a.Y - oy, cell = map[y]?.[x]
    if (!cell || !cell.overlay || !a.frames.includes(cell.overlay)) continue
    cell.overlay = null
    markTileDirty(map, x, y)
  }
  syncGate(state, run, ox, oy)
}

// ---- the castle gate --------------------------------------------------------------
// Three cells wide in the castle wall's row and the row below it, round
// PLAN.places.castleGate (the middle of the lower row); the city's cells lay
// it open (build-fixed.js layCastle). From nightfall to dawn the portcullis
// is down: CASTLE.gate2 art, not walkable, for the player, the near townsfolk
// (they walk by collision) and monsters alike (the ward stays on the cells).
// Far walkers pass along their routes without collision as ever.
const CG = PLAN.places.castleGate
const GATE_CELLS = [0, 1].flatMap(j => [0, 1, 2].map(i => ({ x: CG.x - 1 + i, y: CG.y - 1 + j, i, j })))
const GATE_DOWN = new Set(CASTLE.gate2.flat())
const GATE_HOLD = 4                 // tiles from the gate within which the watch raises it for the Count coming home
export const GATE_SHUT_LINE = 'The gate is shut for the night.'

const inCastle = c => { const p = PLAN.places.castle; return c.x >= p.x0 && c.x <= p.x1 && c.y >= p.y0 && c.y <= p.y1 }

// Is the castle gate down at `frac` of the day? Only at night, and never
// while the player is inside the castle's plot or in the gateway (city
// tiles; null: not in the city), so nobody is shut in.
export function gateShut(frac, playerCity) {
  const night = !(frac >= DAY.dawn && frac < DAY.night)
  return night && !(playerCity && inCastle(playerCity))
}

// a cell carrying the gate's portcullis down (game.js: walking into it says GATE_SHUT_LINE)
export const isShutGate = cell => !!cell && GATE_DOWN.has(cell.overlay)

// someone standing under the portcullis: the player or a living thing with
// any part of it over a gate cell (positions in window pixels; dx, dy take a
// city tile to its window tile)
function underGate(state, dx, dy) {
  const over = (px, py, half) => GATE_CELLS.some(c => {
    const x = (c.x + dx) * S, y = (c.y + dy) * S
    return px + half > x && px - half < x + S && py + half > y && py - half < y + S
  })
  const p = state.player
  if (over(p.px, p.py, PLAYER_HALF)) return true
  return state.entities.some(e => e.hp > 0 && over(e.px, e.py, e.aiHalf ?? 4))
}

// The keep's door (the castle building's), found once per city.
const keepDoor = new WeakMap()
const keepDoorOf = city => {
  if (!keepDoor.has(city)) keepDoor.set(city, city.doors.find(d => d.building === 'castle')?.label ?? null)
  return keepDoor.get(city)
}

// The Count on his way home through the gate at night, near (an entity, who
// walks by collision) and close to it or already in the courtyard: the watch
// raises the portcullis for him. A far Count needs no gate.
function countComing(run, dx, dy) {
  const door = keepDoorOf(run.cc.city)
  if (!door) return false
  for (const w of run.people.values()) {
    if (w.mode !== 'near' || w.out || !w.entity || w.goal?.kind !== 'door' || w.goal.door !== door) continue
    const at = { x: w.entity.x - dx, y: w.entity.y - dy }
    if (inCastle(at) || GATE_CELLS.some(c => Math.max(Math.abs(c.x - at.x), Math.abs(c.y - at.y)) <= GATE_HOLD)) return true
  }
  return false
}

// The gate as the clock says, laid only when that changes, and never let
// down onto anyone (it waits a frame and asks again).
function syncGate(state, run, ox, oy) {
  const map = state.map, dx = OX - ox, dy = OY - oy
  const cellAt = c => map[c.y + dy]?.[c.x + dx]
  if (!GATE_CELLS.every(cellAt)) return   // not in the window
  const p = state.player
  const down = gateShut(run.frac, { x: p.x - dx, y: p.y - dy }) && !countComing(run, dx, dy)
  const art = down ? CASTLE.gate2 : CASTLE.gate2Open
  if (GATE_CELLS.every(c => cellAt(c).overlay === art[c.j][c.i])) return
  if (down && underGate(state, dx, dy)) return
  for (const c of GATE_CELLS) {
    const cell = cellAt(c)
    cell.overlay = art[c.j][c.i]
    cell.tile = down ? TILE.WALL : TILE.FLOOR
    markTileDirty(map, c.x + dx, c.y + dy)
  }
  // the way changed: the nav grids cached on the map are stale (systems/nav.js)
  delete map._nav
  delete map._navWard
}

// Who is home: the doors someone is inside of (not those struck down).
function homes(run) {
  const set = run.fxHome
  set.clear()
  for (const w of run.people.values()) if (w.mode === 'indoors' && !w.out && w.door) set.add(w.door)
  return set
}

// a light source, from the run's pool (window pixels)
function light(run, n, px, py, r, strength, glow) {
  const { pool, sources } = run.lights
  const o = pool[n] ??= { px: 0, py: 0, r: 0, strength: 0, grey: false, glow: undefined }
  o.px = px; o.py = py; o.r = r; o.strength = strength; o.glow = glow
  sources[n] = o
  return n + 1
}

// The lights out to LIGHT_SLACK round the screen (v reaches VIEW_SLACK past
// it), and the lit window runs on the screen itself (their panes are drawn).
function lights(run, v, home, ox, oy) {
  const city = run.cc.city, lit = run.lights.lit, things = fxThingsOf(city)
  const far = LIGHT_SLACK - VIEW_SLACK
  let n = 0
  for (let i = 0; i < city.lamps.length; i++) {
    if (!lit[i]) continue
    const X = city.lamps[i].x + OX, Y = city.lamps[i].y + OY
    if (!inView(v, X, Y, far + LAMP_R)) continue
    n = light(run, n, (X - ox) * S + LANTERN.x, (Y - oy) * S + LANTERN.y, LAMP_R, LAMP_STRENGTH, LAMP_GLOW)
  }
  const wins = run.lights.windows
  wins.length = 0
  if (windowsLit(run.frac)) {
    for (const r of things.runs) {
      const X = (r.X0 + r.X1) / 2
      if (!home.has(r.door) || !inView(v, X, r.Y, far + WINDOW_R)) continue
      if (inView(v, X, r.Y, WINDOW_R)) wins.push(r)
      n = light(run, n, (X - ox) * S + S / 2, (r.Y - oy) * S + S / 2, WINDOW_R, WINDOW_STRENGTH, WINDOW_GLOW)
    }
  }
  const sm = run.fx.smithy
  if (sm && sm.state !== 'idle' && inView(v, sm.forge.X, sm.forge.Y, far + FORGE_R)) {
    n = light(run, n, (sm.forge.X - ox) * S + S / 2, (sm.forge.Y - oy) * S + S / 2, FORGE_R, FORGE_STRENGTH)
  }
  run.lights.sources.length = n
}

// Smoke from the chimneys on screen of houses someone is home in. A chimney
// that comes on screen already smoking shows the puffs it let out before, at
// the same pace; one that leaves the screen takes its smoke with it. When the
// last one leaves the house the smoke already up drifts off.
function smoke(run, v, home, dt) {
  const fx = run.fx, { chimneys } = fxThingsOf(run.cc.city)
  let left = false
  for (let i = 0; i < chimneys.length; i++) {
    const on = inView(v, chimneys[i].X, chimneys[i].Y)
    if (on === !!fx.smoking[i]) continue
    fx.smoking[i] = on ? 1 : 0
    if (on) fx.puffAt[i] = -1   // just come on screen
    else left = true
  }
  let n = 0
  for (const p of fx.smoke) {
    p.t += dt
    if (p.t >= PUFF_LIFE - 1e-9 || (left && !fx.smoking[p.c])) continue
    fx.smoke[n++] = p
  }
  fx.smoke.length = n
  for (let i = 0; i < chimneys.length; i++) {
    if (!fx.smoking[i]) continue
    const c = chimneys[i], fresh = fx.puffAt[i] < 0
    if (fresh) fx.puffAt[i] = fx.t
    if (!home.has(c.door)) continue
    if (fresh) for (let k = Math.floor(PUFF_LIFE / PUFF_EVERY) - 1; k >= 1; k--) fx.smoke.push(puff(run, i, c, k * PUFF_EVERY))
    if (fx.t + 1e-9 < fx.puffAt[i]) continue
    fx.smoke.push(puff(run, i, c, 0))
    fx.puffAt[i] = fx.t + PUFF_EVERY * (1 + 0.5 * hash(run.seed, i, Math.floor(fx.t * 10), 1701))
  }
}
const puff = (run, i, c, t) => ({ c: i, X: c.X, Y: c.Y - CHIMNEY_TOP, t, dx: WIND * (0.6 + 0.8 * hash(run.seed, i, Math.floor((run.fx.t - t) * 10), 1702)) })

// The smithy: sparks off the anvil (the cell east of where the smith stands)
// at each blow, steam while the hot iron is quenched; only on screen.
function smithy(run, v, dt) {
  const fx = run.fx, sm = fx.smithy, seen = fx.seen
  if (sm !== seen.smithy) { seen.smithy = sm; seen.blows = sm?.blows ?? 0 }
  const on = sm && inView(v, sm.X + 1, sm.Y)
  if (sm && sm.blows !== seen.blows) {
    seen.blows = sm.blows
    if (on) for (let k = 0; k < SPARKS; k++) {
      const h = (s) => hash(run.seed, sm.blows, k, s)
      fx.sparks.push({ X: sm.X + 1 + (h(1711) - 0.5) * 0.3, Y: sm.Y - 0.3, vx: (h(1712) - 0.5) * 3.2, vy: -(1.4 + 1.8 * h(1713)), t: 0 })
    }
  }
  if (on && sm.state === 'quenching' && fx.t >= fx.steamAt) {
    fx.steamAt = fx.t + STEAM_EVERY
    const h = hash(run.seed, Math.floor(fx.t * 10), 0, 1714)
    fx.steam.push({ X: sm.X + 1 + (h - 0.5) * 0.4, Y: sm.Y - 0.3, t: 0, dx: (h - 0.3) * 0.5 })
  }
  let n = 0
  for (const s of fx.sparks) {
    s.t += dt; s.X += s.vx * dt; s.Y += s.vy * dt; s.vy += SPARK_FALL * dt
    if (s.t < SPARK_LIFE) fx.sparks[n++] = s
  }
  fx.sparks.length = n
  n = 0
  for (const s of fx.steam) if ((s.t += dt) < STEAM_LIFE) fx.steam[n++] = s
  fx.steam.length = n
}

// Once a frame (runtime.js tickCity, after the scenes; dt 0 on an arrival).
export function tickCityFx(state, run, dt, ox, oy) {
  // indoors (a cave state carries the surface's run along, on the house's own
  // map): nothing of the street, and no cell of the house touched
  if (state.cave) return
  const fx = run.fx
  fx.t += dt
  run.ox = ox; run.oy = oy
  syncCityTiles(state, run, ox, oy)
  const v = viewOf(state, run, ox, oy)
  const home = homes(run)
  lights(run, v, home, ox, oy)
  smoke(run, v, home, dt)
  smithy(run, v, dt)
  const cr = fx.crier, seen = fx.seen
  if (cr !== seen.crier) { seen.crier = cr; seen.rings = cr?.rings ?? 0 }
  if (cr && cr.rings !== seen.rings) { seen.rings = cr.rings; fx.ringAt = fx.t }
  let n = 0
  for (const s of fx.splats) if ((s.t += dt) < SPLAT_LIFE) fx.splats[n++] = s
  fx.splats.length = n
}

// ---- the birds ------------------------------------------------------------------

const BIRD_ALT = 0.9          // tiles up a flock is when it has lifted
const CIRCLE_R = 2.2          // tiles round its middle a flock wheels
const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k) }
const NAMES = {
  pigeon: { perched: 'tf_pigeon_a', stretch: 'tf_pigeon_b', fly: FX.pigeonFly, flap: 0.09, spread: [3.2, 2] },
  gull: { perched: 'tf_gull_a', stretch: 'tf_gull_b', fly: FX.gullFly, flap: 0.16, spread: [4, 2] },
}

// The birds of the flocks on screen (the view in world tiles), as sprites:
// { X, Y: the spot on the ground under it (world tiles, whole at a tile's
// middle), alt: tiles up, name: its sprite, flip: facing west }. Settled they
// stand about the flock's spot and peck; lifting they rise and scatter;
// circling they wheel round the flock's middle as it moves (stepFlocks) and
// come down where they will stand. Pure in the run's flocks, its seed and
// fx.t. `out` is filled and returned (a list kept by the caller saves one a frame).
export function flockSprites(run, v, out = []) {
  out.length = 0
  const t = run.fx.t ?? 0
  const flocks = run.fx.flocks
  for (let fi = 0; fi < flocks.length; fi++) {
    const f = flocks[fi]
    if (!inView(v, f.X, f.Y, FLOCK_R)) continue
    const kind = NAMES[f.kind] ?? NAMES.pigeon
    for (let b = 0; b < f.birds; b++) out.push(bird(run.seed, fi, b, f, kind, t))
  }
  return out
}

function bird(seed, fi, b, f, kind, t) {
  const h = s => hash(seed, fi, b, s)
  const gx = (h(1721) - 0.5) * kind.spread[0], gy = (h(1722) - 0.5) * kind.spread[1]
  const o = { X: f.X + gx, Y: f.Y + gy, alt: 0, name: kind.perched, flip: h(1723) < 0.5 }
  const flap = kind.fly[(Math.floor(t / kind.flap) + b) & 1]
  if (f.state === 'settled') {
    const beat = (t * (0.35 + 0.3 * h(1724)) + h(1725)) % 1
    if (beat < 0.1) o.alt = -0.04                      // a peck
    else if (beat > 0.93) o.name = kind.stretch        // wings up a moment
    if (((t * 0.08 + h(1726)) % 1) < 0.5) o.flip = !o.flip   // turns about now and then
    return o
  }
  if (f.state === 'lifting') {
    const k = 1 - Math.max(0, f.t) / LIFT_TIME
    o.X = f.X + gx * (1 + 0.5 * k); o.Y = f.Y + gy * (1 + 0.5 * k)
    o.alt = BIRD_ALT * k
    o.name = flap; o.flip = gx < 0
    return o
  }
  // circling: from where it lifted to where it will stand, wheeling between
  const k = 1 - Math.max(0, f.t) / CIRCLE_TIME
  const dir = h(1727) < 0.5 ? 1 : -1
  const th = dir * t * 2.6 + (b / f.birds) * Math.PI * 2
  const r = CIRCLE_R * (0.8 + 0.4 * h(1728))
  const cx = Math.cos(th) * r, cy = Math.sin(th) * r * 0.6
  const a = smooth(0, 0.2, k) * (1 - smooth(0.75, 1, k))
  const lx = gx * (1.5 - 0.5 * k), ly = gy * (1.5 - 0.5 * k)
  o.X = f.X + lx + (cx - lx) * a; o.Y = f.Y + ly + (cy - ly) * a
  o.alt = BIRD_ALT * (1 - k) + 1.1 * Math.sin(Math.PI * k)
  o.name = k > 0.97 ? kind.perched : flap
  o.flip = a > 0.5 ? (-Math.sin(th) * dir < 0) : gx < 0
  return o
}
