// A live check of the desert in the real game (wilds/desert.js sight over
// the dunes, wilds/storm.js the sandstorm, wilds/heat.js the day's heat, and
// game.js where they meet the frame, the stamina and the map): Electron on
// this display with a throwaway profile and a fresh Wilds save (seed 7) that
// starts on a road in the deep desert. Walking is real key presses (a key held
// until the step is made, never less than about 120 ms); the debug hooks
// (--dcdebug) only set the scene: the clock (held), a stormy day, where the
// hero stands before a check, foes taken away so none stands in the way, the
// stamina emptied before a regain is timed, and what is read back.
//
// The places are worked out here from the seed (the pieces the game will
// hold, with the tale places it admits on entering), then each is checked
// against the live map before it is used:
//   close    from the road, a few steps off it into the dunes: the count of
//            cells the hero sees falls
//   open     one step up onto a crest: the count rises again
//   spire    a landmark seen beyond the sight radius (and within BEACON_RANGE)
//   heat     noon on open sand: stamina comes back at half rate; one step into
//            a palm's shade, at full rate
//   night    the same sand at night: full rate
//   house    noon: half rate at the door of a house in the open desert, full
//            inside it, half again on stepping back out
//   drink    noon: half rate on open sand, a walk to a well, a moment beside
//            it (the `drink` cue is queued), and back on the same sand the heat
//            is off
//   storm    a stormy day's peak: the storm at full strength, the haze drawn
//            over the frame, a sight of 4 with the cells lit a tile further
//            (wilds/storm.js LIT_PAD), the `storm-wind` cue queued, the minimap
//            all haze (the haze's colour within 6), and the map opened with
//            "Find me" greyed (no hero to find)
//   road     walking a straight stretch of road through the storm: every frame
//            the hero is on the road, the road cells inside his lit radius are
//            seen, the way on among them, and every cell reaching into the
//            haze's clear patch lies inside that radius, on every side
//   errors   no page errors (a tile picture that failed over file:// and was
//            loaded again is noise, counted apart)
//
// Sounds cannot be heard here: the cues are read off the game's queue
// (systems/sfx.js) before the audio engine drains it.
//
// Screenshots (desert-*.png) in the directory given. One line per check;
// exits non-zero if anything is wrong. About two minutes.
//
//   node tools/wilds/desert-check.mjs [shots-dir] [--seed 7] [--at X,Y] [--frac 0.28]
//   node tools/wilds/desert-check.mjs --save-out <file> [--seed 7] [--at X,Y] [--frac 0.28]
//
// --at X,Y: the world tile the hero starts on (else a road tile of piece
// 10,0 the checks can work from). --save-out writes the save that would be
// used (the string that goes into localStorage['dungeon-crawler-wilds'] on
// the web build) and exits without starting the game.
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sleep, citySave, driver, launchGame, enterWilds, noDamage } from '../city/live.mjs'
import { makeWorld, getPiece } from '../../renderer/wilds/world.js'
import { PIECE, pieceOf, villageAt } from '../../renderer/wilds/layout.js'
import { landOf } from '../../renderer/wilds/session.js'
import { admit } from '../../renderer/wilds/tales.js'
import { admitSampo } from '../../renderer/wilds/city/sampo-places.js'
import { isDesert, heroSight, SIGHT, BEACON_RANGE } from '../../renderer/wilds/desert.js'
import { nearCity } from '../../renderer/wilds/desert-art.js'
import { stormOfDay, STORM, LIT_PAD } from '../../renderer/wilds/storm.js'
import { HEAT, nearCool } from '../../renderer/wilds/heat.js'
import { HAZE } from '../../renderer/render/weather.js'
import { onRoad } from '../../renderer/wilds/coach-path.js'
import { isWaterSkin } from '../../renderer/terrain/lib.js'
import { computePlayerFOV, TILE } from '../../renderer/systems/entities.js'
import { DAY_LENGTH } from '../../renderer/data/weather.js'

const argv = process.argv.slice(2)
const flag = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const SEED = Number(flag('--seed') ?? 7)
const FRAC = Number(flag('--frac') ?? 0.28)
const AT = flag('--at')?.split(',').map(Number) ?? null
const SAVE_OUT = flag('--save-out')
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
const SHOTS = path.resolve(positional[0] ?? path.join(os.tmpdir(), 'dc-desert-check'))
const PROFILE = path.join(path.dirname(SHOTS), 'dc-desert-check-profile')
const NOON = 0.5 * DAY_LENGTH, NIGHT = 0.9 * DAY_LENGTH
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const same = (a, b) => !!a && !!b && a.X === b.X && a.Y === b.Y
const at = s => `${s?.X},${s?.Y}`

// ---- the world as the game will hold it (pure in the seed) -------------------------------
// A world entered at world tile (X, Y): the tale and Sampo places the game
// admits as it builds its first window (session.js enterWilds) admitted the same way.
function enteredWorld(seed, X, Y) {
  const world = makeWorld(null, { seed })
  const { wx, wy } = pieceOf(X, Y)
  world.origin = { wx: wx - 1, wy: wy - 1 }
  const nine = Array.from({ length: 9 }, (_, i) => ({ wx: wx - 1 + i % 3, wy: wy - 1 + Math.floor(i / 3) }))
  admit(world, nine)
  admitSampo(world, nine)
  return world
}
// The 3x3 pieces round world tile (X, Y), as the game's window: cells shared with the pieces.
function windowAt(world, X, Y) {
  const { wx, wy } = pieceOf(X, Y)
  const ps = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) ps.push(getPiece(world, wx - 1 + c, wy - 1 + r))
  const N = 3 * PIECE, ox = (wx - 1) * PIECE, oy = (wy - 1) * PIECE
  const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => ps[Math.floor(y / PIECE) * 3 + Math.floor(x / PIECE)].cells[y % PIECE][x % PIECE]))
  const doors = new Set(ps.flatMap(p => [...p.doors, ...p.caves].map(d => `${p.wx * PIECE + d.x},${p.wy * PIECE + d.y}`)))
  const viewer = { x: 0, y: 0 }
  const win = {
    map, ox, oy, doors, pieces: ps,
    cell: (X, Y) => map[Y - oy]?.[X - ox] ?? null,
    // walkable, and not a door or a cave mouth (stepping on one goes in)
    free: (X, Y) => win.cell(X, Y)?.tile === TILE.FLOOR && !doors.has(`${X},${Y}`),
    // the hero's sight at (X, Y) on a clear day: the cells lit and the radius
    sight(X, Y) {
      const radius = heroSight({ desert: isDesert(world.seed, X, Y) })
      viewer.x = X - ox; viewer.y = Y - oy
      computePlayerFOV(map, viewer, radius, { los: 'dunes', far: BEACON_RANGE })
      return { count: viewer._fovLit.length, radius }
    },
    // a landmark lit beyond the radius by the last sight(X, Y)
    beacon(X, Y, radius) {
      for (let dy = -BEACON_RANGE; dy <= BEACON_RANGE; dy++) for (let dx = -BEACON_RANGE; dx <= BEACON_RANGE; dx++) {
        const c = win.cell(X + dx, Y + dy), d2 = dx * dx + dy * dy
        if (c?.losBeacon && c.visible && d2 > radius * radius && d2 <= BEACON_RANGE * BEACON_RANGE) return { X: X + dx, Y: Y + dy, d: +Math.sqrt(d2).toFixed(1) }
      }
      return null
    },
  }
  return win
}
// The open desert, as the storm and the heat ask after it (session.js landOf):
// desert country out of the gentle ring, off Kalevanlinna's ground and out
// of a village (its piece must be in the world's memory: windowAt puts it there).
const open = (world, X, Y) => { const l = landOf(world, X, Y); return l.desert && !l.ring && !l.city && !l.village }
const isWell = n => typeof n === 'string' && n.startsWith('ow_well')
const drinkable = c => !!c && [c.skin, c.deco, c.overlay].some(n => isWell(n) || isWaterSkin(n))
// a breadth-first walk from (X, Y) over free cells: parents and depth, to `max` steps
function walkFrom(win, X, Y, max, ok = () => true) {
  const seen = new Map([[`${X},${Y}`, { X, Y, d: 0, from: null }]])
  const queue = [seen.get(`${X},${Y}`)]
  while (queue.length) {
    const n = queue.shift()
    if (n.d >= max) continue
    for (const [dx, dy] of STEPS) {
      const k = `${n.X + dx},${n.Y + dy}`
      if (seen.has(k) || !win.free(n.X + dx, n.Y + dy) || !ok(n.X + dx, n.Y + dy)) continue
      const m = { X: n.X + dx, Y: n.Y + dy, d: n.d + 1, from: n }
      seen.set(k, m)
      queue.push(m)
    }
  }
  return seen
}
const pathTo = n => { const p = []; for (let m = n; m; m = m.from) p.unshift({ X: m.X, Y: m.Y }); return p }

// From road tile R: a way off the road into the dunes to a hollow H that sees
// less, and a crest C beside H that sees more again. Null if there is none
// within `max` steps.
function planSight(win, R, max = 12) {
  if (!onRoad(win.cell(R.X, R.Y))) return null
  const road = win.sight(R.X, R.Y)
  const reach = walkFrom(win, R.X, R.Y, max)
  const counted = new Map()
  const count = (X, Y) => { const k = `${X},${Y}`; if (!counted.has(k)) counted.set(k, win.sight(X, Y).count); return counted.get(k) }
  let best = null
  for (const n of [...reach.values()].sort((a, b) => a.d - b.d)) {
    if (best && n.d > best.path.length) break
    const c = win.cell(n.X, n.Y)
    if (n.d < 2 || c.losDune || onRoad(c)) continue
    const h = count(n.X, n.Y)
    if (h > 0.8 * road.count) continue
    for (const [dx, dy] of STEPS) {
      const C = { X: n.X + dx, Y: n.Y + dy }
      if (!win.cell(C.X, C.Y)?.losDune || !win.free(C.X, C.Y)) continue
      const cc = count(C.X, C.Y)
      if (cc < 1.2 * h) continue
      const gain = cc / h
      if (!best || n.d < best.path.length - 1 || gain > best.gain) best = { path: pathTo(n), H: { X: n.X, Y: n.Y }, C, counts: { road: road.count, hollow: h, crest: cc }, gain, radius: road.radius }
    }
  }
  return best
}
// The start of the check: a road tile of piece 10,0 in the desert with a
// way into the dunes (planSight), the nearest such to the piece's middle.
function startTile(seed) {
  if (AT) return { X: AT[0], Y: AT[1] }
  const wx = 10, wy = 0
  const world = enteredWorld(seed, wx * PIECE + 40, wy * PIECE + 40)
  const win = windowAt(world, wx * PIECE + 40, wy * PIECE + 40)
  const roads = []
  for (let y = 6; y < PIECE - 6; y++) for (let x = 6; x < PIECE - 6; x++) {
    const X = wx * PIECE + x, Y = wy * PIECE + y
    if (onRoad(win.cell(X, Y)) && open(world, X, Y)) roads.push({ X, Y, d: Math.hypot(x - 40, y - 40) })
  }
  roads.sort((a, b) => a.d - b.d)
  for (const R of roads.slice(0, 60)) if (planSight(win, R)) return { X: R.X, Y: R.Y }
  return roads[0] ? { X: roads[0].X, Y: roads[0].Y } : { X: wx * PIECE + 40, Y: wy * PIECE + 40 }
}

const START = startTile(SEED)
const save = citySave({ seed: SEED, pos: START, frac: FRAC })
if (SAVE_OUT) {
  fs.mkdirSync(path.dirname(path.resolve(SAVE_OUT)), { recursive: true })
  fs.writeFileSync(SAVE_OUT, JSON.stringify(save))
  console.log(`a seed-${SEED} Wilds save starting at world tile ${at(START)} (clock ${FRAC} of the day) written to ${path.resolve(SAVE_OUT)}`)
  process.exit(0)
}
fs.mkdirSync(SHOTS, { recursive: true })

// ---- the game ----------------------------------------------------------------------------
const errors = []
let failed = false, passed = 0, fails = 0
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ' — ' + extra : ''}`); if (ok) passed++; else { failed = true; fails++ }; return ok }
const note = s => console.log(`     ${s}`)
// Electron here now and then fails to load a tile picture over file:// and
// the loader tries it again (render/sprites.js loadOne): noise, counted
// apart. One it gave up on says "Missing sprite" and is a real error.
const KNOWN = e => /renderer\/assets\/[\w/-]+\.png/.test(e) && /net::ERR_FAILED/.test(e)

const t0 = Date.now()
const { app, page } = await launchGame({ profile: PROFILE, save, errors })
page.on('console', m => { if (m.type() === 'warning' && /Missing sprite/.test(m.text())) errors.push('gave up: ' + m.text()) })
const d = driver(page), ev = d.ev
const shot = name => page.screenshot({ path: path.join(SHOTS, `desert-${name}.png`) })
const KEY = { '0,-1': 'ArrowUp', '0,1': 'ArrowDown', '-1,0': 'ArrowLeft', '1,0': 'ArrowRight' }
const tap = async (key, ms = 140) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); await sleep(150) }

// Hold the arrow toward the neighbouring world tile (X, Y) until the hero
// stands on it past its middle (or `ms` pass), never less than 120 ms; then
// let go. Resolves where he stands.
async function stepTo(X, Y, { ms = 1800 } = {}) {
  const from = await d.playerWorld()
  const k = KEY[`${Math.sign(X - from.X)},${Math.sign(Y - from.Y)}`]
  if (!k || (X !== from.X && Y !== from.Y)) throw new Error(`no straight step from ${at(from)} to ${X},${Y}`)
  const held = Date.now()
  await page.keyboard.down(k)
  const end = await ev(([X, Y, dx, dy, ms]) => new Promise(res => {
    const t = performance.now()
    const look = () => {
      const s = window.__dc.state, o = window.__dc.wilds.origin, p = s.player
      const PX = p.px + o.wx * 80 * 32, PY = p.py + o.wy * 80 * 32
      const on = p.x + o.wx * 80 === X && p.y + o.wy * 80 === Y
      const past = dx > 0 ? PX >= X * 32 + 14 : dx < 0 ? PX <= X * 32 + 18 : dy > 0 ? PY >= Y * 32 + 14 : PY <= Y * 32 + 18
      if ((on && past) || s.cave || performance.now() - t > ms) return res({ X: p.x + o.wx * 80, Y: p.y + o.wy * 80 })
      requestAnimationFrame(look)
    }
    look()
  }), [X, Y, Math.sign(X - from.X), Math.sign(Y - from.Y), ms])
  await sleep(Math.max(0, 120 - (Date.now() - held)))
  await page.keyboard.up(k)
  await sleep(120)
  return end
}
// along a path of world tiles (each a step from the last), the first being where he stands
async function walk(cells) {
  let here = await d.playerWorld()
  for (const c of cells.slice(1)) {
    here = await stepTo(c.X, c.Y)
    if (!same(here, c)) return { ok: false, here, want: c }
  }
  return { ok: true, here }
}
// the hero put on world tile `t` (a scene set, not a step), seen to stay there
async function placeAt(t) {
  for (let i = 0; i < 3; i++) {
    await d.goTo(t.X, t.Y)
    await sleep(300)
    if (same(await d.playerWorld(), t)) return
  }
  throw new Error(`the hero would not stay on ${at(t)}`)
}
// No foe in the window (one standing in the way, or a fight, would spoil a walk or a timing).
const clearFoes = () => ev(async () => {
  const { isEnemy } = await import(new URL('./systems/factions.js', location.href).href)
  const s = window.__dc.state
  s.entities = s.entities.filter(e => !isEnemy(e))
})
// The clock held at `clock` every frame (null lets it go).
const holdClock = clock => ev(c => {
  const first = window.__hold === undefined
  window.__hold = c
  if (first) { const step = () => { if (window.__hold != null) window.__dc.save.clock = window.__hold; requestAnimationFrame(step) }; requestAnimationFrame(step) }
}, clock)
// What the hero sees now: the cells lit, the radius, and a landmark lit beyond it.
const sees = () => ev(() => {
  const s = window.__dc.state, p = s.player, m = s.map, o = window.__dc.wilds.origin
  let count = 0, beacon = null
  const r = p._fovRadius ?? 0
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) {
    const c = m[y][x]
    if (!c.visible) continue
    count++
    const d2 = (x - p.x) ** 2 + (y - p.y) ** 2
    if (c.losBeacon && d2 > r * r && (!beacon || d2 > beacon.d2)) beacon = { X: x + o.wx * 80, Y: y + o.wy * 80, d2, d: +Math.sqrt(d2).toFixed(1) }
  }
  return { count, radius: r, far: p._fovFar ?? 0, beacon }
})
// The cues the game queues (systems/sfx.js), read before the audio engine drains them.
const watchCues = () => ev(() => {
  window.__cues = []
  if (window.__cueWatch) return
  window.__cueWatch = true
  const hook = () => {
    const sfx = window.__dc.state?.sfx
    if (sfx && sfx.__watched !== true) {
      let arr = sfx.cues
      const wrap = a => { if (!a.__wrapped) { const push = a.push; a.push = function (...xs) { for (const x of xs) window.__cues.push(x.name); return push.apply(this, xs) }; a.__wrapped = true } return a }
      wrap(arr)
      Object.defineProperty(sfx, 'cues', { get: () => arr, set: v => { arr = wrap(v) }, configurable: true })
      sfx.__watched = true
    }
    requestAnimationFrame(hook)
  }
  hook()
})
const cues = () => ev(() => [...window.__cues])
// Stamina's regain over `ms`: from a low tank with the wait after a spend
// over, the rate a second (systems/stamina.js REGEN_RATE 18 in full), and the
// regenScale the heat left on the hero every frame of it.
const regain = (ms = 1000) => ev(ms => new Promise(res => {
  const s0 = window.__dc.state, p = s0.player
  p.stamina = 20; p.staminaRegenT = 5
  const scales = new Set()
  let t0 = null, a = null
  const look = t => {
    const s = window.__dc.state, q = s.player
    if (t0 === null) { t0 = t; a = q.stamina }
    else scales.add(q.regenScale)
    if (t - t0 < ms) return requestAnimationFrame(look)
    res({ rate: +((q.stamina - a) / ((t - t0) / 1000)).toFixed(2), scales: [...scales], heat: +(s.heat ?? 0).toFixed(2), cave: !!s.cave })
  }
  requestAnimationFrame(look)
}), ms)
const HALF = r => r.scales.length === 1 && r.scales[0] === HEAT.factor && r.rate > 18 * HEAT.factor * 0.75 && r.rate < 18 * HEAT.factor * 1.25
const FULL = r => r.scales.length === 1 && r.scales[0] === 1 && r.rate > 18 * 0.8 && r.rate < 18 * 1.15
const rateOf = r => `${r.rate} a second, regenScale ${r.scales.join('/')}, shimmer ${r.heat}`
// The world as the game holds it now, for working out the next places from:
// its tale places, deals and records exported and read back here.
const liveWorld = async () => makeWorld(await ev(async () => {
  const { exportWorld } = await import(new URL('./wilds/world.js', location.href).href)
  return exportWorld(window.__dc.wilds)
}), { seed: SEED })
// the live cells of world tiles, compared with the worked-out ones on what matters here
const liveCells = cells => ev(cells => cells.map(([X, Y]) => {
  const o = window.__dc.wilds.origin, c = window.__dc.state.map[Y - o.wy * 80]?.[X - o.wx * 80]
  return c ? [c.tile, !!c.losDune, !!c.losBeacon, c.skin ?? null, c.overlay ?? null].join('|') : null
}), cells.map(c => [c.X, c.Y]))
const sameCells = async (win, cells) => {
  const live = await liveCells(cells)
  const want = cells.map(({ X, Y }) => { const c = win.cell(X, Y); return [c.tile, !!c.losDune, !!c.losBeacon, c.skin ?? null, c.overlay ?? null].join('|') })
  return live.every((v, i) => v === want[i])
}

try {
  await enterWilds(page)
  await noDamage(page)
  await watchCues()
  // no storm until the storm check (the calm after waking is 120 s; the checks may run past it)
  await ev(() => { window.__dc.wilds.calmUntil = Infinity })
  await holdClock(FRAC * DAY_LENGTH)
  await clearFoes()
  await sleep(1500)
  const here = await d.playerWorld()
  check(same(here, START), `the hero wakes on the road at ${at(START)}`, `at ${at(here)}`)
  {
    const real = errors.filter(e => !KNOWN(e))
    if (errors.length - real.length) note(`(${errors.length - real.length} tile pictures failed to load over file:// on entering and were tried again)`)
  }

  // ---- close / open / spire: sight over the dunes ------------------------------------------
  let world = await liveWorld()
  let win = windowAt(world, START.X, START.Y)
  const plan = planSight(win, START)
  if (check(!!plan, 'a way off the road into the dunes, and a crest beside it, worked out from the seed', plan ? `${plan.path.length - 1} steps to ${at(plan.H)}, the crest ${at(plan.C)}; seen ${plan.counts.road} -> ${plan.counts.hollow} -> ${plan.counts.crest}` : '')) {
    check(await sameCells(win, [...plan.path, plan.C]), 'the live map holds the same cells along that way')
    const onRoadCount = (await sees()).count
    await shot('road')
    const w = await walk(plan.path)
    const hollow = await sees()
    await shot('hollow')
    check(w.ok, 'walked off the road into the dunes with the arrow keys', w.ok ? '' : `stopped at ${at(w.here)}, wanted ${at(w.want)}`)
    check(hollow.count < 0.85 * onRoadCount, 'walking off the road into the dunes closes the view', `${onRoadCount} cells seen on the road, ${hollow.count} in the hollow (worked out: ${plan.counts.road} -> ${plan.counts.hollow})`)
    const up = await stepTo(plan.C.X, plan.C.Y)
    const crest = await sees()
    await shot('crest')
    check(same(up, plan.C) && crest.count > 1.15 * hollow.count, 'climbing a crest opens it', `${hollow.count} -> ${crest.count} cells seen (worked out: ${plan.counts.crest}), on ${at(up)}`)
  }
  {
    // the first place on the way (road, hollow, crest) a landmark is lit beyond the radius, else the nearest such place
    const spots = plan ? [START, ...plan.path.slice(1), plan.C] : [START]
    let S = null, B = null
    for (const s of spots) { const r = win.sight(s.X, s.Y); B = win.beacon(s.X, s.Y, r.radius); if (B) { S = s; break } }
    if (!S) {
      for (const n of [...walkFrom(win, START.X, START.Y, 30).values()].sort((a, b) => a.d - b.d)) {
        const r = win.sight(n.X, n.Y); B = win.beacon(n.X, n.Y, r.radius)
        if (B) { S = { X: n.X, Y: n.Y }; break }
      }
    }
    if (check(!!S, 'a place near the start where a landmark stands beyond the sight radius in view, worked out from the seed', S ? `${at(S)}, the landmark ${at(B)} ${B.d} tiles off` : '')) {
      if (!same(await d.playerWorld(), S)) await placeAt(S)
      await sleep(300)
      const s = await sees()
      await shot('spire')
      check(!!s.beacon && s.beacon.d > s.radius && s.beacon.d <= BEACON_RANGE, 'a spire is seen beyond the radius', s.beacon ? `the landmark at ${at(s.beacon)}, ${s.beacon.d} tiles off, sight ${s.radius}, far ${s.far}` : `none lit (sight ${s.radius}, far ${s.far})`)
    }
  }

  // ---- heat / night: stamina by day and by night -----------------------------------------
  {
    // P0 on open sand outside every palm's shade, P1 a step from it inside a
    // palm's (and no well or water's) shade: near the start
    let pair = null
    const centre = pieceOf(START.X, START.Y)
    const x0 = centre.wx * PIECE, y0 = centre.wy * PIECE
    const ring = (X, Y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (drinkable(win.cell(X + dx, Y + dy))) return true; return false }
    const ok = (X, Y) => win.free(X, Y) && open(world, X, Y)
    for (let y = y0 + 6; y < y0 + PIECE - 6 && !pair; y++) for (let x = x0 + 6; x < x0 + PIECE - 6 && !pair; x++) {
      const c = win.cell(x, y)
      if (!(c.tile === TILE.WALL && typeof c.overlay === 'string' && c.overlay.includes('palm') && !c.overlay.endsWith('_top'))) continue
      for (const [dx, dy] of STEPS) {
        const P1 = { X: x + 3 * dx, Y: y + 3 * dy }, P0 = { X: x + 4 * dx, Y: y + 4 * dy }
        if (!ok(P1.X, P1.Y) || !ok(P0.X, P0.Y) || ring(P1.X, P1.Y, HEAT.coolReach)) continue
        if (nearCool(win.map, P1.X - win.ox, P1.Y - win.oy) && !nearCool(win.map, P0.X - win.ox, P0.Y - win.oy)) { pair = { P0, P1, palm: { X: x, Y: y } }; break }
      }
    }
    if (check(!!pair, 'open sand a step from a palm\'s shade, worked out from the seed', pair ? `${at(pair.P0)} -> ${at(pair.P1)}, the palm's foot at ${at(pair.palm)}` : '')) {
      await placeAt(pair.P0)
      await clearFoes()
      await holdClock(NOON)
      await sleep(1500)   // the shimmer faded in (HEAT.fade 1 s)
      const day = await regain()
      await shot('heat-sand')
      check(HALF(day), 'by day on open sand stamina comes back at half rate', rateOf(day))
      const step = await stepTo(pair.P1.X, pair.P1.Y)
      await sleep(200)
      const shade = await regain()
      check(same(step, pair.P1) && FULL(shade), 'one step into a palm\'s shade, at full rate', `${rateOf(shade)}, on ${at(step)}`)
      await stepTo(pair.P0.X, pair.P0.Y)
      await holdClock(NIGHT)
      await sleep(1500)
      const night = await regain()
      await shot('heat-night')
      check(FULL(night), 'at night on the same sand, at full rate', `${rateOf(night)} (clock ${(NIGHT / DAY_LENGTH).toFixed(2)} of the day)`)
    }
  }

  // ---- house: in and out of a desert farm's house at noon ----------------------------------
  {
    // a door in a desert piece that is no village, its outside on open sand out of the shade
    let pick = null
    for (const p of [...win.pieces].sort((a, b) => Math.hypot(a.wx * PIECE + 40 - START.X, a.wy * PIECE + 40 - START.Y) - Math.hypot(b.wx * PIECE + 40 - START.X, b.wy * PIECE + 40 - START.Y))) {
      if (villageAt(SEED, p.wx, p.wy)) continue
      for (const door of [...p.doors].sort((a, b) => (a.tier === 'safe' ? 0 : 1) - (b.tier === 'safe' ? 0 : 1))) {
        const D = { X: p.wx * PIECE + door.x, Y: p.wy * PIECE + door.y }
        const O1 = { X: D.X, Y: D.Y + 1 }, O2 = { X: D.X, Y: D.Y + 2 }
        const outside = q => win.free(q.X, q.Y) && open(world, q.X, q.Y) && !nearCool(win.map, q.X - win.ox, q.Y - win.oy)
        if (outside(O1) && outside(O2) && open(world, D.X, D.Y) && !nearCool(win.map, D.X - win.ox, D.Y - win.oy)) { pick = { D, O1, O2, label: door.label, tier: door.tier }; break }
      }
      if (pick) break
    }
    if (check(!!pick, 'a house in the desert with its door on open sand, worked out from the seed', pick ? `${pick.label} (${pick.tier}), door ${at(pick.D)}` : '')) {
      await holdClock(NOON)
      await placeAt(pick.O2)
      await clearFoes()
      await sleep(1500)
      const before = await regain()
      check(HALF(before), 'noon at the door: half rate', rateOf(before))
      await stepTo(pick.O1.X, pick.O1.Y)
      await page.keyboard.down('ArrowUp')
      const inside = await page.waitForFunction(() => !!window.__dc.state.cave, null, { timeout: 4000 }).then(() => true, () => false)
      await sleep(120)
      await page.keyboard.up('ArrowUp')
      await sleep(600)
      const within = await regain()
      await shot('house-inside')
      check(inside && within.cave && FULL(within) && within.heat === 0, 'inside the house: full rate, no shimmer', `${inside ? 'in' : 'not in'}; ${rateOf(within)}`)
      await page.keyboard.down('ArrowDown')
      const out = await page.waitForFunction(() => !window.__dc.state.cave, null, { timeout: 5000 }).then(() => true, () => false)
      await sleep(120)
      await page.keyboard.up('ArrowDown')
      await sleep(1500)
      const after = await regain()
      const where = await d.playerWorld()
      await shot('house-out')
      check(out && !after.cave && HALF(after) && after.heat > 0.5, 'stepping back out in the heat: half rate again, the shimmer back', `${out ? 'out' : 'still in'} at ${at(where)}; ${rateOf(after)}`)
    }
  }

  // ---- drink: a well ends the heat --------------------------------------------------------
  {
    // a well (or water) in the desert's country near the start, a cell beside
    // it to stand on, and open sand out of the shade a few steps away
    world = await liveWorld()
    let pick = null
    const near = []
    for (const p of win.pieces) for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      const X = p.wx * PIECE + x, Y = p.wy * PIECE + y
      if (drinkable(p.cells[y][x]) && isDesert(SEED, X, Y) && !nearCity(X, Y)) near.push({ X, Y, well: [p.cells[y][x].skin, p.cells[y][x].overlay].some(isWell) })
    }
    near.sort((a, b) => (b.well - a.well) || (Math.hypot(a.X - START.X, a.Y - START.Y) - Math.hypot(b.X - START.X, b.Y - START.Y)))
    for (const W of near.slice(0, 40)) {
      win = windowAt(world, W.X, W.Y)
      for (const [dx, dy] of [...STEPS, [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const B = { X: W.X + dx, Y: W.Y + dy }
        if (!win.free(B.X, B.Y) || !open(world, B.X, B.Y)) continue
        const reach = [...walkFrom(win, B.X, B.Y, 12).values()].filter(n => n.d >= 5 && open(world, n.X, n.Y) && !nearCool(win.map, n.X - win.ox, n.Y - win.oy)).sort((a, b) => a.d - b.d)
        if (reach.length) { pick = { W, B, way: pathTo(reach[0]).reverse() }; break }
      }
      if (pick) break
    }
    if (check(!!pick, `a ${pick?.W.well === false ? 'water\'s edge' : 'well'} in the desert and open sand a few steps from it, worked out from the seed`, pick ? `${pick.W.well ? 'the well' : 'water'} at ${at(pick.W)}, stand at ${at(pick.B)}, start ${at(pick.way[0])} (${pick.way.length - 1} steps)` : '')) {
      const A = pick.way[0]
      await holdClock(NOON)
      await placeAt(A)
      await clearFoes()
      await ev(() => { window.__dc.state.player.cooledUntil = 0 })
      await sleep(1500)
      const before = await regain()
      check(HALF(before), 'noon on open sand: half rate before the drink', rateOf(before))
      await ev(() => { window.__cues.length = 0 })
      const there = await walk(pick.way)
      await sleep(HEAT.drinkAfter * 1000 + 600)
      const drink = await ev(() => ({ cues: [...window.__cues], until: window.__dc.state.player.cooledUntil ?? 0, now: window.__dc.wilds.playtime }))
      await shot('drink')
      check(there.ok && drink.cues.includes('drink'), 'a moment beside the well: the drink cue is queued', there.ok ? `cues ${JSON.stringify(drink.cues)}` : `stopped at ${at(there.here)}`)
      check(drink.until - drink.now > HEAT.drinkFor - 10, 'the drink keeps the heat off for a while', `${(drink.until - drink.now).toFixed(1)} s of play left of ${HEAT.drinkFor}`)
      const back = await walk([...pick.way].reverse())
      await sleep(1500)
      const after = await regain()
      await shot('drink-after')
      check(back.ok && FULL(after) && after.heat === 0, 'back on the same sand the heat is off: full rate, no shimmer', `${back.ok ? '' : `stopped at ${at(back.here)}; `}${rateOf(after)}`)
    }
  }

  // ---- storm: a stormy day's peak ---------------------------------------------------------
  {
    // the first day whose storm blows at its peak in the heat of the day (so
    // the haze is seen by daylight and the heat it hides would be on)
    const peakOf = s => s.start + STORM.ramp + s.len / 2
    const hot = s => !!s && peakOf(s) / DAY_LENGTH > HEAT.from + 0.02 && peakOf(s) / DAY_LENGTH < HEAT.to - 0.02
    let day = 1
    while (!hot(stormOfDay(SEED, day)) && day < 200) day++
    const s = stormOfDay(SEED, day)
    const peak = s ? peakOf(s) : NOON
    // a straight stretch of road's middle lane near the start, in the open desert, 10-14 tiles
    world = await liveWorld()
    win = windowAt(world, START.X, START.Y)
    let run = null
    const home = pieceOf(START.X, START.Y)
    const roadOk = (X, Y) => onRoad(win.cell(X, Y)) && open(world, X, Y)
    for (let y = home.wy * PIECE; y < home.wy * PIECE + PIECE; y++) for (let x = home.wx * PIECE; x < home.wx * PIECE + PIECE; x++) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        let n = 0
        while (n < 14 && roadOk(x + n * dx, y + n * dy) && roadOk(x + n * dx + dy, y + n * dy + dx) && roadOk(x + n * dx - dy, y + n * dy - dx)) n++
        if (n >= 10 && (!run || n > run.n || (n === run.n && Math.hypot(x - START.X, y - START.Y) < Math.hypot(run.X - START.X, run.Y - START.Y)))) run = { X: x, Y: y, dx, dy, n }
      }
    }
    check(!!s, `a day with a storm in the heat of the day, worked out from the seed: day ${day}`, s ? `the storm from ${s.start.toFixed(1)} to ${s.end.toFixed(1)} s of the clock, its peak held at ${peak.toFixed(1)} (${(peak / DAY_LENGTH).toFixed(2)} of the day)` : '')
    check(!!run, 'a straight stretch of road through the open desert near the start, worked out from the seed', run ? `${run.n} tiles from ${run.X},${run.Y} ${run.dx ? 'east' : 'south'}` : '')
    if (s && run) {
      const from = { X: run.X, Y: run.Y }, to = { X: run.X + (run.n - 1) * run.dx, Y: run.Y + (run.n - 1) * run.dy }
      await placeAt(from)
      await clearFoes()
      // the same hour with no storm: the heat is on there (the drink above worn off)
      await ev(() => { window.__dc.state.player.cooledUntil = 0 })
      await holdClock(peak)
      await sleep(1500)
      const clear = await sees()
      const sun = await ev(() => ({ heat: window.__dc.state.heat, regen: window.__dc.state.player.regenScale }))
      await ev(() => { window.__cues.length = 0 })
      await ev(([day]) => { window.__dc.wilds.day = day; window.__dc.wilds.calmUntil = 0 }, [day])
      await holdClock(peak)
      await sleep(STORM.ramp * 1000 + 1500)
      const st = await ev(() => {
        const s = window.__dc.state, look = s.weather?.look?.storm, layer = window.__dc.renderer?.weatherLayer
        const mini = document.getElementById('minimap')
        let px = null
        if (mini && !mini.hidden) { const g = mini.getContext('2d'); const d = g.getImageData(0, 0, mini.width, mini.height).data; let r = 0, gg = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++ } px = [r / n, gg / n, b / n].map(Math.round) }
        return { storm: s.storm, cap: s.sightCap, radius: s.player._fovRadius, look: look ? look.s : null, tiles: layer?.haze?.size ?? 0, mini: mini ? !mini.hidden : false, miniMean: px, heat: s.heat, regen: s.player.regenScale }
      })
      const seen = await sees()
      const cueList = await cues()
      const shotFile = path.join(SHOTS, 'desert-storm.png')
      await page.screenshot({ path: shotFile })
      // the frame's corners, far outside the storm's sight: the haze, whole
      const corners = await ev(() => {
        const c = document.querySelector('canvas'), g = c.getContext('2d'), out = []
        for (const [x, y] of [[8, 8], [c.width - 72, 8], [8, c.height - 72], [c.width - 72, c.height - 72]]) {
          const d = g.getImageData(x, y, 64, 64).data
          let r = 0, gg = 0, b = 0, n = 0
          for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++ }
          out.push([r / n, gg / n, b / n].map(Math.round))
        }
        return out
      })
      const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
      check(st.storm === 1 && st.look === 1, 'the storm blows at full strength on the stormy day\'s peak', `strength ${st.storm}`)
      check(st.tiles >= HAZE.passes.length && corners.every(c => near(c, HAZE.colour, 40)), 'the haze is drawn over the frame', `${st.tiles} haze tiles made; the corners ${JSON.stringify(corners)} against the haze ${JSON.stringify(HAZE.colour)}`)
      check(st.cap === SIGHT.storm && st.radius === SIGHT.storm + LIT_PAD && seen.count <= Math.PI * (SIGHT.storm + LIT_PAD + 1) ** 2 && seen.count < clear.count / 4,
        `a sight of ${SIGHT.storm}, the cells lit ${LIT_PAD} further (the haze is the edge)`, `storm sight ${st.cap}, lit radius ${st.radius}; ${clear.count} cells seen before the storm, ${seen.count} in it`)
      check(cueList.includes('storm-wind'), 'the storm-wind cue is queued', `${cueList.filter(c => c === 'storm-wind').length} gusts in ${(STORM.ramp + 1.5).toFixed(1)} s`)
      check(st.mini && !!st.miniMean && near(st.miniMean, HAZE.colour, 6), 'the minimap is all haze', st.miniMean ? `its mean colour ${JSON.stringify(st.miniMean)} against the haze ${JSON.stringify(HAZE.colour)} (within 6)` : 'no minimap shown')
      check(sun.regen === HEAT.factor && st.heat === 0 && st.regen === 1, 'no heat in the storm (it hides the sun)', `at the same hour with no storm regenScale ${sun.regen}, shimmer ${sun.heat.toFixed(2)}; in the storm regenScale ${st.regen}, shimmer ${st.heat}`)
      await tap('m')
      await sleep(500)
      const map = await ev(() => {
        const o = document.getElementById('map-overlay'), y = o?.querySelector('.inv-btn.yellow')
        return { open: !!o && o.style.display !== 'none' && o.style.display !== '', findOff: !!y && y.classList.contains('off') }
      })
      await shot('storm-map')
      check(map.open && map.findOff, 'the map opens with "Find me" greyed: no hero to find (the mark itself is not read)', JSON.stringify(map))
      await tap('m')
      check(!(await ev(() => { const o = document.getElementById('map-overlay'); return !!o && o.style.display !== 'none' && o.style.display !== '' })), 'M closes the map')

      // ---- road: walking the road through the storm --------------------------------------
      // every frame of the walk: the tile the hero is on, and on each new
      // tile the road cells inside his sight not seen, and how far ahead the
      // road is seen (wilds/coach-path.js onRoad, the coach's own test)
      await ev(async ([cells, dx, dy, whole]) => {
        const want = new Set(cells.map(c => c.join(',')))
        const log = window.__roadLog = { frames: 0, off: [], hidden: 0, hiddenAt: [], ahead: [], tiles: [], patch: 0, patchAt: [] }
        const { onRoad: on } = await import(new URL('./wilds/coach-path.js', location.href).href)
        const look = () => {
          if (window.__roadLog !== log) return
          const s = window.__dc.state, o = window.__dc.wilds.origin, p = s.player, m = s.map
          const X = p.x + o.wx * 80, Y = p.y + o.wy * 80
          if (!log.tiles.length || log.tiles.at(-1) !== `${X},${Y}`) {
            log.tiles.push(`${X},${Y}`)
            if (!want.has(`${X},${Y}`) && !on(m[p.y][p.x])) log.off.push(`${X},${Y}`)
            const r = p._fovRadius
            let hidden = 0, far = 0
            for (let ddy = -r; ddy <= r; ddy++) for (let ddx = -r; ddx <= r; ddx++) {
              if (ddx * ddx + ddy * ddy > r * r) continue
              const c = m[p.y + ddy]?.[p.x + ddx]
              if (!c || !on(c)) continue
              if (!c.visible) hidden++
              else far = Math.max(far, ddx * dx + ddy * dy)
            }
            log.hidden += hidden
            if (hidden) log.hiddenAt.push(`${X},${Y}:${hidden}`)
            log.ahead.push(far)
          }
          // the haze is the edge of what is seen (wilds/storm.js LIT_PAD): every
          // cell that reaches into its clear patch (nearer where the hero is
          // drawn than the storm sight less HAZE.whole) lies within the lit
          // radius of his tile, on every side, whichever way he walks (a crest
          // may still hide one: that is the dune rule, not the grid's edge)
          if (s.sightCap != null) {
            const r = s.sightCap - whole, cx = p.px / 32, cy = p.py / 32, R = p._fovRadius
            let n = 0
            for (let y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y++) for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) {
              const nx = Math.max(x, Math.min(x + 1, cx)), ny = Math.max(y, Math.min(y + 1, cy))
              if ((nx - cx) ** 2 + (ny - cy) ** 2 < r * r && (x - p.x) ** 2 + (y - p.y) ** 2 > R * R) n++
            }
            if (n) { log.patch++; if (log.patchAt.length < 4) log.patchAt.push(`${X},${Y}:${n}`) }
          }
          log.frames++
          requestAnimationFrame(look)
        }
        requestAnimationFrame(look)
      }, [Array.from({ length: run.n }, (_, i) => [run.X + i * run.dx, run.Y + i * run.dy]), run.dx, run.dy, HAZE.whole])
      await shot('storm-road-start')
      const k = run.dx ? 'ArrowRight' : 'ArrowDown'
      await page.keyboard.down(k)
      const end = await ev(([X, Y, ms]) => new Promise(res => {
        const t = performance.now()
        const look = () => {
          const o = window.__dc.wilds.origin, p = window.__dc.state.player
          if ((p.x + o.wx * 80 === X && p.y + o.wy * 80 === Y) || performance.now() - t > ms) return res({ X: p.x + o.wx * 80, Y: p.y + o.wy * 80 })
          requestAnimationFrame(look)
        }
        look()
      }), [to.X, to.Y, 8000])
      await page.keyboard.up(k)
      await sleep(200)
      await shot('storm-road-end')
      const log = await ev(() => { const l = window.__roadLog; window.__roadLog = null; return l })
      const still = await ev(() => window.__dc.state.storm)
      check(same(end, to) && log.tiles.length >= run.n - 1, 'walked the road through the storm with the arrow key', `${log.tiles.length} tiles, ${at(log.tiles.length ? { X: +log.tiles[0].split(',')[0], Y: +log.tiles[0].split(',')[1] } : null)} to ${at(end)}, storm ${still}`)
      check(log.off.length === 0, 'on the road all the way', log.off.slice(0, 4).join(' '))
      check(log.hidden === 0 && log.ahead.every(v => v >= SIGHT.storm - 1), 'the road keeps in sight: every road cell inside the lit radius is seen, the way on among them', `${log.hidden} road cells hidden over ${log.tiles.length} tiles${log.hiddenAt.length ? ' (' + log.hiddenAt.slice(0, 4).join(' ') + ')' : ''}; the farthest road seen ahead ${Math.min(...log.ahead)}..${Math.max(...log.ahead)} tiles`)
      check(log.frames > 0 && log.patch === 0, 'walking, every cell reaching into the haze\'s clear patch is within the lit radius, on every side', `${log.patch} of ${log.frames} frames had one outside it${log.patchAt.length ? ' (' + log.patchAt.join(' ') + ')' : ''}`)
      await ev(() => { window.__dc.wilds.calmUntil = Infinity })
    }
  }

  // ---- errors -----------------------------------------------------------------------------
  const real = errors.filter(e => !KNOWN(e)), known = errors.length - real.length
  if (known) note(`(${known} tile pictures failed to load over file:// and were tried again${errors.filter(KNOWN).length ? ', e.g. ' + errors.find(KNOWN).match(/[\w-]+\.png/)?.[0] : ''})`)
  check(real.length === 0, 'no page errors', real.slice(0, 3).join(' | '))
} catch (err) {
  check(false, `the check broke: ${err.message.split('\n')[0]}`)
} finally {
  note(`(${passed} passed, ${fails} failed; ${((Date.now() - t0) / 1000).toFixed(0)} s; screenshots in ${SHOTS})`)
  await app.close().catch(() => {})
  fs.rmSync(PROFILE, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
