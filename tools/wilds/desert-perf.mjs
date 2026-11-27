// The desert's speed gates (docs/superpowers/specs/2026-11-26-desert-land-design.md,
// "Speed"), measured on this machine:
//
//   1. sight: the hero's dune-aware sight (systems/entities.js computePlayerFOV,
//      los 'dunes', radius SIGHT.desert, far BEACON_RANGE) recomputed from
//      spots among the dunes of two real deep-desert windows (3x3 pieces, the
//      cells the game holds), in a fresh process: median ≤ 1 ms (p90 shown);
//   2. JS per frame in Electron: traces of `--secs` seconds walking a square
//      on plain desert sand (no crest within 24 tiles) and among the deep
//      dunes, back to back, `--pairs` times, at noon with the heat kept off on
//      both (a drink that does not wear off) and no foes: the dunes may add
//      ≤ 1 ms JS a frame on average (canvas raster shown too). Each place is
//      checked on the live map once the hero stands there: no crest within
//      the desert's sight radius of the plain spot, at least one of the dunes';
//   3. the web build (tools/web-server.mjs) in headless Chromium at 1024x693
//      (tools/city/perf.mjs's size) with the CPU throttled `--rate`x, standing
//      among the dunes (placed and checked as in 2), `--web-runs` times each
//      at noon (the heat's shimmer on) and at the peak of a storm (the clock
//      held on the seed's first stormy day whose storm peaks in daylight; a
//      seed with none fails the gate): the median of the runs above 30 fps
//      (of an even number of runs the slower middle one), noon and storm apart
//      (every run printed, any one under 30 marked);
//   4. piece generation (wilds/piece.js generatePiece) on 40 desert pieces of
//      the seed, 20 near home (not wholly 7 pieces out) and 20 deep (wholly 7
//      or more out), against `--base` (origin/main: the local main ref is
//      behind it) unpacked by `git archive` into the scratch folder and
//      removed after: each tree in fresh processes, alternating, the best
//      of `--gen-rounds` per piece; the branch ≤ 1.3x the base over all 40
//      (ratio of the total; the median ratio and each half shown). Beside it,
//      not gated: the branch with its dunes not laid and with no desert dress
//      at all (desert-art.js setDunes / setDesertDress), to tell the cost of
//      the desert's dress from the rest.
//
// Not gated, printed beside them (each part can be skipped with its --no-…):
//   load    the tiles loaded on entering the Wilds in the web build: how many,
//           how long, how many failed
//   walk    the web build at 1920x1080, unthrottled: the hero stepped a tile
//           at a time 200 tiles east through the deep desert from (736, -78)
//           (four frames a step, foes taken away, noon, the land behind the
//           crests drawn as dim sand): chunk bakes a step, frame JS median,
//           p90 and worst, the first frame after a step
//   storm   the same walk on a fresh page with a storm blowing at full
//           strength, and before it, the frame on which the storm's haze tiles
//           are made, against the frames round it
//   big     part 3 at 1920x1080, noon and storm
//   heat    Electron, standing among the dunes at noon: heat on against off
//           (the shimmer), A/B pairs
//   stages  where a deep-desert piece's time goes, by stage (a CPU profile of
//           each tree generating the 20 deep pieces)
//
// Exits non-zero when a gate fails. About eight minutes with everything on
// (the gates alone, --no-heat --no-big --no-load --no-walk --no-storm
// --no-stages, about four and a half).
//
//   node tools/wilds/desert-perf.mjs [--shots <dir>] [--pairs 3] [--secs 5] [--web-secs 8] [--web-runs 3]
//        [--rate 4] [--seed 7] [--port 8097] [--base origin/main] [--gen-rounds 3] [--scratch <dir>]
//        [--no-sight] [--no-electron] [--no-heat] [--no-web] [--no-big] [--no-load] [--no-walk]
//        [--no-storm] [--no-gen] [--no-variants] [--no-stages]
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { chromium } from 'playwright-core'
import { APP_DIR, sleep, citySave, driver, launchGame, startWeb, launchWeb, enterWilds, noDamage, frameRate } from '../city/live.mjs'
import { stormOfDay, STORM } from '../../renderer/wilds/storm.js'
import { SIGHT } from '../../renderer/wilds/desert.js'
import { HEAT } from '../../renderer/wilds/heat.js'
import { DAY_LENGTH } from '../../renderer/data/weather.js'

const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const num = (k, d) => Number(opt(k, d))
const no = k => argv.includes(`--no-${k}`)
const PAIRS = num('--pairs', 3), SECS = num('--secs', 5), WEB_SECS = num('--web-secs', 8), WEB_RUNS = num('--web-runs', 3)
const RATE = num('--rate', 4), SEED = num('--seed', 7), PORT = num('--port', 8097), GEN_ROUNDS = num('--gen-rounds', 3)
const BASE = opt('--base', 'origin/main')
const SCRATCH = path.resolve(opt('--scratch', path.join(os.tmpdir(), 'dc-desert-perf')))
const SHOTS = argv.includes('--shots') ? path.resolve(opt('--shots')) : null
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const shot = (page, name) => SHOTS ? page.screenshot({ path: path.join(SHOTS, `perf-${name}.png`) }) : null
const GATE = { sightMs: 1, addMs: 1, fps: 30, genRatio: 1.3 }
// world tiles: among the deep dunes (Tasks 3-6 measured here, 4 tiles from a
// palm: the heat is on), and plain desert sand with no crest within 24 tiles
const DUNES = { X: 836, Y: -78 }, PLAIN = { X: 338, Y: 16 }
const WALK = { X0: 736, Y: -78, steps: 200, frames: 4 }
const NOON = 0.5 * DAY_LENGTH
const PROFILE = path.join(os.tmpdir(), 'dc-desert-perf-profile')
const fails = []
const mean = a => a.reduce((s, v) => s + v, 0) / a.length
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
// the gate's median of frame rates: on an even count the lower of the two in the middle, so
// two runs are judged by the slower (the upper middle would let the faster one pass the gate)
const slowMedian = a => { const s = [...a].sort((x, y) => x - y); return s[(s.length - 1) >> 1] }
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const f2 = v => v.toFixed(2)
// the first day with a storm whose peak is in the heat of the day, and that peak (seconds of the clock)
const STORMY = (() => {
  for (let day = 1; day < 200; day++) {
    const s = stormOfDay(SEED, day)
    if (!s) continue
    const peak = s.start + STORM.ramp + s.len / 2
    if (peak / DAY_LENGTH > HEAT.from + 0.02 && peak / DAY_LENGTH < HEAT.to - 0.02) return { day, start: s.start, peak }
  }
  return null
})()
const saveAt = pos => { const s = citySave({ seed: SEED, pos, frac: 0.5 }); s.wilds.day = STORMY?.day ?? 0; return s }

// A script in a fresh Node process, its printed JSON read back. Node on WSL
// now and then dies with SIGSEGV whatever it runs (CLAUDE.md): such a run is
// tried again, up to twice, and said.
function runNode(script, cwd = APP_DIR) {
  for (let i = 0; ; i++) {
    try {
      return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', cwd, maxBuffer: 64 << 20 }))
    } catch (e) {
      if (e.signal !== 'SIGSEGV' || i >= 2) throw e
      console.log('  (a Node child process died with SIGSEGV; run again)')
    }
  }
}

// ---- helpers on a page running the game (window.__dc) -------------------------------------
// The clock held at `clock` every frame; `storm` true lets the storm blow
// (no calm), false keeps it off whatever the day says.
const holdClock = (page, clock, storm = false) => page.evaluate(([c, storm]) => {
  window.__dc.wilds.calmUntil = storm ? 0 : Infinity
  const first = window.__hold === undefined
  window.__hold = c
  if (first) { const step = () => { if (window.__hold != null) window.__dc.save.clock = window.__hold; requestAnimationFrame(step) }; requestAnimationFrame(step) }
}, [clock, storm])
const clearFoes = page => page.evaluate(async () => {
  const { isEnemy } = await import(new URL('./systems/factions.js', location.href).href)
  const s = window.__dc.state
  s.entities = s.entities.filter(e => !isEnemy(e))
})
// heat kept off by a drink that does not wear off (true), or let be (false)
const heatOff = (page, off) => page.evaluate(off => { window.__dc.state.player.cooledUntil = off ? 1e12 : 0 }, off)
// The nearest walkable cell to a world tile that is no door, the hero put on it.
const placeOpen = (page, X, Y) => page.evaluate(([X, Y]) => {
  const s = window.__dc.state, o = window.__dc.wilds.origin, p = s.player
  const doors = new Set((s.houseDoors ?? []).flatMap(d => Array.from({ length: d.span ?? 1 }, (_, i) => `${d.x + i},${d.y}`)))
  for (let r = 0; r < 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    const x = X - o.wx * 80 + dx, y = Y - o.wy * 80 + dy
    if (s.map[y]?.[x]?.tile === 1 && !doors.has(`${x},${y}`)) { p.x = x; p.y = y; p.px = x * 32 + 16; p.py = y * 32 + 16; return { X: X + dx, Y: Y + dy } }
  }
  return null
}, [X, Y])
// Crest cells (losDune) within the desert's sight radius of where the hero
// stands, read from the live map: what tells the plain spot from the dunes.
const crestsInSight = page => page.evaluate(r => {
  const s = window.__dc.state, p = s.player
  let n = 0
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
    if (dx * dx + dy * dy <= r * r && s.map[p.y + dy]?.[p.x + dx]?.losDune) n++
  return n
}, SIGHT.desert)
// The place checked: none for the plain spot, some for the dunes (a failure is
// a gate failure: a later change to the dunes must not quietly turn the A/B
// into two dune places, or the web gate into one with no crest near).
async function checkPlace(page, where, name, want) {
  const n = await crestsInSight(page)
  const ok = want === 'none' ? n === 0 : n > 0
  if (!ok) fails.push(`${name}: ${n} crest cells within ${SIGHT.desert} tiles of the hero at ${where.X},${where.Y}, wanted ${want === 'none' ? 'none' : 'some'}`)
  return n
}
const state = page => page.evaluate(() => ({ storm: window.__dc.state.storm, heat: window.__dc.state.heat, regen: window.__dc.state.player.regenScale, sight: window.__dc.state.player._fovRadius }))
async function trace(app, page, secs, { walk = true } = {}) {
  const cdp = await app.context().newCDPSession(page)
  const events = []
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value))
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,blink',
    transferMode: 'ReportEvents',
  })
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
  const t0 = Date.now()
  if (walk) for (let i = 0; Date.now() - t0 < secs * 1000; i++) { await page.keyboard.down(keys[i % 4]); await sleep(700); await page.keyboard.up(keys[i % 4]) }
  else await sleep(secs * 1000)
  const done = new Promise(r => cdp.on('Tracing.tracingComplete', r))
  await cdp.send('Tracing.end'); await done
  await cdp.detach()
  const threads = {}
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads[`${e.pid}:${e.tid}`] = e.args.name
  const main = events.filter(e => e.ph === 'X' && threads[`${e.pid}:${e.tid}`] === 'CrRendererMain')
  const frames = main.filter(e => e.name === 'FireAnimationFrame').length || 1
  const per = n => main.filter(e => e.name === n).reduce((a, e) => a + e.dur, 0) / 1000 / frames
  return { js: per('FunctionCall'), raster: per('Canvas2DLayerBridge::flushRecording'), frames }
}

// ---- 1. sight, in a fresh process --------------------------------------------------------
if (!no('sight')) {
  const script = `
    const imp = p => import(${JSON.stringify(APP_DIR)} + '/' + p)
    const { computePlayerFOV, TILE } = await imp('renderer/systems/entities.js')
    const { generatePiece } = await imp('renderer/wilds/piece.js')
    const { SIGHT, BEACON_RANGE } = await imp('renderer/wilds/desert.js')
    const out = []
    for (const [cx, cy] of [[11, 0], [10, -1]]) {
      const ps = []
      for (let wy = cy - 1; wy <= cy + 1; wy++) for (let wx = cx - 1; wx <= cx + 1; wx++) ps.push(generatePiece(${SEED}, wx, wy, 0))
      const map = Array.from({ length: 240 }, (_, y) => Array.from({ length: 240 }, (_, x) => ps[Math.floor(y / 80) * 3 + Math.floor(x / 80)].cells[y % 80][x % 80]))
      const r = SIGHT.desert, crests = [], among = []
      for (let y = 80; y < 160; y++) for (let x = 80; x < 160; x++) {
        if (map[y][x].tile !== TILE.FLOOR) continue
        if (map[y][x].losDune) crests.push([x, y])
        let near = false
        for (let dy = -r; dy <= r && !near; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r && map[y + dy][x + dx].losDune) { near = true; break }
        if (near) among.push([x, y])
      }
      let s = 4242
      const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
      const viewer = { x: 0, y: 0 }
      const time = spots => {
        for (let i = 0; i < 200; i++) { [viewer.x, viewer.y] = spots[Math.floor(rnd() * spots.length)]; computePlayerFOV(map, viewer, r, { los: 'dunes', far: BEACON_RANGE }) }
        const ms = []
        for (let i = 0; i < 500; i++) {
          ;[viewer.x, viewer.y] = spots[Math.floor(rnd() * spots.length)]
          const t0 = process.hrtime.bigint()
          computePlayerFOV(map, viewer, r, { los: 'dunes', far: BEACON_RANGE })
          ms.push(Number(process.hrtime.bigint() - t0) / 1e6)
        }
        return ms
      }
      out.push({ window: cx + ',' + cy, crests: crests.length, among: among.length, fromCrest: time(crests), fromAmong: time(among) })
    }
    console.log(JSON.stringify(out))`
  const out = runNode(script)
  for (const w of out) {
    for (const [name, ms] of [['among the dunes (a crest within the radius)', w.fromAmong], ['from a crest', w.fromCrest]]) {
      const med = median(ms), p90 = q(ms, 0.9)
      console.log(`sight, window round ${w.window} (${w.crests} crest cells in the middle piece), ${name}: median ${med.toFixed(3)} ms, p90 ${p90.toFixed(3)} ms, max ${Math.max(...ms).toFixed(3)} ms (gate: median ${GATE.sightMs})${p90 > GATE.sightMs ? '; the p90 is over 1 ms' : ''}`)
      if (med > GATE.sightMs) fails.push(`sight median ${med.toFixed(3)} ms > ${GATE.sightMs} (${w.window}, ${name})`)
    }
  }
}

// ---- 2. JS per frame in Electron, plain sand vs among the dunes; heat on vs off ---------------
if (!no('electron') || !no('heat')) {
  const errors = []
  const { app, page } = await launchGame({ profile: PROFILE, save: saveAt(DUNES), errors })
  try {
    const d = driver(page)
    await enterWilds(page)
    await noDamage(page)
    await page.bringToFront()
    const spot = async (where, { heat = false } = {}) => {
      await d.goTo(where.X, where.Y)
      await placeOpen(page, where.X, where.Y)
      await clearFoes(page)
      await holdClock(page, NOON)
      await heatOff(page, !heat)
      await sleep(3500)   // the ring of pieces round the window made, the tiles baked, the shimmer settled
    }
    if (!no('electron')) {
      const rows = []
      for (let i = 0; i < PAIRS; i++) {
        await spot(PLAIN)
        const plainCrests = await checkPlace(page, PLAIN, `pair ${i + 1}, plain sand`, 'none')
        if (i === 0) await shot(page, 'plain')
        const a = await trace(app, page, SECS)
        await spot(DUNES)
        const duneCrests = await checkPlace(page, DUNES, `pair ${i + 1}, among the dunes`, 'some')
        if (i === 0) await shot(page, 'dunes')
        const b = await trace(app, page, SECS)
        if (i === 0) console.log(`  (crest cells within ${SIGHT.desert} tiles of the hero: plain sand ${plainCrests}, among the dunes ${duneCrests})`)
        for (const [r, name] of [[a, 'plain sand'], [b, 'the dunes']]) if (r.frames < SECS * 20) fails.push(`pair ${i + 1}: only ${r.frames} frames on ${name} (paused?)`)
        rows.push({ a, b })
        console.log(`pair ${i + 1}: plain sand (${PLAIN.X},${PLAIN.Y}) JS ${f2(a.js)} ms/frame, raster ${f2(a.raster)} | among the dunes (${DUNES.X},${DUNES.Y}) JS ${f2(b.js)}, raster ${f2(b.raster)} | difference JS ${f2(b.js - a.js)} ms, raster ${f2(b.raster - a.raster)}`)
      }
      const diff = mean(rows.map(r => r.b.js - r.a.js))
      console.log(`mean JS difference over ${PAIRS} pairs: ${f2(diff)} ms/frame (gate ${GATE.addMs}); raster ${f2(mean(rows.map(r => r.b.raster - r.a.raster)))} ms/frame`)
      if (diff > GATE.addMs) fails.push(`the dunes add ${f2(diff)} ms JS a frame > ${GATE.addMs}`)
    }
    if (!no('heat')) {
      // e. the heat's shimmer: standing among the dunes at noon, heat off then on
      const rows = []
      for (let i = 0; i < PAIRS; i++) {
        await spot(DUNES)
        const sa = await state(page)
        const a = await trace(app, page, SECS, { walk: false })
        await heatOff(page, false)
        await sleep(2500)
        const sb = await state(page)
        if (i === 0) await shot(page, 'heat')
        const b = await trace(app, page, SECS, { walk: false })
        rows.push({ a, b })
        console.log(`  (heat pair ${i + 1}: off (shimmer ${f2(sa.heat)}) JS ${f2(a.js)}, raster ${f2(a.raster)} | on (shimmer ${f2(sb.heat)}, regenScale ${sb.regen}) JS ${f2(b.js)}, raster ${f2(b.raster)} | difference JS ${f2(b.js - a.js)}, raster ${f2(b.raster - a.raster)})`)
      }
      console.log(`  (the heat's shimmer, mean over ${PAIRS} pairs: JS ${f2(mean(rows.map(r => r.b.js - r.a.js)))} ms/frame, raster ${f2(mean(rows.map(r => r.b.raster - r.a.raster)))} ms/frame; not gated)`)
    }
    const real = errors.filter(e => !(/assets\/[\w/-]+\.png/.test(e) && /net::ERR_FAILED/.test(e)))
    if (errors.length > real.length) console.log(`  (Electron: ${errors.length - real.length} tile pictures failed over file:// and were tried again)`)
    if (real.length) fails.push(`Electron errors: ${real.slice(0, 3).join(' | ')}`)
  } finally {
    await app.close()
  }
}

// ---- 3. the web build, CPU throttled; a. the tiles at Wilds entry ----------------------------
async function throttledFps(page, secs) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
  await sleep(1500)
  const r = await frameRate(page, secs)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await cdp.detach()
  return r
}
// Enter the Wilds from the title, counting the tiles fetched on the way in.
async function enterCounting(page) {
  const tiles = { asked: 0, failed: 0, bad: 0, done: 0, last: 0 }
  const isTile = u => /\/assets\/tiles\/[^/]+\.png/.test(u)
  page.on('request', r => { if (isTile(r.url())) tiles.asked++ })
  page.on('requestfailed', r => { if (isTile(r.url())) tiles.failed++ })
  page.on('response', r => { if (isTile(r.url())) { tiles.done++; tiles.last = Date.now(); if (r.status() >= 400) tiles.bad++ } })
  const missing = await page.evaluate(async () => {
    const { WILDS_SKINS } = await import(new URL('./wilds/terrain.js', location.href).href)
    const { INTERIOR_SKINS } = await import(new URL('./interior/kit.js', location.href).href)
    const { missingSprites } = await import(new URL('./render/sprites.js', location.href).href)
    return { names: new Set([...WILDS_SKINS, ...INTERIOR_SKINS]).size, missing: missingSprites(window.__dc.sprites ?? {}, [...WILDS_SKINS, ...INTERIOR_SKINS]).length }
  })
  const gaveUp = []
  page.on('console', m => { if (/Missing sprite/.test(m.text())) gaveUp.push(m.text()) })
  const t0 = Date.now()
  await enterWilds(page)
  const up = Date.now() - t0
  return { ...missing, ...tiles, up, lastTile: tiles.last ? tiles.last - t0 : null, gaveUp }
}
if (!no('web') || !no('big') || !no('load')) {
  const srv = await startWeb(PORT)
  try {
    const sizes = [...(!no('web') || !no('load') ? [[1024, 693, 'gate']] : []), ...(!no('big') ? [[1920, 1080, 'big']] : [])]
    const results = {}
    for (const [width, height, kind] of sizes) {
      const errors = []
      const { browser, page } = await launchWeb({ url: `http://localhost:${PORT}`, save: saveAt(DUNES), errors, width, height })
      try {
        const load = await enterCounting(page)
        if (kind === 'gate' && !no('load')) {
          console.log(`  (tiles at Wilds entry, web build: ${load.missing} of ${load.names} tile names to load, ${load.asked} fetched, ${load.failed} failed, ${load.bad} answered with an error, ${load.gaveUp.length} given up; the Wilds up after ${(load.up / 1000).toFixed(2)} s, the last tile in at ${load.lastTile === null ? '-' : (load.lastTile / 1000).toFixed(2) + ' s'})`)
        }
        if (kind === 'gate' && no('web')) continue
        await noDamage(page)
        // among the dunes, as gate 2's dunes side: the hero put on the nearest open cell to the spot, which must have crests in sight
        await placeOpen(page, DUNES.X, DUNES.Y)
        await clearFoes(page)
        await holdClock(page, NOON)
        await sleep(3000)
        const crests = kind === 'gate' ? await checkPlace(page, DUNES, `web build ${width}x${height}`, 'some') : await crestsInSight(page)
        console.log(`  (web build ${width}x${height}: ${crests} crest cells within ${SIGHT.desert} tiles of the hero)`)
        const runs = kind === 'gate' ? WEB_RUNS : 1
        const rows = []
        for (let i = 0; i < runs; i++) {
          await holdClock(page, NOON)
          await sleep(STORM.ramp * 1000 + 1500)   // a storm before eased out, the shimmer in
          const sn = await state(page)
          const a = await throttledFps(page, WEB_SECS)
          if (i === 0) await shot(page, `web-noon-${width}`)
          if (!STORMY) {
            // (the gated run needs its storm; the ungated large size only says so)
            if (kind === 'gate') fails.push(`web build in a storm, run ${i + 1}: seed ${SEED} has no storm peaking in daylight within 200 days, so the storm half of the gate could not run`)
            else console.log(`  (web build ${width}x${height}, run ${i + 1}: no storm in daylight for seed ${SEED}; the storm half not run)`)
            rows.push({ a, b: null })
            continue
          }
          await holdClock(page, STORMY.peak, true)
          await sleep(STORM.ramp * 1000 + 1500)
          const ss = await state(page)
          const b = await throttledFps(page, WEB_SECS)
          if (i === 0) await shot(page, `web-storm-${width}`)
          rows.push({ a, b })
          // (a single run under the gate's fps is marked; the gate is the median of the runs)
          const under = r => kind === 'gate' && !(r.fps > GATE.fps) ? ` [this run under ${GATE.fps}]` : ''
          const line = `web build ${width}x${height}, CPU ${RATE}x throttled, among the dunes, run ${i + 1}: noon ${a.fps} fps${under(a)} (frame p50 ${a.p50}, p95 ${a.p95} ms; shimmer ${f2(sn.heat)}) | storm ${b.fps} fps${under(b)} (p50 ${b.p50}, p95 ${b.p95} ms; strength ${f2(ss.storm)}, lit radius ${ss.sight})`
          console.log(kind === 'gate' ? line : `  (${line}; not gated)`)
          if (ss.storm < 0.99) fails.push(`${width}x${height} run ${i + 1}: the storm did not blow (${ss.storm})`)
        }
        results[kind] = rows
        if (kind === 'gate') {
          // judged on the median of the runs, noon and storm apart: one
          // loaded run neither fails the gate nor passes it
          const noon = slowMedian(rows.map(r => r.a.fps)), stormy = rows.every(r => r.b) ? slowMedian(rows.map(r => r.b.fps)) : null
          console.log(`web build ${width}x${height}, CPU ${RATE}x throttled, median of ${rows.length} runs: noon ${noon} fps | storm ${stormy ?? '-'} fps (gate: each median > ${GATE.fps} fps)`)
          if (!(noon > GATE.fps)) fails.push(`web build at noon: median ${noon} fps of ${rows.length} runs at ${RATE}x throttle <= ${GATE.fps}`)
          if (stormy !== null && !(stormy > GATE.fps)) fails.push(`web build in a storm: median ${stormy} fps of ${rows.length} runs at ${RATE}x throttle <= ${GATE.fps}`)
        }
        if (errors.length) fails.push(`web errors (${width}x${height}): ${errors.slice(0, 3).join(' | ')}`)
      } finally {
        await browser.close()
      }
    }
    if (results.gate && results.big) console.log(`  (web build, means: 1024x693 noon ${f2(mean(results.gate.map(r => r.a.fps)))} / storm ${f2(mean(results.gate.map(r => r.b?.fps ?? 0)))} fps; 1920x1080 noon ${f2(mean(results.big.map(r => r.a.fps)))} / storm ${f2(mean(results.big.map(r => r.b?.fps ?? 0)))} fps)`)
  } finally {
    srv.kill()
  }
}

// ---- b. c. walking the deep desert, clear and in a storm -------------------------------------
// The web build at 1920x1080, unthrottled, a page of its own with the game
// loop's frames timed and the chunk bakes counted (a clearRect of a whole
// 512-px chunk canvas, render/tile-layer.js).
async function walkPage(port, errors) {
  const browser = await chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  await page.addInitScript(s => {
    if (!sessionStorage.getItem('t7-seeded')) { localStorage.setItem('dungeon-crawler-wilds', s); sessionStorage.setItem('t7-seeded', '1') }
    localStorage.setItem('dc-settings', JSON.stringify({ v: 1, volume: 1, muted: true, minimap: false }))
    const raw = window.requestAnimationFrame.bind(window)
    window.__raw = raw
    window.__ft = []
    window.requestAnimationFrame = cb => raw(t => {
      if (cb.name !== 'gameLoop') return cb(t)
      const s = performance.now()
      try { cb(t) } finally { window.__ft.push([performance.now() - s, window.__dc?.renderer?.weatherLayer?.haze?.size ?? 0]) }
    })
    window.__bakes = 0
    const cr = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) {
      if (x === 0 && y === 0 && w === 512 && h === 512 && this.canvas.width === 512 && this.canvas.height === 512) window.__bakes++
      return cr.call(this, x, y, w, h)
    }
  }, JSON.stringify(saveAt({ X: WALK.X0, Y: WALK.Y })))
  await page.goto(`http://localhost:${port}/?dcdebug`)
  await page.getByText('Adventure', { exact: true }).first().waitFor({ timeout: 30_000 })
  await enterWilds(page)
  await noDamage(page)
  return { browser, page }
}
async function walkLine(page) {
  const d = driver(page)
  const frames = n => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : window.__raw(f)); window.__raw(f) }), n)
  await clearFoes(page)
  await page.evaluate(() => { window.__ft.length = 0; window.__bakes = 0 })
  const steps = []
  for (let i = 1; i <= WALK.steps; i++) {
    await d.placeWorld(WALK.X0 + i, WALK.Y)
    await clearFoes(page)
    await frames(WALK.frames)
    steps.push(await page.evaluate(() => { const r = { ft: window.__ft.map(f => f[0]), bakes: window.__bakes }; window.__ft.length = 0; window.__bakes = 0; return r }))
  }
  const all = steps.flatMap(s => s.ft), first = steps.map(s => s.ft[0] ?? 0), bakes = steps.map(s => s.bakes)
  const guessed = await page.evaluate(() => { let n = 0; for (const row of window.__dc.state.map) for (const c of row) if (c.guessed && !c.explored) n++; return n })
  return {
    end: await d.playerWorld(), bakes: mean(bakes), bakesMax: Math.max(...bakes),
    median: median(all), p90: q(all, 0.9), worst: Math.max(...all), mean: mean(all),
    first: median(first), over30: steps.filter(s => s.ft.some(t => t > 30)).length, guessed,
  }
}
const walkLineText = w => `${f2(w.bakes)} chunk bakes a step (most ${w.bakesMax}); frame JS median ${f2(w.median)} ms, mean ${f2(w.mean)}, p90 ${f2(w.p90)}, worst ${f2(w.worst)}; first frame after a step, median ${f2(w.first)} ms; ${w.over30} steps with a frame over 30 ms; ${w.guessed} cells drawn as dim sand in the window at the end; ended at ${w.end.X},${w.end.Y}`
if (!no('walk') || !no('storm')) {
  const srv = await startWeb(PORT)
  try {
    if (!no('walk')) {
      const errors = []
      const { browser, page } = await walkPage(PORT, errors)
      try {
        await holdClock(page, NOON)
        await sleep(3000)
        const w = await walkLine(page)
        await shot(page, 'walk-end')
        console.log(`  (walking the deep desert, 1920x1080, ${WALK.steps} steps east from ${WALK.X0},${WALK.Y} at noon: ${walkLineText(w)}; not gated)`)
        if (errors.length) fails.push(`walk page errors: ${errors.slice(0, 3).join(' | ')}`)
      } finally { await browser.close() }
    }
    if (!no('storm') && !STORMY) console.log(`  (walking through a storm: seed ${SEED} has no storm peaking in daylight within 200 days; not run)`)
    if (!no('storm') && STORMY) {
      const errors = []
      const { browser, page } = await walkPage(PORT, errors)
      try {
        await holdClock(page, NOON)
        await sleep(3000)
        // the storm coming in: the frame on which its haze tiles are made
        await page.evaluate(() => { window.__ft.length = 0 })
        await holdClock(page, STORMY.start + 1, true)
        await sleep(2500)
        const ft = await page.evaluate(() => { const r = window.__ft.slice(); window.__ft.length = 0; return r })
        const k = ft.findIndex(f => f[1] > 0)
        const around = ft.filter((_, i) => i !== k).map(f => f[0])
        if (k >= 0) console.log(`  (a storm coming in: the haze tiles made on frame ${k + 1} of ${ft.length}, that frame ${f2(ft[k][0])} ms of JS; the frames round it median ${f2(median(around))} ms, worst ${f2(Math.max(...around))} ms; the ${Math.min(5, ft.length - k - 1)} frames after it ${ft.slice(k + 1, k + 6).map(f => f2(f[0])).join(' ')})`)
        else console.log('  (a storm coming in: no haze tiles were made: the storm did not reach the hero)')
        await holdClock(page, STORMY.peak, true)
        await sleep(STORM.ramp * 1000 + 1500)
        const s = await state(page)
        const w = await walkLine(page)
        const after = await state(page)
        await shot(page, 'walk-storm-end')
        console.log(`  (walking the same line through a storm (strength ${f2(s.storm)} at the start, ${f2(after.storm)} at the end, lit radius ${after.sight}), fresh page: ${walkLineText(w)}; not gated)`)
        if (errors.length) fails.push(`storm walk page errors: ${errors.slice(0, 3).join(' | ')}`)
      } finally { await browser.close() }
    }
  } finally {
    srv.kill()
  }
}

// ---- 4. piece generation against the base; f. where a deep piece's time goes ----------------
// Seed's desert pieces outward from home, ring by ring (never a city piece):
// the first 20 not wholly 7 pieces out, and the first 20 wholly 7 or more out.
async function desertPieces() {
  const { pieceBiome } = await import('../../renderer/wilds/layout.js')
  const { isCityPiece } = await import('../../renderer/wilds/city/geometry.js')
  const allDeep = (wx, wy) => [[0, 0], [79, 0], [0, 79], [79, 79]].every(([x, y]) => Math.hypot((wx * 80 + x - 40) / 80, (wy * 80 + y - 40) / 80) >= 7)
  const near = [], deep = []
  for (let r = 2; r <= 14 && (near.length < 20 || deep.length < 20); r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r || isCityPiece(wx, wy) || pieceBiome(SEED, wx, wy) !== 'desert') continue
    if (allDeep(wx, wy)) { if (deep.length < 20) deep.push([wx, wy]) } else if (near.length < 20) near.push([wx, wy])
  }
  return { near, deep }
}
// One fresh process on one tree: every piece generated once to warm up, then
// once timed. Resolves the times (ms) in order.
function timeTree(root, pieces, setup = '') {
  const script = `
    ${setup}
    const { generatePiece } = await import(${JSON.stringify(root + '/renderer/wilds/piece.js')})
    const pieces = ${JSON.stringify(pieces)}
    for (const [wx, wy] of pieces) generatePiece(${SEED}, wx, wy, 0)
    const out = []
    for (const [wx, wy] of pieces) { const t0 = performance.now(); generatePiece(${SEED}, wx, wy, 0); out.push(performance.now() - t0) }
    console.log(JSON.stringify(out))`
  return runNode(script, root)
}
// One fresh process on one tree, profiled: the pieces generated once to warm
// up, then three times under the CPU profiler; time a piece by stage (a
// sample counts toward every stage on its stack) and by file (self time).
function stagesOf(root, pieces) {
  const script = `
    import { Session } from 'node:inspector/promises'
    const { generatePiece } = await import(${JSON.stringify(root + '/renderer/wilds/piece.js')})
    const pieces = ${JSON.stringify(pieces)}
    for (const [wx, wy] of pieces) generatePiece(${SEED}, wx, wy, 0)
    const s = new Session(); s.connect()
    await s.post('Profiler.enable'); await s.post('Profiler.setSamplingInterval', { interval: 100 }); await s.post('Profiler.start')
    const ROUNDS = 3
    for (let k = 0; k < ROUNDS; k++) for (const [wx, wy] of pieces) generatePiece(${SEED}, wx, wy, 0)
    const { profile } = await s.post('Profiler.stop')
    const byId = new Map(profile.nodes.map(n => [n.id, n]))
    const parent = new Map()
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
    const file = n => (n.callFrame.url.split('/').pop() || '(native)')
    const STAGES = [
      ['generatePiece', n => n.callFrame.functionName === 'generatePiece'],
      ['makeTerrain', n => n.callFrame.functionName === 'makeTerrain'],
      ['placeFeatures', n => n.callFrame.functionName === 'placeFeatures'],
      ['  sites.js (stamping the sites)', n => file(n) === 'sites.js'],
      ['  roads.js (the network)', n => file(n) === 'roads.js'],
      ['finish (the art passes)', n => n.callFrame.functionName === 'finish' && file(n) === 'terrain.js'],
      ['  edgeHardpan', n => n.callFrame.functionName === 'edgeHardpan'],
      ['  layDunes', n => n.callFrame.functionName === 'layDunes'],
      ['  vergeRoads', n => n.callFrame.functionName === 'vergeRoads'],
      ['  skinBridges', n => n.callFrame.functionName === 'skinBridges'],
      ['  slopeShores', n => n.callFrame.functionName === 'slopeShores'],
      ['  shoreline', n => n.callFrame.functionName === 'shoreline'],
      ['  stamp*Edge / stampMountainRim', n => /^stamp(SandEdge|GroundEdge|MountainRim)$/.test(n.callFrame.functionName)],
      ['duneField (anywhere)', n => n.callFrame.functionName === 'duneField'],
      ['desert-art.js (anywhere)', n => file(n) === 'desert-art.js'],
      ['cellOf (the game cells)', n => n.callFrame.functionName === 'cellOf'],
      ['reachable', n => n.callFrame.functionName === 'reachable' && file(n) === 'piece.js'],
      ['openTops', n => n.callFrame.functionName === 'openTops'],
    ]
    const incl = new Map(STAGES.map(([k]) => [k, 0])), self = new Map()
    const dts = profile.timeDeltas
    for (let i = 0; i < profile.samples.length; i++) {
      const dt = (dts[i + 1] ?? dts[i]) / 1000
      let n = byId.get(profile.samples[i])
      self.set(file(n), (self.get(file(n)) ?? 0) + dt)
      const hit = new Set()
      for (; n; n = byId.get(parent.get(n.id))) for (const [k, test] of STAGES) if (!hit.has(k) && test(n)) hit.add(k)
      for (const k of hit) incl.set(k, incl.get(k) + dt)
    }
    const per = pieces.length * ROUNDS
    console.log(JSON.stringify({ stages: [...incl].map(([k, v]) => [k, v / per]), files: [...self].map(([k, v]) => [k, v / per]).sort((a, b) => b[1] - a[1]) }))`
  return runNode(script, root)
}
if (!no('gen') || !no('stages')) {
  const { near, deep } = await desertPieces()
  const pieces = [...near, ...deep]
  const sha = execFileSync('git', ['rev-parse', '--short', BASE], { cwd: APP_DIR, encoding: 'utf8' }).trim()
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: APP_DIR, encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'renderer'], { cwd: APP_DIR, encoding: 'utf8' }).trim() !== ''
  // the base's renderer/ (and the package.json that makes its .js modules)
  // unpacked from `git archive` into the scratch folder: nothing is
  // registered in the repository, so a run cut short leaves only a folder
  const baseDir = path.join(SCRATCH, `base-${sha}`), baseTar = `${baseDir}.tar`
  fs.rmSync(baseDir, { recursive: true, force: true })
  fs.mkdirSync(baseDir, { recursive: true })
  execFileSync('git', ['archive', '--format=tar', '-o', baseTar, BASE, 'package.json', 'renderer'], { cwd: APP_DIR })
  execFileSync('tar', ['-xf', baseTar, '-C', baseDir])
  fs.rmSync(baseTar, { force: true })
  try {
    console.log(`piece generation, seed ${SEED}: the branch (${head}${dirty ? ', with its uncommitted changes under renderer/' : ''}) against ${BASE} (${sha}) in ${baseDir}`)
    console.log(`  near (${near.length}): ${near.map(p => p.join(',')).join(' ')}`)
    console.log(`  deep (${deep.length}): ${deep.map(p => p.join(',')).join(' ')}`)
    if (!no('gen')) {
      // the base, the branch, and (not gated, to tell the desert's dress
      // from the rest) the branch with its dunes not laid and with no desert
      // dress at all (desert-art.js setDunes / setDesertDress: the dune field
      // is still worked out, for where things grow)
      const art = JSON.stringify(APP_DIR + '/renderer/wilds/desert-art.js')
      const variants = [
        ['base', baseDir, ''], ['branch', APP_DIR, ''],
        ...(no('variants') ? [] : [
          ['branch, dunes not laid', APP_DIR, `const art = await import(${art}); art.setDunes(false)`],
          ['branch, no desert dress', APP_DIR, `const art = await import(${art}); art.setDesertDress(false)`],
        ]),
      ]
      const best = Object.fromEntries(variants.map(([name]) => [name, pieces.map(() => Infinity)]))
      for (let r = 0; r < GEN_ROUNDS; r++) {
        // each round in another order: the first variant of the last round goes last
        const order = variants.map((_, i) => variants[(i + r) % variants.length])
        const line = []
        for (const [name, root, setup] of order) {
          const t = timeTree(root, pieces, setup)
          t.forEach((v, i) => { best[name][i] = Math.min(best[name][i], v) })
          line.push(`${name} total ${t.reduce((a, b) => a + b, 0).toFixed(0)} ms (median ${median(t).toFixed(1)})`)
        }
        console.log(`  round ${r + 1}: ${line.join(', ')}`)
      }
      const sum = a => a.reduce((x, y) => x + y, 0)
      const part = (lo, hi) => {
        const a = best.base.slice(lo, hi), b = best.branch.slice(lo, hi)
        return { base: sum(a), branch: sum(b), ratio: sum(b) / sum(a), medBase: median(a), medBranch: median(b), medRatio: median(b) / median(a) }
      }
      const all = part(0, pieces.length), n = part(0, near.length), dp = part(near.length, pieces.length)
      for (const [name, p] of [['near', n], ['deep', dp], ['all 40', all]]) {
        console.log(`  ${name}: best of ${GEN_ROUNDS} a piece, base mean ${(p.base / (name === 'all 40' ? pieces.length : 20)).toFixed(1)} ms, branch mean ${(p.branch / (name === 'all 40' ? pieces.length : 20)).toFixed(1)} ms: ratio ${p.ratio.toFixed(2)}x (medians ${p.medBase.toFixed(1)} -> ${p.medBranch.toFixed(1)} ms, ${p.medRatio.toFixed(2)}x)${name === 'all 40' ? ` (gate ${GATE.genRatio}x)` : ''}`)
      }
      for (const [name] of variants.slice(2)) {
        const ratio = lo => sum(best[name].slice(lo[0], lo[1])) / sum(best.base.slice(lo[0], lo[1]))
        console.log(`  (${name}: near ${ratio([0, near.length]).toFixed(2)}x, deep ${ratio([near.length, pieces.length]).toFixed(2)}x, all 40 ${ratio([0, pieces.length]).toFixed(2)}x the base; not gated)`)
      }
      if (all.ratio > GATE.genRatio) fails.push(`piece generation ${all.ratio.toFixed(2)}x ${BASE} > ${GATE.genRatio}x`)
    }
    if (!no('stages')) {
      const a = stagesOf(baseDir, deep), b = stagesOf(APP_DIR, deep)
      const bm = new Map(b.stages)
      console.log(`  (where a deep-desert piece's time goes, ms a piece, CPU profile of the 20 deep pieces x3, inclusive: a stage's own work and what it calls)`)
      console.log(`  (${'stage'.padEnd(36)} ${'base'.padStart(7)} ${'branch'.padStart(7)}  added)`)
      for (const [k, v] of a.stages) console.log(`  (${k.padEnd(36)} ${v.toFixed(2).padStart(7)} ${bm.get(k).toFixed(2).padStart(7)}  ${(bm.get(k) - v >= 0 ? '+' : '') + (bm.get(k) - v).toFixed(2)})`)
      const af = new Map(a.files), files = [...new Set([...b.files.slice(0, 10).map(f => f[0]), ...a.files.slice(0, 6).map(f => f[0])])]
      const bf = new Map(b.files)
      console.log(`  (self time by file, ms a piece: ${files.map(f => `${f} ${(af.get(f) ?? 0).toFixed(2)} -> ${(bf.get(f) ?? 0).toFixed(2)}`).join('; ')})`)
    }
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true })
  }
}

console.log(fails.length ? `DESERT PERF: FAILED\n  ${fails.join('\n  ')}` : 'DESERT PERF: within the gates')
process.exit(fails.length ? 1 : 0)
