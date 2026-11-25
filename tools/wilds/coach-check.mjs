// A live check of the coach line in the real game (wilds/coach.js; game.js
// boardCoach and rideCoach; the ride in the world, wilds/coach-ride.js along
// the way wilds/coach-path.js finds): Electron on this display with a
// throwaway profile and a fresh Wilds save (seed 7) that starts in Koivula on
// a morning. Everything the player does is a real key press (held about
// 120 ms; a walk holds its key until the step is made). The debug hooks
// (--dcdebug) only set the scene: where the player stands before a check, a
// mushroom trip for the coachman to refuse, and what is read back.
//
//   sign     Koivula's signpost read with F: the towns down its roads are heard of
//   map      the map shows a hollow pencilled ring for a heard town not visited
//   refuse   on a mushroom trip, stepping onto the stop: the coachman says no
//            over his own head, and no menu opens
//   stay     off and on again: the menu lists Kalevanlinna; "Stay" keeps the
//            player on the stop, and the stop does not open again until they
//            step off
//   ride     off and on, Kalevanlinna chosen: no map, the hero on top of the
//            coach, Koivula's coachman off his post for the bench, the cart at
//            the stop not drawn while the coach is away; every tile the hero is
//            on, a frame at a time, a cell of the way worked out from the seed,
//            in order, and on the road, or a gate or street cell of the city;
//            through the north gate and the streets to the inn yard, at about
//            22 tiles a second; then beside the city's stop, the inn's cart
//            drawn again, nothing open, the city visited and where he wakes,
//            the clock on by the ride's own time (no jump), "You reach
//            Kalevanlinna.", the town's people out, the save
//   city     at the city's stop the refusal is said over the cart; off and on,
//            Koivula chosen, the ride back, paused half way (the coach stands
//            still, and the save made then wakes at Koivula's stop), and
//            Koivula's coachman at his post again
//
// Screenshots (coach-*.png) in the directory given: the sign, the map, the
// refusals, the menu, and on each ride its start, the open road, the gate,
// the city's streets and the arrival. The longest frame and the frames over
// 50 ms are printed for each ride, apart for the wait at the stop (the land
// ahead being made) and the rolling. One line per check; exits non-zero if
// anything is wrong. About two minutes.
//
//   node tools/wilds/coach-check.mjs [shots-dir]
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sleep, citySave, driver, launchGame, enterWilds, noDamage } from '../city/live.mjs'
import { makeWorld, getPiece } from '../../renderer/wilds/world.js'
import { destinations, stopTile, coachLabel as label } from '../../renderer/wilds/coach.js'
import { coachPath, cartOf, onRoad, CART } from '../../renderer/wilds/coach-path.js'
import { COACH_SPEED } from '../../renderer/wilds/coach-ride.js'
import { PIECE } from '../../renderer/wilds/layout.js'
import { cityFor } from '../../renderer/wilds/city/build.js'
import { isCityPiece, fromCity, toCity } from '../../renderer/wilds/city/geometry.js'
import { PLAN } from '../../renderer/wilds/city/plan.js'

const SEED = 7
const SHOTS = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'dc-coach-check'))
const PROFILE = path.join(path.dirname(SHOTS), 'dc-coach-check-profile')
fs.mkdirSync(SHOTS, { recursive: true })

// ---- what the world says, worked out here (pure in the seed) ------------------------------
const world = makeWorld(null, { seed: SEED })
const HOME = getPiece(world, 0, 0)
const KOIVULA = { stop: { X: HOME.coach.x, Y: HOME.coach.y }, beside: stopTile(world, '0,0'), sign: HOME.signs.find(s => s.title === 'Koivula'), menu: destinations(world, '0,0').map(label) }
const CITY = { beside: stopTile(world, 'city'), menu: destinations(world, 'city').map(label) }
const TO_CITY = destinations(world, '0,0').find(d => d.town.key === 'city')
const STEPS = [[0, 1], [1, 0], [-1, 0], [0, -1]]
const cellAt = (X, Y) => { const wx = Math.floor(X / PIECE), wy = Math.floor(Y / PIECE); return getPiece(world, wx, wy).cells[Y - wy * PIECE][X - wx * PIECE] }
// The coach's two ways, and where along each the open road, the north gate's
// arch and the city's streets are.
const STREETS = cityFor(SEED).streets
const inCity = p => isCityPiece(Math.floor(p.X / PIECE), Math.floor(p.Y / PIECE))
const ARCH = fromCity(PLAN.gates.N.x, PLAN.gates.N.y)
function wayOf(from, to) {
  const path = coachPath(world, from, to)
  const carts = [cartOf(world, from), cartOf(world, to)].flatMap(c => [c.H, c.C])
  const gate = path.findIndex(p => p.X === ARCH.X && p.Y === ARCH.Y)
  // the open road: the middle of the way through the piece between the two towns
  const between = path.map((p, i) => i).filter(i => Math.floor(path[i].Y / PIECE) === 1)
  return { path, carts, gate, road: between[between.length >> 1] }
}
const WAY_IN = wayOf('0,0', 'city'), WAY_OUT = wayOf('city', '0,0')
// A cell the coach may be on: a cart's; inside the city's pieces one of its
// street graph's (city/streets.js: a lane, or a cell that hangs off one);
// elsewhere the road (its ground, its planks, a village's cobbles).
function okCell(p, way) {
  if (way.carts.some(c => c.X === p.X && c.Y === p.Y)) return true
  if (!inCity(p)) return onRoad(cellAt(p.X, p.Y))
  const { cx, cy } = toCity(p.X, p.Y), i = cy * 160 + cx
  return STREETS.walk[i] === 1 && STREETS.snapDist[i] >= 0
}

// ---- the game ------------------------------------------------------------------------------
const errors = []
let failed = false
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; return ok }
const note = s => console.log(`     ${s}`)
// Electron here now and then fails to load tile pictures over file:// (CLAUDE.md
// names the interior ones, in_*.png; on a loaded machine others fail the same
// way): noise, counted and named apart
const KNOWN = e => /renderer\/assets\/[\w/-]+\.png/.test(e) && /net::ERR_FAILED/.test(e)
const noErrors = what => {
  const real = errors.filter(e => !KNOWN(e))
  const known = errors.filter(KNOWN), interior = known.filter(e => /\/in_[\w-]+\.png/.test(e)).length
  if (known.length) note(`(${known.length} pictures failed to load over file://: ${interior} in_*.png, ${known.length - interior} others${known.length > interior ? ', e.g. ' + known.find(e => !/\/in_/.test(e)).match(/[\w-]+\.png/)[0] : ''})`)
  check(real.length === 0, `no errors ${what}`, real.slice(0, 3).join(' | '))
  errors.length = 0
}

const t0 = Date.now()
const save = citySave({ seed: SEED, pos: { X: HOME.village.x, Y: HOME.village.y + 3 }, frac: 0.3 })
const { app, page } = await launchGame({ profile: PROFILE, save, errors })
const d = driver(page), ev = d.ev
const shot = name => page.screenshot({ path: path.join(SHOTS, `coach-${name}.png`) })
const KEY = { '0,-1': 'ArrowUp', '0,1': 'ArrowDown', '-1,0': 'ArrowLeft', '1,0': 'ArrowRight' }
const tap = async (key, ms = 120) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); await sleep(150) }
// what is up on the screen
const screen = () => ev(() => {
  const shown = id => { const n = document.getElementById(id); return !!n && n.style.display !== 'none' && n.style.display !== '' }
  const menu = document.getElementById('menu-overlay')
  return {
    menu: shown('menu-overlay'), title: menu.querySelector('.menu-title')?.textContent ?? null,
    buttons: [...menu.querySelectorAll('.menu-btn')].map(b => b.textContent), selected: menu.querySelector('.menu-btn.selected')?.textContent ?? null,
    map: shown('map-overlay'), sign: shown('sign-overlay'),
    signLines: [...document.querySelectorAll('#sign-overlay .sign-line')].map(n => n.textContent),
  }
})
const bubble = () => ev(() => { const b = window.__dc.state.feedback?.bubble; return b ? { text: b.text, anchorId: b.anchorId ?? null, at: b.at ?? null } : null })
const hold = () => ev(() => window.__dc.state.coachHold)
// Hold the arrow toward the neighbouring world tile (X, Y) until the player
// stands on it (past the middle of it, with `middle`), the menu opens, or `ms`
// pass; then let go. Resolves where the player stands.
async function stepTo(X, Y, { middle = false, ms = 1800 } = {}) {
  const at = await d.playerWorld()
  const k = KEY[`${Math.sign(X - at.X)},${Math.sign(Y - at.Y)}`]
  if (!k || (X !== at.X && Y !== at.Y)) throw new Error(`no straight step from ${at.X},${at.Y} to ${X},${Y}`)
  await page.keyboard.down(k)
  const end = await ev(([X, Y, dx, dy, middle, ms]) => new Promise(res => {
    const t = performance.now()
    const look = () => {
      const s = window.__dc.state, o = window.__dc.wilds.origin, p = s.player
      const PX = p.px + o.wx * 80 * 32, PY = p.py + o.wy * 80 * 32
      const on = p.x + o.wx * 80 === X && p.y + o.wy * 80 === Y
      const past = !middle || (dx > 0 ? PX >= X * 32 + 13 : dx < 0 ? PX <= X * 32 + 19 : dy > 0 ? PY >= Y * 32 + 13 : PY <= Y * 32 + 19)
      const menuUp = document.getElementById('menu-overlay').style.display === 'flex'
      if ((on && past) || menuUp || performance.now() - t > ms) return res({ X: p.x + o.wx * 80, Y: p.y + o.wy * 80 })
      requestAnimationFrame(look)
    }
    look()
  }), [X, Y, Math.sign(X - at.X), Math.sign(Y - at.Y), middle, ms])
  await page.keyboard.up(k)
  await sleep(120)
  return end
}
// the menu's button `text` picked with the arrows (choose: and Enter pressed)
async function pick(text) {
  const s = await screen()
  const i = s.buttons.indexOf(text)
  if (i < 0) throw new Error(`no button "${text}" in ${JSON.stringify(s.buttons)}`)
  for (let n = 0; n < i; n++) await tap('ArrowDown')
  check((await screen()).selected === text, `"${text}" is picked with the arrows`)
}
async function choose(text) {
  await pick(text)
  await tap('Enter')
}
// the player put on world tile `t` (a scene set, not a step), and seen to stay there
async function placeAt(t) {
  for (let i = 0; i < 3; i++) {
    await d.placeWorld(t.X, t.Y)
    await sleep(400)
    if (same(await d.playerWorld(), t)) return
  }
  throw new Error(`the player would not stay on ${at(t)}`)
}
const trip = on => ev(on => { const p = window.__dc.state.player; p.trance = on ? 30 : 0; p.tranceFade = 0 }, on)
const same = (a, b) => !!a && !!b && a.X === b.X && a.Y === b.Y
const at = s => `${s?.X},${s?.Y}`
// the overlays of world tiles, read off the live map
const artOf = cells => ev(cells => cells.map(([X, Y]) => { const o = window.__dc.wilds.origin, c = window.__dc.state.map[Y - o.wy * 80]?.[X - o.wx * 80]; return c?.overlay ?? null }), cells.map(c => [c.X, c.Y]))
const riding = () => ev(() => {
  const s = window.__dc.state, r = s.coachRide
  return { riding: !!s.player.riding, ride: r ? { d: r.d, rolling: !!r.path, dir: r.dir, man: !!r.man } : null }
})
// Wait until the hero is at least `i` cells along `way` (or off the coach).
const reach = (way, i) => ev(([cells, i]) => new Promise(res => {
  const t = performance.now()
  const look = () => {
    const s = window.__dc.state, o = window.__dc.wilds.origin, p = s.player
    const k = cells.findIndex(c => c[0] === p.x + o.wx * 80 && c[1] === p.y + o.wy * 80)
    if (k >= i || !s.coachRide || performance.now() - t > 40000) return res(k)
    requestAnimationFrame(look)
  }
  look()
}), [way.path.map(p => [p.X, p.Y]), i])

// A ride from the stop the player stands on to button `text` along `way`,
// with screenshots at the cells `shots` names ({ i, name }, in order) and,
// with `pauseAt`, the pause menu there. Then the hero beside `beside`.
// Returns the clock it moved and the time it took.
async function ride(text, way, beside, name, { from, shots, pauseAt = null }) {
  const clock0 = await ev(() => window.__dc.save.clock)
  await pick(text)
  // every frame: its time, whether a menu was up (the game paused), and the hero's tile while he is on the coach
  await ev(() => {
    const log = window.__rideLog = { frames: [], tiles: [], start: null, set: null, end: null }
    const look = t => {
      if (window.__rideLog !== log) return
      const s = window.__dc.state, o = window.__dc.wilds.origin, p = s.player
      log.frames.push([t, document.getElementById('menu-overlay').style.display === 'flex', `${o.wx},${o.wy}`, p.y + o.wy * 80])
      if (s.coachRide) {
        if (log.start === null) log.start = t
        if (s.coachRide.path && log.set === null) log.set = t
        const X = p.x + o.wx * 80, Y = p.y + o.wy * 80
        if (!log.tiles.length || log.tiles.at(-1)[0] !== X || log.tiles.at(-1)[1] !== Y) log.tiles.push([X, Y])
      } else if (log.end === null && log.set !== null) log.end = t
      if (log.end === null) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  // Enter: onto the coach, and the first picture as it sets off
  await page.keyboard.down('Enter')
  const started = Date.now()
  await shot(`ride-${name}-start`)
  await page.keyboard.up('Enter')
  await sleep(100)
  const on = await riding(), sc = await screen()
  check(!sc.menu && !sc.map, `the menu is gone and no map opens (${name})`, JSON.stringify({ menu: sc.menu, map: sc.map }))
  check(on.riding && !!on.ride, `the hero is on top of the coach (${name})`, JSON.stringify(on.ride))
  if (from !== 'city') {
    const left = await ev(f => window.__dc.state.entities.filter(e => e.type === 'npc' && e.coachman && e.wildsKey === f).length, from)
    check(left === 0 && on.ride?.man, `${from}'s coachman has left his post for the bench (${name})`, `${left} at his post`)
  }
  check((await artOf(way.carts.slice(0, 2))).every(a => a === null), `the cart at the stop is not drawn twice: the coach stands on its cells (${name})`)
  for (const s of shots) {
    if (pauseAt !== null && s.i > pauseAt) {
      // the pause menu half way: the coach stands still, and a save made then wakes at the far stop
      await reach(way, pauseAt)
      await tap('Escape')
      const a = await riding()
      await sleep(700)
      const b = await riding()
      const saved = await ev(async () => (await window.saveAPI.loadWilds())?.wilds ?? null)
      check(!!a.ride && a.ride.d === b.ride?.d && (await screen()).menu, `the pause menu stops the coach half way (${name})`, `${a.ride?.d?.toFixed(1)} -> ${b.ride?.d?.toFixed(1)}`)
      check(same(saved?.pos, beside), `a save made on the coach wakes at the far stop (${name})`, JSON.stringify(saved?.pos))
      await tap('Escape')
      check(!(await screen()).menu, `Escape lets the coach go on (${name})`)
      pauseAt = null
    }
    await reach(way, s.i)
    await shot(`ride-${name}-${s.name}`)
  }
  await ev(() => new Promise(res => { const look = () => (window.__dc.state.coachRide ? requestAnimationFrame(look) : res()); look() }))
  await sleep(250)
  await shot(`ride-${name}-arrived`)
  const took = (Date.now() - started) / 1000
  const log = await ev(() => { const l = window.__rideLog; window.__rideLog = null; return { frames: l.frames, tiles: l.tiles, start: l.start, set: l.set, end: l.end } })
  // the way: every tile on it, in order, and of the kinds the coach drives on
  const idx = log.tiles.map(([X, Y]) => way.path.findIndex(p => p.X === X && p.Y === Y))
  const offWay = log.tiles.filter((_, k) => idx[k] < 0), back = idx.filter((v, k) => k && v >= 0 && v < idx[k - 1]).length
  check(offWay.length === 0 && back === 0 && idx[0] === 0, `every tile the hero was on is the way's, in order, from the cart (${name})`, `${log.tiles.length} tiles of ${way.path.length}${offWay.length ? `, off: ${JSON.stringify(offWay.slice(0, 4))}` : ''}${back ? `, ${back} back` : ''}`)
  const bad = log.tiles.filter(([X, Y]) => !okCell({ X, Y }, way))
  check(bad.length === 0, `on the road all the way, or a gate or street cell of the city (${name})`, JSON.stringify(bad.slice(0, 4)))
  check(log.tiles.some(([X, Y]) => X === ARCH.X && Y === ARCH.Y), `through the north gate's arch (${name})`)
  // the frames: while the land ahead was made at the stop, and while it rolled (the paused ones left out)
  const frames = log.frames
  const gaps = (a, b) => frames.slice(1).map((f, k) => [frames[k], f]).filter(([p, f]) => p[0] >= a && f[0] <= b && !p[1] && !f[1]).map(([p, f]) => f[0] - p[0])
  const ready = gaps(log.start, log.set), rolling = gaps(log.set, log.end)
  const stat = g => (g.length ? `${g.length} frames, longest ${Math.max(...g).toFixed(0)} ms, ${g.filter(x => x > 50).length} over 50 ms` : 'no frames')
  note(`(at the stop ${((log.set - log.start) / 1000).toFixed(2)} s, the land being made: ${stat(ready)})`)
  // which of the long ones the window re-centred in (session.js: a new window, its tales and its town)
  // (the frame before or after the long one shows the window's new origin: rAF callbacks may run either side of the game's)
  const long = frames.map((f, k) => k).filter(k => k > 1 && frames[k - 1][0] >= log.set && frames[k][0] <= log.end && !frames[k - 1][1] && !frames[k][1] && frames[k][0] - frames[k - 1][0] > 50)
  const onRecentre = long.filter(k => frames[k - 2][2] !== frames[k][2]).length
  const inTown = long.filter(k => frames[k - 1][3] >= 160).length   // world rows 160 on: Kalevanlinna's pieces
  note(`(rolling: ${stat(rolling)}; ${onRecentre} of those as the window re-centred, of ${new Set(frames.filter(f => f[0] >= log.set && f[0] <= log.end).map(f => f[2])).size - 1} re-centres; ${inTown} in Kalevanlinna's pieces)`)
  const rolled = rolling.reduce((t, x) => t + x, 0) / 1000
  check(Math.abs((way.path.length - 1) / rolled - COACH_SPEED) < 3, `about ${COACH_SPEED} tiles a second (${name})`, `${way.path.length - 1} tiles in ${rolled.toFixed(2)} s rolling: ${((way.path.length - 1) / rolled).toFixed(1)} a second`)
  const after = await screen()
  check(!after.menu && !after.map && !after.sign, `nothing is open after the ride (${name})`)
  const here = await d.playerWorld()
  check(same(here, beside), `the hero stepped down beside the stop (${name})`, `${at(here)}, beside is ${at(beside)}`)
  check(JSON.stringify(await artOf(way.carts.slice(2))) === JSON.stringify(CART), `the coach parked: the far cart is drawn again (${name})`)
  return { clock: (await ev(() => window.__dc.save.clock)) - clock0, took }
}

try {
  await enterWilds(page)
  await page.waitForFunction(() => window.__dc.state?.wilds && window.__dc.state.coachStops?.length > 0, null, { timeout: 30_000 })
  await noDamage(page)
  await sleep(2000)
  check(WAY_IN.gate > 0 && WAY_OUT.gate > 0, 'the coach\'s ways to Kalevanlinna and back go through its north gate (worked out from the seed)', `${WAY_IN.path.length} and ${WAY_OUT.path.length} cells, the arch the ${WAY_IN.gate}th and the ${WAY_OUT.gate}th`)
  check(KOIVULA.menu.includes('Kalevanlinna, south, 2 leagues'), 'Koivula\'s coach goes to Kalevanlinna, south, 2 leagues (worked out from the seed)', KOIVULA.menu.join(' | '))
  noErrors('on entering')

  // ---- sign: Koivula's signpost, read with F ---------------------------------------------
  {
    const s = KOIVULA.sign
    const by = STEPS.map(([dx, dy]) => ({ X: s.x + dx, Y: s.y + dy })).find(c => cellAt(c.X, c.Y).tile === 1)
    await placeAt(by)
    const before = await ev(() => [...window.__dc.wilds.heard])
    await tap('f')
    await sleep(300)
    const sc = await screen()
    await shot('sign')
    check(sc.sign && sc.signLines.includes('South: Kalevanlinna, 2 leagues.'), 'Koivula\'s sign names Kalevanlinna, 2 leagues south', sc.signLines.join(' | '))
    const heard = await ev(() => [...window.__dc.wilds.heard])
    check(before.length === 0 && s.hears.every(k => heard.includes(k)), 'reading it pencils its towns in', `heard ${JSON.stringify(before)} -> ${JSON.stringify(heard)}`)
    const saved = await ev(async () => { const w = await window.saveAPI.loadWilds(); return w?.wilds?.heard ?? null })
    check(Array.isArray(saved) && s.hears.every(k => saved.includes(k)), 'and the save keeps them', JSON.stringify(saved))
    await tap('f')
    check(!(await screen()).sign, 'F closes the sign')
  }
  noErrors('at the sign')

  // ---- map: a hollow ring for a heard town not visited ------------------------------------
  {
    await tap('m')
    await sleep(300)
    await tap('q')   // zoom out (green), so the heard towns are on the screen with their names
    await sleep(400)
    const ring = await ev(async () => {
      const { landmarks } = await import(new URL('./wilds/map.js', location.href).href)
      const { mapView, ZOOMS } = await import(new URL('./ui/map-panel.js', location.href).href)
      const w = window.__dc.wilds, v = mapView(), c = document.querySelector('#map-overlay canvas')
      if (!v || !c) return { open: false }
      const scale = ZOOMS[v.zoom], g = c.getContext('2d')
      const out = []
      for (const m of landmarks(w).filter(m => m.kind === 'heard')) {
        const x = Math.round((m.X - (v.cx - c.width / 2 / scale)) * scale), y = Math.round((m.Y - (v.cy - c.height / 2 / scale)) * scale)
        if (x < 8 || y < 8 || x > c.width - 8 || y > c.height - 8) { out.push({ name: m.name, key: m.key, off: true }); continue }
        const px = g.getImageData(x - 6, y - 6, 13, 13).data
        let pencil = 0, middle = px.slice((6 * 13 + 6) * 4, (6 * 13 + 6) * 4 + 3)
        for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 0xb3) < 14 && Math.abs(px[i + 1] - 0xa5) < 14 && Math.abs(px[i + 2] - 0x8c) < 14) pencil++
        out.push({ name: m.name, key: m.key, visited: w.visited.includes(m.key), pencil, middle: [...middle] })
      }
      return { open: true, rings: out }
    })
    await shot('map-heard')
    check(ring.open, 'M opens the map')
    const hollow = (ring.rings ?? []).filter(r => !r.off && !r.visited && r.pencil >= 6 && !(Math.abs(r.middle[0] - 0xb3) < 14 && Math.abs(r.middle[1] - 0xa5) < 14))
    check(hollow.length > 0, 'a heard town not visited is a hollow pencilled ring on the map', JSON.stringify(ring.rings))
    await tap('m')
    check(!(await screen()).map, 'M closes the map')
  }
  noErrors('on the map')

  // ---- refuse: on a mushroom trip the coachman will not drive -----------------------------
  {
    const man = await ev(() => { const e = window.__dc.state.entities.find(e => e.type === 'npc' && e.coachman && e.wildsKey === '0,0'); return e ? { id: e.id } : null })
    check(!!man, 'Koivula\'s coachman stands by his cart')
    await placeAt(KOIVULA.beside)
    await trip(true)
    const on = await stepTo(KOIVULA.stop.X, KOIVULA.stop.Y)
    await sleep(250)
    const b = await bubble(), sc = await screen()
    await shot('refused')
    await trip(false)
    check(same(on, KOIVULA.stop), 'the player walks onto Koivula\'s stop', `${at(on)}`)
    check(!sc.menu, 'no menu opens while the player is on a mushroom trip')
    check(b?.text === 'Sit up first.' && b.anchorId === man?.id, 'the coachman says "Sit up first." over his own head', JSON.stringify(b))
    await sleep(800)
    check(!(await screen()).menu && (await hold()) === true, 'standing on the stop after a refusal opens nothing (held)')
  }
  noErrors('at the refusal')

  // ---- stay: the menu, "Stay", the latch --------------------------------------------------
  {
    const off = await stepTo(KOIVULA.beside.X, KOIVULA.beside.Y, { middle: true })
    check(same(off, KOIVULA.beside) && (await hold()) === false, 'stepping off lets the stop go', at(off))
    await stepTo(KOIVULA.stop.X, KOIVULA.stop.Y)
    await sleep(300)
    const sc = await screen()
    await shot('menu')
    check(sc.menu && sc.title === 'The coach', 'stepping on opens "The coach"', JSON.stringify(sc.title))
    check(JSON.stringify(sc.buttons) === JSON.stringify([...KOIVULA.menu, 'Stay']), 'one button a town down Koivula\'s roads, then "Stay"', sc.buttons.join(' | '))
    const clock = await ev(() => window.__dc.save.clock)
    await sleep(700)
    check((await ev(() => window.__dc.save.clock)) === clock, 'the game stands still under the menu')
    await choose('Stay')
    await sleep(300)
    const here = await d.playerWorld()
    check(!(await screen()).menu && same(here, KOIVULA.stop), '"Stay" closes the menu and leaves the player on the stop', at(here))
    await sleep(1200)
    check(!(await screen()).menu && (await hold()) === true, 'standing on the stop after "Stay" opens nothing (held)')
  }
  noErrors('at "Stay"')

  // ---- ride: to Kalevanlinna, in the world ------------------------------------------------
  {
    await stepTo(KOIVULA.beside.X, KOIVULA.beside.Y, { middle: true })
    await stepTo(KOIVULA.stop.X, KOIVULA.stop.Y)
    await sleep(300)
    check((await screen()).menu, 'off and on again, the menu opens')
    const shots = [{ i: WAY_IN.road, name: 'road' }, { i: WAY_IN.gate - 3, name: 'gate' }, { i: WAY_IN.gate + 16, name: 'streets' }]
    const { clock, took } = await ride(label(TO_CITY), WAY_IN, CITY.beside, 'to-city', { from: '0,0', shots })
    check(clock > took * 0.6 && clock < took + 1, 'the clock went on by the ride\'s own time, with no jump', `${clock.toFixed(1)} s on the clock in ${took.toFixed(1)} s`)
    const w = await ev(() => { const w = window.__dc.wilds, s = window.__dc.state; return { visited: [...w.visited], last: w.lastVillage, banner: s.feedback?.banner?.text ?? null, town: !!s.cityRun, folk: s.entities.filter(e => e.cityKey).length, riding: !!s.player.riding } })
    check(!w.riding, 'the hero is on foot again')
    check(w.visited.includes('city'), 'Kalevanlinna is visited', JSON.stringify(w.visited))
    check(w.last?.wx === 0 && w.last?.wy === 2, 'and is where the hero wakes', JSON.stringify(w.last))
    check(w.banner === 'You reach Kalevanlinna.', '"You reach Kalevanlinna."', JSON.stringify(w.banner))
    check(w.town && w.folk > 10, 'the town\'s people are out', `${w.folk} near`)
    const saved = await ev(async () => { const w = await window.saveAPI.loadWilds(); return w?.wilds ?? null })
    check(!!saved && saved.visited.includes('city') && same(saved.pos, CITY.beside), 'the game saved on arriving', JSON.stringify(saved && { visited: saved.visited, pos: saved.pos }))
    await sleep(1000)
    check(!(await screen()).menu, 'nothing opens where the hero arrives')
  }
  noErrors('on the ride to the city')

  // ---- city: the refusal over the cart; the ride back, paused half way --------------------
  {
    const stop = await ev(() => { const s = window.__dc.state, o = window.__dc.wilds.origin, c = s.coachStops.find(c => c.town === 'city'); return c ? { X: c.x + o.wx * 80, Y: c.y + o.wy * 80 } : null })
    check(!!stop && Math.abs(stop.X - CITY.beside.X) + Math.abs(stop.Y - CITY.beside.Y) === 1, 'the city\'s stop is beside the hero', `${at(stop)}`)
    const cart = STEPS.map(([dx, dy]) => ({ X: stop.X + dx, Y: stop.Y + dy })).find(c => /^ow_prop_city_cart/.test(cellAt(c.X, c.Y).overlay ?? ''))
    await trip(true)
    await stepTo(stop.X, stop.Y)
    await sleep(250)
    const b = await bubble(), sc = await screen()
    const o = await ev(() => window.__dc.wilds.origin)
    await shot('city-refused')
    await trip(false)
    const cx = (cart.X - o.wx * PIECE) * 32 + 16, cy = (cart.Y - o.wy * PIECE) * 32 + 16
    check(!sc.menu && b?.text === 'Sit up first.' && !b.anchorId && b.at?.px === cx && b.at?.py === cy, 'at the city\'s stop the refusal is said over the cart', JSON.stringify({ b, cart }))
    await stepTo(CITY.beside.X, CITY.beside.Y, { middle: true })
    await stepTo(stop.X, stop.Y)
    await sleep(300)
    const menu = await screen()
    check(menu.menu && JSON.stringify(menu.buttons) === JSON.stringify([...CITY.menu, 'Stay']), 'the city\'s coach lists the towns down its roads, Koivula among them', menu.buttons.join(' | '))
    const shots = [{ i: Math.max(8, WAY_OUT.gate - 12), name: 'streets' }, { i: WAY_OUT.gate - 2, name: 'gate' }, { i: WAY_OUT.road, name: 'road' }]
    await ride('Koivula, north, 2 leagues', WAY_OUT, KOIVULA.beside, 'back', { from: 'city', shots, pauseAt: WAY_OUT.gate + 20 })
    const w = await ev(() => ({ banner: window.__dc.state.feedback?.banner?.text ?? null, last: window.__dc.wilds.lastVillage, man: window.__dc.state.entities.filter(e => e.type === 'npc' && e.coachman && e.wildsKey === '0,0').length }))
    check(w.banner === 'You reach Koivula.' && w.last?.wx === 0 && w.last?.wy === 0, 'back in Koivula: "You reach Koivula.", and it is where the hero wakes', JSON.stringify({ banner: w.banner, last: w.last }))
    check(w.man === 1, 'Koivula\'s coachman is at his post again', `${w.man}`)
  }
  noErrors('on the ride back')
} catch (err) {
  check(false, `the check broke: ${err.message.split('\n')[0]}`)
} finally {
  note(`(${((Date.now() - t0) / 1000).toFixed(0)} s; screenshots in ${SHOTS})`)
  await app.close().catch(() => {})
  fs.rmSync(PROFILE, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
