// Kalevanlinna's performance gates (spec R1), measured on this machine:
//
//   1. building: buildCity(seed) once per world, warm ≤ 200 ms (the cold
//      first build in a fresh process is shown too: it is paid at Wilds entry),
//      and generateCityPiece from a built city ≤ 10 ms;
//   2. JS per frame: Electron traces of `--secs` seconds on a plain Wilds
//      piece and on the square, back to back, `--pairs` times; the city may
//      add ≤ 4 ms JS a frame on average (canvas raster per frame shown too);
//   3. the web build (npm run web) in headless Chromium with the CPU
//      throttled 4x on the square for `--web-secs` seconds: above 30 fps
//      (and the same on a plain Wilds piece, for comparison);
//   4. walking at night on the web build, throttled the same: the player
//      walks the market street north of the square down and up for
//      `--walk-secs` seconds with the clock at `--night-frac` (0.92: every
//      lamp lit, the windows of who is home), then the same walk at
//      `--frac` for comparison (not gated: walking costs frames by day too,
//      and the night must not cost more). Gated: above 30 fps, and no rebuild
//      storm of the kept night mask (render/weather.js): no more builds than
//      the view can leave it (one per NIGHT_PAD px walked) plus a few for
//      lights that really change, and almost no frame drawn straight on.
//
// Both runs start from a Wilds save (throwaway profile / localStorage) at the
// square with the clock at `--frac` of the day (0.47: noon). Exits non-zero
// when a gate fails. About 2.5 minutes with the defaults.
//
//   node tools/city/perf.mjs [--pairs 3] [--secs 5] [--web-secs 10] [--walk-secs 10] [--rate 4]
//        [--frac 0.47] [--night-frac 0.92] [--seed 7] [--port 8080] [--shots <dir>]
//        [--no-build] [--no-electron] [--no-web] [--no-web-plain] [--no-walk]
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { APP_DIR, SQUARE, sleep, citySave, driver, launchGame, startWeb, launchWeb, enterWilds, noDamage, frameRate, frameStats } from './live.mjs'
import { NIGHT_PAD } from '../../renderer/render/weather.js'

const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d }
const PAIRS = opt('--pairs', 3), SECS = opt('--secs', 5), WEB_SECS = opt('--web-secs', 10), RATE = opt('--rate', 4)
const FRAC = opt('--frac', 0.47), SEED = opt('--seed', 7), PORT = opt('--port', 8080)
const WALK_SECS = opt('--walk-secs', WEB_SECS), NIGHT_FRAC = opt('--night-frac', 0.92)
// walking: builds of the kept night mask beyond one per NIGHT_PAD px walked,
// and the share of lit frames drawn straight on (each one costs the full wash)
const GATE = { addMs: 4, fps: 30, buildMs: 200, pieceMs: 10, extraBuilds: 4, straight: 0.02 }
// the market street north of the square (world tiles), walked down and up
const STREET = { X: 80, Y: 202 }
const PROFILE = path.join(os.tmpdir(), 'dc-city-perf')
const fails = []
const SHOTS = argv.includes('--shots') ? path.resolve(argv[argv.indexOf('--shots') + 1]) : null
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const shot = (page, name) => SHOTS ? page.screenshot({ path: path.join(SHOTS, `perf-${name}.png`) }) : null
const mean = a => a.reduce((s, v) => s + v, 0) / a.length
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1]

// ---- 1. building, in a fresh process -------------------------------------------
if (!argv.includes('--no-build')) {
  const script = `
    const { buildCity } = await import(${JSON.stringify(path.join(APP_DIR, 'renderer/wilds/city/build.js'))})
    const { generateCityPiece } = await import(${JSON.stringify(path.join(APP_DIR, 'renderer/wilds/city/piece.js'))})
    const t = f => { const t0 = performance.now(); f(); return performance.now() - t0 }
    const cold = t(() => buildCity(${SEED}))
    const warm = []
    for (let i = 0; i < 9; i++) warm.push(t(() => buildCity(${SEED} + 1000 + i)))
    const piece = [[0, 2], [1, 2], [0, 3], [1, 3]].map(([wx, wy]) => t(() => generateCityPiece(${SEED} + 1008, wx, wy)))
    console.log(JSON.stringify({ cold, warm, piece }))`
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }))
  const warm = median(out.warm.slice(3)), piece = Math.max(...out.piece)
  console.log(`buildCity: cold ${out.cold.toFixed(0)} ms (paid once at Wilds entry); warm ${out.warm.map(v => v.toFixed(0)).join(' ')} ms, median after three ${warm.toFixed(0)} ms (gate ${GATE.buildMs})`)
  console.log(`generateCityPiece: ${out.piece.map(v => v.toFixed(1)).join(' ')} ms (gate ${GATE.pieceMs})`)
  if (warm > GATE.buildMs) fails.push(`warm buildCity ${warm.toFixed(0)} ms > ${GATE.buildMs}`)
  if (piece > GATE.pieceMs) fails.push(`generateCityPiece ${piece.toFixed(1)} ms > ${GATE.pieceMs}`)
}

// ---- 2. JS per frame in Electron, plain Wilds vs the square ------------------------
// The plain piece: wild land with the city out of the window (its runtime
// dropped), the same time of day, the same walk.
async function trace(app, page, secs) {
  const cdp = await app.context().newCDPSession(page)
  const events = []
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value))
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,blink',
    transferMode: 'ReportEvents',
  })
  // a walk round a square, as tools/perf/trace.mjs does
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
  const t0 = Date.now()
  for (let i = 0; Date.now() - t0 < secs * 1000; i++) {
    await page.keyboard.down(keys[i % 4]); await sleep(700); await page.keyboard.up(keys[i % 4])
  }
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

if (!argv.includes('--no-electron')) {
  const errors = []
  const { app, page } = await launchGame({ profile: PROFILE, save: citySave({ seed: SEED, pos: SQUARE, frac: FRAC }), errors })
  try {
    const d = driver(page)
    await enterWilds(page)
    await noDamage(page)
    await page.bringToFront()
    // a wild piece to the north-west, no village on it, with the city out of the window
    const plain = await d.ev(() => {
      const w = window.__dc.wilds
      for (const [wx, wy] of [[-2, 0], [-2, -1], [2, -1], [-3, 1], [3, 0]]) {
        const p = w.pieces.get(`${wx},${wy}`)
        if (!p || !p.village) return { X: wx * 80 + 40, Y: wy * 80 + 40, wx, wy }
      }
      return { X: -120, Y: 40, wx: -2, wy: 0 }
    })
    const spot = async where => {
      await d.goTo(where.X, where.Y)
      // stand on open ground near there
      await d.ev(([X, Y]) => {
        const s = window.__dc.state, o = window.__dc.wilds.origin, p = s.player
        for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = X - o.wx * 80 + dx, y = Y - o.wy * 80 + dy
          if (s.map[y]?.[x]?.tile === 1 && s.map[y][x + 1]?.tile === 1 && s.map[y + 1]?.[x]?.tile === 1) { p.x = x; p.y = y; p.px = x * 32 + 16; p.py = y * 32 + 16; return }
        }
      }, [where.X, where.Y])
      await d.setFrac(FRAC)
      await sleep(3000)   // the town placed by the clock, the tiles baked
      await d.setFrac(FRAC)
    }
    const rows = []
    for (let i = 0; i < PAIRS; i++) {
      await spot(plain)
      if (i === 0) await shot(page, 'plain')
      const a = await trace(app, page, SECS)
      const aRun = await d.ev(() => !!window.__dc.state.cityRun)
      if (a.frames < SECS * 20) fails.push(`pair ${i + 1}: only ${a.frames} frames on the plain piece (paused?)`)
      await spot(SQUARE)
      if (i === 0) await shot(page, 'square')
      const b = await trace(app, page, SECS)
      const people = await d.ev(() => window.__dc.state.entities.filter(e => e.cityKey !== undefined).length)
      if (b.frames < SECS * 20) fails.push(`pair ${i + 1}: only ${b.frames} frames on the square (paused?)`)
      rows.push({ a, b, aRun, people })
      console.log(`pair ${i + 1}: plain Wilds (${plain.wx},${plain.wy}) JS ${a.js.toFixed(2)} ms/frame, raster ${a.raster.toFixed(2)}${aRun ? ' (city runtime still up!)' : ''}`
        + ` | square JS ${b.js.toFixed(2)}, raster ${b.raster.toFixed(2)}, ${people} city entities | difference JS ${(b.js - a.js).toFixed(2)} ms`)
    }
    const diff = mean(rows.map(r => r.b.js - r.a.js))
    console.log(`mean JS difference over ${PAIRS} pairs: ${diff.toFixed(2)} ms/frame (gate ${GATE.addMs}); raster ${mean(rows.map(r => r.b.raster - r.a.raster)).toFixed(2)} ms/frame`)
    if (diff > GATE.addMs) fails.push(`the city adds ${diff.toFixed(2)} ms JS a frame > ${GATE.addMs}`)
    if (rows.some(r => r.aRun)) fails.push('the city runtime was up on the plain piece')
    if (errors.length) fails.push(`Electron errors: ${errors.slice(0, 3).join(' | ')}`)
  } finally {
    await app.close()
  }
}

// ---- 3. the web build, CPU throttled ------------------------------------------------
// The nearest open cell to a world tile, and the player put on it (never a
// door: stepping on one goes in).
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

// `secs` seconds walking down and up (3 s each way) with the CPU throttled:
// the frame rate, the path walked (px, both axes summed: the view can leave
// the kept night mask at most once per NIGHT_PAD px of it) and the mask's
// builds and frames drawn straight on (render/weather.js counts them).
async function walkRate(page, cdp, secs) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
  await sleep(1500)
  const measured = page.evaluate(secs => new Promise(res => {
    const dc = window.__dc, night = () => dc.renderer?.weatherLayer?.night
    const b0 = night()?.builds ?? 0, s0 = night()?.straight ?? 0
    const ts = [], t0 = performance.now()
    let path = 0, last = null
    const step = t => {
      ts.push(t)
      const p = dc.state.player, o = dc.wilds.origin
      const X = p.px + o.wx * 2560, Y = p.py + o.wy * 2560
      if (last) path += Math.abs(X - last.X) + Math.abs(Y - last.Y)
      last = { X, Y }
      if (t - t0 < secs * 1000) requestAnimationFrame(step)
      else res({ ts, path, builds: (night()?.builds ?? 0) - b0, straight: (night()?.straight ?? 0) - s0, lights: dc.state.weather?.look?.lights?.length ?? 0 })
    }
    requestAnimationFrame(step)
  }), secs)
  const t0 = Date.now()
  for (let i = 0; Date.now() - t0 < secs * 1000; i++) {
    const key = i % 2 ? 'ArrowUp' : 'ArrowDown'
    await page.keyboard.down(key)
    await sleep(Math.max(0, Math.min(3000, secs * 1000 - (Date.now() - t0))))
    await page.keyboard.up(key)
  }
  const m = await measured
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  return { ...frameStats(m.ts), path: Math.round(m.path), builds: m.builds, straight: m.straight, lights: m.lights }
}

if (!argv.includes('--no-web')) {
  const errors = []
  const srv = await startWeb(PORT)
  let browser
  try {
    const web = await launchWeb({ url: `http://localhost:${PORT}`, save: citySave({ seed: SEED, pos: SQUARE, frac: FRAC }), errors })
    browser = web.browser
    const page = web.page, d = driver(page)
    await enterWilds(page)
    await noDamage(page)
    await d.setFrac(FRAC)
    await sleep(3000)
    await d.setFrac(FRAC)
    const cdp = await page.context().newCDPSession(page)
    const throttled = async () => {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
      await sleep(1500)
      const r = await frameRate(page, WEB_SECS)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
      return r
    }
    const r = await throttled()
    await shot(page, 'web-square')
    const people = await d.ev(() => window.__dc.state.entities.filter(e => e.cityKey !== undefined).length)
    console.log(`web build, CPU ${RATE}x throttled, square: ${r.fps} fps (frame p50 ${r.p50} ms, p95 ${r.p95} ms), ${people} city entities (gate > ${GATE.fps} fps)`)
    // for comparison, the same on a plain Wilds piece (not gated)
    if (!argv.includes('--no-web-plain')) {
      await d.goTo(-120, 40)
      await d.setFrac(FRAC)
      await sleep(2000)
      const p = await throttled()
      console.log(`  (for comparison, a plain Wilds piece: ${p.fps} fps, frame p50 ${p.p50} ms, p95 ${p.p95} ms; city runtime up: ${await d.ev(() => !!window.__dc.state.cityRun)})`)
    }
    if (!(r.fps > GATE.fps)) fails.push(`web build ${r.fps} fps at ${RATE}x throttle <= ${GATE.fps}`)
    // ---- 4. walking the market street, at night and at noon ----
    if (!argv.includes('--no-walk')) {
      const walk = async (frac, name) => {
        // out of the city's reach and back with the clock set: everyone stands where it says
        await d.goTo(-120, 40)
        await d.setFrac(frac)
        await sleep(1000)
        await d.goTo(STREET.X, STREET.Y)
        await placeOpen(page, STREET.X, STREET.Y)
        await d.setFrac(frac)
        await sleep(3000)
        await d.setFrac(frac)
        const w = await walkRate(page, cdp, WALK_SECS)
        await shot(page, `web-walk-${name}`)
        const allowed = Math.floor(w.path / NIGHT_PAD) + 1 + GATE.extraBuilds
        console.log(`web build, CPU ${RATE}x throttled, walking the market street at ${frac} (${name}): ${w.fps} fps (frame p50 ${w.p50} ms, p95 ${w.p95} ms), `
          + `${w.path} px walked; kept night mask: ${w.builds} builds (the view can leave it ${Math.floor(w.path / NIGHT_PAD) + 1} times), ${w.straight} of ${w.frames} frames drawn straight on, ${w.lights} lights listed at the end`)
        return { ...w, allowed }
      }
      const night = await walk(NIGHT_FRAC, 'night')
      const noon = await walk(FRAC, 'noon')
      console.log(`  (night walk ${night.fps} fps against the same walk at noon ${noon.fps} fps: ${(night.fps - noon.fps).toFixed(1)} for the night)`)
      if (!(night.fps > GATE.fps)) fails.push(`walking at night ${night.fps} fps at ${RATE}x throttle <= ${GATE.fps}`)
      if (night.path < 32 * 10) fails.push(`walking at night: only ${night.path} px walked (blocked?)`)
      if (night.builds > night.allowed) fails.push(`walking at night: ${night.builds} builds of the night mask > ${night.allowed} (a rebuild storm)`)
      if (night.straight > GATE.straight * night.frames) fails.push(`walking at night: ${night.straight} of ${night.frames} frames drawn straight on > ${GATE.straight * 100} %`)
    }
    if (errors.length) fails.push(`web errors: ${errors.slice(0, 3).join(' | ')}`)
  } finally {
    await browser?.close()
    srv.kill()
  }
}

console.log(fails.length ? `CITY PERF: FAILED\n  ${fails.join('\n  ')}` : 'CITY PERF: within the gates')
process.exit(fails.length ? 1 : 0)
