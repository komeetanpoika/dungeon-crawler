// A live check of the coach line in the real game (wilds/coach.js; game.js
// boardCoach and rideCoach; ui/map-panel.js showRide): Electron on this
// display with a throwaway profile and a fresh Wilds save (seed 7) that starts
// in Koivula on a morning. Everything the player does is a real key press
// (held about 120 ms; a walk holds its key until the step is made). The debug
// hooks (--dcdebug) only set the scene: where the player stands before a
// check, a mushroom trip for the coachman to refuse, and what is read back.
//
//   sign     Koivula's signpost read with F: the towns down its roads are heard of
//   map      the map shows a hollow pencilled ring for a heard town not visited
//   refuse   on a mushroom trip, stepping onto the stop: the coachman says no
//            over his own head, and no menu opens
//   stay     off and on again: the menu lists Kalevanlinna; "Stay" keeps the
//            player on the stop, and the stop does not open again until they
//            step off
//   ride     off and on, Kalevanlinna chosen: the map mid-ride with the coach on
//            its road; then the player beside the city's stop, nothing open,
//            the city visited and where they wake, the clock two twenty-fourths
//            of a day on, "You reach Kalevanlinna.", the town's people out
//   city     at the city's stop the refusal is said over the cart; off and on,
//            Koivula chosen, the ride back
//   road     road cells walked south from Koivula's south gate for a piece,
//            every step on the road (its ground, or its planks over water)
//
// One line per check, screenshots (coach-*.png) in the directory given; exits
// non-zero if anything is wrong. About two minutes.
//
//   node tools/wilds/coach-check.mjs [shots-dir]
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sleep, citySave, driver, launchGame, enterWilds, noDamage } from '../city/live.mjs'
import { makeWorld, getPiece } from '../../renderer/wilds/world.js'
import { destinations, stopTile, LEAGUE_CLOCK } from '../../renderer/wilds/coach.js'
import { SIDE_WORDS } from '../../renderer/wilds/roads.js'
import { PIECE } from '../../renderer/wilds/layout.js'
import { DAY_LENGTH } from '../../renderer/data/weather.js'

const SEED = 7
const SHOTS = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'dc-coach-check'))
const PROFILE = path.join(path.dirname(SHOTS), 'dc-coach-check-profile')
fs.mkdirSync(SHOTS, { recursive: true })

// ---- what the world says, worked out here (pure in the seed) ------------------------------
const world = makeWorld(null, { seed: SEED })
const label = d => `${d.town.name}, ${SIDE_WORDS[d.side].toLowerCase()}, ${d.leagues} league${d.leagues === 1 ? '' : 's'}`
const HOME = getPiece(world, 0, 0)
const KOIVULA = { stop: { X: HOME.coach.x, Y: HOME.coach.y }, beside: stopTile(world, '0,0'), sign: HOME.signs.find(s => s.title === 'Koivula'), menu: destinations(world, '0,0').map(label) }
const CITY = { beside: stopTile(world, 'city'), menu: destinations(world, 'city').map(label) }
const TO_CITY = destinations(world, '0,0').find(d => d.town.key === 'city')
// The road south from Koivula's south gate: road cells (the road's ground, or
// its planks over water) from the one nearest the square south of it to the
// first a piece farther south; few turns, and off the road's edge where it can.
const cellAt = (X, Y) => { const wx = Math.floor(X / PIECE), wy = Math.floor(Y / PIECE); return getPiece(world, wx, wy).cells[Y - wy * PIECE][X - wx * PIECE] }
const onRoad = c => c.tile === 1 && ((c.skin ?? '').startsWith('ow_road_') || (c.overlay ?? '').startsWith('ow_pier'))
const road = (X, Y) => onRoad(cellAt(X, Y))
const STEPS = [[0, 1], [1, 0], [-1, 0], [0, -1]]
function roadSouth(start, rows) {
  const key = (X, Y, d) => `${X},${Y},${d}`
  const dist = new Map([[key(start.X, start.Y, -1), 0]]), prev = new Map(), open = [[0, start.X, start.Y, -1]]
  while (open.length) {
    open.sort((a, b) => a[0] - b[0])
    const [c, X, Y, d] = open.shift()
    if (c > dist.get(key(X, Y, d))) continue
    if (Y >= start.Y + rows) {
      const out = []
      for (let k = key(X, Y, d); k; k = prev.get(k)) { const [x, y] = k.split(',').map(Number); out.push({ X: x, Y: y }) }
      return out.reverse()
    }
    STEPS.forEach(([dx, dy], nd) => {
      const nx = X + dx, ny = Y + dy
      if (Math.abs(nx - start.X) > 60 || ny < start.Y - 20 || !road(nx, ny)) return
      const nc = c + 1 + (d >= 0 && d !== nd ? 4 : 0) + (STEPS.some(([ax, ay]) => !road(nx + ax, ny + ay)) ? 2 : 0)
      if (nc < (dist.get(key(nx, ny, nd)) ?? Infinity)) { dist.set(key(nx, ny, nd), nc); prev.set(key(nx, ny, nd), key(X, Y, d)); open.push([nc, nx, ny, nd]) }
    })
  }
  return null
}
const gates = []
for (let Y = HOME.village.y + 1; Y < PIECE; Y++) for (let X = 0; X < PIECE; X++) if (road(X, Y)) gates.push({ X, Y, d: Math.hypot(X - HOME.village.x, Y - HOME.village.y) })
gates.sort((a, b) => a.d - b.d)
let ROAD = null
for (const g of gates.slice(0, 12)) if ((ROAD = roadSouth(g, PIECE))) break

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
// the menu's button `text` chosen with the arrows and Enter
async function choose(text) {
  const s = await screen()
  const i = s.buttons.indexOf(text)
  if (i < 0) throw new Error(`no button "${text}" in ${JSON.stringify(s.buttons)}`)
  for (let n = 0; n < i; n++) await tap('ArrowDown')
  check((await screen()).selected === text, `"${text}" is picked with the arrows`)
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

// A ride from the stop the player stands on to button `text`: the map
// mid-ride, then the player beside `beside`. Returns the clock it moved.
async function ride(text, beside, name) {
  const clock0 = await ev(() => window.__dc.save.clock)
  const started = Date.now()
  await choose(text)
  await sleep(1600)
  const mid = await screen()
  await shot(`ride-${name}`)
  check(mid.map && !mid.menu, `the map is up mid-ride, the menu gone (${name})`, JSON.stringify({ map: mid.map, menu: mid.menu }))
  const mark = await ev(() => {
    const c = document.querySelector('#map-overlay canvas')
    if (!c) return 0
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 0x7f) < 6 && Math.abs(px[i + 1] - 0xe3) < 6 && Math.abs(px[i + 2] - 0xff) < 6) n++
    return n
  })
  check(mark >= 40, `the coach's mark is on the map mid-ride (${name})`, `${mark} px`)
  const gone = await ev(() => new Promise(res => {
    const t = performance.now()
    const look = () => (document.getElementById('map-overlay').style.display === 'block' && performance.now() - t < 7000 ? requestAnimationFrame(look) : res(document.getElementById('map-overlay').style.display !== 'block'))
    look()
  }))
  const took = (Date.now() - started) / 1000
  check(gone, `the map closes by itself at the end of the ride (${name})`, `${took.toFixed(1)} s from the choice`)
  await sleep(500)
  const after = await screen()
  check(!after.menu && !after.map && !after.sign, `nothing is open after the ride (${name})`)
  const here = await d.playerWorld()
  check(same(here, beside), `the player stands beside the stop (${name})`, `${at(here)}, beside is ${at(beside)}`)
  return (await ev(() => window.__dc.save.clock)) - clock0
}

try {
  await enterWilds(page)
  await page.waitForFunction(() => window.__dc.state?.wilds && window.__dc.state.coachStops?.length > 0, null, { timeout: 30_000 })
  await noDamage(page)
  await sleep(2000)
  check(!!ROAD, 'a road runs south from Koivula for a piece (worked out from the seed)', ROAD ? `${ROAD.length} cells from ${at(ROAD[0])} to ${at(ROAD.at(-1))}` : '')
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

  // ---- ride: to Kalevanlinna ------------------------------------------------------------
  {
    await stepTo(KOIVULA.beside.X, KOIVULA.beside.Y, { middle: true })
    await stepTo(KOIVULA.stop.X, KOIVULA.stop.Y)
    await sleep(300)
    check((await screen()).menu, 'off and on again, the menu opens')
    const moved = await ride(label(TO_CITY), CITY.beside, 'to-city')
    await shot('city')
    const want = TO_CITY.leagues * LEAGUE_CLOCK * DAY_LENGTH
    check(moved >= want && moved < want + 2, `the clock moved on ${want} s for ${TO_CITY.leagues} leagues`, `${moved.toFixed(2)} s`)
    const w = await ev(() => { const w = window.__dc.wilds, s = window.__dc.state; return { visited: [...w.visited], last: w.lastVillage, banner: s.feedback?.banner?.text ?? null, town: !!s.cityRun, folk: s.entities.filter(e => e.cityKey).length, hold: s.coachHold } })
    check(w.visited.includes('city'), 'Kalevanlinna is visited', JSON.stringify(w.visited))
    check(w.last?.wx === 0 && w.last?.wy === 2, 'and is where the player wakes', JSON.stringify(w.last))
    check(w.banner === 'You reach Kalevanlinna.', '"You reach Kalevanlinna."', JSON.stringify(w.banner))
    check(w.town && w.folk > 10, 'the town\'s people are out', `${w.folk} near`)
    const saved = await ev(async () => { const w = await window.saveAPI.loadWilds(); return w?.wilds ?? null })
    check(!!saved && saved.visited.includes('city') && saved.pos && Math.abs(saved.pos.X - CITY.beside.X) <= 1 && Math.abs(saved.pos.Y - CITY.beside.Y) <= 1, 'the game saved on arriving', JSON.stringify(saved && { visited: saved.visited, pos: saved.pos }))
    await sleep(1000)
    check(!(await screen()).menu, 'nothing opens where the player arrives')
  }
  noErrors('on the ride to the city')

  // ---- city: the refusal over the cart; the ride back -------------------------------------
  {
    const stop = await ev(() => { const s = window.__dc.state, o = window.__dc.wilds.origin, c = s.coachStops.find(c => c.town === 'city'); return c ? { X: c.x + o.wx * 80, Y: c.y + o.wy * 80 } : null })
    check(!!stop && Math.abs(stop.X - CITY.beside.X) + Math.abs(stop.Y - CITY.beside.Y) === 1, 'the city\'s stop is beside the player', `${at(stop)}`)
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
    await ride('Koivula, north, 2 leagues', KOIVULA.beside, 'back')
    await shot('koivula')
    const w = await ev(() => ({ banner: window.__dc.state.feedback?.banner?.text ?? null, last: window.__dc.wilds.lastVillage }))
    check(w.banner === 'You reach Koivula.' && w.last?.wx === 0 && w.last?.wy === 0, 'back in Koivula: "You reach Koivula.", and it is where the player wakes', JSON.stringify(w))
  }
  noErrors('on the ride back')

  // ---- road: south from Koivula for a piece, on the road all the way ---------------------
  if (ROAD) {
    await placeAt(ROAD[0])
    // every tile the player stands on, read from the live map as they walk
    await ev(() => {
      const log = window.__roadLog = []
      const look = () => {
        if (window.__roadLog !== log) return
        const s = window.__dc.state, o = window.__dc.wilds.origin, p = s.player, c = s.map[p.y]?.[p.x]
        const X = p.x + o.wx * 80, Y = p.y + o.wy * 80
        if (!log.length || log.at(-1).X !== X || log.at(-1).Y !== Y) log.push({ X, Y, skin: c?.skin ?? null, overlay: c?.overlay ?? null })
        requestAnimationFrame(look)
      }
      look()
    })
    // the road in straight runs, each walked by holding its arrow to the run's last cell
    const runs = []
    for (let i = 1; i < ROAD.length; i++) {
      const dx = ROAD[i].X - ROAD[i - 1].X, dy = ROAD[i].Y - ROAD[i - 1].Y
      if (runs.length && runs.at(-1).dx === dx && runs.at(-1).dy === dy) runs.at(-1).to = ROAD[i]
      else runs.push({ dx, dy, to: ROAD[i] })
    }
    const walked0 = Date.now()
    let stuck = null
    for (const r of runs) {
      const n = Math.abs(r.to.X - (await d.playerWorld()).X) + Math.abs(r.to.Y - (await d.playerWorld()).Y)
      const end = await stepTo(r.to.X, r.to.Y, { middle: true, ms: 1200 + n * 600 })
      if (!same(end, r.to)) { stuck = { at: end, wanted: r.to }; break }
    }
    const log = await ev(() => { const l = window.__roadLog; window.__roadLog = null; return l })
    await shot('road-end')
    const off = log.filter(c => !((c.skin ?? '').startsWith('ow_road_') || (c.overlay ?? '').startsWith('ow_pier')))
    const end = await d.playerWorld()
    check(!stuck && end.Y - ROAD[0].Y >= PIECE, `walked the road ${end.Y - ROAD[0].Y} tiles south by its arrows`, stuck ? `stuck at ${at(stuck.at)} on the way to ${at(stuck.wanted)}` : `${log.length} tiles in ${((Date.now() - walked0) / 1000).toFixed(1)} s`)
    check(off.length === 0, 'every step was on the road (its ground, or its planks over a river)', JSON.stringify(off.slice(0, 4)))
    note(`(${log.filter(c => (c.overlay ?? '').startsWith('ow_pier')).length} of them on planks)`)
  }
  noErrors('on the road')
} catch (err) {
  check(false, `the check broke: ${err.message.split('\n')[0]}`)
} finally {
  note(`(${((Date.now() - t0) / 1000).toFixed(0)} s; screenshots in ${SHOTS})`)
  await app.close().catch(() => {})
  fs.rmSync(PROFILE, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
